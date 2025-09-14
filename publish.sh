#!/usr/bin/env bash
set -euo pipefail

# Title: Repository Deployment
# Author: gimpey <gimpey@gimpey.com>
# GitHub: https://github.com/gimpey-com
# Description: Deploys the repository to the package registry.

BUMP="${1:-}"
OTP_ARG="${2:-}"

if [[ -z "${BUMP}" || ! "${BUMP}" =~ ^--(patch|minor|major)$ ]]; then
    echo "Usage: $0 --patch|--minor|--major [--otp 123456]"
    exit 1
fi

# Performing the following safety checks.
git diff --quiet || { echo "Uncommitted changes. Commit or stash first."; exit 1; }
git fetch -q
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "${CURRENT_BRANCH}" == "main" ]] || {
  echo "✗ Not on main (on ${CURRENT_BRANCH})."; exit 1; }

npm whoami >/dev/null

# Bump the version based on the flag.
npm version "${BUMP#--}" -m "chore(release): %s"

# Build the package.
yarn clean
yarn build

# Preview the tarball contents.
npm pack dist --dry-run

if [[ -n "${OTP_ARG}" ]]; then
  npm publish dist --access public ${OTP_ARG}
else
  npm publish dist --access public
fi

git push --follow-tags
echo "Release complete."