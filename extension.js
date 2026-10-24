// SPDX-License-Identifier: GPL-3.0-or-later
// Dock Glass: continuous macOS-like magnification and a launch bounce for
// the icons of Ubuntu Dock or Dash to Dock, a macOS-like places stack
// (stack.js) for Files, and a genie effect from the dock icon when a window
// opens, minimizes or is restored (genieAnimation.js). The dock's private
// internals are reached only through dockAdapter.js. The pill shape lives in
// stylesheet.css.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    DOCK_UUIDS, connectDockManager, getDockManager, getDocks, importDock, isDockExtension,
    keepFocusInSync,
} from './dockAdapter.js';
import {approach, magnify} from './magnifier.js';
import {GenieAnimation} from './genieAnimation.js';
import {Stack, listPlaces} from './stack.js';

// Stacks. Files opens its places stack only while it has no windows, so a
// click still focuses or minimizes its windows otherwise. When Files is the
// last pinned app, the separator moves to its left, grouping it with the
// Trash on the right side like the folders of the macOS Dock.
const FILES_APP_ID = 'org.gnome.Nautilus.desktop';

// Continuous macOS-like magnification (the math lives in magnifier.js).
// Icons grow from their bottom edge, neighbors spread apart to make room and
// the pill widens with them, like the macOS Dock. The peak is the
// enlargement under the pointer, the equivalent of the macOS Magnification
// slider. Apple publishes no falloff curve; a cosine bell that reaches the
// rest size three icon slots away matches common recreations of the Dock.
// Ubuntu Dock clips its content to the pill at rest. stylesheet.css raises
// the tile top padding to 24px (with a matching background margin, so the
// pill keeps its size), leaving 30px above each 48px icon image (6px icon
// padding + 24px); growing from the 60px tile bottom, the image top rises
// 54px * 0.4. Sideways, the clip is widened by CLIP_MARGIN_PX on each side:
// the pill's ends move out by at most 0.4 * 3 slots / 2 (about 38px).
const MAGNIFY_PEAK = 1.4;
const MAGNIFY_RADIUS_SLOTS = 3;
const CLIP_MARGIN_PX = 64;
// Time constants of the per-frame exponential smoothing: the pointer
// position lags slightly so fast sweeps stay fluid, and the whole
// magnification fades in when the pointer enters and out when it leaves.
const POINTER_SMOOTHING_MS = 40;
const STRENGTH_SMOOTHING_MS = 80;

// The bounce animates a clone in the top-level UI group, so the dock
// clip does not apply to it and it can jump higher than the zoom.
const BOUNCE_HEIGHT_PX = 22;
const BOUNCE_HALF_DURATION_MS = 260;
const BOUNCE_TIMEOUT_S = 10;

// After a launch from a stack, the dock stays shown until the new window has
// poured out of the stack's icon, and at most this long when no window opens.
const LAUNCH_HOLD_MAX_MS = 3000;

// An actor's rect in stage coordinates, or null without one.
function stageRect(actor) {
    if (!actor)
        return null;
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    return [x, y, width, height].every(Number.isFinite) ? {x, y, width, height} : null;
}

export default class DockGlassExtension extends Extension {
    enable() {
        this._enabled = true;
        this._retryId = 0;
        this._dockModules = new Map();
        this._manager = null;
        this._disconnectManager = null;
        this._boxes = new Map();
        this._buttons = new Map();
        this._bounces = new Map();
        this._magnifiers = new Map();
        this._clips = new Map();
        this._separatorLaters = new Map();
        this._separatorMoved = new Map();
        this._stack = null;
        this._launchHold = null;

        Main.extensionManager.connectObject('extension-state-changed',
            (_manager, extension) => {
                if (isDockExtension(extension))
                    this._loadDock(extension.uuid);
            }, this);
        DOCK_UUIDS.forEach(uuid => this._loadDock(uuid));

        this._genieAnimation = new GenieAnimation(window => this._findDockIcon(window));
        this._genieAnimation.enable();
    }

    disable() {
        this._genieAnimation.disable();
        this._genieAnimation = null;

        this._enabled = false;
        if (this._retryId)
            GLib.source_remove(this._retryId);
        this._retryId = 0;
        Main.extensionManager.disconnectObject(this);
        this._detachManager();
        this._dockModules = null;
    }

    // Imports a dock's live module the first time that dock is seen (one
    // installed later is seen on its first state change), then follows the
    // dock manager that runs.
    async _loadDock(uuid) {
        if (!this._dockModules.has(uuid)) {
            let module;
            try {
                module = await importDock(Main.extensionManager, uuid);
            } catch (e) {
                console.error(`[dock-glass] Cannot load ${uuid}: ${e}`);
                return;
            }

            if (!module || !this._enabled)
                return;
            this._dockModules.set(uuid, module);
        }
        this._attachManager();

        // GNOME enables user extensions before system ones and re-enables them
        // without extension-state-changed, and a dock that takes over from the
        // other may start after this runs: retry once if no dock is up yet.
        if (!this._manager && !this._retryId) {
            this._retryId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._retryId = 0;
                this._attachManager();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _attachManager() {
        const manager = getDockManager(this._dockModules);
        if (manager !== this._manager) {
            this._detachManager();
            this._manager = manager;
            if (manager) {
                this._disconnectManager = connectDockManager(manager, () => {
                    // Dash to Dock replaces its docks without docks-destroyed,
                    // so what was attached may be gone: start over.
                    this._detachDocks();
                    this._attachDocks();
                }, () => this._detachDocks());
            }
        }
        this._attachDocks();
    }

    _detachManager() {
        this._detachDocks();
        this._disconnectManager?.();
        this._disconnectManager = null;
        this._manager = null;
    }

    _attachDocks() {
        for (const dock of getDocks(this._manager)) {
            const box = dock.itemBox;
            if (!box || this._boxes.has(box))
                continue;

            this._boxes.set(box, dock);
            box.connectObject(
                'child-added', (_box, item) => {
                    this._trackButton(item.child, dock);
                    if (item === dock.separator)
                        this._queueSeparatorMove(dock);
                    this._wakeMagnifier(dock);
                },
                'child-removed', () => this._wakeMagnifier(dock),
                'destroy', () => {
                    this._boxes.delete(box);
                    this._stopMagnifier(dock);
                },
                this);
            // Pointer motion over the dock starts or restarts the magnifier,
            // and leaving it lets the magnifier notice and fade out. Clutter
            // only routes events through reactive actors, so this listens on
            // the dock's frame (reactive, hover-tracked, covering the whole
            // dock) rather than the non-reactive dock container.
            dock.frame?.connectObject(
                'motion-event', () => {
                    this._wakeMagnifier(dock);
                    return Clutter.EVENT_PROPAGATE;
                },
                'notify::hover', () => this._wakeMagnifier(dock),
                this);
            for (const item of box.get_children())
                this._trackButton(item.child, dock);

            this._trackButton(dock.showAppsButton, dock, dock.showAppsIcon);

            // Only bottom (horizontal) docks magnify; leave the others as is.
            if (!dock.isHorizontal)
                continue;

            // Spread icons reach past the scroll view, which clips to its
            // allocation by default; the pill scales around its center.
            const scroller = dock.scroller;
            this._clipToView = scroller?.clip_to_view ?? true;
            if (scroller)
                scroller.clip_to_view = false;
            dock.background?.set_pivot_point(0.5, 0.5);

            // The slide container clips the dock (glass included) to the pill
            // at rest on every allocation; widen that clip sideways each time.
            dock.frame?.connectObject('notify::clip-rect', () => this._widenClip(dock), this);
            this._widenClip(dock);
            this._queueSeparatorMove(dock);
        }
    }

    // Ubuntu Dock re-inserts the separator after the pinned apps on every
    // redisplay; move it once that is done, before the frame is drawn, so it
    // never visibly jumps. The separator is not an app item, so moving it
    // does not disturb how the dock diffs its app list.
    _queueSeparatorMove(dock) {
        if (this._separatorLaters.has(dock))
            return;
        const laters = global.compositor.get_laters();
        this._separatorLaters.set(dock, laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._separatorLaters.delete(dock);
            this._moveSeparatorBeforeFiles(dock);
            return GLib.SOURCE_REMOVE;
        }));
    }

    _moveSeparatorBeforeFiles(dock) {
        const box = dock.itemBox;
        const separator = dock.separator;
        if (!this._boxes.has(box) || !separator || separator.get_parent() !== box)
            return;

        const children = box.get_children();
        const index = children.indexOf(separator);
        const previous = children[index - 1];
        // Not when Files is the only pinned app: a leading separator.
        const move = index > 1 && previous.child?.app?.get_id() === FILES_APP_ID;
        if (move)
            box.set_child_below_sibling(separator, previous);
        this._separatorMoved.set(dock, move);
    }

    // The exact inverse, only if the last redisplay's separator was moved.
    _restoreSeparator(dock) {
        const box = dock.itemBox;
        const separator = dock.separator;
        const next = separator?.get_next_sibling();
        if (this._separatorMoved.get(dock) && separator.get_parent() === box &&
            next?.child?.app?.get_id() === FILES_APP_ID)
            box.set_child_above_sibling(separator, next);
    }

    // Returns whether the stack opened.
    _openStack(dock, item, anchor, params) {
        if (this._stack)
            return false;
        this._launchHold?.end();

        // Holding the dock's menu state keeps it shown under the stack; it is
        // set before the grab, so losing hover to the grab never hides it. The
        // stack's grab hides pointer motion from the dock, so on close the
        // button's hover (and its label) and the magnifier are brought up to
        // date with where the pointer is now.
        const stack = new Stack({
            ...params,
            anchor,
            onClosed: ({launched}) => {
                if (this._stack === stack)
                    this._stack = null;
                const release = () => {
                    // The dock destroys its docks before it tells
                    // (docks-destroyed, or docks-ready for Dash to Dock), so
                    // the item may be gone already (a destroyed item's label
                    // is null).
                    if (!item.label)
                        return;
                    dock.setItemMenuOpen(item, false);
                    item.child?.sync_hover?.();
                    item.hideLabel?.();
                    this._wakeMagnifier(dock);
                };
                if (launched)
                    this._holdDockForLaunch(release);
                else
                    release();
            },
        });
        dock.setItemMenuOpen(item, true);
        this._stack = stack;
        if (stack.open())
            return true;
        this._stack = null;
        dock.setItemMenuOpen(item, false);
        return false;
    }

    // The pointer is over the stack, not the dock, when an entry is chosen, so
    // releasing the dock at once would let it hide (when a window covers it)
    // while the new window pours out of the sliding icon. Holds it until the
    // next window that opens has finished its genie, then calls release.
    _holdDockForLaunch(release) {
        let timeoutId = 0;
        const hold = {
            end: () => {
                if (this._launchHold !== hold)
                    return;
                this._launchHold = null;
                global.window_manager.disconnectObject(hold);
                if (timeoutId)
                    GLib.source_remove(timeoutId);
                release();
            },
        };
        this._launchHold = hold;
        timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LAUNCH_HOLD_MAX_MS, () => {
            timeoutId = 0;
            hold.end();
            return GLib.SOURCE_REMOVE;
        });
        // Connected after GenieAnimation's own map handler, so the genie is
        // already attached when this one runs.
        global.window_manager.connectObject('map', (_wm, actor) => {
            if (actor.meta_window?.get_window_type() !== Meta.WindowType.NORMAL)
                return;
            global.window_manager.disconnectObject(hold);
            this._genieAnimation.whenOpened(actor, hold.end);
        }, hold);
    }

    // The labels are translated here, when the stack opens: po/ holds the
    // translations, and GNOME Shell loads them from locale/ for the
    // gettext-domain in metadata.json.
    _openPlaces(dock, button, icon) {
        return this._openStack(dock, button.get_parent(), icon, {
            title: _('Files'),
            openLabel: _('Open Files'),
            onOpenFolder: () => Object.getPrototypeOf(button).activate.call(button, 1),
            items: () => listPlaces(_('Home')),
        });
    }

    _widenClip(dock) {
        const box = dock.frame;
        if (!box?.has_clip)
            return;

        const [x, y, width, height] = box.get_clip();
        const widened = this._clips.get(dock);
        // The clip is stored as float32, so compare with a tolerance.
        if (widened && [x, y, width, height].every((v, i) => Math.abs(v - widened[i]) < 0.01))
            return;

        const clip = [x - CLIP_MARGIN_PX, y, width + 2 * CLIP_MARGIN_PX, height];
        this._clips.set(dock, clip);
        box.set_clip(...clip);
    }

    _detachDocks() {
        this._stack?.destroy();
        this._stack = null;
        this._launchHold?.end();
        const laters = global.compositor.get_laters();
        for (const id of this._separatorLaters.values())
            laters.remove(id);
        this._separatorLaters.clear();

        for (const [box, dock] of this._boxes) {
            box.disconnectObject(this);
            dock.frame?.disconnectObject(this);
            if (this._clips.has(dock))
                dock.restoreClip();
            if (dock.isHorizontal && dock.scroller)
                dock.scroller.clip_to_view = this._clipToView;
            if (dock.separator) {
                dock.separator.translation_x = 0;
                this._restoreSeparator(dock);
            }
            const background = dock.background;
            if (background) {
                background.scale_x = 1;
                background.translation_x = 0;
                background.set_pivot_point(0, 0);
            }
        }
        this._boxes.clear();
        this._clips.clear();
        this._separatorMoved.clear();
        for (const dock of [...this._magnifiers.keys()])
            this._stopMagnifier(dock);
        for (const button of [...this._buttons.keys()])
            this._untrackButton(button);
    }

    _trackButton(button, dock, icon = button?.icon) {
        if (!button || !icon || this._buttons.has(button))
            return;

        this._buttons.set(button, {icon, dock, stopFocusSync: keepFocusInSync(button)});
        icon.set_pivot_point(0.5, 1);
        button.connectObject('destroy', () => {
            this._stopBounce(button, false);
            this._buttons.get(button).stopFocusSync();
            this._buttons.delete(button);
        }, this);

        // Ubuntu Dock calls animateLaunch only when it starts a new window, and
        // before launching it, so an error here must never block the launch.
        if (button.app) {
            button.animateLaunch = () => {
                try {
                    this._bounce(button, icon, dock);
                } catch (e) {
                    console.error(`[dock-glass] Launch bounce failed: ${e}`);
                }
            };
        }

        // Files with no windows opens its places stack on a plain left click;
        // otherwise (windows open, other buttons, Ctrl or Shift) the click
        // keeps Ubuntu Dock's behavior.
        if (button.app?.get_id() === FILES_APP_ID && button.activate) {
            button.activate = clickButton => {
                const [, , mods] = global.get_pointer();
                const modified = mods & (Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.SHIFT_MASK);
                if (clickButton === 1 && !modified && button.app.get_n_windows() === 0) {
                    try {
                        if (this._openPlaces(dock, button, icon))
                            return;
                    } catch (e) {
                        console.error(`[dock-glass] Cannot open the Files stack: ${e}`);
                    }
                }
                Object.getPrototypeOf(button).activate.call(button, clickButton);
            };
        }

        // Ubuntu Dock publishes the minimize target from the button's
        // transformed position, so measure it without the spread shift: the
        // genie aims at the icon's rest slot, not where the magnifier moved it.
        const updateIconGeometry = button.updateIconGeometry;
        if (updateIconGeometry) {
            button.updateIconGeometry = (...args) => {
                const shift = button.translation_x;
                button.translation_x = 0;
                try {
                    return updateIconGeometry.apply(button, args);
                } finally {
                    button.translation_x = shift;
                }
            };
        }
    }

    _untrackButton(button) {
        const {icon, stopFocusSync} = this._buttons.get(button);
        this._buttons.delete(button);
        stopFocusSync();
        this._stopBounce(button, true);
        button.disconnectObject(this);
        delete button.animateLaunch;
        delete button.updateIconGeometry;
        delete button.activate;
        icon.remove_all_transitions();
        icon.set_scale(1, 1);
        icon.set_pivot_point(0, 0);
        button.translation_x = 0;
    }

    // Rect of the window's app icon as drawn, magnified and spread or not,
    // and of its dock's pill (null without one), preferring the dock on the
    // window's monitor. A launch bounce moves only its clone, so the icon
    // stays on the dock.
    _findDockIcon(window) {
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const monitor = Main.layoutManager.monitors[window.get_monitor()];
        let fallback = null;
        for (const [button, {icon, dock}] of this._buttons) {
            if (!app || button.app !== app)
                continue;

            const rect = stageRect(icon);
            if (!rect)
                continue;
            const found = {icon: rect, dock: stageRect(dock.background)};
            if (monitor && rect.x >= monitor.x && rect.x < monitor.x + monitor.width)
                return found;
            fallback ??= found;
        }
        return fallback;
    }

    _wakeMagnifier(dock) {
        let magnifier = this._magnifiers.get(dock);
        if (!magnifier) {
            // No magnification with animations disabled, on a destroyed dock,
            // or on a vertical dock (the stylesheet only styles bottom docks).
            if (!St.Settings.get().enable_animations ||
                !this._boxes.has(dock.itemBox) || !dock.isHorizontal)
                return;

            // Ticks every frame while the magnification changes; it stops once
            // settled under a still pointer and restarts on pointer motion.
            const timeline = new Clutter.Timeline({
                actor: dock.itemBox,
                duration: 1000,
                repeat_count: -1,
            });
            magnifier = {timeline, frameId: 0, strength: 0, pointer: null, lastTime: 0, pill: null};
            magnifier.frameId = timeline.connect('new-frame',
                () => this._magnifyFrame(dock, magnifier));
            this._magnifiers.set(dock, magnifier);
        }
        if (!magnifier.timeline.is_playing())
            magnifier.timeline.start();
    }

    _stopMagnifier(dock) {
        const magnifier = this._magnifiers.get(dock);
        if (!magnifier)
            return;

        this._magnifiers.delete(dock);
        magnifier.timeline.disconnect(magnifier.frameId);
        magnifier.timeline.stop();
    }

    _magnifyFrame(dock, magnifier) {
        // An error here would repeat every frame, so log it once and stop.
        try {
            this._magnifyStep(dock, magnifier);
        } catch (e) {
            console.error(`[dock-glass] Magnification failed: ${e}`);
            this._stopMagnifier(dock);
        }
    }

    _magnifyStep(dock, magnifier) {
        const now = GLib.get_monotonic_time() / 1000;
        // Cap the step so a stalled frame does not turn into a jump.
        const dt = magnifier.lastTime ? Math.min(now - magnifier.lastTime, 50) : 16;
        magnifier.lastTime = now;

        const rest = this._restLayout(dock);
        const [pointerX, pointerY] = global.get_pointer();
        // Over the dock means over the pill as it is drawn now (wider while
        // magnified), from the top of the icon headroom down to the screen
        // edge, so gaps, the separator and the padding never interrupt it.
        const pill = magnifier.pill ?? rest;
        const active = Boolean(rest) &&
            pointerX >= pill.start && pointerX <= pill.end && pointerY >= rest.top;
        if (active) {
            magnifier.pointer = magnifier.pointer === null
                ? pointerX : approach(magnifier.pointer, pointerX, dt, POINTER_SMOOTHING_MS);
        }
        magnifier.strength = approach(magnifier.strength, active ? 1 : 0,
            dt, STRENGTH_SMOOTHING_MS);
        // Turning animations off mid-way snaps straight back to rest.
        const fadedOut = !rest || magnifier.pointer === null ||
            !St.Settings.get().enable_animations ||
            (!active && magnifier.strength < 0.002);

        let changed = false;
        if (rest) {
            const layout = magnify({
                centers: rest.centers,
                separators: rest.separator ? [rest.separatorCenter] : [],
                pointer: magnifier.pointer ?? pointerX,
                radius: MAGNIFY_RADIUS_SLOTS * rest.slot,
                peak: MAGNIFY_PEAK,
                strength: fadedOut ? 0 : magnifier.strength,
                start: rest.start,
                end: rest.end,
            });
            magnifier.pill = fadedOut ? null : layout;

            rest.buttons.forEach((button, index) => {
                const {icon} = this._buttons.get(button);
                const {scale, shift} = layout.icons[index];
                // Skip invisible changes so a still pointer lets the dock settle.
                // Written as !(<=) so a broken (NaN) value always counts as changed.
                if (fadedOut || !(Math.abs(icon.scale_x - scale) <= 0.0005) ||
                    !(Math.abs(button.translation_x - shift) <= 0.05)) {
                    icon.set_scale(scale, scale);
                    button.translation_x = shift;
                    changed = true;
                }
                this._bounces.get(button)?.follow();
            });

            if (rest.separator) {
                const [shift] = layout.separators;
                if (fadedOut || !(Math.abs(rest.separator.translation_x - shift) <= 0.05)) {
                    rest.separator.translation_x = shift;
                    changed = true;
                }
            }

            const background = dock.background;
            const width = rest.end - rest.start;
            const pillScale = width > 0 ? (layout.end - layout.start) / width : 1;
            const pillShift = (layout.start + layout.end - rest.start - rest.end) / 2;
            if (fadedOut || !(Math.abs(background.scale_x - pillScale) <= 0.0005) ||
                !(Math.abs(background.translation_x - pillShift) <= 0.05)) {
                background.scale_x = pillScale;
                background.translation_x = pillShift;
                changed = true;
            }
        }

        if (fadedOut) {
            // Every icon and the pill were just set exactly back to rest.
            this._stopMagnifier(dock);
        } else if (active && !changed) {
            // Settled under a still pointer: stop ticking until it moves. While
            // fading out it keeps ticking until it reaches the exact rest.
            magnifier.timeline.stop();
            magnifier.lastTime = 0;
        }
    }

    // The dock as laid out without magnification, in stage coordinates: the
    // tracked buttons in on-screen order with their centers, the icon slot
    // (the smallest center-to-center step, so the separator gap does not
    // count), the pill's ends, and the dash's top. Transforms this extension
    // adds are undone, so the magnifier never feeds on its own output.
    _restLayout(dock) {
        const background = dock.background;
        // GNOME reports NaN positions for actors that were never allocated,
        // as happens while the dock fills up at startup; skip those.
        const buttons = [];
        const centers = [];
        for (const button of this._dockButtons(dock)) {
            if (!button.visible || !button.has_allocation())
                continue;
            const [x] = button.get_transformed_position();
            const center = x - button.translation_x + button.width / 2;
            if (!Number.isFinite(center))
                continue;
            buttons.push(button);
            centers.push(center);
        }
        if (!background || !buttons.length)
            return null;

        const steps = centers.slice(1).map((center, i) => center - centers[i])
            .filter(step => step > 0);
        const [dashX, dashY] = dock.dash.get_transformed_position();
        const start = dashX + background.x;
        if (!background.has_allocation() || !Number.isFinite(start) || !Number.isFinite(dashY))
            return null;

        // The line between favorites and running apps moves with the spread.
        let separator = dock.separator;
        let separatorCenter = NaN;
        if (separator?.visible && separator.has_allocation()) {
            const [x] = separator.get_transformed_position();
            separatorCenter = x - separator.translation_x + separator.width / 2;
        }
        if (!Number.isFinite(separatorCenter))
            separator = null;

        return {
            buttons,
            centers,
            separator,
            separatorCenter,
            slot: steps.length ? Math.min(...steps) : buttons[0].width,
            start,
            end: start + background.width,
            top: dashY,
        };
    }

    // Tracked buttons of a dock in on-screen order, Show Apps included.
    _dockButtons(dock) {
        const buttons = dock.itemBox.get_children()
            .map(item => item.child)
            .filter(button => this._buttons.has(button));
        const showApps = dock.showAppsButton;
        if (this._buttons.has(showApps)) {
            if (dock.showAppsAtTop)
                buttons.unshift(showApps);
            else
                buttons.push(showApps);
        }
        return buttons;
    }

    _bounce(button, icon, dock) {
        if (this._bounces.has(button))
            return;

        const {app} = button;
        const windowsBefore = app.get_n_windows();
        const clone = new Clutter.Clone({source: icon});
        Main.layoutManager.uiGroup.add_child(clone);

        // The clone starts from the icon as drawn, magnified or not, and keeps
        // matching it while the magnifier moves it, so launching never snaps.
        const follow = () => {
            const [x, y] = icon.get_transformed_position();
            const [width, height] = icon.get_transformed_size();
            clone.set_position(x, y);
            clone.set_size(width, height);
        };
        follow();
        icon.opacity = 0;

        const bounce = {clone, icon, follow, active: true, timeoutId: 0};
        this._bounces.set(button, bounce);

        // Finish the current hop once the new window shows up.
        app.connectObject('windows-changed', () => {
            if (app.get_n_windows() > windowsBefore)
                bounce.active = false;
        }, clone);
        // Stop at once if the dock starts hiding, so the clone never floats alone.
        dock.connectHiding(() => this._stopBounce(button, true), clone);
        bounce.timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            BOUNCE_TIMEOUT_S, () => {
                bounce.timeoutId = 0;
                bounce.active = false;
                return GLib.SOURCE_REMOVE;
            });

        this._bounceOnce(button, bounce);
    }

    _bounceOnce(button, bounce) {
        // Without animations (or unmapped) ease() completes synchronously,
        // which would recurse forever, so stop instead.
        if (!St.Settings.get().enable_animations || !bounce.clone.is_mapped()) {
            this._stopBounce(button, true);
            return;
        }

        bounce.clone.ease({
            translation_y: -BOUNCE_HEIGHT_PX,
            duration: BOUNCE_HALF_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => bounce.clone.ease({
                translation_y: 0,
                duration: BOUNCE_HALF_DURATION_MS,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (bounce.active)
                        this._bounceOnce(button, bounce);
                    else
                        this._stopBounce(button, true);
                },
            }),
        });
    }

    _stopBounce(button, restoreIcon) {
        const bounce = this._bounces.get(button);
        if (!bounce)
            return;

        this._bounces.delete(button);
        if (bounce.timeoutId)
            GLib.source_remove(bounce.timeoutId);
        bounce.clone.destroy();
        if (restoreIcon) {
            bounce.icon.opacity = 255;
            const dock = this._buttons.get(button)?.dock;
            if (dock)
                this._wakeMagnifier(dock);
        }
    }
}
