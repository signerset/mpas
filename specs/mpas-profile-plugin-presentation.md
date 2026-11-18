# MPAS Plugin Presentation Profile

**Status:** Draft v0.1. Parts are implemented in the reference SDK; see the [feature record](../docs/features/plugin-maintainer/spec.md) §3 for what is implemented and what is newly specified.
**Depends on:** [MPAS Core Specification v0.4](./mpas-specification.md), [MPAS Application Plugin Profile v0.2](./mpas-profile-application-plugin.md) (plugin schema version 2), [MPAS HTTP Profile](./mpas-profile-http.md) §6.3
**Related:** [MPAS MCP Execution Profile](./mpas-profile-mcp.md), [MPAS JSON Verifier Policy Profile](./mpas-profile-policy-json.md)
**Feature record:** [Application Plugin Maintainer Presentation](../docs/features/plugin-maintainer/spec.md)

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** are to be interpreted as described in RFC 2119 and RFC 8174.

---

## 1. Purpose and scope

This profile defines how a reviewer client presents an Action to a Maintainer using an Application Plugin's `display` metadata. A reviewer client is any client that shows a pending Action to a person deciding whether to approve it. An independent client is implementable from this profile, the Application Plugin Profile, and the shared fixtures (§14).

It covers which plugin artifact to use, client-owned review context, the `display` descriptor, payload pointers, formatting, interpolation, coverage of values not explicitly displayed, links, fallbacks, validation, resource limits, and review records.

It applies to execution profiles whose payload is a JSON value validated by an operation's `executionPayloadSchema`, such as the MCP Execution Profile. Blockchain transactions are out of scope; they use their own presentation standards, such as ERC-7730 for Ethereum.

It does not define screen layout, navigation, approve-button placement, approval policy, or a signing format. Approvals sign the Action Envelope as defined by MPAS Core and name the plugin artifact used for the review (§3.5).

## 2. Information sources

A review combines three sources. They differ in who supplied them and how far they are trusted, and a client MUST keep them distinguishable (§4):

| Source | Supplied by | Examples | Treatment |
|---|---|---|---|
| Client-owned context | The Action Envelope and the client's trusted deployment configuration | Application name and DID, environment or account, operation identifier, expiry, artifact identity | Shown by the client; never taken from the plugin's presentation or the payload |
| Publisher presentation | The accepted plugin artifact | `display` titles, descriptions, enum titles, field selection and order, link templates | The accepted publisher's wording, rendered within this profile's declarative rules |
| Submitted values | The Execution Payload bound to the Action Envelope | Field values, link variable values, interpolation substitutions | Data under review; never interpreted as markup, templates, or presentation |

## 3. Artifact selection and release binding

### 3.1 Identifiers

Several identifiers describe a plugin and its bridge. They answer different questions, and matching labels alone do not establish compatibility.

| Identifier | Location | Identifies |
|---|---|---|
| Publisher release, such as `pluginVersion` or a bridge release tag | Plugin; publisher release notes | The publisher's label for a release. It is a label, not an identity. |
| Plugin schema version (`version`) | Plugin | The plugin document format, `"1"` or `"2"`. |
| MCP protocol version (`executionProfile.protocolVersion`) | Plugin | The protocol version used with the upstream server. |
| Tool-surface hash (`toolSurface.hash`) | Plugin; bridge binding (HTTP Profile §6.3) | The exact captured tool definitions (Application Plugin Profile §6.3). |
| Plugin artifact identity (`did:artifact`) | External to the plugin: release records, deployment configuration, responsibility claims, and the `reviewArtifact` of Approvals | The exact plugin bytes (Application Plugin Profile §6.5). |

Compatibility between a plugin and a bridge is established by the tool-surface hash. Agreement between a reviewer and the Verifier on the plugin is established by artifact identity: the reviewer's Approval names it, and the Verifier compares it with the plugin it loaded.

### 3.2 Release model

1. **The bridge and plugin are released together.** The developer who publishes the plugin releases it together with the bridge generated from the same captured tool specification, whether or not that developer controls the upstream MCP server.
2. **A release identifies its exact parts.** A release identifies the plugin artifact by `did:artifact`, and the captured tool specification by `toolSurface.hash`. The plugin's `toolSurface.hash` and the bridge's generation-time binding MUST be the same value. The release record is the registry entry published with the bridge and plugin; in the reference application registry, `mpas-applications`, that is the application's directory, whose `registry-entry.json` records the plugin `artifactDid` and the tool-surface hash.
3. **The Verifier checks the pairing per request.** The Verifier compares each request's bridge binding with the loaded plugin's tool surface and rejects a mismatch (HTTP Profile §6.3).
4. **The reviewer client selects a trusted artifact.** A client MAY obtain plugin artifacts from any source, such as an application registry like `mpas-applications`, the publisher's release, or a reference relayed with a review request or a Verifier response. The source confers no trust. Before using an artifact, the client MUST verify its bytes against its `did:artifact`, MUST accept it only if the client's trust policy accepts at least one responsibility claim for that `did:artifact`, as an operator does when accepting a plugin, and MUST verify that the plugin's application DID and execution profile match the Action Envelope (Application Plugin Profile §13.2). When the review request carries an `expectedReviewArtifact` hint (HTTP Profile §7.3), the client SHOULD use the hinted artifact if it can obtain it from its configured sources and accepts it under this item, rather than the registry's newest release. Otherwise, when several trusted artifacts apply, the client SHOULD use the one the application registry currently lists for the Action's application DID. The hint is unsigned and may be stale or wrongly forwarded. It carries neither trust nor a download location, and a hinted artifact the client cannot obtain or does not accept is not used. A proposer-supplied display descriptor or rendered summary is never authoritative.
5. **The Approval names the artifact.** A client that presents an Action with a plugin artifact MUST set the Approval's signed `reviewArtifact` to the `did:artifact` it actually used (Core §5.5.5.1). If that differs from the hinted artifact, the client SHOULD tell the Maintainer that the Approval may not count. It still signs the artifact it used; the hint does not decide which artifact counts.
6. **The Verifier enforces the match.** An Approval naming a different artifact from the Verifier's does not count (Application Plugin Profile §13.2).
7. **Generic review.** If the client cannot find or accept an artifact, including the hinted one, it MUST NOT present publisher wording as accepted presentation. It MAY offer generic review of the raw payload when local policy permits, as an explicit experience: the Maintainer can see that they are reviewing the raw Action rather than a plugin's explanations. An Approval from generic review omits `reviewArtifact`. A client MUST NOT fall back to generic review silently because the hinted artifact failed to load, and MUST NOT display an artifact's explanations while omitting that artifact's identity from the Approval.

### 3.3 Pinning during review

A client MUST pin the selected artifact when a review starts, and MUST NOT change a pending review's text, field selection, or schema silently.

If the client selects a different artifact before the reviewer decides, for example because the registry lists a newer release, it MUST restart the review under that artifact with a new review record (§12). If the new artifact no longer describes the operation, or the payload no longer satisfies its schema, the restarted review shows that.

Once the reviewer decides, the Approval names the artifact used. If that is not the Verifier's artifact, the Approval does not count, and a shortfall restarts the Action as a new Action that every reviewer approves again (Application Plugin Profile §13.2).

### 3.4 Developer responsibility

Matching identifiers show only that the bridge, plugin, and Verifier agree on the same captured tool specification. They do not show that the plugin's explanations accurately describe the upstream server's behavior. The developer remains responsible for that. When upstream behavior changes, including changes that leave tool schemas and descriptions unchanged, the developer MUST reassess the integration and its explanations and issue a new release where needed. Tooling cannot detect an undocumented semantic change.

### 3.5 What Approvals cover

An MPAS Approval signs the Action Envelope hash and, when present, the `reviewArtifact` the reviewer used (Core §5.5.5.1). It does not sign the renderer, the precise screen shown to a person, or the review record. What the artifact comparison guarantees is defined in the Application Plugin Profile §13.2.

## 4. Review context

Review context is client-owned. The client obtains it from the Action Envelope and trusted deployment configuration, not from the plugin's presentation or the payload.

1. The client MUST display the application prominently alongside the action title. It uses the application name from trusted deployment configuration for `actionEnvelope.target.applicationDid`, or the DID itself when no name is configured. A target `resource`, when present, is shown with it.
2. When trusted configuration provides environment or account context, such as a production environment or the organization or account the deployment's credential acts for, the client SHOULD display it with the application. It MUST NOT derive this context from publisher presentation or submitted values.
3. The client MUST make it possible to tell client-owned context, publisher presentation, and submitted values apart (§2). How it does so, through labels, grouping, or styling, is the client's choice.
4. The client MUST keep exact identifiers accessible: the application DID, native operation identifier, execution profile, Action Envelope hash, expiry, plugin `did:artifact`, and `pluginVersion`.

This profile does not prescribe a layout.

## 5. Operation display descriptor

If `display` is present, it MUST be an object with `title` and `fields`. Unknown properties are rejected by the version 2 structural schema.

| Field | Required | Definition |
|---|---|---|
| `title` | Yes | Nonempty plain-text phrase saying what the action does, such as `Merge pull request`. This is the readable tool name. |
| `description` | No | Plain-text review guidance: what the operation does, what to check, and its consequences. Replaces the operation's `description` for reviewers (§5.1). May be displayed behind a details/help control. |
| `interpolatedTitle` | No | Plain-text summary template populated from declared payload fields (§7). |
| `fields` | Yes | Ordered array of field descriptors (§6). An empty array is valid for a zero-argument operation. It is not permission to suppress submitted data. |
| `links` | No | Ordered array of optional context links (§8). |

Clients SHOULD show the title and useful parameter values first, with longer explanations available on demand. They MUST make the exact native operation identifier accessible. The profile does not prescribe a popup, screen layout, navigation framework, or approve-button placement.

### 5.1 Reviewer wording replaces generic wording

Inside `display`, `title` and `description` mean the same thing at every level: the reviewer's name for, and explanation of, the object that holds them. Each replaces, for reviewers, the generic property of the same name. A client MUST show one or the other, not both.

| `display` property | Replaces, for reviewers |
|---|---|
| `title` | The native operation identifier. |
| `description` | The operation's `description` (Application Plugin Profile §8). |
| `fields[].title` | The schema property's `title`. |
| `fields[].description` | The schema property's `description`. |
| `values[].title`, `values[].description` | The raw enum value. |
| `links[].title`, `links[].description` | Nothing; links exist only in `display`. |

When a `display` property is absent, the client uses the generic one. Field fallback order is in §6.1. When an operation has no `display`, the client uses the native operation identifier as the title, the operation's `description`, and a generic view of the payload.

## 6. Field descriptors

### 6.1 Fields and references

| Field | Required | Definition |
|---|---|---|
| `path` | Yes | Absolute RFC 6901 JSON Pointer into the exact execution payload. |
| `title` | No | Nonempty plain-text parameter name. Replaces the schema property's `title` for reviewers. |
| `description` | No | Expanded explanation of the parameter and what the Maintainer should examine. Replaces the schema property's `description` for reviewers. |
| `format` | No | `raw`, `enum`, or `date`. Defaults to `raw`. |
| `params` | Conditional | Formatter-specific options defined below. |

Paths identify **payload values**, not nodes in `executionPayloadSchema`. For example, `/arguments/pullNumber` selects the submitted pull request number; it is not `/properties/arguments/properties/pullNumber`.

JSON Pointer escaping applies (`~0` for `~`, `~1` for `/`). URI-fragment pointers, relative pointers, wildcards, expressions, and executable selectors are not supported. Array positions use canonical nonnegative decimal indexes; `-` is not an array lookup. The empty pointer may select the entire payload. Duplicate paths within one display descriptor are invalid. Parent and child references may coexist; their coverage of additional parameters is defined in §6.5.

The resolver MUST distinguish an absent member, explicit `null`, `false`, zero, and an empty string. It MUST resolve only own JSON object members and MUST NOT traverse object prototypes. An optional missing value is displayed as `Not provided`; its absence MUST NOT be replaced with a default from the schema. A path proven impossible under the schema is an authoring error rejected at plugin validation (§9.2), not an optional missing value. A payload missing a schema-required value fails normal payload validation.

Title fallback order is explicit field `title`, an unambiguously resolved schema `title`, then the JSON Pointer. Help fallback order is explicit field `description`, an unambiguously resolved schema `description`, then no help text. If a schema has alternatives or references that a renderer cannot resolve unambiguously, it uses the pointer rather than guessing. Rendering MUST NOT fetch external schemas to obtain annotations.

The first implementation supports nested objects and arrays through ordinary JSON Pointer lookup. Arrays of variable length can be presented as a whole JSON value. Generic per-element display templates, grouping, and iteration are deferred; a client MUST still provide complete array contents through the fallback view.

### 6.2 Raw format

`raw` accepts any JSON value and has no `params`. Scalars retain their type, and objects/arrays have a structured or JSON representation. Display MUST NOT silently round numbers, coerce strings into numbers, shorten identifiers without access to their full value, or replace the exact value with a publisher-supplied alias.

Clients handling values beyond their exact numeric range MUST use lossless parsing or reject the payload as unsupported; they MUST NOT authorize a rounded interpretation. Profiles SHOULD encode large integers and exact decimal amounts as strings where appropriate. The renderer never changes the payload serialization used by MPAS hashing.

### 6.3 Enum format and value help

`enum` requires `params.values`, an array of objects:

| Field | Required | Definition |
|---|---|---|
| `value` | Yes | Exact JSON scalar: string, number, boolean, or null. |
| `title` | Yes | Nonempty human-readable name for this value. |
| `description` | No | Expanded explanation of what choosing this value means. |

Matching is type-sensitive: `1` and `"1"` are different. Duplicate values are invalid. A formatter never changes the set of allowed values: the JSON Schema remains authoritative. Where the target schema declares a finite enum, authoring validation SHOULD flag mappings outside that set and missing mappings.

A matched enum shows its readable title and makes the original value accessible next to it or in details. An unmapped value is shown in raw form with an explanation that no display mapping is available. It MUST NOT be assigned the first entry, a default title, or an apparently successful match.

Value descriptions supply the per-choice help discussed for consumer review. For example, `squash` can explain that the pull request's changes become one commit. Mappings are local to the field in this first version; shared enum dictionaries and reference resolution are deferred to keep hand editing and interpretation simple.

### 6.4 Date format

`date` requires `params.type`, either `date` or `date-time`, and accepts strings matching the corresponding JSON Schema standard format. A `date-time` MUST include a timezone offset or `Z`; a date-only value MUST NOT be silently treated as midnight in a timezone.

Clients may localize the display and MUST make the displayed timezone clear. When displaying a `date-time` in a different timezone or offset from its original string, the client MUST show the original string alongside the converted value, not only behind a separate details control. This includes conversions that change the calendar day. Otherwise the original string MUST remain accessible in field details. An invalid or unsupported date formatter falls back to raw with a visible formatting notice. Schema validity is still determined independently by the execution profile's validator.

### 6.5 Complete-value access and failure behavior

The application developer chooses the fields and their primary review order. An `Additional parameters` view lets the reviewer inspect the remainder of the submitted payload. The following coverage rules apply identically in every client:

1. A field whose pointer resolves covers the value at that pointer. If the value is an object or array, it covers the entire subtree, which MUST be inspectable through that field's raw/structured representation. A collapsed field counts as covered only when the complete value is available on expansion. A formatter fallback provides the same complete-value access. A missing pointer covers nothing.
2. Coverage is the union of these subtrees. For remainder calculation, scalars and empty objects/arrays are terminal values; a nonempty container is wholly covered when all of its terminal descendants are covered. Displaying both a parent and its child does not subtract anything from the parent or make a sibling disappear. The child may repeat information using a more specific title.
3. Compute the remainder by walking the payload from the root. Omit a wholly covered subtree. Emit a wholly uncovered subtree as one `(absolute JSON Pointer, exact value)` entry. If a subtree is partially covered, descend to its members/elements and repeat. Scalars and empty objects/arrays are terminal values. These rules produce the maximal wholly uncovered subtrees.
4. Walk object members in lexicographic Unicode code-point order and array elements by ascending index. Entries retain their original absolute pointers; do not compact arrays or renumber uncovered elements. Clients may visually group these entries without changing which pointers and values they include.
5. If no values are covered, the remainder is the entire payload at the empty pointer. If all values are covered, the view may show `No additional parameters`. Clients MAY also offer a complete payload view, independently of the remainder.

For example, given `{"name":"merge_pull_request","arguments":{"repo":"demo","baseRef":"main","extra":true}}`:

| Displayed paths | Additional-parameters entries |
|---|---|
| `/arguments` and `/arguments/repo` | `/name` with its exact value; the whole `arguments` object is inspectable through the parent field. |
| `/arguments/repo` only | `/arguments/baseRef`, `/arguments/extra`, and `/name`, each with its exact value. |
| No resolved paths | The entire payload at the empty pointer. |

The native operation and the Action Envelope's target, execution profile, and expiry remain available as client-owned review context (§4). Client policy may require additional prominent fields. Sensitive values may have client-controlled reveal behavior without sending them to analytics or external sites. This version does not add a separate visibility language.

An unsupported formatter or inconsistent runtime value MUST produce a clearly identified raw fallback. An unsupported execution profile is different: generic JSON rendering does not establish that the client understands the actual executable action. The client MUST label that limitation and follow its local policy for whether signing is allowed.

## 7. Interpolated title

`interpolatedTitle` uses `{<absolute JSON Pointer>}` placeholders, for example:

```text
Merge PR {/arguments/pullNumber} into {/arguments/baseRef}
```

Every placeholder MUST exactly match the `path` of a declared field. It uses that field's formatting rules, so enum titles do not differ between the summary and details. Converted date-time substitutions include the original string alongside the converted value as required by §6.4; a summary cannot omit that part of the formatter output. `{{` and `}}` represent literal braces. Invalid syntax or undeclared references make the descriptor invalid.

There are no functions, conditionals, arbitrary substitutions, schema defaults, or references to secrets, environment variables, or remotely fetched data. Substituted payload text MUST be rendered as data, never processed as Markdown, HTML, executable content, or template syntax. Substituted braces are not processed a second time.

If a referenced value is absent or cannot be safely formatted, the client MUST omit the interpolated summary and fall back to the static title plus field details. It MUST NOT present a partly substituted or misleading sentence as a complete summary. Client-shortened forms, including ellipsized identifiers and value prefixes, MUST NOT be substituted into `interpolatedTitle`. Author-defined enum titles and date formatting are permitted as specified above; UI truncation is not another formatter. If the complete formatted substitutions exceed the client's display limits, omit the summary and use the static title plus complete expandable field details. Do not silently clip the summary or its values.

## 8. Context links

Links help Maintainers inspect related content, such as a GitHub pull request. They are supplemental context, not evidence that the remote page matches the Action being authorized.

| Field | Required | Definition |
|---|---|---|
| `title` | Yes | Nonempty plain-text link text. |
| `description` | No | Explanation of the context the user will find. |
| `urlTemplate` | Yes | Absolute HTTPS URL template with a literal host and optional placeholders. |
| `variables` | When placeholders exist | Object mapping each placeholder name to an absolute JSON Pointer into the execution payload. |

Rules:

1. Placeholder names are simple ASCII identifiers matching `[A-Za-z_][A-Za-z0-9_]*`. Each used name has exactly one variable entry; unused entries are invalid.
2. A placeholder occupies one complete path segment or one complete query-parameter value. It cannot occur in the scheme, authority, port, parameter name, or fragment. Fragments and URL user information are unsupported in the first version.
3. Variable values are strings or exactly represented integers. Each is encoded as a URL component before insertion. Reserved characters cannot introduce another path segment, query parameter, or origin. Empty strings, values equal to `.` or `..`, and values containing control characters are rejected. Integer zero is a value, not an empty input. Do not trim or coerce a value to make it acceptable.
4. The resulting URL is parsed and checked again. Its HTTPS scheme and origin MUST equal the literal template scheme and origin, and it MUST contain no credentials. Missing or invalid variables disable the link with a readable reason; they do not alter the Action or disable unrelated review details.
5. Links open only after an explicit user gesture. No automatic fetching, preview requests, redirects followed by the renderer, or transmission of payload data occurs during rendering. Clients SHOULD show the destination host before navigation.
6. Clients MUST NOT attach adapter credentials, approval signatures, or hidden envelope fields. Link variables MUST be inspectable in review details. Client privacy policy may block a link that would disclose sensitive data, even when the plugin is otherwise trusted.

HTTPS universal/app links may open a native app through the operating system. Arbitrary custom URL schemes, inline HTML, JavaScript, and plugin-defined navigation code are out of scope.

External content may change after review and may not be available offline. For a pull request, its page is useful context but is not a replacement for examining the repository, branch, and expected commit in the approved payload. A link failure never changes what the user is signing.

## 9. Validation

### 9.1 Structural validation

A loader validates a plugin against the Application Plugin Profile and its Appendix A schema. For plugin schema version 2 it MUST also:

- accept `display` and the boolean `governedByDefault` only on operations, and reject both on version 1;
- validate every `display` descriptor as a closed object with the required properties specified in §5 through §8;
- enforce formatter parameters, by schema or by the semantic pass (§9.2): no `params` for `raw`, `params.values` for `enum`, and `params.type` for `date`;
- validate enum `value` as a JSON scalar, titles and descriptions as nonempty strings, and lists as arrays;
- reject unknown `display` properties and unsupported format identifiers.

Version 2 must not make payload validation more permissive. Presentation keys do not become payload properties and are not inserted into `executionPayloadSchema`. In particular, `display.fields[].format` is a presentation formatter; a schema's `format` keyword remains a validation annotation/assertion under that validator's existing rules.

### 9.2 Semantic validation

Structural validation is necessary but insufficient. A deterministic authoring/loader validation pass MUST check pointer syntax, duplicate field paths, enum uniqueness, interpolation syntax and references, formatter option consistency, and link-template restrictions. It MUST reject a field path or link-variable pointer when the payload schema proves that no valid payload can contain a value at that path. Diagnostics MUST identify the operation, descriptor location, offending pointer, and schema constraint establishing impossibility. Enum mapping mismatches SHOULD also be diagnosed when statically decidable without remote resolution.

At a minimum, this check MUST recognize paths excluded by an applicable `false` schema, by an explicit type that cannot be traversed at the next pointer token, by a closed object's property rules, or by a schema's array-length bounds. For example, `/arguments/pullNubmer` is invalid when the closed `arguments` object permits `pullNumber` and excludes that misspelling. A numeric-looking token is still a property name in an object; traversal checks must respect the possible container types.

Optional properties are not impossible properties. A path is not rejected merely because `required` omits it or because it exists in only one possible schema alternative. With alternatives, the exclusion proof must account for every branch that could admit the path; one excluding branch is insufficient. Locally resolvable schema references must be considered. An unresolved reference or unsupported analysis construct yields an indeterminate result, not a false proof of impossibility. Implementations are not required to solve arbitrary JSON Schema satisfiability or fetch remote schemas. Runtime missing-value and fallback rules still apply to paths that are possible or indeterminate.

No validation or rendering stage may execute plugin code or perform network enrichment.

### 9.3 Classes of finding

Implementations MUST keep three kinds of finding separate:

| Class | Examples | Effect |
|---|---|---|
| Invalid artifact | Structural failure; impossible, duplicate, or malformed pointer; invalid interpolation reference; invalid link template; resource limit exceeded | The loader rejects the plugin. It cannot be accepted or used for validation or presentation. |
| Advisory authoring diagnostic | Missing explanation; enum mapping that differs from the schema enum; changed tool definition; preserved explanation that may be stale | Reported to the publisher. The plugin remains valid. Rendering uses the fallbacks in this profile. |
| Runtime authorization | Payload schema validation, routing, proposer authorization, policy evaluation | Performed by the Verifier under the execution and policy profiles. Presentation findings never change these results. |

An advisory diagnostic MUST NOT be promoted to an invalid-artifact error at load time, and neither class may be reported as an authorization outcome.

## 10. Resource limits

A plugin document, including all presentation content, MUST NOT exceed 262,144 UTF-8 bytes, a containment depth of 64 (the root value is depth 0), or 20,000 JSON values. Help text and enum tables count toward these limits. A loader rejects a plugin that exceeds any limit in this section. The `display` limits are:

| Resource | Maximum |
|---|---:|
| Display fields per operation | 256 |
| Enum values per field | 256 |
| Links per operation | 16 |
| Variables per link | 16 |
| Field/variable pointer length | 1,024 UTF-8 bytes |
| Title or interpolated template length | 2,048 UTF-8 bytes each |
| Description or URL template length | 8,192 UTF-8 bytes each |

All counts are checked before rendering or interpolation. Implementations may impose stricter documented device limits but must expose an unsupported/resource-limited state rather than silently omit consequential values. These limits are maximums; a loader MUST NOT accept larger values.

## 11. Rendering failures versus authorization failures

A structurally invalid plugin is rejected by the loader. A valid plugin can encounter optional missing values, unrecognized runtime enum values, unavailable links, or client rendering limits. Those cases produce the specified fallback and a visible notice where relevant; they do not alter the payload or policy result.

Presentation failure alone does not automatically reject a valid action at the Verifier. The review client independently decides whether its available fallback meets local requirements for obtaining human approval. Schema failure, wrong application/profile, or failed MPAS integrity checks are authorization/validation problems and MUST NOT be disguised as presentation fallbacks.

## 12. Review records

A client MUST retain the exact artifact used, or an immutable retrievable copy, rather than a mutable URL alone. Each review record MUST identify at least the Action Envelope hash, `artifactDid`, `pluginDid`, `pluginVersion`, and native operation identifier. A record SHOULD also identify the renderer and its version, formatting fallbacks and notices, the time and outcome of review, and any restart under §3.3, subject to local data-retention policy.

Review records are audit metadata. Apart from the artifact identity an Approval names, they are not covered by Approvals (§3.5). Transmitting them to other services requires separate specification; implementations MUST NOT add other fields to signed messages to carry them.

## 13. Security considerations

**Accepted publisher presentation.** After the operator accepts the publisher and exact artifact (for example on OMATrust evidence), the plugin's titles, descriptions, enum explanations, field selection, and literal link hosts and templates are that publisher's presentation of its own operations. A client renders it within this profile's declarative rules. This profile adds no second approval of the publisher's wording.

**Artifact source.** Where a client obtained a plugin confers no trust; the artifact's identity and trusted responsibility claims do (§3.2). A party that supplies a different trusted artifact, or a stale reference, can at most cause a review against the wrong release, whose Approval the Verifier does not count.

**Submitted values are data.** Payload values were supplied for the Action. Even when schema-valid and hash-bound, they cannot introduce markup, change a link's structure or origin, or become interpolation instructions.

**Presentation is not authority.** Trust in the publisher's presentation grants no execution authority. The Verifier applies deployment policy independently: changing display text does not change the policy expression or how it evaluates a payload. It does create a new artifact identity, so Approvals that name the earlier artifact stop counting once the Verifier uses the new one (§3.2).

**Opaque data.** If executable data is opaque, encrypted, or only partly revealed, a plugin's description MUST NOT be presented as a verified decoding of hidden contents. Plaintext secrets are not added to the public plugin to improve review, and sensitive values are not automatically sent to context links.

**Generic views.** Valid JSON rendered generically does not show that the client understands the action. A client that cannot apply this profile labels that limitation (§6.5).

## 14. Conformance

A conforming reviewer client implements §3 through §12. A conforming plugin loader implements §9 and §10.

Shared conformance fixtures for this profile belong in the repository's `conformance/plugin-presentation/` directory, covering pointer resolution, formatting, interpolation, coverage remainders, links, fallbacks, resource limits, and validation classes. That fixture set is not yet published; until it is, this profile's examples and the requirements above are authoritative.

## Appendix A. Complete illustrative plugin (informative)

This version 2 artifact is accepted by a version 2 loader and rejected by a version 1 loader. It illustrates the existing MCP execution binding plus the display object, and a second operation that is described but not governed by default. The example application DID is illustrative.

```json
{
  "version": "2",
  "type": "MpasApplicationPlugin",
  "pluginDid": "did:web:plugins.example.com:github-pr",
  "pluginVersion": "1.0.0",
  "publisherDid": "did:web:plugins.example.com",
  "applicationDid": "did:web:github-adapter.example.com",
  "executionProfile": {
    "id": "did:web:profiles.oma3.org:mcp",
    "format": "mcp.toolsCall",
    "protocolVersion": "2024-11-05"
  },
  "operations": {
    "merge_pull_request": {
      "description": "Merge a pull request into its base branch using the requested merge method.",
      "impact": "high",
      "executionPayloadSchema": {
        "type": "object",
        "required": ["name", "arguments"],
        "properties": {
          "name": { "const": "merge_pull_request" },
          "arguments": {
            "type": "object",
            "required": ["owner", "repo", "pullNumber", "baseRef", "expectedHeadSha", "mergeMethod"],
            "properties": {
              "owner": { "type": "string", "minLength": 1, "title": "Repository owner" },
              "repo": { "type": "string", "minLength": 1, "title": "Repository" },
              "pullNumber": { "type": "integer", "minimum": 1, "title": "Pull request" },
              "baseRef": { "type": "string", "minLength": 1, "title": "Target branch" },
              "expectedHeadSha": { "type": "string", "minLength": 1, "title": "Expected head commit" },
              "mergeMethod": { "type": "string", "enum": ["merge", "squash", "rebase"] }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      "display": {
        "title": "Merge pull request",
        "description": "Check the repository, target branch, and proposed changes. Confirm that the expected head commit is the version you intend to merge.",
        "interpolatedTitle": "Merge PR {/arguments/pullNumber} into {/arguments/baseRef}",
        "fields": [
          { "path": "/arguments/owner", "title": "Repository owner" },
          { "path": "/arguments/repo", "title": "Repository" },
          { "path": "/arguments/pullNumber", "title": "Pull request" },
          {
            "path": "/arguments/baseRef",
            "title": "Target branch",
            "description": "The branch that will receive the pull request's changes."
          },
          {
            "path": "/arguments/expectedHeadSha",
            "title": "Expected head commit",
            "description": "Compare this exact commit identifier with the revision you reviewed."
          },
          {
            "path": "/arguments/mergeMethod",
            "title": "Merge method",
            "description": "How the pull request's changes will be added to the target branch.",
            "format": "enum",
            "params": {
              "values": [
                { "value": "merge", "title": "Merge commit", "description": "Keep the pull request's commits and create a merge commit." },
                { "value": "squash", "title": "Squash", "description": "Combine the pull request's changes into one commit." },
                { "value": "rebase", "title": "Rebase", "description": "Replay the pull request's commits onto the target branch." }
              ]
            }
          }
        ],
        "links": [
          {
            "title": "View pull request",
            "description": "Read the discussion and inspect the proposed changes on GitHub.",
            "urlTemplate": "https://github.com/{owner}/{repo}/pull/{pullNumber}",
            "variables": {
              "owner": "/arguments/owner",
              "repo": "/arguments/repo",
              "pullNumber": "/arguments/pullNumber"
            }
          }
        ]
      }
    },
    "create_issue": {
      "description": "Create an issue in a repository.",
      "impact": "medium",
      "governedByDefault": false,
      "executionPayloadSchema": {
        "type": "object",
        "required": ["name", "arguments"],
        "properties": {
          "name": { "const": "create_issue" },
          "arguments": {
            "type": "object",
            "required": ["owner", "repo", "title"],
            "properties": {
              "owner": { "type": "string", "minLength": 1, "title": "Repository owner" },
              "repo": { "type": "string", "minLength": 1, "title": "Repository" },
              "title": { "type": "string", "minLength": 1, "title": "Issue title" },
              "body": { "type": "string", "title": "Issue text" }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      "display": {
        "title": "Create issue",
        "description": "Opens a public issue. Check that the text contains nothing confidential.",
        "fields": [
          { "path": "/arguments/owner" },
          { "path": "/arguments/repo" },
          { "path": "/arguments/title" },
          { "path": "/arguments/body" }
        ]
      }
    }
  }
}
```

`create_issue` passes through unless an operator's policy names it. If one does, reviewers see its title and description, and the Verifier validates its payload. Its fields omit `title`, so reviewers see the schema titles.
