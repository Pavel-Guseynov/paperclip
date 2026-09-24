import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkspacePatchedDependencies } from "./prepare-bundled-package.mjs";

export const expectedPnpmVersion = "11.21.0";
const expectedPackageManager = `pnpm@${expectedPnpmVersion}`;
const skippedDirectories = new Set([".git", ".paperclip", "coverage", "data", "dist", "node_modules"]);

// Documents that state the pnpm prerequisite, with the text each must contain.
export const documentedPrerequisites = [
  ["README.md", "pnpm 11.21+"],
  ["cli/README.md", "pnpm 11.21+"],
  ["doc/DEVELOPING.md", "pnpm 11+"],
  ["docs/start/architecture.md", "pnpm 11 with workspaces"],
  ["docs/deploy/local-development.md", "pnpm 11+"],
  ["docs/start/quickstart.md", "pnpm 11+"],
];

function walk(directory, visit) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(entryPath, visit);
    else if (entry.isFile()) visit(entryPath);
  }
}

// Lines of one top-level YAML block, without blank and comment-only lines.
function topLevelBlock(source, key) {
  const lines = [];
  let inBlock = false;
  for (const line of source.split("\n")) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (/^\S/.test(line)) {
      inBlock = new RegExp(`^${key}:\\s*(#.*)?$`).test(line);
      continue;
    }
    if (inBlock) lines.push(line);
  }
  return lines;
}

export function checkPnpmVersionPolicy(repoRoot) {
  const failures = [];
  const relative = (filePath) => path.relative(repoRoot, filePath) || ".";

  // 1. Root package.json
  const rootManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  if (rootManifest.packageManager !== expectedPackageManager) {
    failures.push(`package.json: packageManager must be ${expectedPackageManager}, found ${rootManifest.packageManager ?? "missing"}`);
  }
  if (rootManifest.pnpm !== undefined) {
    failures.push("package.json: root package.json must not have a 'pnpm' configuration section; pnpm 11 requires pnpm-workspace.yaml authority");
  }

  // 2. pnpm-workspace.yaml
  const workspaceYamlPath = path.join(repoRoot, "pnpm-workspace.yaml");
  if (!fs.existsSync(workspaceYamlPath)) {
    failures.push("pnpm-workspace.yaml: missing file");
  } else {
    const workspaceContent = fs.readFileSync(workspaceYamlPath, "utf8");
    if (!/^autoInstallPeers:\s*false\s*(#.*)?$/m.test(workspaceContent)) {
      failures.push("pnpm-workspace.yaml: must set autoInstallPeers: false for deterministic resolution");
    }

    let patchedDependencies = null;
    try {
      patchedDependencies = readWorkspacePatchedDependencies(repoRoot);
    } catch (error) {
      failures.push(`pnpm-workspace.yaml: ${error.message}`);
    }
    if (patchedDependencies !== null && Object.keys(patchedDependencies).length === 0) {
      failures.push("pnpm-workspace.yaml: must declare patchedDependencies");
    }
    for (const [specifier, patchPath] of Object.entries(patchedDependencies ?? {})) {
      if (!fs.existsSync(path.join(repoRoot, patchPath))) {
        failures.push(`pnpm-workspace.yaml: patch for ${specifier} does not exist: ${patchPath}`);
      }
    }

    const allowBuilds = topLevelBlock(workspaceContent, "allowBuilds");
    if (allowBuilds.length === 0) {
      failures.push("pnpm-workspace.yaml: must declare explicit allowBuilds security policy");
    }
    for (const line of allowBuilds) {
      if (!/^\s+(?:"[^"]+"|'[^']+'|[^\s#"'][^:]*?)\s*:\s*(true|false)\s*(#.*)?$/.test(line)) {
        failures.push(`pnpm-workspace.yaml: allowBuilds entries must be package: true|false, found '${line.trim()}'`);
      }
    }
  }

  // 3. GitHub Actions workflow pnpm version pins, checked per setup step
  const workflowRoot = path.join(repoRoot, ".github", "workflows");
  if (fs.existsSync(workflowRoot)) {
    walk(workflowRoot, (filePath) => {
      if (!/\.ya?ml$/.test(filePath)) return;
      const lines = fs.readFileSync(filePath, "utf8").split("\n");
      lines.forEach((line, index) => {
        const setup = line.match(/^(\s*)(?:-\s+)?uses:\s*pnpm\/action-setup@/);
        if (!setup) return;
        // The step ends at the next list item at or above the step's indentation.
        const stepIndent = setup[1].length - (line.trimStart().startsWith("-") ? 0 : 2);
        let version = null;
        for (let next = index + 1; next < lines.length; next += 1) {
          const candidate = lines[next];
          const itemIndent = candidate.match(/^(\s*)-\s/);
          if (itemIndent && itemIndent[1].length <= stepIndent) break;
          const pin = candidate.match(/^\s+version:\s*["']?([^\s"'#]+)/);
          if (pin) {
            version = pin[1];
            break;
          }
        }
        if (version !== expectedPnpmVersion) {
          failures.push(`${relative(filePath)}:${index + 1}: pnpm action-setup version must be ${expectedPnpmVersion}, found ${version ?? "none"}`);
        }
      });
    });
  }

  // 4. Dockerfile pnpm version pins
  const daytonaDockerfile = path.join(repoRoot, "docker", "daytona-runner", "Dockerfile");
  if (fs.existsSync(daytonaDockerfile)) {
    const source = fs.readFileSync(daytonaDockerfile, "utf8");
    if (!source.includes(`corepack prepare ${expectedPackageManager} --activate`)) {
      failures.push(`docker/daytona-runner/Dockerfile: must contain 'corepack prepare ${expectedPackageManager} --activate'`);
    }
  }

  // 5. Documented prerequisites
  for (const [docPath, snippet] of documentedPrerequisites) {
    const fullPath = path.join(repoRoot, docPath);
    if (!fs.existsSync(fullPath)) {
      failures.push(`${docPath}: missing; it documents the pnpm prerequisite`);
      continue;
    }
    if (!fs.readFileSync(fullPath, "utf8").includes(snippet)) {
      failures.push(`${docPath}: must contain requirement documentation '${snippet}'`);
    }
  }

  // 6. No active pnpm 9 references in tracked files. Dated logs and plans are
  // historical records.
  const historicalDirectories = ["doc/logs/", "doc/plans/"];
  const scannedFile = /(\.(md|mdx|ya?ml|json|mjs|cjs|js|ts|tsx|sh)|Dockerfile)$/;
  const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  for (const relativePath of trackedFiles) {
    if (!scannedFile.test(relativePath) || relativePath === "pnpm-lock.yaml") continue;
    if (historicalDirectories.some((directory) => relativePath.startsWith(directory))) continue;
    if (relativePath === "scripts/check-pnpm-version-policy.mjs") continue;
    if (relativePath === "scripts/check-pnpm-version-policy.test.mjs") continue;
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    if (/pnpm@9\.|pnpm 9\b|pnpm v9\b/.test(source)) {
      failures.push(`${relativePath}: references pnpm 9; the supported toolchain is ${expectedPackageManager}`);
    }
  }

  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const failures = checkPnpmVersionPolicy(repoRoot);
  if (failures.length > 0) {
    console.error("pnpm version policy check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
  console.log(`pnpm version policy check passed (${expectedPackageManager}, pnpm-workspace.yaml authority, workflows, Docker, and docs).`);
}
