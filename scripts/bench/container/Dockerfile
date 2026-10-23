# SPDX-License-Identifier: GPL-3.0-or-later
# Headless GNOME Shell 46 with Ubuntu Dock, for scripts/bench/container.sh.
FROM ubuntu:24.04
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        gnome-shell gnome-shell-extension-ubuntu-dock gjs gir1.2-gtk-4.0 \
        dbus dbus-user-session libglib2.0-bin \
    && rm -rf /var/lib/apt/lists/*
COPY entrypoint.sh fake-logind.js /bench/
ENTRYPOINT ["sh", "/bench/entrypoint.sh"]
