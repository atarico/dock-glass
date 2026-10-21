// Dock Glass: continuous macOS-like magnification and a launch bounce for
// Ubuntu Dock icons, plus a genie effect from the dock icon when a window
// opens (openAnimation.js).
// The pill shape and glass border live in stylesheet.css.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {OpenAnimation} from './openAnimation.js';

const DOCK_UUID = 'ubuntu-dock@ubuntu.com';

// Continuous macOS-like magnification. Each knot is the scale and lift of an
// icon 0, 1, 2 and 3+ icon slots away from the pointer; in between, values
// are smoothstep-interpolated, so icons follow the pointer continuously.
// Ubuntu Dock clips its content. stylesheet.css raises the tile top padding
// to 28px (with a matching background margin, so the pill keeps its size),
// leaving 34px above each 48px icon image (6px icon padding + 28px); zooming
// from the 60px tile bottom, the largest icon needs 54px * 0.4 + 12px = 33.6px.
const MAGNIFY_KNOTS = [
    {scale: 1.4, lift: 12},
    {scale: 0.9, lift: 6},
    {scale: 0.8, lift: 2},
    {scale: 0.7, lift: 0},
];
// Edge icons grow inward so the dock does not clip their sides: scaling the
// 60px tile from x = 21px keeps the image's 6px side padding inside it
// (21 + (6 - 21) * 1.4 = 0).
const EDGE_PIVOT_X = 0.35;
// Time constants of the per-frame exponential smoothing: the pointer
// position lags slightly so fast sweeps stay fluid, and the whole
// magnification fades in when the pointer enters and out when it leaves.
const POINTER_SMOOTHING_MS = 40;
const STRENGTH_SMOOTHING_MS = 80;
// Moving between icons crosses a ~4px gap that hovers nothing; wait this
// long before treating the pointer as gone from the dock.
const RESET_DELAY_MS = 80;

// The bounce animates a clone in the top-level UI group, so the dock
// clip does not apply to it and it can jump higher than the zoom.
const BOUNCE_HEIGHT_PX = 22;
const BOUNCE_HALF_DURATION_MS = 260;
const BOUNCE_TIMEOUT_S = 10;

// Scale and lift for an icon `distance` icon slots away from the pointer.
function magnifyAt(distance) {
    const last = MAGNIFY_KNOTS.length - 1;
    if (distance >= last)
        return MAGNIFY_KNOTS[last];

    const i = Math.floor(distance);
    const t = distance - i;
    const eased = t * t * (3 - 2 * t);
    const from = MAGNIFY_KNOTS[i];
    const to = MAGNIFY_KNOTS[i + 1];
    return {
        scale: from.scale + (to.scale - from.scale) * eased,
        lift: from.lift + (to.lift - from.lift) * eased,
    };
}

// Frame-rate independent exponential smoothing of value toward target.
function approach(value, target, dtMs, timeConstantMs) {
    return target + (value - target) * Math.exp(-dtMs / timeConstantMs);
}

export default class DockGlassExtension extends Extension {
    enable() {
        this._enabled = true;
        this._retryId = 0;
        this._docking = null;
        this._manager = null;
        this._managerIds = [];
        this._boxes = new Map();
        this._buttons = new Map();
        this._bounces = new Map();
        this._resetIds = new Map();
        this._magnifiers = new Map();

        Main.extensionManager.connectObject('extension-state-changed',
            (_manager, extension) => {
                if (extension.uuid === DOCK_UUID)
                    this._attachManager();
            }, this);
        this._loadDocking();

        this._openAnimation = new OpenAnimation(window => this._findIconRect(window));
        this._openAnimation.enable();
    }

    disable() {
        this._openAnimation.disable();
        this._openAnimation = null;

        this._enabled = false;
        if (this._retryId)
            GLib.source_remove(this._retryId);
        this._retryId = 0;
        Main.extensionManager.disconnectObject(this);
        this._detachManager();
        this._docking = null;
    }

    async _loadDocking() {
        const dockExtension = Main.extensionManager.lookup(DOCK_UUID);
        if (!dockExtension)
            return;

        let docking;
        try {
            // Same URL Ubuntu Dock imports, so this is its live module instance.
            docking = await import(dockExtension.dir.get_child('docking.js').get_uri());
        } catch (e) {
            console.error(`[dock-glass] Cannot load ${DOCK_UUID}: ${e}`);
            return;
        }

        if (!this._enabled)
            return;
        this._docking = docking;
        this._attachManager();

        // GNOME enables user extensions before system ones and re-enables them
        // without extension-state-changed, so retry once if the dock is not up yet.
        if (!this._manager) {
            this._retryId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._retryId = 0;
                this._attachManager();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _attachManager() {
        const manager = this._docking?.DockManager.getDefault() ?? null;
        if (manager !== this._manager) {
            this._detachManager();
            this._manager = manager;
            // DockManager uses JS signals, so plain connect/disconnect is safe.
            if (manager) {
                this._managerIds = [
                    manager.connect('docks-ready', () => this._attachDocks()),
                    manager.connect('docks-destroyed', () => this._detachDocks()),
                ];
            }
        }
        this._attachDocks();
    }

    _detachManager() {
        this._detachDocks();
        this._managerIds.forEach(id => this._manager.disconnect(id));
        this._managerIds = [];
        this._manager = null;
    }

    _attachDocks() {
        for (const dock of this._manager?._allDocks ?? []) {
            const box = dock.dash?._box;
            if (!box || this._boxes.has(box))
                continue;

            this._boxes.set(box, dock);
            box.connectObject(
                'child-added', (_box, item) => this._trackButton(item.child, dock),
                'destroy', () => {
                    this._boxes.delete(box);
                    this._stopMagnifier(dock);
                },
                this);
            // Pointer motion anywhere in the dock restarts a settled magnifier.
            dock.connectObject('motion-event', () => {
                this._wakeMagnifier(dock);
                return Clutter.EVENT_PROPAGATE;
            }, this);
            for (const item of box.get_children())
                this._trackButton(item.child, dock);

            const showApps = dock.dash._showAppsIcon;
            this._trackButton(showApps?.toggleButton, dock, showApps?.icon);
        }
    }

    _detachDocks() {
        for (const [box, dock] of this._boxes) {
            box.disconnectObject(this);
            dock.disconnectObject(this);
        }
        this._boxes.clear();
        for (const id of this._resetIds.values())
            GLib.source_remove(id);
        this._resetIds.clear();
        for (const dock of [...this._magnifiers.keys()])
            this._stopMagnifier(dock);
        for (const button of [...this._buttons.keys()])
            this._untrackButton(button);
    }

    _trackButton(button, dock, icon = button?.icon) {
        if (!button || !icon || this._buttons.has(button))
            return;

        this._buttons.set(button, {icon, dock});
        icon.set_pivot_point(0.5, 1);
        button.connectObject(
            'notify::hover', () => this._onHoverChanged(dock),
            'destroy', () => {
                this._stopBounce(button, false);
                this._buttons.delete(button);
            },
            this);

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
    }

    _untrackButton(button) {
        const {icon} = this._buttons.get(button);
        this._buttons.delete(button);
        this._stopBounce(button, true);
        button.disconnectObject(this);
        delete button.animateLaunch;
        icon.remove_all_transitions();
        icon.set_scale(1, 1);
        icon.translation_y = 0;
        icon.set_pivot_point(0, 0);
    }

    // Rect of the window's app icon, preferring the dock on the window's monitor.
    _findIconRect(window) {
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const monitor = Main.layoutManager.monitors[window.get_monitor()];
        let fallback = null;
        for (const [button, {icon}] of this._buttons) {
            if (!app || button.app !== app)
                continue;

            const [x, y] = icon.get_transformed_position();
            const [width, height] = icon.get_transformed_size();
            const rect = {x, y, width, height};
            if (monitor && x >= monitor.x && x < monitor.x + monitor.width)
                return rect;
            fallback ??= rect;
        }
        return fallback;
    }

    _onHoverChanged(dock) {
        const resetId = this._resetIds.get(dock);
        if (resetId) {
            GLib.source_remove(resetId);
            this._resetIds.delete(dock);
        }

        for (const [button, entry] of this._buttons) {
            if (entry.dock === dock && button.hover) {
                this._setMagnifying(dock, true);
                return;
            }
        }

        this._resetIds.set(dock, GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            RESET_DELAY_MS, () => {
                this._resetIds.delete(dock);
                this._setMagnifying(dock, false);
                return GLib.SOURCE_REMOVE;
            }));
    }

    _setMagnifying(dock, active) {
        let magnifier = this._magnifiers.get(dock);
        if (!magnifier) {
            // No magnification with animations disabled, on a destroyed dock,
            // or on a vertical dock (the stylesheet only styles bottom docks).
            if (!active || !St.Settings.get().enable_animations ||
                !this._boxes.has(dock.dash?._box) || !dock.dash._isHorizontal)
                return;

            // Ticks every frame while the magnification changes; it stops once
            // settled and restarts on pointer motion.
            const timeline = new Clutter.Timeline({
                actor: dock.dash._box,
                duration: 1000,
                repeat_count: -1,
            });
            magnifier = {timeline, frameId: 0, active, strength: 0, position: null, lastTime: 0};
            magnifier.frameId = timeline.connect('new-frame',
                () => this._magnifyFrame(dock, magnifier));
            this._magnifiers.set(dock, magnifier);
        }
        magnifier.active = active;
        this._wakeMagnifier(dock);
    }

    _wakeMagnifier(dock) {
        const magnifier = this._magnifiers.get(dock);
        if (magnifier && !magnifier.timeline.is_playing())
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

        const buttons = this._dockButtons(dock);
        if (magnifier.active) {
            const [pointerX] = global.get_pointer();
            const target = this._slotPosition(buttons, pointerX);
            magnifier.position = magnifier.position === null
                ? target : approach(magnifier.position, target, dt, POINTER_SMOOTHING_MS);
        }
        magnifier.strength = approach(magnifier.strength, magnifier.active ? 1 : 0,
            dt, STRENGTH_SMOOTHING_MS);
        const fadedOut = !magnifier.active && magnifier.strength < 0.002;

        let changed = false;
        buttons.forEach((button, index) => {
            // The real icon is hidden while its clone bounces.
            if (this._bounces.has(button))
                return;

            const {icon} = this._buttons.get(button);
            let pivotX = 0.5;
            if (index === 0)
                pivotX = EDGE_PIVOT_X;
            else if (index === buttons.length - 1)
                pivotX = 1 - EDGE_PIVOT_X;
            // pivot_point is stored as float32, so compare with a tolerance.
            if (Math.abs(icon.pivot_point.x - pivotX) > 0.001)
                icon.set_pivot_point(pivotX, 1);

            let scale = 1;
            let lift = 0;
            if (!fadedOut && magnifier.position !== null) {
                const knot = magnifyAt(Math.abs(index - magnifier.position));
                scale = 1 + (knot.scale - 1) * magnifier.strength;
                lift = knot.lift * magnifier.strength;
            }
            // Skip invisible changes so a still pointer lets the dock settle.
            if (fadedOut || Math.abs(icon.scale_x - scale) > 0.0005 ||
                Math.abs(icon.translation_y + lift) > 0.05) {
                icon.set_scale(scale, scale);
                icon.translation_y = -lift;
                changed = true;
            }
        });

        if (fadedOut) {
            // Every icon was just set exactly back to rest.
            this._stopMagnifier(dock);
        } else if (!changed) {
            // Settled under a still pointer: stop ticking until it moves.
            magnifier.timeline.stop();
            magnifier.lastTime = 0;
        }
    }

    // Pointer x as a fractional icon index (2.5 = halfway between the third
    // and fourth icon), measured on the unscaled tiles in stage coordinates,
    // so it works on every monitor and across uneven gaps like the separator.
    _slotPosition(buttons, x) {
        const centers = buttons.map(button => {
            const [left] = button.get_transformed_position();
            const [width] = button.get_transformed_size();
            return left + width / 2;
        });
        const last = centers.length - 1;
        if (last < 1)
            return 0;

        // Past the first or last icon, extrapolate with that end's own gap.
        let i = 0;
        if (x >= centers[last])
            i = last - 1;
        else
            while (i < last - 1 && x > centers[i + 1])
                i++;
        return i + (x - centers[i]) / ((centers[i + 1] - centers[i]) || 1);
    }

    // Tracked buttons of a dock in on-screen order, Show Apps included.
    _dockButtons(dock) {
        const buttons = dock.dash._box.get_children()
            .map(item => item.child)
            .filter(button => this._buttons.has(button));
        const showApps = dock.dash._showAppsIcon?.toggleButton;
        if (this._buttons.has(showApps)) {
            if (this._manager?.settings?.showAppsAtTop)
                buttons.unshift(showApps);
            else
                buttons.push(showApps);
        }
        return buttons;
    }

    _bounce(button, icon, dock) {
        if (this._bounces.has(button))
            return;

        // Bounce at the resting size so the clone matches the icon it replaces.
        icon.remove_all_transitions();
        icon.set_scale(1, 1);
        icon.translation_y = 0;

        const {app} = button;
        const windowsBefore = app.get_n_windows();
        const [x, y] = icon.get_transformed_position();
        const [width, height] = icon.get_transformed_size();
        const clone = new Clutter.Clone({source: icon, x, y, width, height});
        Main.layoutManager.uiGroup.add_child(clone);
        icon.opacity = 0;

        const bounce = {clone, icon, active: true, timeoutId: 0};
        this._bounces.set(button, bounce);

        // Finish the current hop once the new window shows up.
        app.connectObject('windows-changed', () => {
            if (app.get_n_windows() > windowsBefore)
                bounce.active = false;
        }, clone);
        // Stop at once if the dock starts hiding, so the clone never floats alone.
        dock._slider?.connectObject('notify::slide-x', () => {
            if (dock._slider.slideX < 1)
                this._stopBounce(button, true);
        }, clone);
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
                this._onHoverChanged(dock);
        }
    }
}
