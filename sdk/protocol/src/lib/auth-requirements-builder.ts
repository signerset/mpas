import type { UnmetRequirement, UnsatisfiedThreshold } from "./policy-engine.js";
import type {
  ActionEnvelope,
  ApprovalRequirements,
  AuthorizationRequirements,
  Decision,
  Did,
  ThresholdRequirement,
} from "../types/mpas.js";
import { computeJsonHash } from "./verification.js";

/** Input for constructing Verifier-authored Authorization Requirements. */
export interface BuildAuthorizationRequirementsInput {
  /** Action Envelope whose exact hash the requirements authorize. */
  actionEnvelope: ActionEnvelope;
  /**
   * Unmet requirement tree from `evaluatePolicy`. Preferred over
   * `unsatisfiedRules` because it keeps allOf/anyOf structure.
   */
  unmetRequirement?: UnmetRequirement;
  /**
   * Flat list of unmet thresholds, treated as all required. Ignored when
   * `unmetRequirement` is present.
   *
   * @deprecated Pass `unmetRequirement`.
   */
  unsatisfiedRules?: UnsatisfiedThreshold[];
  /** DID of the Verifier that evaluated the Action. */
  verifierDid: Did;
}

/**
 * Constructs Authorization Requirements from the unmet result of Verifier policy evaluation.
 *
 * MPAS Core §5.8.5 can express one `anyOf` group of thresholds plus any number
 * of `allOf` thresholds, all of which must hold. Unmet trees of that shape are
 * represented exactly. A deeper tree (an anyOf alternative that needs several
 * thresholds, or an allOf over several anyOf groups) is reduced to one
 * sufficient path by taking the first alternative of each anyOf that does not
 * fit, so collecting the returned approvals always satisfies the unmet
 * requirement, but some alternatives are not listed.
 *
 * Counts of approvals already found are not included: the §5.8.6 threshold
 * object has no field for them, and a replacement Action needs fresh Approvals.
 *
 * @throws {TypeError} If there is no unmet requirement to describe.
 */
export function buildAuthorizationRequirements(
  input: BuildAuthorizationRequirementsInput,
): AuthorizationRequirements;
/** @deprecated Use the input-object overload. */
export function buildAuthorizationRequirements(
  actionEnvelope: ActionEnvelope,
  unsatisfiedRules: UnsatisfiedThreshold[],
  verifierDid: Did,
): AuthorizationRequirements;
export function buildAuthorizationRequirements(
  inputOrEnvelope: BuildAuthorizationRequirementsInput | ActionEnvelope,
  legacyUnsatisfiedRules?: UnsatisfiedThreshold[],
  legacyVerifierDid?: Did,
): AuthorizationRequirements {
  const { actionEnvelope, unmetRequirement, unsatisfiedRules, verifierDid }: BuildAuthorizationRequirementsInput =
    "actionEnvelope" in inputOrEnvelope
      ? inputOrEnvelope
      : {
          actionEnvelope: inputOrEnvelope,
          unsatisfiedRules: legacyUnsatisfiedRules ?? [],
          verifierDid: legacyVerifierDid as Did,
        };
  const unmet = unmetRequirement ?? unmetFromFlatList(unsatisfiedRules ?? []);
  return {
    version: "1",
    type: "AuthorizationRequirements",
    actionEnvelopeHash: computeJsonHash(actionEnvelope),
    result: "additionalApprovalsRequired",
    verifier: {
      did: verifierDid,
    },
    approvalRequirements: toApprovalRequirements(unmet),
    createdAt: new Date().toISOString(),
    expiresAt: actionEnvelope.expiresAt,
  };
}

/** The flat list from `evaluatePolicy` is one sufficient path, so every entry is required. */
function unmetFromFlatList(unsatisfiedRules: UnsatisfiedThreshold[]): UnmetRequirement {
  if (unsatisfiedRules.length === 0) {
    throw new TypeError("Authorization Requirements need at least one unmet requirement.");
  }
  return {
    type: "allOf",
    requirements: unsatisfiedRules.map((unsatisfied) => ({ type: "threshold", unsatisfied })),
  };
}

function toApprovalRequirements(unmet: UnmetRequirement): ApprovalRequirements {
  const collected: { anyOf?: ThresholdRequirement[]; allOf: ThresholdRequirement[] } = { allOf: [] };
  collect(normalize(unmet), collected);
  const { anyOf, allOf } = collected;
  if (anyOf === undefined) {
    // A single required threshold reads the same either way; §5.8.5 recommends anyOf.
    return allOf.length === 1 ? { anyOf: allOf } : { allOf };
  }
  return allOf.length === 0 ? { anyOf } : { anyOf, allOf };
}

/** Adds the thresholds needed to satisfy `node` to `into`, keeping at most one anyOf group. */
function collect(
  node: UnmetRequirement,
  into: { anyOf?: ThresholdRequirement[]; allOf: ThresholdRequirement[] },
): void {
  switch (node.type) {
    case "threshold":
      into.allOf.push(toThresholdRequirement(node.unsatisfied));
      return;
    case "allOf":
      for (const child of node.requirements) collect(child, into);
      return;
    case "anyOf": {
      const alternatives = node.requirements;
      if (into.anyOf === undefined && alternatives.every((alt) => alt.type === "threshold")) {
        into.anyOf = alternatives.map((alt) => toThresholdRequirement(alt.unsatisfied));
        return;
      }
      // Not expressible as the single anyOf group: commit to the first alternative.
      collect(alternatives[0], into);
      return;
    }
  }
}

/** Flattens nested allOf-in-allOf and anyOf-in-anyOf and unwraps single-member groups. */
function normalize(node: UnmetRequirement): UnmetRequirement {
  if (node.type === "threshold") return node;
  const requirements = node.requirements
    .map(normalize)
    .flatMap((child) => (child.type === node.type ? (child as typeof node).requirements : [child]));
  return requirements.length === 1 ? requirements[0] : { type: node.type, requirements };
}

function toThresholdRequirement(unsatisfied: UnsatisfiedThreshold): ThresholdRequirement {
  return {
    type: "threshold",
    threshold: unsatisfied.threshold,
    eligibleSigners: [...unsatisfied.eligibleSigners],
    decision: unsatisfied.requiredDecision as Decision,
    description:
      unsatisfied.requirement.description ??
      `Requires ${unsatisfied.threshold} ${unsatisfied.requiredRole} approval(s).`,
  };
}
