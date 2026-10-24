// SPDX-License-Identifier: GPL-3.0-or-later
// The math of the genie that genieEffect.js draws: how far it has poured,
// and where the dock's inner edge is, so the window meets the dock there
// instead of passing under it. It has no gi:// or resource:// imports, so
// node can test it (test/genieGeometry.test.js).

// Share of the animation spent widening from the icon edge (Magic Lamp's).
export const SPLIT = 0.3;

// Stage of a window pouring out of its icon at a timeline progress from 0 to
// 1, as Magic Lamp's k and j: both go from 1 (collapsed into the icon) to 0
// (full window). The window first stretches out to its height (j), then
// widens to its width (k). Minimizing runs it backwards, from 1 - progress.
export function pourStage(progress) {
    return {
        k: 1 - (progress > 1 - SPLIT ? (progress - (1 - SPLIT)) / SPLIT : 0),
        j: 1 - (progress <= 1 - SPLIT ? progress / (1 - SPLIT) : 1),
    };
}

// How far a dock on that side ('top', 'right', 'bottom' or 'left') of the
// monitor reaches in from the screen edge to its inner edge, in pixels. The
// rects are in stage coordinates. It is 0 without a dock, while the dock is
// hidden past the edge, or when the dock does not lie along that edge.
export function dockDepth(side, dock, monitor) {
    if (!dock)
        return 0;

    const horizontal = side === 'top' || side === 'bottom';
    const alongEdge = horizontal
        ? dock.x < monitor.x + monitor.width && dock.x + dock.width > monitor.x
        : dock.y < monitor.y + monitor.height && dock.y + dock.height > monitor.y;
    if (!alongEdge)
        return 0;

    const depth = {
        top: dock.y + dock.height - monitor.y,
        right: monitor.x + monitor.width - dock.x,
        bottom: monitor.y + monitor.height - dock.y,
        left: dock.x + dock.width - monitor.x,
    }[side];
    // A dock reaching past the middle of the screen is on the other edge.
    const limit = (horizontal ? monitor.height : monitor.width) / 2;
    return depth > 0 && depth <= limit ? depth : 0;
}
