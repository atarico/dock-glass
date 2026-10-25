// SPDX-License-Identifier: GPL-3.0-or-later
// The probe app: one plain GTK window for each activation. With --x11 it is
// a separate app (its own id), run as an X11 client.
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

const x11 = System.programArgs.includes('--x11');
const app = new Gtk.Application({application_id: x11 ? 'org.dockglass.ProbeX11' : 'org.dockglass.Probe'});
app.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({application: app, title: 'Probe', default_width: 900, default_height: 600});
    window.set_child(new Gtk.Label({label: 'Dock Glass probe'}));
    window.present();
});
app.run([]);
