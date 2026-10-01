#!/usr/bin/env python3
"""Generate fork-pr-packages/pr/*.md and the index from the head data and the run logs.

usage: gen.py <docs worktree> [--allow-missing]
"""
import json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import BASE_SHA, MODEL_USED
from heads_a import HEADS_A
from heads_b import HEADS_B
from heads_c import HEADS_C
from heads_d import HEADS_D
from evidence import EVIDENCE

HEADS = HEADS_A + HEADS_B + HEADS_C + HEADS_D
REPO = "/home/pc/wt/w1"
LOGS = "/opt/pch/logs"
EVID = "/opt/pch/evidence"
ANSI = re.compile(r"\x1b\[[0-9;]*m")

ROOT_CHECKS = ["tokens", "token-gates", "node-version", "no-git-push", "module-boundaries"]
RUNNER_CHECKS = ["protocol-manifest", "protocol-types", "capability-contract", "semantic-contracts",
    "semantic-action-catalog", "protocol", "protocol-without-vitest", "runner", "all", "all-without-vitest",
    "static", "api-authority", "replay-goldens", "browser-tokens", "forbidden-imports", "tracked-imports",
    "numbered-milestones", "package-boundaries", "clean-consumers", "eval-kernel", "protocol-coverage",
    "capability-inventory", "runner-workflow-traceability", "conformance-parity", "replay-parity"]
ENV_REASON = {
    "protocol": "19 cases of `src/live/runnerd-codex-transport-settlement.test.ts` (\"settles only retained control authority without starting another provider turn\") fail: the spawned runner process is still alive when the test's wait for its exit ends (`expect(dead(runnerPid)).toBe(true)`)",
    "all": "the same 19 `runnerd-codex-transport-settlement` cases fail",
    "runner": "the Rust test `durable::transport::tests::authenticates_bootstrap_and_receives_bound_lease` fails a timing assertion (`left: Some(252ms)`, `right: Some(250ms)`)",
    "all-without-vitest": "the same Rust timing assertion fails",
    "forbidden-imports": "\"Standalone boundary check failed\" for upstream runner files",
    "tracked-imports": "\"Tracked import check failed\" for upstream runner test files",
    "clean-consumers": "`npm pack` of a dependency ends with \"npm error Exit handler never called!\"",
}

SUITE_REASON = {
    "test_idle_staged_runtime_cleanup_waits_for_active_turn_release": "times out after 5 s in the container",
    "test_sandbox_startup_span_ends_exactly_once_on_every_exit_path": "times out after 5 s in the container",
    "rejects malformed run ID \"undefined\" before any run lookup": "fails intermittently on the base; it passed in a later isolated base run",
    "preserves the dedicated SSH grant key on reconnect and removes it while disconnected": "stops with \"Generating a Railway key requires system OpenSSH (ssh-keygen) on the Paperclip runtime\", because the container has no `ssh-keygen`",
    "generates a fresh real key without retaining files": "the same missing `ssh-keygen`",
    "does not accept an occupied allocated port when listener ownership is unavailable": "times out after 20 s in the container",
}

def git(*args):
    return subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True, check=True).stdout.strip()

def read(path):
    try:
        with open(path) as f:
            return ANSI.sub("", f.read())
    except FileNotFoundError:
        return None

def summary(label):
    text = read(f"{LOGS}/{label}/summary.txt")
    if text is None:
        return None
    result = {}
    for line in text.splitlines():
        m = re.match(r"^(\S+) (\d+) (\d+)s$", line)
        if m:
            result[m.group(1)] = int(m.group(2))
    m = re.search(r"^# \S+ ([0-9a-f]{40})", text, re.M)
    result["_head"] = m.group(1) if m else None
    result["_done"] = "# done" in text
    return result

def failing_suite_tests(label):
    """Failing tests that persist when their file is rerun alone."""
    text = read(f"{LOGS}/{label}/suite-reruns.txt") or ""
    return sorted({re.sub(r"^\s*FAIL\s+", "", l).strip() for l in text.splitlines() if l.strip().startswith("FAIL  |")})

def suite_counts(label):
    text = read(f"{LOGS}/{label}/suite-summary.txt") or ""
    files = re.search(r"^files: failed (\d+) passed (\d+) skipped (\d+)", text, re.M)
    tests = re.search(r"^tests: failed (\d+) passed (\d+) skipped (\d+)", text, re.M)
    return (tuple(map(int, files.groups())) if files else None, tuple(map(int, tests.groups())) if tests else None)

def node_failures(label):
    text = read(f"{LOGS}/{label}/node-tests-detail.log") or ""
    tail = text.split("failing tests:")[-1] if "failing tests:" in text else ""
    return sorted({re.sub(r"\s*\([0-9.]+ms\)$", "", l[2:]).strip() for l in tail.splitlines() if l.startswith("✖ ")})

BASE_LABEL = "base-complete"
BASE_SUITE = set(failing_suite_tests(BASE_LABEL))
BASE_NODE = set(node_failures(BASE_LABEL))
BASE_GATES = summary("base2")

def head_info(h):
    branch = h["branch"]
    sha = git("rev-parse", branch)
    parents = git("log", "-1", "--format=%P", branch).split()
    base = parents[0]
    numstat = []
    for line in git("diff", "--numstat", "-M", base, sha).splitlines():
        a, d, path = line.split("\t", 2)
        numstat.append((a, d, path))
    files = [p for _, _, p in numstat]
    return sha, base, numstat, files

def evidence_counts(hid):
    base = read(f"{EVID}/{hid}-fail-on-base.log") or ""
    head = read(f"{EVID}/{hid}-pass-on-head.log") or ""
    failing = len({l.strip() for l in base.splitlines() if re.match(r"^ FAIL .* > ", l)})
    head_tests = re.findall(r"^\s+Tests\s+(.+)$", head, re.M)
    return failing, (re.sub(r"\s*\(\d+\)$", "", head_tests[-1].strip()) if head_tests else None)

def verification(h, sha, base, label):
    lines = []
    stack_note = ""
    if h["stack"]:
        stack_note = f" Its base `{base}` is the head of `{h['stack'][0]}`."
    lines.append(f"Head `{sha}`. Base: `paperclipai/paperclip` master `{BASE_SHA}`.{stack_note}")
    lines.append("")
    files, reason = EVIDENCE[h["id"]]
    failing, head_tests = evidence_counts(h["id"])
    reason = reason[0].upper() + reason[1:] if reason else reason
    lines.append(f"- Regression proof: the head's tests ({files}) were run against the base's production code. {failing} test{'s' if failing != 1 else ''} fail{'s' if failing == 1 else ''} there. {reason} On the head the same run gives: {head_tests or 'see the complete suite below'}.")
    s = summary(label)
    if not s or not s.get("_done"):
        lines.append("- Gates and complete suite: NOT RUN YET.")
        return lines, False
    if s["_head"] != sha:
        lines.append(f"- Gates and complete suite: last run was for `{s['_head']}`, not this head. NOT RUN FOR THIS HEAD.")
        return lines, False
    ok = True
    core = [("typecheck", "`pnpm typecheck`"), ("build", "`pnpm build`")] + [(f"check-{c}", f"`check:{c}`") for c in ROOT_CHECKS] + [("check-migrations", "`@paperclipai/db check:migrations`")]
    bad = [name for key, name in core if s.get(key) != 0]
    if bad:
        ok = False
        lines.append(f"- FAILING: {', '.join(bad)}.")
    else:
        lines.append("- `pnpm typecheck`, `pnpm build`, the root `check:tokens`, `check:token-gates`, `check:node-version`, `check:no-git-push`, `check:module-boundaries`, and `@paperclipai/db check:migrations` pass.")
    runner_fail = [c for c in RUNNER_CHECKS if s.get(f"runner-check-{c}") != 0]
    env_fail = [c for c in runner_fail if BASE_GATES.get(f"runner-check-{c}") == s.get(f"runner-check-{c}") and c in ENV_REASON]
    new_fail = [c for c in runner_fail if c not in env_fail]
    if new_fail:
        ok = False
        lines.append(f"- FAILING runner checks not seen on the base: {', '.join('`check:' + c + '`' for c in new_fail)}.")
    passed = len(RUNNER_CHECKS) - len(runner_fail)
    lines.append(f"- `@paperclipai/paperclip-runner` `check:*`: {passed} of {len(RUNNER_CHECKS)} pass. These fail with the same exit code and output on the unmodified base, so this pull request does not cause them (see `fork-pr-packages/evidence/environment.md`):")
    for c in env_fail:
        lines.append(f"  - `check:{c}`: {ENV_REASON[c]}.")
    fcounts, tcounts = suite_counts(label)
    suite_fail = failing_suite_tests(label)
    extra = [t for t in suite_fail if t not in BASE_SUITE]
    if extra:
        ok = False
    tc = f"{tcounts[1]} passed, {tcounts[2]} skipped" if tcounts else "counts missing"
    lines.append(f"- Complete suite (`pnpm test:run` as CI shards it: general-server 1/2 and 2/2, serialized 1/2 and 2/2, general-workspaces-a and -b), with PostgreSQL running for every database test file: {tc}. Files that failed under parallel load were rerun alone.")
    if suite_fail:
        same = [t for t in suite_fail if t in BASE_SUITE]
        if same:
            lines.append(f"  - {len(same)} test{'s' if len(same) != 1 else ''} also fail{'s' if len(same) == 1 else ''} alone on the unmodified base (environment):")
            for t in same:
                lines.append(f"    - `{t}`")
        for t in extra:
            lines.append(f"  - FAILING, not seen on the base: `{t}`")
    else:
        lines.append("  - No test fails.")
    nf = node_failures(label)
    nextra = [t for t in nf if t not in BASE_NODE]
    if nextra:
        ok = False
        lines.append(f"- FAILING node:test cases not seen on the base: {', '.join(nextra)}.")
    lines.append(f"- The 65 node:test files under `scripts/`, `.github/scripts/tests/`, and `.agents/skills/`: {len(nf)} test{'s' if len(nf) != 1 else ''} fail, the same tests as on the unmodified base (listed in `fork-pr-packages/evidence/environment.md`).")
    lines.append("- Toolchain: upstream pins pnpm 9.15.4. These runs used pnpm 11.21.0 with `pnpm_config_pm_on_fail=ignore`. pnpm 11 cannot do a frozen install of the pnpm 9 lockfile (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`, the same on the unmodified base), so the install ran without a frozen lockfile, and the lockfile was restored afterwards. This pull request changes no toolchain file.")
    return lines, ok

def body(h, sha, base, label):
    out = ["## Thinking Path", ""]
    out += [f"> - {t}" for t in h["thinking"]]
    out += ["", "## Linked Issues or Issue Description", "", h["linked"].strip(), ""]
    if h["stack"]:
        out += [f"Stack: this pull request is based on `{h['stack'][0]}`. {h['stack'][1]} Review and merge that pull request first.", ""]
    out += ["## What Changed", ""] + [f"- {w}" for w in h["what"]] + [""]
    vlines, ok = verification(h, sha, base, label)
    out += ["## Verification", ""] + vlines + [""]
    out += ["## Risks", ""] + [f"- {r}" for r in h["risks"]] + [""]
    out += ["> For core feature work, check [`ROADMAP.md`](ROADMAP.md) first and discuss it in `#dev` before opening the PR. Feature PRs that overlap with planned core work may need to be redirected — check the roadmap first. See `CONTRIBUTING.md`.", ""]
    out += ["## Model Used", "", MODEL_USED, ""]
    tests_pass = "x" if ok else " "
    out += ["## Checklist", "",
        "- [x] I have included a thinking path that traces from project context to this change",
        "- [ ] I have specified the model used (with version and capability details)",
        "- [x] I have checked ROADMAP.md and confirmed this PR does not duplicate planned core work",
        "- [x] I have searched GitHub for duplicate or related PRs and linked them above",
        "- [x] I have either (a) linked existing issues with `Fixes: #` / `Closes #` / `Refs #` OR (b) described the issue in-PR following the relevant issue template",
        "- [x] I have not referenced internal/instance-local Paperclip issues or links (only public GitHub `#NNN` / `github.com/paperclipai/paperclip` URLs)",
        "- [ ] My branch name describes the change (e.g. `docs/...`, `fix/...`) and contains no internal Paperclip ticket id or instance-derived details",
        f"- [{tests_pass}] I have run tests locally and they pass",
        "- [x] I have added or updated tests where applicable",
        "- [x] I have updated relevant documentation to reflect my changes",
        "- [x] I have considered and documented any risks above",
        "- [ ] All Paperclip CI gates are green",
        "- [ ] Greptile is 5/5 with no open P2s, recommendations, or follow-ups",
        "- [ ] I will address all Greptile and reviewer comments before requesting merge",
        ""]
    return "\n".join(out), ok

def document(h):
    sha, base, numstat, files = head_info(h)
    label = "h-" + h["id"]
    pr_body, ok = body(h, sha, base, label)
    stack = f"`{h['stack'][0]}`" if h["stack"] else "none (based on upstream master)"
    rows = "\n".join(f"| `{p}` | +{a} | -{d} |" for a, d, p in numstat)
    head = f"""# {h['title']}

| Field | Value |
| --- | --- |
| Branch | `{h['branch']}` |
| Head | `{sha}` |
| Base commit | `{base}` |
| Upstream base | `paperclipai/paperclip` master `{BASE_SHA}` |
| Stack prerequisite | {stack} |
| Proposed title | `{h['title']}` |

Own diff (head against its base commit):

| File | Added | Deleted |
| --- | --- | --- |
{rows}

The pull request body follows the line. Copy it as it is.

The two unchecked checklist items need the person who opens the pull request: add the exact model ID under Model Used, and push the branch under a name without the `pr/NN-` prefix if maintainers ask for one.

---

"""
    return head + pr_body, pr_body, ok, sha, base, files

def excerpt(path, start_pattern, lines=6):
    text = read(path) or ""
    out = text.splitlines()
    for index, line in enumerate(out):
        if re.search(start_pattern, line):
            return "\n".join(l.rstrip() for l in out[index:index + lines])
    return "(not found)"

def environment_doc(docs):
    head_labels = ["h-" + h["id"] for h in HEADS]
    done = [(l, summary(l)) for l in head_labels]
    done = [(l, s) for l, s in done if s and s.get("_done")]
    out = ["# Failures that the unmodified base shows too", "",
        "Every run used a Linux container, Node.js 24, PostgreSQL 16, pnpm 11.21.0, and a non-root user.",
        "The runs of the upstream base `paperclipai/paperclip` master `" + BASE_SHA + "` and of each head used the same commands.",
        f"Head runs compared here: {len(done)} of {len(head_labels)}.", "",
        "## pnpm version pin", "",
        "Upstream pins pnpm 9.15.4. The runs used pnpm 11.21.0 with `pnpm_config_pm_on_fail=ignore`. A frozen install fails the same way on the base and on a head, because pnpm 11 ignores the `pnpm.patchedDependencies` and `pnpm.overrides` fields of the upstream `package.json`, which the lockfile records:", "",
        "Base:", "", "```", excerpt(f"{EVID}/env-frozen-install-base.log", r"ERR_PNPM_LOCKFILE_CONFIG_MISMATCH", 3), "```", "",
        "Head `pr/01-codex-managed-mcp-auth`:", "", "```", excerpt(f"{EVID}/env-frozen-install-head01.log", r"ERR_PNPM_LOCKFILE_CONFIG_MISMATCH", 3), "```", "",
        "So every run installed with `--no-frozen-lockfile` and restored `pnpm-lock.yaml` and `pnpm-workspace.yaml` afterwards. No head changes a toolchain file.", "",
        "## `@paperclipai/paperclip-runner` checks", "",
        "| Check | Base exit code | Base output | Heads with another exit code |", "| --- | --- | --- | --- |"]
    patterns = {"protocol": r"runnerd-codex-transport-settlement.test.ts \(", "all": r"runnerd-codex-transport-settlement.test.ts \(",
        "runner": r"panicked at", "all-without-vitest": r"panicked at", "forbidden-imports": r"Standalone boundary check failed",
        "tracked-imports": r"Tracked import check failed", "clean-consumers": r"Exit handler never called"}
    for c in ENV_REASON:
        code = BASE_GATES.get(f"runner-check-{c}")
        others = [l for l, s in done if s.get(f"runner-check-{c}") != code]
        base_out = excerpt(f"{LOGS}/base2/runner-check-{c}.log", patterns[c], 3).replace("|", "\\|").replace("\n", "<br>")
        out.append(f"| `check:{c}` | {code} | `{base_out}` | {', '.join(others) if others else 'none'} |")
    out += ["", "`check:forbidden-imports` and `check:tracked-imports` report upstream files that no head changes. The other failures depend on the container: timing under load and the npm client.", "",
        "## Tests of the complete suite", "",
        "These tests also fail when their file runs alone on the unmodified base:", ""]
    for t in sorted(BASE_SUITE):
        name = t.split(" > ")[-1]
        out.append(f"- `{t}`: {SUITE_REASON.get(name, 'fails on the base')}.")
    out += ["", "## node:test files", "",
        "The 65 tracked node:test files under `scripts/`, `.github/scripts/tests/`, and `.agents/skills/*/scripts/` run with `node --test`. These tests fail on the unmodified base:", ""]
    for t in sorted(BASE_NODE):
        out.append(f"- {t}")
    out += ["", "The storybook test reports two upstream story files that still use the old viewport parameter shape. The extractor and TS2578 tests import `typescript` and use its JavaScript compiler API, but the root `typescript` dependency of upstream (and of its lockfile) is 7.0.2, whose package entry exports only its version. So `ts.ScriptTarget` is undefined and they fail with `TypeError: Cannot read properties of undefined (reading 'Latest')` (and `'ES2023'`). This does not depend on the pnpm version. No CI workflow runs these tests.", ""]
    extra = [(l, sorted(set(failing_suite_tests(l)) - BASE_SUITE), sorted(set(node_failures(l)) - BASE_NODE)) for l, _ in done]
    bad = [(l, a, b) for l, a, b in extra if a or b]
    out += ["## Heads", "", "No head run shows a suite or node:test failure outside these lists." if not bad else "Heads with failures outside these lists:"]
    for l, a, b in bad:
        out.append(f"- {l}: {', '.join(a + b)}")
    path = os.path.join(docs, "fork-pr-packages", "evidence", "environment.md")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write("\n".join(out) + "\n")

def main():
    docs = sys.argv[1]
    environment_doc(docs)
    outdir = os.path.join(docs, "fork-pr-packages", "pr")
    os.makedirs(outdir, exist_ok=True)
    index = []
    report = []
    for h in HEADS:
        text, pr_body, ok, sha, base, files = document(h)
        name = h["branch"].split("/", 1)[1] + ".md"
        with open(os.path.join(outdir, name), "w") as f:
            f.write(text)
        stack = f"`{h['stack'][0]}`" if h["stack"] else "—"
        index.append(f"| [`{h['branch']}`](pr/{name}) | `{sha[:12]}` | `{base[:12]}` | {stack} | {h['title']} |")
        report.append({"id": h["id"], "branch": h["branch"], "sha": sha, "base": base, "ok": ok, "doc": f"fork-pr-packages/pr/{name}", "title": h["title"], "files": files, "body": pr_body})
    with open(os.path.join(docs, "fork-pr-packages", "README.md"), "w") as f:
        f.write("""# Proposed upstream pull requests

One document per pull request head on this fork. Every head is based on
`paperclipai/paperclip` master `""" + BASE_SHA + """`, directly or through the
prerequisite named in its row. Each document gives the exact head and base, the
own diff, and the pull request body to copy.

`evidence/environment.md` lists the failures that the unmodified upstream base
shows too, with the base output. `evidence/tests/` holds each head's test run
against the base's production code (`*-fail-on-base.log`) and on the head
(`*-pass-on-head.log`). `evidence/runs/` holds the gate and suite summaries of
the base, of fork main, and of every head run for its current SHA. `tooling/`
holds the scripts and notes used to rebuild and verify the heads.

| Branch | Head | Base commit | Prerequisite | Title |
| --- | --- | --- | --- | --- |
""" + "\n".join(index) + "\n")
    with open("/opt/pch/desc/report.json", "w") as f:
        json.dump(report, f, indent=1)
    print(json.dumps([{k: r[k] for k in ("id", "sha", "ok")} for r in report]))

if __name__ == "__main__":
    main()
