// Pure layout math of the macOS-like stacks (stack.js). It has no gi://
// imports, so node can test it (test/stackLayout.test.js). Distances are
// stage pixels; fan slots are relative to the top center of the dock icon.

// Like the macOS "Automatic" view: a fan while the items fit in one column,
// a grid beyond that.
export const MAX_FAN_ITEMS = 10;
// Fan items lean along the curve, but only a little, like on macOS.
const MAX_TILT_DEG = 10;

export function chooseView(count) {
    return count <= MAX_FAN_ITEMS ? 'fan' : 'grid';
}

// Slot of each fan item, nearest the dock first: `step` px apart vertically,
// bending right along a parabola (x = bend * height^2), and tilted by half
// the curve's angle, capped.
export function fanSlots({count, step, bend}) {
    return Array.from({length: count}, (_, i) => {
        const height = (i + 1) * step;
        const slope = 2 * bend * height;
        const tilt = Math.atan(slope) * 180 / Math.PI / 2;
        return {x: bend * height * height, y: -height, angle: Math.min(tilt, MAX_TILT_DEG)};
    });
}

// Row-major cells of `cell` px inside `padding`; the panel is only as wide as
// its items and shows at most `maxRows` rows, scrolling the rest.
export function gridLayout({count, columns, cell, padding, maxRows}) {
    const cols = Math.max(1, Math.min(count, columns));
    const rows = Math.max(1, Math.ceil(count / cols));
    const positions = Array.from({length: count}, (_, i) => ({
        x: padding + (i % cols) * cell,
        y: padding + Math.floor(i / cols) * cell,
    }));
    return {
        columns: cols,
        rows,
        positions,
        width: 2 * padding + cols * cell,
        height: 2 * padding + Math.min(rows, maxRows) * cell,
        contentHeight: 2 * padding + rows * cell,
        scrolls: rows > maxRows,
    };
}

// Start delay of item `index` (0 nearest the dock) so the whole stack springs
// out within `totalMs`.
export function staggerDelay(index, count, totalMs) {
    return count > 1 ? index / (count - 1) * totalMs : 0;
}
