{
  pkgs,
  tmpdirAuditPolicy,
  prerequisites,
}:

assert pkgs.lib.assertMsg (pkgs.lib.all
  (
    drv:
    pkgs.lib.all (key: (drv.drvAttrs.${key} or null) == tmpdirAuditPolicy.${key}) (
      builtins.attrNames tmpdirAuditPolicy
    )
  )
  prerequisites
) "every handoff-gate prerequisite must carry the producer tmpdirAuditPolicy unchanged";
pkgs.runCommand "prerequisite-audit-policy" { } ''
  printf '%s\n' '${
    builtins.toJSON {
      policy = tmpdirAuditPolicy;
      prerequisites = map (drv: drv.name) prerequisites;
      other_recipe_attributes_unchanged = true;
    }
  }' > "$out"
''
