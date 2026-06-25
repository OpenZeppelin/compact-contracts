import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as SharedInitCollision,
} from '../../../artifacts/SharedInitCollision/contract/index.js';

type EmptyPrivateState = Record<string, never>;

const SharedInitCollisionSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  // biome-ignore lint/complexity/noBannedTypes: the contract declares no witnesses
  {},
  SharedInitCollision<EmptyPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new SharedInitCollision<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => ({}),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ({}),
  artifactName: 'SharedInitCollision',
});

/**
 * Drives the SharedInitCollision contract: two same-directory modules that both
 * import the shared, stateful `Initializable`. Used to assert the compiler#270
 * collision.
 */
export class SharedInitCollisionSimulator extends SharedInitCollisionSimulatorBase {
  static async create(
    // biome-ignore lint/complexity/noBannedTypes: the contract declares no witnesses
    options: SimulatorOptions<EmptyPrivateState, {}> = {},
  ): Promise<SharedInitCollisionSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<SharedInitCollisionSimulator>;
  }

  public initA(): Promise<[]> {
    return this.circuits.impure.initA();
  }

  public initB(): Promise<[]> {
    return this.circuits.impure.initB();
  }

  public checkA(): Promise<[]> {
    return this.circuits.impure.checkA();
  }

  public checkB(): Promise<[]> {
    return this.circuits.impure.checkB();
  }
}
