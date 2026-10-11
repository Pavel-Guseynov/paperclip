// Maps every test file of the given workspace packages to the repository files it
// can reach through imports, so a test check can take exactly those files as input.
//
// Usage: node test-graph.mjs <repository root> <packages json> <output file>
// where the packages json is [{ "dir": "server", "alias": { "<specifier>": "<repo path>" } }].
//
// Output: { "<dir>": { "common": [files every test of the package needs], "tests": { "<test file>": [files] } } }.
// Files are repository-relative. Only imports are followed; a test that reads other
// files at run time declares them separately.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const [root, packagesJson, outFile] = process.argv.slice(2);
const repoRoot = realpathSync(root);
const packages = JSON.parse(packagesJson);
// Aliases are resolved the same way wherever a file is reached from, because each
// file's imports are read once.
const globalAlias = Object.assign({}, ...packages.map((entry) => entry.alias ?? {}));
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const TEST_FILE = /\.test\.(ts|tsx|mts|mjs|js)$/;
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|importActual|importMock)\s*\(\s*)["']([^"'\n]+)["']/g;

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (TEST_FILE.test(name)) out.push(full);
  }
  return out;
}

// A relative specifier may name the file with its compiled extension (./x.js for x.ts).
function resolveFile(base) {
  const stem = base.replace(/\.(m|c)?js$/, "");
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => base + extension),
    ...SOURCE_EXTENSIONS.map((extension) => stem + extension),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find(isFile) ?? null;
}

function resolveSpecifier(specifier, importer, alias) {
  if (alias[specifier]) return resolveFile(path.join(repoRoot, alias[specifier]));
  // A key ending in "/" aliases a whole prefix ("@/" for "ui/src/").
  for (const [prefix, target] of Object.entries(alias)) {
    if (prefix.endsWith("/") && specifier.startsWith(prefix)) {
      return resolveFile(path.join(repoRoot, target, specifier.slice(prefix.length)));
    }
  }
  if (specifier.startsWith(".")) return resolveFile(path.resolve(path.dirname(importer), specifier));
  if (specifier.startsWith("node:") || specifier.startsWith("data:")) return null;
  try {
    const resolved = realpathSync(createRequire(importer).resolve(specifier));
    return resolved.includes(`${path.sep}node_modules${path.sep}`) ? null : resolved;
  } catch {
    return null;
  }
}

// Files a module reads by name at run time are inputs too. A string literal that
// names an existing repository file (beside the module, under its package, under
// the repository root, or under any directory above it) is treated as an import of
// that file; the arguments of a path join or resolve call may also name a
// directory, whose files are all inputs. Over-approximating only widens an input.
const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);
const LITERAL = /["'`]([^"'`\n$]{2,200})["'`]/g;
const JOIN_CALL = /\b(?:join|resolve)\(([^()]*)\)/g;
const FILE_LITERAL = /(?:\/|\.[A-Za-z0-9]{1,6}$)/;
// Comments mention files without reading them.
const COMMENT = /\/\*[\s\S]*?\*\/|(^|[^:"'`\\])\/\/[^\n]*/g;

const statCache = new Map();
function statOf(candidate) {
  if (!statCache.has(candidate)) {
    try {
      statCache.set(candidate, statSync(candidate));
    } catch {
      statCache.set(candidate, null);
    }
  }
  return statCache.get(candidate);
}

// Where a relative name is looked up: beside the module, under its package, under the repository.
function anchorsFor(file) {
  let packageRoot = path.dirname(file);
  while (packageRoot !== repoRoot && !isFile(path.join(packageRoot, "package.json"))) packageRoot = path.dirname(packageRoot);
  return [...new Set([path.dirname(file), packageRoot, repoRoot])];
}

function insideRepository(candidate) {
  const relativePath = path.relative(repoRoot, candidate);
  return !relativePath.startsWith("..") && !relativePath.split(path.sep).some((part) => IGNORED_DIRECTORIES.has(part));
}

const MAX_DIRECTORY_FILES = 400;
const directoryFiles = new Map();
function filesBelow(dir) {
  if (!directoryFiles.has(dir)) {
    const out = [];
    const visit = (current) => {
      for (const name of readdirSync(current)) {
        if (IGNORED_DIRECTORIES.has(name)) continue;
        const full = path.join(current, name);
        if (statOf(full)?.isDirectory()) visit(full);
        else out.push(full);
        if (out.length > MAX_DIRECTORY_FILES) return;
      }
    };
    visit(dir);
    directoryFiles.set(dir, out.length > MAX_DIRECTORY_FILES ? [] : out);
  }
  return directoryFiles.get(dir);
}

// Data files are often named without their directory ("device-login-edge.txt" read
// from a fixtures directory next to the module), so a bare file name also matches
// files of that name elsewhere under the module's package.
let basenameIndex = null;
function filesNamed(name) {
  if (!basenameIndex) {
    basenameIndex = new Map();
    const visit = (dir) => {
      for (const entry of readdirSync(dir)) {
        if (IGNORED_DIRECTORIES.has(entry) || entry === "target" || entry === ".pnpm-store" || entry === "test-results") continue;
        const full = path.join(dir, entry);
        if (statOf(full)?.isDirectory()) visit(full);
        else basenameIndex.set(entry, [...(basenameIndex.get(entry) ?? []), full]);
      }
    };
    visit(repoRoot);
  }
  return basenameIndex.get(name) ?? [];
}

function namedFiles(rawText, file) {
  const text = rawText.replace(COMMENT, "$1");
  const found = new Set();
  const anchors = anchorsFor(file);
  const fileDirectory = path.dirname(file);
  const tryName = (name, allowDirectory) => {
    for (const anchor of anchors) {
      const candidate = path.resolve(anchor, name);
      if (!insideRepository(candidate)) continue;
      const info = statOf(candidate);
      if (!info) continue;
      if (info.isFile()) found.add(candidate);
      // A directory above the module is the module's own tree, not data it reads.
      else if (allowDirectory && info.isDirectory() && !fileDirectory.startsWith(candidate + path.sep) && candidate !== fileDirectory) {
        filesBelow(candidate).forEach((entry) => found.add(entry));
      }
    }
  };
  for (const match of text.matchAll(LITERAL)) {
    const name = match[1];
    if (!/\s/.test(name) && FILE_LITERAL.test(name) && !name.startsWith("http")) {
      tryName(name, false);
      if (!name.includes("/")) {
        const packageRoot = anchors[1];
        const nearby = filesNamed(name).filter((candidate) => candidate.startsWith(packageRoot + path.sep));
        if (nearby.length <= 8) nearby.forEach((candidate) => found.add(candidate));
      }
    }
  }
  for (const call of text.matchAll(JOIN_CALL)) {
    const parts = [...call[1].matchAll(/["']([^"']+)["']/g)].map((part) => part[1]);
    if (parts.length > 0) tryName(parts.join("/"), true);
  }
  return found;
}

const edgeCache = new Map();
function importsOf(file) {
  const alias = globalAlias;
  const key = file;
  let found = edgeCache.get(key);
  if (found) return found;
  found = new Set();
  edgeCache.set(key, found);
  if (/\.(ts|tsx|mts|js|jsx|mjs|cjs)$/.test(file)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(SPECIFIER)) {
      // A query or fragment ("./tokens.css?raw") selects how a bundler loads the file.
      const target = resolveSpecifier(match[1].replace(/[?#].*$/, ""), file, alias);
      if (target && target.startsWith(repoRoot + path.sep)) found.add(target);
    }
    for (const target of namedFiles(text, file)) if (target !== file) found.add(target);
  }
  return found;
}

function closureOf(entries, alias) {
  const seen = new Set(entries);
  const stack = [...entries];
  while (stack.length) {
    for (const next of importsOf(stack.pop())) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

// The vitest config and the setup files it names run before every test.
function sharedEntries(packageRoot) {
  const config = path.join(packageRoot, "vitest.config.ts");
  if (!existsSync(config)) return [];
  const entries = [config];
  const text = readFileSync(config, "utf8");
  for (const list of text.matchAll(/setupFiles\s*:\s*\[([^\]]*)\]/g)) {
    for (const item of list[1].matchAll(/["']([^"']+)["']/g)) {
      const resolved = resolveFile(path.resolve(packageRoot, item[1]));
      if (resolved) entries.push(resolved);
    }
  }
  return entries;
}

// Compact, deterministic output: every file gets an id, and the graph is the list of
// each file's direct imports. Closures are computed from it where they are used.
const relative = (file) => path.relative(repoRoot, file);
const ids = new Map();
const files = [];
function idOf(file) {
  const name = relative(file);
  let id = ids.get(name);
  if (id === undefined) {
    id = files.length;
    ids.set(name, id);
    files.push(name);
  }
  return id;
}

const packagesOut = {};
for (const { dir, alias = {} } of packages) {
  const packageRoot = path.join(repoRoot, dir);
  packagesOut[dir] = {
    common: sharedEntries(packageRoot).map((file) => idOf(realpathSync(file))),
    tests: walk(packageRoot).sort().map((test) => idOf(realpathSync(test))),
    alias,
  };
  // Touch every reachable file so each gets an id and its edges are recorded.
  for (const entry of [...packagesOut[dir].common, ...packagesOut[dir].tests]) {
    closureOf([path.join(repoRoot, files[entry])], alias);
  }
}
for (const file of edgeCache.keys()) idOf(file);

const edges = files.map((name) =>
  [...(edgeCache.get(path.join(repoRoot, name)) ?? [])].map(idOf).sort((left, right) => left - right),
);
// Files first seen as import targets get their ids above, after the edges were read.
const orderedFiles = files.slice();
writeFileSync(outFile, JSON.stringify({ files: orderedFiles, edges, packages: packagesOut }));
