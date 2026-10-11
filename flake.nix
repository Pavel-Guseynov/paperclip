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

      # Workspace members of the tree at `root`, as pnpm-workspace.yaml declares
      # them: the listed globs that hold a package.json, minus the explicit exclusion.
      workspaceDirsOf =
        root:
        let
          subdirs =
            parent:
            lib.optionals (builtins.pathExists (root + "/${parent}")) (
              lib.filter (dir: builtins.pathExists (root + "/${parent}/${dir}/package.json")) (
                lib.attrNames (lib.filterAttrs (_: type: type == "directory") (builtins.readDir (root + "/${parent}")))
              )
            );
          globbedDirs = lib.concatMap (parent: map (dir: "${parent}/${dir}") (subdirs parent)) [
            "packages"
            "packages/adapters"
            "packages/plugins"
            "packages/plugins/examples"
          ];
        in
        lib.filter (dir: dir != "packages/plugins/examples/plugin-orchestration-smoke-example") globbedDirs
        ++ lib.filter (dir: builtins.pathExists (root + "/${dir}/package.json")) [
          "server"
          "ui"
          "cli"
        ];
      workspaceDirs = workspaceDirsOf ./.;

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
      installSourceOf =
        root:
        lib.fileset.toSource {
          inherit root;
          fileset = lib.fileset.unions (
            [
              (root + "/.npmrc")
              (root + "/.pnpmfile.cjs")
              (root + "/package.json")
              (root + "/patches")
              (root + "/pnpm-lock.yaml")
              (root + "/pnpm-workspace.yaml")
            ]
            ++ map (dir: root + "/${dir}/package.json") (workspaceDirsOf root)
          );
        };
      installSource = installSourceOf ./.;

      # The selection is exercised on three small workspaces: one edited only in a
      # source file, one only in its lockfile. The first must select the same
      # inputs as the base, the second must not.
      fixtureSource = name: installSourceOf (./nix/fixtures/install-inputs + "/${name}");
      installSelection = {
        sameOnSourceEdit = (fixtureSource "base").outPath == (fixtureSource "source-edit").outPath;
        differsOnLockfileEdit = (fixtureSource "base").outPath != (fixtureSource "lockfile-edit").outPath;
      };

      slug = dir: lib.replaceStrings [ "@" "/" ] [ "" "-" ] (manifestOf dir).name;

      # A package's check sees its own directory, the directories of the workspace
      # packages it imports (transitively) and the root files below, nothing else:
      # a change anywhere else leaves its inputs, and so its result, untouched.
      # The root tsconfig lists every package as a project reference, so each package's
      # tsconfig.json is an input to every check that reads it.
      rootFiles =
        [
          ./.npmrc
          ./package.json
          ./pnpm-workspace.yaml
          ./tsconfig.base.json
          ./tsconfig.json
        ]
        ++ map (dir: ./. + "/${dir}/tsconfig.json") (
          lib.filter (dir: builtins.pathExists (./. + "/${dir}/tsconfig.json")) workspaceDirs
        );
      # Sources a package reads outside its workspace dependencies, found from the
      # code: relative imports across package directories and the repository files
      # its tests and runtime read. Listing exactly these, and no more, is what keeps
      # an unrelated change from invalidating the package's checks; a path left out
      # fails the check in the sandbox instead of passing on stale input.
      extraSources =
        dir:
        {
          cli = [
            ./packages/db/src/migrations
            ./packages/plugins
            ./server/src
            ./server/package.json
          ];
          server = [
            ./.agents
            ./.github/workflows
            ./Dockerfile
            ./announcements
            ./docker
            ./doc
            ./docs
            ./packages/db/src/migrations
            ./tests
            ./ui/src
            ./cli/src
            ./cli/package.json
            ./packages/kv-demo-mcp-server
            ./packages/mcp-server
            ./packages/plugins
            ./skills
            ./skills-releases
          ];
          # Migration tests read the SQL files and snapshots by name.
          "packages/db" = [ ./packages/db/src/migrations ];
          # Runner tests read protocol fixtures and specifications by name.
          "packages/paperclip-runner" = [
            ./cli/package.json
            ./packages/paperclip-runner/protocol
            ./packages/paperclip-runner/spec
          ];
          # Contract tests that read the server, UI, skills and Runner sources.
          "packages/shared" = [
            ./.gitignore
            ./packages/paperclip-runner
            ./server/src/routes
            ./skills
            ./ui/public
          ];
          # The catalog manifest scripts run through the CLI's tsx.
          "packages/skills-catalog" = [
            ./.agents
            ./cli/package.json
            ./skills
          ];
          # A test starts a script through the CLI's tsx.
          "packages/adapter-utils" = [ ./cli/package.json ];
          # A test resolves acpx from the Runner package.
          "packages/adapters/claude-local" = [ ./packages/paperclip-runner/package.json ];
          "packages/teams-catalog" = [
            ./cli/package.json
            ./packages/skills-catalog
          ];
          ui = [
            ./Dockerfile
            ./announcements
            ./doc
            ./packages/paperclip-runner
            ./packages/plugins
            ./ui/public
          ];
        }
        .${dir} or [ ];

      # Repository scripts are read by the runner, the plugin SDK build and the
      # applications that build on them.
      scriptDirs = [
        "packages/adapter-utils"
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
        nodeModules: dirs: ''
          mkdir node_modules
          for entry in ${nodeModules}/node_modules/* ${nodeModules}/node_modules/.[!.]*; do
            ln -s "$entry" node_modules/
          done
          for workspace in ${lib.concatStringsSep " " dirs}; do
            if [ -d "$workspace" ] && [ -d ${nodeModules}/$workspace/node_modules ]; then
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
        pkgs: kind: dir:
        lib.concatMapStringsSep "\n" (
          d: "cp -a ${mkDist pkgs d}/dist ${d}/"
        ) (distDirs dir)
        + lib.concatMapStringsSep "\n" (
          d: "\ncp -a ${mkGenerated pkgs d}/generated ${d}/"
        ) (generatedDirs kind dir);

      # Packages whose exports include generated files (catalog manifests) get them
      # from a derivation of their own, for dependents and for their own tests.
      exportsGenerated = dir: lib.hasInfix "generated/" (builtins.toJSON ((manifestOf dir).exports or { }));
      # A package's own tests read its generated files; the derivation that makes
      # them must not depend on itself.
      generatedDirs = kind: dir: lib.filter (d: exportsGenerated d && (kind == "test" || d != dir)) (closureDirs dir);
      mkGenerated =
        pkgs: dir:
        mkCheck pkgs "dist" dir "${pnpmRun "build:manifest"}\nmkdir -p $out\ncp -a generated $out/";

      mkDist =
        pkgs: dir:
        mkCheck pkgs "dist" dir "${pnpmRun (distScript dir)}\nmkdir -p $out\ncp -a dist $out/";

      # Tests that need Postgres share one cluster per check. Its data directory is
      # built once from the migrations (a derivation keyed only by the database
      # package), copied into the check, and started with durability off; each suite
      # then copies its own database from the migrated template in milliseconds.
      postgresConfig = ''
        fsync = off
        synchronous_commit = off
        full_page_writes = off
        shared_buffers = 128MB
        max_connections = 300
      '';
      freePort = "node -e 'const s=require(\"net\").createServer().listen(0,()=>{console.log(s.address().port);s.close()})'";
      usesDatabase = dir: lib.elem "packages/db" (closureDirs dir);

      mkTestPostgresTemplate =
        pkgs:
        pkgs.stdenv.mkDerivation {
          name = "test-postgres-template";
          src = checkSource "packages/db";
          nativeBuildInputs = [
            pkgs.nodejs_24
            pkgs.pnpm_11
            pkgs.git
            pkgs.postgresql_18
          ];
          __darwinAllowLocalNetworking = true;
          dontConfigure = true;
          buildPhase = ''
            export HOME="$TMPDIR/home" CI=1
            mkdir -p "$HOME"
            chmod -R u+w .
            ${linkNodeModules self.packages.${pkgs.stdenv.hostPlatform.system}.nodeModules (installedDirs "packages/db")}
            ${copyDists pkgs "dist" "packages/db"}
            PORT=$(${freePort})
            initdb -D "$TMPDIR/pgdata" -U paperclip --auth=trust -E UTF8 --locale=C --no-sync
            cat >> "$TMPDIR/pgdata/postgresql.conf" <<'CONF'
            ${postgresConfig}CONF
            # Left unvacuumed, the tables look like those of a freshly created database to
            # the planner, so plan-shape tests see the same plans as on an embedded cluster.
            echo "autovacuum = off" >> "$TMPDIR/pgdata/postgresql.conf"
            pg_ctl -D "$TMPDIR/pgdata" -o "-p $PORT -k $TMPDIR -c listen_addresses=127.0.0.1" -l "$TMPDIR/pg.log" -w start
            createdb -h 127.0.0.1 -p "$PORT" -U paperclip -E UTF8 --locale=C -T template0 paperclip_template
            (cd packages/db && DATABASE_URL="postgres://paperclip@127.0.0.1:$PORT/paperclip_template" ${pnpmRun "migrate"})
            pg_ctl -D "$TMPDIR/pgdata" -m fast -w stop
          '';
          installPhase = ''cp -R "$TMPDIR/pgdata" "$out"'';
        };

      startSharedPostgres = pkgs: template: ''
        cp -R ${template} "$TMPDIR/shared-pgdata"
        chmod -R u+w "$TMPDIR/shared-pgdata"
        chmod 0700 "$TMPDIR/shared-pgdata"
        PGPORT_SHARED=$(${freePort})
        pg_ctl -D "$TMPDIR/shared-pgdata" -o "-p $PGPORT_SHARED -k $TMPDIR -c listen_addresses=127.0.0.1 -c autovacuum=on" -l "$TMPDIR/shared-pg.log" -w start
        export PAPERCLIP_TEST_POSTGRES_URL="postgres://paperclip@127.0.0.1:$PGPORT_SHARED/postgres"
      '';

      mkCheck = pkgs: kind: dir: command: mkCheckFrom {
        inherit pkgs kind dir command;
        src = checkSource dir;
        name = "${kind}-${slug dir}";
      };

      mkCheckFrom =
        {
          pkgs,
          kind,
          dir,
          command,
          src,
          name,
        }:
        let
          withDatabase = kind == "test" && usesDatabase dir;
        in
        pkgs.stdenv.mkDerivation {
          inherit name src;
          nativeBuildInputs = [
            pkgs.nodejs_24
            pkgs.pnpm_11
            pkgs.git
          ]
          ++ lib.optional withDatabase pkgs.postgresql_18
          ++ lib.optionals (kind == "test") (
            [
              pkgs.bashInteractive
              pkgs.coreutils
              pkgs.curl
              pkgs.findutils
              pkgs.gnugrep
              pkgs.gnused
              pkgs.jq
              pkgs.lsof
              pkgs.openssh
            ]
            ++ [ (if pkgs.stdenv.hostPlatform.isDarwin then pkgs.darwin.ps else pkgs.procps) ]
          );
          # The native runner binary is not part of what runs in production, so no
          # check compiles it.
          PAPERCLIP_SKIP_RUNNER_BINARY = "1";
          __darwinAllowLocalNetworking = true;
          dontConfigure = true;
          buildPhase = ''
            export HOME="$TMPDIR/home" CI=1
            mkdir -p "$HOME"
            chmod -R u+w .
            ${linkNodeModules self.packages.${pkgs.stdenv.hostPlatform.system}.nodeModules (installedDirs dir)}
            ${copyDists pkgs kind dir}
            chmod -R u+w .
            ${lib.optionalString withDatabase (startSharedPostgres pkgs (mkTestPostgresTemplate pkgs))}
            ROOT="$PWD"
            cd ${dir}
            ${if withDatabase then ''
              status=0
              (
                ${command}
              ) || status=$?
              pg_ctl -D "$TMPDIR/shared-pgdata" -m fast -w stop
              test "$status" -eq 0
            '' else command}
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

      # Test checks are keyed by what a test can import. nix/test-graph.json records
      # each file's direct imports; a bucket of tests takes the files reachable from
      # its tests as its source, so a change that no test in a bucket imports leaves
      # that bucket's result valid. Buckets are chosen by a hash of the test path, so
      # adding a test moves no other test. The file is generated by
      # `nix run .#update-test-graph` and kept current by the test-graph-current check.
      importGraph = builtins.fromJSON (builtins.readFile ./nix/test-graph.json);
      fileOf = id: builtins.elemAt importGraph.files id;
      reachableFrom =
        ids:
        map (item: item.key) (lib.genericClosure {
          startSet = map (key: { inherit key; }) ids;
          operator = item: map (key: { inherit key; }) (builtins.elemAt importGraph.edges item.key);
        });
      testGraphAlias = {
        ui = {
          "@/" = "ui/src/";
        };
        server = {
          "@paperclipai/paperclip-runner" = "packages/paperclip-runner/src/index.ts";
        };
      };
      testPackages = lib.filter (dir: builtins.pathExists (./. + "/${dir}/vitest.config.ts")) workspaceDirs;
      mkTestGraph =
        pkgs:
        pkgs.stdenv.mkDerivation {
          name = "test-graph";
          src = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions (
              rootFiles ++ [ ./nix/test-graph.mjs ./scripts ] ++ map (d: ./. + "/${d}") workspaceDirs
            );
          };
          nativeBuildInputs = [ pkgs.nodejs_24 ];
          dontConfigure = true;
          buildPhase = ''
            chmod -R u+w .
            ${linkNodeModules self.packages.${pkgs.stdenv.hostPlatform.system}.nodeModules workspaceDirs}
            node nix/test-graph.mjs "$PWD" '${
              builtins.toJSON (map (dir: { inherit dir; alias = testGraphAlias.${dir} or { }; }) testPackages)
            }' graph.json
          '';
          installPhase = "cp graph.json $out";
        };

      # The server's suites each start their own database and cannot share a process
      # pool; its own config asks for one worker, which only the root config can set.
      serialWorkers =
        dir: if dir == "server" then ", maxWorkers: 1, minWorkers: 1" else ", maxWorkers: ${toString otherWorkers}";
      # The gate shares the machine with other checks, and the packages' own limits
      # (15 s for a server test, 5 s elsewhere) assume an idle one; a hung test still fails.
      gateTimeoutMs = 60000;
      timeoutFlags = dir: " --testTimeout=${toString gateTimeoutMs} --hookTimeout=${toString gateTimeoutMs}";
      # Checks run side by side, so each leaves cores for the others.
      otherWorkers = 2;

      # Packages the root vitest config lists run from the repository root; the rest
      # (the Runner, the MCP servers, the plugin examples) run from their own directory.
      rootVitestProjects = lib.filter (dir: lib.elem dir workspaceDirs) (
        map builtins.head (
          builtins.filter builtins.isList (builtins.split ''"([A-Za-z0-9_./-]+)"'' (builtins.readFile ./vitest.config.ts))
        )
      );

      # Files a single test reads by name rather than by import; the bucket holding the
      # test gets them as inputs and no other check does.
      testInputs = {
        # Checks that every test file the stress traceability report names exists.
        "packages/paperclip-runner/src/eval/workflow-evals.test.ts" = [
          ./packages/paperclip-runner/src
          ./server/src/__tests__
          ./server/src/services/native-runtime
          ./ui/src/components
          ./ui/src/context
        ];
      };

      # Tests the gate does not run, each with its reason: they call a program or
      # reach a service the sandbox does not provide. This list is the whole of what
      # the Nix gate leaves out of the repository's test suites.
      droppedTests = {
        "packages/adapters/codex-local/src/server/reachability-matrix.test.ts" = "calls the codex CLI";
        "packages/adapters/hermes/src/server/detect-model.test.ts" = "calls the hermes CLI";
        "packages/adapters/kimi-local/src/server/execute.test.ts" = "depends on the kimi CLI's capability detection";
        "packages/paperclip-runner/src/live/runnerd-codex-transport-settlement.test.ts" = "needs the built Rust runner binary";
        "packages/paperclip-runner/src/live/runnerd-codex-transport.test.ts" = "needs the built Rust runner binary";
        "packages/paperclip-runner/src/mock-core/local-runner.test.ts" = "needs the built Rust runner binary";
        "packages/skills-catalog/src/packaged-artifacts.test.ts" = "runs pnpm build, which needs the package registry";
        "cli/src/__tests__/company-import-export-e2e.test.ts" = "starts the built server and waits for it";
        "server/src/__tests__/production-install.test.ts" = "runs pnpm deploy, which needs the package registry";
        "server/src/services/native-runtime/native-codex-runner.integration.test.ts" = "needs cargo";
      };

      # Single test cases the gate does not run, by file. They pin descriptors in a
      # temporary directory whose parents nobody else can write to; the build
      # directory of a Nix build sits under a shared parent, and the same cases fail
      # in the working tree when TMPDIR points at /private/tmp.
      droppedCases = {
        "packages/paperclip-runner/src/drivers/acpx/installation-integrity.test.ts" = [
          "loads a verified ESM snapshot with relative imports and arguments"
          "pins relative imports when the command directory is replaced"
          "keeps descriptor-pinned CommonJS identity across replacement"
        ];
      };
      caseFilter =
        ids:
        let
          cases = lib.concatMap (id: droppedCases.${fileOf id} or [ ]) ids;
        in
        lib.optionalString (cases != [ ]) " -t '^(?!.*(${lib.concatStringsSep "|" cases})).*'";

      # Each bucket pays vitest's transform and import cost once, so the server, whose
      # tests share large modules, uses larger buckets.
      testsPerBucket = dir: if dir == "server" then 20 else 8;
      bucketCount =
        dir: tests: lib.max 1 (builtins.div (builtins.length tests + testsPerBucket dir - 1) (testsPerBucket dir));
      bucketOf =
        count: test: lib.mod (lib.fromHexString (builtins.substring 0 6 (builtins.hashString "sha256" test))) count;

      # Tests that start listeners in the machine-wide runtime port range (42000-42999)
      # cannot run beside each other, so each group runs in one check, one file at a time.
      serialGroups = {
        "server-ports" = [
          "server/src/__tests__/local-service-supervisor.test.ts"
          "server/src/__tests__/workspace-runtime-exposure-reservation.test.ts"
          "server/src/__tests__/workspace-runtime.test.ts"
          "server/src/services/workspace-runtime-exposure.test.ts"
        ];
      };

      testBucketChecks =
        pkgs: dir:
        let
          package = importGraph.packages.${dir} or { common = [ ]; tests = [ ]; };
          grouped = lib.concatLists (lib.attrValues serialGroups);
          runTests = lib.filter (id: !(droppedTests ? ${fileOf id}) && !(lib.elem (fileOf id) grouped)) package.tests;
          testPaths = map fileOf runTests;
          count = bucketCount dir testPaths;
          bucketTests = index: lib.filter (id: bucketOf count (fileOf id) == index) runTests;
          groupTests = group: lib.filter (id: lib.elem (fileOf id) serialGroups.${group}) package.tests;
          sourceFor =
            ids:
            lib.fileset.toSource {
              root = ./.;
              fileset = lib.fileset.unions (
                rootFiles
                ++ lib.optional (needsScripts dir) ./scripts
                ++ extraSources dir
                ++ map (d: ./. + "/${d}/package.json") (closureDirs dir)
                # Built output (the plugin SDK, the Runner) imports its own dependencies,
                # which the import graph of the tests cannot see.
                ++ map (d: ./. + "/${d}") (lib.concatMap closureDirs (distDirs dir))
                ++ map (id: ./. + "/${fileOf id}") (reachableFrom (package.common ++ ids))
                ++ lib.concatMap (id: testInputs.${fileOf id} or [ ]) ids
              );
            };
          # Tests resolve repository paths against the working directory, and the
          # repository's own runner starts vitest at the root, so this does too: a
          # root config naming only this package's project, files by repository path.
          commandFor =
            ids:
            if lib.elem dir rootVitestProjects then ''
              cd "$ROOT"
              # Some tests ask git about the repository they run in.
              git init -q
              cat > vitest.config.ts <<'CONFIG'
              import { defineConfig } from "vitest/config";
              export default defineConfig({ test: { projects: [{ extends: "./${dir}/vitest.config.ts", test: { name: "${dir}", root: "./${dir}", testTimeout: ${toString gateTimeoutMs}, hookTimeout: ${toString gateTimeoutMs} } }]${serialWorkers dir} } });
              CONFIG
              ${pnpmExec "vitest run${timeoutFlags dir}${caseFilter ids} ${lib.concatMapStringsSep " " fileOf ids}"}
            '' else
              pnpmExec "vitest run --maxWorkers=${toString otherWorkers}${timeoutFlags dir}${caseFilter ids} ${
                lib.concatMapStringsSep " " (id: lib.removePrefix "${dir}/" (fileOf id)) ids
              }";
          checkFor =
            name: ids:
            lib.nameValuePair name (mkCheckFrom {
              inherit pkgs dir name;
              kind = "test";
              src = sourceFor ids;
              command = commandFor ids;
            });
        in
        map (index: checkFor "test-${slug dir}-b${toString index}" (bucketTests index)) (
          lib.filter (index: bucketTests index != [ ]) (lib.range 0 (count - 1))
        )
        ++ map (group: checkFor "test-${slug dir}-${group}" (groupTests group)) (
          lib.filter (group: groupTests group != [ ]) (lib.attrNames serialGroups)
        );

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
            ++ lib.optionals hasTests (testBucketChecks pkgs dir)
          ) workspaceDirs
        );
    in
    {
      checks = forAllSystems (
        pkgs:
        checksFor pkgs
        // {
          test-graph-current = pkgs.runCommand "test-graph-current" { } ''
            diff ${mkTestGraph pkgs} ${./nix/test-graph.json} \
              || { echo "nix/test-graph.json is stale: run nix run .#update-test-graph" >&2; exit 1; }
            touch $out
          '';
          node-modules-inputs = pkgs.runCommand "node-modules-inputs" { } ''
            test "${lib.boolToString installSelection.sameOnSourceEdit}" = true \
              || { echo "a source-only change altered the install inputs" >&2; exit 1; }
            test "${lib.boolToString installSelection.differsOnLockfileEdit}" = true \
              || { echo "a lockfile change left the install inputs unchanged" >&2; exit 1; }
            touch $out
          '';
        }
      );

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.git
            pkgs.nodejs_24
            pkgs.pnpm_11
          ];
          # Native runner binaries are not part of this workspace's development loop.
          PAPERCLIP_SKIP_RUNNER_BINARY = "1";
        };
      });

      apps = forAllSystems (pkgs: {
        update-test-graph = {
          type = "app";
          program = toString (
            pkgs.writeShellScript "update-test-graph" ''
              set -eu
              cp ${mkTestGraph pkgs} nix/test-graph.json
              chmod u+w nix/test-graph.json
            ''
          );
        };
      });

      packages = forAllSystems (pkgs: {
        test-graph = mkTestGraph pkgs;

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
          # pnpmConfigHook rewrites the interpreter line of every script in node_modules,
          # which changes the files tools verify by digest. The scripts keep the bytes the
          # packages shipped, as in any other install.
          postUnpack = "patchShebangs() { :; }";
          installPhase = ''
            runHook preInstall
            # The install ignores scripts; the packages pnpm-workspace.yaml lists under
            # allowBuilds are the only ones whose install scripts run, here: esbuild and
            # opencode-ai fetch their binaries, the embedded Postgres package links its
            # shared libraries.
            pnpm --config.verify-deps-before-run=false rebuild esbuild opencode-ai
            # The lockfile does not mark the platform packages as needing a build, so
            # pnpm rebuild skips them; their own postinstall script is run directly.
            for dir in node_modules/.pnpm/@embedded-postgres+*/node_modules/@embedded-postgres/*; do
              (cd "$dir" && sh -c "$(node -p 'require("./package.json").scripts.postinstall')")
            done
            mkdir -p "$out"
            find . -name node_modules -type d -prune -print0 | xargs -0 -I{} cp -a --parents {} "$out"
            # The bin shims pnpm writes set NODE_PATH to the directory the install ran
            # in, which is gone once the build ends. Point them at this output, whose
            # layout matches, so modules in pnpm's hoisted store resolve.
            grep -rIlF "$PWD" "$out" | xargs -r sed -i "s|$PWD|$out|g"
            runHook postInstall
          '';
          dontFixup = true;
        });
      });
    };
}
