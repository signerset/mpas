/**
 * Advisory Authorization Requirements must keep the policy's allOf/anyOf meaning
 * (MPAS Core §5.8.5, JSON Verifier Policy Profile §5.5, §7.7).
 *
 * The cross-check helper enumerates every subset of eligible Signers and
 * compares two answers: does the policy engine accept that subset, and does the
 * coordination evaluator say the returned requirements are satisfied? The
 * returned requirements must never claim success for a subset the policy
 * refuses (sound). When the unmet tree fits the §5.8.5 shape, the two answers
 * must agree for every subset (exact).
 */
import { describe, expect, it } from "vitest";
import { buildAuthorizationRequirements } from "../../src/lib/auth-requirements-builder.js";
import { evaluateApprovalRequirements } from "../../src/lib/approval-requirements.js";
import { parseApprovalRequirements } from "../../src/lib/approval-requirements-schema.js";
import { evaluatePolicy, type PolicyConfig, type Requirement } from "../../src/lib/policy-engine.js";
import type { VerifiedApprovals } from "../../src/lib/verification.js";
import type { ActionPackage, ApprovalRequirements, Did } from "../../src/types/mpas.js";

const PROPOSER: Did = "did:web:agents.example:proposer";
const VERIFIER: Did = "did:web:verifier.example";
const MAINTAINER_A: Did = "did:web:agents.example:maintainera";
const MAINTAINER_B: Did = "did:web:agents.example:maintainerb";
const SECURITY: Did = "did:web:agents.example:security";
const ADMIN: Did = "did:web:agents.example:admin";
const OWNER: Did = "did:web:agents.example:owner";

const signerGroups = {
  all: [PROPOSER, MAINTAINER_A, MAINTAINER_B, SECURITY, ADMIN, OWNER],
  maintainers: [MAINTAINER_A, MAINTAINER_B],
  security: [SECURITY],
  admins: [ADMIN],
  owners: [OWNER],
};
const ELIGIBLE = [MAINTAINER_A, MAINTAINER_B, SECURITY, ADMIN, OWNER];

const twoMaintainers: Requirement = { type: "threshold", threshold: 2, eligibleSignerGroup: "maintainers" };
const oneMaintainer: Requirement = { type: "threshold", threshold: 1, eligibleSignerGroup: "maintainers" };
const oneSecurity: Requirement = { type: "threshold", threshold: 1, eligibleSignerGroup: "security" };
const oneAdmin: Requirement = { type: "threshold", threshold: 1, eligibleSignerGroup: "admins" };
const oneOwner: Requirement = { type: "threshold", threshold: 1, eligibleSignerGroup: "owners" };

function actionPackage(name = "merge"): ActionPackage {
  return {
    version: "1",
    type: "ActionPackage",
    executionPayload: { name, arguments: {} },
    actionEnvelope: {
      version: "1",
      type: "ActionEnvelope",
      proposer: { did: PROPOSER },
      target: { applicationDid: "did:web:app.example" as Did },
      executionProfile: { id: "did:web:profiles.oma3.org:mcp" as Did, format: "mcp.toolsCall" },
      executionPayloadHash: { alg: "sha-256", value: "fake-hash" },
      actionId: { value: "test-action-id" },
      createdAt: "2026-06-01T00:00:00.000Z",
      expiresAt: "2026-06-02T00:00:00.000Z",
    },
    approvalBundle: { actionEnvelopeHash: { alg: "sha-256", value: "fake-hash" }, approvals: [] },
  } as unknown as ActionPackage;
}

function approvalsFrom(signers: Did[]): VerifiedApprovals {
  return {
    actionEnvelopeHash: { alg: "sha-256", value: "fake-hash" },
    approvals: signers.map((signerDid) => ({
      approval: {} as never,
      signerDid,
      decision: "approve" as const,
      createdAt: "2026-06-01T00:00:00.000Z",
    })),
  };
}

function policyWithDefault(defaultRequirement: Requirement): PolicyConfig {
  return { defaultRequirement, signerGroups };
}

/** Evaluates the policy, builds the advisory requirements, and checks them against the schema. */
function advisoryFor(policy: PolicyConfig, approvedBy: Did[] = []): ApprovalRequirements {
  const result = evaluatePolicy(actionPackage(), approvalsFrom(approvedBy), policy);
  if (result.status !== "additionalApprovalsRequired") {
    throw new Error(`expected additionalApprovalsRequired, got ${result.status}`);
  }
  const requirements = buildAuthorizationRequirements({
    actionEnvelope: actionPackage().actionEnvelope,
    approvalRequirements: result.approvalRequirements,
    verifierDid: VERIFIER,
  });
  if (requirements.result !== "additionalApprovalsRequired") {
    throw new Error("builder must request additional approvals");
  }
  // MPAS Core Appendix A.4.8 shape: flat anyOf/allOf arrays of threshold objects only.
  parseApprovalRequirements(requirements.approvalRequirements);
  return requirements.approvalRequirements;
}

/** Compact view of an approval requirements object for readable assertions. */
function shape(requirements: ApprovalRequirements): Record<string, string[]> {
  const view = (entries: ApprovalRequirements["anyOf"]) =>
    (entries ?? []).map(function show(entry): string { return entry.type === 'threshold' ? `${entry.threshold} of ${entry.eligibleSigners.map(nameOf).join(",")}` : `${entry.type}(${entry.requirements.map(show).join('; ')})`; });
  return {
    ...(requirements.anyOf ? { anyOf: view(requirements.anyOf) } : {}),
    ...(requirements.allOf ? { allOf: view(requirements.allOf) } : {}),
  };
}

function nameOf(did: Did): string {
  return did.slice(did.lastIndexOf(":") + 1);
}

/** Lists every Signer subset where the advisory requirements and the policy disagree in the forbidden direction(s). */
function disagreements(
  policy: PolicyConfig,
  requirements: ApprovalRequirements,
  mode: "exact" | "sound",
): string[] {
  const problems: string[] = [];
  for (let mask = 0; mask < 1 << ELIGIBLE.length; mask++) {
    const subset = ELIGIBLE.filter((_, index) => (mask & (1 << index)) !== 0);
    const policySatisfied = evaluatePolicy(actionPackage(), approvalsFrom(subset), policy).status === "satisfied";
    const advisorySatisfied = evaluateApprovalRequirements(
      requirements,
      subset.map((signerDid) => ({ signerDid, decision: "approve" as const })),
    ) === "satisfied";
    const label = `{${subset.map(nameOf).join(",")}}`;
    if (advisorySatisfied && !policySatisfied) problems.push(`${label}: advisory satisfied, policy refuses`);
    if (mode === "exact" && policySatisfied && !advisorySatisfied) problems.push(`${label}: policy accepts, advisory unsatisfied`);
  }
  return problems;
}

describe("Authorization Requirements keep allOf/anyOf structure", () => {
  describe("two matching policy entries, both unmet", () => {
    const policy: PolicyConfig = {
      defaultRequirement: { type: "proposerOnly" },
      signerGroups,
      policies: {
        merge: [
          { description: "Two maintainers.", requirements: twoMaintainers },
          { description: "One security reviewer.", requirements: oneSecurity },
        ],
      },
    };

    it("reports an allOf tree from the policy engine", () => {
      const result = evaluatePolicy(actionPackage(), approvalsFrom([]), policy);
      expect(result).toMatchObject({
        status: "additionalApprovalsRequired",
        unmetRequirement: {
          type: "allOf",
          requirements: [
            { type: "threshold", unsatisfied: { requiredRole: "maintainers", threshold: 2, found: 0 } },
            { type: "threshold", unsatisfied: { requiredRole: "security", threshold: 1, found: 0 } },
          ],
        },
      });
    });

    it("emits allOf, never anyOf, in the advisory requirements", () => {
      const requirements = advisoryFor(policy);
      expect(requirements.anyOf).toBeUndefined();
      expect(shape(requirements)).toEqual({ allOf: ["2 of maintainera,maintainerb", "1 of security"] });
      expect(disagreements(policy, requirements, "exact")).toEqual([]);
    });

    it("does not count one satisfied group as enough", () => {
      const requirements = advisoryFor(policy);
      expect(evaluateApprovalRequirements(requirements, [{ signerDid: SECURITY, decision: "approve" }])).toBe("pending");
      expect(evaluateApprovalRequirements(requirements, [
        { signerDid: MAINTAINER_A, decision: "approve" },
        { signerDid: MAINTAINER_B, decision: "approve" },
        { signerDid: SECURITY, decision: "approve" },
      ])).toBe("satisfied");
    });

    it("retains an entry that is already satisfied", () => {
      const requirements = advisoryFor(policy, [MAINTAINER_A, MAINTAINER_B]);
      expect(shape(requirements)).toEqual({ allOf: ["2 of maintainera,maintainerb", "1 of security"] });
    });

    it("emits allOf from the deprecated flat list too", () => {
      const result = evaluatePolicy(actionPackage(), approvalsFrom([]), policy);
      if (result.status !== "additionalApprovalsRequired") throw new Error("expected unmet policy");
      const requirements = buildAuthorizationRequirements({
        actionEnvelope: actionPackage().actionEnvelope,
        unsatisfiedRules: result.unsatisfiedRules,
        verifierDid: VERIFIER,
      });
      if (requirements.result !== "additionalApprovalsRequired") throw new Error("expected requirements");
      expect(shape(requirements.approvalRequirements)).toEqual({
        allOf: ["2 of maintainera,maintainerb", "1 of security"],
      });
    });
  });

  describe("anyOf with no satisfied alternative", () => {
    const policy = policyWithDefault({ type: "anyOf", requirements: [twoMaintainers, oneAdmin] });

    it("reports every alternative, keeping per-alternative counts", () => {
      const result = evaluatePolicy(actionPackage(), approvalsFrom([MAINTAINER_A]), policy);
      expect(result).toMatchObject({
        status: "additionalApprovalsRequired",
        unmetRequirement: {
          type: "anyOf",
          requirements: [
            { type: "threshold", unsatisfied: { requiredRole: "maintainers", threshold: 2, found: 1 } },
            { type: "threshold", unsatisfied: { requiredRole: "admins", threshold: 1, found: 0 } },
          ],
        },
      });
    });

    it("emits every alternative as anyOf", () => {
      const requirements = advisoryFor(policy);
      expect(shape(requirements)).toEqual({ anyOf: ["2 of maintainera,maintainerb", "1 of admin"] });
      expect(disagreements(policy, requirements, "exact")).toEqual([]);
    });

    it("keeps the deprecated flat list to the first alternative", () => {
      const result = evaluatePolicy(actionPackage(), approvalsFrom([]), policy);
      if (result.status !== "additionalApprovalsRequired") throw new Error("expected unmet policy");
      expect(result.unsatisfiedRules).toHaveLength(1);
      expect(result.unsatisfiedRules[0]).toMatchObject({ requiredRole: "maintainers" });
    });
  });

  describe("nested allOf/anyOf", () => {
    it("allOf containing anyOf → one anyOf group plus required allOf thresholds (exact)", () => {
      const policy = policyWithDefault({
        type: "allOf",
        requirements: [oneSecurity, { type: "anyOf", requirements: [twoMaintainers, oneAdmin] }],
      });
      const requirements = advisoryFor(policy);
      expect(shape(requirements)).toEqual({
        anyOf: ["2 of maintainera,maintainerb", "1 of admin"],
        allOf: ["1 of security"],
      });
      expect(disagreements(policy, requirements, "exact")).toEqual([]);
    });

    it("matching entries where one entry is an anyOf → anyOf group plus allOf (exact)", () => {
      const policy: PolicyConfig = {
        defaultRequirement: { type: "proposerOnly" },
        signerGroups,
        policies: {
          merge: [
            { requirements: { type: "anyOf", requirements: [oneAdmin, oneOwner] } },
            { requirements: oneSecurity },
          ],
        },
      };
      const requirements = advisoryFor(policy);
      expect(shape(requirements)).toEqual({ anyOf: ["1 of admin", "1 of owner"], allOf: ["1 of security"] });
      expect(disagreements(policy, requirements, "exact")).toEqual([]);
    });

    it("anyOf nested in anyOf is flattened so no alternative is lost (exact)", () => {
      const policy = policyWithDefault({
        type: "anyOf",
        requirements: [{ type: "anyOf", requirements: [twoMaintainers, oneAdmin] }, oneOwner],
      });
      const requirements = advisoryFor(policy);
      expect(shape(requirements)).toEqual({
        anyOf: ["2 of maintainera,maintainerb", "1 of admin", "1 of owner"],
      });
      expect(disagreements(policy, requirements, "exact")).toEqual([]);
    });

    it("allOf with a satisfied member leaves only the unmet anyOf (exact for the remaining Signers)", () => {
      const policy = policyWithDefault({
        type: "allOf",
        requirements: [oneSecurity, { type: "anyOf", requirements: [oneAdmin, oneOwner] }],
      });
      const result = evaluatePolicy(actionPackage(), approvalsFrom([SECURITY]), policy);
      expect(result).toMatchObject({
        status: "additionalApprovalsRequired",
        unmetRequirement: { type: "allOf", requirements: [{ type: "anyOf" }] },
      });
      expect(shape(advisoryFor(policy, [SECURITY]))).toEqual({ anyOf: ["1 of admin", "1 of owner"], allOf: ["1 of security"] });
    });

    it("anyOf preserves every composite alternative (exact)", () => {
      // "Two maintainers and a security reviewer, or one admin" has no exact §5.8.5 form.
      const policy = policyWithDefault({
        type: "anyOf",
        requirements: [{ type: "allOf", requirements: [twoMaintainers, oneSecurity] }, oneAdmin],
      });
      const result = evaluatePolicy(actionPackage(), approvalsFrom([]), policy);
      expect(result).toMatchObject({
        status: "additionalApprovalsRequired",
        unmetRequirement: {
          type: "anyOf",
          requirements: [{ type: "allOf", requirements: [{ type: "threshold" }, { type: "threshold" }] }, { type: "threshold" }],
        },
      });
      const requirements = advisoryFor(policy);
      expect(shape(requirements)).toEqual({ anyOf: ["allOf(2 of maintainera,maintainerb; 1 of security)", "1 of admin"] });
      expect(disagreements(policy, requirements, "exact")).toEqual([]);
    });

    it("allOf preserves both independent choices (exact)", () => {
      const policy = policyWithDefault({
        type: "allOf",
        requirements: [
          { type: "anyOf", requirements: [oneAdmin, oneOwner] },
          { type: "anyOf", requirements: [oneSecurity, twoMaintainers] },
        ],
      });
      const requirements = advisoryFor(policy);
      expect(shape(requirements)).toEqual({ allOf: ["anyOf(1 of admin; 1 of owner)", "anyOf(1 of security; 2 of maintainera,maintainerb)"] });
      expect(disagreements(policy, requirements, "exact")).toEqual([]);
    });

    it("three levels deep stays sound", () => {
      const policy = policyWithDefault({
        type: "allOf",
        requirements: [
          oneOwner,
          {
            type: "anyOf",
            requirements: [
              { type: "allOf", requirements: [oneMaintainer, { type: "anyOf", requirements: [oneSecurity, oneAdmin] }] },
              twoMaintainers,
            ],
          },
        ],
      });
      const requirements = advisoryFor(policy);
      expect(shape(requirements)).toEqual({
        allOf: ["1 of owner", "anyOf(allOf(1 of maintainera,maintainerb; anyOf(1 of security; 1 of admin)); 2 of maintainera,maintainerb)"],
      });
      expect(disagreements(policy, requirements, "sound")).toEqual([]);
    });
  });

  it("refuses to build requirements with nothing unmet", () => {
    expect(() => buildAuthorizationRequirements({
      actionEnvelope: actionPackage().actionEnvelope,
      unsatisfiedRules: [],
      verifierDid: VERIFIER,
    })).toThrow(TypeError);
  });
});
