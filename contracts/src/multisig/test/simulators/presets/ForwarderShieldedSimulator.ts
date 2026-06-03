import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  ledger,
  Contract as ForwarderShielded,
} from '../../../../../artifacts/ForwarderShielded/contract/index.js';
import {
  ForwarderShieldedPrivateState,
  ForwarderShieldedWitnesses,
} from '../../../witnesses/presets/ForwarderShieldedWitnesses.js';

type ShieldedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };

type ForwarderShieldedArgs = readonly [parent: Uint8Array];

const ForwarderShieldedSimulatorBase = createSimulator<
  ForwarderShieldedPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ForwarderShieldedWitnesses>,
  ForwarderShielded<ForwarderShieldedPrivateState>,
  ForwarderShieldedArgs
>({
  contractFactory: (witnesses) =>
    new ForwarderShielded<ForwarderShieldedPrivateState>(witnesses),
  defaultPrivateState: () => ForwarderShieldedPrivateState,
  contractArgs: (parent) => [parent],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ForwarderShieldedWitnesses(),
});

export class ForwarderShieldedSimulator extends ForwarderShieldedSimulatorBase {
  constructor(
    parent: Uint8Array,
    options: BaseSimulatorOptions<
      ForwarderShieldedPrivateState,
      ReturnType<typeof ForwarderShieldedWitnesses>
    > = {},
  ) {
    super([parent], options);
  }

  public deposit(coin: ShieldedCoinInfo) {
    return this.circuits.impure.deposit(coin);
  }

  public getParent(): Uint8Array {
    return this.circuits.impure.getParent();
  }
}
