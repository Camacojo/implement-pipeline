#!/usr/bin/env bash
# Release the implement pipeline: tools/release.sh <version>
#
# Moves the "Unreleased" section of CHANGELOG.md to the new version, sets the
# version in both plugin manifests, commits, tags v<version>, pushes main and
# the tag, and creates a GitHub release with the changelog section as notes.
# Plugin users only receive changes when the manifest version string changes,
# so this is the step that ships a change to them.
set -euo pipefail

cd "$(dirname "$0")/.."
version="${1:-}"
manifests=(.claude-plugin/plugin.json .claude-plugin/marketplace.json)

die() { echo "release: $*" >&2; exit 1; }

[[ -n "$version" ]] || die "usage: tools/release.sh <version>   (e.g. 1.2.0)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must look like 1.2.0"
command -v gh >/dev/null || die "the GitHub CLI (gh) is required"
[[ "$(git branch --show-current)" == "main" ]] || die "switch to main first"
[[ -z "$(git status --porcelain)" ]] || die "commit or stash your changes first"
git fetch -q origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || die "main is not in sync with origin/main"

current="$(sed -n 's/^[[:space:]]*"version": "\([^"]*\)".*/\1/p' .claude-plugin/plugin.json | head -1)"
[[ -n "$current" ]] || die "no version found in plugin.json"
[[ "$version" != "$current" ]] || die "version $version is already the current version"
[[ "$(printf '%s\n%s\n' "$current" "$version" | sort -V | tail -1)" == "$version" ]] \
  || die "version $version is lower than the current $current; plugin users must never see a lower version"
! git rev-parse -q --verify "refs/tags/v$version" >/dev/null || die "tag v$version already exists"

# The Unreleased section becomes the release notes.
notes="$(awk '/^## \[Unreleased\]/{f=1; next} /^## \[/{f=0} f' CHANGELOG.md | sed -e '1{/^$/d;}' -e '${/^$/d;}')"
[[ -n "$(echo "$notes" | grep -v '^[[:space:]]*$' || true)" ]] || die "the Unreleased section of CHANGELOG.md is empty"

today="$(date +%Y-%m-%d)"
tmp="$(mktemp)"
awk -v v="$version" -v d="$today" -v cur="$current" '
  /^## \[Unreleased\]/ { print; print ""; print "## [" v "] - " d; next }
  /^\[Unreleased\]: / { print "[Unreleased]: https://github.com/Camacojo/implement-pipeline/compare/v" v "...HEAD"
                        print "[" v "]: https://github.com/Camacojo/implement-pipeline/compare/v" cur "...v" v; next }
  { print }
' CHANGELOG.md > "$tmp" && mv "$tmp" CHANGELOG.md

for m in "${manifests[@]}"; do
  sed -i '' "s/\"version\": \"$current\"/\"version\": \"$version\"/g" "$m"
  grep -q "\"version\": \"$version\"" "$m" || die "could not set the version in $m"
done

git add CHANGELOG.md "${manifests[@]}"
git commit -q -m "Release $version"
git tag -a "v$version" -m "implement-pipeline $version"
git push -q origin main "v$version"
gh release create "v$version" --title "$version" --notes "$notes"
echo "released $version"
