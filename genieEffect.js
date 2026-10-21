// SPDX-License-Identifier: GPL-3.0-or-later
/*
 * Genie effect that "pours" a newly opened window out of its dock icon.
 *
 * Adapted from the unminimize effect of Compiz alike magic lamp effect:
 * https://github.com/hermes83/compiz-alike-magic-lamp-effect
 * Copyright (C) 2020 hermes83
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version. See <http://www.gnu.org/licenses/>.
 *
 * Changes: merged the abstract and unminimize classes, removed the
 * completed_unminimize call (opening needs no WM completion), stop the
 * timeline on destroy, and return right after destroying in overview.
 */
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Magic Lamp defaults, so opening matches minimize and unminimize.
const EFFECT = 'default';
const DURATION_MS = 400;
const X_TILES = 10;
const Y_TILES = 10;
// Share of the animation spent widening from the icon edge.
const SPLIT = 0.3;
// Distance from a monitor edge within which the icon counts as on that edge.
const EPSILON = 40;

export class GenieOpenEffect extends Clutter.DeformEffect {
    static {
        GObject.registerClass(this);
    }

    _init(params = {}) {
        super._init();

        this.icon = params.icon;
        this.monitor = {x: 0, y: 0, width: 0, height: 0};
        this.iconMonitor = {x: 0, y: 0, width: 0, height: 0};
        this.window = {x: 0, y: 0, width: 0, height: 0};
        this.iconPosition = null;

        // k and j go from 1 (collapsed into the icon) to 0 (full window).
        this.k = 1;
        this.j = 1;
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
        this.completedId = 0;
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

        // Always pour out from the monitor border next to the icon.
        if (this.icon.y + this.icon.height >= this.monitor.height - EPSILON) {
            this.iconPosition = St.Side.BOTTOM;
            this.icon.y = this.iconMonitor.y + this.iconMonitor.height - this.monitor.y;
            this.icon.height = 0;
        } else if (this.icon.x <= EPSILON) {
            this.iconPosition = St.Side.LEFT;
            this.icon.x = this.iconMonitor.x - this.monitor.x;
            this.icon.width = 0;
        } else if (this.icon.x + this.icon.width >= this.monitor.width - EPSILON) {
            this.iconPosition = St.Side.RIGHT;
            this.icon.x = this.iconMonitor.x + this.iconMonitor.width - this.monitor.x;
            this.icon.width = 0;
        } else {
            this.iconPosition = St.Side.TOP;
            this.icon.y = this.iconMonitor.y - this.monitor.y;
            this.icon.height = 0;
        }

        this.set_n_tiles(X_TILES, Y_TILES);

        this.timeline = new Clutter.Timeline({
            actor: this.actor,
            duration: DURATION_MS + (this.monitor.width * this.monitor.height) / (this.window.width * this.window.height),
        });
        this.newFrameId = this.timeline.connect('new-frame', this._onNewFrame.bind(this));
        this.completedId = this.timeline.connect('completed', () => this.destroy());
        this.timeline.start();

        // Only now may vfunc_deform_vertex collapse the window into the icon.
        this.initialized = true;
    }

    destroy() {
        if (this.timeline) {
            this.timeline.disconnect(this.newFrameId);
            this.timeline.disconnect(this.completedId);
            this.timeline.stop();
            this.timeline = null;
        }

        this.actor?.remove_effect(this);
    }

    _onNewFrame(timeline) {
        if (!this.actor)
            return;

        if (Main.overview.visible) {
            this.destroy();
            return;
        }

        const progress = timeline.get_progress();
        this.k = 1 - (progress > 1 - SPLIT ? (progress - (1 - SPLIT)) / SPLIT : 0);
        this.j = 1 - (progress <= 1 - SPLIT ? progress / (1 - SPLIT) : 1);

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
