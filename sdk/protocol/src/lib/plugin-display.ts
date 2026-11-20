/**
 * Version 2 maintainer presentation: structural limits, semantic checks, and
 * deterministic interpretation of an operation display against a payload.
 * Rendering clients use this module. It does not authorize an Action.
 */
import type { DisplayField, DisplayLink, OperationDisplay, PluginOperationDescriptor } from "../types/mpas.js";

export const DISPLAY_LIMITS = {
  fields: 256,
  enumValues: 256,
  links: 16,
  variables: 16,
  pointerBytes: 1_024,
  shortTextBytes: 2_048,
  longTextBytes: 8_192,
} as const;

export interface DisplayDiagnostic {
  severity: "error" | "warning";
  code: string;
  operation: string;
  location: string;
  message: string;
  pointer?: string;
  resource?: { actual: number; limit: number };
}

export interface PresentedValue {
  path: string;
  title: string;
  description?: string;
  state: "value" | "missing";
  /** Exact payload value. Absent when `state` is `missing`. */
  value?: unknown;
  text: string;
  notice?: string;
  /** False when the value must not be substituted into an interpolated sentence. */
  safe: boolean;
  valueDescription?: string;
}

export interface PresentedLink {
  title: string;
  description?: string;
  enabled: boolean;
  url?: string;
  reason?: string;
}

export interface AdditionalParameter {
  pointer: string;
  value: unknown;
}

export interface OperationPresentation {
  operation: string;
  title: string;
  description?: string;
  /** Omitted when a referenced value is missing or cannot be formatted safely. */
  interpolatedTitle?: string;
  fields: PresentedValue[];
  links: PresentedLink[];
  additionalParameters: AdditionalParameter[];
  notices: string[];
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function validateOperationDisplay(
  operationName: string,
  operation: PluginOperationDescriptor,
): DisplayDiagnostic[] {
  const display = operation.display;
  if (!display) return displayGaps(operationName, operation, undefined);
  const diagnostics: DisplayDiagnostic[] = [];
  const location = `$.operations.${operationName}.display`;
  checkText(diagnostics, operationName, `${location}.title`, display.title, DISPLAY_LIMITS.shortTextBytes, "title");
  if (display.description !== undefined) {
    checkText(diagnostics, operationName, `${location}.description`, display.description, DISPLAY_LIMITS.longTextBytes, "description");
  }
  if (display.interpolatedTitle !== undefined) {
    checkText(diagnostics, operationName, `${location}.interpolatedTitle`, display.interpolatedTitle, DISPLAY_LIMITS.shortTextBytes, "interpolatedTitle");
  }
  if (display.fields.length > DISPLAY_LIMITS.fields) {
    diagnostics.push(resourceError(operationName, `${location}.fields`, "display-fields", display.fields.length, DISPLAY_LIMITS.fields));
  }
  if ((display.links?.length ?? 0) > DISPLAY_LIMITS.links) {
    diagnostics.push(resourceError(operationName, `${location}.links`, "display-links", display.links!.length, DISPLAY_LIMITS.links));
  }

  const seenPaths = new Set<string>();
  for (let index = 0; index < display.fields.length; index += 1) {
    const field = display.fields[index]!;
    const fieldLocation = `${location}.fields[${index}]`;
    const parsed = parseJsonPointer(field.path);
    if (!parsed.ok) {
      diagnostics.push(error(operationName, `${fieldLocation}.path`, "invalid-pointer", parsed.message, field.path));
      continue;
    }
    if (utf8Bytes(field.path) > DISPLAY_LIMITS.pointerBytes) {
      diagnostics.push(resourceError(operationName, `${fieldLocation}.path`, "pointer-length", utf8Bytes(field.path), DISPLAY_LIMITS.pointerBytes, field.path));
    }
    if (seenPaths.has(field.path)) {
      diagnostics.push(error(operationName, `${fieldLocation}.path`, "duplicate-path", `Duplicate display path ${field.path}.`, field.path));
    }
    seenPaths.add(field.path);
    const proof = provePointer(operation.executionPayloadSchema, parsed.tokens);
    if (proof === "impossible") {
      diagnostics.push(error(
        operationName,
        `${fieldLocation}.path`,
        "impossible-path",
        `No payload valid under the execution schema can contain ${field.path}.`,
        field.path,
      ));
    }
    if (field.title !== undefined) checkText(diagnostics, operationName, `${fieldLocation}.title`, field.title, DISPLAY_LIMITS.shortTextBytes, "title");
    if (field.description !== undefined) checkText(diagnostics, operationName, `${fieldLocation}.description`, field.description, DISPLAY_LIMITS.longTextBytes, "description");
    validateFieldFormat(diagnostics, operationName, fieldLocation, field);
    if (field.format === "enum" && field.params?.values && proof !== "impossible") {
      diagnoseEnumCoverage(diagnostics, operationName, fieldLocation, field, operation.executionPayloadSchema, parsed.tokens);
    }
  }

  if (display.interpolatedTitle !== undefined) {
    diagnoseInterpolation(diagnostics, operationName, `${location}.interpolatedTitle`, display);
  }
  display.links?.forEach((link, index) => diagnoseLinkTemplate(diagnostics, operationName, `${location}.links[${index}]`, link, operation));
  diagnostics.push(...displayGaps(operationName, operation, display));
  return diagnostics;
}

export function presentOperation(
  operationName: string,
  operation: PluginOperationDescriptor,
  payload: unknown,
): OperationPresentation {
  assertExactNumbers(payload);
  const display = operation.display;
  if (!display) {
    return {
      operation: operationName,
      title: operationName,
      ...(operation.description ? { description: operation.description } : {}),
      fields: [],
      links: [],
      additionalParameters: payload === undefined ? [] : [{ pointer: "", value: payload }],
      notices: ["This operation has no display descriptor. Review the payload directly."],
    };
  }

  const fields = display.fields.map((field) => presentField(field, payload, operation.executionPayloadSchema));
  const presentedByPath = new Map(fields.map((field) => [field.path, field]));
  return {
    operation: operationName,
    title: display.title,
    ...(display.description ? { description: display.description } : operation.description ? { description: operation.description } : {}),
    ...interpolatedTitle(display, presentedByPath),
    fields,
    links: (display.links ?? []).map((link) => presentLink(link, payload)),
    additionalParameters: additionalParameters(payload, display.fields.map((field) => field.path)),
    notices: fields.flatMap((field) => field.notice ? [field.notice] : []),
  };
}

function presentField(field: DisplayField, payload: unknown, schema: unknown): PresentedValue {
  const parsed = parseJsonPointer(field.path);
  const title = field.title ?? schemaAnnotation(schema, parsed.ok ? parsed.tokens : [], "title") ?? field.path;
  const description = field.description ?? schemaAnnotation(schema, parsed.ok ? parsed.tokens : [], "description");
  if (!parsed.ok) {
    return { path: field.path, title, ...(description ? { description } : {}), state: "missing", text: "Not provided", notice: parsed.message, safe: false };
  }
  const resolved = resolvePointer(payload, parsed.tokens);
  if (!resolved.present) {
    return { path: field.path, title, ...(description ? { description } : {}), state: "missing", text: "Not provided", safe: false };
  }
  const formatted = formatValue(field, resolved.value);
  return {
    path: field.path,
    title,
    ...(description ? { description } : {}),
    state: "value",
    value: resolved.value,
    text: formatted.text,
    ...(formatted.notice ? { notice: formatted.notice } : {}),
    safe: formatted.safe,
    ...(formatted.valueDescription ? { valueDescription: formatted.valueDescription } : {}),
  };
}

function formatValue(field: DisplayField, value: unknown): { text: string; notice?: string; safe: boolean; valueDescription?: string } {
  const format = field.format ?? "raw";
  if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    return { text: "Unsupported number", notice: "The number is outside the exact integer range and was not interpreted.", safe: false };
  }
  if (format === "enum") {
    const match = field.params?.values?.find((entry) => sameJsonScalar(entry.value, value));
    if (!match) {
      return { text: rawText(value), notice: "No display mapping is available for this value.", safe: true };
    }
    return { text: match.title, safe: true, ...(match.description ? { valueDescription: match.description } : {}) };
  }
  if (format === "date") {
    const type = field.params?.type;
    const text = typeof value === "string" ? value : rawText(value);
    const valid = typeof value === "string" && (type === "date" ? validDate(value, false) : type === "date-time" && validDate(value, true));
    if (!valid) return { text, notice: "The value does not match the date format and is shown unchanged.", safe: false };
    return { text, safe: true };
  }
  return { text: rawText(value), safe: true };
}

function rawText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return JSON.stringify(value);
  return JSON.stringify(value) ?? "";
}

function interpolatedTitle(
  display: OperationDisplay,
  fields: Map<string, PresentedValue>,
): { interpolatedTitle: string } | Record<string, never> {
  if (display.interpolatedTitle === undefined) return {};
  const placeholders = interpolationReferences(display.interpolatedTitle);
  if (!placeholders) return {};
  const parts: string[] = [];
  const literal = (text: string) => text.replace(/\{\{/g, "{").replace(/}}/g, "}");
  let cursor = 0;
  for (const placeholder of placeholders) {
    const field = fields.get(placeholder.path);
    if (!field || field.state === "missing" || !field.safe) return {};
    parts.push(literal(display.interpolatedTitle.slice(cursor, placeholder.start)), field.text);
    cursor = placeholder.end;
  }
  parts.push(literal(display.interpolatedTitle.slice(cursor)));
  const summary = parts.join("");
  return utf8Bytes(summary) <= DISPLAY_LIMITS.shortTextBytes ? { interpolatedTitle: summary } : {};
}

function presentLink(link: DisplayLink, payload: unknown): PresentedLink {
  const base = { title: link.title, ...(link.description ? { description: link.description } : {}) };
  const names = [...link.urlTemplate.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]!);
  let url = link.urlTemplate;
  for (const name of names) {
    const pointer = link.variables?.[name];
    const parsed = pointer !== undefined ? parseJsonPointer(pointer) : { ok: false as const, message: "missing" };
    const resolved = parsed.ok ? resolvePointer(payload, parsed.tokens) : { present: false, value: undefined };
    if (!resolved.present) return { ...base, enabled: false, reason: `Missing value for {${name}}.` };
    if (!isLinkValue(resolved.value)) return { ...base, enabled: false, reason: `{${name}} is not a string or integer.` };
    const text = typeof resolved.value === "string" ? resolved.value : String(resolved.value);
    if (text === "" || text === "." || text === ".." || /[\u0000-\u001F\u007F]/.test(text)) {
      return { ...base, enabled: false, reason: `{${name}} cannot be placed in the URL.` };
    }
    try { url = url.replace(`{${name}}`, encodeURIComponent(text)); } catch { return { ...base, enabled: false, reason: "The value is not valid Unicode." }; }
  }
  let parsed: URL;
  let template: URL;
  try {
    parsed = new URL(url);
    template = new URL(link.urlTemplate.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, "a"));
  } catch {
    return { ...base, enabled: false, reason: "The link URL is not valid." };
  }
  if (parsed.origin !== template.origin || parsed.username || parsed.password || parsed.protocol !== "https:") {
    return { ...base, enabled: false, reason: "The link would leave the template origin." };
  }
  return { ...base, enabled: true, url: parsed.toString() };
}

export function parseJsonPointer(pointer: string): { ok: true; tokens: string[] } | { ok: false; message: string } {
  if (pointer === "") return { ok: true, tokens: [] };
  if (!pointer.startsWith("/") || pointer.startsWith("#")) {
    return { ok: false, message: "A display path must be an absolute JSON Pointer." };
  }
  const tokens: string[] = [];
  for (const raw of pointer.split("/").slice(1)) {
    if (/~(?![01])/.test(raw)) {
      return { ok: false, message: "JSON Pointer escapes must be ~0 or ~1." };
    }
    tokens.push(raw.replace(/~1/g, "/").replace(/~0/g, "~"));
  }
  return { ok: true, tokens: tokens };
}

export function resolvePointer(value: unknown, tokens: string[]): { present: boolean; value?: unknown } {
  let current = value;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!ARRAY_INDEX.test(token)) return { present: false };
      const index = Number(token);
      if (!Object.prototype.hasOwnProperty.call(current, index)) return { present: false };
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, token)) return { present: false };
    current = current[token];
  }
  return { present: true, value: current };
}

export function additionalParameters(payload: unknown, fieldPaths: string[]): AdditionalParameter[] {
  const covered = fieldPaths.flatMap((pointer) => {
    const parsed = parseJsonPointer(pointer);
    if (!parsed.ok) return [];
    const resolved = resolvePointer(payload, parsed.tokens);
    return resolved.present ? [parsed.tokens] : [];
  });
  if (covered.length === 0) return [{ pointer: "", value: payload }];
  const entries: AdditionalParameter[] = [];
  walkRemainder(payload, [], covered, entries);
  return entries;
}

function walkRemainder(value: unknown, tokens: string[], covered: string[][], entries: AdditionalParameter[]): void {
  const coverage = coverageOf(value, tokens, covered);
  if (coverage === "full") return;
  if (coverage === "none") {
    entries.push({ pointer: formatPointer(tokens), value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkRemainder(item, [...tokens, String(index)], covered, entries));
    return;
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value).sort(compareCodePoints)) {
      walkRemainder(value[key], [...tokens, key], covered, entries);
    }
  }
}

function coverageOf(value: unknown, tokens: string[], covered: string[][]): "full" | "partial" | "none" {
  if (covered.some((path) => isPrefix(path, tokens))) return "full";
  if (isTerminal(value)) return "none";
  const descendants = terminalTokens(value, tokens);
  if (descendants.length === 0) return "none";
  const coveredDescendants = descendants.filter((descendant) => covered.some((path) => isPrefix(path, descendant)));
  if (coveredDescendants.length === 0) return "none";
  return coveredDescendants.length === descendants.length ? "full" : "partial";
}

function terminalTokens(value: unknown, tokens: string[]): string[][] {
  if (isTerminal(value)) return [tokens];
  if (Array.isArray(value)) return value.flatMap((item, index) => terminalTokens(item, [...tokens, String(index)]));
  if (isRecord(value)) return Object.keys(value).flatMap((key) => terminalTokens(value[key], [...tokens, key]));
  return [tokens];
}

function isTerminal(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return true;
}

function isPrefix(prefix: string[], tokens: string[]): boolean {
  return prefix.length <= tokens.length && prefix.every((token, index) => token === tokens[index]);
}

function formatPointer(tokens: string[]): string {
  return tokens.map((token) => `/${token.replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
}

function compareCodePoints(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

type Proof = "possible" | "impossible" | "indeterminate";

function provePointer(schema: unknown, tokens: string[]): Proof {
  return proveNode(schema, tokens, schema, new Set());
}

function proveNode(schema: unknown, tokens: string[], root: unknown, seen: Set<string>): Proof {
  if (schema === false) return "impossible";
  if (schema === true || schema === undefined) return tokens.length === 0 ? "possible" : "indeterminate";
  if (!isRecord(schema)) return "indeterminate";
  if (typeof schema.$ref === "string") {
    if (seen.has(schema.$ref)) return "indeterminate";
    const target = resolveLocalRef(root, schema.$ref);
    if (target === undefined) return "indeterminate";
    const referenced = proveNode(target, tokens, root, new Set(seen).add(schema.$ref));
    const own = proveNode({ ...schema, $ref: undefined }, tokens, root, seen);
    return referenced === 'impossible' || own === 'impossible' ? 'impossible' : referenced;
  }
  // Sibling constraints apply alongside combinators and references.
  const branches = combineBranches(schema, tokens, root, seen);
  if (branches) return branches;
  if (tokens.length === 0) return "possible";
  const [token, ...rest] = tokens;
  const types = schemaTypes(schema);
  const results: Proof[] = [];
  if (types.has("object") || (!types.size && (schema.properties || schema.additionalProperties === false))) {
    results.push(proveObject(schema, token!, rest, root, seen));
  }
  if (types.has("array")) results.push(proveArray(schema, token!, rest, root, seen));
  if (types.has("string") || types.has("number") || types.has("integer") || types.has("boolean") || types.has("null")) {
    results.push("impossible");
  }
  if (!results.length) return "indeterminate";
  if (results.includes("possible")) return "possible";
  if (types.size && results.every((result) => result === "impossible")) return "impossible";
  return "indeterminate";
}

function combineBranches(schema: Record<string, unknown>, tokens: string[], root: unknown, seen: Set<string>): Proof | undefined {
  const allOf = arrayOf(schema.allOf), anyOf = arrayOf(schema.anyOf), oneOf = arrayOf(schema.oneOf);
  if (!allOf.length && !anyOf.length && !oneOf.length) return undefined;
  const own = proveNode({ ...schema, allOf: undefined, anyOf: undefined, oneOf: undefined }, tokens, root, seen);
  const conjunction = [own, ...allOf.map(branch => proveNode(branch, tokens, root, seen))];
  for (const alternatives of [anyOf, oneOf]) {
    if (!alternatives.length) continue;
    const proofs = alternatives.map(branch => proveNode(branch, tokens, root, seen));
    conjunction.push(proofs.every(p => p === 'impossible') ? 'impossible' : proofs.includes('possible') ? 'possible' : 'indeterminate');
  }
  return conjunction.includes('impossible') ? 'impossible' : conjunction.every(p => p === 'possible') ? 'possible' : 'indeterminate';
}

function proveObject(schema: Record<string, unknown>, token: string, rest: string[], root: unknown, seen: Set<string>): Proof {
  const properties = isRecord(schema.properties) ? schema.properties : undefined;
  if (properties && Object.prototype.hasOwnProperty.call(properties, token)) {
    return proveNode(properties[token], rest, root, seen);
  }
  if (schema.additionalProperties === false && !patternAllows(schema, token)) return "impossible";
  if (isRecord(schema.additionalProperties)) return proveNode(schema.additionalProperties, rest, root, seen);
  return "indeterminate";
}

function proveArray(schema: Record<string, unknown>, token: string, rest: string[], root: unknown, seen: Set<string>): Proof {
  if (!ARRAY_INDEX.test(token)) return "impossible";
  const index = Number(token);
  if (typeof schema.maxItems === "number" && index >= schema.maxItems) return "impossible";
  if (Array.isArray(schema.prefixItems) && index < schema.prefixItems.length) return proveNode(schema.prefixItems[index], rest, root, seen);
  if (schema.items === false) return "impossible";
  if (schema.items !== undefined) return proveNode(schema.items, rest, root, seen);
  return rest.length === 0 ? "possible" : "indeterminate";
}

function patternAllows(schema: Record<string, unknown>, _token: string): boolean {
  // Arbitrary schema regexes are not executed by presentation analysis. Their
  // presence makes exclusion indeterminate; payload validation remains separate.
  return isRecord(schema.patternProperties) && Object.keys(schema.patternProperties).length > 0;
}

function schemaTypes(schema: Record<string, unknown>): Set<string> {
  if (typeof schema.type === "string") return new Set([schema.type]);
  if (Array.isArray(schema.type) && schema.type.every((entry) => typeof entry === "string")) return new Set(schema.type);
  return new Set();
}

function schemaAnnotation(schema: unknown, tokens: string[], keyword: "title" | "description"): string | undefined {
  const node = uniqueSchema(schema, tokens, schema, new Set());
  const text = isRecord(node) ? node[keyword] : undefined;
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

function uniqueSchema(schema: unknown, tokens: string[], root: unknown, seen: Set<string>): unknown {
  if (!isRecord(schema)) return undefined;
  if (typeof schema.$ref === "string") {
    if (seen.has(schema.$ref)) return undefined;
    const target = resolveLocalRef(root, schema.$ref);
    return target === undefined ? undefined : uniqueSchema(target, tokens, root, new Set(seen).add(schema.$ref));
  }
  if (arrayOf(schema.anyOf).length || arrayOf(schema.oneOf).length) return undefined;
  if (tokens.length === 0) return schema;
  const properties = isRecord(schema.properties) ? schema.properties : undefined;
  const next = properties?.[tokens[0]!];
  if (next === undefined) return undefined;
  return uniqueSchema(next, tokens.slice(1), root, seen);
}

function resolveLocalRef(root: unknown, ref: string): unknown {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return undefined;
  let current = root;
  for (const raw of ref.slice(2).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, token)) return undefined;
    current = current[token];
  }
  return current;
}

function validateFieldFormat(diagnostics: DisplayDiagnostic[], operation: string, location: string, field: DisplayField): void {
  const format = field.format ?? "raw";
  if ((format === "enum" && field.params?.type !== undefined) || (format === "date" && field.params?.values !== undefined)) diagnostics.push(error(operation, location, "invalid-params", "Formatter options do not match the format."));
  if (format === "raw" && field.params !== undefined) {
    diagnostics.push(error(operation, `${location}.params`, "raw-params", "A raw field has no params."));
  }
  if (format === "enum") {
    const values = field.params?.values;
    if (!values?.length) diagnostics.push(error(operation, `${location}.params.values`, "enum-values", "An enum field requires params.values."));
    if ((values?.length ?? 0) > DISPLAY_LIMITS.enumValues) {
      diagnostics.push(resourceError(operation, `${location}.params.values`, "enum-values", values!.length, DISPLAY_LIMITS.enumValues));
    }
    const seen = new Set<string>();
    values?.forEach((entry, index) => {
      const key = scalarKey(entry.value);
      if (seen.has(key)) diagnostics.push(error(operation, `${location}.params.values[${index}]`, "duplicate-enum", `Duplicate enum value ${key}.`));
      seen.add(key);
      if (entry.description !== undefined) checkText(diagnostics, operation, `${location}.params.values[${index}].description`, entry.description, DISPLAY_LIMITS.longTextBytes, "description");
      if (entry.title !== undefined) checkText(diagnostics, operation, `${location}.params.values[${index}].title`, entry.title, DISPLAY_LIMITS.shortTextBytes, "title");
    });
  }
  if (format === "date" && field.params?.type !== "date" && field.params?.type !== "date-time") {
    diagnostics.push(error(operation, `${location}.params.type`, "date-type", "A date field requires params.type of date or date-time."));
  }
}

function diagnoseEnumCoverage(
  diagnostics: DisplayDiagnostic[],
  operation: string,
  location: string,
  field: DisplayField,
  schema: unknown,
  tokens: string[],
): void {
  const node = uniqueSchema(schema, tokens, schema, new Set());
  if (!isRecord(node) || !Array.isArray(node.enum)) return;
  const declared = new Set(node.enum.filter(isJsonScalar).map(scalarKey));
  const mapped = new Set((field.params?.values ?? []).map((entry) => scalarKey(entry.value)));
  for (const entry of field.params?.values ?? []) {
    if (!declared.has(scalarKey(entry.value))) {
      diagnostics.push(warning(operation, location, "enum-mismatch", `Enum title ${scalarKey(entry.value)} is outside the schema enum.`, field.path));
    }
  }
  for (const value of declared) {
    if (!mapped.has(value)) diagnostics.push(warning(operation, location, "enum-mismatch", `Schema enum value ${value} has no display mapping.`, field.path));
  }
}

function diagnoseInterpolation(diagnostics: DisplayDiagnostic[], operation: string, location: string, display: OperationDisplay): void {
  const references = interpolationReferences(display.interpolatedTitle ?? "");
  if (!references) {
    diagnostics.push(error(operation, location, "invalid-interpolation", "interpolatedTitle contains an invalid placeholder."));
    return;
  }
  const paths = new Set(display.fields.map((field) => field.path));
  for (const reference of references) {
    if (!paths.has(reference.path)) {
      diagnostics.push(error(operation, location, "undeclared-interpolation", `Placeholder ${reference.path} is not a declared field.`, reference.path));
    }
  }
}

function interpolationReferences(template: string): Array<{ path: string; start: number; end: number }> | undefined {
  const references: Array<{ path: string; start: number; end: number }> = [];
  for (let index = 0; index < template.length; index += 1) {
    if (template.startsWith("{{", index) || template.startsWith("}}", index)) {
      index += 1;
      continue;
    }
    if (template[index] === "}") return undefined;
    if (template[index] !== "{") continue;
    const end = template.indexOf("}", index);
    if (end < 0) return undefined;
    const path = template.slice(index + 1, end);
    if (!parseJsonPointer(path).ok) return undefined;
    references.push({ path, start: index, end: end + 1 });
    index = end;
  }
  return references;
}

function diagnoseLinkTemplate(
  diagnostics: DisplayDiagnostic[],
  operation: string,
  location: string,
  link: NonNullable<OperationDisplay["links"]>[number],
  descriptor: PluginOperationDescriptor,
): void {
  checkText(diagnostics, operation, `${location}.urlTemplate`, link.urlTemplate, DISPLAY_LIMITS.longTextBytes, "urlTemplate");
  checkText(diagnostics, operation, `${location}.title`, link.title, DISPLAY_LIMITS.shortTextBytes, "title");
  if (link.description !== undefined) checkText(diagnostics, operation, `${location}.description`, link.description, DISPLAY_LIMITS.longTextBytes, "description");
  if (link.urlTemplate.includes("#")) {
    diagnostics.push(error(operation, `${location}.urlTemplate`, "invalid-link", "Link templates cannot contain a fragment or user information."));
    return;
  }
  const matches = [...link.urlTemplate.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)];
  const without = link.urlTemplate.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, "");
  if (without.includes("{") || without.includes("}")) {
    diagnostics.push(error(operation, `${location}.urlTemplate`, "invalid-link", "A link placeholder must be one complete identifier."));
    return;
  }
  const names = matches.map((match) => match[1]!);

  for (const match of matches) {
    if (!placeholderIsWholeSlot(link.urlTemplate, match.index ?? 0, match[0].length)) {
      diagnostics.push(error(operation, `${location}.urlTemplate`, "invalid-link", `Placeholder ${match[0]} must occupy one path segment or query value.`));
    }
  }
  const variables = link.variables ?? {};
  const variableNames = Object.keys(variables);
  if (variableNames.length > DISPLAY_LIMITS.variables) {
    diagnostics.push(resourceError(operation, `${location}.variables`, "link-variables", variableNames.length, DISPLAY_LIMITS.variables));
  }
  if (new Set(names).size !== variableNames.length || names.some((name) => !Object.prototype.hasOwnProperty.call(variables, name))) {
    diagnostics.push(error(operation, `${location}.variables`, "link-variables", "Link variables must match the template placeholders exactly."));
  }
  for (const name of variableNames) {
    if (!IDENTIFIER.test(name)) diagnostics.push(error(operation, location, "invalid-link", "Invalid variable name."));
    const pointer = variables[name] ?? "";
    const parsed = parseJsonPointer(pointer);
    if (!parsed.ok) {
      diagnostics.push(error(operation, `${location}.variables.${name}`, "invalid-pointer", parsed.message, pointer));
      continue;
    }
    if (utf8Bytes(pointer) > DISPLAY_LIMITS.pointerBytes) {
      diagnostics.push(resourceError(operation, `${location}.variables.${name}`, "pointer-length", utf8Bytes(pointer), DISPLAY_LIMITS.pointerBytes, pointer));
      continue;
    }
    if (provePointer(descriptor.executionPayloadSchema, parsed.tokens) === "impossible") {
      diagnostics.push(error(operation, `${location}.variables.${name}`, "impossible-path", `No payload can contain ${pointer}.`, pointer));
    }
  }
  try {
    const probe = new URL(link.urlTemplate.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, "a"));
    if (probe.protocol !== "https:" || probe.username || probe.password || probe.hash) {
      diagnostics.push(error(operation, `${location}.urlTemplate`, "invalid-link", "A link template must be an absolute HTTPS URL with a literal origin."));
    }
  } catch {
    diagnostics.push(error(operation, `${location}.urlTemplate`, "invalid-link", "A link template must be an absolute HTTPS URL."));
  }
}

function placeholderIsWholeSlot(template: string, index: number, length: number): boolean {
  const scheme = template.indexOf("://");
  if (scheme < 0 || index < scheme + 3) return false;
  const pathStart = template.indexOf("/", scheme + 3);
  const queryStart = template.indexOf("?");
  const authorityEnd = Math.min(...[pathStart, queryStart].filter(n => n >= 0));
  if (index < authorityEnd) return false;
  const before = template[index - 1];
  const after = template[index + length] ?? "";
  if (queryStart >= 0 && index > queryStart) return before === "=" && (after === "" || after === "&");
  return before === "/" && (after === "" || after === "/" || after === "?");
}

function displayGaps(operationName: string, operation: PluginOperationDescriptor, display: OperationDisplay | undefined): DisplayDiagnostic[] {
  if (!display) return [];
  const gaps: DisplayDiagnostic[] = [];
  if (!display.description && !operation.description) {
    gaps.push(warning(operationName, `$.operations.${operationName}.display.description`, "missing-explanation", "The operation has no explanation."));
  }
  display.fields.forEach((field, index) => {
    const parsed = parseJsonPointer(field.path);
    const schemaDescription = parsed.ok ? schemaAnnotation(operation.executionPayloadSchema, parsed.tokens, "description") : undefined;
    if (!field.description && !schemaDescription) {
      gaps.push(warning(operationName, `$.operations.${operationName}.display.fields[${index}].description`, "missing-explanation", `Field ${field.path} has no explanation.`, field.path));
    }
    field.params?.values?.forEach((entry, valueIndex) => {
      if (!entry.description) {
        gaps.push(warning(operationName, `$.operations.${operationName}.display.fields[${index}].params.values[${valueIndex}].description`, "missing-explanation", `Enum value ${scalarKey(entry.value)} has no explanation.`, field.path));
      }
    });
  });
  return gaps;
}

function checkText(diagnostics: DisplayDiagnostic[], operation: string, location: string, value: string, limit: number, name: string): void {
  const actual = utf8Bytes(value);
  if (actual > limit) diagnostics.push({ ...resourceError(operation, location, "text-length", actual, limit), message: `${name} is ${actual} UTF-8 bytes; the limit is ${limit}.` });
}

function resourceError(operation: string, location: string, code: string, actual: number, limit: number, pointer?: string): DisplayDiagnostic {
  return { ...error(operation, location, code, `${location} uses ${actual}; the limit is ${limit}.`, pointer), resource: { actual, limit } };
}

function isLinkValue(value: unknown): value is string | number {
  return typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value));
}

function sameJsonScalar(left: unknown, right: unknown): boolean {
  return isJsonScalar(left) && isJsonScalar(right) && scalarKey(left) === scalarKey(right);
}

function isJsonScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function scalarKey(value: string | number | boolean | null): string {
  return `${typeof value}:${JSON.stringify(value)}`;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function error(operation: string, location: string, code: string, message: string, pointer?: string): DisplayDiagnostic {
  return { severity: "error", code, operation, location, message, ...(pointer ? { pointer } : {}) };
}

function warning(operation: string, location: string, code: string, message: string, pointer?: string): DisplayDiagnostic {
  return { severity: "warning", code, operation, location, message, ...(pointer ? { pointer } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parsed JS numbers cannot recover lost integer precision; never render them as exact. */
function assertExactNumbers(value: unknown, depth = 0): void {
  if (depth > 64) throw new RangeError('Payload exceeds presentation depth limit');
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new RangeError('Payload contains a number outside the exact supported range');
  if (value && typeof value === 'object') for (const child of Object.values(value)) assertExactNumbers(child, depth + 1);
}
function validDate(value: string, withTime: boolean): boolean {
  if (!(withTime ? DATE_TIME : DATE).test(value)) return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number) as [number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]!) return false;
  if (!withTime) return true;
  const hours = Number(value.slice(11,13)), minutes = Number(value.slice(14,16)), seconds = Number(value.slice(17,19));
  const zone = /([+-])(\d{2}):(\d{2})$/.exec(value);
  return hours < 24 && minutes < 60 && seconds < 60 && (!zone || (Number(zone[2]) < 24 && Number(zone[3]) < 60));
}
