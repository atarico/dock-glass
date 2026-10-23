// SPDX-License-Identifier: GPL-3.0-or-later
// The benchmark's /proc parsing, statistics and result table. It has no
// gi:// or resource:// imports, so node can test it (test/benchStats.test.js).

// /proc reports CPU times in USER_HZ, 100 ticks per second on Linux.
export const TICKS_PER_SECOND = 100;

// utime + stime from /proc/<pid>/stat. The process name (field 2) sits in
// parentheses and may hold spaces or parentheses itself, so the fields are
// counted after the last ')': field 3 comes first, utime is 14, stime 15.
export function cpuTicks(statText) {
    const fields = statText.slice(statText.lastIndexOf(')') + 2).split(' ');
    const utime = Number(fields[11]);
    const stime = Number(fields[12]);
    if (!Number.isFinite(utime) || !Number.isFinite(stime))
        throw new Error('No CPU times in /proc stat line');
    return utime + stime;
}

// VmRSS from /proc/<pid>/status, in kB.
export function rssKb(statusText) {
    const match = /^VmRSS:\s+(\d+) kB$/m.exec(statusText);
    if (!match)
        throw new Error('No VmRSS line in /proc status');
    return Number(match[1]);
}

// Share of one CPU core used, in percent, by `ticks` over `seconds`.
export function cpuPercent(ticks, seconds) {
    return seconds > 0 ? ticks / TICKS_PER_SECOND / seconds * 100 : NaN;
}

// CPU time, in ms, spent per painted frame: comparable even where frames
// are not paced by the display (a headless shell paints as fast as it can).
export function cpuMsPerFrame(ticks, frames) {
    return frames > 0 ? ticks / TICKS_PER_SECOND * 1000 / frames : NaN;
}

export function median(values) {
    if (!values.length)
        return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Nearest-rank percentile: the smallest value with at least p% at or below.
export function percentile(values, p) {
    if (!values.length)
        return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(p / 100 * sorted.length) - 1)];
}

// One scenario across rounds: the median of each metric over the rounds
// that measured it (no paint, no paint time), or null with no rounds (a
// scenario with no counterpart without Dock Glass).
export function summarize(rounds) {
    if (!rounds.length)
        return null;
    const metric = key => median(rounds.map(r => r[key]).filter(Number.isFinite));
    return {cpu: metric('cpu'), fps: metric('fps'), cpuPerFrame: metric('cpuPerFrame'), paintP95: metric('paintP95')};
}

const SCENARIOS = [
    ['idle', 'Idle'],
    ['sweep', 'Dock sweep'],
    ['windows', 'Open and close windows'],
    ['stack', 'Files stack'],
];

const NONE = 'n/a';
const cpu = s => s && Number.isFinite(s.cpu) ? `${s.cpu.toFixed(1)} %` : NONE;
const fps = s => s && Number.isFinite(s.fps) ? `${Math.round(s.fps)}` : NONE;
const perFrame = s => s && Number.isFinite(s.cpuPerFrame) ? `${s.cpuPerFrame.toFixed(1)} ms` : NONE;

// Memory after each round, in MB: the median and the range, since it drifts
// between rounds by more than one extension changes it.
function memory(values) {
    const mb = value => Math.round(value);
    return `${mb(median(values))} MB (${mb(Math.min(...values))}-${mb(Math.max(...values))})`;
}

// Markdown table of the summaries by scenario ({without, with} each), and
// the gnome-shell memory line when rss ({without, with}: MB after each
// round) is given.
export function formatTable(scenarios, rss = null) {
    const lines = [
        '| Scenario | CPU without | CPU with | Frames/s without | Frames/s with | CPU per frame without | CPU per frame with |',
        '|---|---|---|---|---|---|---|',
    ];
    for (const [key, label] of SCENARIOS) {
        const scenario = scenarios[key];
        if (!scenario)
            continue;
        const {without: a, with: b} = scenario;
        lines.push(`| ${label} | ${cpu(a)} | ${cpu(b)} | ${fps(a)} | ${fps(b)} | ${perFrame(a)} | ${perFrame(b)} |`);
    }
    if (rss) {
        lines.push('', `gnome-shell memory (RSS) after each round: ${memory(rss.without)} without, ` +
            `${memory(rss.with)} with.`);
    }
    return lines.join('\n');
}
