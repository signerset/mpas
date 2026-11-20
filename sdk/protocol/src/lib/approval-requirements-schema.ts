import { z } from "zod";
import type { ApprovalRequirements, Did, RequirementItem } from "../types/mpas.js";

const MAX_DEPTH = 4;
const MAX_THRESHOLDS = 32;
// Every item in a valid tree belongs to a path ending at a threshold. With
// bounded depth and leaves, the entire tree has at most this many items.
const MAX_ITEMS = MAX_DEPTH * MAX_THRESHOLDS;

const did = z.string().regex(/^did:[a-z0-9]+:[^\s]+$/).transform(value => value as Did);
const threshold = z.strictObject({
  type: z.literal("threshold"),
  threshold: z.number().int().min(1),
  eligibleSigners: z.array(did).min(1),
  decision: z.enum(["propose", "approve", "reject", "abstain"]).optional(),
  description: z.string().optional(),
});
const item: z.ZodType<RequirementItem> = z.lazy(() => z.union([
  threshold,
  z.strictObject({
    type: z.enum(["anyOf", "allOf"]),
    requirements: z.array(item).min(1),
    description: z.string().optional(),
  }),
]));
const schema = z.strictObject({
  anyOf: z.array(item).min(1).optional(),
  allOf: z.array(item).min(1).optional(),
  overrideSigners: z.array(z.strictObject({
    signer: did,
    permissions: z.array(z.string().min(1)).min(1),
    description: z.string().optional(),
  })).min(1).optional(),
}).refine(
  value => value.anyOf !== undefined || value.allOf !== undefined || value.overrideSigners !== undefined,
  "At least one approval path is required",
);

/** Bound all traversal, including malformed entries, before recursive parsing. */
export function parseApprovalRequirements(value: unknown): ApprovalRequirements {
  let thresholds = 0;
  let visited = 0;
  const walk = (items: unknown, depth: number): void => {
    if (!Array.isArray(items)) return;
    if (depth > MAX_DEPTH) throw new TypeError("Approval requirements exceed depth 4");
    if (items.length > MAX_THRESHOLDS) throw new TypeError("Approval requirements exceed 32 thresholds");
    for (const entry of items) {
      if (++visited > MAX_ITEMS) throw new TypeError("Approval requirements exceed the traversal limit");
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError("Approval requirement items must be objects");
      }
      if ("requirements" in entry) {
        walk(entry.requirements, depth + 1);
      } else if (++thresholds > MAX_THRESHOLDS) {
        throw new TypeError("Approval requirements exceed 32 thresholds");
      }
    }
  };
  if (value && typeof value === "object") {
    if ("anyOf" in value) walk(value.anyOf, 1);
    if ("allOf" in value) walk(value.allOf, 1);
  }
  return schema.parse(value);
}
