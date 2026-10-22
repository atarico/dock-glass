#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Builds dist/<uuid>.shell-extension.zip, the archive that
# `gnome-extensions install` takes: metadata.json, the stylesheet, the
# license, every module at the repository root and the translations compiled
# from po/ (scripts/build-locale.sh, which needs gettext). Tests, docs and
# tooling stay out. test/package.test.js checks that the root modules'
# relative imports only point to each other, so nothing they need is left
# behind.
set -eu

cd "$(dirname "$0")/.."
uuid=$(node -p "require('./metadata.json').uuid")
out="dist/$uuid.shell-extension.zip"

rm -rf dist
mkdir -p dist/build
sh scripts/build-locale.sh dist/build
# -X leaves out extra file attributes; -D adds no directory entries.
zip -q -X -D "$out" metadata.json stylesheet.css LICENSE ./*.js
(cd dist/build && zip -q -X -D -r "../$uuid.shell-extension.zip" locale)
rm -rf dist/build
echo "$out"
