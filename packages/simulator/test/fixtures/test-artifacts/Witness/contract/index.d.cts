import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type ZswapCoinPublicKey = { bytes: Uint8Array };

export type ContractAddress = { bytes: Uint8Array };

export type Either<A, B> = { is_left: boolean; left: A; right: B };

export type Maybe<T> = { is_some: boolean; value: T };

export type Witnesses<T> = {
  wit_secretBytes(context: __compactRuntime.WitnessContext<Ledger, T>): [T, Uint8Array];
  wit_secretFieldPlusArg(context: __compactRuntime.WitnessContext<Ledger, T>,
                         arg1_0: bigint): [T, bigint];
  wit_secretUintPlusArgs(context: __compactRuntime.WitnessContext<Ledger, T>,
                         arg1_0: bigint,
                         arg2_0: bigint): [T, bigint];
}

export type ImpureCircuits<T> = {
  setBytes(context: __compactRuntime.CircuitContext<T>): __compactRuntime.CircuitResults<T, []>;
  setField(context: __compactRuntime.CircuitContext<T>, arg_0: bigint): __compactRuntime.CircuitResults<T, []>;
  setUint(context: __compactRuntime.CircuitContext<T>,
          arg1_0: bigint,
          arg2_0: bigint): __compactRuntime.CircuitResults<T, []>;
}

export type PureCircuits = {
}

export type Circuits<T> = {
  setBytes(context: __compactRuntime.CircuitContext<T>): __compactRuntime.CircuitResults<T, []>;
  setField(context: __compactRuntime.CircuitContext<T>, arg_0: bigint): __compactRuntime.CircuitResults<T, []>;
  setUint(context: __compactRuntime.CircuitContext<T>,
          arg1_0: bigint,
          arg2_0: bigint): __compactRuntime.CircuitResults<T, []>;
}

export type Ledger = {
  readonly _valBytes: Uint8Array;
  readonly _valField: bigint;
  readonly _valUint: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<T, W extends Witnesses<T> = Witnesses<T>> {
  witnesses: W;
  circuits: Circuits<T>;
  impureCircuits: ImpureCircuits<T>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<T>): __compactRuntime.ConstructorResult<T>;
}

export declare function ledger(state: __compactRuntime.StateValue): Ledger;
export declare const pureCircuits: PureCircuits;
