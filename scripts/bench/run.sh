#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Runs the Dock Glass benchmark in this GNOME session: installs the
# benchmark extension, enables it, waits for its result (about seven
# minutes, without touching the mouse or the keyboard), then disables and
# removes it and prints the table with this machine's hardware. Dock Glass
# must be installed. Usage: sh scripts/bench/run.sh
set -eu

uuid=dock-glass-bench@atarico.github.io
here=$(cd "$(dirname "$0")" && pwd)
dest="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
out="${XDG_CACHE_HOME:-$HOME/.cache}/dock-glass-bench"

mkdir -p "$(dirname "$dest")"
rm -rf "$dest"
cp -r "$here/$uuid" "$dest"

# GNOME Shell only finds a newly installed extension when it starts.
if ! gnome-extensions info "$uuid" > /dev/null 2>&1; then
    echo "GNOME Shell has not loaded the benchmark yet. Restart it (X11: Alt+F2, type r, Enter;"
    echo "Wayland: log out and back in), then run this script again."
    exit 2
fi

rm -f "$out/result.md" "$out/result.json" "$out/error.txt"
echo "Running for about seven minutes. Do not touch the mouse or the keyboard."
gnome-extensions enable "$uuid"
waited=0
while [ ! -f "$out/result.md" ] && [ ! -f "$out/error.txt" ]; do
    sleep 5
    waited=$((waited + 5))
    [ "$waited" -lt 1200 ] || break
done
gnome-extensions disable "$uuid"
rm -rf "$dest"

if [ ! -f "$out/result.md" ]; then
    echo "The benchmark failed: $(cat "$out/error.txt" 2>/dev/null || echo 'no result after 20 minutes')"
    exit 1
fi

{
    echo "CPU: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | sed 's/^ //')"
    if command -v lspci > /dev/null; then
        echo "GPU: $(lspci | grep -iE 'vga|3d|display' | cut -d: -f3- | sed 's/^ //' | paste -sd ';' -)"
    fi
    echo "Session: ${XDG_SESSION_TYPE:-unknown}, $(gnome-shell --version)"
} > "$out/hardware.txt"
echo
cat "$out/result.md"
echo
cat "$out/hardware.txt"
echo "Full result: $out/result.json"
