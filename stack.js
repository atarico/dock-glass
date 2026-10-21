// SPDX-License-Identifier: GPL-3.0-or-later
// macOS-like stacks: a fan or a grid of places that springs out of a dock
// icon. The layout math lives in stackLayout.js; this file builds the
// actors, runs the animations and handles input while a stack is open.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {chooseView, fanSlots, gridLayout, staggerDelay} from './stackLayout.js';

// Fan: 48px icons one step apart, bending right gently (about 70px over a
// full ten-item fan), like the macOS Dock.
const FAN_ICON_SIZE = 48;
const FAN_STEP = 58;
const FAN_BEND = 0.00025;
// Grid: up to five columns of 96px cells, four rows visible, then scroll.
// Each cell button adds the .dock-glass-stack-cell padding (stylesheet.css)
// around its 96px content.
const GRID_ICON_SIZE = 56;
const GRID_CELL = 96;
const GRID_CELL_PADDING = 4;
const GRID_COLUMNS = 5;
const GRID_MAX_ROWS = 4;
const GRID_GAP = 10;

// Undocking (open): items spring out of the dock icon one after another,
// nearest first, and each label fades in once its icon has landed.
// Docking (close), the same in reverse: labels fade out first so no text
// ever overlaps, then the items fly back into the icon one after another,
// farthest first, shrinking onto the pile and fading only as they arrive.
const OPEN_MS = 260;
const OPEN_STAGGER_MS = 140;
const LABEL_FADE_MS = 100;
const CLOSE_MS = 230;
const CLOSE_STAGGER_MS = 90;
// Share of the close motion after which an item starts fading into the icon.
const CLOSE_FADE_AT = 0.55;

function openUri(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) {
        console.error(`[dock-glass] Cannot open ${uri}: ${e}`);
    }
}

// Places like the Files sidebar: home, the usual folders, then bookmarks.
export function listPlaces(homeLabel) {
    const home = GLib.get_home_dir();
    const places = [{
        name: homeLabel,
        gicon: new Gio.ThemedIcon({name: 'user-home'}),
        uri: Gio.File.new_for_path(home).get_uri(),
    }];
    const special = [
        [GLib.UserDirectory.DIRECTORY_DESKTOP, 'user-desktop'],
        [GLib.UserDirectory.DIRECTORY_DOCUMENTS, 'folder-documents'],
        [GLib.UserDirectory.DIRECTORY_DOWNLOAD, 'folder-download'],
        [GLib.UserDirectory.DIRECTORY_PICTURES, 'folder-pictures'],
    ];
    for (const [directory, iconName] of special) {
        const path = GLib.get_user_special_dir(directory);
        if (path && path !== home) {
            places.push({
                name: GLib.path_get_basename(path),
                gicon: new Gio.ThemedIcon({name: iconName}),
                uri: Gio.File.new_for_path(path).get_uri(),
            });
        }
    }

    // GTK bookmarks: one "uri [label]" per line, as Files writes them.
    const bookmarks = GLib.build_filenamev([GLib.get_user_config_dir(), 'gtk-3.0', 'bookmarks']);
    let text = '';
    try {
        text = new TextDecoder().decode(GLib.file_get_contents(bookmarks)[1]);
    } catch {
        // No bookmarks file: only the standard places.
    }
    for (const line of text.split('\n')) {
        const [uri, ...label] = line.trim().split(' ');
        if (!uri || places.some(place => place.uri === uri))
            continue;
        const file = Gio.File.new_for_uri(uri);
        places.push({
            name: label.join(' ') || file.get_basename() || uri,
            gicon: new Gio.ThemedIcon({name: file.is_native() ? 'folder' : 'folder-remote'}),
            uri,
        });
    }
    return places;
}

// One open stack. `items` is a function returning an array or a promise of
// {name, gicon, uri}, called only once the stack is open; `openLabel` and
// `onOpenFolder` are the "open in Files" entry on top.
export class Stack {
    constructor({anchor, title, openLabel, onOpenFolder, items, onClosed}) {
        this._anchor = anchor;
        this._title = title;
        this._openLabel = openLabel;
        this._onOpenFolder = onOpenFolder;
        this._items = items;
        this._onClosed = onClosed;
        this._root = null;
        this._grab = null;
        this._closing = false;
        this._parts = [];
    }

    // Opens the stack over the whole stage; returns false if no grab.
    open() {
        const [x, y] = this._anchor.get_transformed_position();
        const [width] = this._anchor.get_transformed_size();
        this._origin = {x: x + width / 2, y};
        this._monitor = Main.layoutManager.findMonitorForActor(this._anchor) ??
            Main.layoutManager.primaryMonitor;

        // A transparent catcher over everything: a click outside the stack,
        // including on the dock icon again, lands on it and closes the stack.
        this._root = new St.Widget({
            reactive: true,
            x: 0,
            y: 0,
            width: global.stage.width,
            height: global.stage.height,
        });
        Main.layoutManager.uiGroup.add_child(this._root);
        this._grab = Main.pushModal(this._root, {actionMode: Shell.ActionMode.POPUP});
        if (!(this._grab.get_seat_state() & Clutter.GrabState.POINTER)) {
            Main.popModal(this._grab);
            this._grab = null;
            this._root.destroy();
            return false;
        }

        this._root.connect('button-press-event', (_root, event) => {
            if (global.stage.get_event_actor(event) === this._root)
                this.close();
            return Clutter.EVENT_STOP;
        });
        this._root.connect('key-press-event', (_root, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        Promise.resolve().then(() => this._items()).then(items => {
            if (!this._closing)
                this._show(items);
        }).catch(e => {
            console.error(`[dock-glass] Cannot load stack: ${e}`);
            if (!this._closing)
                this._show([]);
        });
        return true;
    }

    close() {
        if (this._closing)
            return;
        this._closing = true;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        // Let clicks through while the stack retracts.
        const root = this._root;
        root.reactive = false;
        this._notifyClosed();
        const count = this._parts.length;
        let pending = count;
        if (!pending) {
            root.destroy();
            return;
        }
        this._parts.forEach(({actor, hidden, label}, i) => {
            const {opacity, ...motion} = hidden;
            actor.remove_all_transitions();
            label?.remove_all_transitions();
            label?.ease({opacity: 0, duration: LABEL_FADE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});

            // Farthest first, after the labels are gone.
            const delay = (label ? LABEL_FADE_MS : 0) +
                staggerDelay(count - 1 - i, count, CLOSE_STAGGER_MS);
            actor.ease({
                opacity,
                duration: CLOSE_MS * (1 - CLOSE_FADE_AT),
                delay: delay + CLOSE_MS * CLOSE_FADE_AT,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
            });
            actor.ease({
                ...motion,
                duration: CLOSE_MS,
                delay,
                mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
                onStopped: () => {
                    if (--pending === 0)
                        root.destroy();
                },
            });
        });
    }

    // Closes at once, without animation (used when the dock goes away). The
    // catcher goes first, so a failing callback can never leave it on screen.
    destroy() {
        const wasOpen = !this._closing;
        this._closing = true;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._root?.destroy();
        this._root = null;
        if (wasOpen)
            this._notifyClosed();
    }

    _notifyClosed() {
        try {
            this._onClosed?.();
        } catch (e) {
            console.error(`[dock-glass] Stack close callback failed: ${e}`);
        }
    }

    _show(items) {
        if (chooseView(items.length) === 'fan')
            this._showFan(items);
        else
            this._showGrid(items);
    }

    _launch(action) {
        this.close();
        action();
    }

    _showFan(items) {
        // The open entry tops the fan, as on macOS.
        const entries = [
            ...items.map(item => ({...item, action: () => openUri(item.uri)})),
            {
                name: this._openLabel,
                gicon: new Gio.ThemedIcon({name: 'folder-open'}),
                action: this._onOpenFolder,
            },
        ];
        const slots = fanSlots({count: entries.length, step: FAN_STEP, bend: FAN_BEND});

        entries.forEach((entry, i) => {
            const box = new St.BoxLayout({style_class: 'dock-glass-stack-fan-box'});
            const label = new St.Label({
                text: entry.name,
                style_class: 'dock-glass-stack-label',
                y_align: Clutter.ActorAlign.CENTER,
            });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            box.add_child(label);
            box.add_child(new St.Icon({gicon: entry.gicon, icon_size: FAN_ICON_SIZE}));
            const actor = new St.Button({
                style_class: 'dock-glass-stack-fan-item',
                child: box,
                reactive: true,
                track_hover: true,
            });
            actor.connect('clicked', () => this._launch(entry.action));
            this._root.add_child(actor);

            // The icon, on the right of its label, sits on the slot.
            const [, width] = actor.get_preferred_width(-1);
            const [, height] = actor.get_preferred_height(-1);
            const iconX = this._origin.x + slots[i].x;
            const iconY = this._origin.y + slots[i].y;
            actor.set_position(Math.round(iconX + FAN_ICON_SIZE / 2 - width),
                Math.round(iconY - height / 2));
            actor.set_pivot_point((width - FAN_ICON_SIZE / 2) / width, 0.5);

            // Each item springs out of the dock icon, nearest ones first.
            const hidden = {
                translation_x: this._origin.x - iconX,
                translation_y: this._origin.y - iconY,
                scale_x: 0.3,
                scale_y: 0.3,
                opacity: 0,
            };
            actor.set(hidden);
            label.opacity = 0;
            const delay = staggerDelay(i, entries.length, OPEN_STAGGER_MS);
            // Opacity gets its own non-overshooting ease: Clutter stores it in
            // 8 bits, so EASE_OUT_BACK's overshoot past 255 would wrap it to
            // almost transparent mid-spring.
            actor.ease({opacity: 255, duration: OPEN_MS / 2, delay, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            actor.ease({
                translation_x: 0,
                translation_y: 0,
                scale_x: 1,
                scale_y: 1,
                duration: OPEN_MS,
                delay,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            });
            label.ease({
                opacity: 255,
                duration: LABEL_FADE_MS,
                delay: delay + OPEN_MS * 0.7,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            this._parts.push({actor, hidden, label});
        });
    }

    _showGrid(items) {
        const layout = gridLayout({
            count: items.length,
            columns: GRID_COLUMNS,
            cell: GRID_CELL + 2 * GRID_CELL_PADDING,
            padding: 0,
            maxRows: GRID_MAX_ROWS,
        });

        // Reactive, so a click on the panel's own background does not reach
        // the catcher behind it and close the stack.
        const panel = new St.BoxLayout({
            vertical: true,
            reactive: true,
            style_class: 'dock-glass-stack-grid',
        });
        const header = new St.BoxLayout({style_class: 'dock-glass-stack-header'});
        header.add_child(new St.Label({
            text: this._title,
            style_class: 'dock-glass-stack-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const open = new St.Button({label: this._openLabel, style_class: 'dock-glass-stack-open'});
        open.connect('clicked', () => this._launch(this._onOpenFolder));
        header.add_child(open);
        panel.add_child(header);

        const rows = new St.BoxLayout({vertical: true});
        for (let row = 0; row < layout.rows; row++) {
            const line = new St.BoxLayout();
            for (const item of items.slice(row * layout.columns, (row + 1) * layout.columns)) {
                const cell = new St.BoxLayout({vertical: true, width: GRID_CELL, height: GRID_CELL});
                cell.add_child(new St.Icon({
                    gicon: item.gicon,
                    icon_size: GRID_ICON_SIZE,
                    x_align: Clutter.ActorAlign.CENTER,
                }));
                const label = new St.Label({text: item.name, style_class: 'dock-glass-stack-cell-label'});
                label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                cell.add_child(label);
                const button = new St.Button({style_class: 'dock-glass-stack-cell', child: cell});
                button.connect('clicked', () => this._launch(() => openUri(item.uri)));
                line.add_child(button);
            }
            rows.add_child(line);
        }
        const scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: layout.scrolls ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER,
            width: layout.width + (layout.scrolls ? 12 : 0),
            height: layout.height,
        });
        scroll.set_child(rows);
        panel.add_child(scroll);
        this._root.add_child(panel);

        // Centered on the dock icon, kept on its monitor, just above the icon.
        const [, width] = panel.get_preferred_width(-1);
        const [, height] = panel.get_preferred_height(width);
        const monitor = this._monitor;
        const x = Math.max(monitor.x + GRID_GAP, Math.min(this._origin.x - width / 2,
            monitor.x + monitor.width - width - GRID_GAP));
        const y = Math.max(monitor.y + GRID_GAP, this._origin.y - height - GRID_GAP);
        panel.set_position(Math.round(x), Math.round(y));
        panel.set_size(width, height);

        // The panel grows out of the dock icon.
        panel.set_pivot_point((this._origin.x - x) / width, 1);
        const hidden = {scale_x: 0.1, scale_y: 0.1, opacity: 0};
        panel.set(hidden);
        panel.ease({
            scale_x: 1,
            scale_y: 1,
            opacity: 255,
            duration: OPEN_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._parts.push({actor: panel, hidden});
    }
}
