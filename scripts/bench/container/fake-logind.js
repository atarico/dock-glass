// SPDX-License-Identifier: GPL-3.0-or-later
// Owns org.freedesktop.login1 on the system bus, so GNOME Shell can build
// its logind proxies inside a container without systemd.
const {Gio, GLib} = imports.gi;

Gio.bus_own_name(Gio.BusType.SYSTEM, 'org.freedesktop.login1',
    Gio.BusNameOwnerFlags.NONE, null, null, null);
new GLib.MainLoop(null, false).run();
