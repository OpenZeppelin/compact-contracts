import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type ZswapCoinPublicKey = { bytes: Uint8Array };

export type ContractAddress = { bytes: Uint8Array };

export type Either<A, B> = { is_left: boolean; left: A; right: B };

export type Witnesses<T> = {
  secretNonce(context: __compactRuntime.WitnessContext<Ledger, T>): [T, Uint8Array];
}

export type ImpureCircuits<T> = {
  owner(context: __compactRuntime.CircuitContext<T>): __compactRuntime.CircuitResults<T, Uint8Array>;
  transferOwnership(context: __compactRuntime.CircuitContext<T>,
                    newOwnerId_0: Uint8Array): __compactRuntime.CircuitResults<T, []>;
  renounceOwnership(context: __compactRuntime.CircuitContext<T>): __compactRuntime.CircuitResults<T, []>;
  assertOnlyOwner(context: __compactRuntime.CircuitContext<T>): __compactRuntime.CircuitResults<T, []>;
  _computeOwnerCommitment(context: __compactRuntime.CircuitContext<T>,
                          id_0: Uint8Array,
                          counter_0: bigint): __compactRuntime.CircuitResults<T, Uint8Array>;
}

export type PureCircuits = {
  _computeOwnerId(pk_0: Either<ZswapCoinPublicKey, ContractAddress>,
                  nonce_0: Uint8Array): Uint8Array;
}

export type Circuits<T> = {
  owner(context: __compactRuntime.CircuitContext<T>): __compactRuntime.CircuitResults<T, Uint8Array>;
  transferOwnership(context: __compactRuntime.CircuitContext<T>,
                    newOwnerId_0: Uint8Array): __compactRuntime.CircuitResults<T, []>;
  renounceOwnership(context: __compactRuntime.CircuitContext<T>): __compactRuntime.CircuitResults<T, []>;
  assertOnlyOwner(context: __compactRuntime.CircuitContext<T>): __compactRuntime.CircuitResults<T, []>;
  _computeOwnerCommitment(context: __compactRuntime.CircuitContext<T>,
                          id_0: Uint8Array,
                          counter_0: bigint): __compactRuntime.CircuitResults<T, Uint8Array>;
  _computeOwnerId(context: __compactRuntime.CircuitContext<T>,
                  pk_0: Either<ZswapCoinPublicKey, ContractAddress>,
                  nonce_0: Uint8Array): __compactRuntime.CircuitResults<T, Uint8Array>;
}

export type Ledger = {
  readonly _ownerCommitment: Uint8Array;
  readonly _counter: bigint;
  readonly _instanceSalt: Uint8Array;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<T, W extends Witnesses<T> = Witnesses<T>> {
  witnesses: W;
  circuits: Circuits<T>;
  impureCircuits: ImpureCircuits<T>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<T>,
               ownerId_0: Uint8Array,
               instanceSalt_0: Uint8Array): __compactRuntime.ConstructorResult<T>;
}

export declare function ledger(state: __compactRuntime.StateValue): Ledger;
export declare const pureCircuits: PureCircuits;
