import { createSimulator } from '@openzeppelin/compact-simulator';
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
});

/**
 * Drives the SharedInitCollision contract: two same-directory modules that both
 * import the shared, stateful `Initializable`. Used to assert the compiler#270
 * collision.
 */
export class SharedInitCollisionSimulator extends SharedInitCollisionSimulatorBase {
  constructor() {
    super([], {});
  }

  public initA(): void {
    this.circuits.impure.initA();
  }

  public initB(): void {
    this.circuits.impure.initB();
  }

  public checkA(): void {
    this.circuits.impure.checkA();
  }

  public checkB(): void {
    this.circuits.impure.checkB();
  }
}
