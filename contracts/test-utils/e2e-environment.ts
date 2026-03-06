import { initializeMidnightProviders, LocalTestEnvironment } from '@midnight-ntwrk/testkit-js'
import type { ContractConfiguration } from '@midnight-ntwrk/testkit-js'
import type { Logger } from 'pino'

export async function createTestContext(logger: Logger, contractConfig: ContractConfiguration) {
  const testEnvironment = new LocalTestEnvironment(logger)
  const environmentConfiguration = await testEnvironment.start()
  const wallet = await testEnvironment.getMidnightWalletProvider()
  const providers = initializeMidnightProviders(wallet, environmentConfiguration, contractConfig)
  return { testEnvironment, wallet, providers }
}