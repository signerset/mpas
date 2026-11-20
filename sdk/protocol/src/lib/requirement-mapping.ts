import type { PolicyConfig, Requirement } from "./policy-engine.js";
import type { ApprovalRequirements, RequirementGroup, RequirementItem } from "../types/mpas.js";
import { parseApprovalRequirements } from "./approval-requirements-schema.js";

/** Complete policy expression; null represents the already-required proposer signature. */
export function mapPolicyRequirements(
  requirement: Requirement,
  policy: Pick<PolicyConfig, "signerGroups">,
): ApprovalRequirements | null {
  const convert = (requirement: Requirement, depth = 0): RequirementItem | null => {
    if (depth > 64) throw new TypeError("Policy requirement nesting exceeds the analysis limit");
    if (requirement.type === "proposerOnly") return null;
    if (requirement.type === "threshold") {
      return {
        type: "threshold",
        threshold: requirement.threshold,
        eligibleSigners: [
          ...(requirement.eligibleSigners ?? policy.signerGroups?.[requirement.eligibleSignerGroup ?? "all"] ?? []),
        ],
        decision: requirement.decision ?? "approve",
        ...(requirement.description ? { description: requirement.description } : {}),
      };
    }
    const children = requirement.requirements.map(child => convert(child, depth + 1));
    if (requirement.type === "anyOf" && children.includes(null)) return null;
    const items = children
      .filter((child): child is RequirementItem => child !== null)
      .flatMap(child => child.type === requirement.type ? child.requirements : [child]);
    if (!items.length) return null;
    return items.length === 1 ? items[0]! : { type: requirement.type, requirements: items };
  };

  const root = convert(requirement);
  if (!root) return null;
  if (root.type === "threshold") return parseApprovalRequirements({ anyOf: [root] });

  let result: ApprovalRequirements = { [root.type]: root.requirements };
  // Preserve the existing flat representation when there is just one OR list.
  if (root.type === "allOf") {
    const choices = root.requirements.filter((item): item is RequirementGroup => item.type === "anyOf");
    const fixed = root.requirements.filter(item => item.type === "threshold");
    if (choices.length === 1 && fixed.length + 1 === root.requirements.length &&
        choices[0]!.requirements.every(item => item.type === "threshold")) {
      result = {
        anyOf: choices[0]!.requirements,
        ...(fixed.length ? { allOf: fixed } : {}),
      };
    }
  }
  return parseApprovalRequirements(result);
}
