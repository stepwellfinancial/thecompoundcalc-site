#!/usr/bin/env bash
# Refuses to publish while a site folder still holds a launch placeholder, an
# unwritten copy block or a review note (About spec criterion 23; two-site spec,
# "Deploy guard"). Run by the `verify` job in each site's pages.yml before its
# deploy job, and runnable locally on either folder:
#
#   bash scripts/check-placeholders.sh site        (the calculator, {calc-domain})
#   bash scripts/check-placeholders.sh site-main   (the main site, {main-domain})
#
# Every hit is printed as file:line. Exit 0: clean. Exit 1: something was found
# or CNAME is missing. Exit 2: the folder does not exist or grep failed.
#
# "ECM Finance" was the brand placeholder before 2026-10-26. The public brand
# is Stepwell Financial (DECISIONS.md, 2026-10-26), so the old placeholder must
# never reach a published page; the check below stays.
set -u

dir="${1:-site}"
if [ ! -d "$dir" ]; then
  echo "::error::no folder '$dir' to check."
  exit 2
fi

fail=0
RUN_SCRIPT="Run scripts/set-brand-domain.py first (LAUNCH.md, placeholders step)."

# grep exits 0 on a match, 1 on no match, 2 on an error. Anything but 1 fails.
check() {
  local message="$1"; shift
  grep -rn "$@" "$dir"
  local rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "::error::$message"
    fail=1
  elif [ "$rc" -ne 1 ]; then
    echo "::error::grep failed (exit $rc) while checking '$dir'."
    exit 2
  fi
}

check "The placeholder domain example.com is still in $dir/. $RUN_SCRIPT" -e 'example\.com'
check "A {placeholder} is still in $dir/. $RUN_SCRIPT" -F \
  -e '{Brand}' -e '{domain}' -e '{calc-domain}' -e '{main-domain}' -e '{legal-owner}' \
  -e '{contact-email}' -e '{last-updated}' -e '{year}' -e '{link:'
check "The old placeholder brand \"ECM Finance\" is still in $dir/. $RUN_SCRIPT" -e 'ECM Finance'
# Copy that is not written yet, and notes from the copy files, never reach a
# published page. The script does not fill these in: the Content Editor's
# approved copy replaces them.
check "A copy block marked {copy:...} has not been written yet in $dir/. Replace it with the Content Editor's approved copy." -F -e '{copy:'
check "A copy or review note is still in $dir/. Remove it: it belongs in content/ or reviews/, not on a page." -F \
  -e 'QA TO VERIFY' -e 'CEO to state' -e '[Retention' -e '[provider'

if [ ! -s "$dir/CNAME" ]; then
  echo "::error::$dir/CNAME is missing or empty. $RUN_SCRIPT"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: no placeholders, copy markers or review notes in $dir/, and CNAME is present."
fi
exit "$fail"
