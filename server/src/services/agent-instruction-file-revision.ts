import { createHash } from "node:crypto";

/** sha256 hex of the file bytes: the identity of one version of an instruction file. */
export function instructionFileHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The UUID-shaped content token that stands in for a revision id. It is derived from
 * the hash and holds no state: the same bytes always give the same token, and no
 * revision or history row exists. The version and variant nibbles keep it a valid UUID
 * for clients whose schema requires one.
 */
export function agentFileTokenFromHash(hash: string): string {
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function instructionFileRevision(bytes: Uint8Array): { id: string; contentHash: string } {
  const contentHash = instructionFileHash(bytes);
  return { id: agentFileTokenFromHash(contentHash), contentHash };
}
