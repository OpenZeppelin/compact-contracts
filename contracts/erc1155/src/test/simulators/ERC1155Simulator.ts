import {
  type CircuitContext,
  CoinPublicKey,
  type ContractState,
  QueryContext,
  constructorContext,
  emptyZswapLocalState
} from '@midnight-ntwrk/compact-runtime';
import { sampleContractAddress } from '@midnight-ntwrk/zswap';
import {
  type Ledger,
  Contract as MockERC1155,
  ledger,
  Either,
  ZswapCoinPublicKey,
  ContractAddress
} from '../../artifacts/MockERC1155/contract/index.cjs'; // Combined imports
import { MaybeString } from '../types';
import type { IContractSimulator } from '../types';
import { ERC1155PrivateState, ERC1155Witnesses } from '../../witnesses';

/**
 * @description A simulator implementation of an erc1155 contract for testing purposes.
 * @template P - The private state type, fixed to ERC1155PrivateState.
 * @template L - The ledger type, fixed to Contract.Ledger.
 */
export class ERC1155Simulator
  implements IContractSimulator<ERC1155PrivateState, Ledger>
{
  /** @description The underlying contract instance managing contract logic. */
  readonly contract: MockERC1155<ERC1155PrivateState>;

  /** @description The deployed address of the contract. */
  readonly contractAddress: string;

  /** @description The current circuit context, updated by contract operations. */
  circuitContext: CircuitContext<ERC1155PrivateState>;

  /**
   * @description Initializes the mock contract.
   */
  constructor(uri: MaybeString) {
    this.contract = new MockERC1155<ERC1155PrivateState>(
      ERC1155Witnesses,
    );
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      constructorContext({}, '0'.repeat(64)), uri
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
   * @returns The private state of type ERC1155PrivateState.
   */
  public getCurrentPrivateState(): ERC1155PrivateState {
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
   * @description Returns the token URI.
   * @returns The token URI.
   */
  public uri(id: bigint): MaybeString {
    return this.contract.impureCircuits.uri(this.circuitContext, id).result;
  }

  /**
   * @description
   * @returns
   */
  public balanceOf(account: Either<ZswapCoinPublicKey, ContractAddress>, id: bigint): bigint {
    return this.contract.impureCircuits.balanceOf(this.circuitContext, account, id).result;
  }

  /**
   * @description
   * @returns
   */
  public balanceOfBatch_10(accounts: Array<Either<ZswapCoinPublicKey, ContractAddress>>, ids: Array<bigint>): Array<bigint> {
    return this.contract.impureCircuits.balanceOfBatch_10(this.circuitContext, accounts, ids).result;
  }

  public setApprovalForAll(operator: Either<ZswapCoinPublicKey, ContractAddress>, approved: boolean, sender?: CoinPublicKey) {
    const res = this.contract.impureCircuits.setApprovalForAll({
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState,
        },
        operator, approved
    );

    this.circuitContext = res.context;
    return res.result;
  }

  public isApprovedForAll(
    account: Either<ZswapCoinPublicKey, ContractAddress>,
    operator: Either<ZswapCoinPublicKey, ContractAddress>
  ): Boolean {
    return this.contract.impureCircuits.isApprovedForAll(this.circuitContext, account, operator).result;
  }

  public transferFrom(
    from: Either<ZswapCoinPublicKey, ContractAddress>,
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    id: bigint,
    value: bigint,
    sender?: CoinPublicKey
  ) {
    const res = this.contract.impureCircuits.transferFrom({
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState,
        },
        from, to, id, value
    );

    this.circuitContext = res.context;
    return res.result;
  }

  public _transferFrom(
    from: Either<ZswapCoinPublicKey, ContractAddress>,
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    id: bigint,
    value: bigint,
    sender?: CoinPublicKey
  ) {
    const res = this.contract.impureCircuits._transferFrom({
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState,
        },
        from, to, id, value
    );

    this.circuitContext = res.context;
    return res.result;
  }

  public _update(
    from: Either<ZswapCoinPublicKey, ContractAddress>,
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    id: bigint,
    value: bigint,
  ) {
    this.circuitContext = this.contract.impureCircuits._update(this.circuitContext, from, to, id, value).context;
  }

  public _setURI(
    newURI: MaybeString,
  ) {
    this.circuitContext = this.contract.impureCircuits._setURI(this.circuitContext, newURI).context;
  }

  public _mint(
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    id: bigint,
    value: bigint
  ) {
    this.circuitContext = this.contract.impureCircuits._mint(this.circuitContext, to, id, value).context;
  }

  public _burn(
    from: Either<ZswapCoinPublicKey, ContractAddress>,
    id: bigint,
    value: bigint,
  ) {
    this.circuitContext = this.contract.impureCircuits._burn(this.circuitContext, from, id, value).context;
  }

  public _setApprovalForAll(
    owner: Either<ZswapCoinPublicKey, ContractAddress>,
    operator: Either<ZswapCoinPublicKey, ContractAddress>,
    approved: boolean,
    sender?: CoinPublicKey
) {
    const res = this.contract.impureCircuits._setApprovalForAll({
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState,
        },
        owner, operator, approved
    );

    this.circuitContext = res.context;
    return res.result;
  }
}
