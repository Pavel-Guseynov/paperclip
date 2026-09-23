import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedPnpmVersion = "11.21.0";
const expectedPackageManager = `pnpm@${expectedPnpmVersion}`;
const failures = [];
const skippedDirectories = new Set([".git", ".paperclip", "coverage", "data", "dist", "node_modules"]);

function relative(filePath) {
  return path.relative(repoRoot, filePath) || ".";
}

function walk(directory, visit) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(entryPath, visit);
    else if (entry.isFile()) visit(entryPath);
  }
}

// 1. Root package.json check
const rootPackageJsonPath = path.join(repoRoot, "package.json");
const rootManifest = JSON.parse(fs.readFileSync(rootPackageJsonPath, "utf8"));
if (rootManifest.packageManager !== expectedPackageManager) {
  failures.push(`package.json: packageManager must be ${expectedPackageManager}, found ${rootManifest.packageManager ?? "missing"}`);
}
if (rootManifest.pnpm !== undefined) {
  failures.push("package.json: root package.json must not have a 'pnpm' configuration section; pnpm 11 requires pnpm-workspace.yaml authority");
}

// 2. pnpm-workspace.yaml check
const workspaceYamlPath = path.join(repoRoot, "pnpm-workspace.yaml");
if (!fs.existsSync(workspaceYamlPath)) {
  failures.push("pnpm-workspace.yaml: missing file");
} else {
  const workspaceContent = fs.readFileSync(workspaceYamlPath, "utf8");
  if (!workspaceContent.includes("patchedDependencies:")) {
    failures.push("pnpm-workspace.yaml: must declare patchedDependencies");
  }
  if (!workspaceContent.includes("allowBuilds:")) {
    failures.push("pnpm-workspace.yaml: must declare explicit allowBuilds security policy");
  }
  if (!workspaceContent.includes("autoInstallPeers: false")) {
    failures.push("pnpm-workspace.yaml: must set autoInstallPeers: false for deterministic resolution");
  }
}

// 3. GitHub Actions workflow pnpm version pins
const workflowRoot = path.join(repoRoot, ".github", "workflows");
walk(workflowRoot, (filePath) => {
  if (!/\.ya?ml$/.test(filePath)) return;
  const source = fs.readFileSync(filePath, "utf8");
  for (const match of source.matchAll(/uses:\s*pnpm\/action-setup@[^\n]+[\s\S]*?version:\s*([^\s\n#]+)/g)) {
    if (match[1] !== expectedPnpmVersion) {
      failures.push(`${relative(filePath)}: pnpm action-setup version must be ${expectedPnpmVersion}, found ${match[1]}`);
    }
  }
});

// 4. Dockerfile pnpm version pins
const daytonaDockerfile = path.join(repoRoot, "docker", "daytona-runner", "Dockerfile");
if (fs.existsSync(daytonaDockerfile)) {
  const source = fs.readFileSync(daytonaDockerfile, "utf8");
  if (!source.includes(`corepack prepare ${expectedPackageManager} --activate`)) {
    failures.push(`docker/daytona-runner/Dockerfile: must contain 'corepack prepare ${expectedPackageManager} --activate'`);
  }
}

// 5. Documentation requirements
const docChecks = [
  ["README.md", "pnpm 11.21+"],
  ["cli/README.md", "pnpm 11.21+"],
  ["doc/DEVELOPING.md", "pnpm 11+"],
  ["docs/start/architecture.md", "pnpm 11 with workspaces"],
  ["docs/deploy/local-development.md", "pnpm 11+"],
  ["docs/start/quickstart.md", "pnpm 11+"],
];

for (const [docPath, snippet] of docChecks) {
  const fullPath = path.join(repoRoot, docPath);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, "utf8");
    if (!content.includes(snippet)) {
      failures.push(`${docPath}: must contain requirement documentation '${snippet}'`);
    }
  }
}

if (failures.length > 0) {
  console.error("pnpm version policy check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`pnpm version policy check passed (${expectedPackageManager}, pnpm-workspace.yaml authority, workflows, Docker, and docs).`);
