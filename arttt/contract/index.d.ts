import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Token_EscrowEntry = { spenderCt: ElGamal_Ciphertext;
                                  ownerCt: ElGamal_Ciphertext
                                };

export type ElGamal_Ciphertext = { c1: __compactRuntime.JubjubPoint;
                                   c2: __compactRuntime.JubjubPoint
                                 };

export type Witnesses<PS> = {
  wit_ConfidentialTokenSK(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  wit_ConfidentialTokenEK(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  wit_PlaintextBalance(context: __compactRuntime.WitnessContext<Ledger, PS>,
                       ct_0: ElGamal_Ciphertext): [PS, bigint];
  wit_RandomnessSeed(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  name(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, string>;
  symbol(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, string>;
  decimals(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  totalSupply(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  balanceOf(context: __compactRuntime.CircuitContext<PS>, account_0: Uint8Array): __compactRuntime.CircuitResults<PS, ElGamal_Ciphertext>;
  pendingOf(context: __compactRuntime.CircuitContext<PS>, account_0: Uint8Array): __compactRuntime.CircuitResults<PS, ElGamal_Ciphertext>;
  sweep(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  allowance(context: __compactRuntime.CircuitContext<PS>,
            account_0: Uint8Array,
            spender_0: Uint8Array): __compactRuntime.CircuitResults<PS, Token_EscrowEntry>;
  isRegistered(context: __compactRuntime.CircuitContext<PS>,
               account_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  register(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  transfer(context: __compactRuntime.CircuitContext<PS>,
           to_0: Uint8Array,
           value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  _move(context: __compactRuntime.CircuitContext<PS>,
        to_0: Uint8Array,
        value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  approve(context: __compactRuntime.CircuitContext<PS>,
          spender_0: Uint8Array,
          value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  transferFrom(context: __compactRuntime.CircuitContext<PS>,
               fromAddress_0: Uint8Array,
               to_0: Uint8Array,
               value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  mint(context: __compactRuntime.CircuitContext<PS>,
       account_0: Uint8Array,
       value_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  burn(context: __compactRuntime.CircuitContext<PS>, value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  burnFrom(context: __compactRuntime.CircuitContext<PS>,
           fromAddress_0: Uint8Array,
           value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  clearMemos(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  name(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, string>;
  symbol(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, string>;
  decimals(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  totalSupply(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  balanceOf(context: __compactRuntime.CircuitContext<PS>, account_0: Uint8Array): __compactRuntime.CircuitResults<PS, ElGamal_Ciphertext>;
  pendingOf(context: __compactRuntime.CircuitContext<PS>, account_0: Uint8Array): __compactRuntime.CircuitResults<PS, ElGamal_Ciphertext>;
  sweep(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  allowance(context: __compactRuntime.CircuitContext<PS>,
            account_0: Uint8Array,
            spender_0: Uint8Array): __compactRuntime.CircuitResults<PS, Token_EscrowEntry>;
  isRegistered(context: __compactRuntime.CircuitContext<PS>,
               account_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  register(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  transfer(context: __compactRuntime.CircuitContext<PS>,
           to_0: Uint8Array,
           value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  _move(context: __compactRuntime.CircuitContext<PS>,
        to_0: Uint8Array,
        value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  approve(context: __compactRuntime.CircuitContext<PS>,
          spender_0: Uint8Array,
          value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  transferFrom(context: __compactRuntime.CircuitContext<PS>,
               fromAddress_0: Uint8Array,
               to_0: Uint8Array,
               value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  mint(context: __compactRuntime.CircuitContext<PS>,
       account_0: Uint8Array,
       value_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  burn(context: __compactRuntime.CircuitContext<PS>, value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  burnFrom(context: __compactRuntime.CircuitContext<PS>,
           fromAddress_0: Uint8Array,
           value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  clearMemos(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  computeAccountId(sk_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  name(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, string>;
  symbol(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, string>;
  decimals(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  totalSupply(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  balanceOf(context: __compactRuntime.CircuitContext<PS>, account_0: Uint8Array): __compactRuntime.CircuitResults<PS, ElGamal_Ciphertext>;
  pendingOf(context: __compactRuntime.CircuitContext<PS>, account_0: Uint8Array): __compactRuntime.CircuitResults<PS, ElGamal_Ciphertext>;
  sweep(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  allowance(context: __compactRuntime.CircuitContext<PS>,
            account_0: Uint8Array,
            spender_0: Uint8Array): __compactRuntime.CircuitResults<PS, Token_EscrowEntry>;
  isRegistered(context: __compactRuntime.CircuitContext<PS>,
               account_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  register(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  transfer(context: __compactRuntime.CircuitContext<PS>,
           to_0: Uint8Array,
           value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  _move(context: __compactRuntime.CircuitContext<PS>,
        to_0: Uint8Array,
        value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  approve(context: __compactRuntime.CircuitContext<PS>,
          spender_0: Uint8Array,
          value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  transferFrom(context: __compactRuntime.CircuitContext<PS>,
               fromAddress_0: Uint8Array,
               to_0: Uint8Array,
               value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  mint(context: __compactRuntime.CircuitContext<PS>,
       account_0: Uint8Array,
       value_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  burn(context: __compactRuntime.CircuitContext<PS>, value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  burnFrom(context: __compactRuntime.CircuitContext<PS>,
           fromAddress_0: Uint8Array,
           value_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  computeAccountId(context: __compactRuntime.CircuitContext<PS>,
                   sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  clearMemos(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly Token__totalSupply: bigint;
  Token__balances: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): ElGamal_Ciphertext;
    [Symbol.iterator](): Iterator<[Uint8Array, ElGamal_Ciphertext]>
  };
  Token__pending: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): ElGamal_Ciphertext;
    [Symbol.iterator](): Iterator<[Uint8Array, ElGamal_Ciphertext]>
  };
  Token__encryptionKeys: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): __compactRuntime.JubjubPoint;
    [Symbol.iterator](): Iterator<[Uint8Array, __compactRuntime.JubjubPoint]>
  };
  Token__memos: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): {
      isEmpty(): boolean;
      length(): bigint;
      head(): { is_some: boolean,
                value: { ephemeralPk: __compactRuntime.JubjubPoint, ct: bigint }
              };
      [Symbol.iterator](): Iterator<{ ephemeralPk: __compactRuntime.JubjubPoint, ct: bigint }>
    }
  };
  Token__escrow: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): {
      isEmpty(): boolean;
      size(): bigint;
      member(key_1: Uint8Array): boolean;
      lookup(key_1: Uint8Array): Token_EscrowEntry;
      [Symbol.iterator](): Iterator<[Uint8Array, Token_EscrowEntry]>
    }
  };
  readonly Token__name: string;
  readonly Token__symbol: string;
  readonly Token__decimals: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               name__0: string,
               symbol__0: string,
               decimals__0: bigint): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
