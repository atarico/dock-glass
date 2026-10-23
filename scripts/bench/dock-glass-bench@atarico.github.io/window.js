// SPDX-License-Identifier: GPL-3.0-or-later
// One plain 640x400 window for the benchmark's open-and-close scenario: it
// shows, stays for the given milliseconds (1500 by default) and quits, the
// same on every machine. Run with: gjs -m window.js [milliseconds]
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

let Gtk;
try {
    Gtk = (await import('gi://Gtk?version=4.0')).default;
} catch {
    Gtk = (await import('gi://Gtk?version=3.0')).default;
}

const holdMs = Number(System.programArgs[0]) || 1500;
const app = new Gtk.Application({
    application_id: 'io.github.atarico.DockGlassBench',
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});
app.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({
        application: app,
        title: 'Dock Glass benchmark',
        default_width: 640,
        default_height: 400,
    });
    window.present();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, holdMs, () => {
        window.close();
        return GLib.SOURCE_REMOVE;
    });
});
System.exit(app.run([System.programInvocationName]));
