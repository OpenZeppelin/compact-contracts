import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type Audit_AuditRecord as AuditRecord,
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockAudit,
  type Audit_RecoveredRecord as RecoveredRecord,
} from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAudit/contract/index.js';
import {
  type AuditWallet,
  type ConfidentialNoteFungibleTokenAuditPrivateState,
  ConfidentialNoteFungibleTokenAuditWitnesses,
  createAuditWallet,
  type IConfidentialNoteFungibleTokenAuditWitnesses,
  ConfidentialNoteFungibleTokenAuditPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteFungibleTokenAuditWitnesses.js';

export type { AuditRecord, RecoveredRecord };

/** `Identifier`: a `left` public key or a `right` contract address. */
export type Identifier = Either<Uint8Array, ContractAddress>;

type Ledger = ReturnType<typeof ledger>;
type Witnesses = IConfidentialNoteFungibleTokenAuditWitnesses<
  Ledger,
  ConfidentialNoteFungibleTokenAuditPrivateState
>;
type Options = SimulatorOptions<
  ConfidentialNoteFungibleTokenAuditPrivateState,
  Witnesses
>;

type AuditArgs = readonly [auditKey: JubjubPoint, inits: bigint];

const ConfidentialNoteFungibleTokenAuditSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenAuditPrivateState,
  Ledger,
  Witnesses,
  MockAudit<ConfidentialNoteFungibleTokenAuditPrivateState>,
  AuditArgs
>({
  contractFactory: (witnesses) =>
    new MockAudit<ConfidentialNoteFungibleTokenAuditPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: (auditKey, inits) => [auditKey, inits],
  ledgerExtractor: (state) => ledger(state),
  // Fallback only: `create` always passes its own witnesses.
  witnessesFactory: () =>
    ConfidentialNoteFungibleTokenAuditWitnesses<Ledger>(createAuditWallet()),
  artifactName: 'MockConfidentialNoteFungibleTokenAudit',
});

/**
 * ConfidentialNoteFungibleTokenAudit (standalone) simulator.
 *
 * Drives the extension with nothing committed. `recoverRecord` and `ownerOf`
 * are pure: call them through the artifact's `pureCircuits`.
 */
export class ConfidentialNoteFungibleTokenAuditSimulator extends ConfidentialNoteFungibleTokenAuditSimulatorBase {
  /** The private input the seed witness answers with. Mutate between calls. */
  public wallet!: AuditWallet;

  /**
   * @param options Standard simulator options, plus the `auditKey`, `inits`
   * (the number of `initialize` calls the constructor makes, default 1) and a
   * `wallet` to reuse across deployments. Passing `options.witnesses` takes
   * over witness wiring entirely and leaves {@link wallet} disconnected.
   */
  static async create(
    options: Options & {
      auditKey: JubjubPoint;
      inits?: bigint;
      wallet?: AuditWallet;
    },
  ): Promise<ConfidentialNoteFungibleTokenAuditSimulator> {
    const { auditKey, inits, wallet: givenWallet, ...rest } = options;
    const wallet = givenWallet ?? createAuditWallet();
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    const simulator = (await super.create([auditKey, inits ?? 1n], {
      ...rest,
      witnesses:
        rest.witnesses ??
        ConfidentialNoteFungibleTokenAuditWitnesses<Ledger>(wallet),
    })) as ConfidentialNoteFungibleTokenAuditSimulator;
    simulator.wallet = wallet;
    return simulator;
  }

  /** Replaces the audit key. Ungated. */
  public _setAuditKey(newAuditKey: JubjubPoint): Promise<[]> {
    return this.circuits.impure._setAuditKey(newAuditKey);
  }

  /** Publishes `(owner, value, nonce)` encrypted to the audit key. Ungated. */
  public _audit(
    owner: Identifier,
    value: bigint,
    nonce: bigint,
    slot: Uint8Array,
  ): Promise<[]> {
    return this.circuits.impure._audit(owner, value, nonce, slot);
  }
}
