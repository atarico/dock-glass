// SPDX-License-Identifier: GPL-3.0-or-later
// Run from the repository root with: node --test
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {approach, displacementAt, falloff, magnify, scaleAt} from '../magnifier.js';

// Ubuntu Dock at 48px icons: 60px tiles with a 2px margin on each side.
const SLOT = 64;
const WIDTH = 60;
const PEAK = 1.4;
const RADIUS = 3 * SLOT;

function dock(count) {
    const centers = Array.from({length: count}, (_, i) => 100 + SLOT / 2 + i * SLOT);
    return {centers, start: 100, end: 100 + count * SLOT};
}

function layoutAt(pointer, strength = 1, count = 8) {
    const {centers, start, end} = dock(count);
    return {
        centers,
        start,
        end,
        ...magnify({centers, pointer, radius: RADIUS, peak: PEAK, strength, start, end}),
    };
}

test('the icon under the pointer reaches the peak scale', () => {
    assert.equal(scaleAt(0, RADIUS, PEAK, 1), PEAK);
});

test('no icon ever shrinks below its rest size', () => {
    for (let distance = 0; distance <= 2 * RADIUS; distance += 1) {
        for (const strength of [0, 0.3, 1])
            assert.ok(scaleAt(distance, RADIUS, PEAK, strength) >= 1, `distance ${distance}`);
    }
    assert.equal(scaleAt(RADIUS, RADIUS, PEAK, 1), 1);
    assert.equal(scaleAt(5 * RADIUS, RADIUS, PEAK, 1), 1);
});

test('scale falls smoothly and monotonically with distance', () => {
    let previous = scaleAt(0, RADIUS, PEAK, 1);
    for (let distance = 0.5; distance <= RADIUS; distance += 0.5) {
        const scale = scaleAt(distance, RADIUS, PEAK, 1);
        assert.ok(scale <= previous, `rises at ${distance}`);
        assert.ok(previous - scale < 0.005, `jumps at ${distance}`);
        previous = scale;
    }
});

test('the falloff is a cosine bell that is flat only at its ends', () => {
    assert.equal(falloff(0, RADIUS), 1);
    assert.ok(Math.abs(falloff(RADIUS / 2, RADIUS) - 0.5) < 1e-12);
    assert.equal(falloff(RADIUS, RADIUS), 0);
    // Unlike the old per-segment smoothstep, sizes keep changing between
    // icon centers, so there are no plateaus one or two icons away.
    const slope = (falloff(SLOT + 1, RADIUS) - falloff(SLOT - 1, RADIUS)) / 2;
    assert.ok(slope < -0.001);
});

test('spreading never moves the point under the pointer', () => {
    assert.equal(displacementAt(0, RADIUS, PEAK, 1), 0);
    const {centers, icons} = layoutAt(100 + 3.5 * SLOT);
    const i = 3;
    assert.ok(Math.abs(centers[i] + icons[i].shift - (100 + 3.5 * SLOT)) <= SLOT / 2);
});

test('icons spread away from the pointer on both sides symmetrically', () => {
    for (const offset of [10, SLOT, 2.5 * SLOT, RADIUS, 4 * RADIUS]) {
        const right = displacementAt(offset, RADIUS, PEAK, 1);
        assert.ok(right > 0);
        assert.equal(displacementAt(-offset, RADIUS, PEAK, 1), -right);
    }
    // Beyond the radius every icon moves by the same half of the extra width.
    assert.equal(displacementAt(RADIUS, RADIUS, PEAK, 1), (PEAK - 1) * RADIUS / 2);
    assert.equal(displacementAt(3 * RADIUS, RADIUS, PEAK, 1), (PEAK - 1) * RADIUS / 2);
});

test('magnified neighbors never overlap', () => {
    const {start, end} = dock(8);
    for (let pointer = start - SLOT; pointer <= end + SLOT; pointer += 2) {
        const {centers, icons} = layoutAt(pointer);
        for (let i = 1; i < centers.length; i++) {
            const leftEdge = centers[i - 1] + icons[i - 1].shift + WIDTH * icons[i - 1].scale / 2;
            const rightEdge = centers[i] + icons[i].shift - WIDTH * icons[i].scale / 2;
            assert.ok(rightEdge >= leftEdge, `icons ${i - 1}/${i} overlap at pointer ${pointer}`);
        }
    }
});

test('the separator moves with the spread and never overlaps its neighbors', () => {
    // Four favorites, the separator in a 13px gap, then four running apps.
    const GAP = 13;
    const centers = Array.from({length: 8}, (_, i) => 132 + i * SLOT + (i >= 4 ? GAP : 0));
    const separator = centers[3] + (SLOT + GAP) / 2;
    for (let pointer = 100; pointer <= 100 + 8 * SLOT + GAP; pointer += 2) {
        const layout = magnify({
            centers, separators: [separator], pointer, radius: RADIUS, peak: PEAK,
            strength: 1, start: 100, end: 100 + 8 * SLOT + GAP,
        });
        const [shift] = layout.separators;
        const at = separator + shift;
        const left = centers[3] + layout.icons[3].shift + WIDTH * layout.icons[3].scale / 2;
        const right = centers[4] + layout.icons[4].shift - WIDTH * layout.icons[4].scale / 2;
        assert.ok(at > left && at < right, `separator overlaps an icon at pointer ${pointer}`);
    }
});

test('the pill widens to keep every magnified icon inside it', () => {
    const rest = dock(8);
    for (let pointer = rest.start; pointer <= rest.end; pointer += 2) {
        const {centers, icons, start, end} = layoutAt(pointer);
        const first = centers[0] + icons[0].shift - WIDTH * icons[0].scale / 2;
        const last = centers.at(-1) + icons.at(-1).shift + WIDTH * icons.at(-1).scale / 2;
        assert.ok(start <= first, `left edge at pointer ${pointer}`);
        assert.ok(end >= last, `right edge at pointer ${pointer}`);
        assert.ok(end - start > rest.end - rest.start);
    }
});

test('zero strength is exactly the rest layout', () => {
    const {icons, start, end} = layoutAt(100 + 2 * SLOT, 0);
    for (const icon of icons) {
        assert.equal(icon.scale, 1);
        assert.equal(icon.shift, 0);
    }
    assert.equal(start, 100);
    assert.equal(end, 100 + 8 * SLOT);
});

test('a zero radius (tiles not allocated yet) leaves every icon at rest', () => {
    assert.equal(scaleAt(0, 0, PEAK, 1), 1);
    assert.equal(scaleAt(SLOT, 0, PEAK, 1), 1);
    assert.equal(displacementAt(SLOT, 0, PEAK, 1), 0);
});

test('an unknown position (an icon not allocated yet) leaves it at rest', () => {
    // GNOME reports NaN positions for actors that were never allocated.
    for (const strength of [0, 0.5, 1]) {
        assert.equal(scaleAt(NaN, RADIUS, PEAK, strength), 1);
        assert.equal(displacementAt(NaN, RADIUS, PEAK, strength), 0);
    }
    const {centers, start, end} = dock(4);
    centers[1] = NaN;
    const {icons} = magnify({centers, pointer: 200, radius: RADIUS, peak: PEAK, strength: 0, start, end});
    for (const icon of icons) {
        assert.equal(icon.scale, 1);
        assert.equal(icon.shift, 0);
    }
});

test('smoothing is frame-rate independent', () => {
    const twoFrames = approach(approach(0, 1, 8, 80), 1, 8, 80);
    assert.ok(Math.abs(twoFrames - approach(0, 1, 16, 80)) < 1e-12);
});
