import { initializeMidnightProviders } from '@midnight-ntwrk/testkit-js'
import type { ContractConfiguration, logger } from '@midnight-ntwrk/testkit-js'
import { getSharedState } from './e2e-shared-state'

export async function createTestContext(_logger: typeof logger, contractConfig: ContractConfiguration) {
  const { testEnvironment, environmentConfiguration } = getSharedState()
  const wallet = await testEnvironment.getMidnightWalletProvider()
  const providers = initializeMidnightProviders(wallet, environmentConfiguration, contractConfig)
  return { wallet, providers }
}