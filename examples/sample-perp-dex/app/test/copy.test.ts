import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// Every file the app ships text from.
function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? sources(join(dir, e.name)) : [join(dir, e.name)],
    );
}

const files = sources(join(import.meta.dirname, '..', 'src')).map((path) => ({
    path,
    text: readFileSync(path, 'utf8'),
}));

// Built from its code point so this file never contains one itself.
const EM_DASH = String.fromCharCode(0x2014);

test('no em dashes in the app', () => {
    for (const f of files) {
        assert.ok(!f.text.includes(EM_DASH), `${f.path} has an em dash`);
    }
});

test('no copy promises a yield on USDG', () => {
    for (const f of files) {
        assert.ok(!/\bAPY\b|\bAPR\b/.test(f.text), `${f.path} shows a rate`);

        for (const m of f.text.matchAll(/[^.'`]*\byield[^.'`]*/gi)) {
            assert.match(m[0], /does not yield/, `${f.path}: "${m[0].trim()}"`);
        }
    }
});
