// Pure math of the macOS-like magnifier. It has no gi:// imports, so node can
// test it (test/magnifier.test.js). Distances are stage pixels along the dock,
// measured on the unmagnified layout; `strength` fades the whole effect in
// and out (0 is exactly the rest layout).

// 1 under the pointer, easing along half a cosine wave to 0 at `radius`.
export function falloff(distance, radius) {
    const t = Math.min(Math.abs(distance) / radius, 1);
    return (1 + Math.cos(Math.PI * t)) / 2;
}

// Scale of an icon `distance` px from the pointer. Like on macOS, icons only
// grow: everything `radius` px or more away stays at its rest size.
export function scaleAt(distance, radius, peak, strength) {
    return 1 + (peak - 1) * strength * falloff(distance, radius);
}

// How far the magnification pushes a point `offset` px from the pointer
// (signed, away from it). It is the extra width that the magnified icons
// between the pointer and that point add, so neighbors make room for each
// other instead of overlapping, the point under the pointer stays put, and
// beyond `radius` everything shifts by the same amount.
export function displacementAt(offset, radius, peak, strength) {
    const distance = Math.min(Math.abs(offset), radius);
    const area = distance >= radius
        ? radius / 2
        : distance / 2 + radius / (2 * Math.PI) * Math.sin(Math.PI * distance / radius);
    const spread = (peak - 1) * strength * area;
    if (!spread)
        return 0;
    return offset < 0 ? -spread : spread;
}

// Scale and horizontal shift of each icon centered at `centers`, plus the
// pill's new `start` and `end`, which widen with the icons.
export function magnify({centers, pointer, radius, peak, strength, start, end}) {
    return {
        icons: centers.map(center => ({
            scale: scaleAt(center - pointer, radius, peak, strength),
            shift: displacementAt(center - pointer, radius, peak, strength),
        })),
        start: start + displacementAt(start - pointer, radius, peak, strength),
        end: end + displacementAt(end - pointer, radius, peak, strength),
    };
}

// Frame-rate independent exponential smoothing of value toward target.
export function approach(value, target, dtMs, timeConstantMs) {
    return target + (value - target) * Math.exp(-dtMs / timeConstantMs);
}
