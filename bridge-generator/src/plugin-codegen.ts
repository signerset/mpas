import { validateOperationDisplay } from "@oma3/mpas";
import { computeToolSurfaceHash, sortTools } from "./artifacts.js";
import type { GeneratedDisplay, GeneratedDisplayField, GeneratedPlugin, JsonSchema, McpToolDefinition } from "./types.js";

export function generatePlugin(tools: McpToolDefinition[], protocolVersion: string): string {
  const plugin: GeneratedPlugin = {
    version: "2",
    type: "MpasApplicationPlugin",
    pluginDid: "did:web:PLACEHOLDER",
    pluginVersion: "0.1.0",
    publisherDid: "did:web:PLACEHOLDER",
    applicationDid: "did:web:PLACEHOLDER",
    executionProfile: {
      id: "did:web:profiles.oma3.org:mcp",
      format: "mcp.toolsCall",
      protocolVersion,
    },
    credentialRequirements: [],
    toolSurface: { hash: computeToolSurfaceHash(tools), toolNames: sortTools(tools).map(tool => tool.name) },
    operations: Object.fromEntries(
      tools.map((tool) => [
        tool.name,
        {
          description: tool.description ?? "",
          impact: tool.annotations?.destructiveHint === true ? "critical" : inferImpact(tool.name),
          executionPayloadSchema: {
            type: "object",
            required: ["name", "arguments"],
            properties: {
              name: { const: tool.name },
              arguments: rebaseLocalJsonReferences(tool.inputSchema, "#/properties/arguments"),
            },
            additionalProperties: false,
          },
          display: displayForTool(tool),
        },
      ]),
    ),
  };

  return `${JSON.stringify(plugin, null, 2)}\n`;
}

/**
 * An MCP tool's inputSchema is a schema document of its own. The Application
 * Plugin wraps that document under executionPayloadSchema.properties.arguments,
 * so JSON Pointer references rooted at the original document must move with it.
 */
export function rebaseLocalJsonReferences(value: unknown, basePointer: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => rebaseLocalJsonReferences(entry, basePointer));
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key === "$ref" && typeof entry === "string") {
        if (entry === "#") return [key, basePointer];
        if (entry.startsWith("#/")) return [key, `${basePointer}${entry.slice(1)}`];
      }
      return [key, rebaseLocalJsonReferences(entry, basePointer)];
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeGeneratedDisplay(fresh: GeneratedDisplay, previous: GeneratedDisplay | undefined, schema?: JsonSchema, priorGenerated?: GeneratedDisplay): GeneratedDisplay {
  if (!previous) return fresh;
  const freshByPath = new Map(fresh.fields.map((field) => [field.path, field]));
  const seen = new Set<string>();
  const fields: GeneratedDisplayField[] = [];
  for (const old of previous.fields) {
    const next = freshByPath.get(old.path);
    if (!next) {
      if (schema && !validateOperationDisplay("operation", { executionPayloadSchema: schema, display: { title: "Review", fields: [old] } }).some(d => d.severity === "error")) fields.push(old);
      continue;
    }
    seen.add(old.path);
    fields.push(mergeField(next, old, priorGenerated?.fields.find(field => field.path === old.path)));
  }
  for (const field of fresh.fields) {
    if (!seen.has(field.path)) fields.push(field);
  }
  return {
    title: previous.title || fresh.title,
    ...(previous.description ? { description: previous.description } : {}),
    ...(previous.interpolatedTitle ? { interpolatedTitle: previous.interpolatedTitle } : {}),
    fields,
    ...(previous.links ? { links: previous.links } : {}),
  };
}

function displayForTool(tool: McpToolDefinition): GeneratedDisplay {
  return {
    title: readableTitle(tool),
    fields: fieldsFromSchema(tool.inputSchema, "/arguments", tool.inputSchema),
  };
}

function readableTitle(tool: McpToolDefinition): string {
  const title = tool.title ?? (typeof tool.annotations?.title === "string" ? tool.annotations.title : undefined);
  if (title && title.trim()) return title.trim();
  const words = tool.name.split(/[_-]+/).filter(Boolean);
  if (!words.length) return tool.name;
  return [words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1).toLowerCase(), ...words.slice(1).map((word) => word.toLowerCase())].join(" ");
}

function fieldsFromSchema(schema: unknown, pointer: string, root: unknown, seen = new Set<unknown>(), depth = 0): GeneratedDisplayField[] {
  const resolved = dereference(schema, root, new Set()) ?? schema;
  if (seen.has(resolved) || depth > 32) return [rawField(pointer, resolved)];
  const visited = new Set(seen).add(resolved);
  if (!isRecord(resolved)) return [rawField(pointer, resolved)];
  if (Array.isArray(resolved.enum)) return [enumField(pointer, resolved)];
  if ((resolved.format === "date" || resolved.format === "date-time") && resolved.type === "string") return [dateField(pointer, resolved)];
  if (resolved.type === "array") return [rawField(pointer, resolved)];
  const properties = isRecord(resolved.properties) ? resolved.properties : undefined;
  if (properties && Object.keys(properties).length > 0) {
    return Object.keys(properties).flatMap((name) => fieldsFromSchema(properties[name], `${pointer}/${escapeToken(name)}`, root, visited, depth + 1));
  }
  if (pointer === "/arguments") return [];
  return [rawField(pointer, resolved)];
}

function rawField(pointer: string, schema: unknown): GeneratedDisplayField {
  return { path: pointer, title: fieldTitle(pointer, schema) };
}

function enumField(pointer: string, schema: Record<string, unknown>): GeneratedDisplayField {
  const values = Array.isArray(schema.enum) ? schema.enum.filter(isScalar).map((value) => ({ value, title: scalarTitle(value) || "Empty string" })) : [];
  return { path: pointer, title: fieldTitle(pointer, schema), format: "enum", params: { values } };
}

function dateField(pointer: string, schema: Record<string, unknown>): GeneratedDisplayField {
  return {
    path: pointer,
    title: fieldTitle(pointer, schema),
    format: "date",
    params: { type: schema.format === "date-time" ? "date-time" : "date" },
  };
}

function fieldTitle(pointer: string, schema: unknown): string {
  if (isRecord(schema) && typeof schema.title === "string" && schema.title.trim()) return schema.title.trim();
  const name = pointer.split("/").pop() ?? pointer;
  return name.replace(/~1/g, "/").replace(/~0/g, "~");
}

function mergeField(fresh: GeneratedDisplayField, previous: GeneratedDisplayField, priorGenerated?: GeneratedDisplayField): GeneratedDisplayField {
  const merged: GeneratedDisplayField = { ...fresh };
  if (!priorGenerated || previous.title !== priorGenerated.title) merged.title = previous.title;
  if (previous.description) merged.description = previous.description;
  if (fresh.format === "enum" && previous.format === "enum") {
    merged.params = { values: mergeEnumValues(fresh.params?.values ?? [], previous.params?.values ?? []) };
  }
  return merged;
}

function mergeEnumValues(
  fresh: NonNullable<GeneratedDisplayField["params"]>["values"],
  previous: NonNullable<GeneratedDisplayField["params"]>["values"],
): NonNullable<NonNullable<GeneratedDisplayField["params"]>["values"]> {
  const freshValues = fresh ?? [];
  const previousValues = previous ?? [];
  const freshByKey = new Map(freshValues.map((entry) => [scalarKey(entry.value), entry]));
  const seen = new Set<string>();
  const merged = [];
  for (const old of previousValues) {
    const key = scalarKey(old.value);
    const next = freshByKey.get(key);
    if (!next) continue;
    seen.add(key);
    merged.push({
      ...next,
      title: old.title !== scalarTitle(old.value) ? old.title : next.title,
      ...(old.description ? { description: old.description } : {}),
    });
  }
  for (const entry of freshValues) {
    if (!seen.has(scalarKey(entry.value))) merged.push(entry);
  }
  return merged;
}

function dereference(schema: unknown, root: unknown, seen: Set<string>): unknown {
  if (!isRecord(schema) || typeof schema.$ref !== "string" || seen.has(schema.$ref) || !schema.$ref.startsWith("#/")) return schema;
  let current = root;
  for (const raw of schema.$ref.slice(2).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, token)) return schema;
    current = current[token];
  }
  return dereference(current, root, new Set(seen).add(schema.$ref));
}

function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function scalarTitle(value: string | number | boolean | null): string {
  return typeof value === "string" ? value : JSON.stringify(value) ?? "null";
}

function scalarKey(value: string | number | boolean | null): string {
  return `${typeof value}:${JSON.stringify(value)}`;
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function inferImpact(name: string): "medium" | "high" | "critical" {
  const normalized = name.toLowerCase();
  if (/(delete|remove|destroy|drop|purge)/.test(normalized)) {
    return "critical";
  }
  if (/(merge|deploy|release|transfer|revoke)/.test(normalized)) {
    return "high";
  }
  return "medium";
}
