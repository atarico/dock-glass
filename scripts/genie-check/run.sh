#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Checks the genie in a headless GNOME Shell inside Docker, with real GTK
# windows: where it ends on open, minimize and restore, interruptions, the
# overview, Dock Glass or Magic Lamp turned on and off mid-genie, the window
# cycler's skipped effect, and that every minimize and restore reaches the
# window manager exactly once. Prints the DGPROBE lines and exits non-zero
# when a check fails. Takes about seven minutes.
# Needs Docker and about 1.5 GB of disk for each image.
# Usage: sh scripts/genie-check/run.sh [46|51]
#   46 (default): Ubuntu 24.04, GNOME Shell 46, Ubuntu Dock
#   51: Ubuntu 26.10, GNOME Shell 51, Ubuntu Dock
set -eu

version=${1:-46}
case $version in
    46) base=ubuntu:24.04 dock=gnome-shell-extension-ubuntu-dock ;;
    51) base=ubuntu:26.10 dock=gnome-shell-ubuntu-extensions ;;
    *) echo "Unknown GNOME Shell version: $version (use 46 or 51)" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/../.."
image=dock-glass-genie-check:$version
docker build -q -t "$image" --build-arg BASE="$base" --build-arg DOCK="$dock" \
    scripts/genie-check/container > /dev/null
out=$(mktemp -d)
docker run --rm -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
    -v "$PWD:/src:ro" -v "$out:/out" "$image" | tee "$out/result.txt"
echo "Shell log: $out/shell.log"
grep -q 'DGPROBE DONE ALL PASS' "$out/result.txt"
