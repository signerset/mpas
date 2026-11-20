import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPlugin, presentOperation, type PluginOperationDescriptor } from "../../src/index.js";

const schema = {
  type: "object",
  required: ["name", "arguments"],
  additionalProperties: false,
  properties: {
    name: { const: "merge_pull_request" },
    arguments: {
      type: "object",
      additionalProperties: false,
      properties: {
        owner: { type: "string", title: "Repository owner" },
        repo: { type: "string" },
        pullNumber: { type: "integer", title: "Pull request" },
        baseRef: { type: "string", description: "Branch that receives the changes." },
        flag: { type: "boolean" },
        mergeMethod: { type: "string", enum: ["merge", "squash"] },
        when: { type: "string", format: "date-time" },
      },
    },
  },
};

function operation(display: PluginOperationDescriptor["display"]): PluginOperationDescriptor {
  return { description: "Merge a pull request.", executionPayloadSchema: schema, ...(display ? { display } : {}) };
}

const payload = {
  name: "merge_pull_request",
  arguments: { owner: "acme", repo: "demo", pullNumber: 12, baseRef: "main", flag: false, mergeMethod: "squash", extra: true, when: "2026-11-03T02:00:00Z" },
};

describe("plugin display", () => {
  it("distinguishes invalid descriptors from resource overruns with exact limits", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mpas-plugin-"));
    const path = join(directory, "limits.json");
    await writeFile(path, JSON.stringify(pluginDocument("2", operation({ title: "é".repeat(1025), fields: [] }))));
    expect(await loadPlugin(path)).toMatchObject({ ok: false, error: {
      code: "PLUGIN_RESOURCE_EXCEEDED", details: { resource: "text-length", actual: 2050, limit: 2048 },
    } });
    await writeFile(path, JSON.stringify(pluginDocument("2", operation({ title: "Test", fields: [{ path: "/arguments/flag", format: "enum" }] }))));
    expect(await loadPlugin(path)).toMatchObject({ ok: false, error: { code: "PLUGIN_SCHEMA_INVALID" } });
  });
  it("loads a version 1 plugin and rejects display on version 1", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mpas-plugin-"));
    const legacy = pluginDocument("1", { description: "Merge a pull request.", executionPayloadSchema: schema });
    const legacyPath = join(directory, "v1.json");
    await writeFile(legacyPath, JSON.stringify(legacy));
    const loaded = await loadPlugin(legacyPath);
    expect(loaded.ok).toBe(true);

    const withDisplay = pluginDocument("1", operation({ title: "Merge pull request", fields: [] }));
    const displayPath = join(directory, "v1-display.json");
    await writeFile(displayPath, JSON.stringify(withDisplay));
    const rejected = await loadPlugin(displayPath);
    expect(rejected.ok).toBe(false);
  });

  it("accepts governedByDefault only as a boolean on version 2", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mpas-plugin-"));
    const cases: Array<[string, "1" | "2", unknown, boolean]> = [
      ["v2-false", "2", false, true],
      ["v2-true", "2", true, true],
      ["v2-string", "2", "no", false],
      ["v1-false", "1", false, false],
    ];
    for (const [name, version, governedByDefault, ok] of cases) {
      const path = join(directory, `${name}.json`);
      await writeFile(path, JSON.stringify(pluginDocument(version, {
        description: "Merge a pull request.",
        executionPayloadSchema: schema,
        governedByDefault,
      } as unknown as PluginOperationDescriptor)));
      const loaded = await loadPlugin(path);
      expect(loaded.ok, name).toBe(ok);
      if (ok && loaded.ok) {
        expect(loaded.plugin.operations.merge_pull_request?.governedByDefault).toBe(governedByDefault);
      }
    }
  });

  it("accepts a version 2 plugin and reports missing explanations without failing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mpas-plugin-"));
    const path = join(directory, "v2.json");
    await writeFile(path, JSON.stringify(pluginDocument("2", operation({
      title: "Merge pull request",
      fields: [{ path: "/arguments/repo" }, { path: "/arguments/mergeMethod", format: "enum", params: { values: [{ value: "squash", title: "squash" }] } }],
    }))));
    const loaded = await loadPlugin(path);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.displayDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "enum-mismatch",
      "missing-explanation",
      "missing-explanation",
      "missing-explanation",
    ]);
  });

  it("rejects a path the schema cannot contain", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mpas-plugin-"));
    const path = join(directory, "typo.json");
    await writeFile(path, JSON.stringify(pluginDocument("2", operation({
      title: "Merge pull request",
      fields: [{ path: "/arguments/pullNubmer", title: "Pull request" }],
    }))));
    const loaded = await loadPlugin(path);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.message).toContain("/arguments/pullNubmer");
  });

  it("presents exact values, enum titles, and the uncovered remainder", () => {
    const presented = presentOperation("merge_pull_request", operation({
      title: "Merge pull request",
      description: "Check the proposed changes.",
      interpolatedTitle: "Merge PR {/arguments/pullNumber} into {/arguments/baseRef}",
      fields: [
        { path: "/arguments/pullNumber", title: "Pull request" },
        { path: "/arguments/baseRef", title: "Target branch" },
        { path: "/arguments/flag", title: "Flag" },
        { path: "/arguments/missing", title: "Optional" },
        { path: "/arguments/mergeMethod", title: "Merge method", format: "enum", params: { values: [
          { value: "squash", title: "Squash" },
          { value: 1, title: "One" },
        ] } },
        { path: "/arguments/when", title: "When", format: "date", params: { type: "date-time" } },
      ],
      links: [{
        title: "View pull request",
        urlTemplate: "https://github.com/{owner}/{repo}/pull/{pullNumber}",
        variables: { owner: "/arguments/owner", repo: "/arguments/repo", pullNumber: "/arguments/pullNumber" },
      }],
    }), payload);

    expect(presented.interpolatedTitle).toBe("Merge PR 12 into main");
    expect(presented.fields.find((field) => field.path === "/arguments/flag")).toMatchObject({ value: false, text: "false", state: "value" });
    expect(presented.fields.find((field) => field.path === "/arguments/missing")).toMatchObject({ state: "missing", text: "Not provided" });
    expect(presented.fields.find((field) => field.path === "/arguments/mergeMethod")).toMatchObject({ text: "Squash", value: "squash" });
    expect(presented.fields.find((field) => field.path === "/arguments/when")?.text).toBe("2026-11-03T02:00:00Z");
    expect(presented.links[0]).toMatchObject({ enabled: true, url: "https://github.com/acme/demo/pull/12" });
    expect(presented.additionalParameters.map((entry) => entry.pointer)).toEqual([
      "/arguments/extra",
      "/arguments/owner",
      "/arguments/repo",
      "/name",
    ]);
  });

  it("drops an interpolated sentence when a referenced value is missing and blocks link injection", () => {
    const presented = presentOperation("merge_pull_request", operation({
      title: "Merge pull request",
      interpolatedTitle: "Merge PR {/arguments/pullNumber} by {/arguments/owner}",
      fields: [
        { path: "/arguments/pullNumber", title: "Pull request" },
        { path: "/arguments/owner", title: "Owner" },
      ],
      links: [{
        title: "View pull request",
        urlTemplate: "https://github.com/{owner}/{repo}/pull/{pullNumber}",
        variables: { owner: "/arguments/owner", repo: "/arguments/repo", pullNumber: "/arguments/pullNumber" },
      }],
    }), { name: "merge_pull_request", arguments: { owner: "..", repo: "demo" } });

    expect(presented.interpolatedTitle).toBeUndefined();
    expect(presented.links[0]).toMatchObject({ enabled: false });
  });

  it("distinguishes numeric and string enum values", () => {
    const presented = presentOperation("merge_pull_request", operation({
      title: "Merge pull request",
      fields: [{ path: "/arguments/pullNumber", format: "enum", params: { values: [{ value: "12", title: "Twelve" }, { value: 12, title: "Twelve number" }] } }],
    }), payload);
    expect(presented.fields[0]).toMatchObject({ value: 12, text: "Twelve number" });
  });
});

function pluginDocument(version: "1" | "2", descriptor: PluginOperationDescriptor) {
  return {
    version,
    type: "MpasApplicationPlugin",
    pluginDid: "did:web:plugins.example.com:github-pr",
    pluginVersion: "1.0.0",
    publisherDid: "did:web:plugins.example.com",
    applicationDid: "did:web:github-adapter.example.com",
    executionProfile: { id: "did:web:profiles.oma3.org:mcp", format: "mcp.toolsCall", protocolVersion: "2024-11-05" },
    operations: { merge_pull_request: descriptor },
  };
}
