import { parseApprovalRequirements } from "./approval-requirements-schema.js";
import type { ApprovalRequirements, Decision, Did, ThresholdRequirement, RequirementItem, CoordinationProgress } from "../types/mpas.js";

/** One Signer's final decision for one Action Envelope. */
export interface SignerDecision {
  signerDid: Did;
  decision: Decision;
}

/** Deterministic coordination view of an approval expression. */
export type ApprovalRequirementsStatus = "satisfied" | "pending" | "unreachable";

/**
 * Evaluates whether immutable Signer decisions satisfy an approval expression,
 * could still satisfy it, or have made it unreachable.
 *
 * The first decision supplied for a Signer is final. Repeating that decision is
 * harmless; supplying a different decision for the same DID is invalid input.
 * Ordinary `anyOf` and `allOf` threshold paths are evaluated together. An
 * `overrideSigners` entry with matching `approve` or `reject` permission is also
 * honored as unilateral authority; an undecided approve override keeps an
 * otherwise unreachable expression pending.
 *
 * This is a coordination-state helper. A Verifier still performs authoritative
 * Approval verification and policy evaluation.
 *
 * @throws {Error} If one Signer has conflicting decisions in `decisions`.
 */
export function evaluateApprovalRequirements(
  requirements: ApprovalRequirements,
  decisions: Iterable<SignerDecision>,
): ApprovalRequirementsStatus {
  requirements = parseApprovalRequirements(requirements);
  const decisionsBySigner = immutableDecisionMap(decisions);
  const overrides = requirements.overrideSigners ?? [];

  if (overrides.some((entry) =>
    entry.permissions.includes("reject") && decisionsBySigner.get(entry.signer) === "reject")) {
    return "unreachable";
  }
  if (overrides.some((entry) =>
    entry.permissions.includes("approve") && decisionsBySigner.get(entry.signer) === "approve")) {
    return "satisfied";
  }

  const anyOf = requirements.anyOf ?? [];
  const allOf = requirements.allOf ?? [];
  const anyOfSatisfied = anyOf.length === 0 || anyOf.some((entry) => itemStatus(entry, decisionsBySigner) === "satisfied");
  const allOfSatisfied = allOf.every((entry) => itemStatus(entry, decisionsBySigner) === "satisfied");
  if (anyOfSatisfied && allOfSatisfied) return "satisfied";

  const anyOfReachable = anyOf.length === 0 || anyOf.some((entry) => itemStatus(entry, decisionsBySigner) !== "unreachable");
  const allOfReachable = allOf.every((entry) => itemStatus(entry, decisionsBySigner) !== "unreachable");
  if (anyOfReachable && allOfReachable) return "pending";

  const pendingApproveOverride = overrides.some((entry) =>
    entry.permissions.includes("approve") && !decisionsBySigner.has(entry.signer));
  return pendingApproveOverride ? "pending" : "unreachable";
}

function immutableDecisionMap(decisions: Iterable<SignerDecision>): Map<Did, Decision> {
  const result = new Map<Did, Decision>();
  for (const entry of decisions) {
    const existing = result.get(entry.signerDid);
    if (existing !== undefined && existing !== entry.decision) {
      throw new Error(`Signer ${entry.signerDid} has conflicting decisions for one Action Envelope.`);
    }
    result.set(entry.signerDid, entry.decision);
  }
  return result;
}

function thresholdStatus(
  requirement: ThresholdRequirement,
  decisions: ReadonlyMap<Did, Decision>,
): ApprovalRequirementsStatus {
  const expected = requirement.decision ?? "approve";
  const eligible = new Set(requirement.eligibleSigners);
  let matching = 0;
  let undecided = 0;
  for (const did of eligible) {
    const decision = decisions.get(did);
    if (decision === expected) matching += 1;
    else if (decision === undefined) undecided += 1;
  }
  if (matching >= requirement.threshold) return "satisfied";
  return matching + undecided >= requirement.threshold ? "pending" : "unreachable";
}

function itemStatus(item: RequirementItem, decisions: ReadonlyMap<Did, Decision>): ApprovalRequirementsStatus {
  if (item.type === "threshold") return thresholdStatus(item, decisions);
  const statuses = item.requirements.map(child => itemStatus(child, decisions));
  if (item.type === "allOf") {
    if (statuses.every(status => status === "satisfied")) return "satisfied";
    return statuses.includes("unreachable") ? "unreachable" : "pending";
  }
  if (statuses.includes("satisfied")) return "satisfied";
  return statuses.every(status => status === "unreachable") ? "unreachable" : "pending";
}

/** Validated shared coordination projection. No signature or trust decisions. */
export function readApprovalRequirements(
  value: unknown,
  decisions: Iterable<SignerDecision> = [],
) {
  const requirements = parseApprovalRequirements(value);
  const thresholds: ThresholdRequirement[] = [];
  const visit = (item: RequirementItem): void => {
    if (item.type === "threshold") {
      if (new Set(item.eligibleSigners).size !== item.eligibleSigners.length || item.threshold > item.eligibleSigners.length) {
        throw new TypeError("Approval thresholds require unique eligible signers and must be achievable");
      }
      thresholds.push(item);
    } else {
      item.requirements.forEach(visit);
    }
  };
  [...requirements.anyOf ?? [], ...requirements.allOf ?? []].forEach(visit);
  const eligibleSigners = [...new Set([
    ...thresholds.flatMap(threshold => threshold.eligibleSigners),
    ...(requirements.overrideSigners ?? []).map(override => override.signer),
  ])];
  const decisionList = [...decisions];
  const bySigner = immutableDecisionMap(decisionList);
  const progress: CoordinationProgress = { pending: eligibleSigners.filter(did => !bySigner.has(did)) };
  if (thresholds.length === 1 && !(requirements.overrideSigners?.length)) {
    const threshold = thresholds[0]!;
    progress.required = threshold.threshold;
    progress.collected = Math.min(
      threshold.threshold,
      threshold.eligibleSigners.filter(did => bySigner.get(did) === (threshold.decision ?? "approve")).length,
    );
  }
  return {
    requirements,
    thresholds,
    eligibleSigners,
    progress,
    status: evaluateApprovalRequirements(requirements, decisionList),
  };
}
