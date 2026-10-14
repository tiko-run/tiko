#!/bin/sh
# tiko installer for Linux and macOS: checks the machine, installs Docker when it is missing,
# writes .env with generated secrets and starts the released images. Run it again to upgrade.
#
#   curl -fsSL https://tiko.run/install.sh | sh
#   curl -fsSL https://tiko.run/install.sh | sh -s -- --yes --port 8080
#
# Env: TIKO_DIR, TIKO_PORT (3000), TIKO_VERSION (latest release), TIKO_YES=1,
#      TIKO_UPDATER (yes or no: one-click updates, asked otherwise),
#      TIKO_USAGE_STATS=false (send no usage stats, see https://docs.tiko.run/privacy/),
#      TIKO_COMPOSE_URL (another compose file, for testing a branch).
set -eu

REPO=tiko-run/tiko
MIN_MEM_MB=1024
WARN_MEM_MB=2048
MIN_DISK_MB=2048
STATS_URL=${TIKO_STATS_URL:-https://t.tiko.run/v1/events}

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
die() { printf '\nError: %s\n' "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

usage() {
  say "Usage: install.sh [--yes] [--dir DIR] [--port PORT] [--version VERSION] [--no-updater] [--no-stats]"
  say "Installs tiko with Docker, or upgrades the install in DIR."
}

parse_args() {
  YES=${TIKO_YES:-0}
  DIR=${TIKO_DIR:-}
  PORT=${TIKO_PORT:-}
  VERSION=${TIKO_VERSION:-latest}
  UPDATER=${TIKO_UPDATER:-}
  STATS=${TIKO_USAGE_STATS:-true}
  while [ $# -gt 0 ]; do
    case "$1" in
      -y | --yes) YES=1 ;;
      --dir) DIR=${2:?--dir needs a value}; shift ;;
      --port) PORT=${2:?--port needs a value}; shift ;;
      --version) VERSION=${2:?--version needs a value}; shift ;;
      --no-updater) UPDATER=no ;;
      --no-stats) STATS=false ;;
      -h | --help) usage; exit 0 ;;
      *) usage; die "unknown option: $1" ;;
    esac
    shift
  done
  VERSION=${VERSION#v}
}

# Questions go to the terminal even when the script itself comes through a pipe.
ask() {
  [ "$YES" = 1 ] && return 0
  if ! { : </dev/tty; } 2>/dev/null; then
    die "no terminal to ask \"$1\"; run again with --yes to agree to everything"
  fi
  printf '%s [y/N] ' "$1" >/dev/tty
  read -r answer </dev/tty || answer=
  case "$answer" in y | Y | yes | Yes) return 0 ;; *) return 1 ;; esac
}

# A question where yes is the usual answer; without a terminal it is yes.
ask_yes() {
  [ "$YES" = 1 ] && return 0
  { : </dev/tty; } 2>/dev/null || return 0
  printf '%s [Y/n] ' "$1" >/dev/tty
  read -r answer </dev/tty || answer=
  case "$answer" in n | N | no | No) return 1 ;; *) return 0 ;; esac
}

fetch() {
  if has curl; then
    curl -fsSL "$1" -o "$2"
  elif has wget; then
    wget -qO "$2" "$1"
  else
    die "neither curl nor wget is installed"
  fi
}

as_root() {
  if [ "$(id -u)" = 0 ]; then
    "$@"
  elif has sudo; then
    sudo "$@"
  else
    die "this step needs root: run the installer as root or install sudo"
  fi
}

check_system() {
  step "Checking this machine"
  OS=$(uname -s)
  case "$OS" in
    Linux | Darwin) ;;
    *) die "$OS is not supported; on Windows use install.ps1" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64 | aarch64 | arm64) ;;
    *) die "$(uname -m) is not supported: tiko images are built for 64-bit x86 and ARM" ;;
  esac

  if [ "$OS" = Linux ]; then
    mem_mb=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)
  else
    mem_mb=$(($(sysctl -n hw.memsize) / 1048576))
  fi
  [ "$mem_mb" -ge "$MIN_MEM_MB" ] || die "tiko needs at least 1 GB of memory, this machine has ${mem_mb} MB"
  [ "$mem_mb" -ge "$WARN_MEM_MB" ] || say "Warning: ${mem_mb} MB of memory is tight; 2 GB or more is better."

  if [ -z "$DIR" ]; then
    if [ "$OS" = Linux ] && [ "$(id -u)" = 0 ]; then DIR=/opt/tiko; else DIR="$HOME/tiko"; fi
  fi
  probe=$DIR
  while [ ! -d "$probe" ]; do probe=$(dirname "$probe"); done
  disk_mb=$(df -Pk "$probe" | awk 'NR == 2 { print int($4 / 1024) }')
  [ "$disk_mb" -ge "$MIN_DISK_MB" ] || die "tiko needs 2 GB of free disk at $probe, there is ${disk_mb} MB"

  if [ -f "$DIR/.env" ]; then
    UPGRADE=1
    [ -n "$PORT" ] || PORT=$(sed -n 's/^TIKO_PORT=//p' "$DIR/.env")
    # Turned off once, the install stays quiet on every upgrade.
    if grep -q '^TIKO_USAGE_STATS=false' "$DIR/.env"; then STATS=false; fi
  else
    UPGRADE=0
  fi
  PORT=${PORT:-3000}
  if [ "$UPGRADE" = 0 ] && port_busy "$PORT"; then
    die "port $PORT is taken by another program; pick another one with --port"
  fi
  say "OK: $OS $(uname -m), ${mem_mb} MB memory, ${disk_mb} MB free disk, port $PORT"
}

port_busy() {
  if has ss; then
    [ -n "$(ss -Hltn "sport = :$1" 2>/dev/null)" ]
  elif has lsof; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  elif has nc; then
    nc -z 127.0.0.1 "$1" >/dev/null 2>&1
  else
    return 1
  fi
}

ensure_docker() {
  step "Checking Docker"
  has docker || install_docker
  DOCKER=docker
  HINT=docker
  docker info >/dev/null 2>&1 || start_docker
  if ! docker info >/dev/null 2>&1; then
    if [ "$OS" = Linux ] && as_root docker info >/dev/null 2>&1; then
      # Fresh Docker on Linux: the user is not in the docker group yet.
      DOCKER="as_root docker"
      HINT="sudo docker"
      say "Using sudo for Docker. To drop it: sudo usermod -aG docker $(id -un), then sign in again."
    else
      die "Docker is installed but does not answer; start it and run the installer again"
    fi
  fi
  $DOCKER compose version >/dev/null 2>&1 ||
    die "Docker Compose v2 is missing: https://docs.docker.com/compose/install/"
  say "OK: $($DOCKER --version)"
}

install_docker() {
  if [ "$OS" = Linux ]; then
    ask "Docker is not installed. Install Docker Engine with the official script from get.docker.com?" ||
      die "tiko runs in Docker; install it and run the installer again: https://docs.docker.com/engine/install/"
    script=$(mktemp)
    fetch https://get.docker.com "$script"
    as_root sh "$script" || die "the Docker install script failed; see https://docs.docker.com/engine/install/ for your distribution"
    rm -f "$script"
    if has systemctl; then as_root systemctl enable --now docker; fi
  else
    if ! has brew; then
      say "Docker is not installed. Pick one, then run the installer again:"
      say "  - Homebrew (https://brew.sh): the installer then sets up Colima, a free Docker engine;"
      say "  - Docker Desktop (https://docs.docker.com/desktop/setup/install/mac-install/),"
      say "    free to install and use; only large companies need a Docker license."
      die "Docker is required"
    fi
    ask "Docker is not installed. Install Colima, the Docker CLI and Compose with Homebrew?" ||
      die "tiko runs in Docker; install it and run the installer again"
    brew install colima docker docker-compose
    # Homebrew's Compose is a CLI plugin outside Docker's search path.
    mkdir -p "$HOME/.docker/cli-plugins"
    ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" "$HOME/.docker/cli-plugins/docker-compose"
    colima start --cpu 2 --memory 2 --disk 10
  fi
}

start_docker() {
  if [ "$OS" = Linux ]; then
    if has systemctl; then as_root systemctl start docker || true; fi
  elif has colima && ! colima status >/dev/null 2>&1 && [ "$(docker context show 2>/dev/null)" = colima ]; then
    colima start
  elif [ "$(docker context show 2>/dev/null)" = orbstack ]; then
    open -ga OrbStack
  else
    open -ga Docker 2>/dev/null || true
  fi
  say "Waiting for Docker to start (up to 2 minutes)..."
  i=0
  while [ $i -lt 120 ]; do
    docker info >/dev/null 2>&1 && return 0
    as_root docker info >/dev/null 2>&1 && return 0
    sleep 1
    i=$((i + 1))
  done
}

random_password() {
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20
}

random_key() {
  if has openssl; then openssl rand -base64 32; else head -c 32 /dev/urandom | base64 | tr -d '\n'; fi
}

# The compose project is named tiko, so a stack started from another folder would be replaced.
check_other_stack() {
  project=${COMPOSE_PROJECT_NAME:-tiko}
  dir=$(cd "$DIR" 2>/dev/null && pwd -P || echo "$DIR")
  $DOCKER ps -a --filter "label=com.docker.compose.project=$project" \
    --format '{{.Label "com.docker.compose.project.working_dir"}}' | sort -u | while read -r other; do
    [ -z "$other" ] || [ "$(cd "$other" 2>/dev/null && pwd -P || echo "$other")" = "$dir" ] ||
      die "tiko already runs from $other; stop it there with 'docker compose down', or upgrade it with --dir $other"
  done
}

prepare_dir() {
  check_other_stack
  step "Preparing $DIR"
  mkdir -p "$DIR/data" 2>/dev/null || as_root sh -c "mkdir -p '$DIR/data' && chown -R $(id -u):$(id -g) '$DIR'"
  cd "$DIR"
  if [ "$UPGRADE" = 0 ]; then
    PASSWORD=$(random_password)
    (
      umask 077
      {
        echo "# Written by the tiko installer. The password is for the first admin only."
        echo "TIKO_PASSWORD=$PASSWORD"
        echo "TIKO_SECRET_KEY=$(random_key)"
        echo "TIKO_PORT=$PORT"
        echo "TIKO_DEPLOY=installer"
      } >.env
    )
    say "Created .env with a generated password and secret key"
  elif ! grep -q "^TIKO_PORT=$PORT\$" .env; then
    grep -v '^TIKO_PORT=' .env >.env.new
    echo "TIKO_PORT=$PORT" >>.env.new
    mv .env.new .env
    chmod 600 .env
  fi

  keep_env TIKO_DEPLOY installer
  [ "$STATS" = true ] || keep_env TIKO_USAGE_STATS false
  choose_updater

  STEP=download
  if [ -n "${TIKO_COMPOSE_URL:-}" ]; then
    url=$TIKO_COMPOSE_URL
  elif [ "$VERSION" = latest ]; then
    url="https://github.com/$REPO/releases/latest/download/compose.release.yml"
  else
    url="https://github.com/$REPO/releases/download/v$VERSION/compose.release.yml"
  fi
  fetch "$url" compose.yaml.new || die "could not download $url"
  mv compose.yaml.new compose.yaml
}

start_tiko() {
  step "Starting tiko"
  STEP=pull
  $DOCKER compose pull --quiet
  STEP=start
  $DOCKER compose up -d --remove-orphans
  STEP=health
  say "Waiting for tiko to answer on port $PORT..."
  i=0
  while [ $i -lt 90 ]; do
    if fetch "http://127.0.0.1:$PORT/" /dev/null 2>/dev/null; then return 0; fi
    sleep 2
    i=$((i + 1))
  done
  die "tiko did not start; see the logs: cd $DIR && $HINT compose logs"
}

finish() {
  # shellcheck disable=SC2016  # matches the literal  in the compose file
  version=$(sed -n 's/.*tiko-api:\${TAG:-\(.*\)}.*/\1/p' compose.yaml | head -n 1)
  address="http://localhost:$PORT"
  if [ "$OS" = Linux ] && [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && has hostname; then
    ip=$(hostname -I 2>/dev/null | awk '{ print $1 }')
    [ -z "$ip" ] || address="$address or http://$ip:$PORT"
  fi
  step "tiko ${version:-} is running"
  on='' off=''
  if [ -t 1 ]; then on=$(printf '\033[1;32m') off=$(printf '\033[0m'); fi
  say ""
  say "${on}  Open:      $address${off}"
  if [ "$UPGRADE" = 0 ]; then
    say "${on}  Username:  admin${off}"
    say "${on}  Password:  $PASSWORD${off}"
    say ""
    say "Change the password in Settings → Security; until then it is also in $DIR/.env"
  else
    say "${on}  Sign in as before: boards, accounts and settings are kept.${off}"
    say ""
  fi
  say "Folder:    $DIR (boards in data/, settings in .env)"
  say "Logs:      cd $DIR && $HINT compose logs -f"
  say "Upgrade:   run this installer again"
  say "Guide:     https://docs.tiko.run/"
  say ""
  stats_notice
}

# Sets KEY=VALUE in .env, keeping the other lines.
keep_env() {
  grep -q "^$1=$2\$" .env && return 0
  grep -v "^$1=" .env >.env.new || true
  echo "$1=$2" >>.env.new
  mv .env.new .env
  chmod 600 .env
}

stats_notice() {
  if [ "$STATS" = true ]; then
    say "Usage stats:   on  (version, OS, install count; no personal data)"
    say "               off with --no-stats or in Settings → Privacy: https://docs.tiko.run/privacy/"
  else
    say "Usage stats:   off"
  fi
  say "Error reports: off until an admin turns them on in Settings → Privacy"
}

json_string() {
  if [ -n "$1" ]; then printf '"%s"' "$1"; else printf 'null'; fi
}

# One event about this install, listed at https://docs.tiko.run/privacy/; a failure to send is ignored.
send_install_event() {
  [ "$STATS" = true ] || return 0
  # shellcheck disable=SC2016  # matches the literal  in the compose file
  installed=$(sed -n 's/.*tiko-api:\${TAG:-\(.*\)}.*/\1/p' "$DIR/compose.yaml" 2>/dev/null | head -n 1) || installed=
  case "$(uname -m)" in x86_64 | amd64) arch=amd64 ;; aarch64 | arm64) arch=arm64 ;; *) arch=other ;; esac
  updater=false
  [ "$UPDATER" = yes ] && updater=true
  body=$(printf '{"kind":"install","schema":1,"version":%s,"os":"%s","arch":"%s","installer":"sh","updater":%s,"failed_step":%s}' \
    "$(json_string "$installed")" "$(uname -s | tr '[:upper:]' '[:lower:]')" "$arch" "$updater" "$(json_string "$1")")
  if has curl; then
    curl -fsS -m 3 -X POST -H 'Content-Type: application/json' -d "$body" "$STATS_URL" >/dev/null 2>&1 || true
  elif has wget; then
    wget -q -T 3 -t 1 -O /dev/null --header='Content-Type: application/json' --post-data="$body" "$STATS_URL" >/dev/null 2>&1 || true
  fi
}

# Any exit before the end is a failed install; Ctrl-C is not.
on_exit() {
  status=$?
  [ "$status" = 0 ] || [ "$status" = 130 ] || send_install_event "$STEP"
}

# Asked once and kept in .env, so an upgrade does not ask again; TIKO_UPDATER or --no-updater
# change the kept answer.
choose_updater() {
  if grep -q '^COMPOSE_PROFILES=' .env; then
    [ -n "$UPDATER" ] || return 0
    grep -v '^COMPOSE_PROFILES=' .env >.env.new
    mv .env.new .env
    chmod 600 .env
  fi
  if [ -z "$UPDATER" ]; then
    # Rootless Docker keeps its socket in the user's runtime folder, where the updater cannot see it.
    if $DOCKER info --format '{{.SecurityOptions}}' 2>/dev/null | grep -q rootless; then
      say "Rootless Docker: one-click updates are off; update by running this installer again."
      UPDATER=no
    else
      say "One-click updates add a small service with access to Docker, so an admin can update"
      say "tiko from the About button. Without it you update by running this installer again."
      if ask_yes "Turn on one-click updates?"; then UPDATER=yes; else UPDATER=no; fi
    fi
  fi
  if [ "$UPDATER" = yes ]; then
    echo "COMPOSE_PROFILES=updater" >>.env
    say "One-click updates are on"
  else
    echo "COMPOSE_PROFILES=" >>.env
  fi
}

main() {
  parse_args "$@"
  say "tiko installer: checks this machine, installs Docker if needed (after asking) and starts tiko."
  stats_notice
  STEP=docker-check
  trap on_exit EXIT
  trap 'exit 130' INT
  check_system
  ensure_docker
  prepare_dir
  start_tiko
  trap - EXIT
  send_install_event ""
  finish
}

# Called on the last line, so a download cut in the middle runs nothing.
main "$@"
