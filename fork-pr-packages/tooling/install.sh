#!/bin/bash
# usage: install.sh  (run inside repo dir as pc) pnpm 11 install with upstream peer/build semantics; restore tracked files
. /opt/pch/env.sh
log="/opt/pch/logs/install-$(basename $PWD)-$(date +%H%M%S).log"; mkdir -p /opt/pch/logs
pnpm install --no-frozen-lockfile --config.auto-install-peers=false --config.dangerously-allow-all-builds=true > "$log" 2>&1
rc=$?
git checkout -- pnpm-lock.yaml pnpm-workspace.yaml 2>/dev/null
git status --short | grep -v '^??' | head
echo "install rc=$rc log=$log"; tail -2 "$log"
exit $rc
