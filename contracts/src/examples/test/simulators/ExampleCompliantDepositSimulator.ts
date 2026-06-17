import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  type ElGamal_Ciphertext as Ciphertext,
  Contract as ExampleCompliantDeposit,
  ledger,
} from '../../../../artifacts/ExampleCompliantDeposit/contract/index.js';

/** The owner Either as represented by the runtime (EOA = left). */
type OwnerEither = { is_left: boolean; left: Uint8Array; right: unknown };

import {
  ExampleCompliantDepositPrivateState,
  ExampleCompliantDepositWitnesses,
} from '../witnesses/ExampleCompliantDepositWitnesses.js';

export type { Ciphertext };

type Args = readonly [
  name: string,
  symbol: string,
  decimals: bigint,
  initialOwner: Uint8Array,
];

const Base = createSimulator<
  ExampleCompliantDepositPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ExampleCompliantDepositWitnesses>,
  ExampleCompliantDeposit<ExampleCompliantDepositPrivateState>,
  Args
>({
  contractFactory: (witnesses) =>
    new ExampleCompliantDeposit<ExampleCompliantDepositPrivateState>(witnesses),
  defaultPrivateState: () => ExampleCompliantDepositPrivateState.generate(),
  contractArgs: (name, symbol, decimals, initialOwner) => [
    name,
    symbol,
    decimals,
    initialOwner,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ExampleCompliantDepositWitnesses(),
});

/**
 * ExampleCompliantDeposit Simulator — drives the composed example contract
 * (ConfidentialFungibleToken + ComplianceRegistry + Ownable).
 */
export class ExampleCompliantDepositSimulator extends Base {
  constructor(
    name: string,
    symbol: string,
    decimals: bigint,
    initialOwner: Uint8Array,
    options: BaseSimulatorOptions<
      ExampleCompliantDepositPrivateState,
      ReturnType<typeof ExampleCompliantDepositWitnesses>
    > = {},
  ) {
    super([name, symbol, decimals, initialOwner], options);
  }

  // --- holder operations -----------------------------------------------------
  public register(): Uint8Array {
    return this.circuits.impure.register();
  }
  public transfer(to: Uint8Array, value: bigint): Uint8Array {
    return this.circuits.impure.transfer(to, value);
  }
  public transferFrom(
    fromAddress: Uint8Array,
    to: Uint8Array,
    value: bigint,
  ): Uint8Array {
    return this.circuits.impure.transferFrom(fromAddress, to, value);
  }
  public approve(spender: Uint8Array, value: bigint): Uint8Array {
    return this.circuits.impure.approve(spender, value);
  }
  public burn(value: bigint): Uint8Array {
    return this.circuits.impure.burn(value);
  }
  public burnFrom(fromAddress: Uint8Array, value: bigint): Uint8Array {
    return this.circuits.impure.burnFrom(fromAddress, value);
  }

  // --- issuer operations -----------------------------------------------------
  public mint(account: Uint8Array, value: bigint) {
    this.circuits.impure.mint(account, value);
  }
  public freeze(account: Uint8Array) {
    this.circuits.impure.freeze(account);
  }
  public unfreeze(account: Uint8Array) {
    this.circuits.impure.unfreeze(account);
  }
  public setKycRequired(required: boolean) {
    this.circuits.impure.setKycRequired(required);
  }
  public setKycApproved(account: Uint8Array, approved: boolean) {
    this.circuits.impure.setKycApproved(account, approved);
  }

  // --- views -----------------------------------------------------------------
  public totalSupply(): bigint {
    return this.circuits.impure.totalSupply();
  }
  public isRegistered(account: Uint8Array): boolean {
    return this.circuits.impure.isRegistered(account);
  }
  public isFrozen(account: Uint8Array): boolean {
    return this.circuits.impure.isFrozen(account);
  }
  public isKycApproved(account: Uint8Array): boolean {
    return this.circuits.impure.isKycApproved(account);
  }
  public owner(): OwnerEither {
    return this.circuits.impure.owner();
  }
  public balanceOf(account: Uint8Array): Ciphertext {
    return this.circuits.impure.balanceOf(account);
  }

  // --- test-only private-state controls --------------------------------------
  public readonly privateState = {
    /** Acts as a token holder with the given (SK, EK). Clears the cache. */
    switchIdentity: (
      sk: Uint8Array,
      ek: Uint8Array,
    ): ExampleCompliantDepositPrivateState => {
      const cur = this.getPrivateState();
      const updated = {
        secretKey: sk,
        encryptionKey: ek,
        plaintextCache: new Map<string, bigint>(),
        randomnessSeed: cur.randomnessSeed,
        ownerSecretKey: cur.ownerSecretKey,
      };
      this.circuitContextManager.updatePrivateState(updated);
      return updated;
    },

    /** Sets the secret returned by `wit_OwnableSK` (the issuer identity). */
    setOwnerSecretKey: (
      sk: Uint8Array,
    ): ExampleCompliantDepositPrivateState => {
      const updated = { ...this.getPrivateState(), ownerSecretKey: sk };
      this.circuitContextManager.updatePrivateState(updated);
      return updated;
    },

    cachePlaintext: (
      ct: Ciphertext,
      plaintext: bigint,
    ): ExampleCompliantDepositPrivateState => {
      const updated = ExampleCompliantDepositPrivateState.cachePlaintext(
        this.getPrivateState(),
        ct,
        plaintext,
      );
      this.circuitContextManager.updatePrivateState(updated);
      return updated;
    },
  };
}
