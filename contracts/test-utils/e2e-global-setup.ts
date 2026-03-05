import { LocalTestEnvironment, createDefaultTestLogger } from '@midnight-ntwrk/testkit-js'
import { setSharedState } from './e2e-shared-state'

let testEnvironment: LocalTestEnvironment

export async function setup() {
  const logger = createDefaultTestLogger()
  testEnvironment = new LocalTestEnvironment(logger)

  // start() internally handles DockerComposeEnvironment, uid, ports, and wait strategies
  const environmentConfiguration = await testEnvironment.start()

  setSharedState({ testEnvironment, environmentConfiguration })
}

export async function teardown() {
  await testEnvironment?.shutdown()
}