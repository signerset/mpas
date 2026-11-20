/** Interactive reporting and confirmation for plugin trust information. */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { PluginTrustReport } from "./trust.js";
import type { AttestationSummary } from "./trust-attestation.js";
import type { DeploymentConfig } from "./config-loader.js";

export type PluginTrustAssessment = { governance?: { governed: string[]; added: string[]; removed: string[]; previousKnown: boolean } } & (
  | { status: "checked"; report: PluginTrustReport }
  | { status: "notChecked"; reason: "unavailable"; detail?: string });

export type ConfirmPluginUse = (
  assessment: PluginTrustAssessment,
  config: DeploymentConfig,
) => Promise<boolean>;

export const NO_TRUST_CHECKS_WARNING =
  "No OMATrust responsibility claims, security reviews, linked identifiers, or other legitimacy and provenance evidence was loaded.";
export const NO_PRIMARY_TRUST_EVIDENCE_WARNING =
  "Neither the declared publisher nor an approved assessor has vouched for this plugin: no responsibility claim or cybersecurity assessment from either was found.";
export const RESPONSIBILITY_CLAIM_TRUST_NOTICE =
  "If you trust just one of the URLs you should use the plugin.";
export const DETAILS_HINT = "Press D for governed operations and all attestations.";
export const INDEPENDENT_VERIFY_NOTICE =
  "You can independently verify this artifact at https://app.omatrust.org/verify using its did:artifact:";

/** How many responsible parties or reviewers the summary lists before "+N more". */
export const SUMMARY_LIST_LIMIT = 5;

const SECURITY_ASSESSMENT = "security-assessment";

/** Emphasis for the few facts the operator decides on. */
export interface TrustTextStyle {
  strong(text: string): string;
  warning(text: string): string;
}

export const PLAIN_STYLE: TrustTextStyle = {
  strong: (text) => text,
  warning: (text) => text,
};

const ANSI_STYLE: TrustTextStyle = {
  strong: (text) => `\x1b[1m${text}\x1b[22m`,
  warning: (text) => `\x1b[1;33m${text}\x1b[0m`,
};

/** Bold and colour on a terminal, unless the operator set NO_COLOR. */
export function terminalStyle(
  isTTY: boolean,
  env: NodeJS.ProcessEnv = process.env,
): TrustTextStyle {
  return isTTY && !env.NO_COLOR ? ANSI_STYLE : PLAIN_STYLE;
}

/**
 * Removes control characters from text that came from the trust backend.
 * Claims are permissionless, so a claim could otherwise carry terminal escape
 * sequences that rewrite or hide what the operator sees.
 */
export function sanitizeForTerminal(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "");
}

function shortenMiddle(text: string, head: number, tail: number): string {
  return text.length <= head + tail + 1
    ? text
    : `${text.slice(0, head)}…${text.slice(-tail)}`;
}

/**
 * A readable name for an identifier. A did:web is its domain (and path), which
 * is the identifier itself rather than a label someone chose, so it is safe to
 * show on its own. Addresses and long DIDs are shortened; the detail view
 * shows them in full.
 */
export function displayIdentifier(identifier: string): string {
  const clean = sanitizeForTerminal(identifier.trim());
  if (clean.startsWith("did:web:")) {
    const [host = "", ...path] = clean.slice("did:web:".length).split(":");
    let decodedHost = host;
    try {
      decodedHost = decodeURIComponent(host);
    } catch {
      // Keep the encoded form; a malformed DID must not abort the prompt.
    }
    return sanitizeForTerminal([decodedHost, ...path].join("/"));
  }
  const address = /0x[0-9a-fA-F]{40}$/.exec(clean)?.[0];
  if (address && (clean === address || clean.startsWith("did:pkh:"))) {
    return shortenMiddle(address, 6, 4);
  }
  return shortenMiddle(clean, 28, 8);
}

export interface TrustListEntry {
  /** The full identifier, shown in the detail view. */
  identifier: string;
  /** The readable name shown in the summary. */
  name: string;
  /** Set for the declared publisher or an approved assessor. */
  mark?: string;
}

function responsiblePartyOf(claim: AttestationSummary): string {
  return typeof claim.data.responsibleParty === "string"
    ? claim.data.responsibleParty
    : claim.attester;
}

/**
 * Every party that claims responsibility for the artifact, declared publisher
 * first. Claims are permissionless, so all of them are listed for the
 * operator; only the declared publisher's claim is marked.
 */
export function listResponsibleParties(
  report: PluginTrustReport,
): TrustListEntry[] {
  const entries = new Map<string, TrustListEntry>();
  const add = (claim: AttestationSummary, mark?: string) => {
    const identifier = responsiblePartyOf(claim);
    if (entries.has(identifier)) return;
    entries.set(identifier, {
      identifier,
      name: displayIdentifier(identifier),
      ...(mark ? { mark } : {}),
    });
  };
  for (const claim of report.attestation.responsibilityClaims) {
    add(claim, "declared publisher");
  }
  for (const claim of report.attestation.unqualifiedResponsibilityClaims) {
    add(claim);
  }
  return [...entries.values()];
}

/**
 * Every party that published a cybersecurity assessment of the artifact,
 * approved assessors first. A label is shown only for an approved assessor;
 * anyone else is named by their identifier.
 */
export function listSecurityReviewers(
  report: PluginTrustReport,
): TrustListEntry[] {
  const reviews = report.attestation.attestations.filter(
    (item) => item.schemaLabel === SECURITY_ASSESSMENT,
  );
  const ordered = [
    ...reviews.filter((item) => item.isApprovedIssuer),
    ...reviews.filter((item) => !item.isApprovedIssuer),
  ];
  const entries = new Map<string, TrustListEntry>();
  for (const review of ordered) {
    if (entries.has(review.attester)) continue;
    const label = review.isApprovedIssuer && review.attesterLabel
      ? sanitizeForTerminal(review.attesterLabel)
      : undefined;
    entries.set(review.attester, {
      identifier: review.attester,
      name: label || displayIdentifier(review.attester),
      ...(review.isApprovedIssuer ? { mark: "approved assessor" } : {}),
    });
  }
  return [...entries.values()];
}

function formatList(
  heading: string,
  entries: TrustListEntry[],
  style: TrustTextStyle,
): string[] {
  if (entries.length === 0) return [`  ${heading}: none found`];
  const shown = entries.slice(0, SUMMARY_LIST_LIMIT);
  const width = Math.max(...shown.map((entry) => entry.name.length));
  const lines = [`  ${heading} (${entries.length}):`];
  for (const entry of shown) {
    lines.push(
      entry.mark
        ? `    ${style.strong(entry.name.padEnd(width))}  ✓ ${entry.mark}`
        : `    ${entry.name}`,
    );
  }
  if (entries.length > shown.length) {
    lines.push(`    +${entries.length - shown.length} more (press D to see all)`);
  }
  return lines;
}

/**
 * The short message shown for each plugin: who claims responsibility, who
 * reviewed its security, and a warning when neither the declared publisher
 * nor an approved assessor vouched for it. Everything else, including the
 * did:artifact and the independent-verification link, is in the details.
 */
export function formatTrustSummary(
  assessment: PluginTrustAssessment,
  config: DeploymentConfig,
  style: TrustTextStyle = PLAIN_STYLE,
): string {
  const lines = [`Plugin: ${style.strong(config.name)}`];
  if (assessment.governance) {
    const g = assessment.governance;
    const names = (items: string[]) => items.map(sanitizeForTerminal).join(", ");
    if (g.previousKnown) {
      if (g.added.length) lines.push(`  Newly governed: ${names(g.added)}`);
      if (g.removed.length) lines.push(`  No longer governed: ${names(g.removed)}`);
    } else {
      lines.push("  No previously accepted governed set is available for comparison.");
    }
  }

  if (assessment.status === "notChecked") {
    lines.push(
      `  ${style.warning("WARNING: OMATrust information could not be loaded.")}`,
    );
    if (assessment.detail) {
      lines.push(`  ${sanitizeForTerminal(assessment.detail)}`);
    }
    lines.push(`  ${NO_TRUST_CHECKS_WARNING}`);
  } else {
    const { report } = assessment;
    const parties = listResponsibleParties(report);
    const reviewers = listSecurityReviewers(report);

    if (report.verdict.warningRequired) {
      lines.push(`  ${style.warning(`WARNING: ${NO_PRIMARY_TRUST_EVIDENCE_WARNING}`)}`);
    }
    lines.push(...formatList("Responsible parties", parties, style));
    if (!report.attestation.responsibilityClaim) {
      lines.push(
        `    No claim from the declared publisher, ${style.strong(displayIdentifier(report.publisherDid))}`,
      );
    }
    lines.push(...formatList("Security reviews", reviewers, style));

    if (parties.length > 0 || reviewers.length > 0) {
      lines.push(`  ${RESPONSIBILITY_CLAIM_TRUST_NOTICE}`);
    }
  }

  lines.push(`  ${DETAILS_HINT}`);
  return `${lines.join("\n")}\n`;
}

function basisText(basis: string[]): string {
  return basis.length > 0
    ? basis.map(sanitizeForTerminal).join(", ")
    : "endpoint verification";
}

function claimDetail(claim: AttestationSummary): string {
  const types = Array.isArray(claim.data.responsibilityType)
    ? claim.data.responsibilityType.filter(
      (value): value is string => typeof value === "string",
    )
    : [];
  const typeText = types.length > 0
    ? `; responsibility ${types.map(sanitizeForTerminal).join(", ")}`
    : "";
  return `    - ${sanitizeForTerminal(responsiblePartyOf(claim))}${typeText}; ` +
    `attested by ${sanitizeForTerminal(claim.attester)}; verified via ${basisText(claim.verificationBasis)}`;
}

function attestationDetail(item: AttestationSummary): string {
  const issuer = item.attesterLabel
    ? `${sanitizeForTerminal(item.attesterLabel)} (${sanitizeForTerminal(item.attester)})`
    : sanitizeForTerminal(item.attester);
  const approved = item.isApprovedIssuer ? "; approved issuer" : "";
  return `    - ${sanitizeForTerminal(item.schemaLabel || item.schemaUid)}; issuer ${issuer}${approved}; ` +
    `verified via ${basisText(item.verificationBasis)}`;
}

/** Everything OMATrust returned, in full, for an operator who asks for it. */
export function formatTrustDetails(
  assessment: PluginTrustAssessment,
  config: DeploymentConfig,
): string {
  const lines = [
    `Details for ${config.name}`,
    `  Artifact: ${config.plugin.artifactDid}`,
    "  Content integrity: verified (plugin content matches the configured did:artifact)",
  ];
  const verify = [`  ${INDEPENDENT_VERIFY_NOTICE}`, `    ${config.plugin.artifactDid}`];
  if (assessment.governance) {
    const governed = assessment.governance.governed.map(sanitizeForTerminal);
    lines.push(`  Governed operations (${governed.length}):`, ...governed.map(name => `    - ${name}`));
  }
  if (assessment.status === "notChecked") {
    lines.push("  OMATrust information could not be loaded.", ...verify);
    return `${lines.join("\n")}\n`;
  }

  const { report } = assessment;
  const { attestation } = report;
  lines.push(`  Declared publisher: ${sanitizeForTerminal(report.publisherDid)}`);
  lines.push(
    `  Responsibility claims from the declared publisher (${attestation.responsibilityClaims.length}):`,
  );
  for (const claim of attestation.responsibilityClaims) lines.push(claimDetail(claim));
  lines.push(
    `  Responsibility claims from other parties (${attestation.unqualifiedResponsibilityClaims.length}):`,
  );
  for (const claim of attestation.unqualifiedResponsibilityClaims) {
    lines.push(claimDetail(claim));
  }
  lines.push(`  Attestations (${attestation.attestations.length}):`);
  for (const item of attestation.attestations) lines.push(attestationDetail(item));
  lines.push(`  Linked identifiers (${report.linkedIdentifiers.length}):`);
  for (const linked of report.linkedIdentifiers) {
    const issuer = linked.attesterLabel
      ? `${sanitizeForTerminal(linked.attesterLabel)} (${sanitizeForTerminal(linked.attester)})`
      : sanitizeForTerminal(linked.attester);
    lines.push(
      `    - ${sanitizeForTerminal(linked.linkedId)}; issuer ${issuer}; verified via ${basisText(linked.verificationBasis)}`,
    );
  }
  lines.push(...verify);
  return `${lines.join("\n")}\n`;
}

/**
 * Shows the trust summary and asks the operator to decide. `d` (either case)
 * prints the full detail and asks again. The content hash has already been verified by the
 * loader.
 */
export const promptPluginUse: ConfirmPluginUse = async (assessment, config) => {
  const style = terminalStyle(Boolean(stdout.isTTY));
  stdout.write(`\n${formatTrustSummary(assessment, config, style)}`);

  if (!stdin.isTTY) {
    stdout.write("  Non-interactive input: declining plugin use by default.\n");
    return false;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      const answer = (await rl.question("Use this plugin? (y/N, or D for details) "))
        .trim()
        .toLowerCase();
      if (answer === "d") {
        stdout.write(`\n${formatTrustDetails(assessment, config)}\n`);
        continue;
      }
      return answer === "y";
    }
  } finally {
    rl.close();
  }
};
