#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Inside the container: installs Dock Glass from /src, the probe extension
# and Magic Lamp (left disabled; the probe turns it on and off), pins the
# probe app, runs a headless GNOME Shell on one 1920x1080 virtual monitor
# until the probe is done, prints its DGPROBE lines and any JS errors, and
# copies the shell log to /out, owned by HOST_UID:HOST_GID.
set -eu

ext=/root/.local/share/gnome-shell/extensions
apps=/root/.local/share/applications
check=/src/scripts/genie-check
mkdir -p "$ext/dock-glass@atarico.github.io" "$apps"
cp /src/*.js /src/metadata.json /src/stylesheet.css "$ext/dock-glass@atarico.github.io/"
cp -r "$check/probe@dock-glass.test" "$ext/"
cp -r /magic-lamp "$ext/compiz-alike-magic-lamp-effect@hermes83.github.com"

# The probe app, as a Wayland and as an X11 client, between placeholder apps
# that never launch.
printf '[Desktop Entry]\nType=Application\nName=Probe\nExec=env GSK_RENDERER=cairo gjs -m %s/app.js\nIcon=utilities-terminal\n' \
    "$check" > "$apps/org.dockglass.Probe.desktop"
printf '[Desktop Entry]\nType=Application\nName=Probe X11\nExec=env GDK_BACKEND=x11 GSK_RENDERER=cairo gjs -m %s/app.js --x11\nIcon=utilities-terminal\n' \
    "$check" > "$apps/org.dockglass.ProbeX11.desktop"
for i in 1 2 3; do
    printf '[Desktop Entry]\nType=Application\nName=App %s\nExec=false\nIcon=web-browser\n' "$i" \
        > "$apps/placeholder-$i.desktop"
done

# GNOME Shell needs a system bus with logind.
mkdir -p /run/dbus
dbus-daemon --system --fork
gjs /check/fake-logind.js &
sleep 2

# Xwayland needs a world-writable socket directory; GNOME Shell 46 starts it
# with the shell and stops there without one.
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix

export XDG_RUNTIME_DIR=/tmp/xdg XDG_SESSION_TYPE=wayland
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# dock-fixed keeps the dock shown: intellihide would hide it under windows.
# The probe runs about three minutes; ten is the limit. A shell that exits
# before the probe is done ends the wait at once.
dbus-run-session -- sh -c "
    gsettings set org.gnome.shell enabled-extensions \"['ubuntu-dock@ubuntu.com', 'dock-glass@atarico.github.io', 'probe@dock-glass.test']\"
    gsettings set org.gnome.shell favorite-apps \"['placeholder-1.desktop', 'org.dockglass.Probe.desktop', 'org.dockglass.ProbeX11.desktop', 'placeholder-2.desktop', 'placeholder-3.desktop']\"
    gsettings set org.gnome.desktop.interface enable-animations true
    gsettings set org.gnome.shell.extensions.dash-to-dock dock-fixed true
    gsettings set org.gnome.shell.extensions.dash-to-dock dock-position BOTTOM
    gnome-shell --headless --wayland --virtual-monitor 1920x1080 --force-animations > /tmp/shell.log 2>&1 &
    shell=\$!
    for _ in \$(seq 600); do
        grep -q 'DGPROBE DONE\|DGPROBE CRASH' /tmp/shell.log && break
        if ! kill -0 \$shell 2> /dev/null; then
            echo 'gnome-shell exited before the probe was done'
            break
        fi
        sleep 1
    done
    kill \$shell 2> /dev/null || true
    wait \$shell 2> /dev/null || true
" || true

cp /tmp/shell.log /out/shell.log
chown "${HOST_UID:-0}:${HOST_GID:-0}" /out/shell.log
grep -E 'DGPROBE|JS ERROR|\[dock-glass\]|accounting' /tmp/shell.log | sed 's/^.*DGPROBE /DGPROBE /' || true
