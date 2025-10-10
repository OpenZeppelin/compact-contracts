#!/usr/bin/env node

import { join } from 'node:path';
import {
  BaseCompactOperation,
  BaseCompactService,
  BaseEnvironmentValidator,
  type ExecFunction,
  SharedUIService,
  SRC_DIR,
} from './BaseServices.js';
import {
  FormatterError,
  FormatterNotAvailableError,
  isPromisifiedChildProcessError,
} from './types/errors.ts';

/**
 * Environment validator for Compact formatting operations.
 *
 * Validates that both the Compact CLI and formatter are available before
 * attempting formatting operations. The formatter requires Compact compiler
 * version 0.25.0 or later to be installed and accessible.
 *
 * @example
 * ```typescript
 * const validator = new FormatterEnvironmentValidator();
 * const { devToolsVersion } = await validator.validate();
 * console.log(`Formatter ready with ${devToolsVersion}`);
 * ```
 */
export class FormatterEnvironmentValidator extends BaseEnvironmentValidator {
  /**
   * Verifies that the Compact formatter is available and accessible.
   *
   * Tests formatter availability by attempting to access the format help command.
   * Throws a specific error with recovery instructions when the formatter is not
   * available in the current toolchain.
   *
   * @throws FormatterNotAvailableError if formatter requires compiler update
   * @throws Error if help command fails for other reasons
   *
   * @example
   * ```typescript
   * try {
   *   await validator.checkFormatterAvailable();
   * } catch (error) {
   *   if (error instanceof FormatterNotAvailableError) {
   *     console.error('Run: compact update');
   *   }
   * }
   * ```
   */
  async checkFormatterAvailable(): Promise<void> {
    try {
      await this.execFn('compact help format');
    } catch (error) {
      if (
        isPromisifiedChildProcessError(error) &&
        error.stderr?.includes('formatter not available')
      ) {
        throw new FormatterNotAvailableError(
          'Formatter not available. Please update your Compact compiler with: compact update',
        );
      }
      throw error;
    }
  }

  /**
   * Performs complete environment validation for formatting operations.
   *
   * Validates both base CLI environment and formatter-specific requirements.
   * Must be called before attempting any formatting operations.
   *
   * @returns Promise resolving to validation results with dev tools version
   * @throws CompactCliNotFoundError if CLI is not available
   * @throws FormatterNotAvailableError if formatter is not available
   *
   * @example
   * ```typescript
   * const { devToolsVersion } = await validator.validate();
   * console.log(`Environment ready: ${devToolsVersion}`);
   * ```
   */
  async validate(): Promise<{ devToolsVersion: string }> {
    const { devToolsVersion } = await this.validateBase();
    await this.checkFormatterAvailable();
    return { devToolsVersion };
  }
}

/**
 * Service for executing Compact formatting commands.
 *
 * Lightweight wrapper around `compact format` that constructs commands with
 * appropriate flags and target paths, then delegates all formatting work and
 * user feedback to the underlying tool.
 *
 * @example
 * ```typescript
 * const service = new FormatterService();
 *
 * // Check formatting without modifications
 * await service.format(['src/contracts'], true);
 *
 * // Format and write changes
 * await service.format(['src/contracts'], false);
 * ```
 */
export class FormatterService extends BaseCompactService {
  /**
   * Executes compact format command with specified targets and mode.
   *
   * Constructs the appropriate `compact format` command and executes it,
   * allowing the underlying tool to handle all user feedback, progress
   * reporting, and error messaging.
   *
   * @param targets - Array of target paths (files or directories) to format
   * @param checkMode - If true, uses --check flag to validate without writing
   * @returns Promise resolving to command execution results
   * @throws FormatterError if the formatting command fails
   *
   * @example
   * ```typescript
   * // Check all files in src/
   * await service.format(['src'], true);
   *
   * // Format specific files
   * await service.format(['src/Token.compact', 'src/Utils.compact'], false);
   *
   * // Format entire project
   * await service.format([], false);
   * ```
   */
  async format(
    targets: string[] = [],
    checkMode = true,
  ): Promise<{ stdout: string; stderr: string }> {
    const checkFlag = checkMode ? ' --check' : '';
    const targetArgs =
      targets.length > 0 ? ` ${targets.map((t) => `"${t}"`).join(' ')}` : '';

    const command = `compact format${checkFlag}${targetArgs}`;
    return this.executeCompactCommand(command, 'Formatting failed');
  }

  /**
   * Creates formatting-specific error instances.
   *
   * Wraps formatting failures in FormatterError instances for consistent
   * error handling and reporting throughout the application.
   *
   * @param message - Error message describing the formatting failure
   * @param cause - Original error that caused the formatting failure (optional)
   * @returns FormatterError instance with cause information
   */
  protected createError(message: string, cause?: unknown): Error {
    return new FormatterError(message, undefined, cause);
  }
}

/**
 * UI service for formatting operations.
 *
 * Provides minimal UI elements specific to the formatting wrapper,
 * since most user feedback is handled by the underlying `compact format` tool.
 */
export const FormatterUIService = {
  ...SharedUIService,

  /**
   * Displays formatting environment information.
   *
   * Shows developer tools version and optional target directory information
   * to provide context about the formatting environment.
   *
   * @param devToolsVersion - Version of the installed Compact developer tools
   * @param targetDir - Optional target directory being formatted
   *
   * @example
   * ```typescript
   * FormatterUIService.displayEnvInfo('compact 0.2.0', 'contracts');
   * // Output:
   * // ℹ [FORMAT] TARGET_DIR: contracts
   * // ℹ [FORMAT] Compact developer tools: compact 0.2.0
   * ```
   */
  displayEnvInfo(devToolsVersion: string, targetDir?: string): void {
    SharedUIService.displayBaseEnvInfo('FORMAT', devToolsVersion, targetDir);
  },

  /**
   * Displays warning when no .compact files are found.
   *
   * Provides feedback when the formatting operation cannot proceed because
   * no source files were discovered in the target location.
   *
   * @param targetDir - Optional target directory that was searched
   *
   * @example
   * ```typescript
   * FormatterUIService.showNoFiles('contracts');
   * // Output: ⚠ [FORMAT] No .compact files found in contracts/.
   * ```
   */
  showNoFiles(targetDir?: string): void {
    SharedUIService.showNoFiles('FORMAT', targetDir);
  },
};

/**
 * Main formatter coordinator for Compact formatting operations.
 *
 * Lightweight orchestrator that validates environment, discovers files within
 * the project's src/ structure, then delegates to `compact format` for actual
 * formatting work. Acts as a bridge between project-specific configuration
 * and the underlying formatter tool.
 *
 * @example
 * ```typescript
 * // Check formatting of all files
 * const formatter = new CompactFormatter(true);
 * await formatter.format();
 *
 * // Format specific files
 * const formatter = new CompactFormatter(false, ['Token.compact']);
 * await formatter.format();
 *
 * // Format specific directory
 * const formatter = new CompactFormatter(false, [], 'contracts');
 * await formatter.format();
 * ```
 */
export class CompactFormatter extends BaseCompactOperation {
  private readonly environmentValidator: FormatterEnvironmentValidator;
  private readonly formatterService: FormatterService;
  private readonly checkMode: boolean;
  private readonly specificFiles: string[];

  /**
   * Creates a new CompactFormatter instance.
   *
   * Initializes the formatter with operation mode and target configuration.
   * Sets up environment validation and command execution services.
   *
   * @param checkMode - If true, validates formatting without writing changes
   * @param specificFiles - Array of specific .compact files to target
   * @param targetDir - Optional directory within src/ to limit scope
   * @param execFn - Optional command execution function for testing
   *
   * @example
   * ```typescript
   * // Check mode for CI/CD
   * const formatter = new CompactFormatter(true);
   *
   * // Format specific files
   * const formatter = new CompactFormatter(false, ['Token.compact']);
   *
   * // Format directory
   * const formatter = new CompactFormatter(false, [], 'contracts');
   * ```
   */
  constructor(
    checkMode = true,
    specificFiles: string[] = [],
    targetDir?: string,
    execFn?: ExecFunction,
  ) {
    super(targetDir);
    this.checkMode = checkMode;
    this.specificFiles = specificFiles;
    this.environmentValidator = new FormatterEnvironmentValidator(execFn);
    this.formatterService = new FormatterService(execFn);
  }

  /**
   * Factory method to create CompactFormatter from command-line arguments.
   *
   * Parses command-line arguments to construct a properly configured formatter.
   * Handles --check flag, --dir targeting, and specific file arguments.
   *
   * @param args - Raw command-line arguments array
   * @returns Configured CompactFormatter instance
   * @throws Error if arguments are malformed
   *
   * @example
   * ```typescript
   * // Parse: ['--check', '--dir', 'contracts']
   * const formatter = CompactFormatter.fromArgs(['--check', '--dir', 'contracts']);
   *
   * // Parse: ['Token.compact', 'Utils.compact']
   * const formatter = CompactFormatter.fromArgs(['Token.compact', 'Utils.compact']);
   * ```
   */
  static fromArgs(args: string[]): CompactFormatter {
    const { targetDir, remainingArgs } = CompactFormatter.parseBaseArgs(args);

    let checkMode = true; // Default to check mode
    const specificFiles: string[] = [];

    for (const arg of remainingArgs) {
      if (arg === '--check') {
        checkMode = true;
      } else if (arg === '--write') {
        checkMode = false; // Write mode
      } else if (!arg.startsWith('--')) {
        specificFiles.push(arg);
      }
    }

    return new CompactFormatter(checkMode, specificFiles, targetDir);
  }

  /**
   * Validates formatting environment and displays configuration.
   *
   * Ensures both CLI and formatter are available before proceeding with
   * formatting operations. Displays environment information for user feedback.
   *
   * @throws CompactCliNotFoundError if CLI is not available
   * @throws FormatterNotAvailableError if formatter is not available
   */
  async validateEnvironment(): Promise<void> {
    const { devToolsVersion } = await this.environmentValidator.validate();
    FormatterUIService.displayEnvInfo(devToolsVersion, this.targetDir);
  }

  /**
   * Displays warning when no .compact files are found.
   *
   * Provides user feedback when file discovery returns no results.
   */
  showNoFiles(): void {
    FormatterUIService.showNoFiles(this.targetDir);
  }

  /**
   * Executes the formatting workflow.
   *
   * Validates environment, then either formats specific files or discovers
   * and formats files within the target directory. Delegates actual formatting
   * to the underlying `compact format` command.
   *
   * @throws CompactCliNotFoundError if CLI is not available
   * @throws FormatterNotAvailableError if formatter is not available
   * @throws DirectoryNotFoundError if target directory doesn't exist
   * @throws FormatterError if formatting command fails
   *
   * @example
   * ```typescript
   * try {
   *   await formatter.format();
   * } catch (error) {
   *   if (error instanceof FormatterNotAvailableError) {
   *     console.error('Update compiler: compact update');
   *   }
   * }
   * ```
   */
  async format(): Promise<void> {
    await this.validateEnvironment();

    // Handle specific files
    if (this.specificFiles.length > 0) {
      const filePaths = this.specificFiles.map((file) => join(SRC_DIR, file));
      await this.formatterService.format(filePaths, this.checkMode);
      return;
    }

    // Handle directory or entire project
    const { files } = await this.discoverFiles();
    if (files.length === 0) return;

    const mode = this.checkMode ? 'check formatting for' : 'format';
    SharedUIService.showOperationStart(
      'FORMAT',
      mode,
      files.length,
      this.targetDir,
    );

    const targetPath = this.targetDir ? join(SRC_DIR, this.targetDir) : SRC_DIR;
    await this.formatterService.format([targetPath], this.checkMode);
  }

  /**
   * For testing - expose internal state
   */
  get testCheckMode(): boolean {
    return this.checkMode;
  }
  get testSpecificFiles(): string[] {
    return this.specificFiles;
  }
}
