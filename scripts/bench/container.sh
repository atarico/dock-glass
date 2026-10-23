#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Runs the Dock Glass benchmark in a headless GNOME Shell 46 (Ubuntu 24.04
# with Ubuntu Dock) inside Docker, and prints the result table. Rendering is
# done in software (llvmpipe) and a headless shell paints as fast as it can,
# with no display to pace it: compare CPU per frame, without and with, not
# CPU percent or frames per second, and not against other machines.
# Needs Docker and about 1 GB of disk for the image.
# Usage: sh scripts/bench/container.sh [output directory]
set -eu

cd "$(dirname "$0")/../.."
out=${1:-$(mktemp -d)}
mkdir -p "$out"
docker build -q -t dock-glass-bench scripts/bench/container > /dev/null
docker run --rm -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
    -v "$PWD:/src:ro" -v "$(cd "$out" && pwd):/out" dock-glass-bench
echo "Result and shell log: $out"
