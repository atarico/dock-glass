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
        // `from './x.js'`, `import './x.js'` and `import('./x.js')`, either quote.
        for (const [, , path] of source.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)(['"])(\.[^'"]*)\1/g)) {
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

// https://gjs.guide/extensions/overview/anatomy.html and
// https://gjs.guide/extensions/review-guidelines/review-guidelines.html
test('metadata.json follows the extensions.gnome.org rules', () => {
    const metadata = JSON.parse(readFileSync(new URL('metadata.json', root), 'utf8'));
    const [id, namespace, ...rest] = metadata.uuid.split('@');
    assert.equal(rest.length, 0, 'one @ in the uuid');
    assert.match(id, /^[A-Za-z0-9._-]+$/, 'uuid id');
    assert.match(namespace, /^[A-Za-z0-9._-]+$/, 'uuid namespace');
    assert.ok(namespace !== 'local' && !namespace.endsWith('gnome.org'),
        `${namespace} is not a namespace the author controls`);
    // extensions.gnome.org sets `version` on upload; `version-name` is shown.
    assert.equal('version' in metadata, false, 'version');
    assert.match(metadata['version-name'], /^(?!^[. ]+$)[a-zA-Z0-9 .]{1,16}$/, 'version-name');
    assert.match(metadata.url, /^https:\/\//, 'url');
    for (const version of metadata['shell-version'])
        assert.match(version, /^\d+$/, 'shell-version lists major versions');
});
