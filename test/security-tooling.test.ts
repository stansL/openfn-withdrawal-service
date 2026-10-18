import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('security exceptions reject expired, malformed and duplicate entries before writing an ignore file', () => {
  const root = mkdtempSync(join(tmpdir(), 'openfn-security-exceptions-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, '.security'));
    const script = join(root, 'scripts/security-exceptions.mjs');
    writeFileSync(script, readFileSync('scripts/security-exceptions.mjs'));
    const entry = {
      fingerprint: `${'a'.repeat(40)}:fixture.ts:example-rule:1`, owner: '@test-owner',
      expires: '2999-01-01', reason: 'Synthetic validator test; no secret.',
    };
    const cases = [
      [{ ...entry, expires: '2000-01-01' }],
      [{ ...entry, expires: '2999-02-30' }],
      [{ ...entry, reason: '' }],
      [{ ...entry, owner: '' }],
      [{ ...entry, fingerprint: 'entire-file-ignore' }],
      [entry, entry],
      {},
    ];
    for (const [index, entries] of cases.entries()) {
      writeFileSync(join(root, '.security/exceptions.json'), JSON.stringify(entries));
      const output = join(root, `rejected-${index}`);
      const result = spawnSync(process.execPath, [script, output], { encoding: 'utf8' });
      assert.equal(result.status, 1, result.stderr);
      assert.equal(existsSync(output), false);
    }
    writeFileSync(join(root, '.security/exceptions.json'), JSON.stringify([entry]));
    const output = join(root, 'accepted');
    const result = spawnSync(process.execPath, [script, output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), entry.fingerprint + '\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
