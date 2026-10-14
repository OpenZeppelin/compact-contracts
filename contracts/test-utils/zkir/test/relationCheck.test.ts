/**
 * NO COMPILED ARTIFACT REQUIRED: `test:harness` has no `compile` dependency.
 * The relation tests here use a hand-written ZKIR v2 circuit. The math specs
 * (`src/math/test/MathRelationCheck.test.ts`) run the same helpers through
 * a real simulator and the compiled circuits.
 */

import { DryBackend } from '@openzeppelin/compact-simulator';
import { describe, expect, it } from 'vitest';
import { checkRelation, traceCall } from '../relationCheck.js';
import type { ZkirV2 } from '../zkirV2.js';

const byte = (value: number) => ({
  value: [value === 0 ? new Uint8Array() : Uint8Array.of(value)],
  alignment: [
    { tag: 'atom' as const, value: { tag: 'bytes' as const, length: 1 } },
  ],
});

/** Output = the witness result, which must equal the input. */
const ECHO: ZkirV2 = {
  version: { major: 2, minor: 0 },
  do_communications_commitment: true,
  num_inputs: 1,
  instructions: [
    { op: 'constrain_bits', var: 0, bits: 8 },
    { op: 'private_input', guard: null },
    { op: 'constrain_bits', var: 1, bits: 8 },
    { op: 'test_eq', a: 1, b: 0 },
    { op: 'assert', cond: 2 },
    { op: 'output', var: 1 },
  ],
};

const proofData = (input: number, output: number, witness: number[]) => ({
  input: byte(input),
  output: byte(output),
  publicTranscript: [],
  privateTranscriptOutputs: witness.map(byte),
});

describe('checkRelation', () => {
  it('accepts a preimage that satisfies every constraint', async () => {
    expect(await checkRelation(ECHO, 'echo', proofData(5, 5, [5]))).toEqual({
      accepted: true,
    });
  });

  it('rejects a failed assertion', async () => {
    expect(await checkRelation(ECHO, 'echo', proofData(5, 6, [6]))).toEqual({
      accepted: false,
      reason: 'Failed direct assertion',
    });
  });

  it('rejects an output that the circuit does not compute', async () => {
    const verdict = await checkRelation(ECHO, 'echo', proofData(5, 6, [5]));
    expect(verdict.accepted).toBe(false);
    expect(verdict.accepted ? '' : verdict.reason).toContain(
      'Communications commitment mismatch',
    );
  });

  it('throws for a failure that is not a relation failure', async () => {
    await expect(
      checkRelation(ECHO, 'echo', proofData(5, 5, [])),
    ).rejects.toThrow();
  });
});

describe('traceCall', () => {
  const dry = (trace: unknown) => ({
    _backend: new DryBackend(
      { circuitContext: { callProofDataTrace: trace } } as never,
      {} as never,
    ),
  });

  it('returns the result and the one trace entry that the call adds', async () => {
    const trace: unknown[] = ['earlier'];
    const simulator = dry(trace);
    const { result, proofData: entry } = await traceCall(
      simulator,
      async () => {
        trace.push('this call');
        return 42;
      },
    );
    expect(result).toBe(42);
    expect(entry).toBe('this call');
  });

  it('throws when the call adds no entry or more than one', async () => {
    const trace: unknown[] = [];
    const simulator = dry(trace);
    await expect(traceCall(simulator, async () => 1)).rejects.toThrow(
      'the call added 0 trace entries, not 1',
    );
    await expect(
      traceCall(simulator, async () => {
        trace.push('a', 'b');
      }),
    ).rejects.toThrow('the call added 2 trace entries, not 1');
  });

  it('throws for a simulator that is not on the dry backend', async () => {
    for (const simulator of [null, {}, { _backend: { kind: 'live' } }]) {
      await expect(traceCall(simulator, async () => 1)).rejects.toThrow(
        'the simulator does not run on the dry backend',
      );
    }
  });

  it('throws when the dry backend has no call trace', async () => {
    await expect(traceCall(dry(undefined), async () => 1)).rejects.toThrow(
      'no call trace at DryBackend.sim.circuitContext.callProofDataTrace',
    );
  });
});
