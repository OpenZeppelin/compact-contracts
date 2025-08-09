import {
  type CircuitContext,
  type CoinPublicKey,
  type ContractState,
  emptyZswapLocalState,
} from '@midnight-ntwrk/compact-runtime';
import { sampleContractAddress } from '@midnight-ntwrk/zswap';
import type { ZswapCoinPublicKey } from '../../artifacts/MockZ_OwnablePK/contract/index.cjs';
import {
  type Ledger,
  ledger,
  Contract as MockOwnable,
} from '../../artifacts/MockZ_OwnablePK/contract/index.cjs'; // Combined imports
import {
Z_OwnablePKPrivateState,
  Z_OwnablePKWitnesses,
} from '../../witnesses/Z_OwnablePKWitnesses.js';
import { AbstractContractSimulator } from '../utils/AbstractContractSimulator.js';
import { SimulatorStateManager } from '../utils/SimualatorStateManager.js';
import { ContextlessCircuits, ExtractImpureCircuits, ExtractPureCircuits } from '../types/test.js';


/**
 * @description A simulator implementation of a contract for testing purposes.
 * @template P - The private state type, fixed to Z_OwnablePKPrivateState.
 * @template L - The ledger type, fixed to Contract.Ledger.
 */
export class Z_OwnablePKSimulator extends AbstractContractSimulator<
  Z_OwnablePKPrivateState,
  Ledger
> {
  readonly contract: MockOwnable<Z_OwnablePKPrivateState>;
  readonly contractAddress: string;
  private stateManager: SimulatorStateManager<Z_OwnablePKPrivateState>;
  private callerOverride: CoinPublicKey | null = null;

  private _pureCircuitProxy?: ContextlessCircuits<
    ExtractPureCircuits<MockOwnable<Z_OwnablePKPrivateState>>,
    Z_OwnablePKPrivateState
  >;

  private _impureCircuitProxy?: ContextlessCircuits<
    ExtractImpureCircuits<MockOwnable<Z_OwnablePKPrivateState>>,
    Z_OwnablePKPrivateState
  >;

  constructor(initOwner: Uint8Array) {
    super();
    this.contract = new MockOwnable<Z_OwnablePKPrivateState>(
      Z_OwnablePKWitnesses(),
    );
    // Setup initial state
    const privateState: Z_OwnablePKPrivateState = Z_OwnablePKPrivateState.generate();
    const coinPK = '0'.repeat(64);
    const address = sampleContractAddress();
    const constructorArgs = [initOwner];

    this.stateManager = new SimulatorStateManager(
      this.contract,
      privateState,
      coinPK,
      address,
      ...constructorArgs,
    );
    this.contractAddress = this.circuitContext.transactionContext.address;
  }

  get circuitContext() {
    return this.stateManager.getContext();
  }

  set circuitContext(ctx) {
    this.stateManager.setContext(ctx);
  }

  getPublicState(): Ledger {
    return ledger(this.circuitContext.transactionContext.state);
  }

  /**
   * @description Constructs a caller-specific circuit context.
   * If a caller override is present, it replaces the current Zswap local state with an empty one
   * scoped to the overridden caller. Otherwise, the existing context is reused as-is.
   * @returns A circuit context adjusted for the current simulated caller.
   */
  protected getCallerContext(): CircuitContext<Z_OwnablePKPrivateState> {
    return {
      ...this.circuitContext,
      currentZswapLocalState: this.callerOverride
        ? emptyZswapLocalState(this.callerOverride)
        : this.circuitContext.currentZswapLocalState,
    };
  }

  /**
   * @description Initializes and returns a proxy to pure contract circuits.
   * The proxy automatically injects the current circuit context into each call,
   * and returns only the result portion of each circuit's output.
   * @notice The proxy is created only when first accessed a.k.a lazy initialization.
   * This approach is efficient in cases where only pure or only impure circuits are used,
   * avoiding unnecessary proxy creation.
   * @returns A proxy object exposing pure circuit functions without requiring explicit context.
   */
  protected get pureCircuit(): ContextlessCircuits<
    ExtractPureCircuits<MockOwnable<Z_OwnablePKPrivateState>>,
    Z_OwnablePKPrivateState
  > {
    if (!this._pureCircuitProxy) {
      this._pureCircuitProxy = this.createPureCircuitProxy<
        MockOwnable<Z_OwnablePKPrivateState>['circuits']
      >(this.contract.circuits, () => this.circuitContext);
    }
    return this._pureCircuitProxy;
  }

  /**
   * @description Initializes and returns a proxy to impure contract circuits.
   * The proxy automatically injects the current (possibly caller-modified) context into each call,
   * and updates the circuit context with the one returned by the circuit after execution.
   * @notice The proxy is created only when first accessed a.k.a. lazy initialization.
   * This approach is efficient in cases where only pure or only impure circuits are used,
   * avoiding unnecessary proxy creation.
   * @returns A proxy object exposing impure circuit functions without requiring explicit context management.
   */
  protected get impureCircuit(): ContextlessCircuits<
    ExtractImpureCircuits<MockOwnable<Z_OwnablePKPrivateState>>,
    Z_OwnablePKPrivateState
  > {
    if (!this._impureCircuitProxy) {
      this._impureCircuitProxy = this.createImpureCircuitProxy<
        MockOwnable<Z_OwnablePKPrivateState>['impureCircuits']
      >(
        this.contract.impureCircuits,
        () => this.getCallerContext(),
        (ctx: any) => {
          this.circuitContext = ctx;
        },
      );
    }
    return this._impureCircuitProxy;
  }

  /**
   * @description Sets the caller context.
   * @param caller The caller in context of the proceeding circuit calls.
   */
  public setCaller(caller: CoinPublicKey | null): void {
    this.callerOverride = caller;
  }

  /**
   * @description Resets the cached circuit proxy instances.
   * This is useful if the underlying contract state or circuit context has changed,
   * and you want to ensure the proxies are recreated with updated context on next access.
   */
  public resetCircuitProxies(): void {
    this._pureCircuitProxy = undefined;
    this._impureCircuitProxy = undefined;
  }

  /**
   * @description Helper method that provides access to both pure and impure circuit proxies.
   * These proxies automatically inject the appropriate circuit context when invoked.
   * @returns An object containing `pure` and `impure` circuit proxy interfaces.
   */
  public get circuits() {
    return {
      pure: this.pureCircuit,
      impure: this.impureCircuit,
    };
  }

  /**
   * @description Returns the shielded owner.
   * @returns The shielded owner.
   */
  public owner(): Uint8Array {
    return this.circuits.impure.owner();
  }

  /**
   * @description
   */
  public transferOwnership(
    newOwner: Uint8Array,
  ) {
    this.circuits.impure.transferOwnership(newOwner);
  }

  /**
   * @description Leaves the contract without an owner. It will not be
   * possible to call `assertOnlyOnwer` circuits anymore. Can only be
   * called by the current owner.
   */
  public renounceOwnership() {
    this.circuits.impure.renounceOwnership();
  }

  /**
   * @description Throws if called by any account other than the owner.
   * Use this to restrict access to sensitive circuits.
   */
  public assertOnlyOwner() {
    this.circuits.impure.assertOnlyOwner();
  }

  /**
   * @description Obfuscates the `pk` be hashing it with a domain separator and
   * the passed `instance`.
   * @returns The shielded hash of the owner and instance.
   */
  public shieldPK(
    pk: ZswapCoinPublicKey,
    instance: bigint,
    nonce: Uint8Array
  ): Uint8Array {
    return this.circuits.pure.shieldPK(pk, instance, nonce);
  }

  /**
   * @description Internal circuit that transfers ownership of the contract to `newOwner`.
   */
  public _transferOwnership(newOwnerCommitment: Uint8Array) {
    this.circuits.impure._transferOwnership(newOwnerCommitment);
  }
}
