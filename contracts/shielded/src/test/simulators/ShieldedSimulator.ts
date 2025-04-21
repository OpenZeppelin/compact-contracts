import {
  type CircuitContext,
  CoinPublicKey,
  type ContractState,
  QueryContext,
  constructorContext,
  emptyZswapLocalState,
  CircuitResults
} from '@midnight-ntwrk/compact-runtime';
import { sampleContractAddress } from '@midnight-ntwrk/zswap';
import {
  type Ledger,
  Contract as MockShielded,
  ledger,
  Either,
  CoinInfo,
  ZswapCoinPublicKey,
  ContractAddress,
  SendResult
} from '../../artifacts/MockShielded/contract/index.cjs'; // Combined imports
import { MaybeString } from '../types';
import type { IContractSimulator } from '../types';
import { ShieldedPrivateState, ShieldedWitnesses } from '../../witnesses/ShieldedWitnesses';

/**
 * @description A simulator implementation of an erc20 contract for testing purposes.
 * @template P - The private state type, fixed to ERC20PrivateState.
 * @template L - The ledger type, fixed to Contract.Ledger.
 */
export class ShieldedSimulator
  implements IContractSimulator<ShieldedPrivateState, Ledger>
{
  /** @description The underlying contract instance managing contract logic. */
  readonly contract: MockShielded<ShieldedPrivateState>;

  /** @description The deployed address of the contract. */
  readonly contractAddress: string;

  /** @description The current circuit context, updated by contract operations. */
  circuitContext: CircuitContext<ShieldedPrivateState>;

  /**
   * @description Initializes the mock contract.
   */
  constructor(nonce: Uint8Array, name: MaybeString, symbol: MaybeString, decimals: bigint) {
    this.contract = new MockShielded<ShieldedPrivateState>(
      ShieldedWitnesses,
    );
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      constructorContext({}, '0'.repeat(64)), nonce, name, symbol, decimals,
    );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      originalState: currentContractState,
      transactionContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };
    this.contractAddress = this.circuitContext.transactionContext.address;
  }

  /**
   * @description Retrieves the current public ledger state of the contract.
   * @returns The ledger state as defined by the contract.
   */
  public getCurrentPublicState(): Ledger {
    return ledger(this.circuitContext.transactionContext.state);
  }

  /**
   * @description Retrieves the current private state of the contract.
   * @returns The private state of type ERC20PrivateState.
   */
  public getCurrentPrivateState(): ShieldedPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  /**
   * @description Retrieves the current contract state.
   * @returns The contract state object.
   */
  public getCurrentContractState(): ContractState {
    return this.circuitContext.originalState;
  }

  /**
   * @description Returns the token name.
   * @returns The token name.
   */
  public name(): MaybeString {
    return this.contract.impureCircuits.name(this.circuitContext).result;
  }

  /**
   * @description Returns the symbol of the token.
   * @returns The token name.
   */
  public symbol(): MaybeString {
    return this.contract.impureCircuits.symbol(this.circuitContext).result;
  }

  /**
   * @description Returns the number of decimals used to get its user representation.
   * @returns The account's token balance.
   */
  public decimals(): bigint {
    return this.contract.impureCircuits.decimals(this.circuitContext).result;
  }

  /**
   * @description Returns the value of tokens in existence.
   * @returns The total supply of tokens.
   */
  public totalSupply(): bigint {
    return this.contract.impureCircuits.totalSupply(this.circuitContext).result;
  }

  public mint(recipient: Either<ZswapCoinPublicKey, ContractAddress>, amount: bigint, sender?: CoinPublicKey): CircuitResults<ShieldedPrivateState, CoinInfo> {
    const res = this.contract.impureCircuits.mint({
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState,
      }, recipient, amount
    );

    this.circuitContext = res.context;
    return res;
  }

  public burn(coin: CoinInfo, amount: bigint, sender?: CoinPublicKey): CircuitResults<ShieldedPrivateState, SendResult> {
    const res = this.contract.impureCircuits.burn({
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState,
      }, coin, amount
    );

    this.circuitContext = res.context;
    return res;
  }
}