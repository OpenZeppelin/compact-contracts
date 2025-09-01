#!/usr/bin/env node

import chalk from 'chalk';
import ora from 'ora';
import { CompactCompiler } from './Compiler.js';

/**
 * Executes the Compact compiler CLI.
 * Compiles `.compact` files using the `CompactCompiler` class with provided flags.
 *
 * For individual module compilation, CLI flags work directly.
 * For full compilation with dependencies, use environment variables due to Turbo task orchestration.
 *
 * @example Individual module compilation (CLI flags work directly)
 * ```bash
 * npx compact-compiler --dir security --skip-zk
 * turbo compact:access -- --skip-zk
 * turbo compact:security -- --skip-zk --other-flag
 * ```
 *
 * @example Full compilation (environment variables required)
 * ```bash
 * # Use environment variables for full builds due to task dependencies
 * SKIP_ZK=true turbo compact
 *
 * # Normal full build
 * turbo compact
 * ```
 *
 * @example Direct CLI usage
 * ```bash
 * npx compact-compiler --skip-zk
 * npx compact-compiler --dir security --skip-zk
 * ```
 *
 * Environment Variables (only needed for full builds):
 * - `SKIP_ZK=true`: Adds --skip-zk flag when running full compilation via `turbo compact`
 *
 * Expected output:
 * ```
 * ℹ [COMPILE] Compact compiler started
 * ℹ [COMPILE] COMPACT_HOME: /path/to/compactc
 * ℹ [COMPILE] COMPACTC_PATH: /path/to/compactc/compactc
 * ℹ [COMPILE] TARGET_DIR: access:compact:access:
 * ℹ [COMPILE] Found 4 .compact file(s) to compile in access/
 * ✔ [COMPILE] [1/4] Compiled access/AccessControl.compact
 * ✔ [COMPILE] [2/4] Compiled access/Ownable.compact
 * ✔ [COMPILE] [3/4] Compiled access/test/mocks/MockAccessControl.compact
 * ✔ [COMPILE] [4/4] Compiled access/test/mocks/MockOwnable.compact
 *     Compactc version: 0.24.0
 * ```
 */
async function runCompiler(): Promise<void> {
  const spinner = ora(chalk.blue('[COMPILE] Compact Compiler started')).info();

  try {
    const args = process.argv.slice(2);

    // Parse arguments more robustly
    let targetDir: string | undefined;
    const compilerFlags: string[] = [];

    // Handle common development flags via environment variables
    // This is especially useful when using with Turbo monorepo tasks
    if (process.env.SKIP_ZK === 'true') {
      compilerFlags.push('--skip-zk');
    }

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--dir') {
        const dirNameExists =
          i + 1 < args.length && !args[i + 1].startsWith('--');
        if (dirNameExists) {
          targetDir = args[i + 1];
          i++; // Skip the next argument (directory name)
        } else {
          spinner.fail(
            chalk.red('[COMPILE] Error: --dir flag requires a directory name'),
          );
          console.log(
            chalk.yellow(
              'Usage: compact-compiler --dir <directory> [other-flags]',
            ),
          );
          console.log(
            chalk.yellow('Example: compact-compiler --dir access --skip-zk'),
          );
          console.log(
            chalk.yellow('Example: SKIP_ZK=true compact-compiler --dir access'),
          );
          process.exit(1);
        }
      } else {
        // All other arguments are compiler flags
        compilerFlags.push(args[i]);
      }
    }

    const compiler = new CompactCompiler(compilerFlags.join(' '), targetDir);
    await compiler.compile();
  } catch (err) {
    spinner.fail(
      chalk.red('[COMPILE] Unexpected error:', (err as Error).message),
    );
    process.exit(1);
  }
}

runCompiler();
