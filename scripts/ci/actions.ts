import { appendFileSync } from 'node:fs';

/** The GitHub Actions runner protocol these scripts speak: step outputs. */

/**
 * Publish a step output, the way `echo "name=value" >> "$GITHUB_OUTPUT"` does.
 *
 * Outside Actions (`GITHUB_OUTPUT` unset) the pair is printed instead, so a local
 * run of the same command shows what CI would have consumed.
 *
 * @throws if the value spans lines. The `name=value` form cannot express one, and
 *   writing it anyway would corrupt every later output in the file rather than
 *   fail here (Actions has a delimiter form for multi-line values; nothing needs
 *   it yet).
 */
export function setOutput(name: string, value: string): void {
  if (value.includes('\n')) {
    throw new Error(`output '${name}' must be a single line`);
  }
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    console.log(`${name}=${value}`);
    return;
  }
  appendFileSync(file, `${name}=${value}\n`);
}
