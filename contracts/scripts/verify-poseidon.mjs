// SPDX-License-Identifier: MIT
// Sanity runner (not a vitest suite): checks that the COMPILED witness-hint
// Poseidon reproduces the official hadeshash test vector for
// poseidonperm_x5_255_3.
//
// Usage (from contracts/):
//   compact compile src/crypto/test/mocks/MockPoseidon.compact artifacts/MockPoseidon
//   node scripts/verify-poseidon.mjs
import * as rt from '@midnight-ntwrk/compact-runtime';
import { Contract } from '../artifacts/MockPoseidon/contract/index.js';

const expected = {
  s0: 0x28ce19420fc246a05553ad1e8c98f5c9d67166be2c18e9e4cb4b4e317dd2a78an,
  s1: 0x51f3e312c95343a896cfd8945ea82ba956c1118ce9b9859b6ea56637b4b1ddc4n,
  s2: 0x3b2b69139b235626a0bfb56c9527ae66a7bf486ad8c11c14d1da0c69bbe0f79an,
};

// The compiler-workaround hint: identity, as the module doc requires.
const contract = new Contract({ wit_wire: (ctx, s) => [ctx.privateState, s] });

const coinPublicKey = '0'.repeat(64);
const ctor = contract.initialState(
  rt.createConstructorContext({}, coinPublicKey),
);
const circuitContext = rt.createCircuitContext(
  rt.sampleContractAddress(),
  coinPublicKey,
  ctor.currentContractState,
  ctor.currentPrivateState,
);

const out = contract.impureCircuits.permute(circuitContext, {
  s0: 0n,
  s1: 1n,
  s2: 2n,
}).result;
console.log('permute(0,1,2) =', out);

for (const lane of ['s0', 's1', 's2']) {
  if (out[lane] !== expected[lane]) {
    console.log(`MISMATCH at ${lane}: got 0x${out[lane].toString(16)}`);
    process.exit(1);
  }
}
console.log('OK: compiled circuit matches the official hadeshash test vector');
