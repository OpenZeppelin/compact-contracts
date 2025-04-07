import { type CircuitContext, QueryContext, sampleContractAddress, constructorContext } from '@midnight-ntwrk/compact-runtime';
import { Contract, type Ledger, ledger, ZswapCoinPublicKey, ContractAddress, Either } from '../artifacts/erc20/contract/index.cjs';
import { type ERC20PrivateState, witnesses } from '../witnesses.js';
import { MaybeString } from './types.js';

export class ERC20Mock {
  readonly contract: Contract<ERC20PrivateState>;
  readonly contractAddress: string;
  circuitContext: CircuitContext<ERC20PrivateState>;

  constructor(name: MaybeString, symbol: MaybeString, decimals: bigint) {
    this.contract = new Contract<ERC20PrivateState>(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } = this.contract.initialState(
      constructorContext({}, '0'.repeat(64)), name, symbol, decimals
    );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      originalState: currentContractState,
      transactionContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
    this.contractAddress = this.circuitContext.transactionContext.address;
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.transactionContext.state);
  }

  public getPrivateState(): ERC20PrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public balanceOf(account: Either<ZswapCoinPublicKey, ContractAddress>): bigint {
    return this.contract.impureCircuits.balanceOf(this.circuitContext, account).result;
  }

  public allowance(
    owner: Either<ZswapCoinPublicKey, ContractAddress>,
    spender: Either<ZswapCoinPublicKey, ContractAddress>
  ): bigint {
    return this.contract.impureCircuits.allowance(this.circuitContext, owner, spender).result;
  }

  public transfer(to: Either<ZswapCoinPublicKey, ContractAddress>, value: bigint): boolean {
    return this.contract.impureCircuits.transfer(this.circuitContext, to, value).result;
  }

  public transferFrom(
    from: Either<ZswapCoinPublicKey, ContractAddress>,
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    value: bigint
  ): boolean {
    return this.contract.impureCircuits.transferFrom(this.circuitContext, from, to, value).result;
  }

  public approve(spender: Either<ZswapCoinPublicKey, ContractAddress>, value: bigint): boolean {
    return this.contract.impureCircuits.approve(this.circuitContext, spender, value).result;
  }

  public _approve(
    owner: Either<ZswapCoinPublicKey, ContractAddress>,
    spender: Either<ZswapCoinPublicKey, ContractAddress>,
    value: bigint
  ) {
    this.circuitContext = this.contract.impureCircuits._approve(this.circuitContext, owner, spender, value).context;
    return ledger(this.circuitContext.transactionContext.state);
  }

  public _transfer(
    from: Either<ZswapCoinPublicKey, ContractAddress>,
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    value: bigint
  ) {
    this.circuitContext = this.contract.impureCircuits._transfer(this.circuitContext, from, to, value).context;
    return ledger(this.circuitContext.transactionContext.state);
  }

  public _mint(account: Either<ZswapCoinPublicKey, ContractAddress>, value: bigint) {
    this.circuitContext = this.contract.impureCircuits._mint(this.circuitContext, account, value).context;
    return ledger(this.circuitContext.transactionContext.state);
  }

  public _burn(account: Either<ZswapCoinPublicKey, ContractAddress>, value: bigint) {
    this.circuitContext = this.contract.impureCircuits._burn(this.circuitContext, account, value).context;
    return ledger(this.circuitContext.transactionContext.state);
  }
  public _update(
    from: Either<ZswapCoinPublicKey, ContractAddress>,
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    value: bigint
  ) {
    this.circuitContext = this.contract.impureCircuits._update(this.circuitContext, from, to, value).context;
    return ledger(this.circuitContext.transactionContext.state);
  }

  public _spendAllowance(
    owner: Either<ZswapCoinPublicKey, ContractAddress>,
    spender: Either<ZswapCoinPublicKey, ContractAddress>,
    value: bigint
  ) {
    this.circuitContext = this.contract.impureCircuits._spendAllowance(this.circuitContext, owner, spender, value).context;
    return ledger(this.circuitContext.transactionContext.state);
  }

  public _isZero(address: Either<ZswapCoinPublicKey, ContractAddress>): boolean {
    return this.contract.circuits._isZero(this.circuitContext, address).result;
  }
}
