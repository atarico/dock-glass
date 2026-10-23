// SPDX-License-Identifier: GPL-3.0-or-later
// The only module that reaches into the dock's private internals: how the
// dock's live module is loaded, its dock manager, and the actors of each
// dock. Dash to Dock and Ubuntu Dock (its fork, Ubuntu's default dock) share
// these internals and keep them private, so an update can rename them; adapt
// this file when that happens. The dash item API that GNOME's own dash
// shares (item.child, button.app, button.icon, item.label, activate...)
// stays with the code that uses it.
// It has no gi:// or resource:// imports, so node can test the mapping
// (test/dockAdapter.test.js).

// The docks Dock Glass works with, in order of preference. Ubuntu Dock
// steps aside while Dash to Dock is enabled, so only one of them runs.
export const DOCK_UUIDS = ['dash-to-dock@micxgx.gmail.com', 'ubuntu-dock@ubuntu.com'];

export function isDockExtension(extension) {
    return DOCK_UUIDS.includes(extension?.uuid);
}

// The dock's live docking.js module, or null when that dock is not
// installed. Rejects when the module cannot be imported.
export async function importDock(extensionManager, uuid) {
    const extension = extensionManager.lookup(uuid);
    if (!extension)
        return null;
    // Same URL the dock imports, so this is its live module instance.
    return import(extension.dir.get_child('docking.js').get_uri());
}

// The dock refreshes an app icon's focused flag when the focused app or the
// app's windows change, and its running flag when the app's state changes,
// but focused also depends on running. An app whose launch ends after its
// window took focus (Brave, with startup notification) stays unfocused, so
// a click raises it instead of minimizing it. Refresh focused on every state
// change too, after the dock's own handler. Returns the disconnect function.
export function keepFocusInSync(button) {
    const {app} = button;
    if (!app || typeof button._updateFocusState !== 'function')
        return () => {};
    const id = app.connect('notify::state', () => button._updateFocusState());
    return () => app.disconnect(id);
}

// The dock manager that runs, from the docking modules by uuid, or null
// while none has one. Both docks also export their manager from
// extension.js, but Ubuntu Dock keeps exporting the destroyed one while it
// steps aside for Dash to Dock; getDefault() is cleared on destroy.
export function getDockManager(modules) {
    for (const uuid of DOCK_UUIDS) {
        const manager = modules.get(uuid)?.DockManager?.getDefault();
        if (manager)
            return manager;
    }
    return null;
}

// Calls onReady after the manager (re)creates its docks and onDestroyed after
// it destroys them. Returns the function that disconnects both. Dash to Dock
// destroys its docks without docks-destroyed, right before it creates new
// ones, so after onReady the previous docks may be gone.
export function connectDockManager(manager, onReady, onDestroyed) {
    // DockManager uses JS signals, so plain connect/disconnect is safe.
    const ids = [
        manager.connect('docks-ready', onReady),
        manager.connect('docks-destroyed', onDestroyed),
    ];
    return () => ids.forEach(id => manager.disconnect(id));
}

// The manager's docks, one per monitor it shows a dock on.
export function getDocks(manager) {
    return (manager?._allDocks ?? []).map(docked => new Dock(docked, manager));
}

// One dock (a DockedDash), by the role of each actor. Missing
// parts read as null or false, so a dock that is being built or destroyed
// never throws here.
export class Dock {
    constructor(docked, manager) {
        this._docked = docked;
        this._manager = manager;
    }

    // dashtodockBox: reactive and hover-tracked, it covers the whole dock,
    // and the slide container clips it on every allocation.
    get frame() {
        return this._docked._box ?? null;
    }

    // The dash, the parent of everything below.
    get dash() {
        return this._docked.dash ?? null;
    }

    // The box of dash items (one DashItemContainer per icon, plus the
    // separator) in on-screen order. Show Apps is not in it.
    get itemBox() {
        return this._docked.dash?._box ?? null;
    }

    // The scroll view around the item box.
    get scroller() {
        return this._docked.dash?._boxContainer ?? null;
    }

    // The pill behind the icons.
    get background() {
        return this._docked.dash?._background ?? null;
    }

    // The line between pinned and running apps. The dock re-inserts it on
    // every redisplay.
    get separator() {
        return this._docked.dash?._separator ?? null;
    }

    get showAppsButton() {
        return this._docked.dash?._showAppsIcon?.toggleButton ?? null;
    }

    get showAppsIcon() {
        return this._docked.dash?._showAppsIcon?.icon ?? null;
    }

    get isHorizontal() {
        return Boolean(this._docked.dash?._isHorizontal);
    }

    get showAppsAtTop() {
        return Boolean(this._manager?.settings?.showAppsAtTop);
    }

    // The dock stays shown while one of its items has a menu open.
    setItemMenuOpen(item, open) {
        this._docked.dash?._itemMenuStateChanged?.(item, open);
    }

    // The slide container sets its own clip again on relayout.
    restoreClip() {
        this._docked._slider?.queue_relayout();
    }

    // Calls onHiding whenever the dock starts sliding out of view, until
    // owner is destroyed or disconnects.
    connectHiding(onHiding, owner) {
        const slider = this._docked._slider;
        slider?.connectObject('notify::slide-x', () => {
            if (slider.slideX < 1)
                onHiding();
        }, owner);
    }
}
