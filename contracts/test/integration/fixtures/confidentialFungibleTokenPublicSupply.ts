import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ElGamal_Ciphertext,
  ledger,
  Contract as MockConfidentialFungibleTokenPublicSupply,
  type Token_EscrowEntry,
} from '../../../artifacts/ConfidentialFungibleTokenPublicSupply/contract/index.js';
import {
  ConfidentialFungibleTokenPrivateState,
  ConfidentialFungibleTokenWitnesses,
  DEFAULT_RANDOMNESS_SEED,
} from '../../../src/token/test/witnesses/ConfidentialFungibleTokenWitnesses.js';

/**
 * Integration fixture for the assembled ConfidentialFungibleToken + PublicSupply
 * contract (`test/integration/_mocks/ConfidentialFungibleTokenPublicSupply`).
 *
 * It reuses the base token's confidential-token witnesses and private state (SK,
 * EK, plaintext cache, randomness seed) verbatim — the assembled contract's
 * witness surface is exactly the base's — and adds the composed `mint`/`burn`/
 * `burnFrom` and the public `totalSupply` getter. The spec drives it to assert
 * that each supply-changing op moves `totalSupply` in lockstep with the value op.
 */
type ConfidentialFungibleTokenPublicSupplyArgs = readonly [
  name: string,
  symbol: string,
  decimals: bigint,
];

const Base = createSimulator<
  ConfidentialFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialFungibleTokenWitnesses>,
  MockConfidentialFungibleTokenPublicSupply<ConfidentialFungibleTokenPrivateState>,
  ConfidentialFungibleTokenPublicSupplyArgs
>({
  contractFactory: (witnesses) =>
    new MockConfidentialFungibleTokenPublicSupply<ConfidentialFungibleTokenPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => ConfidentialFungibleTokenPrivateState.generate(),
  contractArgs: (name, symbol, decimals) => [name, symbol, decimals],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialFungibleTokenWitnesses(),
  artifactName: 'ConfidentialFungibleTokenPublicSupply',
});

export class ConfidentialFungibleTokenPublicSupplySimulator extends Base {
  static async create(
    name: string,
    symbol: string,
    decimals: bigint,
    options: SimulatorOptions<
      ConfidentialFungibleTokenPrivateState,
      ReturnType<typeof ConfidentialFungibleTokenWitnesses>
    > = {},
  ): Promise<ConfidentialFungibleTokenPublicSupplySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [name, symbol, decimals],
      options,
    ) as Promise<ConfidentialFungibleTokenPublicSupplySimulator>;
  }

  /** @description The public circulating supply (disclosed on chain). */
  public totalSupply(): Promise<bigint> {
    return this.circuits.impure.totalSupply();
  }

  public register(): Promise<Uint8Array> {
    return this.circuits.impure.register();
  }

  public sweep(): Promise<Uint8Array> {
    return this.circuits.impure.sweep();
  }

  public balanceOf(account: Uint8Array): Promise<ElGamal_Ciphertext> {
    return this.circuits.impure.balanceOf(account);
  }

  public pendingOf(account: Uint8Array): Promise<ElGamal_Ciphertext> {
    return this.circuits.impure.pendingOf(account);
  }

  public allowance(
    owner: Uint8Array,
    spender: Uint8Array,
  ): Promise<Token_EscrowEntry> {
    return this.circuits.impure.allowance(owner, spender);
  }

  public approve(spender: Uint8Array, value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.approve(spender, value);
  }

  public transferFrom(
    fromAddress: Uint8Array,
    to: Uint8Array,
    value: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure.transferFrom(fromAddress, to, value);
  }

  /** @description Composed mint: bumps `totalSupply` by `value`, then credits `account`. */
  public mint(account: Uint8Array, value: bigint): Promise<[]> {
    return this.circuits.impure.mint(account, value);
  }

  /** @description Composed burn: debits the caller, then drops `totalSupply` by `value`. */
  public burn(value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.burn(value);
  }

  /** @description Composed burnFrom: spends the caller's escrow, then drops `totalSupply`. */
  public burnFrom(fromAddress: Uint8Array, value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.burnFrom(fromAddress, value);
  }

  public readonly privateState = {
    /**
     * @description Replaces SK, EK, and clears the plaintext cache atomically,
     * to switch between user identities mid-test.
     */
    switchIdentity: async (
      newSK: Uint8Array,
      newEK: Uint8Array,
    ): Promise<ConfidentialFungibleTokenPrivateState> => {
      const updated = {
        secretKey: newSK,
        encryptionKey: newEK,
        plaintextCache: new Map<string, bigint>(),
        randomnessSeed:
          (await this.getPrivateState()).randomnessSeed ??
          DEFAULT_RANDOMNESS_SEED,
      };
      this.setPrivateState(updated);
      return updated;
    },

    /**
     * @description Records a known plaintext for a ciphertext in the wallet's
     * cache (what a real wallet does when it constructs or decrypts a value).
     */
    cachePlaintext: async (
      ct: ElGamal_Ciphertext,
      plaintext: bigint,
    ): Promise<ConfidentialFungibleTokenPrivateState> => {
      const current = await this.getPrivateState();
      const updated = ConfidentialFungibleTokenPrivateState.cachePlaintext(
        current,
        ct,
        plaintext,
      );
      this.setPrivateState(updated);
      return updated;
    },
  };
}
