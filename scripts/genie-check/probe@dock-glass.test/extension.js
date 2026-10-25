// SPDX-License-Identifier: GPL-3.0-or-later
// Probe for scripts/genie-check: drives real GTK windows through the genie on
// open, minimize and restore, and reports DGPROBE PASS/FAIL lines in the
// shell log. Every minimize and restore must reach the window manager
// exactly once: counters installed innermost on its completed_minimize and
// completed_unminimize (below Dock Glass and Magic Lamp) are compared with
// the minimize and unminimize signals mutter emitted for each window.
// mutter emits those signals after minimize() returns, so effects are
// checked a few frames later.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DG = 'dock-glass@atarico.github.io';
const ML = 'compiz-alike-magic-lamp-effect@hermes83.github.com';
const ANIM_MS = 1800;
const X11 = 'org.dockglass.ProbeX11.desktop';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
const log = (...args) => console.log('DGPROBE', ...args);
const genie = actor => actor.get_effects().find(e => /Genie/.test(e.constructor.name)) ?? null;
const lamp = actor => actor.get_effects().find(e => /MagicLamp/.test(e.constructor.name)) ?? null;
const names = actor => actor.get_effects().map(e => e.constructor.name).join(',') || 'none';
let failures = 0;
function check(name, ok, detail = '') {
    if (!ok)
        failures++;
    log(ok ? 'PASS' : 'FAIL', name, detail);
}

// Per actor: minimize/unminimize started by mutter, and completions that
// reached the window manager.
const counts = new Map();
function tally(actor) {
    let entry = counts.get(actor);
    if (!entry)
        counts.set(actor, entry = {ms: 0, md: 0, us: 0, ud: 0});
    return entry;
}

function installCounters() {
    const shellwm = global.window_manager;
    shellwm.connect('minimize', (_wm, actor) => tally(actor).ms++);
    shellwm.connect('unminimize', (_wm, actor) => tally(actor).us++);
    const minimizeDone = shellwm.completed_minimize;
    shellwm.completed_minimize = function (actor) {
        tally(actor).md++;
        return minimizeDone.call(shellwm, actor);
    };
    const unminimizeDone = shellwm.completed_unminimize;
    shellwm.completed_unminimize = function (actor) {
        tally(actor).ud++;
        return unminimizeDone.call(shellwm, actor);
    };
}

function balanced(name, actor) {
    const entry = tally(actor);
    check(`${name}: completed once`, entry.ms === entry.md && entry.us === entry.ud, JSON.stringify(entry));
}

function settled(name, actor, minimized) {
    const win = actor.meta_window;
    const ok = win.minimized === minimized && actor.visible === !minimized &&
        !genie(actor) && !lamp(actor);
    check(`${name}: ${minimized ? 'hidden' : 'shown'}`, ok,
        `minimized=${win.minimized} visible=${actor.visible} effects=${names(actor)}`);
    balanced(name, actor);
}

// Where the narrow end lands (k = 1), from the effect's own deform function.
function tipOf(actor, effect, tx, ty) {
    const saved = [effect.k, effect.j];
    [effect.k, effect.j] = [1, 0.5];
    const vertex = {tx, ty, x: 0, y: 0};
    const [width, height] = actor.get_size();
    effect.vfunc_deform_vertex(width, height, vertex);
    [effect.k, effect.j] = saved;
    return [actor.get_x() + vertex.x, actor.get_y() + vertex.y];
}

function bottomEdge(actor, effect) {
    if (!effect)
        return [false, 'no genie'];
    const monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
    const depth = effect.dock ? monitor.y + monitor.height - effect.dock.y : 0;
    const [, tip] = tipOf(actor, effect, 0.5, 1);
    const ok = effect.iconPosition === St.Side.BOTTOM && depth > 0 && depth < 200 &&
        effect.icon.height === depth && Math.abs(tip - effect.dock.y) < 1;
    return [ok, JSON.stringify({pos: effect.iconPosition, icon: effect.icon, dock: effect.dock, depth, tip})];
}

function leftEdge(actor, effect) {
    if (!effect)
        return [false, 'no genie'];
    const monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
    const depth = effect.dock ? effect.dock.x + effect.dock.width - monitor.x : 0;
    const [tip] = tipOf(actor, effect, 0, 0.5);
    const ok = effect.iconPosition === St.Side.LEFT && depth > 0 && depth < 200 &&
        effect.icon.width === depth && Math.abs(tip - (monitor.x + depth)) < 1;
    return [ok, JSON.stringify({pos: effect.iconPosition, icon: effect.icon, dock: effect.dock, depth, tip})];
}

// The next normal window that maps once the app opens one, or null after
// eight seconds.
function openWindow(appId = 'org.dockglass.Probe.desktop') {
    const app = Shell.AppSystem.get_default().lookup_app(appId);
    return new Promise(resolve => {
        let id = global.window_manager.connect('map', (_wm, actor) => {
            if (actor.meta_window?.get_window_type() !== Meta.WindowType.NORMAL)
                return;
            global.window_manager.disconnect(id);
            id = 0;
            resolve(actor);
        });
        wait(8000).then(() => {
            if (!id)
                return;
            global.window_manager.disconnect(id);
            resolve(null);
        });
        app.open_new_window(-1);
    });
}

// Milliseconds until done() holds, checked every frame or so, or null after
// limit milliseconds.
async function msUntil(done, limit) {
    const start = GLib.get_monotonic_time();
    while (!done()) {
        if (GLib.get_monotonic_time() - start > limit * 1000)
            return null;
        await wait(10);
    }
    return (GLib.get_monotonic_time() - start) / 1000;
}

async function setExtension(uuid, on, ms = 1000) {
    if (on)
        Main.extensionManager.enableExtension(uuid);
    else
        Main.extensionManager.disableExtension(uuid);
    await wait(ms);
}

function watchDestroy(actor) {
    const state = {gone: false};
    actor.connect('destroy', () => {
        state.gone = true;
    });
    return state;
}

// The genie's wait and timeline, as plain data.
function state(effect) {
    if (!effect)
        return {effect: 'none'};
    return {
        repaintId: Boolean(effect._repaintId),
        waitId: Boolean(effect._waitId),
        timeline: effect.timeline === null ? 'null' : effect.timeline?.is_playing() ? 'playing' : 'stopped',
        actor: effect.actor ? 'set' : 'null',
    };
}
const isWaiting = effect => Boolean(effect?._repaintId) && Boolean(effect?._waitId) &&
    Boolean(effect.timeline) && !effect.timeline.is_playing();
const isDead = effect => Boolean(effect) && effect.timeline === null && !effect._repaintId && !effect._waitId;

async function closeWindow(actor) {
    if (!actor)
        return;
    const gone = watchDestroy(actor);
    actor.meta_window.delete(global.get_current_time());
    await msUntil(() => gone.gone, 4000);
}

// How many frames the stage updates over ms milliseconds: about none while
// nothing animates.
async function frames(ms) {
    let count = 0;
    const id = global.stage.connect('before-update', () => count++);
    await wait(ms);
    global.stage.disconnect(id);
    return count;
}

// A window closed during a workspace switch loses its actor with no
// kill-window-effects or destroy signal; its genie must still end instead
// of driving the frame clock until the next garbage collection.
async function workspaceClose(label, appId) {
    const workspaces = global.workspace_manager;
    if (workspaces.get_n_workspaces() < 2)
        workspaces.append_new_workspace(false, global.get_current_time());
    const actor = await openWindow(appId);
    if (!actor) {
        check(`${label}: the window maps`, false);
        return;
    }
    const effect = genie(actor);
    const ref = effect ? new WeakRef(effect) : null;
    const gone = watchDestroy(actor);
    workspaces.get_workspace_by_index(1).activate(global.get_current_time());
    await wait(30);
    actor.meta_window.delete(global.get_current_time());
    await wait(3000);
    const left = ref?.deref();
    const after = left ? {alive: true, ...state(left)} : {alive: false};
    const framesAfter = await frames(2000);
    check(`${label}: the genie ends`, Boolean(ref) && gone.gone && (!after.alive || after.timeline === 'null'),
        JSON.stringify({gone: gone.gone, after, framesAfter}));
    workspaces.get_workspace_by_index(0).activate(global.get_current_time());
    await wait(1500);
}

async function run() {
    await wait(4000);
    Main.overview.hide();
    await wait(1500);
    log('overview visible after hide:', Main.overview.visible);

    // Put the counters innermost: under Dock Glass and any Magic Lamp.
    await setExtension(DG, false);
    installCounters();
    await setExtension(DG, true, 2000);

    // --- Open, minimize, restore (S1, S2).
    const a1 = await openWindow();
    const w1 = a1.meta_window;
    check('open: genie ends at the pill top', ...bottomEdge(a1, genie(a1)));
    await wait(ANIM_MS);
    settled('open a1', a1, false);
    w1.minimize();
    await wait(80);
    check('minimize: genie ends at the pill top', ...bottomEdge(a1, genie(a1)));
    await wait(ANIM_MS);
    settled('minimize', a1, true);
    w1.unminimize();
    await wait(80);
    check('restore: genie ends at the pill top', ...bottomEdge(a1, genie(a1)));
    await wait(ANIM_MS);
    settled('restore', a1, false);

    // --- An X11 window maps before its app has drawn it: the open genie
    // waits inside the icon for the first repaint (well before its 1.5 s
    // limit), then plays.
    const ax = await openWindow(X11);
    check('X11 open: the window maps', Boolean(ax));
    if (ax) {
        const waiting = genie(ax);
        check('X11 open: the genie waits for the first drawing',
            ax.meta_window.get_client_type() === Meta.WindowClientType.X11 && Boolean(waiting?._repaintId) &&
            !waiting.timeline?.is_playing(), names(ax));
        const ms = await msUntil(() => !genie(ax), 3000);
        check('X11 open: started by the drawing, then done', ms !== null && ms < 1200 && ax.visible,
            `ms=${ms} visible=${ax.visible}`);
        const goneX = watchDestroy(ax);
        ax.meta_window.delete(global.get_current_time());
        await wait(ANIM_MS);
        check('X11 open: window closed', goneX.gone);
    }

    // --- An X11 window closed while its genie waits.
    const x2 = await openWindow(X11);
    const e2 = genie(x2);
    const waiting2 = isWaiting(e2);
    const gone2x = watchDestroy(x2);
    x2.meta_window.delete(global.get_current_time());
    await wait(2500);
    check('X11 closed while its genie waits: genie dropped, waits cleared', gone2x.gone && isDead(e2),
        `waitingAtClose=${waiting2} ${JSON.stringify(state(e2))}`);

    // --- The overview opens while an X11 genie waits.
    const x4 = await openWindow(X11);
    const e4 = genie(x4);
    const waiting4 = isWaiting(e4);
    Main.overview.show();
    const dropped4 = await msUntil(() => isDead(e4), 3000);
    check('overview while an X11 genie waits: genie dropped', dropped4 !== null && !genie(x4),
        `waitingAtShow=${waiting4} ms=${dropped4} ${JSON.stringify(state(e4))}`);
    await wait(1000);
    Main.overview.hide();
    await wait(1500);
    check('overview closed: the X11 window is shown', x4.visible && !genie(x4) && !x4.meta_window.minimized, names(x4));

    // --- An X11 window minimized right after mapping, while its genie waits.
    const x5 = await openWindow(X11);
    const e5 = genie(x5);
    const waiting5 = isWaiting(e5);
    x5.meta_window.minimize();
    await wait(80);
    const m5 = genie(x5);
    check('minimize while an X11 genie waits: map genie dropped, minimize genie plays',
        isDead(e5) && Boolean(m5?.minimize) && m5 !== e5, `waitingAtMinimize=${waiting5} map=${JSON.stringify(state(e5))} now=${names(x5)}`);
    await wait(ANIM_MS);
    settled('X11 minimized while its genie waited', x5, true);
    x5.meta_window.unminimize();
    await wait(ANIM_MS);
    settled('X11 restored', x5, false);
    await closeWindow(x5);
    await closeWindow(x4);

    // --- The Files stack's launch hold ends once, after the X11 window's
    // genie, and once when that window closes while its genie waits.
    let dockGlass = Main.extensionManager.lookup(DG).stateObj;
    let released = 0;
    let effectsAtRelease = null;
    let x7 = null;
    dockGlass._holdDockForLaunch(() => {
        released++;
        effectsAtRelease = x7 ? names(x7) : 'not mapped';
    });
    x7 = await openWindow(X11);
    const waiting7 = isWaiting(genie(x7));
    const released7 = await msUntil(() => released > 0, 4000);
    await wait(3500);
    check('launch hold, X11 window: released once, after its genie', released === 1 && effectsAtRelease === 'none',
        `waitingAtMap=${waiting7} msAfterMap=${released7} released=${released} effectsAtRelease=${effectsAtRelease}`);
    released = 0;
    dockGlass._holdDockForLaunch(() => released++);
    const x7b = await openWindow(X11);
    const e7b = genie(x7b);
    const waiting7b = isWaiting(e7b);
    x7b.meta_window.delete(global.get_current_time());
    await msUntil(() => released > 0, 4000);
    await wait(3500);
    check('launch hold, X11 window closed while waiting: released once, genie dropped', released === 1 && isDead(e7b),
        `waitingAtClose=${waiting7b} released=${released} ${JSON.stringify(state(e7b))}`);
    await closeWindow(x7);

    // --- Dock Glass disabled while an X11 genie waits: dropped, window
    // shown, whenOpened called once.
    const x3 = await openWindow(X11);
    const e3 = genie(x3);
    const waiting3 = isWaiting(e3);
    let opened3 = 0;
    dockGlass._genieAnimation.whenOpened(x3, () => opened3++);
    Main.extensionManager.disableExtension(DG);
    await wait(300);
    check('Dock Glass disabled while an X11 genie waits: dropped, window shown, whenOpened once',
        isDead(e3) && !genie(x3) && x3.visible && opened3 === 1, `waitingAtDisable=${waiting3} calls=${opened3} ${JSON.stringify(state(e3))}`);
    await wait(2000);
    check('Dock Glass disabled while waiting, 2 s later: whenOpened still once', opened3 === 1 && !genie(x3), `calls=${opened3}`);
    await setExtension(DG, true, 2000);
    dockGlass = Main.extensionManager.lookup(DG).stateObj;
    await closeWindow(x3);

    // --- Windows closed during a workspace switch mid-genie (Wayland) and
    // while the genie waits (X11).
    await workspaceClose('Wayland window closed during a workspace switch mid-genie');
    await workspaceClose('X11 window closed during a workspace switch while its genie waits', X11);

    // --- The compositor stalls 300 ms mid-minimize: the genie slows down
    // instead of skipping, and the minimize still completes once.
    w1.minimize();
    await wait(100);
    const stalled = genie(a1);
    GLib.usleep(300000);
    const afterStall = await msUntil(() => !genie(a1), 3000);
    check('stall mid-minimize: the genie goes on after the stall', Boolean(stalled?.minimize) && afterStall !== null && afterStall > 150,
        `msAfterStall=${afterStall}`);
    await wait(ANIM_MS);
    settled('stall mid-minimize', a1, true);
    w1.unminimize();
    await wait(ANIM_MS);
    settled('restore after the stall', a1, false);

    // --- A restore that interrupts a minimize, and the reverse.
    w1.minimize();
    await wait(100);
    w1.unminimize();
    await wait(ANIM_MS);
    settled('restore interrupting a minimize', a1, false);
    w1.minimize();
    await wait(ANIM_MS);
    w1.unminimize();
    await wait(100);
    w1.minimize();
    await wait(ANIM_MS);
    settled('minimize interrupting a restore', a1, true);
    w1.unminimize();
    await wait(ANIM_MS);
    settled('restore after the interruptions', a1, false);

    // --- Overview shown mid-minimize and mid-restore.
    w1.minimize();
    await wait(150);
    check('overview mid-minimize: genie running', Boolean(genie(a1)?.minimize), names(a1));
    Main.overview.show();
    await wait(ANIM_MS);
    settled('overview mid-minimize', a1, true);
    Main.overview.hide();
    await wait(1500);
    settled('overview mid-minimize, overview closed', a1, true);

    w1.unminimize();
    await wait(150);
    check('overview mid-restore: genie running', Boolean(genie(a1)) && !genie(a1).minimize, names(a1));
    Main.overview.show();
    await wait(ANIM_MS);
    settled('overview mid-restore', a1, false);
    Main.overview.hide();
    await wait(1500);
    settled('overview mid-restore, overview closed', a1, false);

    // --- Minimize and restore while the overview is visible: GNOME's path.
    Main.overview.show();
    await wait(1500);
    w1.minimize();
    await wait(80);
    check('minimize in overview: no genie', !genie(a1), names(a1));
    await wait(ANIM_MS);
    settled('minimize in overview', a1, true);
    w1.unminimize();
    await wait(ANIM_MS);
    settled('restore in overview', a1, false);
    Main.overview.hide();
    await wait(1500);

    // --- Two windows at once.
    const a2 = await openWindow();
    const w2 = a2.meta_window;
    await wait(ANIM_MS);
    w1.minimize();
    w2.minimize();
    await wait(80);
    check('two minimizes: both genies', Boolean(genie(a1)?.minimize) && Boolean(genie(a2)?.minimize),
        `${names(a1)} / ${names(a2)}`);
    await wait(ANIM_MS);
    settled('two minimizes a1', a1, true);
    settled('two minimizes a2', a2, true);
    w1.unminimize();
    w2.unminimize();
    await wait(80);
    check('two restores: both genies', Boolean(genie(a1)) && Boolean(genie(a2)), `${names(a1)} / ${names(a2)}`);
    await wait(ANIM_MS);
    settled('two restores a1', a1, false);
    settled('two restores a2', a2, false);

    // --- Minimize while the open genie still runs.
    const a3 = await openWindow();
    const w3 = a3.meta_window;
    check('open a3: open genie running', Boolean(genie(a3)) && !genie(a3).minimize, names(a3));
    await wait(150);
    w3.minimize();
    await wait(80);
    check('minimize mid-open: minimize genie', Boolean(genie(a3)?.minimize), names(a3));
    await wait(ANIM_MS);
    settled('minimize mid-open', a3, true);
    w3.unminimize();
    await wait(ANIM_MS);
    settled('restore after minimize mid-open', a3, false);

    // --- Restore of a window minimized while Dock Glass was off.
    await setExtension(DG, false);
    w2.minimize();
    await wait(ANIM_MS);
    settled('minimized with Dock Glass off', a2, true);
    await setExtension(DG, true, 2000);
    w2.unminimize();
    await wait(80);
    check('restore of a window minimized before enable: genie', Boolean(genie(a2)) && !genie(a2).minimize, names(a2));
    await wait(ANIM_MS);
    settled('restore of a window minimized before enable', a2, false);

    // --- Minimized under Magic Lamp, restored after it is off (lamp after DG).
    await setExtension(ML, true);
    w1.minimize();
    await wait(80);
    check('lamp on: minimize by Magic Lamp only', Boolean(lamp(a1)) && !genie(a1), names(a1));
    await wait(ANIM_MS);
    settled('minimized by Magic Lamp', a1, true);
    await setExtension(ML, false);
    w1.unminimize();
    await wait(80);
    check('lamp off: restore by Dock Glass', Boolean(genie(a1)) && !genie(a1).minimize, names(a1));
    await wait(ANIM_MS);
    settled('restored by Dock Glass after lamp off', a1, false);

    // --- Minimized by Dock Glass, restored under Magic Lamp.
    w1.minimize();
    await wait(ANIM_MS);
    settled('minimized by Dock Glass', a1, true);
    await setExtension(ML, true);
    w1.unminimize();
    await wait(80);
    check('lamp on: restore by Magic Lamp only', Boolean(lamp(a1)) && !genie(a1), names(a1));
    await wait(ANIM_MS);
    settled('restored by Magic Lamp', a1, false);
    await setExtension(ML, false);

    // --- Magic Lamp enabled mid-genie (minimize, then restore).
    w1.minimize();
    await wait(100);
    check('lamp enabled mid-genie minimize: genie before', Boolean(genie(a1)?.minimize), names(a1));
    Main.extensionManager.enableExtension(ML);
    await wait(ANIM_MS);
    settled('lamp enabled mid-genie minimize', a1, true);
    w1.unminimize();
    await wait(80);
    log('restore after lamp enabled mid-genie: effects', names(a1));
    await wait(ANIM_MS);
    settled('restore after lamp enabled mid-genie', a1, false);
    await setExtension(ML, false);
    w1.minimize();
    await wait(ANIM_MS);
    w1.unminimize();
    await wait(100);
    check('lamp enabled mid-genie restore: genie before', Boolean(genie(a1)) && !genie(a1).minimize, names(a1));
    Main.extensionManager.enableExtension(ML);
    await wait(ANIM_MS);
    settled('lamp enabled mid-genie restore', a1, false);
    await setExtension(ML, false);

    // --- Magic Lamp disabled mid-lamp, lamp enabled after Dock Glass.
    await setExtension(ML, true);
    w1.minimize();
    await wait(100);
    check('lamp after DG, disabled mid-lamp: lamp before', Boolean(lamp(a1)) && !genie(a1), names(a1));
    Main.extensionManager.disableExtension(ML);
    await wait(ANIM_MS);
    settled('lamp after DG, disabled mid-lamp minimize', a1, true);
    w1.unminimize();
    await wait(80);
    check('lamp after DG, then off: restore by Dock Glass', Boolean(genie(a1)), names(a1));
    await wait(ANIM_MS);
    settled('lamp after DG, then off: restore', a1, false);

    // --- Magic Lamp disabled mid-lamp, lamp enabled before Dock Glass
    // (disabling it rebases Dock Glass: disable, then enable).
    await setExtension(ML, true);
    await setExtension(DG, false);
    await setExtension(DG, true, 2000);
    w1.minimize();
    await wait(100);
    check('lamp before DG, disabled mid-lamp: lamp before', Boolean(lamp(a1)) && !genie(a1), names(a1));
    Main.extensionManager.disableExtension(ML);
    await wait(ANIM_MS);
    settled('lamp before DG, disabled mid-lamp minimize', a1, true);
    w1.unminimize();
    await wait(80);
    check('lamp before DG, then off: restore by Dock Glass', Boolean(genie(a1)), names(a1));
    await wait(ANIM_MS);
    settled('lamp before DG, then off: restore', a1, false);

    await setExtension(ML, true);
    await setExtension(DG, false);
    await setExtension(DG, true, 2000);
    w1.minimize();
    await wait(ANIM_MS);
    settled('lamp before DG: minimized by lamp', a1, true);
    w1.unminimize();
    await wait(100);
    check('lamp before DG, disabled mid-lamp restore: lamp before', Boolean(lamp(a1)) && !genie(a1), names(a1));
    Main.extensionManager.disableExtension(ML);
    await wait(ANIM_MS);
    settled('lamp before DG, disabled mid-lamp restore', a1, false);

    // --- Dock Glass disabled mid-restore.
    w1.minimize();
    await wait(ANIM_MS);
    w1.unminimize();
    await wait(100);
    check('disable mid-restore: genie before', Boolean(genie(a1)) && !genie(a1).minimize, names(a1));
    await setExtension(DG, false);
    settled('disable mid-restore', a1, false);
    await setExtension(DG, true, 2000);

    // --- Dock Glass disabled while a lamp minimize runs (lamp after DG,
    // so the rebase disables and re-enables Magic Lamp).
    await setExtension(ML, true);
    w1.minimize();
    await wait(100);
    check('DG disabled mid-lamp: lamp before', Boolean(lamp(a1)) && !genie(a1), names(a1));
    await setExtension(DG, false);
    settled('DG disabled mid-lamp minimize', a1, true);
    await setExtension(DG, true, 2000);
    w1.unminimize();
    await wait(80);
    check('lamp before DG: restore by lamp only', Boolean(lamp(a1)) && !genie(a1), names(a1));
    await wait(ANIM_MS);
    settled('lamp before DG: restore', a1, false);
    await setExtension(ML, false, 2000);
    w1.minimize();
    await wait(80);
    check('lamp removed again: minimize by Dock Glass', Boolean(genie(a1)?.minimize), names(a1));
    await wait(ANIM_MS);
    settled('lamp removed again: minimize', a1, true);
    w1.unminimize();
    await wait(ANIM_MS);
    settled('lamp removed again: restore', a1, false);

    // --- The window cycler (Alt+Esc) asks GNOME to skip the effect of the
    // minimized window it restores; the skip must be consumed, not left to
    // eat the window's next animation.
    w1.minimize();
    await wait(ANIM_MS);
    Main.wm.skipNextEffect(a1);
    w1.unminimize();
    await wait(80);
    const gnomeTransition = Boolean(a1.get_transition('scale-x'));
    log('window cycler restore: effects', names(a1), 'gnome transition', gnomeTransition,
        'skip still pending', Main.wm._skippedActors.has(a1));
    check('window cycler restore: skip consumed', !Main.wm._skippedActors.has(a1));
    check('window cycler restore: no animation, as GNOME asks', !genie(a1) && !gnomeTransition, names(a1));
    await wait(ANIM_MS);
    settled('window cycler restore', a1, false);
    Main.wm._skippedActors.delete(a1);

    // --- Effect setup failure (window size reads as 0 while the genie sets up).
    a2.get_size = () => [0, 0];
    w2.minimize();
    await wait(80);
    delete a2.get_size;
    check('setup failure minimize: no genie left', !genie(a2), names(a2));
    await wait(ANIM_MS);
    settled('setup failure minimize', a2, true);
    a2.get_size = () => [0, 0];
    w2.unminimize();
    await wait(80);
    delete a2.get_size;
    await wait(ANIM_MS);
    settled('setup failure restore', a2, false);

    // --- Side dock (S1/S2 no regression): LEFT.
    const dtd = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.dash-to-dock'});
    dtd.set_string('dock-position', 'LEFT');
    await wait(3500);
    w1.minimize();
    await wait(80);
    check('left dock: minimize genie ends at the pill edge', ...leftEdge(a1, genie(a1)));
    await wait(ANIM_MS);
    settled('left dock: minimize', a1, true);
    w1.unminimize();
    await wait(80);
    check('left dock: restore genie ends at the pill edge', ...leftEdge(a1, genie(a1)));
    await wait(ANIM_MS);
    settled('left dock: restore', a1, false);
    const a4 = await openWindow();
    check('left dock: open genie ends at the pill edge', ...leftEdge(a4, genie(a4)));
    await wait(ANIM_MS);
    settled('left dock: open a4', a4, false);
    dtd.set_string('dock-position', 'BOTTOM');
    await wait(3500);

    // --- Hidden dock: intellihide with a window over the dock.
    dtd.set_boolean('dock-fixed', false);
    dtd.set_boolean('intellihide', true);
    await wait(1500);
    try {
        w1.move_resize_frame(false, 0, 200, 1920, 880);
    } catch (e) {
        log('move_resize_frame failed', String(e));
    }
    await wait(3000);
    w1.minimize();
    await wait(80);
    const hidden = genie(a1);
    const monitor = Main.layoutManager.monitors[w1.get_monitor()];
    const dockHidden = hidden?.dock ? hidden.dock.y >= monitor.y + monitor.height - 1 : null;
    log('hidden dock: effect', JSON.stringify({icon: hidden?.icon, dock: hidden?.dock, dockHidden}));
    if (dockHidden)
        check('hidden dock: genie ends at the screen edge', hidden.icon.height === 0, JSON.stringify(hidden.icon));
    else
        log('hidden dock: INCONCLUSIVE, the dock did not hide');
    await wait(ANIM_MS);
    settled('hidden dock: minimize', a1, true);
    w1.unminimize();
    await wait(ANIM_MS);
    settled('hidden dock: restore', a1, false);
    dtd.set_boolean('dock-fixed', true);
    await wait(1500);

    // --- Closed mid-restore and mid-minimize.
    w2.minimize();
    await wait(ANIM_MS);
    const gone2 = watchDestroy(a2);
    w2.unminimize();
    await wait(100);
    check('close mid-restore: genie before', Boolean(genie(a2)), names(a2));
    w2.delete(global.get_current_time());
    await wait(ANIM_MS);
    check('close mid-restore: actor gone', gone2.gone);
    balanced('close mid-restore', a2);

    const gone1 = watchDestroy(a1);
    w1.minimize();
    await wait(100);
    w1.delete(global.get_current_time());
    await wait(ANIM_MS);
    check('close mid-minimize: actor gone', gone1.gone);
    balanced('close mid-minimize', a1);

    // --- Injected fault: the genie's target lookup throws. The minimize it
    // holds must still complete, or the window would stay on screen.
    const gone3 = watchDestroy(a3);
    w3.get_icon_geometry = () => {
        throw new Error('injected');
    };
    w3.minimize();
    await wait(ANIM_MS);
    delete w3.get_icon_geometry;
    log('injected fault: state', `minimized=${w3.minimized} visible=${a3.visible}`, JSON.stringify(tally(a3)));
    check('injected fault: minimize still completes', tally(a3).ms === tally(a3).md, JSON.stringify(tally(a3)));
    w3.delete(global.get_current_time());
    await wait(ANIM_MS);
    check('injected fault: actor gone after close', gone3.gone);

    // --- Injected fault: a callback waiting on the genie throws. The ones
    // after it must still run, or a dock held for a launch would stay shown.
    a4.meta_window.minimize();
    await wait(80);
    const effect4 = genie(a4);
    let laterCallbackRan = false;
    effect4?.whenDone(() => {
        throw new Error('injected');
    });
    effect4?.whenDone(() => {
        laterCallbackRan = true;
    });
    await wait(ANIM_MS);
    check('throwing callback: genie before', Boolean(effect4), names(a4));
    check('throwing callback: later callback still runs', laterCallbackRan);
    settled('throwing callback: minimize', a4, true);
    a4.meta_window.unminimize();
    await wait(ANIM_MS);
    settled('throwing callback: restore', a4, false);

    const a4gone = watchDestroy(a4);
    a4.meta_window.delete(global.get_current_time());
    await wait(ANIM_MS);
    check('close a4: actor gone', a4gone.gone);

    log('DONE', failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
}

export default class Probe extends Extension {
    enable() {
        // Disabling Dock Glass disables and re-enables extensions enabled
        // after it, this one included: run only once.
        if (globalThis.dgProbeStarted)
            return;
        globalThis.dgProbeStarted = true;
        run().catch(e => log('CRASH', String(e), e.stack));
    }

    disable() {}
}
