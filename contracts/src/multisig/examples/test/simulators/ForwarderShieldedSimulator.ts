import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  Contract as ForwarderShieldedExample,
  ledger,
  type ShieldedCoinInfo,
  type ShieldedSendResult,
  type ZswapCoinPublicKey,
} from '../../../../../artifacts/ForwarderShieldedExample/contract/index.js';
import {
  EmptyPrivateState,
  emptyWitnesses,
} from '../../../test/EmptyWitnesses.js';

type ForwarderShieldedArgs = readonly [parent: ZswapCoinPublicKey];

const ForwarderShieldedSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  ForwarderShieldedExample<EmptyPrivateState>,
  ForwarderShieldedArgs
>({
  contractFactory: (witnesses) =>
    new ForwarderShieldedExample<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (parent) => [parent],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'ForwarderShieldedExample',
});

export class ForwarderShieldedSimulator extends ForwarderShieldedSimulatorBase {
  static async create(
    parent: ZswapCoinPublicKey,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<ForwarderShieldedSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [parent],
      options,
    ) as Promise<ForwarderShieldedSimulator>;
  }

  public deposit(coin: ShieldedCoinInfo): Promise<ShieldedSendResult> {
    return this.circuits.impure.deposit(coin);
  }

  public getParent(): Promise<Either<ZswapCoinPublicKey, ContractAddress>> {
    return this.circuits.impure.getParent();
  }
}
