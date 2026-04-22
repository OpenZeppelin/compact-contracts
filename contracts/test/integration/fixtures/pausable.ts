import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { DeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import {
  Contract as MockPausable,
  type Ledger as PausableLedger,
  ledger as pausableLedger,
} from '../../../artifacts/MockPausable/contract/index.js';
import {
  PausablePrivateState,
  PausableWitnesses,
} from '../../../src/security/witnesses/PausableWitnesses.js';
import { artifactPathOf, deployModule } from '../_harness/deploy.js';
import { buildProviders } from '../_harness/providers.js';
import { TestWalletProvider } from '../_harness/wallet.js';
import { networkConfig, setupNetwork } from '../_harness/network.js';

export const PausablePrivateStateId = 'pausablePrivateState';

export type PausableContract = MockPausable<PausablePrivateState>;
export type DeployedPausable = DeployedContract<PausableContract>;

const compiledPausable = CompiledContract.make<PausableContract>(
  'MockPausable',
  MockPausable<PausablePrivateState>,
).pipe(
  CompiledContract.withWitnesses(PausableWitnesses()),
  CompiledContract.withCompiledFileAssets(artifactPathOf('MockPausable')),
);

export interface PausableFixture {
  deployed: DeployedPausable;
  providers: MidnightProviders<
    string,
    typeof PausablePrivateStateId,
    PausablePrivateState
  >;
  wallet: TestWalletProvider;
  /** Read the current public `Pausable__isPaused` ledger flag. */
  readIsPaused(): Promise<boolean>;
  teardown(): Promise<void>;
}

export async function deployPausable(): Promise<PausableFixture> {
  setupNetwork();
  const env = networkConfig();
  const wallet = await TestWalletProvider.build(env);
  await wallet.start();

  const providers = buildProviders<
    string,
    typeof PausablePrivateStateId,
    PausablePrivateState
  >(wallet, artifactPathOf('MockPausable'), `pausable-${Date.now()}`);

  const deployed = await deployModule<PausableContract, []>(
    providers,
    compiledPausable,
    PausablePrivateStateId,
    PausablePrivateState,
    [],
  );

  return {
    deployed,
    providers,
    wallet,
    async readIsPaused(): Promise<boolean> {
      const address = deployed.deployTxData.public.contractAddress;
      const contractState = await providers.publicDataProvider.queryContractState(
        address,
      );
      if (!contractState) {
        throw new Error(`contractState missing for ${address}`);
      }
      const ledgerState: PausableLedger = pausableLedger(contractState.data);
      return ledgerState.Pausable__isPaused;
    },
    async teardown() {
      await wallet.stop();
    },
  };
}
