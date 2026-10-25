const assert = require("node:assert/strict");
const { test } = require("node:test");
const { hooks: { readPackage } } = require(process.env.PNPMFILE);

for (const [name, peers] of [
  ["debug", ["supports-color"]],
  ["better-auth", ["vitest", "drizzle-kit", "react-dom"]],
  ["@vercel/connect", ["vitest", "drizzle-kit", "react-dom"]],
]) {
  test(`${name} removes only unused optional peers and their metadata`, () => {
    const pkg = {
      name,
      dependencies: { runtime: "^1.0.0" },
      peerDependencies: Object.fromEntries([...peers, "required"].map(peer => [peer, "*"])),
      peerDependenciesMeta: Object.fromEntries(peers.map(peer => [peer, { optional: true }])),
    };
    assert.deepEqual(readPackage(pkg), {
      name, dependencies: { runtime: "^1.0.0" },
      peerDependencies: { required: "*" }, peerDependenciesMeta: {},
    });
  });
}

test("required, unmarked and unrelated peers remain unchanged", () => {
  for (const pkg of [
    { name: "debug", peerDependencies: { "supports-color": "*" } },
    { name: "debug", peerDependencies: { "supports-color": "*" }, peerDependenciesMeta: { "supports-color": { optional: false } } },
    { name: "unrelated", peerDependencies: { "supports-color": "*" }, peerDependenciesMeta: { "supports-color": { optional: true } } },
    { name: "debug" },
  ]) {
    const original = structuredClone(pkg);
    assert.deepEqual(readPackage(pkg), original);
  }
});

test("orphan optional metadata is removed without requiring a peer declaration", () => {
  assert.deepEqual(readPackage({ name: "debug", peerDependenciesMeta: { "supports-color": { optional: true } } }), {
    name: "debug", peerDependenciesMeta: {},
  });
});
