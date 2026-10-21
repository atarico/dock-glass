// Dock Glass: continuous macOS-like magnification and a launch bounce for
// Ubuntu Dock icons. Like on macOS, windows open with the system animation;
// the genie belongs to minimize and restore (Magic Lamp).
// The pill shape lives in stylesheet.css.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {approach, magnify} from './magnifier.js';

const DOCK_UUID = 'ubuntu-dock@ubuntu.com';

// Continuous macOS-like magnification (the math lives in magnifier.js).
// Icons grow from their bottom edge, neighbors spread apart to make room and
// the pill widens with them, like the macOS Dock. The peak is the
// enlargement under the pointer, the equivalent of the macOS Magnification
// slider. Apple publishes no falloff curve; a cosine bell that reaches the
// rest size three tiles away matches common recreations of the Dock.
// Ubuntu Dock clips its content vertically. stylesheet.css raises the tile
// top padding to 24px (with a matching background margin, so the pill keeps
// its size), leaving 30px above each 48px icon image (6px icon padding +
// 24px); growing from the 60px tile bottom, the image top rises 54px * 0.4.
const MAGNIFY_PEAK = 1.4;
const MAGNIFY_RADIUS_TILES = 3;
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
        this._magnifiers = new Map();

        Main.extensionManager.connectObject('extension-state-changed',
            (_manager, extension) => {
                if (extension.uuid === DOCK_UUID)
                    this._attachManager();
            }, this);
        this._loadDocking();
    }

    disable() {
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
                'child-added', (_box, item) => {
                    this._trackButton(item.child, dock);
                    this._wakeMagnifier(dock);
                },
                'child-removed', () => this._wakeMagnifier(dock),
                'destroy', () => {
                    this._boxes.delete(box);
                    this._stopMagnifier(dock);
                },
                this);
            // Pointer motion over the dock starts or restarts the magnifier,
            // and leaving it lets the magnifier notice and fade out.
            dock.connectObject(
                'motion-event', () => {
                    this._wakeMagnifier(dock);
                    return Clutter.EVENT_PROPAGATE;
                },
                'leave-event', () => {
                    this._wakeMagnifier(dock);
                    return Clutter.EVENT_PROPAGATE;
                },
                this);
            for (const item of box.get_children())
                this._trackButton(item.child, dock);

            const showApps = dock.dash._showAppsIcon;
            this._trackButton(showApps?.toggleButton, dock, showApps?.icon);

            // Spread icons reach past the scroll view, which clips to its
            // allocation by default; the pill scales around its center.
            const scroller = dock.dash._boxContainer;
            this._clipToView = scroller?.clip_to_view ?? true;
            if (scroller)
                scroller.clip_to_view = false;
            dock.dash._background?.set_pivot_point(0.5, 0.5);
        }
    }

    _detachDocks() {
        for (const [box, dock] of this._boxes) {
            box.disconnectObject(this);
            dock.disconnectObject(this);
            if (dock.dash?._boxContainer)
                dock.dash._boxContainer.clip_to_view = this._clipToView;
            const background = dock.dash?._background;
            if (background) {
                background.scale_x = 1;
                background.translation_x = 0;
                background.set_pivot_point(0, 0);
            }
        }
        this._boxes.clear();
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
        button.connectObject('destroy', () => {
            this._stopBounce(button, false);
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
    }

    _untrackButton(button) {
        const {icon} = this._buttons.get(button);
        this._buttons.delete(button);
        this._stopBounce(button, true);
        button.disconnectObject(this);
        delete button.animateLaunch;
        icon.remove_all_transitions();
        icon.set_scale(1, 1);
        icon.set_pivot_point(0, 0);
        button.translation_x = 0;
    }

    _wakeMagnifier(dock) {
        let magnifier = this._magnifiers.get(dock);
        if (!magnifier) {
            // No magnification with animations disabled, on a destroyed dock,
            // or on a vertical dock (the stylesheet only styles bottom docks).
            if (!St.Settings.get().enable_animations ||
                !this._boxes.has(dock.dash?._box) || !dock.dash._isHorizontal)
                return;

            // Ticks every frame while the magnification changes; it stops once
            // settled under a still pointer and restarts on pointer motion.
            const timeline = new Clutter.Timeline({
                actor: dock.dash._box,
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
                pointer: magnifier.pointer ?? pointerX,
                radius: MAGNIFY_RADIUS_TILES * rest.tile,
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
                if (fadedOut || Math.abs(icon.scale_x - scale) > 0.0005 ||
                    Math.abs(button.translation_x - shift) > 0.05) {
                    icon.set_scale(scale, scale);
                    button.translation_x = shift;
                    changed = true;
                }
                this._bounces.get(button)?.follow();
            });

            const background = dock.dash._background;
            const width = rest.end - rest.start;
            const pillScale = width > 0 ? (layout.end - layout.start) / width : 1;
            const pillShift = (layout.start + layout.end - rest.start - rest.end) / 2;
            if (fadedOut || Math.abs(background.scale_x - pillScale) > 0.0005 ||
                Math.abs(background.translation_x - pillShift) > 0.05) {
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
    // tracked buttons in on-screen order with their centers, the pill's ends,
    // and the dash's top. Transforms this extension adds are undone, so the
    // magnifier never feeds on its own output.
    _restLayout(dock) {
        const {dash} = dock;
        const background = dash._background;
        const buttons = this._dockButtons(dock).filter(button => button.visible);
        if (!background || !buttons.length)
            return null;

        const centers = buttons.map(button => {
            const [x] = button.get_transformed_position();
            return x - button.translation_x + button.width / 2;
        });
        const [dashX, dashY] = dash.get_transformed_position();
        const start = dashX + background.x;
        return {
            buttons,
            centers,
            tile: buttons[0].width,
            start,
            end: start + background.width,
            top: dashY,
        };
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
                this._wakeMagnifier(dock);
        }
    }
}
