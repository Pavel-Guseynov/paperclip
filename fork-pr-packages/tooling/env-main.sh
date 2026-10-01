# Fork main pins pnpm 11 itself: use the repository's own pnpm configuration, no overrides.
export PATH=/opt/nvm/versions/node/v24.21.0/bin:/usr/lib/postgresql/16/bin:/root/.cargo/bin:$PATH
export S=/opt/pch
export RUSTUP_HOME=/root/.rustup
if [ "$(id -u)" != "0" ]; then export CARGO_HOME=$HOME/.cargo; fi
