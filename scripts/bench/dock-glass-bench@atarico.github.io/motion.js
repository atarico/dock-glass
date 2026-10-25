// SPDX-License-Identifier: GPL-3.0-or-later
// Where the benchmark's virtual pointer goes, and when the dock counts as
// hidden. It has no gi:// or resource:// imports, so node can test it
// (test/benchHelpers.test.js).

// The pointer's x after `seconds` of a sweep back and forth between first
// and last at pxPerS. Taken from the time, not from a step per tick, so a
// busy main loop does not slow the sweep down.
export function sweepX(first, last, pxPerS, seconds) {
    const span = last - first;
    if (span <= 0)
        return first;
    const travelled = (seconds * pxPerS) % (2 * span);
    return first + (travelled <= span ? travelled : 2 * span - travelled);
}

// Whether a point ([x, y]) is past an edge of the monitor: a hidden dock has
// slid off it, whichever edge it sits on.
export function offMonitor([x, y], monitor) {
    return x < monitor.x || x > monitor.x + monitor.width ||
        y < monitor.y || y > monitor.y + monitor.height;
}

// Whether icon centers ([x, y] each) lie in a row, spread wider than tall:
// Dock Glass only magnifies a dock at the bottom, laid out that way.
export function inRow(points) {
    if (points.length < 2)
        return false;
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys);
}
