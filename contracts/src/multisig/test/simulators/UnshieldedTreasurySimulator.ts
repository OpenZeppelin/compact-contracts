import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockUnshieldedTreasury,
} from '../../../../artifacts/MockUnshieldedTreasury/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type UnshieldedRecipient = {
  is_left: boolean;
  left: { bytes: Uint8Array };
  right: { bytes: Uint8Array };
};

type UnshieldedTreasuryArgs = readonly [];

const UnshieldedTreasurySimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockUnshieldedTreasury<EmptyPrivateState>,
  UnshieldedTreasuryArgs
>({
  contractFactory: (witnesses) =>
    new MockUnshieldedTreasury<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockUnshieldedTreasury',
});

export class UnshieldedTreasurySimulator extends UnshieldedTreasurySimulatorBase {
  static async create(
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<UnshieldedTreasurySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<UnshieldedTreasurySimulator>;
  }

  public _deposit(color: Uint8Array, amount: bigint): Promise<[]> {
    return this.circuits.impure._deposit(color, amount);
  }

  public _send(
    recipient: UnshieldedRecipient,
    color: Uint8Array,
    amount: bigint,
  ): Promise<[]> {
    return this.circuits.impure._send(recipient, color, amount);
  }

  public getTokenBalance(color: Uint8Array): Promise<bigint> {
    return this.circuits.impure.getTokenBalance(color);
  }

  public depositThenSend(
    color: Uint8Array,
    amount: bigint,
    recipient: UnshieldedRecipient,
  ): Promise<[]> {
    return this.circuits.impure.depositThenSend(color, amount, recipient);
  }

  public sendTwice(
    color: Uint8Array,
    first: bigint,
    second: bigint,
    recipient: UnshieldedRecipient,
  ): Promise<[]> {
    return this.circuits.impure.sendTwice(color, first, second, recipient);
  }

  public receiveRaw(color: Uint8Array, amount: bigint): Promise<[]> {
    return this.circuits.impure.receiveRaw(color, amount);
  }

  public sendRaw(
    color: Uint8Array,
    amount: bigint,
    recipient: UnshieldedRecipient,
  ): Promise<[]> {
    return this.circuits.impure.sendRaw(color, amount, recipient);
  }

  public probeBalanceGte(color: Uint8Array, amount: bigint): Promise<boolean> {
    return this.circuits.impure.probeBalanceGte(color, amount);
  }

  public probeBalanceLte(color: Uint8Array, amount: bigint): Promise<boolean> {
    return this.circuits.impure.probeBalanceLte(color, amount);
  }

  public sendToSelf(color: Uint8Array, amount: bigint): Promise<[]> {
    return this.circuits.impure.sendToSelf(color, amount);
  }

  public probeBalanceAfterReceive(
    color: Uint8Array,
    amount: bigint,
  ): Promise<boolean> {
    return this.circuits.impure.probeBalanceAfterReceive(color, amount);
  }
}
