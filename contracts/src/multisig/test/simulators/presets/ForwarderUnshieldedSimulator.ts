import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  Contract as ForwarderUnshielded,
  ledger,
  type UserAddress,
} from '../../../../../artifacts/ForwarderUnshielded/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../../EmptyWitnesses.js';

type ForwarderUnshieldedArgs = readonly [parent: UserAddress];

const ForwarderUnshieldedSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  ForwarderUnshielded<EmptyPrivateState>,
  ForwarderUnshieldedArgs
>({
  contractFactory: (witnesses) =>
    new ForwarderUnshielded<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (parent) => [parent],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
});

export class ForwarderUnshieldedSimulator extends ForwarderUnshieldedSimulatorBase {
  constructor(
    parent: UserAddress,
    options: BaseSimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ) {
    super([parent], options);
  }

  public deposit(color: Uint8Array, amount: bigint) {
    return this.circuits.impure.deposit(color, amount);
  }

  public getParent(): Either<ContractAddress, UserAddress> {
    return this.circuits.impure.getParent();
  }
}
