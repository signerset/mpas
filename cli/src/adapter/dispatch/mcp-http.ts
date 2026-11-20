import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { guardOAuthScopes, type OAuthScopeChallenge } from "../oauth-scope-guard.js";
import { createHardenedFetch } from "../hardened-fetch.js";
import { classifyOAuthPrepareError, oauthLoginCommand } from "../oauth-operator.js";
import { withInitializeProtocolVersion } from "./mcp-protocol-version.js";
import { errorMessage, McpClientSession, type DispatchPrepareResult } from "./mcp-stdio.js";

export interface McpHttpTarget {
  type: "mcp.http";
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  auth?: {
    type: "oauth2";
    session: string;
    scopes?: string[];
  };
}

/**
 * Connect and initialize the HTTP MCP target before the ledger write. A later
 * transport failure during tools/call remains indeterminate.
 */
export async function prepareMcpHttp(
  target: McpHttpTarget,
  credential: string | undefined,
  protocolVersion: string,
  authProvider?: OAuthClientProvider,
  oauthOperatorCommand?: string,
  onScopeChallenge?: (challenge: OAuthScopeChallenge) => void,
): Promise<DispatchPrepareResult> {
  const timeoutMs = target.timeoutMs ?? 30_000;
  const fetchFn = createHardenedFetch({ label: "MCP request" });
  const managed = authProvider as (OAuthClientProvider & {
    wrapFetch?: (fetchFn: FetchLike) => FetchLike;
    recordAccessDenied?: () => Promise<void>;
  }) | undefined;
  const guardedFetch = managed ? guardOAuthScopes(
    fetchFn, managed, target.auth?.scopes ?? [],
    oauthOperatorCommand ?? "mpas oauth login", onScopeChallenge,
    () => managed.recordAccessDenied?.(),
  ) : fetchFn;
  // A managed provider classifies token-endpoint responses during preparation.
  // Once a tool call is transmitted, authentication recovery must not resend it.
  const transportFetch = managed?.wrapFetch ? managed.wrapFetch(guardedFetch) : guardedFetch;
  const transport = new VersionedStreamableHttpClientTransport(
    new URL(target.url),
    {
      ...(authProvider ? { authProvider } : {}),
      // Shares the adapter's connect policy with the OAuth path. The SDK routes every
      // request through this, including the reauthorization it performs on a 401, which
      // is why the hardening cannot live in the OAuth helper alone. No per-attempt
      // deadline is set: a tools/call may legitimately run long, so the caller's own
      // timeout stays the only response bound and retries remain limited to connect
      // failures, where no request bytes were sent.
      fetch: transportFetch,
      requestInit: {
        headers: credential ? injectCredential(target.headers ?? {}, credential) : target.headers,
      },
    },
    protocolVersion,
  );
  const client = new Client(
    { name: "mpas-credential-adapter", version: "1.0.0" },
    { capabilities: {} },
  );
  try {
    await client.connect(transport, { timeout: timeoutMs, maxTotalTimeout: timeoutMs });
  } catch (error) {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    if (authProvider) {
      return {
        ok: false,
        error: classifyOAuthPrepareError(
          error,
          oauthOperatorCommand ?? oauthLoginCommand({
            applicationDid: "unknown",
            resourceUrl: target.url,
            session: target.auth?.session ?? "unknown",
            credentialHandle: "unknown",
          }),
        ),
      };
    }
    return {
      ok: false,
      error: {
        code: "TARGET_UNAVAILABLE",
        message: `MCP HTTP target could not be connected and initialized: ${errorMessage(error)}`,
      },
    };
  }
  return {
    ok: true,
    session: new McpClientSession(client, timeoutMs, "TRANSPORT_ERROR"),
  };
}

class VersionedStreamableHttpClientTransport extends StreamableHTTPClientTransport {
  constructor(
    url: URL,
    options: ConstructorParameters<typeof StreamableHTTPClientTransport>[1],
    private readonly initializationProtocolVersion: string,
  ) {
    const fetchRequest = options?.fetch ?? globalThis.fetch;
    super(url, {
      ...options,
      fetch: async (input, init) => {
        // Inspect each serialized request independently, including batched messages.
        // Preparation may authenticate normally; a dispatched tool call must never
        // be resent by redirect handling or the SDK's authentication recovery.
        const message: unknown = init?.method === "POST" && typeof init.body === "string"
          ? JSON.parse(init.body) : undefined;
        const messages = Array.isArray(message) ? message : [message];
        const isToolCall = messages.some(item =>
          typeof item === "object" && item !== null && "method" in item && item.method === "tools/call",
        );
        const response = await fetchRequest(input, isToolCall ? { ...init, redirect: "manual" } : init);
        if (isToolCall && !response.ok) {
          await response.body?.cancel().catch(() => {});
          // McpClientSession maps this to TRANSPORT_ERROR (indeterminate). Do not
          // expose upstream bodies or let the SDK refresh and repeat the request.
          throw new Error("MCP tool call HTTP failure after dispatch; the operation was not retried.");
        }
        return response;
      },
    });
  }

  override send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    return super.send(
      withInitializeProtocolVersion(message, this.initializationProtocolVersion),
      options,
    );
  }
}

function injectCredential(headers: Record<string, string>, credential: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, value.replaceAll(/{{credential:[^}]+}}/g, credential)]),
  );
}
