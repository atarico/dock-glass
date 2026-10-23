// SPDX-License-Identifier: GPL-3.0-or-later
// How the benchmark puts the session's extension lists back. It has no
// gi:// or resource:// imports, so node can test it
// (test/benchHelpers.test.js).

// The org.gnome.shell lists to write back after a run, from the ones saved
// before it ({enabled, disabled}). Both come back: disableExtension() also
// adds the uuid to disabled-extensions, which overrides enabled-extensions.
// The benchmark's own uuid leaves both, so it never runs again at login,
// however the run ended.
export function restoredExtensionLists(saved, benchUuid) {
    return {
        enabled: saved.enabled.filter(uuid => uuid !== benchUuid),
        disabled: saved.disabled.filter(uuid => uuid !== benchUuid),
    };
}
