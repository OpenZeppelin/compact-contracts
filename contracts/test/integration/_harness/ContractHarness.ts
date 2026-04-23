import type {
  DeployedContract,
  FoundContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';

/**
 * Integration-side counterpart of `@openzeppelin-compact/contracts-simulator`.
 *
 * Where the unit-test `createSimulator(...)` factory wraps a Contract for
 * in-memory evolution of `QueryContext` / `CircuitContext`, this class wraps
 * a `DeployedContract<C>` on the **real local node** and surfaces exactly the
 * same kind of typed per-circuit methods to specs.
 *
 * Subclasses add module-specific helpers on top of the three typed surfaces:
 *   - `callTx`                — typed `CircuitCallTxInterface<C>`, for circuit calls
 *   - `circuitMaintenanceTx`  — typed per-circuit VK insert/remove
 *   - `contractMaintenanceTx` — contract-level `replaceAuthority`
 *
 * Plus ledger reads via the abstract `ledgerOf(...)` + convenience
 * `readLedger()`.
 *
 * @typeParam C      The compiled Contract class type (e.g. `MockPausable<PS>`).
 * @typeParam Ledger The shape of the contract's public ledger (e.g. `{ Pausable__isPaused: boolean }`).
 */
export abstract class ContractHarness<C, Ledger> {
  constructor(
    public readonly deployed: DeployedContract<C> | FoundContract<C>,
    public readonly providers: MidnightProviders<string, string, unknown>,
    public readonly wallet: MidnightWalletProvider,
  ) {}

  /** Typed circuit calls (e.g. `this.callTx.pause()`). */
  get callTx(): DeployedContract<C>['callTx'] {
    return this.deployed.callTx;
  }

  /** Typed per-circuit maintenance — `removeVerifierKey()` / `insertVerifierKey(vk)`. */
  get circuitMaintenanceTx(): DeployedContract<C>['circuitMaintenanceTx'] {
    return this.deployed.circuitMaintenanceTx;
  }

  /** Contract-level maintenance (`replaceAuthority`). */
  get contractMaintenanceTx(): DeployedContract<C>['contractMaintenanceTx'] {
    return this.deployed.contractMaintenanceTx;
  }

  /** Hex-encoded on-chain address of the deployed contract. */
  get contractAddress(): string {
    return this.deployed.deployTxData.public.contractAddress;
  }

  /**
   * Subclass hook: deserialize the public `ChargedState` returned by the
   * indexer into the contract-specific ledger shape. Typically just:
   * `return <contract>Ledger(data);`
   */
  protected abstract ledgerOf(data: unknown): Ledger;

  /**
   * Fetch the current on-chain public ledger via the indexer and deserialize.
   * Throws if the indexer has no record yet (e.g. race right after deploy).
   */
  async readLedger(): Promise<Ledger> {
    const state = await this.providers.publicDataProvider.queryContractState(
      this.contractAddress,
    );
    if (!state) {
      throw new Error(
        `readLedger: no ContractState available for ${this.contractAddress}`,
      );
    }
    return this.ledgerOf(state.data);
  }

  /**
   * Shut down the wallet cleanly. Call from `afterAll` to avoid hanging
   * handles across test files.
   */
  async teardown(): Promise<void> {
    await this.wallet.stop();
  }
}
