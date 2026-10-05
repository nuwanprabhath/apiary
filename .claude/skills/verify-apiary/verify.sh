#!/usr/bin/env bash
# Drives the real, built Apiary for verification. Usage and rules: SKILL.md next to this file.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
cd "$repo"

usage() {
  cat <<'EOF'
verify.sh doctor                         is this checkout worth driving? (builds if stale, boots once)
verify.sh run <drive> [--headed] [--no-build]
                                         run drives/<drive>.verify.ts, drives/local/<drive>.verify.ts,
                                         or a path to a .verify.ts file under drives/
verify.sh cleanup [--kill]               list (or kill) stray harness instances and old temp homes
EOF
}

# The build is stale when any file under src/ is newer than the bundle the harness launches.
stale() {
  [ ! -f out/main/index.js ] || [ -n "$(find src -type f -newer out/main/index.js -print -quit)" ]
}

build_if_stale() {
  if stale; then
    echo "verify: out/ is older than src/, building"
    npm run build >/dev/null
  fi
}

# Every harness launch passes --user-data-dir under a fresh "apiary-e2e-" temp home, so this
# pattern matches instances the harness started and never the maintainer's own Apiary.
strays() {
  # shellcheck disable=SC2009 # pgrep cannot print elapsed time, which cleanup decides on
  ps -axo pid=,etime=,command= | grep -E -- '--user-data-dir=[^ ]*apiary-e2e-' | grep -v grep || true
}

# etime is [[dd-]hh:]mm:ss; true when the process has been up longer than 10 minutes. A drive
# never runs that long, so a younger one may belong to a test run another agent is doing.
older_than_10m() {
  local etime="$1" days=0 h=0 m=0 s=0
  if [[ "$etime" == *-* ]]; then days="${etime%%-*}"; etime="${etime#*-}"; fi
  IFS=: read -r -a parts <<<"$etime"
  if [ "${#parts[@]}" -eq 3 ]; then h="${parts[0]}"; m="${parts[1]}"; s="${parts[2]}"; else m="${parts[0]}"; s="${parts[1]}"; fi
  [ $(( 10#$days * 86400 + 10#$h * 3600 + 10#$m * 60 + 10#$s )) -gt 600 ]
}

resolve_drive() {
  local name="$1"
  for candidate in "$name" "$here/drives/$name.verify.ts" "$here/drives/local/$name.verify.ts"; do
    if [ -f "$candidate" ]; then
      (cd "$(dirname "$candidate")" && echo "$(pwd)/$(basename "$candidate")")
      return
    fi
  done
  echo "verify: no drive called '$name' (looked in drives/ and drives/local/)" >&2
  exit 2
}

run_drive() {
  local drive="" headed=0 build=1
  while [ $# -gt 0 ]; do
    case "$1" in
      --headed) headed=1 ;;
      --no-build) build=0 ;;
      *) drive="$1" ;;
    esac
    shift
  done
  [ -n "$drive" ] || { usage; exit 2; }
  local file
  file="$(resolve_drive "$drive")"
  [ "$build" -eq 1 ] && build_if_stale

  VERIFY_RUN="$(date +%Y%m%d-%H%M%S)-$(basename "$file" .verify.ts)"
  export VERIFY_RUN
  local evidence="$repo/.verify/evidence/$VERIFY_RUN"
  local status=0
  if [ "$headed" -eq 1 ]; then export APIARY_HEADED=1; fi
  npx playwright test --config "$here/playwright.verify.config.ts" "${file#"$here/drives/"}" || status=$?
  echo
  echo "verify: evidence in $evidence"
  [ -d "$evidence" ] && ls -1 "$evidence"
  return "$status"
}

doctor() {
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 22 ] || { echo "doctor: Node $major, the repo needs >= 22"; exit 1; }
  [ -d node_modules ] || { echo "doctor: no node_modules, run npm ci"; exit 1; }
  local found
  found="$(strays)"
  if [ -n "$found" ]; then
    echo "doctor: harness instances already running (yours if older than a drive, maybe another agent's if not):"
    echo "$found"
  fi
  run_drive doctor
}

cleanup() {
  local kill=0
  [ "${1:-}" = "--kill" ] && kill=1
  local found
  found="$(strays)"
  if [ -z "$found" ]; then
    echo "cleanup: no harness instances running"
  else
    while read -r pid etime _; do
      if [ "$kill" -eq 1 ] && older_than_10m "$etime"; then
        kill -9 "$pid" 2>/dev/null && echo "cleanup: killed $pid (up $etime)"
      else
        echo "cleanup: running $pid (up $etime)"
      fi
    done <<<"$found"
  fi
  # Temp homes the harness made and did not remove; a day old means no run is still using them.
  local tmp="${TMPDIR:-/tmp}"
  find "$tmp" -maxdepth 1 -name 'apiary-e2e-*' -type d -mtime +1 -print -exec rm -rf {} + 2>/dev/null \
    | sed 's/^/cleanup: removed /' || true
  echo "cleanup: evidence kept in $repo/.verify/evidence"
}

case "${1:-}" in
  doctor) doctor ;;
  run) shift; run_drive "$@" ;;
  cleanup) shift; cleanup "$@" ;;
  *) usage; exit 2 ;;
esac
