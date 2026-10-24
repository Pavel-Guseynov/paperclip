{
  pkgs,
  prerequisite,
  prerequisites,
  hook,
}:

let
  # Use the released producer's unreadable-directory injection, scoped to the
  # native audit so other fixup consumers still see readable output.
  injected = prerequisite.overrideAttrs (old: {
    preFixup = (old.preFixup or "") + ''
      mkdir -p "$PWD/audit-tmp"
      export TMPDIR="$PWD/audit-tmp"
      trap 'chmod -R u+rwx "$out"; jobs -p > "$PWD/audit-jobs"; printf "audit_jobs=%s\n" "$(cat "$PWD/audit-jobs")"; printf "audit_tmp_entries=%s\n" "$(ls -A "$TMPDIR")"' EXIT
      for index in "''${!fixupOutputHooks[@]}"; do
        if [[ "''${fixupOutputHooks[index]}" == *auditTmpdir* ]]; then
          fixupOutputHooks[index]='mkdir "$prefix/inaccessible"; chmod 000 "$prefix/inaccessible"; '"''${fixupOutputHooks[index]}"'; chmod 700 "$prefix/inaccessible"'
        fi
      done
    '';
  });
  failure = pkgs.testers.testBuildFailure injected;
in
assert pkgs.lib.assertMsg (pkgs.lib.all (
  drv: builtins.elem (toString hook) (map toString drv.nativeBuildInputs)
) prerequisites) "every handoff-gate prerequisite must consume the released audit hook";
pkgs.runCommand "prerequisite-audit" { nativeBuildInputs = [ pkgs.jq ]; } ''
  log=${failure}/testBuildFailure.log
  cat "$log" >&2
  test "$(cat ${failure}/testBuildFailure.exit)" = 1
  grep -F 'Permission denied' "$log" > /dev/null
  grep -Fx 'audit_jobs=' "$log" > /dev/null
  grep -Fx 'audit_tmp_entries=' "$log" > /dev/null
  jq -Rse '
    split("\n") | map(fromjson?) | map(select(.action == "audit_tmpdir")) |
    length == 1 and all(.[];
      .attributes.target == "classifier" and .attributes.exit_status == 1 and
      .attributes.pid > 0 and .level == "error" and .service == "nixpkgs" and
      .error.type == "ChildProcessError")
  ' "$log" > /dev/null
  printf '{"prerequisite":"plugin-sdk-dist","audit_child_failure_rejected":true,"cleanup":true,"reaped":true}\n' > "$out"
''
