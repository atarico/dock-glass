# SPDX-License-Identifier: GPL-3.0-or-later
# A headless GNOME Shell with a dock, Xwayland and GTK 4 for the probe app
# (as a Wayland and as an X11 client), and Magic Lamp (pinned) for the
# checks that Dock Glass leaves minimize and restore to it.
ARG BASE=ubuntu:24.04
FROM ${BASE}
ARG DOCK=gnome-shell-extension-ubuntu-dock
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        gnome-shell ${DOCK} gjs gir1.2-gtk-4.0 xwayland \
        dbus dbus-user-session libglib2.0-bin ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
ARG MAGIC_LAMP=69f0a5a17b554c9ce0119dace7044b9d6917c399
RUN mkdir /magic-lamp \
    && curl -fsSL "https://codeload.github.com/hermes83/compiz-alike-magic-lamp-effect/tar.gz/${MAGIC_LAMP}" \
        | tar -xz -C /magic-lamp --strip-components=1 \
    && glib-compile-schemas /magic-lamp/schemas
COPY entrypoint.sh fake-logind.js /check/
ENTRYPOINT ["sh", "/check/entrypoint.sh"]
