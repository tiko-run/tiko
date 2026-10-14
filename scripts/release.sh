#!/usr/bin/env bash
# Cut a CalVer release vYYYY.M.N: UTC year and month, N counts releases in that month from 0, so a
# hotfix on the same day gets the next number. Moves CHANGELOG.md "Unreleased" into a version
# section, commits, tags and pushes. The tag starts .github/workflows/release.yml.
#
# LEVEL (feature, hotfix, breaking, security; feature by default) becomes the first line of the
# version's section, which the running app reads from the release notes to flag the update.
#
# Usage: [LEVEL=security] scripts/release.sh [--dry-run]
set -euo pipefail

level="${LEVEL:-feature}"
case "$level" in
  feature) level_line="" ;;
  hotfix) level_line="**Hotfix.**" ;;
  breaking) level_line="**Breaking changes.**" ;;
  security) level_line="**Security release.**" ;;
  *) echo "LEVEL must be feature, hotfix, breaking or security, not $level"; exit 1 ;;
esac

[ "$(git branch --show-current)" = main ] || { echo "release from main only"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree is not clean"; exit 1; }
git fetch -q origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main differs from origin/main"; exit 1; }

month="$(date -u +%Y).$(date -u +%-m)"
last="$(git tag -l "v$month.*" | sed "s/^v$month\.//" | grep -E '^[0-9]+$' | sort -n | tail -1)"
version="$month.$(( ${last:--1} + 1 ))"
tag="v$version"

unreleased="$(awk '/^## \[Unreleased\]/ {on=1; next} on && /^## \[/ {exit} on' CHANGELOG.md)"
[ -n "$(echo "$unreleased" | tr -d '[:space:]')" ] || { echo "CHANGELOG.md Unreleased is empty"; exit 1; }

python3 - "$version" "$level_line" <<'PY'
import datetime, pathlib, sys
version, level_line = sys.argv[1], sys.argv[2]
path = pathlib.Path("CHANGELOG.md")
today = datetime.datetime.now(datetime.UTC).date().isoformat()
text = path.read_text()
section = f"## [{version}] - {today}\n" + (f"\n{level_line}\n" if level_line else "")
path.write_text(text.replace("## [Unreleased]\n", f"## [Unreleased]\n\n{section}", 1))
# The running app reports this version in About and compares it with the latest release.
pathlib.Path("backend/app/version.py").write_text(
    "# Bumped by scripts/release.sh in the release commit; a source build shows the last release.\n"
    f'VERSION = "{version}"\n'
)
PY

if [ "${1:-}" = "--dry-run" ]; then
  git diff
  git checkout -- CHANGELOG.md backend/app/version.py
  echo "dry run: would tag $tag ($level)"
  exit 0
fi

make check
git commit -q -am "chore(release): $tag"
git tag -a "$tag" -m "$tag"
git push origin main "$tag"
echo "pushed $tag; images and the GitHub release: $(git remote get-url origin | sed 's/\.git$//')/actions"
