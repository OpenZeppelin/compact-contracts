import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type ZswapCoinPublicKey = { bytes: Uint8Array };

export type ContractAddress = { bytes: Uint8Array };

export type Either<A, B> = { is_left: boolean; left: A; right: B };

export type Maybe<T> = { is_some: boolean; value: T };

export type Witnesses<T> = {
}

export type ImpureCircuits<T> = {
  setVal(context: __compactRuntime.CircuitContext<T>, n_0: bigint): __compactRuntime.CircuitResults<T, []>;
  getVal(context: __compactRuntime.CircuitContext<T>): __compactRuntime.CircuitResults<T, bigint>;
}

export type PureCircuits = {
}

export type Circuits<T> = {
  setVal(context: __compactRuntime.CircuitContext<T>, n_0: bigint): __compactRuntime.CircuitResults<T, []>;
  getVal(context: __compactRuntime.CircuitContext<T>): __compactRuntime.CircuitResults<T, bigint>;
}

export type Ledger = {
  readonly _val: bigint;
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
