/**
 * Route-level coverage for the plugin install security floor:
 *
 * - Cloud-managed instances (PAPERCLIP_MANAGED_CONFIG present) may only
 *   install plugins whose source canonicalizes into the bundled plugin
 *   catalog root; npm installs and arbitrary local paths are rejected.
 * - Every instance canonicalizes and validates `localPath` (traversal,
 *   symlink, and absolute-path handling) before the loader runs.
 * - Self-hosted non-localPath install validation is unchanged.
 */
import express from "express";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { companies, createDb, pluginConfig, pluginWebhookDeliveries, plugins } from "@paperclipai/db";
import { pluginLoader, REPO_ROOT } from "../services/plugin-loader.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const mockLifecycle = vi.hoisted(() => ({
  load: vi.fn(),
  upgrade: vi.fn(),
  unload: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
}));

vi.mock("../services/plugin-lifecycle.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/plugin-lifecycle.js")>();
  return {
    ...original,
    pluginLifecycleManager: (...args: Parameters<typeof original.pluginLifecycleManager>) => {
      const lifecycle = original.pluginLifecycleManager(...args);
      return {
        ...lifecycle,
        load: mockLifecycle.load.mockImplementation(lifecycle.load.bind(lifecycle)),
        upgrade: mockLifecycle.upgrade.mockImplementation(lifecycle.upgrade.bind(lifecycle)),
        unload: mockLifecycle.unload.mockImplementation(lifecycle.unload.bind(lifecycle)),
        enable: mockLifecycle.enable.mockImplementation(lifecycle.enable.bind(lifecycle)),
        disable: mockLifecycle.disable.mockImplementation(lifecycle.disable.bind(lifecycle)),
      };
    },
  };
});

vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../services/live-events.js", () => ({
  publishGlobalLiveEvent: vi.fn(),
}));

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe.sequential : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping plugin install route security tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const CLOUD_MANAGED_CONFIG = JSON.stringify({
  v: 1,
  mode: "cloud",
  catalogVersion: "2026.720.0",
  features: {},
  plugins: { autoInstall: [] },
});

const repoPluginRoot = path.join(REPO_ROOT, "packages", "plugins");

type FixturePlugin = {
  packageName: string;
  pluginKey: string;
  packageRoot: string;
};

/**
 * Create a valid, already-built plugin package (dist written directly, so no
 * pnpm auto-build runs during install) at an arbitrary directory.
 */
async function createBuiltPluginFixture(parentDir: string, nameSuffix: string, webhook = false): Promise<FixturePlugin> {
  const slug = `plugin-install-guard-${nameSuffix}-${randomUUID().slice(0, 8)}`;
  const packageName = `@paperclipai/${slug}`;
  const pluginKey = `paperclip.${slug.replace(/^plugin-/, "").replace(/-/g, "_")}`;
  const packageRoot = path.join(parentDir, slug);
  const distDir = path.join(packageRoot, "dist");

  await mkdir(distDir, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: packageName,
      version: "0.1.0",
      private: true,
      type: "module",
      paperclipPlugin: {
        manifest: "./dist/manifest.js",
        worker: "./dist/worker.js",
      },
    }, null, 2),
    "utf8",
  );

  const manifest = {
    id: pluginKey,
    apiVersion: 1,
    version: "0.1.0",
    displayName: "Install Guard Fixture",
    description: "Plugin fixture for install-route security floor coverage.",
    author: "Paperclip",
    categories: ["automation"],
    capabilities: webhook ? ["companies.read", "webhooks.receive"] : ["companies.read"],
    ...(webhook ? { webhooks: [{ endpointKey: "gitea", displayName: "CI" }] } : {}),
    entrypoints: {
      worker: "./dist/worker.js",
    },
  };
  await writeFile(
    path.join(distDir, "manifest.js"),
    `export default ${JSON.stringify(manifest, null, 2)};\n`,
    "utf8",
  );
  await writeFile(path.join(distDir, "worker.js"), "export {};\n", "utf8");

  return { packageName, pluginKey, packageRoot };
}

async function createInstallApp(db: ReturnType<typeof createDb>, isInstanceAdmin = true, workerManager?: { call: ReturnType<typeof vi.fn> }) {
  const [{ pluginRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/plugins.js"),
    import("../middleware/index.js"),
  ]);

  const loader = pluginLoader(db, {
    enableLocalFilesystem: false,
    enableNpmDiscovery: false,
  });

  const app = express();
  app.use(express.json({ verify(req, _res, bytes) { Object.assign(req, { rawBody: Buffer.from(bytes) }); } }));
  app.use((req, _res, next) => {
    req.actor = {
      type: "board",
      userId: "admin-1",
      source: "session",
      isInstanceAdmin,
      companyIds: [],
    } as typeof req.actor;
    next();
  });
  app.use("/api", pluginRoutes(db as never, loader as never, {} as never, workerManager ? { workerManager } as never : undefined));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("plugin install route security floor", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const cleanupPaths = new Set<string>();
  const originalManagedConfig = process.env["PAPERCLIP_MANAGED_CONFIG"];

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-plugin-install-guard-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    vi.clearAllMocks();
    await db.delete(plugins);
    await db.delete(companies);
    for (const cleanupPath of cleanupPaths) {
      await rm(cleanupPath, { recursive: true, force: true });
    }
    cleanupPaths.clear();
    if (originalManagedConfig === undefined) {
      delete process.env["PAPERCLIP_MANAGED_CONFIG"];
    } else {
      process.env["PAPERCLIP_MANAGED_CONFIG"] = originalManagedConfig;
    }
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  }, 30_000);

  describe("cloud-managed instances", () => {
    it("rejects npm installs outright", async () => {
      process.env["PAPERCLIP_MANAGED_CONFIG"] = CLOUD_MANAGED_CONFIG;
      const app = await createInstallApp(db);

      const res = await request(app)
        .post("/api/plugins/install")
        .send({ packageName: "paperclip-plugin-anything", version: "1.0.0" });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("npm installs are disabled on cloud-managed instances");
      expect(mockLifecycle.load).not.toHaveBeenCalled();
    });

    it("rejects npm installs even when the managed config document is corrupted", async () => {
      // The fail-closed startup parser refuses to boot a managed instance
      // with a corrupted document, so boot with a valid one and corrupt it
      // afterwards: the install floor must still hold because it keys off
      // the variable's presence at request time, never its parsed content.
      process.env["PAPERCLIP_MANAGED_CONFIG"] = CLOUD_MANAGED_CONFIG;
      const app = await createInstallApp(db);
      process.env["PAPERCLIP_MANAGED_CONFIG"] = "{definitely not json";

      const res = await request(app)
        .post("/api/plugins/install")
        .send({ packageName: "paperclip-plugin-anything" });

      expect(res.status).toBe(403);
      expect(mockLifecycle.load).not.toHaveBeenCalled();
    });

    it("rejects localPath installs from outside the bundled catalog root", async () => {
      process.env["PAPERCLIP_MANAGED_CONFIG"] = CLOUD_MANAGED_CONFIG;
      const outsideDir = await mkdtemp(path.join(os.tmpdir(), "guard-outside-"));
      cleanupPaths.add(outsideDir);
      const fixture = await createBuiltPluginFixture(outsideDir, "outside");
      const app = await createInstallApp(db);

      const res = await request(app)
        .post("/api/plugins/install")
        .send({ packageName: fixture.packageRoot, isLocalPath: true });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("bundled plugin catalog");
      expect(mockLifecycle.load).not.toHaveBeenCalled();
    });

    it("rejects localPath traversal that escapes the bundled catalog root", async () => {
      process.env["PAPERCLIP_MANAGED_CONFIG"] = CLOUD_MANAGED_CONFIG;
      const app = await createInstallApp(db);

      // Starts under packages/plugins but canonicalizes to the repo's server
      // directory — a real, readable directory outside the catalog.
      const traversalPath = path.join(repoPluginRoot, "..", "..", "server");
      const res = await request(app)
        .post("/api/plugins/install")
        .send({ packageName: traversalPath, isLocalPath: true });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("bundled plugin catalog");
      expect(mockLifecycle.load).not.toHaveBeenCalled();
    });

    it("rejects a symlink inside the catalog root that points outside it", async () => {
      process.env["PAPERCLIP_MANAGED_CONFIG"] = CLOUD_MANAGED_CONFIG;
      const outsideDir = await mkdtemp(path.join(os.tmpdir(), "guard-symlink-target-"));
      cleanupPaths.add(outsideDir);
      const fixture = await createBuiltPluginFixture(outsideDir, "symlink-target");

      const linkPath = path.join(repoPluginRoot, `guard-sneaky-link-${randomUUID().slice(0, 8)}`);
      cleanupPaths.add(linkPath);
      await symlink(fixture.packageRoot, linkPath, "dir");
      const app = await createInstallApp(db);

      const res = await request(app)
        .post("/api/plugins/install")
        .send({ packageName: linkPath, isLocalPath: true });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("bundled plugin catalog");
      expect(mockLifecycle.load).not.toHaveBeenCalled();
    });

    it("allows installing a plugin from inside the bundled catalog root", async () => {
      process.env["PAPERCLIP_MANAGED_CONFIG"] = CLOUD_MANAGED_CONFIG;
      const fixture = await createBuiltPluginFixture(repoPluginRoot, "bundled");
      cleanupPaths.add(fixture.packageRoot);
      const app = await createInstallApp(db);

      const res = await request(app)
        .post("/api/plugins/install")
        .send({ packageName: fixture.packageRoot, isLocalPath: true });

      expect(res.status).toBe(200);
      expect(res.body.packageName).toBe(fixture.packageName);
      expect(res.body.pluginKey).toBe(fixture.pluginKey);
      expect(mockLifecycle.load).toHaveBeenCalledTimes(1);
    }, 30_000);
  });

  describe("all instances: localPath canonicalization", () => {
    it("rejects a nonexistent localPath with a validation error", async () => {
      const app = await createInstallApp(db);

      const res = await request(app)
        .post("/api/plugins/install")
        .send({ packageName: "/nonexistent/plugin/dir", isLocalPath: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid localPath");
      expect(res.body.error).toContain("does not exist");
      expect(mockLifecycle.load).not.toHaveBeenCalled();
    });

    it("rejects a localPath containing a null byte", async () => {
      const app = await createInstallApp(db);

      const res = await request(app)
        .post("/api/plugins/install")
        .send({ packageName: "/tmp/foo\u0000bar", isLocalPath: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid localPath");
      expect(res.body.error).toContain("null byte");
      expect(mockLifecycle.load).not.toHaveBeenCalled();
    });

    it("rejects a localPath that resolves to a file", async () => {
      const outsideDir = await mkdtemp(path.join(os.tmpdir(), "guard-file-"));
      cleanupPaths.add(outsideDir);
      const filePath = path.join(outsideDir, "plugin.tgz");
      await writeFile(filePath, "not a directory", "utf8");
      const app = await createInstallApp(db);

      const res = await request(app)
        .post("/api/plugins/install")
        .send({ packageName: filePath, isLocalPath: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid localPath");
      expect(res.body.error).toContain("not a directory");
      expect(mockLifecycle.load).not.toHaveBeenCalled();
    });

    it("canonicalizes traversal segments before installing (self-hosted)", async () => {
      const outsideDir = await mkdtemp(path.join(os.tmpdir(), "guard-traversal-"));
      cleanupPaths.add(outsideDir);
      const fixture = await createBuiltPluginFixture(outsideDir, "traversal");
      const slug = path.basename(fixture.packageRoot);
      const traversalPath = path.join(outsideDir, "..", path.basename(outsideDir), ".", slug);
      const app = await createInstallApp(db);

      const res = await request(app)
        .post("/api/plugins/install")
        .send({ packageName: traversalPath, isLocalPath: true });

      expect(res.status).toBe(200);
      expect(res.body.packageName).toBe(fixture.packageName);
      expect(res.body.packagePath).toBe(path.resolve(fixture.packageRoot));
      expect(mockLifecycle.load).toHaveBeenCalledTimes(1);
    }, 30_000);

    it("retains the stable source for a symlinked localPath install", async () => {
      const outsideDir = await mkdtemp(path.join(os.tmpdir(), "guard-selfhosted-symlink-"));
      cleanupPaths.add(outsideDir);
      const fixture = await createBuiltPluginFixture(outsideDir, "symlinked");
      const linkPath = path.join(outsideDir, "linked-plugin");
      await symlink(fixture.packageRoot, linkPath, "dir");
      const app = await createInstallApp(db);

      const res = await request(app)
        .post("/api/plugins/install")
        .send({ packageName: linkPath, isLocalPath: true });

      expect(res.status).toBe(200);
      expect(res.body.packageName).toBe(fixture.packageName);
      expect(res.body.packagePath).toBe(path.resolve(linkPath));
      expect(mockLifecycle.load).toHaveBeenCalledTimes(1);
    }, 30_000);
  });

  describe("local source recovery", () => {
    it.each(["same target", "new generation", "disabled", "error", "installed", "uninstalled", "different target", "missing target", "blank source", "non-string source", "non-admin", "cloud"])("handles %s without replacing the plugin", async (scenario) => {
      const parent = await mkdtemp(path.join(os.tmpdir(), "plugin-source-recovery-"));
      cleanupPaths.add(parent);
      const fixture = await createBuiltPluginFixture(parent, "source");
      const app = await createInstallApp(db);
      const installed = await request(app).post("/api/plugins/install")
        .send({ packageName: fixture.packageRoot, isLocalPath: true });
      expect(installed.status).toBe(200);
      const initialStatus = ["disabled", "error", "installed", "uninstalled"].includes(scenario) ? scenario : installed.body.status;
      await db.update(plugins).set({ status: initialStatus }).where(eq(plugins.id, installed.body.id));
      const companyId = randomUUID();
      await db.insert(companies).values({ id: companyId, name: "Source recovery", issuePrefix: `SRC${companyId.slice(0, 8)}` });
      const config = { secretRef: { type: "secret_ref", secretId: randomUUID() } };
      await db.insert(pluginConfig).values({ pluginId: installed.body.id, companyId, configJson: config });
      const link = path.join(parent, "current");
      let source: unknown = link;
      let target = scenario === "different target" ? parent : fixture.packageRoot;
      if (scenario === "new generation") {
        target = path.join(parent, "next-generation");
        await cp(fixture.packageRoot, target, { recursive: true });
        await rm(fixture.packageRoot, { recursive: true });
      }
      if (scenario !== "missing target") await symlink(target, link, "dir");
      if (scenario === "blank source") source = " ";
      if (scenario === "non-string source") source = 42;
      const caller = scenario === "non-admin" ? await createInstallApp(db, false) : app;
      if (scenario === "cloud") process.env.PAPERCLIP_MANAGED_CONFIG = CLOUD_MANAGED_CONFIG;
      const repaired = await request(caller).post(`/api/plugins/${installed.body.id}/upgrade`).send({ packagePath: source });
      const accepted = ["same target", "new generation", "disabled", "error", "installed"].includes(scenario);
      expect(repaired.status).toBe(accepted ? 200 : ["non-admin", "cloud"].includes(scenario) ? 403 : 400);
      const read = await request(app).get(`/api/plugins/${installed.body.id}`);
      expect(read.status).toBe(200);
      expect(read.body.id).toBe(installed.body.id);
      expect(read.body.packageName).toBe(fixture.packageName);
      expect(read.body.version).toBe(installed.body.version);
      expect(read.body.status).toBe(accepted && initialStatus !== "disabled" ? "ready" : initialStatus);
      expect(read.body.packagePath).toBe(accepted ? path.resolve(link) : installed.body.packagePath);
      const configs = await db.select().from(pluginConfig);
      expect(configs).toHaveLength(1);
      expect(configs[0]?.configJson).toEqual(config);
    });
  });

  describe("webhook company invocation", () => {
    it.each(["configured", "unconfigured", "malformed", "repeated", "instance"])("validates the %s company selector before dispatch", async (scenario) => {
      const parent = await mkdtemp(path.join(os.tmpdir(), "plugin-webhook-company-"));
      cleanupPaths.add(parent);
      const fixture = await createBuiltPluginFixture(parent, "webhook", true);
      const workerManager = { call: vi.fn(async () => undefined) };
      const app = await createInstallApp(db, true, workerManager);
      const installed = await request(app).post("/api/plugins/install")
        .send({ packageName: fixture.packageRoot, isLocalPath: true });
      expect(installed.status).toBe(200);
      await db.update(plugins).set({ status: "ready" });
      const companyId = randomUUID();
      await db.insert(companies).values({ id: companyId, name: "Webhook tenant", issuePrefix: `WH${companyId.slice(0, 8)}` });
      await db.insert(pluginConfig).values({ pluginId: installed.body.id, companyId, configJson: {} });
      const query = scenario === "configured" ? `?companyId=${companyId}`
        : scenario === "unconfigured" ? `?companyId=${randomUUID()}`
        : scenario === "malformed" ? "?companyId=not-a-uuid"
        : scenario === "repeated" ? `?companyId=${companyId}&companyId=${companyId}` : "";
      const rawBody = `{ "companyId": "${randomUUID()}", "state": "success" }`;
      const response = await request(app).post(`/api/plugins/${installed.body.id}/webhooks/gitea${query}`)
        .set("Content-Type", "application/json").send(rawBody);
      const accepted = scenario === "configured" || scenario === "instance";
      expect(response.status).toBe(accepted ? 200 : scenario === "unconfigured" ? 404 : 400);
      const deliveries = await db.select().from(pluginWebhookDeliveries);
      if (!accepted) {
        expect(deliveries).toHaveLength(0);
        expect(workerManager.call).not.toHaveBeenCalled();
        return;
      }
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]?.companyId).toBe(scenario === "configured" ? companyId : null);
      expect(deliveries[0]?.status).toBe("success");
      expect(workerManager.call).toHaveBeenCalledExactlyOnceWith(installed.body.id, "handleWebhook", expect.objectContaining({
        endpointKey: "gitea", rawBody, parsedBody: JSON.parse(rawBody),
        ...(scenario === "configured" ? { companyId } : {}),
      }));
    });
  });

  describe("self-hosted npm installs (behavior unchanged)", () => {
    it("still rejects package names with invalid characters", async () => {
      const app = await createInstallApp(db);

      const res = await request(app)
        .post("/api/plugins/install")
        .send({ packageName: "bad<name>" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("packageName contains invalid characters");
      expect(mockLifecycle.load).not.toHaveBeenCalled();
    });

    it("does not apply the cloud floor when PAPERCLIP_MANAGED_CONFIG is absent", async () => {
      const app = await createInstallApp(db);

      // A well-formed npm package name passes route validation and reaches
      // the loader (which fails here because npm cannot resolve the package
      // in the test environment) — proving the 403 floor did not trigger.
      const res = await request(app)
        .post("/api/plugins/install")
        .send({ packageName: `paperclip-plugin-guard-missing-${randomUUID().slice(0, 8)}` });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("npm install failed");
      expect(mockLifecycle.load).not.toHaveBeenCalled();
    }, 150_000);
  });
});
