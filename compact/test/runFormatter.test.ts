import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseErrorHandler } from '../src/BaseServices.js';
import { CompactFormatter } from '../src/Formatter.js';
import {
  FormatterError,
  FormatterNotAvailableError,
  isPromisifiedChildProcessError,
} from '../src/types/errors.js';

// Mock dependencies
vi.mock('../src/Formatter.js', () => ({
  CompactFormatter: {
    fromArgs: vi.fn(),
  },
}));

vi.mock('../src/BaseServices.js', () => ({
  BaseErrorHandler: {
    handleCommonErrors: vi.fn(),
    handleUnexpectedError: vi.fn(),
  },
}));

vi.mock('../src/types/errors.js', async () => {
  const actual = await vi.importActual('../src/types/errors.js');
  return {
    ...actual,
    isPromisifiedChildProcessError: vi.fn(),
  };
});

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    blue: (text: string) => text,
    red: (text: string) => text,
    yellow: (text: string) => text,
    gray: (text: string) => text,
  },
}));

// Mock ora
const mockSpinner = {
  info: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
};
vi.mock('ora', () => ({
  default: vi.fn(() => mockSpinner),
}));

// Mock process.exit
const mockExit = vi
  .spyOn(process, 'exit')
  .mockImplementation(() => undefined as never);

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

describe('runFormatter CLI', () => {
  let mockFormat: ReturnType<typeof vi.fn>;
  let mockFromArgs: ReturnType<typeof vi.fn>;
  let mockHandleCommonErrors: ReturnType<typeof vi.fn>;
  let mockHandleUnexpectedError: ReturnType<typeof vi.fn>;
  let originalArgv: string[];

  beforeEach(() => {
    // Store original argv
    originalArgv = [...process.argv];

    vi.clearAllMocks();
    vi.resetModules();

    mockFormat = vi.fn();
    mockFromArgs = vi.mocked(CompactFormatter.fromArgs);
    mockHandleCommonErrors = vi.mocked(BaseErrorHandler.handleCommonErrors);
    mockHandleUnexpectedError = vi.mocked(
      BaseErrorHandler.handleUnexpectedError,
    );

    // Mock CompactFormatter instance
    mockFromArgs.mockReturnValue({
      format: mockFormat,
    } as any);

    // Clear all mock calls
    mockSpinner.info.mockClear();
    mockSpinner.fail.mockClear();
    mockSpinner.succeed.mockClear();
    mockConsoleLog.mockClear();
    mockExit.mockClear();
  });

  afterEach(() => {
    // Restore original argv
    process.argv = originalArgv;
  });

  describe('successful formatting', () => {
    it('formats successfully with no arguments', async () => {
      const testData = {
        expectedArgs: [],
      };

      mockFormat.mockResolvedValue(undefined);

      // Import and run the CLI
      await import('../src/runFormatter.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.expectedArgs);
      expect(mockFormat).toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('formats successfully with arguments', async () => {
      const testData = {
        args: ['--dir', 'security', '--check'],
        processArgv: [
          'node',
          'runFormatter.js',
          '--dir',
          'security',
          '--check',
        ],
      };

      process.argv = testData.processArgv;
      mockFormat.mockResolvedValue(undefined);

      await import('../src/runFormatter.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.args);
      expect(mockFormat).toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe('error handling delegation', () => {
    it('delegates to BaseErrorHandler.handleCommonErrors first', async () => {
      const testData = {
        error: new Error('Directory not found'),
        operation: 'FORMAT',
      };

      mockHandleCommonErrors.mockReturnValue(true); // Indicates error was handled
      mockFormat.mockRejectedValue(testData.error);

      await import('../src/runFormatter.js');

      expect(mockHandleCommonErrors).toHaveBeenCalledWith(
        testData.error,
        expect.any(Object), // spinner
        testData.operation,
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('handles FormatterNotAvailableError when BaseErrorHandler returns false', async () => {
      const testData = {
        error: new FormatterNotAvailableError('Formatter not available'),
        expectedFailMessage: '[FORMAT] Error: Formatter not available',
        expectedUpdateMessages: [
          '[FORMAT] Update compiler with: compact update',
          '[FORMAT] Update dev tools with: compact self update',
        ],
      };

      mockHandleCommonErrors.mockReturnValue(false); // Not handled by base
      mockFormat.mockRejectedValue(testData.error);

      await import('../src/runFormatter.js');

      expect(mockHandleCommonErrors).toHaveBeenCalled();
      expect(mockSpinner.fail).toHaveBeenCalledWith(
        testData.expectedFailMessage,
      );
      testData.expectedUpdateMessages.forEach((message) => {
        expect(mockSpinner.info).toHaveBeenCalledWith(message);
      });
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('handles FormatterError with child process details', async () => {
      const testData = {
        execError: {
          stderr: 'Formatting error details',
          stdout: 'Some output',
        },
        expectedFailMessage: '[FORMAT] Formatting operation failed',
      };

      const formatterError = new FormatterError(
        'Formatting failed',
        'Token.compact',
        testData.execError,
      );

      mockHandleCommonErrors.mockReturnValue(false);
      vi.mocked(isPromisifiedChildProcessError).mockReturnValue(true);
      mockFormat.mockRejectedValue(formatterError);

      await import('../src/runFormatter.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        testData.expectedFailMessage,
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '    Formatting error details',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('    Some output');
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('skips stderr output when it contains compact format keyword', async () => {
      const testData = {
        execError: {
          stderr: 'Error: compact format failed',
          stdout: 'some output',
        },
      };

      const formatterError = new FormatterError(
        'Formatting failed',
        undefined,
        testData.execError,
      );

      mockHandleCommonErrors.mockReturnValue(false);
      vi.mocked(isPromisifiedChildProcessError).mockReturnValue(true);
      mockFormat.mockRejectedValue(formatterError);

      await import('../src/runFormatter.js');

      expect(mockConsoleLog).not.toHaveBeenCalledWith(
        expect.stringContaining('Error: compact format failed'),
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('    some output');
    });

    it('shows usage help for argument parsing errors', async () => {
      const testData = {
        error: new Error('--dir flag requires a directory name'),
      };

      mockHandleCommonErrors.mockReturnValue(false);
      mockFormat.mockRejectedValue(testData.error);

      await import('../src/runFormatter.js');

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '\nUsage: compact-formatter [options] [files...]',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('\nOptions:');
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('delegates unexpected errors to BaseErrorHandler', async () => {
      const testData = {
        error: new Error('Unexpected error'),
        operation: 'FORMAT',
      };

      mockHandleCommonErrors.mockReturnValue(false);
      mockFormat.mockRejectedValue(testData.error);

      await import('../src/runFormatter.js');

      expect(mockHandleUnexpectedError).toHaveBeenCalledWith(
        testData.error,
        expect.any(Object), // spinner
        testData.operation,
      );
    });
  });

  describe('FormatterError handling details', () => {
    it('handles FormatterError without child process details', async () => {
      const testData = {
        error: new FormatterError('Simple formatting error'),
        expectedMessage: '[FORMAT] Formatting operation failed',
      };

      mockHandleCommonErrors.mockReturnValue(false);
      vi.mocked(isPromisifiedChildProcessError).mockReturnValue(false);
      mockFormat.mockRejectedValue(testData.error);

      await import('../src/runFormatter.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(testData.expectedMessage);
      expect(mockConsoleLog).not.toHaveBeenCalled();
    });

    it('handles empty stdout and stderr gracefully', async () => {
      const testData = {
        execError: {
          stderr: '',
          stdout: '',
        },
      };

      const formatterError = new FormatterError(
        'Formatting failed',
        undefined,
        testData.execError,
      );

      mockHandleCommonErrors.mockReturnValue(false);
      vi.mocked(isPromisifiedChildProcessError).mockReturnValue(true);
      mockFormat.mockRejectedValue(formatterError);

      await import('../src/runFormatter.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        '[FORMAT] Formatting operation failed',
      );
      expect(mockConsoleLog).not.toHaveBeenCalled();
    });
  });

  describe('argument parsing error handling', () => {
    it('shows complete usage help', async () => {
      const testData = {
        error: new Error('--dir flag requires a directory name'),
        expectedSections: [
          '\nUsage: compact-formatter [options] [files...]',
          '\nOptions:',
          '  --check           Check if files are properly formatted (default)',
          '  --write           Write formatting changes to files',
          '  --dir <directory> Format specific directory (access, archive, security, token, utils)',
          '\nExamples:',
          '  compact-formatter                                    # Check all files (default)',
          '  compact-formatter --write                            # Format all files',
          '  compact-formatter --write --dir security             # Format security directory',
          '  compact-formatter --write f1.compact f2.compact      # Format specific files',
        ],
      };

      mockHandleCommonErrors.mockReturnValue(false);
      mockFormat.mockRejectedValue(testData.error);

      await import('../src/runFormatter.js');

      testData.expectedSections.forEach((section) => {
        expect(mockConsoleLog).toHaveBeenCalledWith(section);
      });
    });
  });

  describe('real-world command scenarios', () => {
    beforeEach(() => {
      mockFormat.mockResolvedValue(undefined);
    });

    it('handles yarn format (check mode)', async () => {
      const testData = {
        processArgv: ['node', 'runFormatter.js'],
        expectedArgs: [],
      };

      process.argv = testData.processArgv;

      await import('../src/runFormatter.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.expectedArgs);
    });

    it('handles yarn format:fix (write mode)', async () => {
      const testData = {
        processArgv: ['node', 'runFormatter.js', '--write'],
        expectedArgs: ['--write'],
      };

      process.argv = testData.processArgv;

      await import('../src/runFormatter.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.expectedArgs);
    });

    it('handles directory-specific formatting', async () => {
      const testData = {
        processArgv: [
          'node',
          'runFormatter.js',
          '--write',
          '--dir',
          'security',
        ],
        expectedArgs: ['--write', '--dir', 'security'],
      };

      process.argv = testData.processArgv;

      await import('../src/runFormatter.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.expectedArgs);
    });

    it('handles specific file formatting', async () => {
      const testData = {
        processArgv: [
          'node',
          'runFormatter.js',
          '--write',
          'Token.compact',
          'AccessControl.compact',
        ],
        expectedArgs: ['--write', 'Token.compact', 'AccessControl.compact'],
      };

      process.argv = testData.processArgv;

      await import('../src/runFormatter.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.expectedArgs);
    });
  });

  describe('integration with CompactFormatter', () => {
    it('passes arguments correctly to CompactFormatter.fromArgs', async () => {
      const testData = {
        args: ['--dir', 'contracts', '--check'],
        processArgv: [
          'node',
          'runFormatter.js',
          '--dir',
          'contracts',
          '--check',
        ],
      };

      process.argv = testData.processArgv;
      mockFormat.mockResolvedValue(undefined);

      await import('../src/runFormatter.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.args);
      expect(mockFromArgs).toHaveBeenCalledTimes(1);
      expect(mockFormat).toHaveBeenCalledTimes(1);
    });

    it('handles fromArgs throwing errors', async () => {
      const testData = {
        error: new Error('Invalid arguments'),
      };

      mockFromArgs.mockImplementation(() => {
        throw testData.error;
      });

      await import('../src/runFormatter.js');

      expect(mockHandleCommonErrors).toHaveBeenCalledWith(
        testData.error,
        expect.any(Object),
        'FORMAT',
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('edge cases', () => {
    it('handles mixed check and write flags', async () => {
      const testData = {
        processArgv: ['node', 'runFormatter.js', '--check', '--write'],
        expectedArgs: ['--check', '--write'],
      };

      process.argv = testData.processArgv;
      mockFormat.mockResolvedValue(undefined);

      await import('../src/runFormatter.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.expectedArgs);
    });

    it('handles empty file list', async () => {
      const testData = {
        processArgv: ['node', 'runFormatter.js', '--write'],
        expectedArgs: ['--write'],
      };

      process.argv = testData.processArgv;
      mockFormat.mockResolvedValue(undefined);

      await import('../src/runFormatter.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.expectedArgs);
      expect(mockFormat).toHaveBeenCalled();
    });
  });
});
