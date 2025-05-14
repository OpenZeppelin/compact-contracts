#!/usr/bin/env node

import chalk from 'chalk';
import ora from 'ora';
import { CompactBuilder } from './Builder.js';

/**
 * Executes the Compact builder CLI.
 * Builds projects using the `CompactBuilder` class with provided flags, including compilation and additional steps.
 *
 * @example
 * ```bash
 * npx compact-builder --skip-zk
 * ```
 * Expected output:
 * ```
 * ℹ [BUILD] Compact builder started
 * ℹ [COMPILE] COMPACT_HOME: /path/to/compactc
 * ℹ [COMPILE] COMPACTC_PATH: /path/to/compactc/compactc
 * ℹ [COMPILE] Found 1 .compact file(s) to compile
 * ✔ [COMPILE] [1/1] Compiled Foo.compact
 *     Compactc version: 0.22.0
 * ✔ [BUILD] [1/3] Compiling TypeScript
 * ✔ [BUILD] [2/3] Copying artifacts
 * ✔ [BUILD] [3/3] Copying and cleaning .compact files
 * ```
 */
async function runBuilder(): Promise<void> {
  const spinner = ora(chalk.blue('[BUILD] Compact Builder started')).info();

  try {
    const compilerFlags = process.argv.slice(2).join(' ');
    const builder = new CompactBuilder(compilerFlags);
    await builder.build();
  } catch (err) {
    spinner.fail(
      chalk.red('[BUILD] Unexpected error:', (err as Error).message),
    );
    process.exit(1);
  }
}

runBuilder();
