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
results=/root/.cache/dock-glass-bench
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
sleep 1

export XDG_RUNTIME_DIR=/tmp/xdg XDG_SESSION_TYPE=wayland
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# dock-fixed keeps the dock shown: intellihide is not what is measured. The
# benchmark is installed before the shell starts and run with run.sh, the
# same script as in a desktop session.
dbus-run-session -- sh -c "
    gsettings set org.gnome.shell enabled-extensions \"['ubuntu-dock@ubuntu.com', 'dock-glass@atarico.github.io']\"
    gsettings set org.gnome.shell favorite-apps \"[${favorites}'org.gnome.Nautilus.desktop']\"
    gsettings set org.gnome.desktop.interface enable-animations true
    gsettings set org.gnome.shell.extensions.dash-to-dock dock-fixed true
    gnome-shell --headless --wayland --no-x11 --virtual-monitor 1920x1080 --force-animations > /tmp/shell.log 2>&1 &
    shell=\$!
    for _ in \$(seq 60); do
        gnome-extensions info dock-glass@atarico.github.io > /dev/null 2>&1 && break
        sleep 1
    done
    sh /src/scripts/bench/run.sh
    status=\$?
    kill \$shell 2>/dev/null || true
    wait \$shell 2>/dev/null || true
    exit \$status
" || true

grep -E 'DOCK-GLASS-BENCH|JS ERROR|\[dock-glass\]' /tmp/shell.log || true
cp /tmp/shell.log /out/shell.log
cp "$results"/* /out/ 2>/dev/null || true
chown -R "${HOST_UID:-0}:${HOST_GID:-0}" /out
[ -f /out/result.md ]
