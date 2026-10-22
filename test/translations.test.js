// SPDX-License-Identifier: GPL-3.0-or-later
// Run from the repository root with: node --test
// Keeps the translations in po/ in step with the code: every po/<lang>.po
// translates exactly the strings the root modules pass to _(), so none is
// left untranslated or kept for a string the code no longer uses.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

function codeStrings() {
    const strings = new Set();
    for (const name of readdirSync(root).filter(file => file.endsWith('.js'))) {
        for (const [, , text] of read(name).matchAll(/\b_\((['"])(.*?)\1\)/g))
            strings.add(text);
    }
    return strings;
}

// The msgid/msgstr pairs of a .po file, without the header (empty msgid).
// A line holding only a quoted string continues the previous keyword.
function parsePo(text) {
    const entries = [];
    let entry = null;
    let key = null;
    for (const line of text.split('\n')) {
        const keyword = line.match(/^(msgid|msgstr) "(.*)"$/);
        const continuation = line.match(/^"(.*)"$/);
        if (keyword) {
            key = keyword[1];
            if (key === 'msgid')
                entries.push(entry = {msgid: '', msgstr: ''});
            entry[key] = keyword[2];
        } else if (continuation && entry) {
            entry[key] += continuation[1];
        }
    }
    return entries.filter(({msgid}) => msgid !== '');
}

test('every po file translates exactly the strings the code passes to _()', () => {
    const strings = codeStrings();
    assert.ok(strings.size > 0, 'the code passes strings to _()');
    const poFiles = readdirSync(new URL('po/', root)).filter(file => file.endsWith('.po'));
    assert.ok(poFiles.includes('es.po'), 'po/es.po');
    for (const file of poFiles) {
        const entries = parsePo(read(`po/${file}`));
        assert.deepEqual(new Set(entries.map(({msgid}) => msgid)), strings, file);
        for (const {msgid, msgstr} of entries)
            assert.ok(msgstr.length > 0, `${file} translates "${msgid}"`);
    }
});

test('the gettext domain is the uuid, which names the compiled translations', () => {
    const metadata = JSON.parse(read('metadata.json'));
    assert.equal(metadata['gettext-domain'], metadata.uuid);
});
