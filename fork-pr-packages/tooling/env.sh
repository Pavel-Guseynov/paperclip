export PATH=/opt/nvm/versions/node/v24.21.0/bin:/usr/lib/postgresql/16/bin:/root/.cargo/bin:$PATH
export S=/opt/pch
export pnpm_config_pm_on_fail=ignore
export RUSTUP_HOME=/root/.rustup
if [ "$(id -u)" != "0" ]; then export CARGO_HOME=$HOME/.cargo; fi
export pnpm_config_verify_deps_before_run=false
export pnpm_config_auto_install_peers=false
export pnpm_config_dangerously_allow_all_builds=true
