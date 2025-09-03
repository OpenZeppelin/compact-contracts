import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompactCompiler } from '../src/Compiler.js';
import {
  CompactCliNotFoundError,
  CompilationError,
  DirectoryNotFoundError,
} from '../src/types/errors.js';

// Mock the CompactCompiler
vi.mock('../src/Compiler.js', () => ({
  CompactCompiler: {
    fromArgs: vi.fn(),
  },
}));

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
  fail: vi.fn(),
  succeed: vi.fn(),
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

describe('runCompiler CLI', () => {
  let mockCompile: ReturnType<typeof vi.fn>;
  let mockFromArgs: ReturnType<typeof vi.fn>;
  let originalArgv: string[];

  beforeEach(() => {
    // Store original argv
    originalArgv = [...process.argv];

    vi.clearAllMocks();
    vi.resetModules();

    mockCompile = vi.fn();
    mockFromArgs = vi.mocked(CompactCompiler.fromArgs);

    // Mock CompactCompiler instance
    mockFromArgs.mockReturnValue({
      compile: mockCompile,
    } as any);

    // Clear all mock calls
    mockSpinner.info.mockClear();
    mockSpinner.fail.mockClear();
    mockConsoleLog.mockClear();
    mockExit.mockClear();
  });

  afterEach(() => {
    // Restore original argv
    process.argv = originalArgv;
  });

  describe('successful compilation', () => {
    it('should compile successfully with no arguments', async () => {
      mockCompile.mockResolvedValue(undefined);

      // Import and run the CLI
      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith([]);
      expect(mockCompile).toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('should compile successfully with arguments', async () => {
      process.argv = [
        'node',
        'runCompiler.js',
        '--dir',
        'security',
        '--skip-zk',
      ];
      mockCompile.mockResolvedValue(undefined);

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith([
        '--dir',
        'security',
        '--skip-zk',
      ]);
      expect(mockCompile).toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle CompactCliNotFoundError silently', async () => {
      const error = new CompactCliNotFoundError('CLI not found');
      mockCompile.mockRejectedValue(error);

      await import('../src/runCompiler.js');

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockSpinner.fail).not.toHaveBeenCalled();
    });

    it('should handle DirectoryNotFoundError with helpful message', async () => {
      const error = new DirectoryNotFoundError(
        'Directory not found',
        'src/nonexistent',
      );
      mockCompile.mockRejectedValue(error);

      await import('../src/runCompiler.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        '[COMPILE] Error: Directory not found',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('Available directories:');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        ' --dir access # Compile access control contracts',
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle CompilationError silently', async () => {
      const error = new CompilationError(
        'Compilation failed',
        'MyToken.compact',
      );
      mockCompile.mockRejectedValue(error);

      await import('../src/runCompiler.js');

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockSpinner.fail).not.toHaveBeenCalled();
    });

    it('should handle argument parsing errors', async () => {
      const error = new Error('--dir flag requires a directory name');
      mockFromArgs.mockImplementation(() => {
        throw error;
      });

      await import('../src/runCompiler.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        '[COMPILE] Error: --dir flag requires a directory name',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '\nUsage: compact-compiler [options]',
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle unexpected errors', async () => {
      const msg = 'Something unexpected happened';
      const error = new Error(msg);
      mockCompile.mockRejectedValue(error);

      await import('../src/runCompiler.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        `[COMPILE] Unexpected error: ${msg}`,
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '\nIf this error persists, please check:',
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle non-Error exceptions', async () => {
      const msg = 'String error';
      mockCompile.mockRejectedValue(msg);

      await import('../src/runCompiler.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        `[COMPILE] Unexpected error: ${msg}`,
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('usage help', () => {
    it('should show complete usage help for argument parsing errors', async () => {
      const error = new Error('--dir flag requires a directory name');
      mockFromArgs.mockImplementation(() => {
        throw error;
      });

      await import('../src/runCompiler.js');

      // Verify all sections of help are shown
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '\nUsage: compact-compiler [options]',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('\nOptions:');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        ' --dir <directory> Compile specific directory (access, archive, security, token, utils)',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        ' --skip-zk Skip zero-knowledge proof generation',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        ' +<version> Use specific toolchain version (e.g., +0.24.0)',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('\nExamples:');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  compact-compiler # Compile all files',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('\nTurbo integration:');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        ' turbo compact # Full build',
      );
    });
  });

  describe('directory error help', () => {
    it('should show all available directories', async () => {
      const error = new DirectoryNotFoundError(
        'Directory not found',
        'src/invalid',
      );
      mockCompile.mockRejectedValue(error);

      await import('../src/runCompiler.js');

      expect(mockConsoleLog).toHaveBeenCalledWith('Available directories:');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        ' --dir access # Compile access control contracts',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir archive   # Compile archive contracts',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir security  # Compile security contracts',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir token     # Compile token contracts',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir utils     # Compile utility contracts',
      );
    });
  });

  describe('real-world command scenarios', () => {
    beforeEach(() => {
      mockCompile.mockResolvedValue(undefined);
    });

    it('should handle turbo compact', async () => {
      process.argv = ['node', 'runCompiler.js'];

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith([]);
    });

    it('should handle turbo compact:security', async () => {
      process.argv = ['node', 'runCompiler.js', '--dir', 'security'];

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith(['--dir', 'security']);
    });

    it('should handle turbo compact:access -- --skip-zk', async () => {
      process.argv = ['node', 'runCompiler.js', '--dir', 'access', '--skip-zk'];

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith([
        '--dir',
        'access',
        '--skip-zk',
      ]);
    });

    it('should handle version specification', async () => {
      process.argv = ['node', 'runCompiler.js', '+0.24.0', '--skip-zk'];

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith(['+0.24.0', '--skip-zk']);
    });

    it('should handle complex command', async () => {
      process.argv = [
        'node',
        'runCompiler.js',
        '--dir',
        'security',
        '--skip-zk',
        '--verbose',
        '+0.24.0',
      ];

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith([
        '--dir',
        'security',
        '--skip-zk',
        '--verbose',
        '+0.24.0',
      ]);
    });
  });

  describe('integration with CompactCompiler', () => {
    it('should pass arguments correctly to CompactCompiler.fromArgs', async () => {
      const args = ['--dir', 'token', '--skip-zk', '+0.24.0'];
      process.argv = ['node', 'runCompiler.js', ...args];
      mockCompile.mockResolvedValue(undefined);

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith(args);
      expect(mockFromArgs).toHaveBeenCalledTimes(1);
      expect(mockCompile).toHaveBeenCalledTimes(1);
    });

    it('should handle empty arguments', async () => {
      process.argv = ['node', 'runCompiler.js'];
      mockCompile.mockResolvedValue(undefined);

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith([]);
    });
  });
});
