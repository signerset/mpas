export interface JsonSchema {
  [key: string]: unknown;
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  [key: string]: unknown;
}

/**
 * The required MCP Tool fields plus the standardized optional fields known to
 * the generator. The index signature is intentional: discovery must preserve
 * extension and future protocol fields instead of silently stripping them.
 */
export interface McpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: McpToolAnnotations;
  icons?: Array<Record<string, unknown>>;
  execution?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UpstreamInfo {
  command: string;
  args: string[];
  serverName: string;
  serverVersion?: string;
  protocolVersion: string;
  tools: McpToolDefinition[];
}

export interface CredentialRequirement {
  type: string;
  expectedAuthority?: string[];
  refreshScope?: string;
  description?: string;
}

export interface GeneratedPlugin {
  toolSurface?: { hash: { alg: "sha-256"; value: string }; toolNames: string[] };
  version: "2";
  type: "MpasApplicationPlugin";
  pluginDid: string;
  pluginVersion: string;
  publisherDid: string;
  applicationDid: string;
  executionProfile: {
    id: string;
    format: string;
    protocolVersion: string;
  };
  credentialRequirements: CredentialRequirement[];
  operations: Record<string, {
    description: string;
    impact: "medium" | "high" | "critical";
    executionPayloadSchema: JsonSchema;
    governedByDefault?: boolean;
    display?: GeneratedDisplay;
  }>;
}

export interface GeneratedDisplay {
  title: string;
  description?: string;
  interpolatedTitle?: string;
  fields: GeneratedDisplayField[];
  links?: import("@oma3/mpas").DisplayLink[];
}

export interface GeneratedDisplayField {
  path: string;
  title: string;
  description?: string;
  format?: "raw" | "enum" | "date";
  params?: {
    type?: "date" | "date-time";
    values?: Array<{ value: string | number | boolean | null; title: string; description?: string }>;
  };
}
