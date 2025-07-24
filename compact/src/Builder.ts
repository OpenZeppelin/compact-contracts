#!/usr/bin/env node

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { CompactCompiler } from './Compiler.js';
import { isPromisifiedChildProcessError } from './types/errors.js';

// Promisified exec for async execution
const execAsync = promisify(exec);

/**
 * A class to handle the build process for a project.
 * Runs CompactCompiler as a prerequisite, then executes build steps (TypeScript compilation,
 * artifact copying, etc.)
 * with progress feedback and colored output for success and error states.
 *
 * @notice `cmd` scripts discard `stderr` output and fail silently because this is
 * handled in `executeStep`.
 *
 * @example
 * ```typescript
 * const builder = new ProjectBuilder('--skip-zk'); // Optional flags for compactc
 * builder.build().catch(err => console.error(err));
 * ```
 *
 * @example <caption>Successful Build Output</caption>
 * ```
 * ℹ [COMPILE] Found 2 .compact file(s) to compile
 * ✔ [COMPILE] [1/2] Compiled AccessControl.compact
 *     Compactc version: 0.24.0
 * ✔ [COMPILE] [2/2] Compiled MockAccessControl.compact
 *     Compactc version: 0.24.0
 * ✔ [BUILD] [1/3] Compiling TypeScript
 * ✔ [BUILD] [2/3] Copying artifacts
 * ✔ [BUILD] [3/3] Copying and cleaning .compact files
 * ```
 *
 * @example <caption>Failed Compilation Output</caption>
 * ```
 * ℹ [COMPILE] Found 2 .compact file(s) to compile
 * ✖ [COMPILE] [1/2] Failed AccessControl.compact
 *     Compactc version: 0.24.0
 *     Error: Expected ';' at line 5 in AccessControl.compact
 * ```
 *
 * @example <caption>Failed Build Step Output</caption>
 * ```
 * ℹ [COMPILE] Found 2 .compact file(s) to compile
 * ✔ [COMPILE] [1/2] Compiled AccessControl.compact
 * ✔ [COMPILE] [2/2] Compiled MockAccessControl.compact
 * ✖ [BUILD] [1/3] Failed Compiling TypeScript
 *     error TS1005: ';' expected at line 10 in file.ts
 *     [BUILD] ❌ Build failed: Command failed: tsc --project tsconfig.build.json
 * ```
 */
export class CompactBuilder {
  private readonly compilerFlags: string;
  private readonly steps: Array<{ cmd: string; msg: string; shell?: string }> =
    [
      {
        cmd: 'tsc --project tsconfig.build.json',
        msg: 'Compiling TypeScript',
      },
      {
        cmd: 'mkdir -p dist/artifacts && cp -Rf src/artifacts/* dist/artifacts/ 2>/dev/null || true',
        msg: 'Copying artifacts',
        shell: '/bin/bash',
      },
      {
        cmd: 'mkdir -p dist && find src -type f -name "*.compact" -exec cp {} dist/ \\; 2>/dev/null && rm dist/Mock*.compact 2>/dev/null || true',
        msg: 'Copying and cleaning .compact files',
        shell: '/bin/bash',
      },
    ];

  /**
   * Constructs a new ProjectBuilder instance.
   * @param compilerFlags - Optional space-separated string of `compactc` flags (e.g., "--skip-zk")
   */
  constructor(compilerFlags = '') {
    this.compilerFlags = compilerFlags;
  }

  /**
   * Executes the full build process: compiles .compact files first, then runs build steps.
   * Displays progress with spinners and outputs results in color.
   *
   * @returns A promise that resolves when all steps complete successfully
   * @throws Error if compilation or any build step fails
   */
  public async build(): Promise<void> {
    // Run compact compilation as a prerequisite
    const compiler = new CompactCompiler(this.compilerFlags);
    await compiler.compile();

    // Proceed with build steps
    for (const [index, step] of this.steps.entries()) {
      await this.executeStep(step, index, this.steps.length);
    }
  }

  /**
   * Executes a single build step.
   * Runs the command, shows a spinner, and prints output with indentation.
   *
   * @param step - The build step containing command and message
   * @param index - Current step index (0-based) for progress display
   * @param total - Total number of steps for progress display
   * @returns A promise that resolves when the step completes successfully
   * @throws Error if the step fails
   */
  private async executeStep(
    step: { cmd: string; msg: string; shell?: string },
    index: number,
    total: number,
  ): Promise<void> {
    const stepLabel: string = `[${index + 1}/${total}]`;
    const spinner: Ora = ora(`[BUILD] ${stepLabel} ${step.msg}`).start();

    try {
      const { stdout, stderr }: { stdout: string; stderr: string } =
        await execAsync(step.cmd, {
          shell: step.shell, // Only pass shell where needed
        });
      spinner.succeed(`[BUILD] ${stepLabel} ${step.msg}`);
      this.printOutput(stdout, chalk.cyan);
      this.printOutput(stderr, chalk.yellow); // Show stderr (warnings) in yellow if present
    } catch (error: unknown) {
      spinner.fail(`[BUILD] ${stepLabel} ${step.msg}`);
      if (isPromisifiedChildProcessError(error)) {
        this.printOutput(error.stdout, chalk.cyan);
        this.printOutput(error.stderr, chalk.red);
        // biome-ignore lint/suspicious/noConsole: Needed to display build failure reason
        console.error(chalk.red('[BUILD] ❌ Build failed:', error.message));
      } else if (error instanceof Error) {
        // biome-ignore lint/suspicious/noConsole: Needed to display build failure reason
        console.error(chalk.red('[BUILD] ❌ Build failed:', error.message));
      }

      process.exit(1);
    }
  }

  /**
   * Prints command output with indentation and specified color.
   * Filters out empty lines and indents each line for readability.
   *
   * @param output - The command output string to print (stdout or stderr)
   * @param colorFn - Chalk color function to style the output (e.g., `chalk.cyan` for success, `chalk.red` for errors)
   */
  private printOutput(output: string, colorFn: (text: string) => string): void {
    const lines: string[] = output
      .split('\n')
      .filter((line: string): boolean => line.trim() !== '')
      .map((line: string): string => `    ${line}`);
    console.log(colorFn(lines.join('\n')));
  }
}
