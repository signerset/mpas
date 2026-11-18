# Application Plugin Maintainer Presentation — Feature Record

**Status:** Partially implemented. The plugin schema version 2 format, SDK validation and interpretation, generator skeleton, and Credential Adapter routing exist. The Approval `reviewArtifact` field and the Verifier's check of it, the Verifier's expected-artifact hint, review context, trusted artifact selection in reviewer clients, review records, governed-set change reporting, regeneration reports, and shared conformance fixtures are specified but not implemented. §3 lists each item.

**Created:** 2026-10-28

**Updated:** 2026-11-18

**Affects:** MPAS Core Canonical Approval Payload, MPAS Application Plugin Profile, MPAS Plugin Presentation Profile (new), MCP Execution Profile routing, JSON Verifier Policy Profile scope, protocol SDK, Credential Adapter routing, plugin generation and validation, maintainer/review clients

**Normative output:**

- [MPAS Plugin Presentation Profile](../../../specs/mpas-profile-plugin-presentation.md): the complete reviewer-client contract.
- [MPAS Core Specification](../../../specs/mpas-specification.md) §5.5.5.1 and §5.5.7: the optional `reviewArtifact` member of the signed Approval payload.
- [MPAS Application Plugin Profile](../../../specs/mpas-profile-application-plugin.md) §8.1, §8.2, §13.2, and Appendix A: the `display` and `governedByDefault` properties, the plugin's governance role, and the Verifier's review-artifact check.
- [MCP Execution Profile](../../../specs/mpas-profile-mcp.md) §5 step 2: routing.

This document is the design and implementation record. Where it differs from those profiles, the profiles govern.

## 1. Purpose

Extend the existing application plugin so one declarative JSON artifact serves both:

- operators and Verifiers that configure policy and validate execution payloads;
- human Maintainers who need to understand an Action before approving or rejecting it.

An operator may be highly technical while a Maintainer is not. In a consumer agent companion app, one person may perform both roles and use a simple application-provided approval preset. In an enterprise deployment, separate people may configure policy and review Actions. The same plugin supports both arrangements.

Maintainers need to know which application and environment an Action affects, a readable action name, an explanation of its consequences, understandable parameter names, explanations of enum choices, access to exact submitted values, and links to relevant external context. They should not have to understand native tool identifiers or read a JSON Schema to perform an ordinary review.

The public MPAS deliverable is JSON, a schema, and deterministic interpretation rules. Implementers may build their own renderers. No Swift code, executable plugin, or mandatory hosted rendering service is part of the profiles.

## 2. Decisions and scope

1. **One application plugin.** Retain `MpasApplicationPlugin` and the existing application-plugin profile name. Do not create separate verifier and maintainer plugin identities or duplicate operation catalogs.
2. **One operation definition.** The existing `operations.<operation>` entry owns its payload schema, shared description, impact metadata, governance default, and optional maintainer presentation.
3. **Presentation has its own namespace.** Add `operations.<operation>.display`. This separates display formatting from JSON Schema validation while keeping related information next to the tool it describes.
4. **Reviewer wording replaces generic wording.** Every `title` and `description` inside `display` is the reviewer's version of the generic property with the same name and replaces it for reviewers. A client never shows both (Presentation Profile §5.1).
5. **JSON Schema stays authoritative for payload validation.** Display fields neither redefine payload types nor constrain execution.
6. **Approval policy stays external; the governed set does not.** The plugin does not contain signer groups, thresholds, approval requirements, or recommended policy expressions. But operation membership and `governedByDefault`, with the operations deployment policy names, decide which operations enter policy evaluation. Pass-through skips approval policy, including `defaultRequirement`. Accepting a plugin, or an update, therefore includes accepting its governed set, and update tooling shows changes to it (§4.2).
7. **JSON payloads only.** `display` applies to execution profiles whose payload is a JSON value validated by `executionPayloadSchema`: MCP today, and HTTP APIs with JSON bodies later. It does not describe blockchain transactions (§8).
8. **Blockchains use their own standards.** Ethereum transactions use clear signing (ERC-7730) and similar standards. MPAS does not claim ERC-7730 compatibility.
9. **One immutable trust target.** The artifact covers the schemas and all presentation content together. A wording-only change creates a new artifact, just as a schema change does.
10. **Accepted publisher presentation.** After the operator accepts the publisher and exact artifact using OMATrust evidence, the plugin's titles, descriptions, enum wording, field selection, and link destinations are that developer's presentation of its own operations. Submitted payload values remain data under review (Presentation Profile §13).
11. **Generated explanation slots.** For every operation the generator includes in the plugin, it emits `display` slots for that operation, each named parameter, and each declared enum value. Explanations are left absent for the publisher to write. There is no second presentation catalog.
12. **Described is not the same as governed.** `operations` lists the tools the publisher describes. A described operation is governed by default unless it sets `governedByDefault: false`. Tools the publisher never expects to be governed are left out of `operations` and appear only in `toolSurface.toolNames` (§4.2).
13. **The client owns review context.** The reviewer client shows the application, and the environment or account where configured, prominently with the action title. That context comes from the Action Envelope and trusted deployment configuration, never from the publisher's presentation or the payload (§6).
14. **The plugin is bound to the bridge release and to each Approval.** The developer releases the bridge and plugin together, and the release identifies the plugin artifact and the captured tool specification by `toolSurface.hash`. A reviewer client selects a plugin artifact it trusts through responsibility claims, from any source, and its Approval names that artifact. The Verifier does not count an Approval naming a different artifact from the one it loaded; it ignores only that Approval and evaluates policy with the rest. To help reviewers pick the deployed artifact up front, the Verifier names it in a non-authoritative hint that the Proposer forwards (§5).
15. **One release workflow.** Reviewing explanations is part of regenerating and releasing the bridge and plugin, not a separate process (§9).

In scope are review context, operation summaries, field ordering and titles, expandable help, enum explanations, context links, deterministic fallback behavior, trusted artifact selection and its binding into Approvals, review records, migration requirements, the governed set, and the generator's display skeleton and regeneration reports.

Out of scope are blockchain transaction presentation, wallet implementation, new blockchain execution profiles, transaction simulation, localization catalogs, receipt presentation, arbitrary formulas or scripts, remote data enrichment, a plugin editor implementation, and changes to the Approval signature format. The only Approval change is the optional `reviewArtifact` member of the signed payload.

## 3. Implementation status

| Item | Normative source | Status |
|---|---|---|
| Plugin schema version 2: `display` and `governedByDefault` structure, version 1 rejection | Application Plugin Profile §8, Appendix A | Implemented in the SDK loader, except that it still rejects the empty field path (`""`, the whole payload) that the profile allows |
| Semantic validation and resource limits | Presentation Profile §9, §10 | Implemented in the SDK |
| Interpretation: pointers, formatting, interpolation, remainder, links, fallbacks | Presentation Profile §5–§8, §11 | Implemented in the SDK (`presentOperation`); not yet checked against shared fixtures |
| Missing-explanation and enum-mismatch diagnostics as warnings | Presentation Profile §9.3 | Implemented in the SDK (`displayDiagnostics`) |
| Generator skeleton; preserving operation title, descriptions, interpolated title, links, enum titles, field order, and `governedByDefault: false` | §9 | Implemented |
| Generator preserving publisher-written field titles | §9.2 | **Not implemented**: regeneration replaces a field's title with the schema title |
| Generator reports of changed tool definitions, default governed-set changes, possibly stale explanations, and references made invalid by regeneration | §9.2, Presentation Profile §9.3 | **Not implemented** |
| Credential Adapter routing with `governedByDefault` | Application Plugin Profile §8.2; MCP Profile §5 | Implemented in the CLI. Inactive until the CLI depends on an SDK release that loads version 2 |
| Showing governed-set changes in acceptance tooling, such as the CLI trust prompt | Application Plugin Profile §8.2 | **Not implemented**. Operators today review the plugin file directly or with an assistant; the release report (§9.2) covers that case |
| Client-owned review context | Presentation Profile §4 | **Not implemented**; maintainer clients |
| `reviewArtifact` in the SDK's Approval builder and verifier | Core §5.5.5.1, §5.5.7 | **Not implemented**. The current SDK rejects an Approval payload containing it as an unknown member, which fails closed |
| Verifier check against the loaded plugin (`REVIEW_ARTIFACT_MISMATCH`), reported in `ignoredApprovals` whatever the result, including execution | Application Plugin Profile §13.2 | **Not implemented** in the Credential Adapter. The configured `artifactDid` it compares with is already verified when the plugin loads. The reference SDK fails the whole Approval Bundle when any Approval is invalid; the [approvals update feature record](../approvals-update/spec.md) changes that |
| Expected-artifact hint: `expectedReviewArtifact` from the Credential Adapter, forwarded by the Proposer and Coordination to reviewer clients | Application Plugin Profile §13.2; HTTP Profile §6.4, §7.3, §8.4, §8.5 | **Not implemented** |
| Trusted artifact selection preferring an accepted hinted artifact, pinning, restart, naming the artifact actually used in Approvals, the may-not-count warning, and explicit generic review | Presentation Profile §3 | **Not implemented** in reviewer clients. The Verifier's per-request tool-surface check exists (HTTP Profile §6.3) |
| Review records | Presentation Profile §12 | **Not implemented** |
| Shared conformance fixtures in `conformance/plugin-presentation/` | Presentation Profile §14 | **Not implemented** |

Implementation locations:

- [SDK plugin loader](../../../sdk/protocol/src/lib/plugin-loader.ts) and [interpreter](../../../sdk/protocol/src/lib/plugin-display.ts).
- [SDK public types](../../../sdk/protocol/src/types/mpas.ts).
- [CLI loader facade](../../../cli/src/core/plugin-loader.ts), which re-exports the published SDK package. The CLI accepts version 2 only after it depends on an SDK release that does.
- [Credential Adapter routing](../../../cli/src/adapter/adapter-api-server.ts).
- [Plugin generator](../../../bridge-generator/src/plugin-codegen.ts) and its [regeneration driver](../../../bridge-generator/src/generate.ts).

A version 2 artifact loads only on implementations that support version 2; it MUST NOT be treated as version 1 or stripped of display metadata to make a version 1 loader accept it. Before publishing a version 2 artifact for a deployment, that deployment's Verifier, execution-side plugin consumers, and reviewer clients MUST all support version 2.

## 4. Where display sits

`display` is an optional property of an operation, at `operations.<operation>.display`. The plugin's other properties are defined by the Application Plugin Profile; `display` itself is defined by the Presentation Profile §5 through §8. There is no second list of operations indexed by tool name, so the two cannot disagree during manual editing. The name `display` describes the metadata's purpose, not which role may read it; operators may use the same titles and help.

### 4.1 Why one name per concept

`title` and `description` are the names MCP and JSON Schema already use for an object's human-readable name and explanation. Inside `display` they mean the same thing, for reviewers, and replace the generic version. Earlier drafts used `intent` and `label`; they were renamed so that each `display` property matches the property it replaces.

The generic operation `description` is copied from the upstream MCP tool and replaced on every regeneration. `display.description` is written by the publisher and preserved. That difference in ownership is why both exist.

### 4.2 Described operations and governance

| Kind of tool | In `operations` | `governedByDefault` | `display` |
|---|---|---|---|
| Governed | Yes | Absent or `true` | Recommended |
| Not governed by default, but an operator may choose to govern it | Yes | `false` | Recommended |
| Never expected to be governed | No; only in `toolSurface.toolNames` | Not applicable | None |

An operator may govern any tool on the surface by naming it in policy. A described operation then has payload validation and reviewer explanations; a tool that is not described is reviewed through the generic view. Governance is stated, not inferred from which properties an operation has. The Verifier applies a described operation's schema even when routing it as pass-through.

Pass-through skips approval-policy evaluation, including `defaultRequirement`, but keeps the integrity checks, proposer authorization, the tool-surface check, and schema validation for described operations. Because a plugin update can move an operation in or out of the governed set, the change has to be visible when an operator accepts it (Application Plugin Profile §8.2). Operators today review the plugin file directly or with an assistant, so the generator's release report lists default governed-set changes, which then appear in the `mpas-applications` pull request (§9.2). Acceptance tooling, such as the CLI trust prompt, also shows them where it exists.

## 5. Release binding

### 5.1 Design

The Proposer calls tools through a bridge generated from a captured tool specification. The plugin describes the same specification. If the reviewer client used a different plugin release than the bridge and Verifier, a Maintainer could approve an Action described by wording written for different tools. The Presentation Profile §3 therefore binds them:

- the developer releases the bridge and plugin together, whether or not they control the upstream server;
- the release identifies the plugin by `did:artifact` and the tool specification by `toolSurface.hash`;
- the Verifier already rejects a request whose bridge binding differs from its loaded plugin's surface (HTTP Profile §6.3);
- the reviewer client selects an artifact it trusts through responsibility claims, from any source, pins it for the review, and names it in the Approval's signed `reviewArtifact`;
- the Verifier does not count an Approval that names a different artifact from the one it loaded, still counts the others, and reports `REVIEW_ARTIFACT_MISMATCH`.

The Credential Adapter never communicates with the Maintainer directly, and nothing the Proposer relays is trusted. To avoid a wasted review, the Credential Adapter names its artifact in a non-authoritative `expectedReviewArtifact` hint in its approvals-required responses; the Proposer forwards it through Coordination to reviewer clients. A client that can obtain the hinted artifact from its own configured sources and accepts it uses it rather than the registry's newest release, which matters when a deployment still runs artifact X after the registry lists a newer Y. The hint is unsigned, may be stale, and carries no trust and no download location. The client signs the artifact it actually used, telling the Maintainer the Approval may not count if that is not the hinted one, and the Verifier's check of each Approval remains the enforcement. Generic review of the raw Action is allowed only as an explicit experience the Maintainer recognizes, never as a silent fallback when the hinted artifact fails to load.

An Approval made with a wrong or stale choice does not count at the Verifier. The response lists it with the Verifier's artifact whether or not the Action executes using other Approvals. If the remaining Approvals fall short, the Verifier returns `additionalApprovalsRequired` and the Proposer starts a new Action, whose reviewers approve again with the hint. The same happens when a deployment changes its plugin artifact while Approvals are being collected: that update can require fresh Approvals from every reviewer.

The release record is the application's directory in `mpas-applications`: the bridge, `plugin.json`, and `registry-entry.json`, which the generator writes with the plugin's `artifactDid` and the upstream `toolSurface` hash. This replaces the earlier position that reviewer and Verifier could adopt different version 2 artifact releases on their own schedules.

### 5.2 Limits

Matching identifiers prove agreement on the captured specification, not that explanations describe upstream behavior correctly. An upstream change that leaves schemas untouched can still make an explanation wrong; the developer has to reassess and release again. An Approval signs the artifact identity, not the screen: it records which plugin the reviewer used, not what the client displayed. The guarantee is that an Approval declaring artifact X cannot count when the Verifier uses Y; it does not show that every Approval was made using a plugin, because generic review omits `reviewArtifact`.

Clear signing has the same drift problem. ERC-7730 binds a descriptor to a chain ID and contract address, and for an upgradeable contract to the proxy address. After an upgrade, the developer updates the registry and wallets are expected to fetch the new descriptor; the descriptor carries no code hash, and nothing checks that it matches the deployed code. A changed function signature falls back to a generic view, but changed behavior under the same signature goes unnoticed. A code hash in the descriptor would let a wallet detect an upgrade, but the contract still could not refuse a signature made with the wrong descriptor. MPAS can enforce the match because the Verifier holds the plugin and checks each Approval against it. The gap between the developer and the upstream server remains, as described above.

## 6. Review context

The same title, such as "Merge pull request", can apply to many applications, organizations, and environments. The reviewer client therefore shows, prominently with the title, the application from the Action Envelope's `target.applicationDid` (named from trusted deployment configuration), and environment or account context when that configuration provides it. The Presentation Profile §4 requires the client to keep client-owned context, publisher presentation, and submitted values distinguishable, and to keep exact identifiers accessible, without prescribing a layout.

## 7. Presentation contract

The detailed rendering rules moved to the Presentation Profile, keeping their section numbers where possible:

| Topic | Presentation Profile |
|---|---|
| Information sources | §2 |
| Artifact selection, release binding, pinning, `reviewArtifact` | §3 |
| Review context | §4 |
| Operation display descriptor and replacement rule | §5, §5.1 |
| Field descriptors, pointers, formats, remainder coverage | §6 |
| Interpolated title | §7 |
| Context links | §8 |
| Validation and classes of finding | §9 |
| Resource limits | §10 |
| Rendering versus authorization failures | §11 |
| Review records | §12 |
| Complete illustrative plugin | Appendix A |

Design notes kept here:

- Field paths address payload values, not schema nodes, so one pointer works for display, interpolation, and links.
- The remainder rules make every submitted value visible somewhere, whatever fields the publisher chose.
- Interpolation never substitutes a shortened value, because a summary sentence is read as complete.
- Link substitutions cannot change the template's origin, so the publisher, not the payload, chooses where a link goes.

## 8. Execution profiles

Each plugin continues to target one application DID and one execution profile. `display` applies to profiles whose payload is a JSON value validated by `executionPayloadSchema`: the MCP profile today, and an HTTP profile for APIs with JSON bodies. Such a profile still defines its own operation selection, validation, and hashing; adding `display` does not supply an operation resolver or executor. The current SDK selects operations through the MCP payload's `name`.

Blockchain transactions are out of scope. Their payloads are encoded transactions, and Ethereum wallets use clear signing (ERC-7730). A future blockchain execution profile would define its own review presentation.

## 9. Generation, regeneration, and release

Explanations are reviewed within the one bridge and plugin release workflow:

1. Regenerate the bridge and plugin from the upstream server's captured tool specification.
2. Review the generator's report of changed tool definitions, possibly stale explanations, and invalid references.
3. Update the integration and explanations where needed, including for upstream behavior changes the report cannot see.
4. Validate the plugin. Invalid-artifact errors block release; advisory diagnostics are reviewed (Presentation Profile §9.3).
5. Release the bridge and plugin together, with a new `pluginVersion` and artifact identity.

### 9.1 Generated slots

The generator emits explanation slots inside `operations.<operation>.display`. It does not write a second catalog or draft document for presentation text. For every operation it includes in the plugin, it MUST emit a `display` object:

- `title` is a nonempty readable name taken from the MCP tool's `title` when one exists, and otherwise from the operation name. It names the action; it does not explain consequences.
- `fields` contains one descriptor per named parameter. The generator descends object schemas that declare named properties and emits one field per named leaf. A finite enumeration, a `date` or `date-time` string, an array, and an object without named properties each produce one field for that whole value. The profile's operation selector, such as the MCP payload `name`, does not receive a field.
- Each field `path` is the absolute JSON Pointer of that parameter in the execution payload. Under `mcp.toolsCall`, argument properties use `/arguments/...`.
- A field's `title` is the unambiguous schema `title` when one exists, and otherwise the parameter name.
- A finite schema enum uses `format: "enum"` and one `params.values` entry per allowed scalar, whose `title` is that exact value. A string whose schema format is `date` or `date-time` uses the `date` formatter and the matching `params.type`.
- The generator MUST NOT emit `display.description`, field `description`, enum `description`, `interpolatedTitle`, links, or placeholder sentences. An empty string or TODO token is not an explanation slot.

### 9.2 Regeneration

On regeneration the generator MUST:

- preserve an existing operation `title`, `display.description`, `interpolatedTitle`, `links`, and `governedByDefault: false` when the operation remains;
- preserve each surviving field's publisher-written `title` and `description`, each surviving enum value's `description`, and any enum `title` the publisher changed, along with the publisher's field order. A title that differs from the one the generator would derive from the previous schema is publisher-written;
- add a slot, with no explanation attached, for a new named parameter or enum value;
- remove slots whose parameter or enum value is no longer in the schema;
- add a missing slot back for a named parameter or enum value that is still in the schema, without restoring an explanation the publisher removed.

The generator MUST report:

- each tool whose captured definition changed, comparing the previous and new captured specifications;
- each change to the default governed set: operations added to or removed from `operations`, and `governedByDefault` changes;
- each preserved explanation that may be stale because something it explains changed: an operation's `display.description` or `title` when the tool's schema or upstream description changed; a field's `title` or `description` when that parameter's schema changed; enum titles and descriptions when the enum's allowed values changed;
- each `interpolatedTitle` placeholder or link variable whose referenced field or path no longer exists or is now impossible. These make the plugin invalid; the generator reports them and does not remove or rewrite them.

The generator MUST NOT rewrite explanations automatically. Its reports cover only changes visible in the captured specification; they cannot detect an undocumented change in upstream behavior.

A hand-edited plugin that omits `display`, or omits a parameter from `fields`, remains valid. The remainder rules in Presentation Profile §6.5 still apply, and the next regeneration adds the missing parameter slot back.

### 9.3 Explanation diagnostics

The authoring pass reports every generated operation, field, and enum value that still has no explanation. An operation is explained when `display.description` or the shared operation `description` is present. A field is explained when its `description` or an unambiguous schema `description` is present. An enum value is explained when its `description` is present. These, and the regeneration reports above other than invalid references, are advisory: the loader still accepts the plugin, and missing explanations use the Presentation Profile's fallbacks without changing validation, routing, execution, or policy.

The publisher completes the explanations before release. That publisher may be the application developer, or an operator or agent editing the application plugin. Completed wording is part of the artifact.

## 10. Rollout

1. Publish the Presentation Profile, and the Application Plugin Profile's version 2 contract including `governedByDefault`, the plugin's governance role, and the MCP routing rule.
2. Update both SDK type surfaces and loader support, and preserve version 1 input handling. Done.
3. Publish an SDK release, then a CLI release that depends on it, so the Credential Adapter loads version 2 and applies `governedByDefault`.
4. Add `reviewArtifact` to the SDK's Approval builder and verifier, and the review-artifact check and `expectedReviewArtifact` hint to the Credential Adapter. The check relies on the independent [approvals update](../approvals-update/spec.md) change to ignore only a mismatched Approval. Release them before any reviewer client includes the field, because a Verifier that predates it rejects such Approvals.
5. Add governed-set change reporting to the CLI's plugin acceptance step.
6. Extend the generator with field-title preservation and the regeneration reports in §9.2, and have it validate the plugin it writes.
7. Publish shared fixtures in `conformance/plugin-presentation/` and check the SDK interpreter against them.
8. Implement review context, trusted artifact selection, pinning and restart, `reviewArtifact` in Approvals, and review records in maintainer clients. A proprietary Swift renderer is one implementation, not a new public plugin format.
9. After a deployment's Verifier, execution-side consumers, and reviewer clients support version 2, release migrated bridge and plugin pairs for it in `mpas-applications`, one release per application.
10. An authoring editor may later provide forms, previews, path selection, enum help, link checking, and diffs. Manual editing remains supported, and correctness must not depend on having that editor.

## 11. Acceptance criteria

The implementation is complete when shared fixtures and tests demonstrate:

1. A version 1 plugin retains its previous validation and execution behavior and receives a generic review presentation. A version 2 plugin with no `display` does the same on a version 2 implementation. A version 1 loader rejects version 2 artifacts, including `governedByDefault`.
2. One version 2 plugin is consumed by operator tooling, the Verifier, and a maintainer client without a second operation catalog. Changing display text changes neither routing nor the policy expression for the same accepted payload and deployment policy, though it creates a new artifact identity, so Approvals naming the earlier artifact stop counting once the Verifier uses the new one.
3. The reviewer shows the application, and configured environment or account context, prominently with the title, and keeps client-owned context, publisher presentation, and submitted values distinguishable. Exact identifiers remain accessible.
4. The reviewer uses only an artifact whose bytes match its `did:artifact` and that has a responsibility claim the client trusts, whatever its source. A review pins its artifact; selecting a different one before the reviewer decides restarts the review with a new record. When the review request carries an `expectedReviewArtifact` hint that the client can obtain and accepts, the client uses it rather than the registry's newest release; a hinted artifact it cannot obtain or does not accept is not used. Every Approval given with a plugin names it in `reviewArtifact`, and the Verifier does not count an Approval naming a different artifact from the one it loaded, while still counting the others and reporting `REVIEW_ARTIFACT_MISMATCH` whatever the result, including execution. A mismatched Proposer Approval rejects the Action Package. A client that uses an artifact other than the hinted one tells the Maintainer the Approval may not count and still signs the artifact it used. Generic review is an explicit experience, never a silent fallback. When the deployment runs artifact X and the registry lists a newer Y, a client that accepts the hinted X uses X. A plugin change during review leads to a new Action with fresh Approvals when the remaining Approvals fall short. Matching `pluginVersion`, plugin schema version, or protocol version alone is never treated as compatibility.
5. The illustrative plugin shows the readable title, a reviewer description that replaces the operation description, ordered field titles, the exact commit identifier, enum titles and per-value help, a correctly encoded pull request link, and an operation that is not governed by default.
6. Interpolation uses declared payload paths and the same enum formatting as details. Missing inputs disable the interpolated summary rather than producing a misleading sentence. A client that shortens a value in its field view still substitutes the complete formatted value or omits the summary. Payload markup and braces are displayed as data.
7. Values including missing, null, false, zero, empty strings, escaped pointer names, nested arrays, large numeric strings, and type-distinct enum values behave deterministically. No implementation authorizes a rounded numeric interpretation. Date-time conversion across offsets, including one that changes the calendar day, displays the original string alongside the converted value.
8. Unlisted payload fields and complete arrays remain accessible. Parent-only, child-only, and parent-plus-child fixtures produce exactly the remainder defined in Presentation Profile §6.5. Unsupported presentation does not hide data, and unsupported execution profiles are not presented as understood.
9. Payload values cannot change the accepted presentation's structure. Prototype-like property names are resolved as ordinary own JSON members. Duplicate paths, provably impossible paths, invalid templates, undeclared references, unknown keys, and resource overruns are invalid-artifact errors; missing explanations and enum mismatches are advisory; neither is reported as an authorization outcome.
10. Link values containing `/`, `?`, `#`, `&`, percent signs, Unicode, control characters, and dot segments cannot change the literal destination origin or inject URL structure. Empty strings, `.` and `..` disable the link; integer zero remains a legitimate substitution. No link causes a request before user interaction.
11. An operation with `governedByDefault: false` is routed as pass-through when no policy names it, is governed with its schema when policy names it, and has an invalid payload rejected either way. Accepting a plugin update that changes the effective governed set shows that change to the operator.
12. A plugin update, including a wording-only update, changes the artifact identity and publisher release. Review records retain the identifying tuple. They do not claim the Approval signature covers the screen; it covers only the artifact identity named in `reviewArtifact`.
13. The generator emits a `display` skeleton for every operation it includes, with titles from schema titles or raw names and no fabricated descriptions, interpolated titles, links, or placeholder sentences. Regeneration preserves publisher-written field titles and explanations, adds and removes slots as the schema changes, reports changed tool definitions, default governed-set changes, and possibly stale explanations, reports invalid references without rewriting them, and lists what still has no explanation.

## 12. Decisions and open questions

Decided:

1. **How a reviewer client chooses the artifact.** It may fetch plugin artifacts from any source and uses one whose bytes match its `did:artifact` and that has a responsibility claim it trusts. The Verifier's `expectedReviewArtifact` hint, forwarded by the Proposer, tells it which artifact the deployment uses; the client prefers that artifact when it can obtain and accept it. Its Approval names the artifact it actually used in `reviewArtifact`, and the Verifier does not count a mismatched Approval. Nothing the Proposer relays is trusted, and the Credential Adapter never communicates with the Maintainer directly.
2. **Approvals given with a different release.** An Approval counts only if the Verifier uses the artifact it names. The Verifier ignores only a mismatched Approval, not the Action, and evaluates policy with the rest. If they meet policy, the Action executes. Otherwise the Verifier returns `additionalApprovalsRequired`, and the Proposer starts a new Action whose reviewers approve again with the hint (Core §6.7.3). Reusing the same Action with corrected Approvals was considered and deferred; see the [approvals update feature record](../approvals-update/spec.md) §7.
3. **Release record.** The application's directory in `mpas-applications` is the release: bridge, `plugin.json`, and `registry-entry.json` with the plugin `artifactDid` and tool-surface hash.
4. **Governed-set changes.** Operators review the plugin file directly or with an assistant, so the generator's release report lists default governed-set changes for the pull request. Acceptance tooling shows them as well where it exists. Maintainers are not involved: an operation that is not governed never reaches them.

No questions are open.

## 13. Deferred extensions

Future work may add localization, reusable display definitions, array iteration and grouping, exact-unit amount formatting, authenticated simulation or enrichment, profile-defined review views for opaque payloads, cryptographic binding of review records, a deployment option that requires `reviewArtifact` on Approvals for governed operations, and an authoring editor. Each requires explicit semantics and versioning; none is inherited from ERC-7730 or enabled by additional JSON properties.

## 14. References

- [MPAS Plugin Presentation Profile](../../../specs/mpas-profile-plugin-presentation.md)
- [MPAS Application Plugin Profile](../../../specs/mpas-profile-application-plugin.md)
- [MPAS MCP Execution Profile](../../../specs/mpas-profile-mcp.md)
- [MPAS JSON Verifier Policy Profile](../../../specs/mpas-profile-policy-json.md)
- [MPAS HTTP Profile](../../../specs/mpas-profile-http.md)
- [MPAS Core Specification](../../../specs/mpas-specification.md)
- [OMATrust integration](../omatrust/spec.md)
- [RFC 6901 — JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901)
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [ERC-7730 — presentation vocabulary considered during design](https://eips.ethereum.org/EIPS/eip-7730)
