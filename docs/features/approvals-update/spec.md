# Approvals Update — Feature Record

**Status:** Implemented in the MPAS working tree, not released. The separate coordination-server and maintainer-app repos remain deferred. Legacy builder inputs containing only unmet requirements remain deprecated; producers use the complete `approvalRequirements` returned by policy evaluation.

**Created:** 2026-11-18

**Updated:** 2026-11-18

**Affects:** MPAS Core Approval verification and Authorization Requirements, HTTP Profile `ActionResponse` and Coordination Service rules, JSON Verifier Policy Profile, MCP Proposer Bridge Client Profile, protocol SDK, Credential Adapter, Coordination Service, proposer bridges, maintainer clients

**Normative output:**

- [MPAS Core Specification](../../../specs/mpas-specification.md):
  - §5.5.7, §5.6.4, §6.2.2 Step 9, §6.2.3, §6.9.2: ignoring and reporting an Approval that fails verification, and the rules that still reject.
  - §5.8.1, §5.8.5, Appendix A: complete requirements, requirement groups, recursive evaluation, and limits.
- [MPAS HTTP Profile](../../../specs/mpas-profile-http.md) §6.4 and §6.4.3 (`ignoredApprovals`), and §8.4–§8.6 (Coordination Service validation, eligible signers, and progress).
- [JSON Verifier Policy Profile](../../../specs/mpas-profile-policy-json.md) §5.5.5, §6.5, §7.7, §9.9: counting verified Approvals, load-time limits, and mapping policy to requirements.
- [MCP Proposer Bridge Client Profile](../../../specs/mpas-profile-mcp-proposer-bridge-client.md) §5: `requirements` in Task metadata.

This record covers two related changes to how Approvals are handled: approval filtering (§3) and approval requirements (§4). Both apply to every deployment. Filtering is motivated by the plugin review binding in the [plugin maintainer feature record](../plugin-maintainer/spec.md). Where this document differs from the specifications, the specifications govern.

## 1. Purpose

- **Filtering.** One unusable Approval should not sink an Action that the other Approvals already satisfy. Examples: a Maintainer who reviewed with a different plugin artifact from the Credential Adapter's, a Signer who has since been removed from the trusted set, an Approval that expired while others were collected, or one with a bad signature.
- **Requirements.** When an Action needs more approvals, the Verifier returns Authorization Requirements. The Proposer passes them to the Coordination Service, which uses them to decide which Maintainers to ask and when the Action is ready to submit. Maintainer clients and MCP clients also read them. If they describe the policy wrongly, Coordination asks the wrong people or declares readiness too early, and the Verifier then refuses the Action. Nothing executes without the real policy being met, but Actions stall or loop.

## 2. Behavior changes

SDK and CLI release notes, and any announcement to operators, must state these changes.

1. **A failed Approval no longer rejects the Action.**
   - *Before:* the reference SDK, and so the CLI Credential Adapter, rejected the whole Action Package when any one Approval failed verification: a bad signature, an untrusted signer, an Approval outside its time window, or a mismatch between its top-level fields and signed payload.
   - *After:* the Verifier ignores that Approval and evaluates policy with the rest. **An Action that was rejected before can now execute** when the Approvals that pass verification satisfy policy.
   - Every ignored Approval is listed in `ignoredApprovals`, with its position, stated Signer, and a reason code, whatever the result, including execution. The codes `INVALID_SIGNATURE`, `UNTRUSTED_SIGNER`, `APPROVAL_PAYLOAD_MISMATCH`, and `APPROVAL_TIME_INVALID` move from `rejected` responses to `ignoredApprovals` entries, so tooling that alerts on those rejection codes needs updating. The plugin binding adds `REVIEW_ARTIFACT_MISMATCH`.
2. **Authorization Requirements are complete and keep their structure.** They describe the whole applicable requirement, including parts the submitted Approvals already meet, and keep "all of" and "any of" as the policy states them. A Proposer collecting Approvals for a new Action now collects everything it needs.
3. **Requirements can contain nested groups.** Readers that have not been upgraded reject them. Deployments must upgrade readers before using policies that need groups (§6).

## 3. Approval filtering

Filtering applies only to individual Approvals that fail verification. It changes nothing else:

1. **The Proposer's Approval must still verify.** A Proposer Approval that fails verification, including one with a mismatched `reviewArtifact`, rejects the Action Package.
2. **Structural failures remain failures.** An Approval Bundle whose hash does not match the Action Envelope, or that contains an Approval for a different Action Envelope, is malformed.
3. **Verified decisions keep their policy semantics.** Verified decisions that block, conflict, or override under the applicable policy, including contradictory verified decisions from one Signer, are evaluated as before. A verified Approval that simply does not count toward a threshold has not failed verification. Neither is an ignored Approval.
4. **Ignored Approvals are always reported**, including when the Action succeeds.
5. **The Action lifecycle is unchanged.** When the counted Approvals fall short, the Verifier returns `additionalApprovalsRequired` with the complete requirement (§4), and the Proposer retires the Action ID and starts a new Action (Core §6.7.3). The separate rules for transport retries and `503 timeout`, `policyUnavailable`, a submission joining an executing dispatch, and uncertain outcomes (`indeterminate`) are unchanged. In particular, an uncertain outcome never triggers an automatic new Action that could duplicate an execution.

## 4. Approval requirements

### 4.1 Problems found

1. **"All of" advertised as "any of".** When several thresholds were all required and more than one was unmet, the requirements said any one would do. Coordination marked the workflow ready after one; the Verifier refused.
2. **Only the first "any of" option.** When a policy offered alternatives, only the first was advertised, so the others were never asked.
3. **Only the unmet part.** The requirements described what the submitted Approvals left unmet. A shortfall leads to a new Action, which needs every Approval again, so the Proposer collected too few and could be refused repeatedly. This affects a single threshold too: with "3 of the maintainers" and 2 approvals, "1 more" was advertised.
4. **No nesting.** The format allowed only plain thresholds inside one `anyOf` list and one `allOf` list. Policies whose alternatives each need several thresholds, or that combine independent choices, could not be described. Combining matching policy entries produces such shapes even when each entry is simple, for example (2 maintainers or 1 admin) and (1 security reviewer or 1 platform lead).

### 4.2 Decisions

1. **Complete requirements.** The Verifier describes the full applicable requirement, including parts the submitted Approvals already meet (Core §5.8.1).
2. **Requirement groups.** Items in `anyOf` and `allOf` may be nested `anyOf` or `allOf` groups, mirroring the policy language (Core §5.8.5).
3. **Limits.** At most four levels of arrays and 32 thresholds. Producers never exceed them; every reader rejects anything beyond them before evaluating it. The policy loader refuses policies whose combined requirements could exceed them. The format reaches Coordination from the Proposer, so readers must treat it as untrusted input.
4. **Recursive semantics.** The existing AND/OR semantics apply at every level, to both whether the requirements are satisfied and whether they remain achievable with the undecided eligible Signers. With both top-level lists present, at least one `anyOf` item and every `allOf` item must hold. Override Signer behavior is unchanged, and override Signers are eligible signers for Coordination.
5. **Groups only when needed.** Requirements that can be expressed without groups keep today's form and work with readers that have not been upgraded. What counts is the final combined requirement, not each policy entry: two flat entries that each offer alternatives combine into a requirement that needs groups.
6. **One shared reader.** TypeScript components use one SDK function to parse, check limits, find eligible Signers, and evaluate readiness, so a later change is an SDK upgrade for them. Implementations in other languages, such as the Swift maintainer app, follow the same specification.
7. **`proposerOnly` simplifies the expression.** It means no approvals beyond the Proposer's required one. In `allOf` it adds nothing; in `anyOf` it satisfies the whole group; the simplification propagates outward. `(proposerOnly or A) and B` advertises only B. Requirements met by other Approvals already in the bundle are never simplified away.
8. **Progress counts only for a single threshold.** For composite requirements, Coordination may omit the aggregate counts and must not present one branch's counts as overall progress. A per-group progress format is deferred.

Out of scope: a Signer in two groups can count toward both thresholds, flat or nested. Separation of duties would be a separate policy feature.

## 5. Implementation status

| Item | Normative source | Status |
|---|---|---|
| Ignore an Approval that fails verification instead of failing the bundle, within the §3 bounds | Core §5.5.7, §5.6.4, §6.2.2 | Implemented in SDK verification; proposer and structural failures remain fatal. |
| `ignoredApprovals` in every response where an Approval was ignored | Core §6.2.3; HTTP §6.4, §6.4.3 | Implemented in SDK types and Credential Adapter responses, including execution. |
| `REVIEW_ARTIFACT_MISMATCH` entries | Application Plugin Profile §13.2 | Implemented against the loaded deployment artifact. |
| Verifier evaluation of nested policies | JSON Verifier Policy Profile §5.5 | Implemented: the policy engine evaluates `allOf` and `anyOf` trees |
| `proposerOnly` simplification when building requirements | Policy Profile §7.7 | Implemented when mapping the complete combined policy. |
| Advertising "all of" as `allOf` and every "any of" option | Core §5.8.5; Policy Profile §7.7 | Implemented; the CLI supplies the complete requirement object. |
| Complete requirements instead of the unmet part | Core §5.8.1; Policy Profile §7.7 | Implemented, with regression checks retaining already-satisfied branches. |
| Requirement groups in the SDK types, builder, and structural validator | Core §5.8.5, Appendix A | Implemented in SDK types, builder, and bounded structural parser. |
| Limits in the policy loader and in every reader | Core §5.8.5; Policy Profile §5.5.5 | Implemented in policy loading and shared MPAS requirement readers; other repositories still need the upgraded SDK. |
| Shared SDK reader for readiness, recursive achievability, and eligible Signers | Core §5.8.5 | Implemented by `readApprovalRequirements`, including eligible signers, readiness, and progress. |
| Coordination Service: groups, limits, override Signers as eligible signers, composite `progress` | HTTP Profile §8.4–§8.6 | Implemented in the MPAS local service. The separate `mpas-coordination-server` repo remains deferred. |
| Proposer bridge Task metadata | MCP Proposer Bridge Client Profile §5 | Implemented through shared parsing and SDK types. |
| iOS maintainer app | Core §5.8.5 | **Not implemented**. `ApprovalRequirements` in `MPASCore/WireModels.swift` accepts flat lists only and rejects other keys |

## 6. Rollout

1. Release the SDK with filtering, `ignoredApprovals`, requirement groups, limits, the shared reader, and complete requirements, then a CLI release that depends on it. Put the §2 text in both release notes, and update any monitoring that alerts on the moved rejection codes.
2. Upgrade the requirement readers: the Coordination Service, the bridge, and maintainer clients, including the Swift decoder.
3. Upgrade Credential Adapters. Requirements that can be expressed without groups keep the same form as before, so the adapter can ship before every reader is upgraded.
4. Only then deploy policies whose combined requirements need groups, including combinations of entries that each look flat. A reader that has not been upgraded rejects a grouped requirement, for example by refusing to create the workflow, which fails safe but blocks that Action.

Proposers need no change for filtering: a shortfall still returns `additionalApprovalsRequired`, and `ignoredApprovals` is an added field that clients ignore if they do not use it.

## 7. Deferred: same-Action resubmission

Reusing the same Action ID with a corrected Approval Bundle was specified and then withdrawn. It would have required a new `approvalsInsufficient` result, an Action Package hash in responses, relay submission keys and supersession rules, and Coordination Service approval replacement, decision changes, and workflow reopening.

The expected-plugin hint (HTTP Profile §6.4, Plugin Presentation Profile §3.2) should prevent ordinary plugin version mismatches before a Maintainer decides, so a fresh Action is the recovery path for the remaining cases. This deliberately gives up incremental recovery for every shortfall, not only plugin mismatches: expired Approvals, removed Signers, changed policy, and a deployment that changes its plugin during review all require fresh Approvals on a new Action.

Revisit this only if usage shows that restarting approval collection is a significant problem. The withdrawn design was never committed; its main parts are listed above.

## 8. Conformance scenarios

These are the intended shared conformance scenarios. Current coverage is in SDK and CLI unit/integration tests, not a shared language-neutral fixture set. §5 describes the implementation status.

**Filtering**

1. One Approval fails verification, and the others satisfy policy: the Action executes, and `ignoredApprovals` lists the failed Approval.
2. A `REVIEW_ARTIFACT_MISMATCH` Approval alongside enough matching Approvals: the Action executes, and the response carries the mismatch entry with the Credential Adapter's `reviewArtifact`.
3. Ignored Approvals leave the counted Approvals short: `additionalApprovalsRequired`, with `ignoredApprovals`, and no ledger entry.
4. A Proposer Approval that fails verification, including one with a mismatched `reviewArtifact`: the Action Package is rejected.
5. A bundle containing an Approval for a different Action Envelope: malformed.
6. Contradictory verified decisions from one Signer: treated as policy defines (the reference SDK rejects with `CONFLICTING_SIGNER_DECISIONS`).
7. A verified Approval from a Signer outside every threshold: not counted and not listed in `ignoredApprovals`.
8. An `indeterminate` outcome: the Proposer does not start a new Action automatically.

**Requirements**

9. Two required thresholds, both unmet: `allOf` with both.
10. Two alternatives, neither met: `anyOf` with both.
11. "3 of the maintainers" with 2 valid Approvals in the bundle: the requirement advertises 3.
12. Two matching entries, one already met by the bundle: both are advertised, combined with `allOf`.
13. "(2 engineers and 1 security reviewer) or 2 of 3 directors": `anyOf` with an `allOf` group and a threshold.
14. "(2 maintainers or 1 admin) and (1 security reviewer or 1 platform lead)": `allOf` with two `anyOf` groups. Coordination asks every listed Signer and becomes ready on any valid combination.
15. A single threshold: a one-item `anyOf`, unchanged from today.
16. `(proposerOnly or A) and B`: the requirement advertises only B, never A and B.
17. A policy whose combined requirement would need depth 5, or 33 thresholds: refused at load.
18. A Proposer-supplied requirement with depth 5, or 33 thresholds: the Coordination Service rejects it before evaluating it, and maintainer and MCP clients reject it.
19. Two policy entries, each a flat "any of", match together: the combined requirement needs groups, and a reader that has not been upgraded rejects it.

**Coordination and clients**

20. "(2 engineers and 1 security reviewer) or 2 of 3 directors", where two security reviewers have rejected so the first alternative is unachievable, while the directors are undecided: Coordination stays `awaitingApprovals`.
21. An override Signer listed only in `overrideSigners` receives an Approval Request and appears in `progress.pending` until it decides.
22. Composite requirements: `progress` carries `pending` and may omit `required` and `collected`; it never reports one branch's counts as overall progress. A single threshold keeps all three.
23. A maintainer client finds the Maintainer's DID in a threshold inside a group.

Plugin-specific scenarios, including the hint, are in the [plugin maintainer feature record](../plugin-maintainer/spec.md) §11.

## 9. Open questions

None. A per-group progress format is deferred (§4.2, decision 8).

## 10. References

- [MPAS Core Specification](../../../specs/mpas-specification.md)
- [MPAS HTTP Profile](../../../specs/mpas-profile-http.md)
- [JSON Verifier Policy Profile](../../../specs/mpas-profile-policy-json.md)
- [MCP Proposer Bridge Client Profile](../../../specs/mpas-profile-mcp-proposer-bridge-client.md)
- [Application Plugin Profile](../../../specs/mpas-profile-application-plugin.md)
- [Plugin Presentation Profile](../../../specs/mpas-profile-plugin-presentation.md)
- [Plugin maintainer feature record](../plugin-maintainer/spec.md)
