import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

interface PackageMeta {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

interface DeployedLockfile {
  importers: Record<string, { dependencies?: Record<string, { version: string }>; optionalDependencies?: Record<string, { version: string }> }>;
  packages: Record<string, PackageMeta>;
  snapshots: Record<string, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>;
}

/**
 * `name@1.2.3(peer@1)(peer@2)` -> `name@1.2.3`. A workspace package injected by the deploy is
 * `name@file:<path>`; its path differs per deploy, so it is keyed by name alone.
 */
function withoutPeerSuffix(key: string) {
  const open = key.indexOf("(");
  const base = open === -1 ? key : key.slice(0, open);
  return base.replace(/@file:.*$/, "@file");
}

/** The lockfile keeps an alias as `real-name@1.2.3` in the version slot; a plain version starts with a digit. */
function edgeKey(name: string, version: string) {
  if (version.startsWith("link:")) return null;
  if (version.startsWith("file:")) return `${name}@file`;
  return /^[0-9]/.test(version) ? `${name}@${version}` : version;
}

/** `@scope+name@1.2.3_peers` (a `.pnpm` directory) -> `@scope/name@1.2.3` */
export function packageOfStoreEntry(entry: string) {
  const at = entry.indexOf("@", 1);
  if (at === -1) return entry;
  const name = entry.slice(0, at).replace("+", "/");
  const version = entry.slice(at + 1).split("_")[0]!;
  return version.startsWith("file+") ? `${name}@file` : `${name}@${version}`;
}

/**
 * Packages that `pnpm deploy --prod` installed but that the deployed project cannot reach through
 * `dependencies` and `optionalDependencies` alone. An edge the declaring package marks as an
 * optional peer is not followed: the package works without it, so it is not a runtime need.
 */
export async function unreachableInstalledPackages(deployDir: string) {
  const storeDir = path.join(deployDir, "node_modules", ".pnpm");
  const lock = parse(await readFile(path.join(storeDir, "lock.yaml"), "utf8")) as DeployedLockfile;
  const reachable = new Set<string>();
  const queue: string[] = [];
  const visit = (key: string | null) => {
    if (!key || reachable.has(key)) return;
    reachable.add(key);
    queue.push(key);
  };
  const root = lock.importers["."];
  for (const group of [root?.dependencies, root?.optionalDependencies]) {
    for (const [name, { version }] of Object.entries(group ?? {})) visit(edgeKey(name, version));
  }
  // `reachable` holds snapshot keys without their peer suffix; visit every snapshot of that package.
  const snapshotKeysOf = new Map<string, string[]>();
  for (const key of Object.keys(lock.snapshots)) {
    const base = withoutPeerSuffix(key);
    snapshotKeysOf.set(base, [...(snapshotKeysOf.get(base) ?? []), key]);
  }
  const packageMeta = new Map(Object.entries(lock.packages).map(([key, meta]) => [withoutPeerSuffix(key), meta]));
  while (queue.length > 0) {
    const base = withoutPeerSuffix(queue.shift()!);
    const meta = packageMeta.get(base) ?? {};
    for (const snapshotKey of snapshotKeysOf.get(base) ?? []) {
      const snapshot = lock.snapshots[snapshotKey]!;
      for (const group of [snapshot.dependencies, snapshot.optionalDependencies]) {
        for (const [name, version] of Object.entries(group ?? {})) {
          const optionalPeer =
            meta.peerDependencies?.[name] !== undefined &&
            meta.peerDependenciesMeta?.[name]?.optional === true &&
            meta.dependencies?.[name] === undefined &&
            meta.optionalDependencies?.[name] === undefined;
          if (!optionalPeer) visit(edgeKey(name, version));
        }
      }
    }
  }
  const reachableBases = new Set([...reachable].map(withoutPeerSuffix));
  const installed = new Set(
    (await readdir(storeDir))
      .filter((entry) => entry !== "node_modules" && entry !== "lock.yaml")
      .map(packageOfStoreEntry),
  );
  return [...installed].filter((entry) => !reachableBases.has(entry)).sort();
}
