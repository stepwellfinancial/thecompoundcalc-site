#!/usr/bin/env bash
# Checks the five files the two sites share: app.js, calc.js, styles.css, scenario.js and saved.js
# (scenario.js, the scenario link, and saved.js, saved scenarios, were added on 2026-10-31).
#
# Where both site folders sit side by side (the source of both repositories):
#   bash scripts/check-shared.sh [master-dir] [copy-dir]
#   (a) the five files in copy-dir are byte-identical to master-dir;
#   (b) copy-dir/shared.sha256 equals the hashes of the master-dir files, line for line.
#
# In each site's own repository, the calculator's and the main site's (each has
# its own copy of this script and of the main site's shared.sha256):
#   bash scripts/check-shared.sh --deployed <folder>
#   shared.sha256 has exactly five lines naming app.js, calc.js, styles.css, scenario.js and saved.js,
#   in that order, then every hash matches (sha256sum -c, or shasum -a 256 -c on
#   macOS). This proves only that the files match the hash file that came with
#   them; the launch-day comparison of the two live calc.js files is the real check.
#
# Every failure prints a plain message naming the file. Exit 0: all good.
# Exit 1: a check failed. Exit 2: a folder or file is missing.
set -u

files="app.js calc.js styles.css scenario.js saved.js"   # this order is the hash file's line order
fail=0

if command -v sha256sum >/dev/null 2>&1; then
  hash() { sha256sum "$1" | cut -d' ' -f1; }
  checksum() { sha256sum -c --quiet "$1"; }
else
  hash() { shasum -a 256 "$1" | cut -d' ' -f1; }
  checksum() { shasum -a 256 -c --quiet "$1"; }
fi

bad() { echo "::error::$1"; fail=1; }

check_format() {   # $1 = path of shared.sha256
  local hf="$1" n=0 want line
  if [ ! -f "$hf" ]; then echo "::error::$hf is missing."; exit 2; fi
  n=$(wc -l < "$hf" | tr -d ' ')
  if [ "$n" != "5" ]; then bad "$hf must have exactly 5 lines, found $n."; return; fi
  local i=0
  for want in $files; do
    i=$((i + 1))
    line=$(sed -n "${i}p" "$hf")
    if ! printf '%s\n' "$line" | grep -Eq "^[0-9a-f]{64}  ${want//./\\.}\$"; then
      bad "$hf line $i must be '<64 hex>  $want', found: $line"
    fi
  done
}

if [ "${1:-}" = "--deployed" ]; then
  dir="${2:-}"
  if [ -z "$dir" ] || [ ! -d "$dir" ]; then echo "::error::no folder '$dir' to check."; exit 2; fi
  check_format "$dir/shared.sha256"
  if [ "$fail" -eq 0 ]; then
    if ! (cd "$dir" && checksum shared.sha256); then
      bad "A shared file in $dir does not match $dir/shared.sha256 (see the line above)."
    fi
  fi
  [ "$fail" -eq 0 ] && echo "OK: $dir/app.js, calc.js, styles.css, scenario.js and saved.js match $dir/shared.sha256."
  exit "$fail"
fi

src="${1:-site}"
dst="${2:-site-main}"
for d in "$src" "$dst"; do
  if [ ! -d "$d" ]; then echo "::error::no folder '$d' to check."; exit 2; fi
done

# (a) byte-identical copies
for f in $files; do
  if [ ! -f "$src/$f" ]; then echo "::error::$src/$f is missing."; exit 2; fi
  if [ ! -f "$dst/$f" ]; then bad "$dst/$f is missing. Copy the shared files from the master folder first."; continue; fi
  if ! cmp -s "$src/$f" "$dst/$f"; then
    bad "$dst/$f differs from $src/$f. Never edit it by hand: copy the shared files from the master folder."
  fi
done

# (b) the hash file equals the hashes of the master files, line for line
hf="$dst/shared.sha256"
check_format "$hf"
if [ -f "$hf" ]; then
  i=0
  for f in $files; do
    i=$((i + 1))
    want="$(hash "$src/$f")  $f"
    got="$(sed -n "${i}p" "$hf")"
    if [ "$got" != "$want" ]; then
      bad "$hf line $i is stale for $f (expected the hash of $src/$f). Copy the shared files from the master folder first."
    fi
  done
fi

[ "$fail" -eq 0 ] && echo "OK: $dst/app.js, calc.js, styles.css, scenario.js and saved.js are byte-identical to $src/, and $hf matches."
exit "$fail"
