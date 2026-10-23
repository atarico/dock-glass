#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Compiles every po/<lang>.po into <dir>/locale/<lang>/LC_MESSAGES/<domain>.mo,
# where GNOME Shell looks for an extension's translations; <domain> is the
# gettext-domain in metadata.json. <dir> defaults to the repository root, so
# a development install linked to the repository is translated too.
# Needs msgfmt, from the gettext package.
set -eu

cd "$(dirname "$0")/.."
dir=${1:-.}
command -v msgfmt >/dev/null || { echo "msgfmt not found: install gettext" >&2; exit 1; }
domain=$(node -p "require('./metadata.json')['gettext-domain']")

for po in po/*.po; do
    lang=$(basename "$po" .po)
    mkdir -p "$dir/locale/$lang/LC_MESSAGES"
    msgfmt --check -o "$dir/locale/$lang/LC_MESSAGES/$domain.mo" "$po"
done
