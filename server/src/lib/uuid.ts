/**
 * Generic RFC 4122 UUID text shape.
 *
 * Paperclip stores entity ids in plain `uuid` columns (for example
 * `tool_mcp_gateways.id`), so this pattern must not pin a version or variant
 * nibble: a pinned pattern silently rejects ids the database itself accepts.
 * Import this single definition instead of re-deriving a UUID regex.
 */
export const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Anchored, case-insensitive matcher for a whole {@link UUID_SOURCE} value. */
export const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, "i");
