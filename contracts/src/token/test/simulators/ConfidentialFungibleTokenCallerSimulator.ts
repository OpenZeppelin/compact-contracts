import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import { deriveEncryptionPk } from '#test-utils/fixtures/elgamal.js';
import {
  type Caller,
  type CFT_EscrowEntry,
  type ContractAddress,
  type Either,
  type ElGamal_Ciphertext,
  ledger,
  Contract as MockConfidentialFungibleTokenCaller,
} from '../../../../artifacts/token/test/mocks/MockConfidentialFungibleTokenCaller/contract/index.js';
import {
  ConfidentialFungibleTokenPrivateState,
  ConfidentialFungibleTokenWitnesses,
} from '../witnesses/ConfidentialFungibleTokenWitnesses.js';

// The mock reads the encryption key, the cached plaintexts and the randomness
// seed from the private state. Its `secretKey` is unused: the caller is an
// argument.

/**
 * Type constructor args
 */
type ConfidentialFungibleTokenCallerArgs = readonly [
  name: string,
  symbol: string,
  decimals: bigint,
];

const ConfidentialFungibleTokenCallerSimulatorBase = createSimulator<
  ConfidentialFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialFungibleTokenWitnesses>,
  MockConfidentialFungibleTokenCaller<ConfidentialFungibleTokenPrivateState>,
  ConfidentialFungibleTokenCallerArgs
>({
  contractFactory: (witnesses) =>
    new MockConfidentialFungibleTokenCaller<ConfidentialFungibleTokenPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => ConfidentialFungibleTokenPrivateState.generate(),
  contractArgs: (name, symbol, decimals) => [name, symbol, decimals],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialFungibleTokenWitnesses(),
  artifactName: 'MockConfidentialFungibleTokenCaller',
});

/**
 * ConfidentialFungibleToken Simulator for the mock that takes the caller as an
 * argument.
 *
 * Each circuit method is a thin pass-through to the mock's matching circuit.
 */
export class ConfidentialFungibleTokenCallerSimulator extends ConfidentialFungibleTokenCallerSimulatorBase {
  static async create(
    name: string,
    symbol: string,
    decimals: bigint,
    options: SimulatorOptions<
      ConfidentialFungibleTokenPrivateState,
      ReturnType<typeof ConfidentialFungibleTokenWitnesses>
    > = {},
  ): Promise<ConfidentialFungibleTokenCallerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [name, symbol, decimals],
      options,
    ) as Promise<ConfidentialFungibleTokenCallerSimulator>;
  }

  /**
   * @description Returns the spendable balance ciphertext of `account`.
   * @param account - The account id to query.
   * @returns The spendable balance ciphertext.
   */
  public balanceOf(account: Uint8Array): Promise<ElGamal_Ciphertext> {
    return this.circuits.impure.balanceOf(account);
  }

  /**
   * @description Returns the pending balance ciphertext of `account`.
   * @param account - The account id to query.
   * @returns The pending balance ciphertext.
   */
  public pendingOf(account: Uint8Array): Promise<ElGamal_Ciphertext> {
    return this.circuits.impure.pendingOf(account);
  }

  /**
   * @description Returns the escrow entry `owner` granted `spender`.
   * @param owner - The account that granted the allowance.
   * @param spender - The approved spender.
   * @returns The escrow entry.
   */
  public allowance(
    owner: Uint8Array,
    spender: Uint8Array,
  ): Promise<CFT_EscrowEntry> {
    return this.circuits.impure.allowance(owner, spender);
  }

  /**
   * @description Returns whether `account` has registered an encryption key.
   * @param account - The account id to query.
   * @returns Whether `account` is registered.
   */
  public isRegistered(account: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isRegistered(account);
  }

  /**
   * @description Registers the caller under the key derived from the private
   * state's encryption key.
   * @param caller - The caller to act as.
   * @returns The registered account id.
   */
  public async register(caller: Caller): Promise<Uint8Array> {
    const ek = (await this.getPrivateState()).encryptionKey;
    return this.registerWithKey(caller, deriveEncryptionPk(ek));
  }

  /**
   * @description Registers the caller under `pk`.
   * @param caller - The caller to act as.
   * @param pk - The caller's encryption public key.
   * @returns The registered account id.
   */
  public registerWithKey(caller: Caller, pk: JubjubPoint): Promise<Uint8Array> {
    return this.circuits.impure.registerWithKey(caller, pk);
  }

  /**
   * @description Credits `value` to the pending balance of `account`.
   * @param account - The recipient account id.
   * @param value - The amount to mint.
   */
  public _mint(account: Uint8Array, value: bigint): Promise<[]> {
    return this.circuits.impure._mint(account, value);
  }

  /**
   * @description Burns `value` from the caller's spendable balance.
   * @param caller - The caller to act as.
   * @param value - The amount to burn.
   * @returns The caller's account id.
   */
  public _burn(caller: Caller, value: bigint): Promise<Uint8Array> {
    return this.circuits.impure._burn(caller, value);
  }

  /**
   * @description Transfers `value` from the caller to `to`.
   * @param caller - The caller to act as.
   * @param to - The recipient account id.
   * @param value - The amount to transfer.
   * @returns The caller's account id.
   */
  public transfer(
    caller: Caller,
    to: Uint8Array,
    value: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure.transfer(caller, to, value);
  }

  /**
   * @description Debits the caller and credits `to` by `value`.
   * @param caller - The caller to act as.
   * @param to - The recipient account id.
   * @param value - The amount to move.
   * @returns The caller's account id.
   */
  public _move(
    caller: Caller,
    to: Uint8Array,
    value: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure._move(caller, to, value);
  }

  /**
   * @description Sweeps the caller's pending balance into its spendable balance.
   * @param caller - The caller to act as.
   * @returns The caller's account id.
   */
  public sweep(caller: Caller): Promise<Uint8Array> {
    return this.circuits.impure.sweep(caller);
  }

  /**
   * @description Escrows `value` of the caller's balance for `spender`.
   * @param caller - The caller to act as.
   * @param spender - The spender account id.
   * @param value - The allowance.
   * @returns The caller's account id.
   */
  public approve(
    caller: Caller,
    spender: Uint8Array,
    value: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure.approve(caller, spender, value);
  }

  /**
   * @description Spends `value` from the escrow `fromAddress` granted the
   * caller and credits it to `to`.
   * @param caller - The caller to act as.
   * @param fromAddress - The owner of the escrow.
   * @param to - The recipient account id.
   * @param value - The amount to transfer.
   * @returns The caller's account id.
   */
  public transferFrom(
    caller: Caller,
    fromAddress: Uint8Array,
    to: Uint8Array,
    value: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure.transferFrom(caller, fromAddress, to, value);
  }

  /**
   * @description Burns `value` from the escrow `fromAddress` granted the caller.
   * @param caller - The caller to act as.
   * @param fromAddress - The owner of the escrow.
   * @param value - The amount to burn.
   * @returns The caller's account id.
   */
  public _burnFrom(
    caller: Caller,
    fromAddress: Uint8Array,
    value: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure._burnFrom(caller, fromAddress, value);
  }

  /**
   * @description Clears the caller's memo list.
   * @param caller - The caller to act as.
   * @param expectedEpoch - The caller's view of its credit epoch.
   */
  public clearMemos(caller: Caller, expectedEpoch: bigint): Promise<[]> {
    return this.circuits.impure.clearMemos(caller, expectedEpoch);
  }

  public readonly privateState = {
    /**
     * @description Replaces the encryption key and clears the plaintext cache.
     * @param ek - The new encryption key.
     */
    switchEncryptionKey: (
      ek: Uint8Array,
    ): Promise<ConfidentialFungibleTokenPrivateState> =>
      this.updatePrivateState({
        encryptionKey: ek,
        plaintextCache: new Map<string, bigint>(),
      }),

    /**
     * @description Records the plaintext of `ct` in the cache.
     * @param ct - The ciphertext.
     * @param plaintext - Its plaintext.
     */
    cachePlaintext: (
      ct: ElGamal_Ciphertext,
      plaintext: bigint,
    ): Promise<ConfidentialFungibleTokenPrivateState> =>
      this.updatePrivateState((current) =>
        ConfidentialFungibleTokenPrivateState.cachePlaintext(
          current,
          ct,
          plaintext,
        ),
      ),
  };
}

export type {
  Caller,
  CFT_EscrowEntry,
  ContractAddress,
  Either,
  ElGamal_Ciphertext,
};
