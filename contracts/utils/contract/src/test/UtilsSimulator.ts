import {
  type CircuitContext,
  CoinPublicKey,
  type ContractState,
  QueryContext,
  constructorContext,
  emptyZswapLocalState,
} from '@midnight-ntwrk/compact-runtime';
import { sampleContractAddress } from '@midnight-ntwrk/zswap';
import {
  type Ledger,
  Contract as MockUtils,
  ledger,
  Either,
  ZswapCoinPublicKey,
  ContractAddress,
} from '../artifacts/MockUtils/contract/index.cjs'; // Combined imports
import { MaybeString } from './types.js';
import type { IContractSimulator } from '../types/index.js';
import { UtilsPrivateState, UtilsWitnesses } from '../witnesses/index.js';

/**
 * @description A simulator implementation of an utils contract for testing purposes.
 * @template P - The private state type, fixed to UtilsPrivateState.
 * @template L - The ledger type, fixed to Contract.Ledger.
 */
export class UtilsContractSimulator
  implements IContractSimulator<UtilsPrivateState, Ledger>
{
  /** @description The underlying contract instance managing contract logic. */
  readonly contract: MockUtils<UtilsPrivateState>;

  /** @description The deployed address of the contract. */
  readonly contractAddress: string;

  /** @description The current circuit context, updated by contract operations. */
  circuitContext: CircuitContext<UtilsPrivateState>;

  /**
   * @description Initializes the mock contract.
   */
  constructor() {
    this.contract = new MockUtils<UtilsPrivateState>(
      UtilsWitnesses,
    );
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      constructorContext({}, '0'.repeat(64))
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
   * @returns The private state of type UtilsPrivateState.
   */
  public getCurrentPrivateState(): UtilsPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  /**
   * @description Retrieves the current contract state.
   * @returns The contract state object.
   */
  public getCurrentContractState(): ContractState {
    return this.circuitContext.originalState;
  }

//  /**
//   * @description Returns the token name.
//   * @returns The token name.
//   */
//  public name(): MaybeString {
//    return this.contract.impureCircuits.name(this.circuitContext).result;
//  }
//
//  /**
//   * @description Returns the symbol of the token.
//   * @returns The token name.
//   */
//  public symbol(): MaybeString {
//    return this.contract.impureCircuits.symbol(this.circuitContext).result;
//  }
//
//  /**
//   * @description Returns the number of decimals used to get its user representation.
//   * @returns The account's token balance.
//   */
//  public decimals(): bigint {
//    return this.contract.impureCircuits.decimals(this.circuitContext).result;
//  }
//
//  /**
//   * @description Returns the value of tokens in existence.
//   * @returns The total supply of tokens.
//   */
//  public totalSupply(): bigint {
//    return this.contract.impureCircuits.totalSupply(this.circuitContext).result;
//  }
//
//  /**
//   * @description Returns the value of tokens owned by `account`.
//   * @param account The public key or contract address to query.
//   * @returns The account's token balance.
//   */
//  public balanceOf(account: Either<ZswapCoinPublicKey, ContractAddress>): bigint {
//    return this.contract.impureCircuits.balanceOf(this.circuitContext, account).result;
//  }
//
//  /**
//   * @description Returns the remaining number of tokens that `spender` will be allowed to spend on behalf of `owner`
//   * through `transferFrom`. This value changes when `approve` or `transferFrom` are called.
//   * @param owner The public key or contract address of approver.
//   * @param spender The public key or contract address of spender.
//   * @returns The `spender`'s allowance over `owner`'s tokens.
//   */
//  public allowance(
//    owner: Either<ZswapCoinPublicKey, ContractAddress>,
//    spender: Either<ZswapCoinPublicKey, ContractAddress>
//  ): bigint {
//    return this.contract.impureCircuits.allowance(this.circuitContext, owner, spender).result;
//  }
//
//  /**
//   * @description Moves a `value` amount of tokens from the caller's account to `to`.
//   * @param to The recipient of the transfer, either a user or a contract.
//   * @param value The amount to transfer.
//   * @param sender The simulated caller.
//   * @returns As per the IUtils spec, this MUST return true.
//   */
//  public transfer(to: Either<ZswapCoinPublicKey, ContractAddress>, value: bigint, sender?: CoinPublicKey): boolean {
//    const res = this.contract.impureCircuits.transfer({
//        ...this.circuitContext,
//        currentZswapLocalState: sender
//          ? emptyZswapLocalState(sender)
//          : this.circuitContext.currentZswapLocalState,
//        }, to, value
//    );
//
//    this.circuitContext = res.context;
//    return res.result;
//  }
//
//  /**
//   * @description Moves `value` tokens from `from` to `to` using the allowance mechanism.
//   * `value` is the deducted from the caller's allowance.
//   * @param from The current owner of the tokens for the transfer, either a user or a contract.
//   * @param to The recipient of the transfer, either a user or a contract.
//   * @param value The amount to transfer.
//   * @param sender The simulated caller.
//   * @returns As per the IUtils spec, this MUST return true.
//   */
//  public transferFrom(
//    from: Either<ZswapCoinPublicKey, ContractAddress>,
//    to: Either<ZswapCoinPublicKey, ContractAddress>,
//    value: bigint,
//    sender?: CoinPublicKey
//  ): boolean {
//    const res = this.contract.impureCircuits.transferFrom({
//        ...this.circuitContext,
//        currentZswapLocalState: sender
//          ? emptyZswapLocalState(sender)
//          : this.circuitContext.currentZswapLocalState,
//        },
//        from, to, value
//    );
//
//    this.circuitContext = res.context;
//    return res.result;
//  }
//
//  /**
//   * @description Sets a `value` amount of tokens as allowance of `spender` over the caller's tokens.
//   * @param spender The Zswap key or ContractAddress that may spend on behalf of the caller.
//   * @param value The amount of tokens the `spender` may spend.
//   * @param sender The simulated caller.
//   * @returns Returns a boolean value indicating whether the operation succeeded.
//   */
//  public approve(spender: Either<ZswapCoinPublicKey, ContractAddress>, value: bigint, sender?: CoinPublicKey): boolean {
//    const res = this.contract.impureCircuits.approve({
//        ...this.circuitContext,
//        currentZswapLocalState: sender
//          ? emptyZswapLocalState(sender)
//          : this.circuitContext.currentZswapLocalState,
//        },
//        spender, value
//    );
//
//    this.circuitContext = res.context;
//    return res.result;
//  }
//
//  ///
//  /// Internal
//  ///
//
//  /**
//   * @description Sets `value` as the allowance of `spender` over the `owner`'s tokens.
//   * This internal function is equivalent to `approve`, and can be used to
//   * e.g. set automatic allowances for certain subsystems, etc.
//   * @param owner The owner of the tokens.
//   * @param spender The spender of the tokens.
//   * @param value The amount of tokens `spender` may spend on behalf of `owner`.
//   * @returns None.
//   */
//  public _approve(
//    owner: Either<ZswapCoinPublicKey, ContractAddress>,
//    spender: Either<ZswapCoinPublicKey, ContractAddress>,
//    value: bigint
//  ) {
//    this.circuitContext = this.contract.impureCircuits._approve(this.circuitContext, owner, spender, value).context;
//  }
//
//  /**
//   * @description Moves a `value` amount of tokens from `from` to `to`.
//   * This internal function is equivalent to {transfer}, and can be used to
//   * e.g. implement automatic token fees, slashing mechanisms, etc.
//   * @param from The owner of the tokens to transfer.
//   * @param to The receipient of the transferred tokens.
//   * @param value The amount of tokens to transfer.
//   */
//  public _transfer(
//    from: Either<ZswapCoinPublicKey, ContractAddress>,
//    to: Either<ZswapCoinPublicKey, ContractAddress>,
//    value: bigint,
//  ) {
//    this.circuitContext = this.contract.impureCircuits._transfer(this.circuitContext, from, to, value).context;
//  }
//
//  /**
//   * @description Creates a `value` amount of tokens and assigns them to `account`,
//   * by transferring it from the zero address. Relies on the `update` mechanism.
//   * @param account The recipient of tokens minted.
//   * @param value The amount of tokens minted.
//   */
//  public _mint(account: Either<ZswapCoinPublicKey, ContractAddress>, value: bigint) {
//    this.circuitContext = this.contract.impureCircuits._mint(this.circuitContext, account, value).context;
//  }
//
//  /**
//   * @description Destroys a `value` amount of tokens from `account`, lowering the total supply.
//   * Relies on the `_update` mechanism.
//   * @param account The target owner of tokens to burn.
//   * @param value The amount of tokens to burn.
//   */
//  public _burn(account: Either<ZswapCoinPublicKey, ContractAddress>, value: bigint) {
//    this.circuitContext = this.contract.impureCircuits._burn(this.circuitContext, account, value).context;
//  }
//
//  /**
//   * @description Transfers a `value` amount of tokens from `from` to `to`, or alternatively mints (or burns) if `from`
//   * (or `to`) is the zero address.
//   * @param from The original owner of the tokens moved (which is 0 if tokens are minted).
//   * @param to The recipient of the tokens moved (which is 0 if tokens are burned).
//   * @param value The amount of tokens moved from `from` to `to`.
//   */
//  public _update(
//    from: Either<ZswapCoinPublicKey, ContractAddress>,
//    to: Either<ZswapCoinPublicKey, ContractAddress>,
//    value: bigint
//  ) {
//    this.circuitContext = this.contract.impureCircuits._update(this.circuitContext, from, to, value).context;
//  }
//
//  /**
//   * @description Updates `owner`'s allowance for `spender` based on spent `value`.
//   * Does not update the allowance value in case of infinite allowance.
//   * @param owner The owner of the tokens.
//   * @param spender The spender of the tokens.
//   * @param value The amount of token allowance to spend.
//   */
//  public _spendAllowance(
//    owner: Either<ZswapCoinPublicKey, ContractAddress>,
//    spender: Either<ZswapCoinPublicKey, ContractAddress>,
//    value: bigint
//  ) {
//    this.circuitContext = this.contract.impureCircuits._spendAllowance(this.circuitContext, owner, spender, value).context;
//  }
//
  /**
   * @description Returns whether `keyOrAddress` is the zero address.
   * @param keyOrAddress The target value to check, either a ZswapCoinPublicKey or a ContractAddress.
   * @returns Returns true if `keyOrAddress` is zero.
   */
  public isZero(keyOrAddress: Either<ZswapCoinPublicKey, ContractAddress>): boolean {
    return this.contract.circuits.isZero(this.circuitContext, keyOrAddress).result;
  }
}
