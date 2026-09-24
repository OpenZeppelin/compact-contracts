import { randomBytes } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/**
 * Creates the deploy signing key at `file` if it is missing: 32 random bytes as
 * hex, the `signing_key_file` format. Parallel workers can race here, so the
 * key goes to a temp file that is hard-linked into place. The first link wins
 * and no reader sees a partial key.
 */
export function ensureSigningKey(file: string): void {
  if (existsSync(file)) return;
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const temp = path.join(
    dir,
    `.${process.pid}-${randomBytes(4).toString('hex')}.signingkey`,
  );
  writeFileSync(temp, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  try {
    linkSync(temp, file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  } finally {
    unlinkSync(temp);
  }
}
