import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  Contract as ForwarderUnshieldedExample,
  ledger,
  type UserAddress,
} from '../../../../../artifacts/ForwarderUnshieldedExample/contract/index.js';
import {
  EmptyPrivateState,
  emptyWitnesses,
} from '../../../test/EmptyWitnesses.js';

type ForwarderUnshieldedArgs = readonly [parent: UserAddress];

const ForwarderUnshieldedSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  ForwarderUnshieldedExample<EmptyPrivateState>,
  ForwarderUnshieldedArgs
>({
  contractFactory: (witnesses) =>
    new ForwarderUnshieldedExample<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (parent) => [parent],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'ForwarderUnshieldedExample',
});

export class ForwarderUnshieldedSimulator extends ForwarderUnshieldedSimulatorBase {
  static async create(
    parent: UserAddress,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<ForwarderUnshieldedSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [parent],
      options,
    ) as Promise<ForwarderUnshieldedSimulator>;
  }

  public deposit(color: Uint8Array, amount: bigint): Promise<[]> {
    return this.circuits.impure.deposit(color, amount);
  }

  public getParent(): Promise<Either<ContractAddress, UserAddress>> {
    return this.circuits.impure.getParent();
  }
}
