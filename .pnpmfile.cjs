// Keep tooling and UI packages out of a production install.
//
// better-auth and @vercel/connect list these packages as optional peers for their test, CLI and
// React helpers. The server uses none of them at runtime, but the workspace has them as
// devDependencies (vitest, drizzle-kit) or UI dependencies (react-dom), so pnpm resolved each optional
// peer from the workspace and baked it, with its whole tree, into the package's snapshot. A
// `pnpm deploy --prod` then installed the test runner, the Drizzle CLI and the React DOM renderer.
// Dropping the declaration means it is never resolved. Only optional peers are dropped: a package
// that needs one of these cannot work without it, and keeps it.
const TOOLING_PEERS = ["vitest", "drizzle-kit", "react-dom"];
const UNUSED_OPTIONAL_PEERS = new Map([
  ["better-auth", TOOLING_PEERS],
  ["@vercel/connect", TOOLING_PEERS],
  // Istanbul supplies this optional terminal-color helper in the workspace.
  // Debug works without it; it must not bring development tooling into deploys.
  ["debug", ["supports-color"]],
]);

function readPackage(pkg) {
  const peers = UNUSED_OPTIONAL_PEERS.get(pkg.name);
  if (!peers) return pkg;
  for (const peer of peers) {
    if (pkg.peerDependenciesMeta?.[peer]?.optional !== true) continue;
    delete pkg.peerDependencies?.[peer];
    delete pkg.peerDependenciesMeta[peer];
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
