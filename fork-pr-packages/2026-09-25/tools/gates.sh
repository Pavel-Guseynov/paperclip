#!/usr/bin/env bash
# Runs upstream's locally runnable pull-request gates (pr-trusted.yml + AGENTS.md)
# against the current checkout. Usage: gates.sh <label> <base-sha> [phase...]
# Default phases: policy typecheck registry build runner general-server tests-projects serialized-files
set -u
label="$1"; base="$2"; shift 2
phases=("$@"); [ ${#phases[@]} -eq 0 ] && phases=(policy typecheck registry build runner general-server tests-projects serialized-files)
root="${GATE_ROOT:-/Users/pavelguseynov/paperclip-fork}"
out=/private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad/logs/$label
mkdir -p "$out"
summary="$out/SUMMARY"
cd "$root" || exit 2
export CI=true
echo "label=$label head=$(git rev-parse HEAD) base=$base started=$(date -u +%FT%TZ)" >> "$summary"

gate() {
  local name="$1"; shift
  local start end rc
  start=$(date +%s)
  ( "$@" ) > "$out/$name.log" 2>&1
  rc=$?
  end=$(date +%s)
  printf 'GATE %-40s exit=%s dur=%ss\n' "$name" "$rc" "$((end - start))" >> "$summary"
}

lockfile_policy() {
  if git diff --name-only "$base...HEAD" | grep -qx 'pnpm-lock.yaml'; then
    echo "Do not commit pnpm-lock.yaml in pull requests. CI owns lockfile updates."; return 1
  fi
  echo "pnpm-lock.yaml not changed by $base...HEAD"
}
release_bootstrap() {
  local changed=()
  mapfile -t changed < <(git diff --name-only "$base...HEAD")
  PAPERCLIP_RELEASE_BOOTSTRAP_BASE_SHA="$base" node ./scripts/check-release-package-bootstrap.mjs "${changed[@]}"
}

for phase in "${phases[@]}"; do
  case "$phase" in
    policy)
      gate policy-lockfile lockfile_policy
      gate policy-migration-order node .github/scripts/check-pr-migration-order.mjs "$base" "$(git rev-parse HEAD)"
      gate policy-docker-deps-stage node ./scripts/check-docker-deps-stage.mjs
      gate policy-node-version pnpm check:node-version
      gate policy-no-git-push node ./scripts/check-no-git-push.mjs
      gate policy-no-git-push-test node --test ./scripts/check-no-git-push.test.mjs
      gate policy-module-boundaries pnpm check:module-boundaries
      gate policy-module-boundaries-test node --test ./scripts/check-module-boundaries.test.mjs
      gate policy-pr-scripts-test node --test '.github/scripts/tests/*.test.mjs'
      gate policy-server-shard-test node --test ./scripts/__tests__/run-vitest-stable-shard.test.mjs
      gate policy-e2e-shard-test node --test ./scripts/__tests__/e2e-shard.test.mjs
      gate policy-release-verify-wiring node --test ./scripts/__tests__/release-verify-workflow.test.mjs ./scripts/cloud-source-verification.test.mjs ./scripts/standard-image-contract.test.mjs
      gate policy-standalone-concurrency node --test ./scripts/__tests__/build-standalone-concurrency.test.mjs
      gate policy-release-package-map node ./scripts/release-package-map.mjs check
      gate policy-release-bootstrap release_bootstrap
      gate policy-dependency-resolution pnpm install --resolution-only --ignore-scripts --no-frozen-lockfile
      gate policy-token-gates pnpm check:token-gates
      gate policy-diff-check git diff --check "$base...HEAD"
      ;;
    typecheck)
      gate typecheck-all pnpm -r typecheck
      gate typecheck-build-gaps pnpm run typecheck:build-gaps
      ;;
    registry)
      gate release-registry pnpm run test:release-registry
      ;;
    build)
      gate build-issue-thread pnpm --filter @paperclipai/paperclip-runner build:issue-thread
      gate build pnpm build
      ;;
    runner)
      gate runner-static pnpm --filter @paperclipai/paperclip-runner check:static
      gate runner-rust pnpm --filter @paperclipai/paperclip-runner check:runner
      gate runner-vitest pnpm --filter @paperclipai/paperclip-runner test:typescript:vitest
      ;;
    tests)
      # pnpm test:run runs these groups in order and stops at the first failing
      # group; run each group so one failure cannot hide the others.
      gate test-general-server pnpm test:run:general -- --group general-server
      gate test-workspaces-a pnpm test:run:general -- --group general-workspaces-a
      gate test-workspaces-b pnpm test:run:general -- --group general-workspaces-b
      gate test-serialized pnpm test:run:serialized
      ;;
    general-server)
      # The invocation `pnpm test:run:general -- --group general-server` builds:
      # every non-serialized server suite (including the chat and native-runner
      # suites CI splits into separate lanes) in one serial vitest run, with the
      # runner's per-invocation environment. The temp root is removed afterwards.
      pnpm run preflight:workspace-links > "$out/preflight.log" 2>&1
      pnpm --filter @paperclipai/plugin-sdk ensure-build-deps >> "$out/preflight.log" 2>&1
      excludes=()
      while read -r suite; do excludes+=(--exclude "${suite#server/}"); done \
        < <(node /private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad/list-serialized.mjs)
      server_root="$(cd "$(mktemp -d /tmp/pv-XXXXXX)" && pwd -P)"
      mkdir -p "$server_root/h" "$server_root/t"
      gate test-general-server env NODE_ENV=test PAPERCLIP_HOME="$server_root/h" \
        PAPERCLIP_CONFIG="$server_root/h/config.json" PAPERCLIP_INSTANCE_ID="vt-$$-server" TMPDIR="$server_root/t" \
        pnpm exec vitest run --exclude '**/dist/**' --project @paperclipai/server --no-file-parallelism --maxWorkers=1 "${excludes[@]}"
      rm -rf "$server_root"
      ;;
    tests-projects)
      # Diagnostic: the workspace groups stop at their first failing project.
      # Run every project with the environment scripts/run-vitest-stable.mjs sets.
      for project in @paperclipai/shared @paperclipai/skills-catalog @paperclipai/db @paperclipai/adapter-utils \
        @paperclipai/adapter-claude-local @paperclipai/adapter-codex-local @paperclipai/adapter-grok-local \
        @paperclipai/adapter-openclaw-gateway @paperclipai/adapter-opencode-local @paperclipai/plugin-daytona \
        @paperclipai/plugin-sdk @paperclipai/create-paperclip-plugin @paperclipai/ui paperclipai; do
        project_root="$(cd "$(mktemp -d /tmp/pv-XXXXXX)" && pwd -P)"
        mkdir -p "$project_root/h" "$project_root/t"
        gate "project-${project//[@\/]/_}" env NODE_ENV=test PAPERCLIP_HOME="$project_root/h" \
          PAPERCLIP_CONFIG="$project_root/h/config.json" PAPERCLIP_INSTANCE_ID="vt-$$-${project//[@\/]/_}" \
          TMPDIR="$project_root/t" pnpm exec vitest run --exclude '**/dist/**' --project "$project"
        rm -rf "$project_root"
      done
      ;;
    serialized-files)
      # pnpm test:run:serialized runs one vitest invocation per suite and stops at
      # the first failing suite. Run every suite with the same arguments and
      # environment so each has a result; record per-suite exits.
      suites_file="$out/serialized-suites.txt"
      node /private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad/list-serialized.mjs > "$suites_file"
      start=$(date +%s); failed=0; total=0
      : > "$out/serialized-files.tsv"
      while read -r suite; do
        total=$((total + 1))
        suite_root="$(cd "$(mktemp -d /tmp/pv-XXXXXX)" && pwd -P)"
        mkdir -p "$suite_root/h" "$suite_root/t"
        env NODE_ENV=test PAPERCLIP_HOME="$suite_root/h" PAPERCLIP_CONFIG="$suite_root/h/config.json" \
          PAPERCLIP_INSTANCE_ID="vt-$$-$total" TMPDIR="$suite_root/t" \
          pnpm exec vitest run --exclude '**/dist/**' --project @paperclipai/server "$suite" --pool=forks --isolate \
          >> "$out/serialized-files.log" 2>&1 < /dev/null
        rc=$?
        rm -rf "$suite_root"
        [ $rc -ne 0 ] && failed=$((failed + 1))
        printf '%s\t%s\n' "$rc" "$suite" >> "$out/serialized-files.tsv"
      done < "$suites_file"
      printf 'GATE %-40s exit=%s dur=%ss suites=%s failed=%s\n' "serialized-files" "$([ $failed -eq 0 ] && echo 0 || echo 1)" "$(( $(date +%s) - start ))" "$total" "$failed" >> "$summary"
      ;;
    tests-rest)
      gate test-workspaces-a pnpm test:run:general -- --group general-workspaces-a
      gate test-workspaces-b pnpm test:run:general -- --group general-workspaces-b
      gate test-serialized pnpm test:run:serialized
      ;;
    *) echo "unknown phase $phase" >> "$summary" ;;
  esac
done
echo "finished=$(date -u +%FT%TZ)" >> "$summary"
