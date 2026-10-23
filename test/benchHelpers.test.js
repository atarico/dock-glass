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

// What the benchmark saved before the run, and the lists as it leaves them:
// it toggled Dock Glass (disableExtension() also adds the uuid to
// disabled-extensions, which overrides enabled-extensions) and enabled itself.
const OTHER = 'other@example.com';

test('Dock Glass that was on comes back on, in its place in both lists', () => {
    const saved = {enabled: ['ubuntu-dock@ubuntu.com', DOCK_GLASS, OTHER, BENCH], disabled: []};
    const current = {enabled: ['ubuntu-dock@ubuntu.com', OTHER, BENCH], disabled: [DOCK_GLASS]};
    assert.deepEqual(restoredExtensionLists(saved, current, DOCK_GLASS, BENCH), {
        enabled: ['ubuntu-dock@ubuntu.com', DOCK_GLASS, OTHER],
        disabled: [],
    });
});

test('Dock Glass that was off stays off', () => {
    const saved = {enabled: ['ubuntu-dock@ubuntu.com', OTHER, BENCH], disabled: [DOCK_GLASS]};
    const current = {enabled: ['ubuntu-dock@ubuntu.com', OTHER, BENCH, DOCK_GLASS], disabled: []};
    assert.deepEqual(restoredExtensionLists(saved, current, DOCK_GLASS, BENCH), {
        enabled: ['ubuntu-dock@ubuntu.com', OTHER],
        disabled: [DOCK_GLASS],
    });
});

test('changes to other extensions during the run are kept', () => {
    const saved = {enabled: [DOCK_GLASS, OTHER, BENCH], disabled: []};
    // Meanwhile OTHER was turned off and a new one turned on.
    const current = {enabled: ['new@example.com', BENCH], disabled: [DOCK_GLASS, OTHER]};
    assert.deepEqual(restoredExtensionLists(saved, current, DOCK_GLASS, BENCH), {
        enabled: [DOCK_GLASS, 'new@example.com'],
        disabled: [OTHER],
    });
});

test('the benchmark leaves both lists, so it never runs again at login', () => {
    const saved = {enabled: [BENCH, DOCK_GLASS], disabled: []};
    const current = {enabled: [DOCK_GLASS], disabled: [BENCH]};
    const lists = restoredExtensionLists(saved, current, DOCK_GLASS, BENCH);
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
