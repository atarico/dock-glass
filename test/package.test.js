// SPDX-License-Identifier: GPL-3.0-or-later
// Run from the repository root with: node --test
// Guards what the packed extension (scripts/pack.sh) relies on: it ships
// every module at the repository root, so their relative imports must
// resolve to root modules, and metadata.json must carry the keys GNOME
// Shell reads. In CI's fresh checkout this also catches a module that was
// never committed.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {test} from 'node:test';

const root = new URL('../', import.meta.url);
const modules = readdirSync(root).filter(name => name.endsWith('.js'));

test('every relative import between the shipped modules resolves', () => {
    assert.ok(modules.includes('extension.js'));
    for (const name of modules) {
        const source = readFileSync(new URL(name, root), 'utf8');
        for (const [, path] of source.matchAll(/from\s+'(\.[^']*)'/g)) {
            assert.match(path, /^\.\/[^/]+\.js$/, `${name} imports ${path}, which is not a root module`);
            assert.ok(existsSync(new URL(path, root)), `${name} imports ${path}, which does not exist`);
        }
    }
});

test('metadata.json has what GNOME Shell needs to load the extension', () => {
    const metadata = JSON.parse(readFileSync(new URL('metadata.json', root), 'utf8'));
    for (const key of ['uuid', 'name', 'description'])
        assert.ok(typeof metadata[key] === 'string' && metadata[key].length > 0, key);
    const versions = metadata['shell-version'];
    assert.ok(Array.isArray(versions) && versions.length > 0, 'shell-version');
});
