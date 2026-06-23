import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
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

/**
 * Absolute path to `contracts/artifacts/<moduleName>/`.
 * Used by `NodeZkConfigProvider`, which expects the directory containing
 * `keys/` and `zkir/` (i.e. the module root, not the `contract/` subfolder).
 */
export function moduleRootPath(moduleName: string): string {
  // _harness/ is at contracts/test/integration/_harness/
  // module root at    contracts/artifacts/<moduleName>/
  return path.resolve(
    currentDir,
    '..',
    '..',
    '..',
    'artifacts',
    moduleName,
  );
}

/**
 * Absolute path to `contracts/artifacts/<moduleName>/contract/` — where the
 * compiled `index.js`, `index.d.ts`, and `contract-info.json` (in compiler/)
 * live. Used by `CompiledContract.withCompiledFileAssets`.
 */
export function contractAssetsPath(moduleName: string): string {
  return path.join(moduleRootPath(moduleName), 'contract');
}

/**
 * Generic deploy wrapper.
 *
 * Each per-module fixture builds its own `CompiledContract` (because
 * `witnesses` are module-specific) and passes it here along with providers,
 * a private-state id, the initial private-state value, and the contract's
 * constructor arguments — all properly typed via `Contract.*` helpers from
 * `@midnight-ntwrk/compact-js`, so callers don't need any escape casts.
 */
export async function deployModule<C extends ContractNs.Any>(
  providers: MidnightProviders<
    ContractNs.ProvableCircuitId<C>,
    string,
    ContractNs.PrivateState<C>
  >,
  // The third generic of `CompiledContract` (the witnesses map) defaults to
  // `never` for empty-witness contracts; accept `any` so both shapes pass.
  compiledContract: CompiledContract.CompiledContract<
    C,
    ContractNs.PrivateState<C>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
  >,
  privateStateId: string,
  initialPrivateState: ContractNs.PrivateState<C>,
  args: ContractNs.InitializeParameters<C>,
): Promise<DeployedContract<C>> {
  // The deployContract options shape is conditional on whether
  // `Contract.InitializeParameters<C>` is empty — TypeScript can't reduce
  // that conditional under an unbounded `C extends Contract.Any`, so we
  // shape the literal once and assert it matches `DeployContractOptionsWithPrivateState<C>`.
  // Two-step cast (through `unknown`) because TS rejects the direct cast
  // as "neither type sufficiently overlaps" — same conditional-resolution
  // issue. Scoped to this single helper.
  const options = {
    compiledContract,
    privateStateId,
    initialPrivateState,
    args,
  } as unknown as DeployContractOptionsWithPrivateState<C>;
  return deployContract<C>(providers, options);
}
