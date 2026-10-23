// SPDX-License-Identifier: GPL-3.0-or-later
// Run from the repository root with: node --test
// Pins the benchmark's /proc parsing, statistics and result table.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
    TICKS_PER_SECOND, cpuMsPerFrame, cpuPercent, cpuTicks, formatTable, median, percentile, rssKb, summarize,
} from '../scripts/bench/dock-glass-bench@atarico.github.io/stats.js';

// /proc/<pid>/stat of a process whose name holds spaces and a parenthesis.
const STAT = '4242 (gnome shell (x)) S 1 4242 4242 0 -1 4194560 120 0 0 0 ' +
    '1500 300 0 0 20 0 21 0 1000 2000000 50000 18446744073709551615';

test('CPU ticks are utime plus stime, counted after the last parenthesis', () => {
    assert.equal(cpuTicks(STAT), 1800);
});

test('a stat line without CPU times is rejected', () => {
    assert.throws(() => cpuTicks('4242 (gnome-shell) S 1'), /CPU times/);
});

test('RSS is read in kB from the VmRSS line', () => {
    assert.equal(rssKb('Name:\tgnome-shell\nVmPeak:\t 900 kB\nVmRSS:\t  412345 kB\nThreads: 21\n'), 412345);
    assert.throws(() => rssKb('Name:\tgnome-shell\n'), /VmRSS/);
});

test('CPU percent is of one core over the sampled time', () => {
    assert.equal(TICKS_PER_SECOND, 100);
    assert.equal(cpuPercent(50, 10), 5);
    assert.equal(cpuPercent(250, 2), 125);
    assert.ok(Number.isNaN(cpuPercent(10, 0)));
});

test('CPU per frame is the CPU time spent, in ms, over the frames painted', () => {
    assert.equal(cpuMsPerFrame(150, 300), 5);
    assert.ok(Number.isNaN(cpuMsPerFrame(3, 0)));
});

test('median and nearest-rank percentile', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.ok(Number.isNaN(median([])));
    const values = Array.from({length: 100}, (_, i) => i + 1);
    assert.equal(percentile(values, 95), 95);
    assert.equal(percentile([7], 95), 7);
    assert.ok(Number.isNaN(percentile([], 95)));
});

test('a scenario summary takes the median of each metric across rounds', () => {
    assert.deepEqual(summarize([
        {cpu: 5, fps: 60, cpuPerFrame: 0.8, paintP95: 4},
        {cpu: 7, fps: 58, cpuPerFrame: 1.2, paintP95: 9},
        {cpu: 6, fps: 59, cpuPerFrame: 1.0, paintP95: 5},
    ]), {cpu: 6, fps: 59, cpuPerFrame: 1.0, paintP95: 5});
    assert.equal(summarize([]), null);
    // Nothing painted while idle: no paint time, and it is not a number.
    const idle = summarize([{cpu: 0.2, fps: 0, cpuPerFrame: NaN, paintP95: NaN},
        {cpu: 0.3, fps: 0, cpuPerFrame: NaN, paintP95: NaN}]);
    assert.equal(idle.cpu, 0.25);
    assert.ok(Number.isNaN(idle.paintP95));
    assert.equal(summarize([{cpu: 1, fps: 2, cpuPerFrame: 5, paintP95: NaN},
        {cpu: 3, fps: 4, cpuPerFrame: 7, paintP95: 6}]).paintP95, 6);
});

test('the result table compares without and with Dock Glass per scenario', () => {
    const table = formatTable({
        idle: {without: {cpu: 0.21, fps: 0, cpuPerFrame: NaN}, with: {cpu: 0.24, fps: 0, cpuPerFrame: NaN}},
        sweep: {without: {cpu: 9.4, fps: 21.5, cpuPerFrame: 4.37}, with: {cpu: 31.06, fps: 59.9, cpuPerFrame: 5.18}},
        stack: {without: null, with: {cpu: 18.2, fps: 59.4, cpuPerFrame: 3.06}},
    }, {without: [401.2, 398.0, 410.4], with: [405.7, 399.9, 402.1]});
    assert.deepEqual(table.split('\n'), [
        '| Scenario | CPU without | CPU with | Frames/s without | Frames/s with | CPU per frame without | CPU per frame with |',
        '|---|---|---|---|---|---|---|',
        '| Idle | 0.2 % | 0.2 % | 0 | 0 | n/a | n/a |',
        '| Dock sweep | 9.4 % | 31.1 % | 22 | 60 | 4.4 ms | 5.2 ms |',
        '| Files stack | n/a | 18.2 % | n/a | 59 | n/a | 3.1 ms |',
        '',
        'gnome-shell memory (RSS) after each round: 401 MB (398-410) without, 402 MB (400-406) with.',
    ]);
});
