import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  Contract as ForwarderShielded,
  ledger,
  type ShieldedCoinInfo,
  type ZswapCoinPublicKey,
} from '../../../../../artifacts/ForwarderShielded/contract/index.js';
import {
  ForwarderShieldedPrivateState,
  ForwarderShieldedWitnesses,
} from '../../witnesses/presets/ForwarderShieldedWitnesses.js';

type ForwarderShieldedArgs = readonly [parent: ZswapCoinPublicKey];

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
    super([{ bytes: parent }], options);
  }

  public deposit(coin: ShieldedCoinInfo) {
    return this.circuits.impure.deposit(coin);
  }

  public getParent(): Uint8Array {
    return this.circuits.impure.getParent().bytes;
  }
}
