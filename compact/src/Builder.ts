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
 * artifact copying, etc.) with progress feedback and colored output for success and error states.
 *
 * Creates a clean distribution structure without src/ paths for professional import experience.
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
 * ✔ [BUILD] [1/4] Cleaning dist directory
 * ✔ [BUILD] [2/4] Compiling TypeScript
 * ✔ [BUILD] [3/4] Copying .compact files
 * ✔ [BUILD] [4/4] Copying package metadata
 * ```
 */
export class CompactBuilder {
  private readonly compilerFlags: string;
  private readonly steps: Array<{ cmd: string; msg: string; shell?: string }> =
    [
      // Step 1: Clean dist directory
      {
        cmd: 'rm -rf dist && mkdir -p dist',
        msg: 'Cleaning dist directory',
        shell: '/bin/bash',
      },

      // Step 2: TypeScript compilation (witnesses/ -> dist/witnesses/)
      {
        cmd: 'tsc --project tsconfig.build.json',
        msg: 'Compiling TypeScript',
      },

      // Step 3: Copy .compact files preserving structure (excludes Mock* files and archive/)
      {
        cmd: `
        find src -type f -name "*.compact" ! -name "Mock*" ! -path "*/archive/*" | while read file; do
          # Remove src/ prefix from path
          rel_path="\${file#src/}"
          mkdir -p "dist/\$(dirname "\$rel_path")"
          cp "\$file" "dist/\$rel_path"
        done
      `,
        msg: 'Copying .compact files (excluding mocks and archive)',
        shell: '/bin/bash',
      },

      // Step 4: Copy essential files for distribution
      {
        cmd: `
        # Copy package.json and README
        cp package.json dist/ 2>/dev/null || true
        cp ../README.md dist/  # Go up one level to monorepo root
      `,
        msg: 'Copying package metadata',
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

    console.log(chalk.green('\n✅ Build complete!'));
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
    if (lines.length > 0) {
      console.log(colorFn(lines.join('\n')));
    }
  }
}
