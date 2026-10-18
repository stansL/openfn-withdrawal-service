import { readFileSync, writeFileSync } from 'node:fs';

const output = process.argv[2];
if (!output) throw new Error('Provide the output path for validated Gitleaks fingerprints.');
const exceptions = JSON.parse(readFileSync(new URL('../.security/exceptions.json', import.meta.url), 'utf8'));
if (!Array.isArray(exceptions)) throw new Error('Security exceptions must be an array.');
const seen = new Set();
for (const entry of exceptions) {
  if (!entry || typeof entry.fingerprint !== 'string'
      || !/^[a-f0-9]{40}:[^\r\n]+:[\w-]+:[1-9]\d*$/.test(entry.fingerprint)
      || typeof entry.owner !== 'string' || !/^@[\w-]+$/.test(entry.owner)
      || typeof entry.reason !== 'string' || !entry.reason.trim()
      || typeof entry.expires !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) {
    throw new Error('Every exception needs an exact fingerprint, owner, reason and ISO expiry date.');
  }
  const expiry = new Date(`${entry.expires}T00:00:00.000Z`);
  if (!Number.isFinite(expiry.getTime()) || expiry.toISOString().slice(0, 10) !== entry.expires
      || expiry.getTime() <= Date.now()) {
    throw new Error(`Invalid or expired security exception: ${entry.fingerprint}`);
  }
  if (seen.has(entry.fingerprint)) throw new Error('Duplicate security exception.');
  seen.add(entry.fingerprint);
}
writeFileSync(output, [...seen].join('\n') + '\n', { mode: 0o600 });
console.log(`Validated ${seen.size} time-limited fixture exceptions.`);
