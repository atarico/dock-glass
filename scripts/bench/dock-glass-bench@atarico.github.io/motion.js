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
