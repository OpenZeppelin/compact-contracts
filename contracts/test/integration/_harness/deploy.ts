import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import {
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
 * Minimal deployContract wrapper. Each per-module fixture builds its own
 * `CompiledContract` (because `witnesses` are module-specific) and passes it
 * here along with the providers and constructor args.
 *
 * This indirection will grow a `signingKey` option in Milestone 2 when we add
 * deterministic CMA signers; for now the default signer is used.
 */
export async function deployModule<C, Args extends readonly unknown[]>(
  providers: MidnightProviders<string, string, unknown>,
  compiledContract: ReturnType<typeof CompiledContract.make<C>>,
  privateStateId: string,
  initialPrivateState: unknown,
  args: Args,
): Promise<DeployedContract<C>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await deployContract<C>(providers as any, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compiledContract: compiledContract as any,
    privateStateId,
    initialPrivateState,
    args: args as unknown as never[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as DeployedContract<C>;
}
