#!/usr/bin/env bash
# Ubuntu 24.04 ships PostgreSQL 16. The race and exposure scripts need PostgreSQL 17 binaries, not a hosted database.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if [ ! -x /usr/lib/postgresql/17/bin/initdb ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "sudo is required to install PostgreSQL 17" >&2
    exit 1
  fi
  sudo apt-get update
  if ! apt-cache show postgresql-17 >/dev/null 2>&1; then
    sudo apt-get install -y postgresql-common ca-certificates
    key="/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg"
    if [ ! -f "$key" ]; then
      key="/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc"
    fi
    if [ ! -f "$key" ]; then
      echo "PostgreSQL APT keyring is missing" >&2
      exit 1
    fi
    . /etc/os-release
    sudo tee /etc/apt/sources.list.d/pgdg.sources >/dev/null <<EOF
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: ${VERSION_CODENAME}-pgdg
Components: main
Signed-By: ${key}
EOF
    sudo apt-get update
  fi
  sudo apt-get install -y postgresql-17
fi
if [ ! -x /usr/lib/postgresql/17/bin/initdb ]; then
  echo "PostgreSQL 17 binaries were not installed at /usr/lib/postgresql/17/bin" >&2
  exit 1
fi
dest="${HOME}/.local/lib/onetab"
mkdir -p "$dest"
if [ ! -x "$dest/postgrest" ]; then
  archive="$(mktemp)"
  curl -fsSL -o "$archive" "https://github.com/PostgREST/postgrest/releases/download/v16.5/postgrest-v16.5-linux-static-x86-64.tar.xz"
  tar -C "$dest" -xJf "$archive"
  rm -f "$archive"
  chmod 755 "$dest/postgrest"
fi
postgrest_version="$("$dest/postgrest" --version)"
case "$postgrest_version" in
  *16.5*) ;;
  *) echo "unexpected PostgREST: $postgrest_version" >&2; exit 1 ;;
esac
postgres_version="$(/usr/lib/postgresql/17/bin/postgres --version)"
case "$postgres_version" in
  *"PostgreSQL) 17."*) ;;
  *) echo "unexpected PostgreSQL: $postgres_version" >&2; exit 1 ;;
esac
if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "PG17_ROOT=/"
    echo "POSTGREST_BIN=${dest}/postgrest"
  } >> "$GITHUB_ENV"
fi
echo "SQL_TOOLS_OK ${postgres_version} ${postgrest_version}"
