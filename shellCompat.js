// SPDX-License-Identifier: GPL-3.0-or-later
// Differences between the GNOME Shell versions Dock Glass supports (46-51).
// It has no gi:// imports, so node can test it (test/shellCompat.test.js);
// callers pass in the GNOME enums it needs.

// The major version from Config.PACKAGE_VERSION ("50.1", "51.alpha").
export function shellMajor(packageVersion) {
    return Number.parseInt(packageVersion, 10);
}

// Whether a grab from Main.pushModal() holds the pointer. GNOME 50 removed
// Clutter.Grab.get_seat_state() and Clutter.GrabState: from then on
// pushModal() always grabs, and GNOME's own grabHelper.js no longer checks.
export function grabHoldsPointer(grab, GrabState) {
    if (typeof grab.get_seat_state !== 'function')
        return true;
    return (grab.get_seat_state() & GrabState.POINTER) !== 0;
}

// Constructor properties of a vertical St.BoxLayout. GNOME 48 added
// `orientation` and deprecated `vertical`, which 51 removed; 46 and 47 only
// have `vertical`.
export function verticalBox(major, Orientation) {
    return major >= 48 ? {orientation: Orientation.VERTICAL} : {vertical: true};
}
