// SPDX-License-Identifier: GPL-3.0-or-later
// Run from the repository root with: node --test
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {MAX_FAN_ITEMS, chooseView, fanSlots, gridLayout, staggerDelay} from '../stackLayout.js';

const FAN = {count: 6, step: 52, bend: 0.0009};

test('few items open as a fan, many as a grid, like macOS Automatic', () => {
    for (let count = 1; count <= MAX_FAN_ITEMS; count++)
        assert.equal(chooseView(count), 'fan');
    assert.equal(chooseView(MAX_FAN_ITEMS + 1), 'grid');
    assert.equal(chooseView(40), 'grid');
    // An empty folder still shows its open-in-Files entry, as a fan.
    assert.equal(chooseView(0), 'fan');
});

test('fan slots rise one step at a time from just above the dock icon', () => {
    const slots = fanSlots(FAN);
    assert.equal(slots.length, FAN.count);
    slots.forEach((slot, i) => assert.equal(slot.y, -(i + 1) * FAN.step));
});

test('the fan curves to the right more and more as it rises', () => {
    const slots = fanSlots(FAN);
    assert.equal(slots[0].x >= 0, true);
    for (let i = 1; i < slots.length; i++) {
        assert.ok(slots[i].x > slots[i - 1].x, `slot ${i} does not move right`);
        if (i >= 2) {
            const growth = slots[i].x - slots[i - 1].x;
            const before = slots[i - 1].x - slots[i - 2].x;
            assert.ok(growth > before, `slot ${i} does not bend further`);
        }
    }
});

test('the grid fills rows left to right with at most the given columns', () => {
    const grid = gridLayout({count: 11, columns: 4, cell: 96, padding: 16, maxRows: 4});
    assert.equal(grid.columns, 4);
    assert.equal(grid.rows, 3);
    assert.deepEqual(grid.positions[0], {x: 16, y: 16});
    assert.deepEqual(grid.positions[3], {x: 16 + 3 * 96, y: 16});
    assert.deepEqual(grid.positions[4], {x: 16, y: 16 + 96});
    assert.equal(grid.width, 2 * 16 + 4 * 96);
    assert.equal(grid.height, 2 * 16 + 3 * 96);
    assert.equal(grid.scrolls, false);
});

test('a small grid is only as wide as its items', () => {
    const grid = gridLayout({count: 2, columns: 4, cell: 96, padding: 16, maxRows: 4});
    assert.equal(grid.columns, 2);
    assert.equal(grid.width, 2 * 16 + 2 * 96);
});

test('a tall grid caps its height and scrolls', () => {
    const grid = gridLayout({count: 40, columns: 5, cell: 96, padding: 16, maxRows: 4});
    assert.equal(grid.rows, 8);
    assert.equal(grid.height, 2 * 16 + 4 * 96);
    assert.equal(grid.contentHeight, 2 * 16 + 8 * 96);
    assert.equal(grid.scrolls, true);
});

test('items nearest the dock start first and the whole stagger stays short', () => {
    const delays = Array.from({length: MAX_FAN_ITEMS}, (_, i) => staggerDelay(i, MAX_FAN_ITEMS, 120));
    assert.equal(delays[0], 0);
    for (let i = 1; i < delays.length; i++)
        assert.ok(delays[i] > delays[i - 1]);
    assert.ok(delays.at(-1) <= 120);
    assert.equal(staggerDelay(0, 1, 120), 0);
});
