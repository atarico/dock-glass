// SPDX-License-Identifier: GPL-3.0-or-later
// Run from the repository root with: node --test
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {SPLIT, dockDepth, pourStage} from '../genieGeometry.js';

const MONITOR = {x: 0, y: 0, width: 1920, height: 1080};
// Ubuntu Dock's pill at the bottom, 8px above the screen edge.
const BOTTOM_DOCK = {x: 600, y: 1000, width: 700, height: 72};

function assertStage(actual, expected) {
    assert.ok(Math.abs(actual.k - expected.k) < 1e-9, `k ${actual.k} != ${expected.k}`);
    assert.ok(Math.abs(actual.j - expected.j) < 1e-9, `j ${actual.j} != ${expected.j}`);
}

test('the window starts collapsed into the icon and ends at full size', () => {
    assertStage(pourStage(0), {k: 1, j: 1});
    assertStage(pourStage(1), {k: 0, j: 0});
});

test('the window first stretches out of the icon, then widens to its size', () => {
    assertStage(pourStage((1 - SPLIT) / 2), {k: 1, j: 0.5});
    assertStage(pourStage(1 - SPLIT), {k: 1, j: 0});
    assertStage(pourStage(1 - SPLIT / 2), {k: 0.5, j: 0});
});

test('minimizing runs the stages backwards, as Magic Lamp minimizes', () => {
    for (let step = 0; step <= 20; step++) {
        const progress = step / 20;
        assertStage(pourStage(1 - progress), {
            k: progress <= SPLIT ? progress / SPLIT : 1,
            j: progress > SPLIT ? (progress - SPLIT) / (1 - SPLIT) : 0,
        });
    }
});

test('a bottom dock reaches in from the screen bottom to the top of its pill', () => {
    assert.equal(dockDepth('bottom', BOTTOM_DOCK, MONITOR), 80);
});

test('a dock on a second monitor is measured from that monitor', () => {
    const monitor = {x: 1920, y: 0, width: 1280, height: 800};
    assert.equal(dockDepth('bottom', {x: 2200, y: 730, width: 600, height: 64}, monitor), 70);
    assert.equal(dockDepth('bottom', BOTTOM_DOCK, monitor), 0);
});

test('side and top docks reach in to their inner edge', () => {
    assert.equal(dockDepth('left', {x: 0, y: 200, width: 72, height: 600}, MONITOR), 72);
    assert.equal(dockDepth('right', {x: 1848, y: 200, width: 72, height: 600}, MONITOR), 72);
    assert.equal(dockDepth('top', {x: 600, y: 0, width: 700, height: 60}, MONITOR), 60);
});

test('a hidden dock or no dock leaves the genie on the screen edge', () => {
    assert.equal(dockDepth('bottom', {...BOTTOM_DOCK, y: 1080}, MONITOR), 0);
    assert.equal(dockDepth('bottom', {...BOTTOM_DOCK, y: 1150}, MONITOR), 0);
    assert.equal(dockDepth('bottom', null, MONITOR), 0);
});

test('a dock that is not on that edge of the screen is ignored', () => {
    assert.equal(dockDepth('bottom', {x: 600, y: 0, width: 700, height: 60}, MONITOR), 0);
    assert.equal(dockDepth('left', BOTTOM_DOCK, MONITOR), 0);
});
