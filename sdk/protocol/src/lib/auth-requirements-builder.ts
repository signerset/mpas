import { parseApprovalRequirements } from "./approval-requirements-schema.js";
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
  /** Complete combined requirements returned by evaluatePolicy. */
  approvalRequirements?: ApprovalRequirements;
  /**
   * @deprecated Pass approvalRequirements to include already-satisfied branches.
   */
  unmetRequirement?: UnmetRequirement;
  /**
   * Flat list of unmet thresholds, treated as all required. Ignored when
   * `approvalRequirements` or `unmetRequirement` is present.
   *
   * @deprecated Pass `approvalRequirements`.
   */
  unsatisfiedRules?: UnsatisfiedThreshold[];
  /** DID of the Verifier that evaluated the Action. */
  verifierDid: Did;
}

/** Constructs advisory requirements. Pass evaluatePolicy's complete approvalRequirements.
 * Legacy unmet inputs remain available for older callers, but cannot recover satisfied branches.
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
  const input: BuildAuthorizationRequirementsInput = "actionEnvelope" in inputOrEnvelope ? inputOrEnvelope : {
    actionEnvelope: inputOrEnvelope, unsatisfiedRules: legacyUnsatisfiedRules, verifierDid: legacyVerifierDid!,
  };
  const { actionEnvelope, verifierDid } = input;
  const requirements = input.approvalRequirements
    ? parseApprovalRequirements(input.approvalRequirements)
    : toApprovalRequirements(input.unmetRequirement ?? unmetFromFlatList(input.unsatisfiedRules ?? []));
  return {
    version: "1",
    type: "AuthorizationRequirements",
    actionEnvelopeHash: computeJsonHash(actionEnvelope),
    result: "additionalApprovalsRequired",
    verifier: {
      did: verifierDid,
    },
    approvalRequirements: requirements,
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
  const convert = (node: UnmetRequirement): import('../types/mpas.js').RequirementItem => node.type === 'threshold'
    ? toThresholdRequirement(node.unsatisfied) : { type: node.type, requirements: node.requirements.map(convert) };
  const root = convert(normalize(unmet));
  return parseApprovalRequirements(root.type === 'threshold' ? { anyOf: [root] } : { [root.type]: root.requirements });
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
