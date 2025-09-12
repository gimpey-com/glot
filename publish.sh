#!/bin/bash

# Title: Repository Deployment
# Author: gimpey <gimpey@gimpey.com>
# GitHub: https://github.com/gimpey-com
# Description: Deploys the repository to the package registry.

if [ -z "$1" ]; then
    echo "Error: No version bump flag provided. Use --major, --minor, or --patch."
    exit 1
fi

# cleaning the package
yarn clean

# bump the version based on the flag
yarn bump-version "$1"

# building the package
yarn tsc -p tsconfig.publish.json

# publish the package
npm publish --access restricted

# pushing the changes to the repository
git commit -am "chore(release): updating package version"
git push