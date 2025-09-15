import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../artifacts/Witness/contract/index.cjs';

const randomBigInt = (bits: number): bigint => {
  const bytes = Math.ceil(bits / 8);
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);

  let result = 0n;
  for (const byte of buffer) {
    result = (result << 8n) | BigInt(byte);
  }

  const max = 1n << BigInt(bits);
  return result % max;
};

export interface IWitnessWitnesses<P> {
  wit_secretBytes(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_secretFieldPlusArg(
    context: WitnessContext<Ledger, P>,
    arg: bigint,
  ): [P, bigint];
  wit_secretUintPlusArgs(
    context: WitnessContext<Ledger, P>,
    arg1: bigint,
    arg2: bigint,
  ): [P, bigint];
}

export type WitnessPrivateState = {
  secretBytes: Buffer;
  secretField: bigint;
  secretUint: bigint;
};

export const WitnessPrivateState = {
  generate: (): WitnessPrivateState => {
    return {
      secretBytes: getRandomValues(Buffer.alloc(32)),
      secretField: randomBigInt(222),
      secretUint: randomBigInt(128),
    };
  },
};

export const WitnessWitnesses = (): IWitnessWitnesses<WitnessPrivateState> => ({
  wit_secretBytes(
    context: WitnessContext<Ledger, WitnessPrivateState>,
  ): [WitnessPrivateState, Uint8Array] {
    return [context.privateState, context.privateState.secretBytes];
  },
  wit_secretFieldPlusArg(
    context: WitnessContext<Ledger, WitnessPrivateState>,
    arg: bigint,
  ): [WitnessPrivateState, bigint] {
    return [context.privateState, context.privateState.secretField + arg];
  },
  wit_secretUintPlusArgs(
    context: WitnessContext<Ledger, WitnessPrivateState>,
    arg1: bigint,
    arg2: bigint,
  ): [WitnessPrivateState, bigint] {
    return [
      context.privateState,
      context.privateState.secretUint + arg1 + arg2,
    ];
  },
});
