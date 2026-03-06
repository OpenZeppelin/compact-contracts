import { LocalTestEnvironment, createDefaultTestLogger, defaultContainersConfiguration, setContainersConfiguration } from '@midnight-ntwrk/testkit-js'
import path from 'path'

export async function setup() {
  const logger = createDefaultTestLogger()
  globalThis.logger = logger

  setContainersConfiguration({
    ...defaultContainersConfiguration,
    standalone: {
      ...defaultContainersConfiguration.standalone,
      path: path.resolve('.'),  // contracts/ root where compose.yml lives
    },
    proofServer: {
      ...defaultContainersConfiguration.proofServer,
      path: path.resolve('.')
    }
  })
}