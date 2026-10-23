// SPDX-License-Identifier: GPL-3.0-or-later
// Run from the repository root with: node --test
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {grabHoldsPointer, shellMajor, verticalBox} from '../shellCompat.js';

// Clutter.GrabState and Clutter.Orientation as GNOME 46-49 define them.
const GrabState = {NONE: 0, POINTER: 1, KEYBOARD: 2, ALL: 3};
const Orientation = {HORIZONTAL: 0, VERTICAL: 1};

test('the shell major version comes from Config.PACKAGE_VERSION', () => {
    assert.equal(shellMajor('46.0'), 46);
    assert.equal(shellMajor('50.1'), 50);
    assert.equal(shellMajor('51.alpha'), 51);
});

test('up to GNOME 49 a grab holds the pointer only when its seat state says so', () => {
    const grab = state => ({get_seat_state: () => state});
    assert.equal(grabHoldsPointer(grab(GrabState.ALL), GrabState), true);
    assert.equal(grabHoldsPointer(grab(GrabState.POINTER), GrabState), true);
    assert.equal(grabHoldsPointer(grab(GrabState.KEYBOARD), GrabState), false);
    assert.equal(grabHoldsPointer(grab(GrabState.NONE), GrabState), false);
});

test('from GNOME 50 a grab has no seat state and always holds the pointer', () => {
    // GNOME 50 removed both Clutter.Grab.get_seat_state() and Clutter.GrabState.
    assert.equal(grabHoldsPointer({}, undefined), true);
});

test('vertical boxes use orientation from GNOME 48 and vertical before it', () => {
    assert.deepEqual(verticalBox(46, Orientation), {vertical: true});
    assert.deepEqual(verticalBox(47, Orientation), {vertical: true});
    for (const major of [48, 49, 50, 51])
        assert.deepEqual(verticalBox(major, Orientation), {orientation: Orientation.VERTICAL});
});
