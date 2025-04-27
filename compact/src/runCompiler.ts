#!/usr/bin/env node

import chalk from 'chalk';
import ora from 'ora';
import { CompactCompiler } from './Compiler.js';

/**
 * Executes the Compact compiler CLI.
 * Compiles `.compact` files using the `CompactCompiler` class with provided flags.
 *
 * @example
 * ```bash
 * npx compact-compiler --skip-zk
 * ```
 * Expected output:
 * ```
 * ℹ [COMPILE] Compact compiler started
 * ℹ [COMPILE] COMPACT_HOME: /path/to/compactc
 * ℹ [COMPILE] COMPACTC_PATH: /path/to/compactc/compactc
 * ℹ [COMPILE] Found 1 .compact file(s) to compile
 * ✔ [COMPILE] [1/1] Compiled Foo.compact
 *     Compactc version: 0.22.0
 * ```
 */
async function runCompiler(): Promise<void> {
  const spinner = ora(chalk.blue('[COMPILE] Compact Compiler started')).info();

  try {
    const compilerFlags = process.argv.slice(2).join(' ');
    const compiler = new CompactCompiler(compilerFlags);
    await compiler.compile();
  } catch (err) {
    spinner.fail(
      chalk.red('[COMPILE] Unexpected error:', (err as Error).message),
    );
    process.exit(1);
  }
}

runCompiler();
