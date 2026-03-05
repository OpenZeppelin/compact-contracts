import type { LocalTestEnvironment, EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js'

interface E2ESharedState {
  testEnvironment: LocalTestEnvironment
  environmentConfiguration: EnvironmentConfiguration
}

let state: E2ESharedState | null = null

export function setSharedState(s: E2ESharedState) { state = s }
export function getSharedState(): E2ESharedState {
  if (!state) throw new Error('E2E shared state not initialized — did globalSetup run?')
  return state
}