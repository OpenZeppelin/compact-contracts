import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CompiledContract,
  Contract as ContractNs,
} from '@midnight-ntwrk/compact-js';
import {
  type DeployContractOptionsWithPrivateState,
  type DeployedContract,
  deployContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to `contracts/artifacts/<name>/` — the ZK keys + zkir root. */
export function moduleRootPath(name: string): string {
  // this harness lives at contracts/test/integration/_harness/;
  // artifacts live at        contracts/artifacts/<name>/
  return path.resolve(currentDir, '..', '..', '..', 'artifacts', name);
}

/** Absolute path to `contracts/artifacts/<name>/contract/` — the compiled JS. */
export function contractAssetsPath(name: string): string {
  return path.join(moduleRootPath(name), 'contract');
}

/**
 * Deploy one compiled contract and return the raw midnight-js handle.
 *
 * The simulator's live backend keeps only the deployed address, so CMA specs —
 * which need `deployTxData.private.signingKey` and the maintenance-tx surface —
 * deploy through here instead.
 */
export async function deployModule<C extends ContractNs.Any>(
  providers: MidnightProviders<
    ContractNs.ProvableCircuitId<C>,
    string,
    ContractNs.PrivateState<C>
  >,
  // The witnesses generic resolves to `never` for an empty-witness contract;
  // `any` admits both shapes.
  compiledContract: CompiledContract.CompiledContract<
    C,
    ContractNs.PrivateState<C>,
    any
  >,
  privateStateId: string,
  initialPrivateState: ContractNs.PrivateState<C>,
  args: ContractNs.InitializeParameters<C>,
): Promise<DeployedContract<C>> {
  // `DeployContractOptionsWithPrivateState<C>` is conditional on whether
  // `InitializeParameters<C>` is empty, which TS cannot reduce under an
  // unbounded `C`. Shape the literal once and assert it here.
  const options = {
    compiledContract,
    privateStateId,
    initialPrivateState,
    args,
  } as unknown as DeployContractOptionsWithPrivateState<C>;
  return deployContract<C>(providers, options);
}
