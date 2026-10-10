export const REDACTED_COMMAND_TEXT_VALUE = "***REDACTED***";

// These exact public Executor helper addresses resemble dotted bearer tokens.
// Do not exempt arbitrary provider paths, prefixes, or user-defined selectors.
const PUBLIC_EXECUTOR_TOOL_SELECTORS = new Set([
  "executor.coreTools.integrations.list",
  "executor.coreTools.connections.list",
  "executor.coreTools.policies.list",
]);
const MAX_PUBLIC_SELECTOR_LENGTH = Math.max(
  ...[...PUBLIC_EXECUTOR_TOOL_SELECTORS].map((selector) => selector.length),
);
export function isPublicExecutorToolSelector(value: string): boolean {
  return PUBLIC_EXECUTOR_TOOL_SELECTORS.has(value);
}

// A secret name is one whole run of name characters that contains a keyword. It
// is only tried from the start of its run (the lookbehind), and the run is read
// once: the lookahead finds the keyword, then the run is consumed greedily. An
// unanchored "name characters, keyword, name characters" pattern is tried from
// every position of a run and from every keyword inside it, which is quadratic
// on a long hyphen or underscore separated run such as a base64url blob.
const SECRET_NAME_KEYWORDS = String.raw`(?:api[-_]?key|(?:access[-_]?|auth[-_]?)?token|token|authorization|bearer|secret|passwd|password|credential|jwt|private[-_]?key|cookie|connectionstring)`;
const SECRET_NAME_PATTERN = String.raw`(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*?${SECRET_NAME_KEYWORDS})[A-Za-z0-9_-]+`;

// An option's dashes belong to its run. It starts at the run's first dash that
// follows a non-word character: the run's own first character, or the second
// dash of a "--" glued to words before it (`tool--token value`). The words before
// that dash are matched too, so the option is still tried once per run.
const COMMAND_CLI_SECRET_OPTION_RE = new RegExp(
  String.raw`((?<![A-Za-z0-9_-])(?:[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*-)?-{1,2}(?=[A-Za-z0-9_-]*?${SECRET_NAME_KEYWORDS})[A-Za-z0-9_-]+(?:\s+|=)(["']?))[^\s"'` +
    "`" +
    String.raw`]+(\2)`,
  "gi",
);
const COMMAND_ENV_SECRET_ASSIGNMENT_RE = new RegExp(
  String.raw`(${SECRET_NAME_PATTERN}\s*=\s*)(?:(\\["'])([\s\S]*?)\2|(["'])([^"'` +
    "`" +
    String.raw`\r\n]*)\4|([^\s"'` +
    "`" +
    String.raw`]+))`,
  "gi",
);
const COMMAND_AUTHORIZATION_BEARER_RE =
  /(\bAuthorization\s*:\s*Bearer\s+)[^\s"'`]+/gi;
const COMMAND_OPENAI_KEY_RE = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
const COMMAND_GITHUB_TOKEN_RE = /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g;
// Tried once per run, like a secret name. A run's leading dashes are not part of
// the first segment: the match begins at the run's first word character.
const COMMAND_JWT_RE =
  /(?<![A-Za-z0-9_-])(-*)\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g;
const DOTTED_ADDRESS_RE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/;
const COMMAND_SECRET_HINTS = [
  "api",
  "key",
  "token",
  "auth",
  "bearer",
  "secret",
  "pass",
  "credential",
  "jwt",
  "private",
  "cookie",
  "connectionstring",
  "sk-",
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
] as const;

function maybeContainsSecretText(command: string) {
  const lower = command.toLowerCase();
  return (
    COMMAND_SECRET_HINTS.some((hint) => lower.includes(hint)) ||
    command.includes(".")
  );
}

export function redactCommandText(
  command: string,
  redactedValue = REDACTED_COMMAND_TEXT_VALUE,
): string {
  if (!maybeContainsSecretText(command)) return command;
  return command
    .replace(COMMAND_AUTHORIZATION_BEARER_RE, `$1${redactedValue}`)
    .replace(COMMAND_CLI_SECRET_OPTION_RE, `$1${redactedValue}$3`)
    .replace(
      COMMAND_ENV_SECRET_ASSIGNMENT_RE,
      (
        _match,
        prefix: string,
        escapedQuote: string | undefined,
        _escapedValue: string | undefined,
        rawQuote: string | undefined,
      ) => {
        const quote = escapedQuote ?? rawQuote;
        return quote
          ? `${prefix}${quote}${redactedValue}${quote}`
          : `${prefix}${redactedValue}`;
      },
    )
    .replace(COMMAND_OPENAI_KEY_RE, redactedValue)
    .replace(COMMAND_GITHUB_TOKEN_RE, redactedValue)
    .replace(COMMAND_JWT_RE, (match, dashes: string, offset: number, source: string) => {
      // The JWT heuristic may match only the first three segments; inspect the
      // complete address so a longer secret sharing a prefix stays redacted.
      // Reading two characters past the longest public selector is enough to tell
      // it from a longer address, and keeps a long dotted chain from being read
      // again for every match inside it.
      const addressStart = offset + dashes.length;
      const address = source
        .slice(addressStart, addressStart + MAX_PUBLIC_SELECTOR_LENGTH + 2)
        .match(DOTTED_ADDRESS_RE)?.[0];
      return address && isPublicExecutorToolSelector(address) ? match : dashes + redactedValue;
    });
}

// A JSON secret field is a key/value pair such as `"token":"opaque-value"`. The
// command redaction handles shell `KEY=value` syntax only. A sandbox diagnostic
// can also carry a serialized JSON error, so the sanitizer must redact the JSON
// form too. The value body consumes JSON escape sequences. An escaped quote
// (`\"`) inside the value does not end the match early.
const JSON_SECRET_FIELD_RE = new RegExp(
  String.raw`("(?:${SECRET_NAME_PATTERN})"\s*:\s*")(?:\\[\s\S]|[^"\\])*(")`,
  "gi",
);
// An escaped JSON secret field is the same pair inside a JSON string. The double
// quote appears as `\"` and a backslash appears as `\\`. The value body
// consumes the doubled escape sequences. An escaped quote inside the value does
// not end the match early. The value ends at the next unescaped `\"`.
const JSON_ESCAPED_SECRET_FIELD_RE = new RegExp(
  String.raw`(\\"(?:${SECRET_NAME_PATTERN})\\"\s*:\s*\\")(?:\\\\\\\\|\\\\\\"|\\\\[\s\S]|[^\\"])*(\\")`,
  "gi",
);

/**
 * Redact secrets from an untrusted diagnostic string.
 *
 * The function first runs the command redaction. The command redaction handles
 * shell `KEY=value` assignments, CLI secret options, bearer headers, and common
 * token shapes. The function then redacts JSON and escaped-JSON secret fields,
 * because a sandbox diagnostic can carry a serialized JSON error such as
 * `{"token":"opaque-value"}`. The caller must still bound the length after this
 * step.
 */
export function redactDiagnosticText(
  text: string,
  redactedValue = REDACTED_COMMAND_TEXT_VALUE,
): string {
  return redactCommandText(text, redactedValue)
    .replace(JSON_ESCAPED_SECRET_FIELD_RE, `$1${redactedValue}$2`)
    .replace(JSON_SECRET_FIELD_RE, `$1${redactedValue}$2`);
}
