{
  description = "Paperclip fork: cached workspace dependencies and per-package checks";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/419fe0f449b3fbe3bdd53d9840288db4509ec32e";

  outputs =
    { self, nixpkgs }:
    let
      lib = nixpkgs.lib;
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # Workspace members, as pnpm-workspace.yaml declares them: the listed globs
      # that hold a package.json, minus the two explicit exclusions.
      subdirs =
        parent:
        lib.filter (dir: builtins.pathExists (self + "/${parent}/${dir}/package.json")) (
          lib.attrNames (lib.filterAttrs (_: type: type == "directory") (builtins.readDir (self + "/${parent}")))
        );
      globbedDirs = lib.concatMap (parent: map (dir: "${parent}/${dir}") (subdirs parent)) [
        "packages"
        "packages/adapters"
        "packages/plugins"
        "packages/plugins/examples"
      ];
      workspaceDirs =
        lib.filter (dir: dir != "packages/plugins/examples/plugin-orchestration-smoke-example") globbedDirs
        ++ [
          "server"
          "ui"
          "cli"
        ];

      manifestOf = dir: builtins.fromJSON (builtins.readFile (self + "/${dir}/package.json"));
      packageByName = lib.listToAttrs (map (dir: lib.nameValuePair (manifestOf dir).name { inherit dir; }) workspaceDirs);

      # Workspace packages a package imports, directly or through another one.
      workspaceDependencies =
        dir:
        let
          manifest = manifestOf dir;
          declared = (manifest.dependencies or { }) // (manifest.devDependencies or { }) // (manifest.optionalDependencies or { });
        in
        lib.attrNames (lib.filterAttrs (name: spec: lib.hasPrefix "workspace:" spec && packageByName ? ${name}) declared);
      closureDirs =
        dir:
        map (item: item.key) (lib.genericClosure {
          startSet = [ { key = dir; } ];
          operator = item: map (name: { key = packageByName.${name}.dir; }) (workspaceDependencies item.key);
        });

      # Everything pnpm needs to lay out node_modules and nothing else, so a source
      # change that touches no manifest, patch, lockfile or pnpmfile keeps the
      # derivation, and with it the installed tree, unchanged.
      installInputs = lib.fileset.unions (
        [
          ./.npmrc
          ./.pnpmfile.cjs
          ./package.json
          ./patches
          ./pnpm-lock.yaml
          ./pnpm-workspace.yaml
        ]
        ++ map (dir: ./. + "/${dir}/package.json") workspaceDirs
      );
      installSource = lib.fileset.toSource {
        root = ./.;
        fileset = installInputs;
      };

      slug = dir: lib.replaceStrings [ "@" "/" ] [ "" "-" ] (manifestOf dir).name;

      # A package's check sees its own directory, the directories of the workspace
      # packages it imports (transitively) and the root files below, nothing else:
      # a change anywhere else leaves its inputs, and so its result, untouched.
      rootFiles = [
        ./.npmrc
        ./package.json
        ./pnpm-workspace.yaml
        ./tsconfig.base.json
        ./tsconfig.json
      ];
      # Sources a package reads outside its workspace dependencies, found from the
      # code: relative imports across package directories and the repository files
      # its tests and runtime read. Listing exactly these, and no more, is what keeps
      # an unrelated change from invalidating the package's checks; a path left out
      # fails the check in the sandbox instead of passing on stale input.
      extraSources =
        dir:
        {
          cli = [
            ./packages/plugins
            ./server/src
            ./server/package.json
          ];
          server = [
            ./cli/src
            ./cli/package.json
            ./packages/kv-demo-mcp-server
            ./packages/mcp-server
            ./packages/plugins
            ./skills
            ./skills-releases
          ];
          ui = [
            ./doc
            ./packages/paperclip-runner
            ./packages/plugins
          ];
        }
        .${dir} or [ ];

      # Repository scripts are read by the runner, the plugin SDK build and the
      # applications that build on them.
      scriptDirs = [
        "packages/paperclip-runner"
        "packages/plugins/sdk"
        "cli"
        "server"
        "ui"
      ];
      needsScripts = dir: lib.any (d: lib.elem d scriptDirs) (closureDirs dir);
      checkSource =
        dir:
        lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.unions (
            rootFiles
            ++ lib.optional (needsScripts dir) ./scripts
            ++ extraSources dir
            ++ map (d: ./. + "/${d}") (closureDirs dir)
          );
        };

      # node_modules for the package and its workspace dependencies. The root
      # directory holds a symlink to each installed entry (pnpm refuses a symlinked
      # root); each workspace package gets its own tree of relative symlinks, which
      # then resolve to this checkout's sources, not the store's.
      # Packages that read other packages' sources need those packages' dependencies
      # to resolve too, so they get every workspace package's tree.
      installedDirs = dir: if extraSources dir == [ ] then closureDirs dir else workspaceDirs;
      linkNodeModules =
        nodeModules: dir: ''
          mkdir node_modules
          for entry in ${nodeModules}/node_modules/* ${nodeModules}/node_modules/.[!.]*; do
            ln -s "$entry" node_modules/
          done
          for workspace in ${lib.concatStringsSep " " (installedDirs dir)}; do
            if [ -d ${nodeModules}/$workspace/node_modules ]; then
              cp -a ${nodeModules}/$workspace/node_modules "$workspace/"
            fi
          done
        '';

      # Workspace packages other packages import through built output rather than
      # source. Each is built once, keyed by its own inputs, and the result is copied
      # into the checks that import it.
      exportsDist = dir: lib.hasInfix "dist/" (builtins.toJSON ((manifestOf dir).exports or { }));
      distScript = dir: if dir == "packages/paperclip-runner" then "build:typescript" else "build";
      distDirs = dir: lib.filter (d: d != dir && exportsDist d) (closureDirs dir);
      copyDists =
        pkgs: dir:
        lib.concatMapStringsSep "\n" (
          d: "cp -a ${mkDist pkgs d}/dist ${d}/"
        ) (distDirs dir);

      mkDist =
        pkgs: dir:
        mkCheck pkgs "dist" dir "${pnpmRun (distScript dir)}\nmkdir -p $out\ncp -a dist $out/";

      mkCheck =
        pkgs: kind: dir: command:
        pkgs.stdenv.mkDerivation {
          name = "${kind}-${slug dir}";
          src = checkSource dir;
          nativeBuildInputs = [
            pkgs.nodejs_24
            pkgs.pnpm_11
            pkgs.git
          ];
          # The native runner binary is not part of what runs in production, so no
          # check compiles it.
          PAPERCLIP_SKIP_RUNNER_BINARY = "1";
          __darwinAllowLocalNetworking = true;
          dontConfigure = true;
          buildPhase = ''
            export HOME="$TMPDIR/home" CI=1
            mkdir -p "$HOME"
            chmod -R u+w .
            ${linkNodeModules self.packages.${pkgs.stdenv.hostPlatform.system}.nodeModules dir}
            ${copyDists pkgs dir}
            chmod -R u+w .
            cd ${dir}
            ${command}
          '';
          installPhase = if kind == "dist" then "true" else "touch $out";
        };

      # The runner's own typecheck also checks its Rust workspace, which nothing here
      # uses; its TypeScript typecheck is the declared script for that half.
      typecheckScript = dir: if dir == "packages/paperclip-runner" then "typecheck:typescript" else "typecheck";
      # The server's script first rebuilds the runner and the plugin SDK build inputs;
      # here those are the cached build outputs copied in, so only its tsc step runs.
      typecheckCommand =
        dir: if dir == "server" then pnpmExec "tsc --noEmit" else pnpmRun (typecheckScript dir);
      pnpmRun = script: "pnpm --config.verify-deps-before-run=false run ${script}";
      pnpmExec = tool: "pnpm --config.verify-deps-before-run=false exec ${tool}";

      checksFor =
        pkgs:
        lib.listToAttrs (
          lib.concatMap (
            dir:
            let
              manifest = manifestOf dir;
              hasTests = builtins.pathExists (self + "/${dir}/vitest.config.ts");
            in
            lib.optional (manifest.scripts ? typecheck) (
              lib.nameValuePair "typecheck-${slug dir}" (mkCheck pkgs "typecheck" dir (typecheckCommand dir))
            )
            ++ lib.optional hasTests (
              lib.nameValuePair "test-${slug dir}" (mkCheck pkgs "test" dir (pnpmExec "vitest run"))
            )
          ) workspaceDirs
        );
    in
    {
      checks = forAllSystems checksFor;

      packages = forAllSystems (pkgs: {
        pnpmDeps = pkgs.fetchPnpmDeps {
          pname = "paperclip-fork";
          version = "workspace";
          src = installSource;
          fetcherVersion = 4;
          pnpm = pkgs.pnpm_11;
          hash = "sha256-hqI26FrN1mXOArrZemdfPs9jZolRkS2a44D0KRYfFcE=";
        };

        nodeModules = pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "paperclip-fork-node-modules";
          version = "workspace";
          src = installSource;
          pnpmDeps = self.packages.${pkgs.stdenv.hostPlatform.system}.pnpmDeps;
          nativeBuildInputs = [
            pkgs.nodejs_24
            pkgs.pnpm_11
            pkgs.pnpmConfigHook
          ];
          dontBuild = true;
          installPhase = ''
            runHook preInstall
            mkdir -p "$out"
            find . -name node_modules -type d -prune -print0 | xargs -0 -I{} cp -a --parents {} "$out"
            runHook postInstall
          '';
          dontFixup = true;
        });
      });
    };
}
