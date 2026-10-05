import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSigningKey } from '../signingKey.js';

describe('ensureSigningKey', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'signing-key-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a 32-byte hex key and its directory, leaving no temp file', () => {
    const file = path.join(dir, 'deploy', 'local.signingkey');
    ensureSigningKey(file);
    expect(readFileSync(file, 'utf8')).toMatch(/^[0-9a-f]{64}\n$/);
    expect(readdirSync(path.dirname(file))).toStrictEqual(['local.signingkey']);
  });

  it('keeps an existing key', () => {
    const file = path.join(dir, 'local.signingkey');
    const key = `${'ab'.repeat(32)}\n`;
    writeFileSync(file, key);
    ensureSigningKey(file);
    expect(readFileSync(file, 'utf8')).toBe(key);
  });
});
