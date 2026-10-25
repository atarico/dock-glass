// SPDX-License-Identifier: GPL-3.0-or-later
// How the benchmark puts the session's extension lists back. It has no
// gi:// or resource:// imports, so node can test it
// (test/benchHelpers.test.js).

// The org.gnome.shell lists to write after a run ({enabled, disabled}),
// from the ones saved before it and the ones now. Only what the benchmark
// touched changes back, so a change to another extension during the run
// stays: Dock Glass returns to where it was in each list (disableExtension()
// also adds the uuid to disabled-extensions, which overrides
// enabled-extensions), and the benchmark leaves both lists, so it never runs
// again at login, however the run ended.
export function restoredExtensionLists(saved, current, dockGlass, bench) {
    const restore = key => {
        const list = current[key].filter(uuid => uuid !== dockGlass && uuid !== bench);
        const index = saved[key].indexOf(dockGlass);
        if (index < 0)
            return list;
        // Right after the nearest extension that came before it and is
        // still listed, or first.
        const before = saved[key].slice(0, index).reverse().find(uuid => list.includes(uuid));
        list.splice(before === undefined ? 0 : list.indexOf(before) + 1, 0, dockGlass);
        return list;
    };
    return {enabled: restore('enabled'), disabled: restore('disabled')};
}
