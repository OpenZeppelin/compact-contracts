import { readFileSync } from 'node:fs';
import {
  createCircuitContext,
  createConstructorContext,
} from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { describe, expect, test } from 'vitest';
import { Contract as Bytes8 } from '../../../artifacts/MockBytes8/contract/index.js';
import { Contract as Bytes8Native } from '../../../artifacts/MockBytes8Native/contract/index.js';
import { Contract as Bytes32 } from '../../../artifacts/MockBytes32/contract/index.js';
import { Contract as Bytes32Native } from '../../../artifacts/MockBytes32Native/contract/index.js';
import { Contract as Field255 } from '../../../artifacts/MockField255/contract/index.js';
import { Contract as Field255Native } from '../../../artifacts/MockField255Native/contract/index.js';
import { Contract as Pack } from '../../../artifacts/MockPack/contract/index.js';
import { Contract as PackNative } from '../../../artifacts/MockPackNative/contract/index.js';
import { Contract as Uint64 } from '../../../artifacts/MockUint64/contract/index.js';
import { Contract as Uint64Native } from '../../../artifacts/MockUint64Native/contract/index.js';
import { Contract as Uint128 } from '../../../artifacts/MockUint128/contract/index.js';
import { Contract as Uint128Native } from '../../../artifacts/MockUint128Native/contract/index.js';
import { Contract as Uint256 } from '../../../artifacts/MockUint256/contract/index.js';
import { Contract as Uint256Native } from '../../../artifacts/MockUint256Native/contract/index.js';
import { PackWitnesses } from './witnesses/PackWitnesses.js';
import { Uint64Witnesses } from './witnesses/Uint64Witnesses.js';
import { Uint128Witnesses } from './witnesses/Uint128Witnesses.js';

const vectorCases: { module: string; circuit: string; inputs: any[][] }[] =
  readFileSync(new URL('./utils/native-vectors.jsonl', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

// INV-24: replay the boundary and random vectors from the migration harness.
// The random vectors use fast-check seed 1301. These checks use the dry runtime.
const witnesses = {
  ...PackWitnesses(),
  ...Uint64Witnesses(),
  ...Uint128Witnesses(),
};
const modules = {
  Pack: [() => new Pack(witnesses), () => new PackNative({})],
  Bytes8: [() => new Bytes8(witnesses), () => new Bytes8Native({})],
  Uint64: [() => new Uint64(witnesses), () => new Uint64Native({})],
  Uint128: [() => new Uint128(witnesses), () => new Uint128Native({})],
  Uint256: [() => new Uint256(witnesses), () => new Uint256Native({})],
  Bytes32: [() => new Bytes32(witnesses), () => new Bytes32Native({})],
  Field255: [() => new Field255(witnesses), () => new Field255Native({})],
};

function decode(value: any): any {
  if (value && typeof value === 'object') {
    if ('$bigint' in value) return BigInt(value.$bigint);
    if ('$bytes' in value)
      return new Uint8Array(Buffer.from(value.$bytes, 'hex'));
    if (Array.isArray(value)) return value.map(decode);
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, decode(item)]),
    );
  }
  return value;
}

async function outcome(
  contract: any,
  initial: any,
  circuit: string,
  inputs: any[],
) {
  try {
    const context = createCircuitContext(
      circuit,
      '00'.repeat(32),
      initial.currentZswapLocalState,
      initial.currentContractState.data,
      initial.currentPrivateState,
      undefined,
      undefined,
      undefined,
      0,
    );
    return {
      value: (await contract.impureCircuits[circuit](context, ...inputs))
        .result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The generated argument name includes the native circuit suffix.
    if (message.startsWith('type error:'))
      return { error: 'argument type error' };
    throw error;
  }
}

describe.skipIf(isLiveBackend())('Native math equivalence', () => {
  for (const [module, constructors] of Object.entries(modules)) {
    const [Library, Native] = constructors;
    const cases = Object.fromEntries(
      vectorCases
        .filter((entry) => entry.module === module)
        .map((entry) => [entry.circuit, entry.inputs]),
    );
    for (const [circuit, inputs] of Object.entries(cases)) {
      test(`${module}.${circuit} equals its native expression`, async () => {
        const library = Library();
        const native = Native();
        const initialLibrary = await library.initialState(
          createConstructorContext({}, '00'.repeat(32)),
        );
        const initialNative = await native.initialState(
          createConstructorContext({}, '00'.repeat(32)),
        );
        for (const input of inputs) {
          const args = decode(input);
          expect(await outcome(library, initialLibrary, circuit, args)).toEqual(
            await outcome(native, initialNative, `${circuit}Native`, args),
          );
        }
      });
    }
  }
});
