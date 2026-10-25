// SPDX-License-Identifier: GPL-3.0-or-later
/*
 * Genie effect that "pours" a window out of its dock icon when it opens or
 * is restored, and back into it when it is minimized.
 *
 * Adapted from the minimize and unminimize effects of Compiz alike magic
 * lamp effect: https://github.com/hermes83/compiz-alike-magic-lamp-effect
 * Copyright (C) 2020 hermes83
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version. See <http://www.gnu.org/licenses/>.
 *
 * Changes: merged the abstract, minimize and unminimize classes (minimizing
 * runs the stages backwards), the caller completes the window manager's
 * minimize or unminimize through onDone, the genie ends at the dock's inner
 * edge instead of the screen edge, it can wait for the window's first
 * drawing, it advances by frame, stop the timeline on destroy, and return
 * right after destroying in overview.
 */
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {dockDepth, pourStage} from './genieGeometry.js';

// Magic Lamp defaults.
const EFFECT = 'default';
const DURATION_MS = 400;
const X_TILES = 10;
const Y_TILES = 10;
// Distance from a monitor edge within which the icon counts as on that edge.
const EPSILON = 40;
// Longest a genie waits, collapsed into the icon, for the window's first
// drawing.
const DRAWING_WAIT_MAX_MS = 1500;
// Most a genie advances in one frame: a 30 fps frame. Slower frames, such as
// while Brave or VS Code start and hold up the compositor, slow it down
// instead of skipping its stages.
const MAX_FRAME_STEP_MS = 1000 / 30;

export class GenieEffect extends Clutter.DeformEffect {
    static {
        GObject.registerClass(this);
    }

    // icon: the rect the window pours out of or into. dock: the rect of the
    // dock's pill, or null. minimize: pour into the icon instead of out of
    // it. onDone: called once when the genie ends or is dropped.
    // startOnRepaint: an actor that emits repaint-scheduled (the window's
    // surface), whose next repaint starts the genie; until then the window
    // stays collapsed into the icon.
    _init(params = {}) {
        super._init();

        this.icon = params.icon;
        this.dock = params.dock ?? null;
        this.minimize = Boolean(params.minimize);
        this._onDone = params.onDone ?? null;
        this._whenDone = [];
        this._startOnRepaint = params.startOnRepaint ?? null;
        this._repaintId = 0;
        this._waitId = 0;
        this._duration = 0;
        this._elapsed = 0;
        this.monitor = {x: 0, y: 0, width: 0, height: 0};
        this.iconMonitor = {x: 0, y: 0, width: 0, height: 0};
        this.window = {x: 0, y: 0, width: 0, height: 0};
        this.iconPosition = null;

        // k and j go from 1 (collapsed into the icon) to 0 (full window).
        this.k = this.minimize ? 0 : 1;
        this.j = this.minimize ? 0 : 1;
        this.expandWidth = 0;
        this.fullWidth = 0;
        this.expandHeight = 0;
        this.fullHeight = 0;
        this.width = 0;
        this.height = 0;
        this.x = 0;
        this.y = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.effectX = 0;
        this.effectY = 0;

        this.timeline = null;
        this.newFrameId = 0;
        this.initialized = false;
    }

    vfunc_set_actor(actor) {
        super.vfunc_set_actor(actor);

        if (!this.actor || this.initialized || this.timeline)
            return;

        // Without a monitor or a size there is nothing to animate; staying
        // uninitialized keeps vfunc_deform_vertex a no-op, so the window
        // simply shows instead of staying collapsed.
        this.monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
        [this.window.width, this.window.height] = actor.get_size();
        if (!this.monitor || !this.window.width || !this.window.height)
            return;

        [this.window.x, this.window.y] = [this.actor.get_x() - this.monitor.x, this.actor.get_y() - this.monitor.y];

        if (!this.icon || (this.icon.x == 0 && this.icon.y == 0 && this.icon.width == 0 && this.icon.height == 0)) {
            this.icon = {x: 0, y: 0, width: 0, height: 0};
            this.icon.x = this.monitor.x + this.monitor.width / 2;
            this.icon.y = this.monitor.height + this.monitor.y;
        }

        Main.layoutManager.monitors.forEach((monitor, monitorIndex) => {
            let scale = 1;
            if (global.display && global.display.get_monitor_scale)
                scale = global.display.get_monitor_scale(monitorIndex);

            if (this.icon.x >= monitor.x && this.icon.x <= monitor.x + monitor.width * scale && this.icon.y >= monitor.y && this.icon.y <= monitor.y + monitor.height * scale)
                this.iconMonitor = monitor;
        });
        if (this.iconMonitor.x == 0 && this.iconMonitor.y == 0 && this.iconMonitor.width == 0 && this.iconMonitor.height == 0)
            this.iconMonitor = this.monitor;

        [this.icon.x, this.icon.y, this.icon.width, this.icon.height] = [this.icon.x - this.monitor.x, this.icon.y - this.monitor.y, this.icon.width, this.icon.height];

        // Pour out from the dock's inner edge on the icon's side, so the
        // window never passes under the dock, or from the monitor border
        // there while the dock is hidden. The icon rect then spans from the
        // border to that edge, which is where the math below aims.
        if (this.icon.y + this.icon.height >= this.monitor.height - EPSILON) {
            this.iconPosition = St.Side.BOTTOM;
            this.icon.height = dockDepth('bottom', this.dock, this.iconMonitor);
            this.icon.y = this.iconMonitor.y + this.iconMonitor.height - this.monitor.y - this.icon.height;
        } else if (this.icon.x <= EPSILON) {
            this.iconPosition = St.Side.LEFT;
            this.icon.x = this.iconMonitor.x - this.monitor.x;
            this.icon.width = dockDepth('left', this.dock, this.iconMonitor);
        } else if (this.icon.x + this.icon.width >= this.monitor.width - EPSILON) {
            this.iconPosition = St.Side.RIGHT;
            this.icon.width = dockDepth('right', this.dock, this.iconMonitor);
            this.icon.x = this.iconMonitor.x + this.iconMonitor.width - this.monitor.x - this.icon.width;
        } else {
            this.iconPosition = St.Side.TOP;
            this.icon.y = this.iconMonitor.y - this.monitor.y;
            this.icon.height = dockDepth('top', this.dock, this.iconMonitor);
        }

        this.set_n_tiles(X_TILES, Y_TILES);

        // The timeline only paces the frames: the genie keeps its own time
        // (_onNewFrame) and ends itself.
        this._duration = DURATION_MS + (this.monitor.width * this.monitor.height) / (this.window.width * this.window.height);
        this.timeline = new Clutter.Timeline({actor: this.actor, duration: this._duration, repeat_count: -1});
        this.newFrameId = this.timeline.connect('new-frame', this._onNewFrame.bind(this));
        if (this._startOnRepaint) {
            this._repaintId = this._startOnRepaint.connect('repaint-scheduled', () => this._start());
            this._waitId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DRAWING_WAIT_MAX_MS, () => {
                this._waitId = 0;
                this._start();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            this.timeline.start();
        }

        // Only now may vfunc_deform_vertex collapse the window into the icon.
        this.initialized = true;
    }

    _start() {
        this._stopWaiting();
        this.timeline?.start();
    }

    _stopWaiting() {
        if (this._repaintId)
            this._startOnRepaint.disconnect(this._repaintId);
        this._repaintId = 0;
        if (this._waitId)
            GLib.source_remove(this._waitId);
        this._waitId = 0;
    }

    // Calls callback once when the genie ends or is dropped.
    whenDone(callback) {
        this._whenDone.push(callback);
    }

    destroy() {
        this._stopWaiting();
        if (this.timeline) {
            this.timeline.disconnect(this.newFrameId);
            this.timeline.stop();
            this.timeline = null;
        }

        this.actor?.remove_effect(this);

        const callbacks = [this._onDone, ...this._whenDone];
        this._onDone = null;
        this._whenDone = [];
        callbacks.forEach(callback => callback?.());
    }

    _onNewFrame(timeline) {
        // A window closed during a workspace switch loses its actor with no
        // kill-window-effects or destroy signal; the timeline repeats until
        // the genie ends it, so end it here.
        if (!this.actor) {
            this.destroy();
            return;
        }

        if (Main.overview.visible) {
            this.destroy();
            return;
        }

        this._elapsed += Math.min(timeline.get_delta(), MAX_FRAME_STEP_MS);
        const progress = this._elapsed / this._duration;
        if (progress >= 1) {
            this.destroy();
            return;
        }
        ({k: this.k, j: this.j} = pourStage(this.minimize ? 1 - progress : progress));

        this.actor.get_parent()?.queue_redraw();
        this.invalidate();
    }

    vfunc_modify_paint_volume(_pv) {
        return false;
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this.initialized)
            return;

        let propX = w / this.window.width;
        let propY = h / this.window.height;

        if (this.iconPosition == St.Side.LEFT) {
            this.width = this.window.width - this.icon.width + this.window.x * this.k;

            this.x = (this.width - this.j * this.width) * v.tx;
            this.y = v.ty * this.window.height * (this.x + (this.width - this.x) * (1 - this.k)) / this.width +
                    v.ty * this.icon.height * (this.width - this.x) / this.width;

            this.offsetX = this.icon.width - this.window.x * this.k;
            this.offsetY = (this.icon.y - this.window.y) * ((this.width - this.x) / this.width) * this.k;

            if (EFFECT === 'sine')
                this.effectY = Math.sin(this.x / this.width * Math.PI * 4) * this.window.height / 14 * this.k;
            else
                this.effectY = Math.sin((0.5 - (this.width - this.x) / this.width) * 2 * Math.PI) * (this.window.y + this.window.height * v.ty - (this.icon.y + this.icon.height * v.ty)) / 7 * this.k;
        } else if (this.iconPosition == St.Side.TOP) {
            this.height = this.window.height - this.icon.height + this.window.y * this.k;

            this.y = (this.height - this.j * this.height) * v.ty;
            this.x = v.tx * this.window.width * (this.y + (this.height - this.y) * (1 - this.k)) / this.height +
                    v.tx * this.icon.width * (this.height - this.y) / this.height;

            this.offsetX = (this.icon.x - this.window.x) * ((this.height - this.y) / this.height) * this.k;
            this.offsetY = this.icon.height - this.window.y * this.k;

            if (EFFECT === 'sine')
                this.effectX = Math.sin(this.y / this.height * Math.PI * 4) * this.window.width / 14 * this.k;
            else
                this.effectX = Math.sin((0.5 - (this.height - this.y) / this.height) * 2 * Math.PI) * (this.window.x + this.window.width * v.tx - (this.icon.x + this.icon.width * v.tx)) / 7 * this.k;
        } else if (this.iconPosition == St.Side.RIGHT) {
            this.expandWidth = (this.iconMonitor.width - this.icon.width - this.window.x - this.window.width);
            this.fullWidth = (this.iconMonitor.width - this.icon.width - this.window.x) - this.expandWidth * (1 - this.k);
            this.width = this.fullWidth - this.j * this.fullWidth;

            this.x = v.tx * this.width;
            this.y = v.ty * (this.icon.height) +
                    v.ty * (this.window.height - this.icon.height) * (1 - this.j) * (1 - v.tx) +
                    v.ty * (this.window.height - this.icon.height) * (1 - this.k) * (v.tx);

            this.offsetY = (this.icon.y - this.window.y) * (this.x / this.fullWidth) * this.k + (this.icon.y - this.window.y) * this.j;
            this.offsetX = this.iconMonitor.width - this.icon.width - this.window.x - this.width - this.expandWidth * (1 - this.k);

            if (EFFECT === 'sine')
                this.effectY = Math.sin((this.width - this.x) / this.fullWidth * Math.PI * 4) * this.window.height / 14 * this.k;
            else
                this.effectY = Math.sin(((this.width - this.x) / this.fullWidth) * 2 * Math.PI + Math.PI) * (this.window.y + this.window.height * v.ty - (this.icon.y + this.icon.height * v.ty)) / 7 * this.k;
        } else if (this.iconPosition == St.Side.BOTTOM) {
            this.expandHeight = (this.iconMonitor.height - this.icon.height - this.window.y - this.window.height);
            this.fullHeight = (this.iconMonitor.height - this.icon.height - this.window.y) - this.expandHeight * (1 - this.k);
            this.height = this.fullHeight - this.j * this.fullHeight;

            this.y = v.ty * this.height;
            this.x = v.tx * (this.icon.width) +
                    v.tx * (this.window.width - this.icon.width) * (1 - this.j) * (1 - v.ty) +
                    v.tx * (this.window.width - this.icon.width) * (1 - this.k) * (v.ty);

            this.offsetX = (this.icon.x - this.window.x) * (this.y / this.fullHeight) * this.k + (this.icon.x - this.window.x) * this.j;
            this.offsetY = this.iconMonitor.height - this.icon.height - this.window.y - this.height - this.expandHeight * (1 - this.k);

            if (EFFECT === 'sine')
                this.effectX = Math.sin((this.height - this.y) / this.fullHeight * Math.PI * 4) * this.window.width / 14 * this.k;
            else
                this.effectX = Math.sin(((this.height - this.y) / this.fullHeight) * 2 * Math.PI + Math.PI) * (this.window.x + this.window.width * v.tx - (this.icon.x + this.icon.width * v.tx)) / 7 * this.k;
        }

        v.x = (this.x + this.offsetX + this.effectX) * propX;
        v.y = (this.y + this.offsetY + this.effectY) * propY;
    }
}
