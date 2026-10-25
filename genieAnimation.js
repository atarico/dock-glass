// SPDX-License-Identifier: GPL-3.0-or-later
// Plays the genie effect when an app window opens, minimizes or is restored,
// replacing GNOME's default animations. Closing still goes through the other
// wrappers (Burn My Windows). While Magic Lamp is enabled, minimize and
// restore are left to it, so a window never gets two effects.
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GenieEffect} from './genieEffect.js';

const EFFECT_NAME = 'dock-glass-genie';

// GNOME's handlers whose default animation the genie replaces, as they show
// in the stack while they ask _shouldAnimateActor.
const HANDLERS = [
    ['_mapWindow@', 'map'],
    ['_minimizeWindow@', 'minimize'],
    ['_unminimizeWindow@', 'unminimize'],
];

export class GenieAnimation {
    // findDockIcon(window) returns {icon, dock}, the rects of the app's dock
    // icon and of that dock's pill (or null), or null without a dock icon.
    constructor(findDockIcon) {
        this._findDockIcon = findDockIcon;
        // Actors whose default animation the wrapper skipped, with which one.
        this._suppressed = new WeakMap();
        this._active = false;
        this._wrappers = [];
    }

    enable() {
        this._active = true;

        // Connect before installing the wrappers, so a failure here can never
        // leave windows with neither GNOME's animation nor ours. Closing
        // (destroy) skips kill-window-effects, so drop the genie there too and
        // let only Burn My Windows play. Dropping a genie completes the
        // minimize or restore it holds.
        const dropEffect = (_wm, actor) => actor.get_effect(EFFECT_NAME)?.destroy();
        global.window_manager.connectObject(
            'map', (_wm, actor) => this._onMap(actor),
            'kill-window-effects', dropEffect,
            'destroy', dropEffect,
            this);

        // Without an animation, GNOME completes a minimize or a restore at
        // once, which hides or shows the window before any genie. Hold that
        // call for the windows taken over and make it when the genie ends.
        const self = this;
        const shellwm = global.window_manager;
        this._wrap(shellwm, 'completed_minimize', previous => function (actor) {
            if (self._take(actor, 'minimize'))
                self._play(actor, {minimize: true, fromRestSlot: true, onDone: () => previous.call(shellwm, actor)});
            else
                previous.call(this, actor);
        });
        this._wrap(shellwm, 'completed_unminimize', previous => function (actor) {
            if (self._take(actor, 'unminimize')) {
                actor.show();
                self._play(actor, {fromRestSlot: true, onDone: () => previous.call(shellwm, actor)});
            } else {
                previous.call(this, actor);
            }
        });

        // GNOME binds its window handlers at startup, so _shouldAnimateActor
        // is the only hook. Returning false makes them complete at once: the
        // map handler above, which runs right after it, and the wrappers
        // above animate instead. Minimize and restore first ask the methods
        // this one wraps, and take over only what GNOME would animate: that
        // consumes a skipped effect (the window cycler restores without one),
        // and Magic Lamp turns them down too, wrapped inside or outside this.
        this._wrap(Main.wm, '_shouldAnimateActor', previous => function (actor, types) {
            const handler = self._takeOver(actor);
            if (!handler)
                return previous.call(this, actor, types);
            if (handler !== 'map' && !previous.call(this, actor, types))
                return false;
            self._suppressed.set(actor, handler);
            return false;
        });
    }

    disable() {
        this._active = false;
        global.window_manager.disconnectObject(this);
        for (const actor of global.get_window_actors())
            actor.get_effect(EFFECT_NAME)?.destroy();

        // Burn My Windows and Magic Lamp wrap the same methods; restore each
        // only while still outermost, otherwise stay as a pass-through.
        for (const {object, name, previous, wrapper} of this._wrappers.reverse()) {
            if (object[name] === wrapper)
                object[name] = previous;
        }
        this._wrappers = [];
    }

    _wrap(object, name, makeWrapper) {
        const previous = object[name];
        const wrapper = makeWrapper(previous);
        object[name] = wrapper;
        this._wrappers.push({object, name, previous, wrapper});
    }

    // The GNOME handler asking, when its default animation is to be replaced.
    // An error here would break that handler and leave the window stuck, so
    // any failure falls back to GNOME's own behavior.
    _takeOver(actor) {
        try {
            if (!this._active || !this._isEligible(actor))
                return null;
            const stack = new Error().stack;
            return HANDLERS.find(([frame]) => stack.includes(frame))?.[1] ?? null;
        } catch (e) {
            console.error(`[dock-glass] Window animation check failed: ${e}`);
            return null;
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

    // Whether the wrapper skipped this actor's default animation for that
    // handler; forgets it.
    _take(actor, handler) {
        if (this._suppressed.get(actor) !== handler)
            return false;
        this._suppressed.delete(actor);
        return true;
    }

    _onMap(actor) {
        if (!this._take(actor, 'map'))
            return;

        actor.show();
        this._play(actor);
    }

    // Pours the window out of its dock icon, or into it when minimizing.
    // onDone runs once, when the genie ends or is dropped, or at once when
    // there is none, so a held minimize or restore always completes.
    _play(actor, {minimize = false, fromRestSlot = false, onDone = null} = {}) {
        let effect = null;
        try {
            actor.get_effect(EFFECT_NAME)?.destroy();
            const target = this._getTarget(actor.meta_window, fromRestSlot);
            effect = new GenieEffect({...target, minimize, onDone});
            actor.add_effect_with_name(EFFECT_NAME, effect);
        } catch (e) {
            console.error(`[dock-glass] Cannot play the genie: ${e}`);
        }
        if (effect?.initialized)
            return;
        // The effect sets itself up while being added; drop it if it could not,
        // since an idle deform effect still renders the window offscreen.
        if (effect)
            effect.destroy();
        else
            onDone?.();
    }

    // Calls done once the genie of a window that just mapped has poured it
    // out, or at once when the window opens without one.
    whenOpened(actor, done) {
        const timeline = actor.get_effect(EFFECT_NAME)?.timeline;
        if (timeline)
            timeline.connect('completed', () => done());
        else
            done();
    }

    // Opening pours out of the icon as drawn right now, even while the
    // magnifier has moved or grown it. Minimize and restore aim at the icon's
    // rest slot, the window's icon geometry that the dock publishes, since
    // the magnifier settles while the genie plays. Each falls back to the
    // other: the icon geometry is unset for an app's first window, and zeros
    // fall back to the monitor bottom. Both pour from the top of the pill.
    _getTarget(window, fromRestSlot) {
        const found = this._findDockIcon(window);
        const [ok, rect] = window.get_icon_geometry();
        const restSlot = ok ? {x: rect.x, y: rect.y, width: rect.width, height: rect.height} : null;
        const icon = (fromRestSlot ? restSlot ?? found?.icon : found?.icon ?? restSlot) ??
            {x: 0, y: 0, width: 0, height: 0};
        return {icon, dock: found?.dock ?? null};
    }
}
