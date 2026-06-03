import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  ledger,
  Contract as ForwarderUnshielded,
  type UserAddress,
} from '../../../../../artifacts/ForwarderUnshielded/contract/index.js';
import {
  ForwarderUnshieldedPrivateState,
  ForwarderUnshieldedWitnesses,
} from '../../../witnesses/presets/ForwarderUnshieldedWitnesses.js';

type ForwarderUnshieldedArgs = readonly [parent: UserAddress];

const ForwarderUnshieldedSimulatorBase = createSimulator<
  ForwarderUnshieldedPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ForwarderUnshieldedWitnesses>,
  ForwarderUnshielded<ForwarderUnshieldedPrivateState>,
  ForwarderUnshieldedArgs
>({
  contractFactory: (witnesses) =>
    new ForwarderUnshielded<ForwarderUnshieldedPrivateState>(witnesses),
  defaultPrivateState: () => ForwarderUnshieldedPrivateState,
  contractArgs: (parent) => [parent],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ForwarderUnshieldedWitnesses(),
});

export class ForwarderUnshieldedSimulator extends ForwarderUnshieldedSimulatorBase {
  constructor(
    parent: Uint8Array,
    options: BaseSimulatorOptions<
      ForwarderUnshieldedPrivateState,
      ReturnType<typeof ForwarderUnshieldedWitnesses>
    > = {},
  ) {
    super([{ bytes: parent }], options);
  }

  public depositUnshielded(color: Uint8Array, amount: bigint) {
    return this.circuits.impure.depositUnshielded(color, amount);
  }

  public getParent(): Uint8Array {
    return this.circuits.impure.getParent().bytes;
  }
}
