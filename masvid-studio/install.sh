#!/usr/bin/env bash
# Remote entry point: source by default; an explicit --package installs a pinned npm app.
set -euo pipefail

install_prebuilt() {
  [ "$#" -ge 2 ] || { echo 'Usage: install.sh --package EXACT_SPEC [setup options]' >&2; exit 1; }
  local motion_package="$2" motion_started=$SECONDS motion_download_dir=''
  shift 2
  for motion_command in node npm codex; do
    command -v "$motion_command" >/dev/null || { echo "缺少 $motion_command，请先安装后重试。" >&2; exit 1; }
  done
  node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<18)){console.error("需要 Node.js 22.18+");process.exit(1)}'
  node --input-type=module - "$motion_package" <<'JS'
import assert from 'node:assert/strict';
const spec = process.argv[2];
if (spec.startsWith('@')) assert(/^@openmotion\/app@\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(spec), 'Pin an exact OpenMotion package version');
else if (/^https?:/.test(spec)) {
  const url = new URL(spec);
  assert(!url.username && !url.password && (url.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)), 'Use HTTPS; HTTP is limited to a loopback acceptance server');
}
else assert(spec.startsWith('/') && spec.endsWith('.tgz'), 'Use an exact npm version, HTTPS candidate or absolute local tgz');
JS
  if [[ "$motion_package" != @openmotion/app@* ]]; then
    [[ "${OPENMOTION_INSTALLER_SHA256:-}" =~ ^[a-f0-9]{64}$ ]] || { echo 'Candidate input requires OPENMOTION_INSTALLER_SHA256 from its reviewed manifest.' >&2; exit 1; }
    if [[ "$motion_package" == http* ]]; then
      motion_download_dir="$(mktemp -d)"
      trap "rm -f -- $(printf '%q' "$motion_download_dir/openmotion.tgz"); rmdir -- $(printf '%q' "$motion_download_dir")" EXIT
      curl -fLsS -o "$motion_download_dir/openmotion.tgz" -- "$motion_package"
      motion_package="$motion_download_dir/openmotion.tgz"
    fi
    node --input-type=module - "$motion_package" "$OPENMOTION_INSTALLER_SHA256" <<'JS'
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
assert.equal(createHash('sha256').update(readFileSync(process.argv[2])).digest('hex'), process.argv[3], 'Installer SHA256 mismatch; no code was executed');
JS
  fi
  npm exec --yes --package "$motion_package" -- openmotion setup --host codex "$@"
  printf '[OpenMotion] prebuilt-install-total: %s seconds (download included)\n' "$((SECONDS - motion_started))"
}

main() {
  if [ "${1:-}" = '--package' ]; then install_prebuilt "$@"; return; fi
  if [ "$#" -ne 0 ]; then
    echo 'Usage: install.sh [--package EXACT_SPEC [Codex setup options]]. With no arguments, install from source.' >&2
    return 2
  fi
  local motion_repo='https://github.com/nexu-io/openmotion.git'
  local motion_ref="${OPENMOTION_REF:-main}"
  local motion_destination="${OPENMOTION_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/open-motion}"

  for motion_command in git node npm codex; do
    command -v "$motion_command" >/dev/null || { echo "缺少 $motion_command，请先安装后重试。" >&2; exit 1; }
  done
  node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<18)){console.error("需要 Node.js 22.18+");process.exit(1)}'
  codex plugin add --help >/dev/null || { echo '当前 Codex CLI 不支持插件安装，请升级后重试。' >&2; exit 1; }

  case "$motion_destination" in
    /*) ;;
    *) echo 'OPENMOTION_INSTALL_DIR 必须是绝对路径。' >&2; exit 1 ;;
  esac
  if [ -e "$motion_destination" ] || [ -L "$motion_destination" ]; then
    echo "安装目录已存在，未覆盖：$motion_destination" >&2
    echo '如需重新安装，请用 OPENMOTION_INSTALL_DIR 指定新的空目录。' >&2
    exit 1
  fi

  mkdir -p "$(dirname -- "$motion_destination")"
  echo "下载 OpenMotion ($motion_ref) 到 $motion_destination"
  local motion_download_started=$SECONDS
  # Optional media remain LFS pointers. Ignore stale global LFS filters even when
  # git-lfs was uninstalled; this affects this clone only, never global settings.
  git -c filter.lfs.process= -c filter.lfs.smudge= -c filter.lfs.required=false \
    clone --depth 1 --single-branch --branch "$motion_ref" -- "$motion_repo" "$motion_destination"
  export OPENMOTION_SOURCE_DOWNLOAD_SECONDS=$((SECONDS - motion_download_started))
  echo "[OpenMotion] source-download: $OPENMOTION_SOURCE_DOWNLOAD_SECONDS seconds"
  bash "$motion_destination/scripts/install-motion.command"
}

main "$@"
