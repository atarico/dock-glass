// Plays the genie effect when an app window opens, replacing GNOME's default
// map animation. Closing and minimizing still go through the other wrappers
// (Burn My Windows on close, Magic Lamp on minimize and unminimize).
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GenieOpenEffect} from './genieEffect.js';

const EFFECT_NAME = 'dock-glass-open-genie';

export class OpenAnimation {
    // findIconRect(window) returns the app's dock icon rect, or null.
    constructor(findIconRect) {
        this._findIconRect = findIconRect;
        this._suppressed = new WeakSet();
        this._active = false;
        this._previous = null;
        this._wrapper = null;
    }

    enable() {
        this._active = true;

        // Connect before installing the wrapper, so a failure here can never
        // leave windows with neither GNOME's animation nor ours. Closing
        // (destroy) skips kill-window-effects, so drop the genie there too and
        // let only Burn My Windows play.
        const dropEffect = (_wm, actor) => actor.get_effect(EFFECT_NAME)?.destroy();
        global.window_manager.connectObject(
            'map', (_wm, actor) => this._onMap(actor),
            'kill-window-effects', dropEffect,
            'destroy', dropEffect,
            this);

        // GNOME binds _mapWindow at startup, so _shouldAnimateActor is the only
        // hook. Returning false makes _mapWindow call completed_map() at once;
        // the map handler above, which runs right after it, animates instead.
        const self = this;
        const previous = Main.wm._shouldAnimateActor;
        this._previous = previous;
        this._wrapper = function (actor, types) {
            if (self._shouldTakeOver(actor)) {
                self._suppressed.add(actor);
                return false;
            }
            return previous.call(this, actor, types);
        };
        Main.wm._shouldAnimateActor = this._wrapper;
    }

    disable() {
        this._active = false;
        global.window_manager.disconnectObject(this);
        for (const actor of global.get_window_actors())
            actor.get_effect(EFFECT_NAME)?.destroy();

        // Burn My Windows and Magic Lamp wrap the same method; restore only
        // while still outermost, otherwise stay as a pass-through.
        if (Main.wm._shouldAnimateActor === this._wrapper)
            Main.wm._shouldAnimateActor = this._previous;
    }

    // An error here would break _mapWindow and leave the window unmapped,
    // so any failure falls back to GNOME's own behavior.
    _shouldTakeOver(actor) {
        try {
            return this._active && this._isEligible(actor) &&
                new Error().stack.includes('_mapWindow@');
        } catch (e) {
            console.error(`[dock-glass] Open animation check failed: ${e}`);
            return false;
        }
    }

    _isEligible(actor) {
        const window = actor.meta_window;
        return actor.get_texture() &&
            window?.get_window_type() === Meta.WindowType.NORMAL &&
            !window.skip_taskbar &&
            !Main.overview.visible &&
            !Main.sessionMode.isLocked &&
            St.Settings.get().enable_animations;
    }

    _onMap(actor) {
        // Animate only windows whose default animation the wrapper skipped.
        if (!this._suppressed.delete(actor))
            return;

        actor.show();
        const effect = new GenieOpenEffect({icon: this._getIconRect(actor.meta_window)});
        actor.add_effect_with_name(EFFECT_NAME, effect);
        // The effect sets itself up while being added; drop it if it could not,
        // since an idle deform effect still renders the window offscreen.
        if (!effect.initialized)
            actor.remove_effect(effect);
    }

    _getIconRect(window) {
        const [ok, rect] = window.get_icon_geometry();
        if (ok)
            return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
        // Unset for an app's first window; zeros fall back to the monitor bottom.
        return this._findIconRect(window) ?? {x: 0, y: 0, width: 0, height: 0};
    }
}
