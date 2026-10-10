// Keep tooling and UI packages out of a production install.
//
// better-auth and @vercel/connect list these packages as optional peers for their test, CLI and
// React helpers. The server uses none of them at runtime, but the workspace has them as
// devDependencies (vitest, drizzle-kit) or UI dependencies (react-dom), so pnpm resolved each optional
// peer from the workspace and baked it, with its whole tree, into the package's snapshot. A
// `pnpm deploy --prod` then installed the test runner, the Drizzle CLI and the React DOM renderer.
// Dropping the declaration means it is never resolved. Only optional peers are dropped: a package
// that needs one of these cannot work without it, and keeps it.
const OPTIONAL_PEERS_THE_SERVER_DOES_NOT_USE = ["vitest", "drizzle-kit", "react-dom"];
const PACKAGES_THAT_LIST_THEM = new Set(["better-auth", "@vercel/connect"]);

function readPackage(pkg) {
  if (!PACKAGES_THAT_LIST_THEM.has(pkg.name)) return pkg;
  for (const peer of OPTIONAL_PEERS_THE_SERVER_DOES_NOT_USE) {
    if (pkg.peerDependenciesMeta?.[peer]?.optional !== true) continue;
    delete pkg.peerDependencies?.[peer];
    delete pkg.peerDependenciesMeta[peer];
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
