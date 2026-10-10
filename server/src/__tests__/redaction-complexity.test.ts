import { describe, expect, it } from "vitest";
import { redactCommandText, redactDiagnosticText } from "@paperclipai/adapter-utils";
import { redactSensitiveText, sanitizeRecord } from "../redaction.js";

// Inputs that made a redaction regex take time that grows faster than the input.
// Each is a long run of one repeated unit after a word the text-hint filter
// accepts, so the scan cannot be skipped. The budget is generous: a linear scan
// of these takes tens of milliseconds, while the patterns they were built
// against needed seconds to minutes. A synchronous regex cannot be interrupted,
// so the elapsed time is checked after it returns.
const BUDGET_MS = 1_000;

const PATHOLOGICAL_INPUTS: Record<string, string> = {
  "a long hyphen separated run": `token ${"a1-".repeat(40_000)}`,
  "a long base64url run": `token ${"AbC1_-".repeat(40_000)}`,
  "a run of keywords": `x ${"token-".repeat(40_000)}`,
  "an unclosed quote before a run of keywords": `"${"token-".repeat(40_000)}`,
  "a run of authorization words": `x ${"authorization-".repeat(40_000)}`,
  "dashes glued to words": `token ${"a--".repeat(40_000)}`,
  "a chain of dotted segments": `${"abcdefgh.".repeat(80_000)}!`,
  "repeated quotes after an authorization label": 'Authorization "x '.repeat(30_000),
};

const ENTRY_POINTS: Record<string, (text: string) => unknown> = {
  "redactSensitiveText": redactSensitiveText,
  "redactCommandText": (text) => redactCommandText(text),
  "redactDiagnosticText": (text) => redactDiagnosticText(text),
  "sanitizeRecord key and argv": (text) => sanitizeRecord({ [text]: "v", argv: [text, "v"] }),
};

describe("redaction of long provider text", () => {
  for (const [entryName, redact] of Object.entries(ENTRY_POINTS)) {
    for (const [inputName, input] of Object.entries(PATHOLOGICAL_INPUTS)) {
      it(`${entryName} scans ${inputName} in time linear in its length`, () => {
        const started = performance.now();
        redact(input);
        expect(performance.now() - started).toBeLessThan(BUDGET_MS);
      });
    }
  }

  it("still redacts a secret field that follows a long hyphen separated run", () => {
    const text = `${"a1-".repeat(20_000)} {"apiKey":"s3cr3t-value"}`;
    const redacted = redactSensitiveText(text);
    expect(redacted).toContain('{"apiKey":"***REDACTED***"}');
    expect(redacted).not.toContain("s3cr3t-value");
  });

  it("still redacts an escaped secret field that follows a long hyphen separated run", () => {
    const text = `${"token-".repeat(20_000)} {\\"password\\":\\"s3cr3t-value\\"}`;
    const redacted = redactSensitiveText(text);
    expect(redacted).toContain('{\\"password\\":\\"***REDACTED***\\"}');
    expect(redacted).not.toContain("s3cr3t-value");
  });

  it("still redacts the credential of an Authorization label that follows many bare ones", () => {
    const text = `${'Authorization "x '.repeat(20_000)}Authorization: "Bearer s3cr3t-value"`;
    const redacted = redactSensitiveText(text);
    expect(redacted).toContain('Authorization: "***REDACTED***"');
    expect(redacted).not.toContain("s3cr3t-value");
  });

  it("redacts the value of a CLI secret flag and only of a flag", () => {
    expect(sanitizeRecord({ argv: ["--api-key", "s3cr3t", "--verbose", "keep"] }).argv).toEqual([
      "--api-key",
      "***REDACTED***",
      "--verbose",
      "keep",
    ]);
    expect(sanitizeRecord({ argv: ["--tool-token-name", "a", "token", "b"] }).argv).toEqual([
      "--tool-token-name",
      "***REDACTED***",
      "token",
      "b",
    ]);
  });

  it("redacts the credential after a proxyAuthorization label that ends in dashes", () => {
    expect(redactSensitiveText('proxyAuthorization-: "Bearer s3cr3t-value"')).not.toContain("s3cr3t-value");
  });
});
