import {
  type AlignedValue,
  type CircuitContext,
  type CircuitResults,
  CostModel,
  type Transcript,
} from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type CFT_EscrowEntry,
  type ElGamal_Ciphertext,
  ledger,
  Contract as MockCFT,
} from '../../../../artifacts/MockConfidentialFungibleToken/contract/index.js';
import {
  ConfidentialFungibleTokenPrivateState,
  ConfidentialFungibleTokenWitnesses,
  DEFAULT_RANDOMNESS_SEED,
} from '../witnesses/ConfidentialFungibleTokenWitnesses.js';

/**
 * The backend internals `captureTranscript` reaches through
 * @dev tmp solution. This is a fragile workaround until
 * the simulator provides a better approach
 */
type SimulatorInternals = {
  _backend: {
    sim: {
      contract: {
        impureCircuits: Record<
          string,
          (ctx: unknown, ...args: unknown[]) => Promise<CircuitResults>
        >;
      };
      circuitContext: CircuitContext;
    };
  };
};

/**
 * Type constructor args
 */
type ConfidentialFungibleTokenArgs = readonly [
  name: string,
  symbol: string,
  decimals: bigint,
];

const ConfidentialFungibleTokenSimulatorBase = createSimulator<
  ConfidentialFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialFungibleTokenWitnesses>,
  MockCFT<ConfidentialFungibleTokenPrivateState>,
  ConfidentialFungibleTokenArgs
>({
  contractFactory: (witnesses) =>
    new MockCFT<ConfidentialFungibleTokenPrivateState>(witnesses),
  defaultPrivateState: () => ConfidentialFungibleTokenPrivateState.generate(),
  contractArgs: (name, symbol, decimals) => [name, symbol, decimals],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialFungibleTokenWitnesses(),
  artifactName: 'MockConfidentialFungibleToken',
});

/**
 * ConfidentialFungibleToken Simulator
 */
export class ConfidentialFungibleTokenSimulator extends ConfidentialFungibleTokenSimulatorBase {
  static async create(
    name: string,
    symbol: string,
    decimals: bigint,
    options: SimulatorOptions<
      ConfidentialFungibleTokenPrivateState,
      ReturnType<typeof ConfidentialFungibleTokenWitnesses>
    > = {},
  ): Promise<ConfidentialFungibleTokenSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [name, symbol, decimals],
      options,
    ) as Promise<ConfidentialFungibleTokenSimulator>;
  }
  /**
   * @description Returns the value of tokens owned by `account`.
   * @param account The public key or contract address to query.
   * @returns The account's token balance.
   */
  public balanceOf(account: Uint8Array): Promise<ElGamal_Ciphertext> {
    return this.circuits.impure.balanceOf(account);
  }

  /**
   * @description Returns the pending (incoming, not-yet-swept) balance ciphertext
   * for `account`. A wallet's total is `balanceOf` (spendable) + `pendingOf`.
   * @param account The account id to query.
   */
  public pendingOf(account: Uint8Array): Promise<ElGamal_Ciphertext> {
    return this.circuits.impure.pendingOf(account);
  }

  /**
   * @description Sweeps the caller's pending pool into their spendable balance.
   * Only the owner can call it (account derived from the caller's secret).
   */
  public sweep(): Promise<Uint8Array> {
    return this.circuits.impure.sweep();
  }

  /**
   * @description Returns the remaining number of tokens that `spender` will be allowed to spend on behalf of `owner`
   * through `transferFrom`. This value changes when `approve` or `transferFrom` are called.
   * @param owner The public key or contract address of approver.
   * @param spender The public key or contract address of spender.
   * @returns The `spender`'s allowance over `owner`'s tokens.
   */
  public allowance(
    owner: Uint8Array,
    spender: Uint8Array,
  ): Promise<CFT_EscrowEntry> {
    return this.circuits.impure.allowance(owner, spender);
  }

  /**
   * @description Moves a `value` amount of tokens from the caller's account to `to`.
   * Reverts on failure (no boolean return).
   * @param to The recipient account id.
   * @param value The amount to transfer.
   */
  public transfer(to: Uint8Array, value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.transfer(to, value);
  }

  /**
   * @description The conserving value-movement primitive: debits the caller and
   * credits `to`, net zero, never touching supply.
   */
  public _move(to: Uint8Array, value: bigint): Promise<Uint8Array> {
    return this.circuits.impure._move(to, value);
  }

  /**
   * @description Moves `value` tokens from `fromAddress` to `to` using the
   * escrow allowance mechanism. Reverts on failure (no boolean return).
   * @param fromAddress The owner whose escrow the caller draws on.
   * @param to The recipient account id.
   * @param value The amount to transfer.
   */
  public transferFrom(
    fromAddress: Uint8Array,
    to: Uint8Array,
    value: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure.transferFrom(fromAddress, to, value);
  }

  /**
   * @description Sets `value` as the escrow allowance of `spender` over the
   * caller's balance. Reverts on failure (no boolean return).
   * @param spender The account id that may spend on behalf of the caller.
   * @param value The amount the `spender` may spend.
   */
  public approve(spender: Uint8Array, value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.approve(spender, value);
  }

  /**
   * @description Test-only funding: mints `value` to `account` via the base's
   * exposed `_mint` building block (a raw credit, no supply bookkeeping). Lands
   * in the recipient's pending pool, so sweep before spending. The supply-free
   * base suite funds accounts with this.
   * @param account The recipient account id.
   * @param value The amount to mint.
   */
  public _mint(account: Uint8Array, value: bigint): Promise<[]> {
    return this.circuits.impure._mint(account, value);
  }

  /**
   * @description Test-only balance proof / drain: burns `value` from the
   * caller's spendable balance via the base's `_burn` building block. Its
   * in-circuit assertDecryptsTo only passes if the balance truly encrypts
   * >= value, so it doubles as the behavioural "holds at least N" check the
   * supply-free suite uses.
   * @param value The amount to burn.
   */
  public _burn(value: bigint): Promise<Uint8Array> {
    return this.circuits.impure._burn(value);
  }

  /**
   * @description Test-only escrow-burn: consumes `value` from the allowance
   * `fromAddress` granted the caller, with no recipient credit (the base's
   * `_spendEscrow` under its burn-intent name). Its in-circuit checks only pass
   * if a sufficient escrow exists, so it doubles as the behavioural allowance check.
   * @param fromAddress The owner whose escrow the caller (spender) draws on.
   * @param value The amount to burn from the allowance.
   */
  public _burnFrom(
    fromAddress: Uint8Array,
    value: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure._burnFrom(fromAddress, value);
  }

  public clearMemos(expectedEpoch: bigint) {
    return this.circuits.impure.clearMemos(expectedEpoch);
  }

  public register(): Promise<Uint8Array> {
    return this.circuits.impure.register();
  }

  public isRegistered(account: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isRegistered(account);
  }

  /**
   * @description Computes an account identifier without on-chain state, allowing a user to derive
   * their identity commitment before submitting it in a grant or revoke operation.
   * @param {Bytes<32>} secretKey - A 32-byte cryptographically secure random value.
   * @returns {Bytes<32>} accountId - The computed account identifier.
   */
  public computeAccountId(secretKey: Uint8Array): Promise<Uint8Array> {
    return this.circuits.pure.computeAccountId(secretKey);
  }

  /**
   * @description Builds a circuit call against the CURRENT state and returns the
   * public transcript it would submit, WITHOUT committing it. Pair with
   * `replayTranscript` to check what the node does when state moves underneath a
   * built-but-unapplied tx: a pinned read that no longer matches is
   * rejected at replay, which is a different mechanism from an in-circuit assert
   * and is not otherwise reachable from a dry test.
   */
  public async captureTranscript(
    circuit: string,
    ...args: unknown[]
  ): Promise<Transcript<AlignedValue>> {
    const sim = (this as unknown as SimulatorInternals)._backend.sim;
    const built = await sim.contract.impureCircuits[circuit](
      sim.circuitContext,
      ...args,
    );
    // The root call is the last entry of the trace; the transcript no longer
    // rides on the result itself since compact-runtime 0.18
    const trace = built.context.callProofDataTrace;
    const call = trace[trace.length - 1];
    const g = built.gasCost;
    return {
      program: call.publicTranscript,
      effects: built.context.callContext.currentQueryContext.effects,
      // A budget, not a measurement: replay costs differ slightly from the build,
      // and an exact figure fails with "ran out of gas budget" before any read is
      // compared, which would look like a rejection for the wrong reason
      gas: {
        readTime: g.readTime * 100n,
        computeTime: g.computeTime * 100n,
        bytesWritten: g.bytesWritten * 100n,
        bytesDeleted: g.bytesDeleted * 100n,
      },
    };
  }

  /**
   * @description Replays a captured transcript against the current state in
   * verifying mode, exactly as a node does when applying a transaction. Throws
   * if a pinned read no longer matches.
   */
  public replayTranscript(t: Transcript<AlignedValue>): void {
    const sim = (this as unknown as SimulatorInternals)._backend.sim;
    sim.circuitContext.callContext.currentQueryContext.runTranscript(
      t,
      CostModel.initialCostModel(),
    );
  }

  public readonly privateState = {
    /**
     * @description Replaces SK in the private state. Used in tests to switch
     * between different user identities or inject incorrect keys to test
     * failure paths.
     */
    injectSecretKey: (
      newSK: Uint8Array,
    ): Promise<ConfidentialFungibleTokenPrivateState> =>
      this.updatePrivateState({ secretKey: newSK }),

    /**
     * @description Replaces EK in the private state. Used in tests to inject
     * a wrong EK and verify the decryption-consistency assertion catches it.
     */
    injectEncryptionKey: (
      newEK: Uint8Array,
    ): Promise<ConfidentialFungibleTokenPrivateState> =>
      this.updatePrivateState({ encryptionKey: newEK }),

    /**
     * @description Replaces SK, EK, and clears the plaintext cache atomically.
     * Used to switch between user identities mid-test (e.g., Alice -> Bob)
     * without leaving Alice's cached plaintexts in Bob's state.
     */
    switchIdentity: (
      newSK: Uint8Array,
      newEK: Uint8Array,
    ): Promise<ConfidentialFungibleTokenPrivateState> =>
      this.updatePrivateState((current) => ({
        secretKey: newSK,
        encryptionKey: newEK,
        plaintextCache: new Map<string, bigint>(),
        randomnessSeed: current.randomnessSeed ?? DEFAULT_RANDOMNESS_SEED,
      })),

    /**
     * @description Sets the randomness seed returned by `wit_RandomnessSeed`.
     * Use to vary randomness between transactions (e.g. to avoid producing
     * identical ciphertexts when repeating the same operation).
     */
    setRandomnessSeed: (
      seed: Uint8Array,
    ): Promise<ConfidentialFungibleTokenPrivateState> =>
      this.updatePrivateState({ randomnessSeed: seed }),

    /**
     * @description Returns the current SK.
     */
    getCurrentSecretKey: async (): Promise<Uint8Array> => {
      const sk = (await this.getPrivateState()).secretKey;
      if (typeof sk === 'undefined') {
        throw new Error('Missing secret key');
      }
      return sk;
    },

    /**
     * @description Returns the current EK.
     */
    getCurrentEncryptionKey: async (): Promise<Uint8Array> => {
      const ek = (await this.getPrivateState()).encryptionKey;
      if (typeof ek === 'undefined') {
        throw new Error('Missing encryption key');
      }
      return ek;
    },

    /**
     * @description Records a known plaintext for a ciphertext in the wallet's
     * cache. Tests call this after any operation that changes a balance
     * ciphertext, since the wallet would normally do this automatically as
     * part of constructing the transaction.
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

    /**
     * @description Looks up a cached plaintext by ciphertext. Returns
     * undefined if not cached.
     */
    lookupPlaintext: async (
      ct: ElGamal_Ciphertext,
    ): Promise<bigint | undefined> => {
      return ConfidentialFungibleTokenPrivateState.lookupPlaintext(
        await this.getPrivateState(),
        ct,
      );
    },

    /**
     * @description Returns the entire plaintext cache. Useful for assertions
     * about cache contents in tests.
     */
    getCache: async (): Promise<Map<string, bigint>> => {
      return new Map((await this.getPrivateState()).plaintextCache);
    },

    /**
     * @description Clears the plaintext cache without changing SK/EK. Used in
     * tests that simulate cache loss while preserving identity.
     */
    clearCache: (): Promise<ConfidentialFungibleTokenPrivateState> =>
      this.updatePrivateState({ plaintextCache: new Map<string, bigint>() }),

    /**
     * @description Returns the accountId derived from the current SK. Wraps
     * the contract's pure `computeAccountId` for convenience in tests.
     */
    getCurrentAccountId: async (): Promise<Uint8Array> => {
      const sk = (await this.getPrivateState()).secretKey;
      if (typeof sk === 'undefined') {
        throw new Error('Missing secret key');
      }
      return this.circuits.pure.computeAccountId(sk);
    },
  };
}
