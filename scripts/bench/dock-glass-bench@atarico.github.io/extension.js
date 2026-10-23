// SPDX-License-Identifier: GPL-3.0-or-later
// Dock Glass benchmark. Enabling this extension runs it once: it turns Dock
// Glass off and on, drives a virtual pointer and keyboard over the dock on
// the primary monitor, and measures what gnome-shell spends in each
// scenario: CPU time (from /proc), painted frames and their paint time, and
// memory. It takes about seven minutes, must not be disturbed, and writes
// result.json and result.md (or error.txt) to ~/.cache/dock-glass-bench. Run
// it with scripts/bench/run.sh (this session) or scripts/bench/container.sh.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import System from 'system';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {offMonitor, sweepX} from './motion.js';
import {restoredExtensionLists} from './session.js';
import {cpuMsPerFrame, cpuPercent, cpuTicks, formatTable, percentile, rssKb, summarize} from './stats.js';

const DOCK_GLASS = 'dock-glass@atarico.github.io';
const FILES_APP_ID = 'org.gnome.Nautilus.desktop';
// ExtensionState's value for an extension that is enabled and running.
const STATE_ACTIVE = 1;

// Rounds per condition, alternating which goes first so drift spreads
// evenly; each scenario reports the median across rounds.
const ROUNDS = 3;
const IDLE_S = 20;
const SWEEP_S = 15;
const SWEEP_PX_PER_S = 800;
const WINDOWS_PER_ROUND = 4;
const WINDOW_HOLD_MS = 1500;
const STACKS_PER_ROUND = 4;
// After Dock Glass turns on or off the dock is rebuilt; let it settle.
const SETTLE_MS = 4000;
const STEP_MS = 16;
// How long to wait for Dock Glass to turn on or off and for the dock to
// come back, checking every POLL_MS.
const UNTIL_MS = 15000;
const POLL_MS = 250;

// Disabling Dock Glass makes GNOME Shell disable and enable again every
// extension enabled after it, this one included, so the run lives on
// globalThis: an enable while it runs does nothing, and only a real disable
// (the uuid leaves enabled-extensions) stops it.
const RUNNING = '__dockGlassBenchRunning';
const ABORTED = '__dockGlassBenchAborted';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

function readText(path) {
    const [, bytes] = GLib.file_get_contents(path);
    return new TextDecoder().decode(bytes);
}

function* walk(actor) {
    yield actor;
    for (const child of actor.get_children())
        yield* walk(child);
}

function center(actor) {
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    return [x + width / 2, y + height / 2];
}

const isActive = uuid => Main.extensionManager.lookup(uuid)?.state === STATE_ACTIVE;

// Writes one file of the result directory, which runners poll (run.sh and
// container/entrypoint.sh name the same directory).
function writeResult(name, text) {
    const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dock-glass-bench']);
    GLib.mkdir_with_parents(dir, 0o755);
    GLib.file_set_contents(`${dir}/${name}`, text);
    return `${dir}/${name}`;
}

export default class DockGlassBench extends Extension {
    enable() {
        if (globalThis[RUNNING])
            return;
        globalThis[RUNNING] = true;
        globalThis[ABORTED] = false;
        new Bench(this.uuid, this.path).run()
            .catch(e => {
                console.error(`DOCK-GLASS-BENCH FAIL ${e}\n${e.stack}`);
                writeResult('error.txt', `${e.message}\n`);
            })
            .finally(() => {
                globalThis[RUNNING] = false;
            });
    }

    disable() {
        if (!global.settings.get_strv('enabled-extensions').includes(this.uuid))
            globalThis[ABORTED] = true;
    }
}

class Bench {
    constructor(uuid, dir) {
        this._uuid = uuid;
        this._dir = dir;
        this._paints = null;
        this._paintStarts = new Map();
    }

    async run() {
        const saved = {
            enabled: global.settings.get_strv('enabled-extensions'),
            disabled: global.settings.get_strv('disabled-extensions'),
        };
        const backend = global.stage.context?.get_backend?.() ?? Clutter.get_default_backend();
        const seat = backend.get_default_seat();
        this._pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._connectPaints();
        try {
            await this._wait(3000);
            if (!Main.extensionManager.lookup(DOCK_GLASS))
                throw new Error('Dock Glass is not installed');
            if (!St.Settings.get().enable_animations)
                throw new Error('Animations are off, so Dock Glass would not animate');
            console.log('DOCK-GLASS-BENCH START');

            const phases = {with: [], without: []};
            for (let round = 0; round < ROUNDS; round++) {
                for (const on of round % 2 ? [false, true] : [true, false]) {
                    await this._setDockGlass(on);
                    console.log(`DOCK-GLASS-BENCH round ${round + 1}/${ROUNDS} ${on ? 'with' : 'without'}`);
                    phases[on ? 'with' : 'without'].push(await this._phase(on));
                }
            }
            this._write(this._result(phases));
        } finally {
            global.stage.disconnectObject(this);
            // Dock Glass back as it was in both lists, and this benchmark
            // off them (session.js). The disabled list goes first, so it
            // never overrides an entry the enabled list gets back.
            const current = {
                enabled: global.settings.get_strv('enabled-extensions'),
                disabled: global.settings.get_strv('disabled-extensions'),
            };
            const lists = restoredExtensionLists(saved, current, DOCK_GLASS, this._uuid);
            global.settings.set_strv('disabled-extensions', lists.disabled);
            global.settings.set_strv('enabled-extensions', lists.enabled);
        }
    }

    // Paint time is from the stage's before-paint to after-paint of a view:
    // the CPU side of a frame (all of it with software rendering).
    _connectPaints() {
        global.stage.connectObject(
            'before-paint', (_stage, view) => {
                if (this._paints)
                    this._paintStarts.set(view, GLib.get_monotonic_time());
            },
            'after-paint', (_stage, view) => {
                const start = this._paintStarts.get(view);
                if (!this._paints || start === undefined)
                    return;
                this._paintStarts.delete(view);
                if (!this._paints.has(view))
                    this._paints.set(view, []);
                this._paints.get(view).push((GLib.get_monotonic_time() - start) / 1000);
            },
            this);
    }

    // Checks for a stop every POLL_MS, so a long wait ends soon after one.
    async _wait(ms) {
        for (let left = ms; left > 0; left -= POLL_MS) {
            await wait(Math.min(left, POLL_MS));
            if (globalThis[ABORTED])
                throw new Error('Stopped: the benchmark was disabled');
        }
    }

    async _setDockGlass(on) {
        if (isActive(DOCK_GLASS) !== on) {
            if (on)
                Main.extensionManager.enableExtension(DOCK_GLASS);
            else
                Main.extensionManager.disableExtension(DOCK_GLASS);
        }
        await this._until(() => isActive(DOCK_GLASS) === on, `Dock Glass did not turn ${on ? 'on' : 'off'}`);
        await this._until(() => this._icons().length >= 2,
            'The dock did not come back, or it has fewer than two app icons');
        await this._wait(SETTLE_MS);
        const monitor = Main.layoutManager.primaryMonitor;
        if (this._icons().some(icon => offMonitor(center(icon), monitor))) {
            throw new Error('The dock is hidden. Show the desktop (Super+D) so no window covers it, ' +
                'then run the benchmark again');
        }
    }

    async _until(condition, message) {
        for (let waited = 0; waited < UNTIL_MS; waited += POLL_MS) {
            if (condition())
                return;
            await this._wait(POLL_MS);
        }
        throw new Error(message);
    }

    // The dock on the primary monitor (one per monitor with multi-monitor).
    _dock() {
        const monitor = Main.layoutManager.primaryMonitor;
        return [...walk(global.stage)].find(actor => {
            if (actor.name !== 'dashtodockContainer' || !actor.is_mapped())
                return false;
            const [x] = center(actor);
            return x >= monitor.x && x < monitor.x + monitor.width;
        }) ?? null;
    }

    _icons() {
        const dock = this._dock();
        if (!dock)
            return [];
        return [...walk(dock)].filter(actor => actor.app && actor.visible && actor.is_mapped())
            .sort((a, b) => center(a)[0] - center(b)[0]);
    }

    async _phase(on) {
        const idle = await this._idle();
        const sweep = await this._sweep();
        const windows = await this._windows();
        // Without Dock Glass the Files icon opens a window: no counterpart.
        const stack = on ? await this._stacks() : null;
        System.gc();
        await this._wait(2000);
        const rssMb = rssKb(readText('/proc/self/status')) / 1024;
        return {idle, sweep, windows, stack, rssMb};
    }

    // CPU, frames per second, CPU per frame and paint p95 while `action`
    // runs; frames are those of the view that painted the most (the dock's
    // monitor).
    async _measure(action) {
        this._paints = new Map();
        this._paintStarts.clear();
        const ticks = cpuTicks(readText('/proc/self/stat'));
        const start = GLib.get_monotonic_time();
        await action();
        const seconds = (GLib.get_monotonic_time() - start) / 1e6;
        const spent = cpuTicks(readText('/proc/self/stat')) - ticks;
        const durations = [...this._paints.values()].reduce((a, b) => b.length > a.length ? b : a, []);
        this._paints = null;
        return {
            cpu: cpuPercent(spent, seconds),
            fps: durations.length / seconds,
            cpuPerFrame: cpuMsPerFrame(spent, durations.length),
            paintP95: percentile(durations, 95),
        };
    }

    // Idle paints a frame now and then (the clock), so CPU per frame would
    // charge all the background work to those few frames: left out.
    async _idle() {
        await this._moveAway();
        await this._wait(2000);
        const result = await this._measure(() => this._wait(IDLE_S * 1000));
        return {...result, cpuPerFrame: NaN};
    }

    // Back and forth between the first and the last icon, at the icons'
    // height, at a steady speed.
    async _sweep() {
        const centers = this._icons().map(center);
        const [first, y] = centers[0];
        const [last] = centers[centers.length - 1];
        await this._moveTo(first, y);
        await this._wait(500);
        const result = await this._measure(async () => {
            const start = GLib.get_monotonic_time();
            for (let now = start; now < start + SWEEP_S * 1e6; now = GLib.get_monotonic_time()) {
                const x = sweepX(first, last, SWEEP_PX_PER_S, (now - start) / 1e6);
                this._pointer.notify_absolute_motion(now, x, y);
                await this._wait(STEP_MS);
            }
        });
        await this._moveAway();
        await this._wait(1000);
        return result;
    }

    async _windows() {
        await this._moveAway();
        await this._wait(1000);
        return this._measure(async () => {
            for (let i = 0; i < WINDOWS_PER_ROUND; i++) {
                await this._openWindow();
                await this._wait(500);
            }
        });
    }

    async _openWindow() {
        const process = Gio.Subprocess.new(
            ['gjs', '-m', `${this._dir}/window.js`, String(WINDOW_HOLD_MS)], Gio.SubprocessFlags.NONE);
        await new Promise((resolve, reject) => process.wait_async(null, (proc, res) => {
            try {
                proc.wait_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        }));
        if (!process.get_successful())
            throw new Error('The benchmark window could not open (gjs with GTK is needed)');
    }

    // Opens the Files stack from its icon and closes it with Escape. Needs
    // the Files icon on the dock and no Files window open.
    async _stacks() {
        const files = this._icons().find(icon => icon.app.get_id() === FILES_APP_ID);
        if (!files || files.app.get_n_windows() > 0) {
            console.log('DOCK-GLASS-BENCH stack skipped: no Files icon, or a Files window is open');
            return null;
        }
        const [x, y] = center(files);
        const result = await this._measure(async () => {
            for (let i = 0; i < STACKS_PER_ROUND; i++) {
                await this._moveTo(x, y);
                await this._wait(300);
                await this._click();
                await this._wait(1500);
                this._key(Clutter.KEY_Escape);
                await this._wait(1200);
            }
        });
        await this._moveAway();
        await this._wait(1000);
        return result;
    }

    _moveAway() {
        const monitor = Main.layoutManager.primaryMonitor;
        return this._moveTo(monitor.x + monitor.width / 2, monitor.y + monitor.height / 3);
    }

    async _moveTo(x, y) {
        const [fromX, fromY] = global.get_pointer();
        const steps = 15;
        for (let i = 1; i <= steps; i++) {
            this._pointer.notify_absolute_motion(GLib.get_monotonic_time(),
                fromX + (x - fromX) * i / steps, fromY + (y - fromY) * i / steps);
            await this._wait(STEP_MS);
        }
    }

    async _click() {
        this._pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        await this._wait(60);
        this._pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    }

    _key(keyval) {
        this._keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.PRESSED);
        this._keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.RELEASED);
    }

    _result(phases) {
        const scenarios = {};
        for (const key of ['idle', 'sweep', 'windows', 'stack']) {
            scenarios[key] = {
                without: summarize(phases.without.map(phase => phase[key]).filter(Boolean)),
                with: summarize(phases.with.map(phase => phase[key]).filter(Boolean)),
            };
        }
        const rss = {
            without: phases.without.map(phase => phase.rssMb),
            with: phases.with.map(phase => phase.rssMb),
        };
        return {
            shell: Config.PACKAGE_VERSION,
            date: new Date().toISOString(),
            monitors: Main.layoutManager.monitors.map(m => `${m.width}x${m.height}`),
            dockIcons: this._icons().length,
            method: {
                rounds: ROUNDS, idleSeconds: IDLE_S, sweepSeconds: SWEEP_S, sweepPxPerSecond: SWEEP_PX_PER_S,
                windowsPerRound: WINDOWS_PER_ROUND, windowHoldMs: WINDOW_HOLD_MS, stacksPerRound: STACKS_PER_ROUND,
            },
            scenarios,
            rssMb: rss,
            phases,
            table: formatTable(scenarios, rss),
        };
    }

    // result.md last: runners wait for it.
    _write(result) {
        const path = writeResult('result.json', `${JSON.stringify(result, null, 2)}\n`);
        writeResult('result.md', `${result.table}\n`);
        console.log(`DOCK-GLASS-BENCH DONE ${path}`);
    }
}
