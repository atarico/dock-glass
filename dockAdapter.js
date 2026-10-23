// SPDX-License-Identifier: GPL-3.0-or-later
// The only module that reaches into Ubuntu Dock's private internals: how its
// live docking module is loaded, its dock manager, and the actors of each
// dock. Ubuntu Dock (a Dash to Dock fork) keeps them private, so an update
// can rename them; adapt this file when that happens. The dash item API that
// GNOME's own dash shares (item.child, button.app, button.icon, item.label,
// activate...) stays with the code that uses it.
// It has no gi:// or resource:// imports, so node can test the mapping
// (test/dockAdapter.test.js).

export const DOCK_UUID = 'ubuntu-dock@ubuntu.com';

export function isDockExtension(extension) {
    return extension?.uuid === DOCK_UUID;
}

// Ubuntu Dock's live docking.js module, or null when Ubuntu Dock is not
// installed. Rejects when the module cannot be imported.
export async function importDocking(extensionManager) {
    const extension = extensionManager.lookup(DOCK_UUID);
    if (!extension)
        return null;
    // Same URL Ubuntu Dock imports, so this is its live module instance.
    return import(extension.dir.get_child('docking.js').get_uri());
}

// Ubuntu Dock's dock manager, or null while it has none.
export function getDockManager(docking) {
    return docking?.DockManager.getDefault() ?? null;
}

// Calls onReady after the manager (re)creates its docks and onDestroyed after
// it destroys them. Returns the function that disconnects both.
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

// One Ubuntu Dock dock (a DockedDash), by the role of each actor. Missing
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

    // The line between pinned and running apps. Ubuntu Dock re-inserts it on
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
