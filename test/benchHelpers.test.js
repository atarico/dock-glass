// SPDX-License-Identifier: GPL-3.0-or-later
// Run from the repository root with: node --test
// Pins how the benchmark puts the session's extension lists back, where its
// virtual pointer sweeps, and when it calls the dock hidden.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {offMonitor, sweepX} from '../scripts/bench/dock-glass-bench@atarico.github.io/motion.js';
import {restoredExtensionLists} from '../scripts/bench/dock-glass-bench@atarico.github.io/session.js';

const BENCH = 'dock-glass-bench@atarico.github.io';
const DOCK_GLASS = 'dock-glass@atarico.github.io';

test('both extension lists come back as saved, so Dock Glass is on again', () => {
    // GNOME Shell's disableExtension() also adds the uuid to
    // disabled-extensions, which overrides enabled-extensions: restoring only
    // the enabled list left Dock Glass off after every run.
    assert.deepEqual(restoredExtensionLists({
        enabled: ['ubuntu-dock@ubuntu.com', DOCK_GLASS, 'other@example.com', BENCH],
        disabled: [],
    }, BENCH), {
        enabled: ['ubuntu-dock@ubuntu.com', DOCK_GLASS, 'other@example.com'],
        disabled: [],
    });
});

test('Dock Glass that was off before the run stays off', () => {
    assert.deepEqual(restoredExtensionLists({
        enabled: ['ubuntu-dock@ubuntu.com', 'other@example.com', BENCH],
        disabled: [DOCK_GLASS],
    }, BENCH), {
        enabled: ['ubuntu-dock@ubuntu.com', 'other@example.com'],
        disabled: [DOCK_GLASS],
    });
});

test('the benchmark leaves both lists, so it never runs again at login', () => {
    const lists = restoredExtensionLists({enabled: [BENCH, DOCK_GLASS], disabled: [BENCH]}, BENCH);
    assert.ok(!lists.enabled.includes(BENCH));
    assert.ok(!lists.disabled.includes(BENCH));
});

test('the sweep goes back and forth between the ends at a steady speed', () => {
    // 100 px between the ends at 50 px/s: 2 s each way.
    assert.equal(sweepX(10, 110, 50, 0), 10);
    assert.equal(sweepX(10, 110, 50, 1), 60);
    assert.equal(sweepX(10, 110, 50, 2), 110);
    assert.equal(sweepX(10, 110, 50, 3), 60);
    assert.equal(sweepX(10, 110, 50, 4), 10);
    assert.equal(sweepX(10, 110, 50, 5), 60);
    assert.equal(sweepX(10, 10, 50, 3), 10);
});

test('an icon is off the monitor past any of its edges', () => {
    const monitor = {x: 1920, y: 0, width: 1920, height: 1080};
    assert.equal(offMonitor([2880, 1040], monitor), false);
    assert.equal(offMonitor([2880, 1110], monitor), true);
    assert.equal(offMonitor([2880, -30], monitor), true);
    assert.equal(offMonitor([1890, 540], monitor), true);
    assert.equal(offMonitor([3870, 540], monitor), true);
});
