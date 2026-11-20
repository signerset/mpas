import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { canonicalize } from "json-canonicalize";
import {
  ActionPackageBuilder,
  ApprovalBuilder,
  KeyManager,
  verifyActionPackage,
  verifyApprovalBundle,
  readApprovalRequirements,
  type Did,
  type RequirementItem,
} from "../../src/index.js";
import { validatePolicyConfig } from "../../src/lib/policy-engine.js";
import { mapPolicyRequirements } from "../../src/lib/requirement-mapping.js";

const did = (name: string) => `did:web:${name}.example` as Did;
const threshold = (name: string): RequirementItem => ({
  type: "threshold",
  threshold: 1,
  eligibleSigners: [did(name)],
});

describe("approvals update", () => {
  it("preserves nesting, pending alternatives, overrides and composite progress", () => {
    const requirements = {
      anyOf: [
        { type: "allOf" as const, requirements: [threshold("a"), threshold("b")] },
        threshold("c"),
      ],
      overrideSigners: [{ signer: did("owner"), permissions: ["approve"] }],
    };
    const view = readApprovalRequirements(requirements, [{ signerDid: did("a"), decision: "reject" }]);
    expect(view.status).toBe("pending");
    expect(view.eligibleSigners).toEqual([did("a"), did("b"), did("c"), did("owner")]);
    expect(view.progress).toEqual({ pending: [did("b"), did("c"), did("owner")] });
    expect(readApprovalRequirements(requirements, [
      { signerDid: did("c"), decision: "approve" },
    ]).status).toBe("satisfied");
  });

  it("caps single-threshold progress at the required count", () => {
    const view = readApprovalRequirements({
      anyOf: [{ type: "threshold", threshold: 1, eligibleSigners: [did("a"), did("b")] }],
    }, [
      { signerDid: did("a"), decision: "approve" },
      { signerDid: did("b"), decision: "approve" },
    ]);
    expect(view.progress).toEqual({ required: 1, collected: 1, pending: [] });
  });

  it("rejects excessive nesting and size before evaluation", () => {
    let item = threshold("a");
    for (let index = 0; index < 4; index++) item = { type: "allOf", requirements: [item] };
    expect(() => readApprovalRequirements({ allOf: [item] })).toThrow(/depth/);
    const many = Array.from({ length: 33 }, () => threshold("a"));
    expect(() => readApprovalRequirements({ allOf: many })).toThrow(/32/);
    expect(validatePolicyConfig({
      signerGroups: { all: [did("a")] },
      defaultRequirement: {
        type: "allOf",
        requirements: many as Array<{ type: "threshold"; threshold: number; eligibleSigners: Did[] }>,
      },
    }).ok).toBe(false);
  });

  it("bounds malformed traversal without rejecting valid trees at both limits", () => {
    let valid = threshold("a");
    for (let index = 0; index < 3; index++) valid = { type: "allOf", requirements: [valid] };
    expect(readApprovalRequirements({ allOf: Array(32).fill(valid) }).thresholds).toHaveLength(32);
    expect(() => readApprovalRequirements({ allOf: [null] })).toThrow(/objects/);

    let reads = 0;
    let malformed: unknown = { get requirements() { reads++; return null; } };
    for (let index = 0; index < 3; index++) {
      malformed = { type: "allOf", requirements: Array(32).fill(malformed) };
    }
    expect(() => readApprovalRequirements({ allOf: [malformed] })).toThrow(/traversal/);
    expect(reads).toBeLessThanOrEqual(128);
  });

  it("simplifies proposerOnly as true without dropping other thresholds", () => {
    expect(mapPolicyRequirements({
      type: "allOf",
      requirements: [
        {
          type: "anyOf",
          requirements: [
            { type: "proposerOnly" },
            { type: "threshold", threshold: 1, eligibleSigners: [did("a")] },
          ],
        },
        { type: "threshold", threshold: 1, eligibleSigners: [did("b")] },
      ],
    }, {})).toMatchObject({ anyOf: [{ eligibleSigners: [did("b")] }] });
  });

  it("checks review artifacts in both verification APIs and keeps proposer failures fatal", async () => {
    const proposer = await KeyManager.fromFile(fileURLToPath(new URL("../fixtures/keys/proposer.json", import.meta.url)));
    const maintainer = await KeyManager.fromFile(fileURLToPath(new URL("../fixtures/keys/maintainer-a.json", import.meta.url)));
    const pkg = await new ActionPackageBuilder({
      keyManager: proposer,
      applicationDid: did("app"),
      executionProfile: { id: "did:web:profiles.oma3.org:mcp", format: "mcp.toolsCall" },
    }).buildFromToolCall("test", {});
    const builder = new ApprovalBuilder({ keyManager: maintainer });
    const matching = await builder.buildApproval(pkg.actionEnvelope, "approve", { reviewArtifact: "did:artifact:expected" });
    const mismatch = await builder.buildApproval(pkg.actionEnvelope, "approve", { reviewArtifact: "did:artifact:old" });
    const generic = await builder.buildApproval(pkg.actionEnvelope, "approve");
    const bad = structuredClone(matching);
    bad.signature.value = bad.signature.value.slice(0, -10) + "abcdefghij";
    pkg.approvalBundle.approvals.push(matching, mismatch, generic, bad);
    const config = {
      trustedSigners: [{ did: proposer.did }, { did: maintainer.did }],
      trustedApplicationDids: [did("app")],
      reviewArtifact: "did:artifact:expected" as Did,
    };
    const result = await verifyActionPackage(pkg, config);
    expect(result).toMatchObject({
      status: "verified",
      ignoredApprovals: [
        { index: 2, code: "REVIEW_ARTIFACT_MISMATCH", reviewArtifact: "did:artifact:expected" },
        { index: 4, code: "INVALID_SIGNATURE" },
      ],
    });
    if (result.status === "verified") expect(result.verifiedApprovals.approvals).toHaveLength(3);

    // The public bundle API defaults to a verifier with no metadata. A caller
    // cannot accidentally count an artifact-bound Approval by omitting options.
    const bundleResult = await verifyApprovalBundle(
      pkg.approvalBundle, pkg.approvalBundle.actionEnvelopeHash, config.trustedSigners,
    );
    expect(bundleResult).toMatchObject({
      ok: true,
      ignoredApprovals: [
        { index: 1, code: "REVIEW_ARTIFACT_MISMATCH" },
        { index: 2, code: "REVIEW_ARTIFACT_MISMATCH" },
        { index: 4, code: "INVALID_SIGNATURE" },
      ],
    });
    if (bundleResult.ok) expect(bundleResult.verifiedApprovals.approvals).toHaveLength(2);

    const first = pkg.approvalBundle.approvals[0]!;
    const payload = JSON.parse(Buffer.from(first.signature.value.split(".")[1]!, "base64url").toString());
    payload.reviewArtifact = "did:artifact:old";
    first.signature.value = await proposer.sign(Buffer.from(canonicalize(payload)));
    expect(await verifyActionPackage(pkg, config)).toMatchObject({ status: "rejected" });
  });
});
