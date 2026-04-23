import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { DeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { Contract as MockPausable } from '../../../artifacts/MockPausable/contract/index.js';
import {
  PausablePrivateState,
  PausableWitnesses,
} from '../../../src/security/witnesses/PausableWitnesses.js';
import {
  contractAssetsPath,
  deployModule,
  moduleRootPath,
} from '../_harness/deploy.js';
import { PausableHarness } from '../_harness/harnesses/PausableHarness.js';
import { networkConfig, setupNetwork } from '../_harness/network.js';
import { buildProviders } from '../_harness/providers.js';
import { buildWallet } from '../_harness/wallet.js';

export { PausablePrivateState } from '../../../src/security/witnesses/PausableWitnesses.js';

export const PausablePrivateStateId = 'pausablePrivateState';

export type PausableContract = MockPausable<PausablePrivateState>;
export type DeployedPausable = DeployedContract<PausableContract>;

export const compiledPausable = CompiledContract.make<PausableContract>(
  'MockPausable',
  MockPausable<PausablePrivateState>,
).pipe(
  CompiledContract.withWitnesses(PausableWitnesses()),
  CompiledContract.withCompiledFileAssets(contractAssetsPath('MockPausable')),
);

/**
 * Deploy `MockPausable` against the local node and return a typed
 * {@link PausableHarness} wrapper for use in integration specs.
 */
export async function deployPausable(): Promise<PausableHarness> {
  setupNetwork();
  const env = networkConfig();
  const wallet = await buildWallet(env);

  const providers = buildProviders<
    string,
    typeof PausablePrivateStateId,
    PausablePrivateState
  >(wallet, moduleRootPath('MockPausable'), `pausable-${Date.now()}`);

  const deployed = await deployModule<PausableContract, []>(
    providers,
    compiledPausable,
    PausablePrivateStateId,
    PausablePrivateState,
    [],
  );

  return new PausableHarness(deployed, providers, wallet);
}
