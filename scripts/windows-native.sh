#!/usr/bin/env bash

set -euo pipefail

NODE_VERSION="${GLADE_WINDOWS_NODE_VERSION:-v25.2.1}"
NODE_ZIP="node-${NODE_VERSION}-win-x64.zip"
NODE_DIR_NAME="node-${NODE_VERSION}-win-x64"

command_name="${1:-start}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

win_home="$(powershell.exe -NoProfile -Command "[Environment]::GetFolderPath('UserProfile')" | tr -d '\r')"
if [[ -z "${win_home}" ]]; then
  echo "Could not determine Windows user profile path." >&2
  exit 1
fi

win_repo="${GLADE_WINDOWS_REPO:-${win_home}\\dev\\glade-native}"
win_tools="${GLADE_WINDOWS_TOOLS:-${win_home}\\tools}"
win_node_dir="${GLADE_WINDOWS_NODE_DIR:-${win_tools}\\${NODE_DIR_NAME}}"
win_node_zip="${win_tools}\\${NODE_ZIP}"

wsl_repo="$(wslpath -u "${win_repo}")"
wsl_tools="$(wslpath -u "${win_tools}")"
wsl_node_dir="$(wslpath -u "${win_node_dir}")"
wsl_node_zip="$(wslpath -u "${win_node_zip}")"

mkdir -p "${wsl_tools}" "${wsl_repo}"

bootstrap_windows_node() {
  if [[ -x "${wsl_node_dir}/node.exe" ]]; then
    return
  fi

  echo "Bootstrapping portable Windows Node ${NODE_VERSION}..."
  curl -L "https://nodejs.org/dist/${NODE_VERSION}/${NODE_ZIP}" -o "${wsl_node_zip}"
  powershell.exe -NoProfile -Command "Expand-Archive -LiteralPath '${win_node_zip}' -DestinationPath '${win_tools}' -Force" >/dev/null
}

sync_repo() {
  echo "Syncing repo into ${win_repo}..."
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude 'dist-electron' \
    ./ "${wsl_repo}/"
}

stop_windows_glade() {
  powershell.exe -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Where-Object { \$_.Path -like '${win_repo}*' } | Stop-Process -Force" >/dev/null || true
}

run_windows_cmd() {
  local windows_command="$1"
  cmd.exe /c "set PATH=${win_node_dir};%PATH% && cd /d ${win_repo} && ${windows_command}"
}

ensure_windows_deps() {
  if [[ ! -d "${wsl_repo}/node_modules" ]]; then
    echo "Installing Windows-side dependencies..."
    run_windows_cmd "npm.cmd install"
  fi
}

bootstrap_windows_node
sync_repo

case "${command_name}" in
  sync)
    ;;
  install)
    run_windows_cmd "npm.cmd install"
    ;;
  build)
    ensure_windows_deps
    run_windows_cmd "npm.cmd run build"
    ;;
  start)
    ensure_windows_deps
    stop_windows_glade
    run_windows_cmd "npm.cmd run build && npm.cmd start"
    ;;
  dev)
    ensure_windows_deps
    stop_windows_glade
    run_windows_cmd "start \"\" npm.cmd run dev"
    ;;
  *)
    echo "Usage: scripts/windows-native.sh [sync|install|build|start|dev]" >&2
    exit 1
    ;;
esac
