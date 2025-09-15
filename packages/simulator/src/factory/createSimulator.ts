import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { sampleContractAddress } from '@midnight-ntwrk/zswap';
import { ContractSimulator } from '../core/ContractSimulator.js';
import { StateManager } from '../core/StateManager.js';
import type { IMinimalContract } from '../types/Contract.js';
import type { BaseSimulatorOptions } from '../types/Options.js';
import type { SimulatorConfig } from './SimulatorConfig.js';

/**
 * Factory function to create simulator classes with consistent boilerplate elimination.
 *
 * This factory creates a class that extends ContractSimulator with all the common
 * functionality needed for contract simulation, including:
 * - Witness management
 * - State management
 * - Circuit proxy creation
 * - Options handling
 *
 * @param config - Configuration object defining how to create and manage the simulator
 * @returns A class constructor that can be extended to create specific simulators
 */
export function createSimulator<P, L, W, TArgs extends readonly any[]>(
  config: SimulatorConfig<P, L, W, TArgs>,
) {
  return class GeneratedSimulator extends ContractSimulator<P, L> {
    contract: IMinimalContract;
    readonly contractAddress: string;
    public _witnesses: W;

    /**
     * Creates a new simulator instance with explicit contract args and options
     */
    constructor(
      contractArgs: TArgs = [] as any,
      options: BaseSimulatorOptions<P, W> = {},
    ) {
      super();

      const {
        privateState = config.defaultPrivateState(),
        witnesses = config.witnessesFactory(),
        coinPK = '0'.repeat(64),
        contractAddress = sampleContractAddress(),
      } = options;

      this._witnesses = witnesses;
      this.contract = config.contractFactory(this._witnesses);

      const processedArgs = config.contractArgs(...contractArgs);

      this.stateManager = new StateManager(
        this.contract,
        privateState,
        coinPK,
        contractAddress,
        ...processedArgs,
      );

      this.contractAddress = this.circuitContext.transactionContext.address;
    }

    public _pureCircuitProxy?: any;
    public _impureCircuitProxy?: any;

    /**
     * Gets the pure circuit proxy, creating it lazily if it doesn't exist.
     *
     * @returns The pure circuit proxy for executing read-only contract methods
     */
    public get pureCircuit() {
      if (!this._pureCircuitProxy) {
        this._pureCircuitProxy = this.createPureCircuitProxy(
          this.contract.circuits,
          () => this.circuitContext,
        );
      }
      return this._pureCircuitProxy;
    }

    /**
     * Gets the impure circuit proxy, creating it lazily if it doesn't exist.
     *
     * @returns The impure circuit proxy for executing state-modifying contract methods
     */
    public get impureCircuit() {
      if (!this._impureCircuitProxy) {
        this._impureCircuitProxy = this.createImpureCircuitProxy(
          this.contract.impureCircuits,
          () => this.getCallerContext(),
          (ctx) => {
            this.circuitContext = ctx;
          },
        );
      }
      return this._impureCircuitProxy;
    }

    /**
     * Gets both pure and impure circuit proxies.
     *
     * @returns Object containing both pure and impure circuit proxies
     */
    public get circuits() {
      return {
        pure: this.pureCircuit,
        impure: this.impureCircuit,
      };
    }

    /**
     * Resets cached circuit proxies, forcing re-initialization on next access.
     */
    public resetCircuitProxies(): void {
      this._pureCircuitProxy = undefined;
      this._impureCircuitProxy = undefined;
    }

    /**
     * Extracts the public ledger state from the current contract state.
     *
     * @returns The current public state of the contract
     */
    getPublicState(): L {
      return config.ledgerExtractor(
        this.circuitContext.transactionContext.state,
      );
    }

    // Common witness management methods
    /**
     * Gets the current witness functions.
     *
     * @returns The current witness function implementations
     */
    public get witnesses(): W {
      return this._witnesses;
    }

    /**
     * Sets new witness functions and recreates the contract with them.
     *
     * @param newWitnesses - The new witness function implementations to use
     */
    public set witnesses(newWitnesses: W) {
      this._witnesses = newWitnesses;
      this.contract = config.contractFactory(this._witnesses);
      this.resetCircuitProxies();
    }

    /**
     * Overrides a specific witness function while keeping others unchanged.
     *
     * @param key - The key of the witness function to override
     * @param fn - The new implementation for the witness function
     */
    public overrideWitness<K extends keyof W>(key: K, fn: W[K]) {
      this.witnesses = {
        ...this._witnesses,
        [key]: fn,
      } as W;
    }

    /**
     * Gets the current witness context with the proper structure for witness function calls.
     *
     * @returns The current witness context that can be passed to witness functions
     */
    public getWitnessContext(): WitnessContext<L, P> {
      const circuitCtx = this.circuitContext;
      return {
        ledger: this.getPublicState(),
        privateState: circuitCtx.currentPrivateState,
        contractAddress: circuitCtx.transactionContext.address,
      };
    }
  };
}
