import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  verbose: true,
  roots: ['<rootDir>'],
  modulePaths: ['<rootDir>'],
  passWithNoTests: false,
  testMatch: ['**/*.test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  collectCoverage: false,
  resolver: '<rootDir>/js-resolver.cjs',
};

export default config;
