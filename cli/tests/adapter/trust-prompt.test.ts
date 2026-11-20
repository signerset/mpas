import { describe, expect, it } from "vitest";
import {
  DETAILS_HINT,
  INDEPENDENT_VERIFY_NOTICE,
  NO_PRIMARY_TRUST_EVIDENCE_WARNING,
  NO_TRUST_CHECKS_WARNING,
  PLAIN_STYLE,
  RESPONSIBILITY_CLAIM_TRUST_NOTICE,
  SUMMARY_LIST_LIMIT,
  displayIdentifier,
  formatTrustDetails,
  formatTrustSummary,
  listResponsibleParties,
  listSecurityReviewers,
  sanitizeForTerminal,
  terminalStyle,
} from "../../src/adapter/trust-prompt.js";
import type { DeploymentConfig } from "../../src/adapter/config-loader.js";
import type { PluginTrustReport } from "../../src/adapter/trust.js";
import type { AttestationSummary } from "../../src/adapter/trust-attestation.js";

const publisherDid = "did:web:publisher.example";
const artifactDid = "did:artifact:bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
const config = {
  name: "github-repo",
  plugin: { artifactDid },
} as unknown as DeploymentConfig;

function claim(responsibleParty: string): AttestationSummary {
  return {
    uid: `uid-${responsibleParty}`,
    attester: "0x1111111111111111111111111111111111111111",
    isApprovedIssuer: false,
    schemaUid: "0xschema",
    schemaLabel: "responsibility-claim",
    time: "2026-08-01T00:00:00.000Z",
    expirationTime: "0",
    verificationBasis: ["proof", "controller-authorization"],
    data: { subject: artifactDid, responsibleParty, responsibilityType: ["publisher"] },
  };
}

function review(
  attester: string,
  options: { approved?: boolean; label?: string; schema?: string } = {},
): AttestationSummary {
  return {
    uid: `uid-${attester}`,
    attester,
    ...(options.label ? { attesterLabel: options.label } : {}),
    isApprovedIssuer: options.approved ?? false,
    schemaUid: "0xschema",
    schemaLabel: options.schema ?? "security-assessment",
    time: "2026-08-01T00:00:00.000Z",
    expirationTime: "0",
    verificationBasis: options.approved ? ["approved-issuer"] : ["proof"],
    data: { subject: artifactDid },
  };
}

function report(options: {
  declared?: AttestationSummary[];
  others?: AttestationSummary[];
  attestations?: AttestationSummary[];
  linked?: number;
}): PluginTrustReport {
  const declared = options.declared ?? [];
  const attestations = options.attestations ?? [];
  const approvedReview = attestations.some(
    (item) => item.schemaLabel === "security-assessment" && item.isApprovedIssuer,
  );
  const primary = declared.length > 0 || approvedReview;
  return {
    artifactDid,
    publisherDid,
    pluginDid: "did:web:publisher.example:plugins:demo",
    pluginVersion: "1.0.0",
    targetApplicationDid: "did:web:publisher.example:applications:demo",
    verdict: { primaryEvidenceFound: primary, warningRequired: !primary, reasons: [] },
    attestation: {
      primaryEvidenceFound: primary,
      message: "",
      responsibilityClaim: declared.length > 0,
      cybersecurityAssessment: approvedReview,
      responsibilityClaims: declared,
      unqualifiedResponsibilityClaims: options.others ?? [],
      attestations,
    },
    linkedIdentifiers: Array.from({ length: options.linked ?? 0 }, (_, index) => ({
      uid: `linked-${index}`,
      linkedId: `did:web:linked${index}.example`,
      attester: "0x2222222222222222222222222222222222222222",
      verificationBasis: ["proof"],
    })),
  };
}

describe("displayIdentifier", () => {
  it("shows a did:web as its domain and path", () => {
    expect(displayIdentifier("did:web:publisher.example")).toBe("publisher.example");
    expect(displayIdentifier("did:web:publisher.example:plugins:demo"))
      .toBe("publisher.example/plugins/demo");
    expect(displayIdentifier("did:web:localhost%3A8443")).toBe("localhost:8443");
  });

  it("shortens addresses and long DIDs", () => {
    expect(displayIdentifier("0x12ab567890123456789012345678901234569f3c")).toBe("0x12ab…9f3c");
    expect(displayIdentifier("did:pkh:eip155:1:0x12ab567890123456789012345678901234569f3c"))
      .toBe("0x12ab…9f3c");
    expect(displayIdentifier(artifactDid)).toBe("did:artifact:bafkreigh2akisc…qa4s52zy");
  });
});

describe("sanitizeForTerminal", () => {
  it("removes escape sequences and bidirectional overrides from backend text", () => {
    expect(sanitizeForTerminal("evil\x1b[2K\x1b[1Agood")).toBe("evil[2K[1Agood");
    expect(sanitizeForTerminal("abc‮def")).toBe("abcdef");
  });
});

describe("listResponsibleParties", () => {
  it("lists every claimant once, with the declared publisher first and marked", () => {
    const parties = listResponsibleParties(report({
      declared: [claim(publisherDid), claim(publisherDid)],
      others: [claim("did:web:auditor.example"), claim("did:web:pub1isher.example")],
    }));
    expect(parties).toEqual([
      { identifier: publisherDid, name: "publisher.example", mark: "declared publisher" },
      { identifier: "did:web:auditor.example", name: "auditor.example" },
      { identifier: "did:web:pub1isher.example", name: "pub1isher.example" },
    ]);
  });
});

describe("listSecurityReviewers", () => {
  it("puts approved assessors first and uses labels only for them", () => {
    const reviewers = listSecurityReviewers(report({
      attestations: [
        review("0x3333333333333333333333333333333333333333", { label: "Totally Legit Lab" }),
        review("0x4444444444444444444444444444444444444444", { approved: true, label: "OMA3 Security Lab" }),
        review("0x5555555555555555555555555555555555555555", { schema: "certification", approved: true }),
      ],
    }));
    expect(reviewers).toEqual([
      {
        identifier: "0x4444444444444444444444444444444444444444",
        name: "OMA3 Security Lab",
        mark: "approved assessor",
      },
      { identifier: "0x3333333333333333333333333333333333333333", name: "0x3333…3333" },
    ]);
  });
});

describe("formatTrustSummary", () => {
  it("shows only governance changes and keeps the full set in details", () => {
    const assessment = {
      status: "checked" as const,
      report: report({ declared: [claim(publisherDid)] }),
      governance: { governed: ["unchanged", "added"], added: ["added"], removed: ["removed"], previousKnown: true },
    };
    const summary = formatTrustSummary(assessment, config);
    expect(summary).toContain("Newly governed: added");
    expect(summary).toContain("No longer governed: removed");
    expect(summary).not.toContain("unchanged");
    expect(formatTrustDetails(assessment, config)).toContain("    - unchanged");
    const noChanges = formatTrustSummary({
      ...assessment, governance: { ...assessment.governance, added: [], removed: [] },
    }, config);
    expect(noChanges).not.toContain("Newly governed:");
    expect(noChanges).not.toContain("No longer governed:");
  });
  it("names the parties and reviewers without a warning when the publisher vouched", () => {
    const text = formatTrustSummary({
      status: "checked",
      report: report({
        declared: [claim(publisherDid)],
        others: [claim("did:web:auditor.example")],
        attestations: [
          review("0x4444444444444444444444444444444444444444", { approved: true, label: "OMA3 Security Lab" }),
          review("0x5555555555555555555555555555555555555555", { schema: "certification", approved: true }),
        ],
        linked: 2,
      }),
    }, config);

    expect(text).toBe([
      "Plugin: github-repo",
      "  Responsible parties (2):",
      "    publisher.example  ✓ declared publisher",
      "    auditor.example",
      "  Security reviews (1):",
      "    OMA3 Security Lab  ✓ approved assessor",
      `  ${RESPONSIBILITY_CLAIM_TRUST_NOTICE}`,
      `  ${DETAILS_HINT}`,
      "",
    ].join("\n"));
  });

  it("warns and names the missing publisher when only other parties claim the plugin", () => {
    const text = formatTrustSummary({
      status: "checked",
      report: report({ others: [claim("did:web:pub1isher.example")] }),
    }, config);

    expect(text).toContain(`WARNING: ${NO_PRIMARY_TRUST_EVIDENCE_WARNING}`);
    expect(text).toContain("    pub1isher.example\n");
    expect(text).not.toContain("✓");
    expect(text).toContain("No claim from the declared publisher, publisher.example");
    expect(text).toContain("  Security reviews: none found");
  });

  it("caps a flooded list and points to the details", () => {
    const others = Array.from(
      { length: SUMMARY_LIST_LIMIT + 3 },
      (_, index) => claim(`did:web:spam${index}.example`),
    );
    const text = formatTrustSummary({
      status: "checked",
      report: report({ declared: [claim(publisherDid)], others }),
    }, config);

    expect(text).toContain(`Responsible parties (${SUMMARY_LIST_LIMIT + 4}):`);
    expect(text.indexOf("publisher.example")).toBeLessThan(text.indexOf("spam0.example"));
    expect(text).toContain("+4 more (press D to see all)");
    expect(text).not.toContain(`spam${SUMMARY_LIST_LIMIT}.example`);
  });

  it("strips escape sequences that a claim tries to print", () => {
    const text = formatTrustSummary({
      status: "checked",
      report: report({ others: [claim("did:web:evil.example\x1b[2K")] }),
    }, config);
    expect(text).not.toContain("\x1b");
  });

  it("warns when OMATrust could not be reached", () => {
    const text = formatTrustSummary(
      { status: "notChecked", reason: "unavailable", detail: "Artifact trust API returned 502" },
      config,
    );
    expect(text).toContain("WARNING: OMATrust information could not be loaded.");
    expect(text).toContain("Artifact trust API returned 502");
    expect(text).toContain(NO_TRUST_CHECKS_WARNING);
    expect(text).toContain(DETAILS_HINT);
    expect(text).not.toContain(artifactDid);
  });

  it("emphasises names only when styling is on", () => {
    const parties = report({ declared: [claim(publisherDid)] });
    const styled = formatTrustSummary(
      { status: "checked", report: parties },
      config,
      terminalStyle(true, {}),
    );
    expect(styled).toContain("\x1b[1mpublisher.example\x1b[22m");
    expect(terminalStyle(true, { NO_COLOR: "1" })).toBe(PLAIN_STYLE);
    expect(terminalStyle(false, {})).toBe(PLAIN_STYLE);
  });
});

describe("formatTrustDetails", () => {
  it("lists every claim, attestation and linked identifier in full", () => {
    const text = formatTrustDetails({
      status: "checked",
      report: report({
        declared: [claim(publisherDid)],
        others: [claim("did:web:auditor.example")],
        attestations: [review("0x4444444444444444444444444444444444444444", { approved: true, label: "OMA3 Security Lab" })],
        linked: 1,
      }),
    }, config);

    expect(text).toContain(`Artifact: ${artifactDid}`);
    expect(text).toContain(`Declared publisher: ${publisherDid}`);
    expect(text).toContain("Responsibility claims from the declared publisher (1):");
    expect(text).toContain("Responsibility claims from other parties (1):");
    expect(text).toContain("- did:web:auditor.example; responsibility publisher;");
    expect(text).toContain(
      "- security-assessment; issuer OMA3 Security Lab (0x4444444444444444444444444444444444444444); approved issuer;",
    );
    expect(text).toContain("Linked identifiers (1):");
    expect(text).toContain(`${INDEPENDENT_VERIFY_NOTICE}\n    ${artifactDid}`);
  });

  it("keeps the verification link when OMATrust could not be reached", () => {
    const text = formatTrustDetails({ status: "notChecked", reason: "unavailable" }, config);
    expect(text).toContain(`${INDEPENDENT_VERIFY_NOTICE}\n    ${artifactDid}`);
  });
});
