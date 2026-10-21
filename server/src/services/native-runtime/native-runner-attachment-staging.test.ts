import { constants } from "node:fs";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stageNativeRunnerAttachmentBytes } from "./native-runner-file-handoff.js";

const control = vi.hoisted(() => ({ redirectedPath: null as string | null }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: (...args: Parameters<typeof actual.open>) => {
      if (
        control.redirectedPath &&
        String(args[0]).includes("/.paperclip-inbound/")
      ) {
        return actual.open(control.redirectedPath, constants.O_RDWR);
      }
      return actual.open(...args);
    },
  };
});

describe("confined native attachment staging", () => {
  const directories: string[] = [];
  async function temporaryDirectory(prefix: string) {
    const directory = await mkdtemp(path.join(tmpdir(), prefix));
    directories.push(directory);
    return directory;
  }

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const directory of directories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("stages an inspectable empty file and cleans it idempotently", async () => {
    const workspaceRoot = await temporaryDirectory("native-empty-stage-");
    const stage = await stageNativeRunnerAttachmentBytes({
      workspaceRoot,
      body: Buffer.alloc(0),
    });
    expect(
      await readFile(path.join(workspaceRoot, stage.workspaceRelativePath)),
    ).toEqual(Buffer.alloc(0));
    await stage.cleanup();
    await stage.cleanup();
  });

  it("never truncates an outside inode when an open is redirected before validation", async () => {
    const workspaceRoot = await temporaryDirectory("native-stage-raced-open-");
    const outside = path.join(
      await temporaryDirectory("native-stage-outside-"),
      "keep.txt",
    );
    await writeFile(outside, "untouched external bytes");
    const slot = await stageNativeRunnerAttachmentBytes({
      workspaceRoot,
      body: Buffer.from("initial"),
    });
    await slot.cleanup();
    control.redirectedPath = outside;
    try {
      await expect(
        stageNativeRunnerAttachmentBytes({
          workspaceRoot,
          body: Buffer.from("new"),
        }),
      ).rejects.toThrow("path_denied");
    } finally {
      control.redirectedPath = null;
    }
    expect(await readFile(outside, "utf8")).toBe("untouched external bytes");
    expect(
      (await stat(path.join(workspaceRoot, slot.workspaceRelativePath))).size,
    ).toBe(0);
  });

  it.runIf(process.platform === "darwin")("retains the original failure when the runtime lsof command is unavailable", async () => {
    const workspaceRoot = await temporaryDirectory("native-stage-missing-tool-");
    vi.stubEnv("PATH", await temporaryDirectory("native-stage-empty-path-"));
    await expect(stageNativeRunnerAttachmentBytes({ workspaceRoot, body: Buffer.alloc(0) }))
      .rejects.toMatchObject({
        message: "paperclip_runner_file_handoff_descriptor_unverifiable",
        cause: { code: "ENOENT", path: "lsof", stdout: "", stderr: "" },
      });
  });
});
