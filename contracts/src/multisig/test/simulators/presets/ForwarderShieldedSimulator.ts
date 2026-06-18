import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  Contract as ForwarderShielded,
  ledger,
  type ShieldedCoinInfo,
  type ZswapCoinPublicKey,
} from '../../../../../artifacts/ForwarderShielded/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../../EmptyWitnesses.js';

type ForwarderShieldedArgs = readonly [parent: ZswapCoinPublicKey];

const ForwarderShieldedSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  ForwarderShielded<EmptyPrivateState>,
  ForwarderShieldedArgs
>({
  contractFactory: (witnesses) =>
    new ForwarderShielded<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (parent) => [parent],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
});

export class ForwarderShieldedSimulator extends ForwarderShieldedSimulatorBase {
  constructor(
    parent: ZswapCoinPublicKey,
    options: BaseSimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ) {
    super([parent], options);
  }

  public deposit(coin: ShieldedCoinInfo) {
    return this.circuits.impure.deposit(coin);
  }

  public getParent(): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.circuits.impure.getParent();
  }
}
