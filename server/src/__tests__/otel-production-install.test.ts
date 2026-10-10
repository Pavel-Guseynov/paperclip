import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(serverDir, "..");

// The SDK, the auto-instrumentations bundle, the resource helpers and the OTLP/HTTP exporter
// must ship with the server, or a production install exports nothing even with the endpoint set.
const INSTALLED_WITH_SERVER = [
  "@opentelemetry/auto-instrumentations-node",
  "@opentelemetry/exporter-trace-otlp-proto",
  "@opentelemetry/resources",
  "@opentelemetry/sdk-node",
  "@opentelemetry/semantic-conventions",
];

describe("OpenTelemetry packages in a production install", () => {
  const deployDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(deployDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("declares the exporter packages as installed dependencies at the exact peer versions", async () => {
    const manifest = JSON.parse(await readFile(path.join(serverDir, "package.json"), "utf8")) as {
      optionalDependencies?: Record<string, string>;
      peerDependencies: Record<string, string>;
    };

    for (const name of INSTALLED_WITH_SERVER) {
      expect(manifest.optionalDependencies?.[name], name).toBe(manifest.peerDependencies[name]);
    }
  });

  it("loads the SDK and the OTLP exporter from a production deploy of the server", async () => {
    const deployDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-prod-install-"));
    deployDirs.push(deployDir);

    await run("pnpm", ["--filter", "@paperclipai/server", "deploy", "--prod", deployDir], { cwd: repoRoot });
    const { stdout } = await run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const names = ${JSON.stringify(INSTALLED_WITH_SERVER)};
         const loaded = {};
         for (const name of names) loaded[name] = Object.keys(await import(name)).length > 0;
         const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-proto");
         loaded.exporterConstructible = typeof new OTLPTraceExporter({ url: "http://127.0.0.1:4318/v1/traces" }).export === "function";
         console.log(JSON.stringify(loaded));`,
      ],
      { cwd: deployDir },
    );

    expect(JSON.parse(stdout)).toEqual({
      ...Object.fromEntries(INSTALLED_WITH_SERVER.map((name) => [name, true])),
      exporterConstructible: true,
    });
  }, 180_000);
});
