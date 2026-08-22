import { createSimulator } from '@openzeppelin/compact-simulator';
import {
  Contract as ComposedConfusedDeputy,
  type ContractAddress,
  type Either,
  ledger,
} from '../../../artifacts/ComposedConfusedDeputy/contract/index.js';
import {
  CallerPrivateState,
  CallerWitnesses,
} from '../../../src/access/test/witnesses/CallerWitnesses.js';

type ComposedConfusedDeputyArgs = readonly [
  initialOwner: Either<Uint8Array, ContractAddress>,
  name: string,
  symbol: string,
  decimals: bigint,
  callerDomain: Uint8Array,
];

const Base = createSimulator<
  CallerPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof CallerWitnesses>,
  ComposedConfusedDeputy<CallerPrivateState>,
  ComposedConfusedDeputyArgs
>({
  contractFactory: (witnesses) =>
    new ComposedConfusedDeputy<CallerPrivateState>(witnesses),
  defaultPrivateState: () => CallerPrivateState.generate(),
  contractArgs: (initialOwner, name, symbol, decimals, callerDomain) => [
    initialOwner,
    name,
    symbol,
    decimals,
    callerDomain,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => CallerWitnesses(),
});

/**
 * Drives the ComposedConfusedDeputy contract: a gate module (Ownable) and an effect
 * module (FungibleToken) in one top-level contract. `correctTransfer` feeds both
 * from one `authenticated()` call. `deputisedTransfer` feeds the effect a fabricated
 * principal on purpose. The mock's header explains why.
 */
export class ComposedConfusedDeputySimulator extends Base {
  static async create(
    initialOwner: Either<Uint8Array, ContractAddress>,
    callerDomain: Uint8Array,
    secretKey: Uint8Array,
  ): Promise<ComposedConfusedDeputySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([initialOwner, 'Fee Token', 'FEE', 18n, callerDomain], {
      privateState: { secretKey },
    }) as Promise<ComposedConfusedDeputySimulator>;
  }

  /** The principal this contract derives in-circuit for the current caller. */
  public callerPrincipal(): Promise<Uint8Array> {
    return this.circuits.impure.callerPrincipal();
  }

  public owner(): Promise<Either<Uint8Array, ContractAddress>> {
    return this.circuits.impure.owner();
  }

  /** Gate and effect driven by one authenticated principal. */
  public correctTransfer(
    to: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure.correctTransfer(to, value);
  }

  /** Gate on the real caller, effect on `actAs`. Unsound by design. */
  public deputisedTransfer(
    actAs: Uint8Array,
    to: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure.deputisedTransfer(actAs, to, value);
  }

  public ftMint(
    account: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure.ftMint(account, value);
  }

  public ftBalanceOf(
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<bigint> {
    return this.circuits.impure.ftBalanceOf(account);
  }

  public readonly privateState = {
    injectSecretKey: (newSK: Uint8Array): Promise<CallerPrivateState> =>
      this.updatePrivateState(CallerPrivateState.withSecretKey(newSK)),
  };
}
