import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { round2Report } from '../paths.ts';

/** Dry unit tests for `paths.ts`: round-2 report naming. */

describe('round2Report', () => {
  it('strips the unit `.test.ts` extension', () => {
    expect(path.basename(round2Report('/repo/src/multisig/Foo.test.ts'))).toBe(
      'live-r2-Foo.json',
    );
  });

  it('strips the integration `.spec.ts` extension', () => {
    expect(
      path.basename(round2Report('/repo/test/integration/specs/Bar.spec.ts')),
    ).toBe('live-r2-Bar.json');
  });

  it('writes the report under the repo logs directory', () => {
    const report = round2Report('/repo/src/multisig/Foo.test.ts');

    expect(path.basename(path.dirname(report))).toBe('logs');
    expect(path.isAbsolute(report)).toBe(true);
  });
});
