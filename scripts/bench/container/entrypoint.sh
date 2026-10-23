#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Inside the container: installs Dock Glass from /src and the benchmark,
# pins ten placeholder apps and Files, runs a headless GNOME Shell on one
# 1920x1080 virtual monitor and the benchmark in it, and copies the result
# to /out, owned by HOST_UID:HOST_GID. A headless shell has no display to
# pace its frames and paints as fast as it can, so compare CPU per frame.
set -eu

ext=/root/.local/share/gnome-shell/extensions
apps=/root/.local/share/applications
# Where the benchmark writes (its extension.js and run.sh name the same).
results=/root/.cache/dock-glass-bench
# A result left in /out by an earlier run must not pass for this one.
rm -f /out/result.md /out/result.json /out/error.txt /out/hardware.txt /out/shell.log
mkdir -p "$ext/dock-glass@atarico.github.io" "$apps"
cp /src/*.js /src/metadata.json /src/stylesheet.css "$ext/dock-glass@atarico.github.io/"
cp -r /src/scripts/bench/dock-glass-bench@atarico.github.io "$ext/"

# Placeholder apps that never launch, so the dock looks like a used one.
favorites=""
i=1
for icon in web-browser mail-unread text-editor utilities-terminal accessories-calculator \
    multimedia-player image-viewer x-office-calendar preferences-system help-browser; do
    printf '[Desktop Entry]\nType=Application\nName=App %s\nExec=false\nIcon=%s\n' "$i" "$icon" \
        > "$apps/bench-app-$i.desktop"
    favorites="$favorites'bench-app-$i.desktop', "
    i=$((i + 1))
done
# Files with no window opens the Dock Glass stack; it is never launched.
printf '[Desktop Entry]\nType=Application\nName=Files\nExec=false\nIcon=system-file-manager\n' \
    > "$apps/org.gnome.Nautilus.desktop"

# GNOME Shell needs a system bus with logind.
mkdir -p /run/dbus
dbus-daemon --system --fork
gjs /bench/fake-logind.js &
# It owns its name within a second; ten seconds means it is not coming.
logind=no
for _ in $(seq 20); do
    if dbus-send --system --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus \
        org.freedesktop.DBus.NameHasOwner string:org.freedesktop.login1 2> /dev/null |
        grep -q 'boolean true'; then
        logind=yes
        break
    fi
    sleep 0.5
done
if [ "$logind" = no ]; then
    echo 'The fake logind did not take org.freedesktop.login1 on the system bus' >&2
    exit 1
fi

export XDG_RUNTIME_DIR=/tmp/xdg XDG_SESSION_TYPE=wayland
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# dock-fixed keeps the dock shown: intellihide is not what is measured. The
# benchmark is installed before the shell starts and run with run.sh, the
# same script as in a desktop session.
status=0
dbus-run-session -- sh -c "
    gsettings set org.gnome.shell enabled-extensions \"['ubuntu-dock@ubuntu.com', 'dock-glass@atarico.github.io']\"
    gsettings set org.gnome.shell favorite-apps \"[${favorites}'org.gnome.Nautilus.desktop']\"
    gsettings set org.gnome.desktop.interface enable-animations true
    gsettings set org.gnome.shell.extensions.dash-to-dock dock-fixed true
    gnome-shell --headless --wayland --no-x11 --virtual-monitor 1920x1080 --force-animations > /tmp/shell.log 2>&1 &
    shell=\$!
    loaded=no
    for _ in \$(seq 60); do
        gnome-extensions info dock-glass@atarico.github.io > /dev/null 2>&1 && loaded=yes && break
        sleep 1
    done
    if [ \$loaded = no ]; then
        echo 'GNOME Shell did not start or did not load Dock Glass within a minute; see shell.log'
        exit 1
    fi
    sh /src/scripts/bench/run.sh
    status=\$?
    kill \$shell 2>/dev/null || true
    wait \$shell 2>/dev/null || true
    exit \$status
" || status=$?

grep -E 'DOCK-GLASS-BENCH|JS ERROR|\[dock-glass\]' /tmp/shell.log || true
if [ -f "$results/hardware.txt" ]; then
    echo 'Renderer: llvmpipe (software rendering, no GPU in the container)' >> "$results/hardware.txt"
fi

# Only the files written here change owner, never the rest of /out.
cp /tmp/shell.log /out/shell.log
chown "${HOST_UID:-0}:${HOST_GID:-0}" /out/shell.log
for file in "$results"/*; do
    [ -f "$file" ] || continue
    cp "$file" /out/
    chown "${HOST_UID:-0}:${HOST_GID:-0}" "/out/$(basename "$file")"
done
[ "$status" -eq 0 ] && [ -f /out/result.md ]
