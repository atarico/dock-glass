// SPDX-License-Identifier: GPL-3.0-or-later
// Run from the repository root with: node --test
// Pins how dockAdapter.js maps Ubuntu Dock's private internals, using plain
// objects shaped like Ubuntu Dock's.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
    DOCK_UUID, Dock, connectDockManager, getDockManager, getDocks, importDocking, isDockExtension,
} from '../dockAdapter.js';

function fakeDocked() {
    const menuCalls = [];
    const slider = {
        slideX: 1,
        relayouts: 0,
        handlers: [],
        queue_relayout() {
            this.relayouts++;
        },
        connectObject(signal, handler, owner) {
            this.handlers.push({signal, handler, owner});
        },
    };
    const dash = {
        _box: {name: 'items'},
        _boxContainer: {name: 'scroller'},
        _background: {name: 'background'},
        _separator: {name: 'separator'},
        _showAppsIcon: {toggleButton: {name: 'show-apps'}, icon: {name: 'show-apps-icon'}},
        _isHorizontal: true,
        _itemMenuStateChanged(item, open) {
            menuCalls.push([item, open]);
        },
    };
    return {docked: {_box: {name: 'frame'}, _slider: slider, dash}, slider, dash, menuCalls};
}

test('only Ubuntu Dock counts as the dock extension', () => {
    assert.equal(DOCK_UUID, 'ubuntu-dock@ubuntu.com');
    assert.equal(isDockExtension({uuid: DOCK_UUID}), true);
    assert.equal(isDockExtension({uuid: 'dock-glass@local'}), false);
});

test('importDocking loads the live docking.js from the Ubuntu Dock folder', async () => {
    const requested = [];
    const extensionManager = {
        lookup: uuid => uuid !== DOCK_UUID ? null : {
            dir: {
                get_child: name => {
                    requested.push(name);
                    return {get_uri: () => 'data:text/javascript,export const live = true;'};
                },
            },
        },
    };
    const docking = await importDocking(extensionManager);
    assert.deepEqual(requested, ['docking.js']);
    assert.equal(docking.live, true);
});

test('importDocking gives null when Ubuntu Dock is not installed', async () => {
    assert.equal(await importDocking({lookup: () => null}), null);
});

test('the dock manager reports its docks and its signals', () => {
    const {docked} = fakeDocked();
    const connected = [];
    const disconnected = [];
    const manager = {
        _allDocks: [docked],
        settings: {showAppsAtTop: true},
        connect(signal, handler) {
            connected.push({signal, handler});
            return connected.length;
        },
        disconnect(id) {
            disconnected.push(id);
        },
    };
    assert.equal(getDockManager({DockManager: {getDefault: () => manager}}), manager);
    assert.equal(getDockManager({DockManager: {getDefault: () => null}}), null);
    assert.equal(getDockManager(null), null);

    const calls = [];
    const disconnect = connectDockManager(manager,
        () => calls.push('ready'), () => calls.push('destroyed'));
    assert.deepEqual(connected.map(c => c.signal), ['docks-ready', 'docks-destroyed']);
    connected.forEach(c => c.handler());
    assert.deepEqual(calls, ['ready', 'destroyed']);
    disconnect();
    assert.deepEqual(disconnected, [1, 2]);

    const docks = getDocks(manager);
    assert.equal(docks.length, 1);
    assert.ok(docks[0] instanceof Dock);
    // Each wrapper reads its own dock and the manager's settings.
    assert.equal(docks[0].frame, docked._box);
    assert.equal(docks[0].showAppsAtTop, true);
    assert.deepEqual(getDocks(null), []);
});

test('a dock gives its actors by their role', () => {
    const {docked, dash} = fakeDocked();
    const dock = new Dock(docked, {settings: {showAppsAtTop: true}});
    assert.equal(dock.frame, docked._box);
    assert.equal(dock.dash, dash);
    assert.equal(dock.itemBox, dash._box);
    assert.equal(dock.scroller, dash._boxContainer);
    assert.equal(dock.background, dash._background);
    assert.equal(dock.separator, dash._separator);
    assert.equal(dock.showAppsButton, dash._showAppsIcon.toggleButton);
    assert.equal(dock.showAppsIcon, dash._showAppsIcon.icon);
    assert.equal(dock.isHorizontal, true);
    assert.equal(dock.showAppsAtTop, true);
    assert.equal(new Dock(docked, {settings: {showAppsAtTop: false}}).showAppsAtTop, false);
});

test('an open item menu keeps the dock shown', () => {
    const {docked, menuCalls} = fakeDocked();
    const dock = new Dock(docked, null);
    const item = {name: 'item'};
    dock.setItemMenuOpen(item, true);
    dock.setItemMenuOpen(item, false);
    assert.deepEqual(menuCalls, [[item, true], [item, false]]);
});

test('restoring the clip relayouts the slide container', () => {
    const {docked, slider} = fakeDocked();
    new Dock(docked, null).restoreClip();
    assert.equal(slider.relayouts, 1);
});

test('hiding is reported only once the dock starts sliding out', () => {
    const {docked, slider} = fakeDocked();
    const owner = {name: 'owner'};
    let hidings = 0;
    new Dock(docked, null).connectHiding(() => hidings++, owner);
    assert.equal(slider.handlers.length, 1);
    const [{signal, handler, owner: connectedOwner}] = slider.handlers;
    assert.equal(signal, 'notify::slide-x');
    assert.equal(connectedOwner, owner);
    slider.slideX = 1;
    handler();
    assert.equal(hidings, 0);
    slider.slideX = 0.6;
    handler();
    assert.equal(hidings, 1);
});

test('a dock that is not built yet answers null or false instead of throwing', () => {
    const dock = new Dock({}, null);
    for (const role of ['frame', 'dash', 'itemBox', 'scroller', 'background', 'separator', 'showAppsButton', 'showAppsIcon'])
        assert.equal(dock[role], null, role);
    assert.equal(dock.isHorizontal, false);
    assert.equal(dock.showAppsAtTop, false);
    dock.setItemMenuOpen({}, true);
    dock.restoreClip();
    dock.connectHiding(() => assert.fail('no slider, no hiding'), {});
});
