import type { Config } from "@jest/types";

const config: Config.InitialOptions = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  verbose: true,
  roots: ["<rootDir>"],
  modulePaths: ["<rootDir>"],
  passWithNoTests: false,
  testMatch: ["**/*.test.ts"],
  extensionsToTreatAsEsm: [".ts"],
  collectCoverage: true,
  resolver: '<rootDir>/js-resolver.cjs',
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
    },
  },
  reporters: [
    "default",
    ["jest-junit", { outputDirectory: "reports", outputName: "report.xml" }],
    ["jest-html-reporters", { publicPath: "reports", filename: "report.html" }],
  ],
};

export default config;
