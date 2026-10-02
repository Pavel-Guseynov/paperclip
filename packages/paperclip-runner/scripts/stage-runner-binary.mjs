import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

export async function stageRunnerBinary({
  packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  source = null,
  destinationDirectory = null,
} = {}) {
  const executable = process.platform === "win32" ? "paperclip-runnerd.exe" : "paperclip-runnerd";
  const resolvedSource = source ?? path.join(packageRoot, "runner", "target", "release", executable);
  const resolvedDestDir = destinationDirectory ?? path.join(packageRoot, "dist", "bin");
  const destination = path.join(resolvedDestDir, executable);

  await mkdir(resolvedDestDir, { recursive: true });
  await copyFile(resolvedSource, destination);
  if (process.platform !== "win32") await chmod(destination, 0o755);
  // Rust's linker emits an ad-hoc Mach-O signature. Copying that executable to
  // its package location preserves the bytes but can leave the kernel rejecting
  // the new inode with SIGKILL. Re-sign the staged inode so local packaged-runner
  // evals execute the same artifact that was just built.
  if (process.platform === "darwin") {
    await execFileAsync("codesign", ["--force", "--sign", "-", destination]);
  }
  return destination;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await stageRunnerBinary();
}
