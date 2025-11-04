import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from 'vitest';
import {
  CompactCompiler,
  CompilerService,
  EnvironmentValidator,
  type ExecFunction,
  FileDiscovery,
  UIService,
} from '../src/Compiler.js';
import {
  CompactCliNotFoundError,
  CompilationError,
  DirectoryNotFoundError,
} from '../src/types/errors.js';

// Mock Node.js modules
vi.mock('node:fs');
vi.mock('node:fs/promises');
vi.mock('chalk', () => ({
  default: {
    blue: (text: string) => text,
    green: (text: string) => text,
    red: (text: string) => text,
    yellow: (text: string) => text,
    cyan: (text: string) => text,
    gray: (text: string) => text,
  },
}));

// Mock spinner
const mockSpinner = {
  start: () => ({ succeed: vi.fn(), fail: vi.fn(), text: '' }),
  info: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
  succeed: vi.fn(),
};

vi.mock('ora', () => ({
  default: () => mockSpinner,
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReaddir = vi.mocked(readdir);

describe('EnvironmentValidator', () => {
  let mockExec: MockedFunction<ExecFunction>;
  let validator: EnvironmentValidator;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExec = vi.fn();
    validator = new EnvironmentValidator(mockExec);
  });

  describe('checkCompactAvailable', () => {
    it('should return true when compact CLI is available', async () => {
      mockExec.mockResolvedValue({ stdout: 'compact 0.1.0', stderr: '' });

      const result = await validator.checkCompactAvailable();

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('compact --version');
    });

    it('should return false when compact CLI is not available', async () => {
      mockExec.mockRejectedValue(new Error('Command not found'));

      const result = await validator.checkCompactAvailable();

      expect(result).toBe(false);
      expect(mockExec).toHaveBeenCalledWith('compact --version');
    });
  });

  describe('getDevToolsVersion', () => {
    it('should return trimmed version string', async () => {
      mockExec.mockResolvedValue({ stdout: '  compact 0.1.0  \n', stderr: '' });

      const version = await validator.getDevToolsVersion();

      expect(version).toBe('compact 0.1.0');
      expect(mockExec).toHaveBeenCalledWith('compact --version');
    });

    it('should throw error when command fails', async () => {
      mockExec.mockRejectedValue(new Error('Command failed'));

      await expect(validator.getDevToolsVersion()).rejects.toThrow(
        'Command failed',
      );
    });
  });

  describe('getToolchainVersion', () => {
    it('should get version without specific version flag', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Compactc version: 0.26.0',
        stderr: '',
      });

      const version = await validator.getToolchainVersion();

      expect(version).toBe('Compactc version: 0.26.0');
      expect(mockExec).toHaveBeenCalledWith('compact compile  --version');
    });

    it('should get version with specific version flag', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Compactc version: 0.26.0',
        stderr: '',
      });

      const version = await validator.getToolchainVersion('0.26.0');

      expect(version).toBe('Compactc version: 0.26.0');
      expect(mockExec).toHaveBeenCalledWith(
        'compact compile +0.26.0 --version',
      );
    });
  });

  describe('validate', () => {
    it('should validate successfully when CLI is available', async () => {
      mockExec.mockResolvedValue({ stdout: 'compact 0.1.0', stderr: '' });

      await expect(validator.validate()).resolves.not.toThrow();
    });

    it('should throw CompactCliNotFoundError when CLI is not available', async () => {
      mockExec.mockRejectedValue(new Error('Command not found'));

      await expect(validator.validate()).rejects.toThrow(
        CompactCliNotFoundError,
      );
    });
  });
});

describe('FileDiscovery', () => {
  let discovery: FileDiscovery;

  beforeEach(() => {
    vi.clearAllMocks();
    discovery = new FileDiscovery();
  });

  describe('getCompactFiles', () => {
    it('should find .compact files in directory', async () => {
      const mockDirents = [
        {
          name: 'MyToken.compact',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'Ownable.compact',
          isFile: () => true,
          isDirectory: () => false,
        },
        { name: 'README.md', isFile: () => true, isDirectory: () => false },
        { name: 'utils', isFile: () => false, isDirectory: () => true },
      ];

      mockReaddir
        .mockResolvedValueOnce(mockDirents as any)
        .mockResolvedValueOnce([
          {
            name: 'Utils.compact',
            isFile: () => true,
            isDirectory: () => false,
          },
        ] as any);

      const files = await discovery.getCompactFiles('src');

      expect(files).toEqual([
        'MyToken.compact',
        'Ownable.compact',
        'utils/Utils.compact',
      ]);
    });

    it('should handle empty directories', async () => {
      mockReaddir.mockResolvedValue([]);

      const files = await discovery.getCompactFiles('src');

      expect(files).toEqual([]);
    });

    it('should handle directory read errors gracefully', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => { });

      mockReaddir.mockRejectedValueOnce(new Error('Permission denied'));

      const files = await discovery.getCompactFiles('src');

      expect(files).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to read dir: src',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it('should handle file access errors gracefully', async () => {
      const mockDirents = [
        {
          name: 'MyToken.compact',
          isFile: () => {
            throw new Error('Access denied');
          },
          isDirectory: () => false,
        },
        {
          name: 'Ownable.compact',
          isFile: () => true,
          isDirectory: () => false,
        },
      ];

      mockReaddir.mockResolvedValue(mockDirents as any);

      const files = await discovery.getCompactFiles('src');

      expect(files).toEqual(['Ownable.compact']);
    });
  });
});

describe('CompilerService', () => {
  let mockExec: MockedFunction<ExecFunction>;
  let service: CompilerService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExec = vi.fn();
    service = new CompilerService(mockExec);
  });

  describe('compileFile', () => {
    it('should compile file successfully with basic flags', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Compilation successful',
        stderr: '',
      });

      const result = await service.compileFile('MyToken.compact', '--skip-zk');

      expect(result).toEqual({ stdout: 'Compilation successful', stderr: '' });
      expect(mockExec).toHaveBeenCalledWith(
        'compact compile --skip-zk "src/MyToken.compact" "artifacts/MyToken"',
      );
    });

    it('should compile file with version flag', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Compilation successful',
        stderr: '',
      });

      const result = await service.compileFile(
        'MyToken.compact',
        '--skip-zk',
        '0.26.0',
      );

      expect(result).toEqual({ stdout: 'Compilation successful', stderr: '' });
      expect(mockExec).toHaveBeenCalledWith(
        'compact compile +0.26.0 --skip-zk "src/MyToken.compact" "artifacts/MyToken"',
      );
    });

    it('should handle empty flags', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Compilation successful',
        stderr: '',
      });

      const result = await service.compileFile('MyToken.compact', '');

      expect(result).toEqual({ stdout: 'Compilation successful', stderr: '' });
      expect(mockExec).toHaveBeenCalledWith(
        'compact compile "src/MyToken.compact" "artifacts/MyToken"',
      );
    });

    it('should throw CompilationError when compilation fails', async () => {
      mockExec.mockRejectedValue(new Error('Syntax error on line 10'));

      await expect(
        service.compileFile('MyToken.compact', '--skip-zk'),
      ).rejects.toThrow(CompilationError);
    });

    it('should include file path in CompilationError', async () => {
      mockExec.mockRejectedValue(new Error('Syntax error'));

      try {
        await service.compileFile('MyToken.compact', '--skip-zk');
      } catch (error) {
        expect(error).toBeInstanceOf(CompilationError);
        expect((error as CompilationError).file).toBe('MyToken.compact');
      }
    });

    it('should include cause in CompilationError', async () => {
      const mockError = new Error('Syntax error');
      mockExec.mockRejectedValue(mockError);

      try {
        await service.compileFile('MyToken.compact', '--skip-zk');
      } catch (error) {
        expect(error).toBeInstanceOf(CompilationError);
        expect((error as CompilationError).cause).toEqual(mockError);
      }
    });
  });
});

describe('UIService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => { });
  });

  describe('printOutput', () => {
    it('should format output with indentation', () => {
      const mockColorFn = vi.fn((text: string) => `colored(${text})`);

      UIService.printOutput('line 1\nline 2\n\nline 3', mockColorFn);

      expect(mockColorFn).toHaveBeenCalledWith(
        '    line 1\n    line 2\n    line 3',
      );
      expect(console.log).toHaveBeenCalledWith(
        'colored(    line 1\n    line 2\n    line 3)',
      );
    });

    it('should handle empty output', () => {
      const mockColorFn = vi.fn((text: string) => `colored(${text})`);

      UIService.printOutput('', mockColorFn);

      expect(mockColorFn).toHaveBeenCalledWith('');
      expect(console.log).toHaveBeenCalledWith('colored()');
    });
  });

  describe('displayEnvInfo', () => {
    it('should display environment information with all parameters', () => {
      UIService.displayEnvInfo(
        'compact 0.1.0',
        'Compactc 0.26.0',
        'security',
        '0.26.0',
      );

      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[COMPILE] TARGET_DIR: security',
      );
      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[COMPILE] Compact developer tools: compact 0.1.0',
      );
      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[COMPILE] Compact toolchain: Compactc 0.26.0',
      );
      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[COMPILE] Using toolchain version: 0.26.0',
      );
    });

    it('should display environment information without optional parameters', () => {
      UIService.displayEnvInfo('compact 0.1.0', 'Compactc 0.26.0');

      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[COMPILE] Compact developer tools: compact 0.1.0',
      );
      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[COMPILE] Compact toolchain: Compactc 0.26.0',
      );
      expect(mockSpinner.info).not.toHaveBeenCalledWith(
        expect.stringContaining('TARGET_DIR'),
      );
      expect(mockSpinner.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Using toolchain version'),
      );
    });
  });

  describe('showCompilationStart', () => {
    it('should show file count without target directory', () => {
      UIService.showCompilationStart(5);

      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[COMPILE] Found 5 .compact file(s) to compile',
      );
    });

    it('should show file count with target directory', () => {
      UIService.showCompilationStart(3, 'security');

      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[COMPILE] Found 3 .compact file(s) to compile in security/',
      );
    });
  });

  describe('showNoFiles', () => {
    it('should show no files message with target directory', () => {
      UIService.showNoFiles('security');

      expect(mockSpinner.warn).toHaveBeenCalledWith(
        '[COMPILE] No .compact files found in security/.',
      );
    });

    it('should show no files message without target directory', () => {
      UIService.showNoFiles();

      expect(mockSpinner.warn).toHaveBeenCalledWith(
        '[COMPILE] No .compact files found in .',
      );
    });
  });
});

describe('CompactCompiler', () => {
  let mockExec: MockedFunction<ExecFunction>;
  let compiler: CompactCompiler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExec = vi.fn().mockResolvedValue({ stdout: 'success', stderr: '' });
    mockExistsSync.mockReturnValue(true);
    mockReaddir.mockResolvedValue([]);
  });

  describe('constructor', () => {
    it('should create instance with default parameters', () => {
      compiler = new CompactCompiler();

      expect(compiler).toBeInstanceOf(CompactCompiler);
    });

    it('should create instance with all parameters', () => {
      compiler = new CompactCompiler(
        '--skip-zk',
        'security',
        '0.26.0',
        mockExec,
      );

      expect(compiler).toBeInstanceOf(CompactCompiler);
    });

    it('should trim flags', () => {
      compiler = new CompactCompiler('  --skip-zk --verbose  ');
      expect(compiler.testFlags).toBe('--skip-zk --verbose');
    });
  });

  describe('fromArgs', () => {
    it('should parse empty arguments', () => {
      compiler = CompactCompiler.fromArgs([]);

      expect(compiler.testFlags).toBe('');
      expect(compiler.testTargetDir).toBeUndefined();
      expect(compiler.testVersion).toBeUndefined();
    });

    it('should handle SKIP_ZK environment variable', () => {
      compiler = CompactCompiler.fromArgs([], { SKIP_ZK: 'true' });

      expect(compiler.testFlags).toBe('--skip-zk');
    });

    it('should ignore SKIP_ZK when not "true"', () => {
      compiler = CompactCompiler.fromArgs([], { SKIP_ZK: 'false' });

      expect(compiler.testFlags).toBe('');
    });

    it('should parse --dir flag', () => {
      compiler = CompactCompiler.fromArgs(['--dir', 'security']);

      expect(compiler.testTargetDir).toBe('security');
      expect(compiler.testFlags).toBe('');
    });

    it('should parse --dir flag with additional flags', () => {
      compiler = CompactCompiler.fromArgs([
        '--dir',
        'security',
        '--skip-zk',
        '--verbose',
      ]);

      expect(compiler.testTargetDir).toBe('security');
      expect(compiler.testFlags).toBe('--skip-zk --verbose');
    });

    it('should parse version flag', () => {
      compiler = CompactCompiler.fromArgs(['+0.26.0']);

      expect(compiler.testVersion).toBe('0.26.0');
      expect(compiler.testFlags).toBe('');
    });

    it('should parse complex arguments', () => {
      compiler = CompactCompiler.fromArgs([
        '--dir',
        'security',
        '--skip-zk',
        '--verbose',
        '+0.26.0',
      ]);

      expect(compiler.testTargetDir).toBe('security');
      expect(compiler.testFlags).toBe('--skip-zk --verbose');
      expect(compiler.testVersion).toBe('0.26.0');
    });

    it('should combine environment variables with CLI flags', () => {
      compiler = CompactCompiler.fromArgs(['--dir', 'access', '--verbose'], {
        SKIP_ZK: 'true',
      });

      expect(compiler.testTargetDir).toBe('access');
      expect(compiler.testFlags).toBe('--skip-zk --verbose');
    });

    it('should deduplicate flags when both env var and CLI flag are present', () => {
      compiler = CompactCompiler.fromArgs(['--skip-zk', '--verbose'], {
        SKIP_ZK: 'true',
      });

      expect(compiler.testFlags).toBe('--skip-zk --verbose');
    });

    it('should throw error for --dir without argument', () => {
      expect(() => CompactCompiler.fromArgs(['--dir'])).toThrow(
        '--dir flag requires a directory name',
      );
    });

    it('should throw error for --dir followed by another flag', () => {
      expect(() => CompactCompiler.fromArgs(['--dir', '--skip-zk'])).toThrow(
        '--dir flag requires a directory name',
      );
    });
  });

  describe('validateEnvironment', () => {
    it('should validate successfully and display environment info', async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: 'compact 0.1.0', stderr: '' }) // checkCompactAvailable
        .mockResolvedValueOnce({ stdout: 'compact 0.1.0', stderr: '' }) // getDevToolsVersion
        .mockResolvedValueOnce({
          stdout: 'Compactc version: 0.26.0',
          stderr: '',
        }); // getToolchainVersion

      compiler = new CompactCompiler(
        '--skip-zk',
        'security',
        '0.26.0',
        mockExec,
      );
      const displaySpy = vi
        .spyOn(UIService, 'displayEnvInfo')
        .mockImplementation(() => { });

      await expect(compiler.validateEnvironment()).resolves.not.toThrow();

      // Check steps
      expect(mockExec).toHaveBeenCalledTimes(3);
      expect(mockExec).toHaveBeenNthCalledWith(1, 'compact --version'); // validate() calls
      expect(mockExec).toHaveBeenNthCalledWith(2, 'compact --version'); // getDevToolsVersion()
      expect(mockExec).toHaveBeenNthCalledWith(
        3,
        'compact compile +0.26.0 --version',
      ); // getToolchainVersion()

      // Verify passed args
      expect(displaySpy).toHaveBeenCalledWith(
        'compact 0.1.0',
        'Compactc version: 0.26.0',
        'security',
        '0.26.0',
      );

      displaySpy.mockRestore();
    });

    it('should handle CompactCliNotFoundError with installation instructions', async () => {
      mockExec.mockRejectedValue(new Error('Command not found'));
      compiler = new CompactCompiler('', undefined, undefined, mockExec);

      await expect(compiler.validateEnvironment()).rejects.toThrow(
        CompactCliNotFoundError,
      );
    });

    it('should handle version retrieval failures after successful CLI check', async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: 'compact 0.1.0', stderr: '' }) // validate() succeeds
        .mockRejectedValueOnce(new Error('Version command failed')); // getDevToolsVersion() fails

      compiler = new CompactCompiler('', undefined, undefined, mockExec);

      await expect(compiler.validateEnvironment()).rejects.toThrow(
        'Version command failed',
      );
    });

    it('should handle PromisifiedChildProcessError specifically', async () => {
      const childProcessError = new Error('Command execution failed') as any;
      childProcessError.stdout = 'some output';
      childProcessError.stderr = 'some error';

      mockExec.mockRejectedValue(childProcessError);
      compiler = new CompactCompiler('', undefined, undefined, mockExec);

      await expect(compiler.validateEnvironment()).rejects.toThrow(
        "'compact' CLI not found in PATH. Please install the Compact developer tools.",
      );
    });

    it('should handle non-Error exceptions gracefully', async () => {
      mockExec.mockRejectedValue('String error message');
      compiler = new CompactCompiler('', undefined, undefined, mockExec);

      await expect(compiler.validateEnvironment()).rejects.toThrow(
        CompactCliNotFoundError,
      );
    });

    it('should validate with specific version flag', async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: 'compact 0.1.0', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'compact 0.1.0', stderr: '' })
        .mockResolvedValueOnce({
          stdout: 'Compactc version: 0.26.0',
          stderr: '',
        });

      compiler = new CompactCompiler('', undefined, '0.26.0', mockExec);
      const displaySpy = vi
        .spyOn(UIService, 'displayEnvInfo')
        .mockImplementation(() => { });

      await compiler.validateEnvironment();

      // Verify version-specific toolchain call
      expect(mockExec).toHaveBeenNthCalledWith(
        3,
        'compact compile +0.26.0 --version',
      );
      expect(displaySpy).toHaveBeenCalledWith(
        'compact 0.1.0',
        'Compactc version: 0.26.0',
        undefined, // no targetDir
        '0.26.0',
      );

      displaySpy.mockRestore();
    });

    it('should validate without target directory or version', async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: 'compact 0.1.0', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'compact 0.1.0', stderr: '' })
        .mockResolvedValueOnce({
          stdout: 'Compactc version: 0.26.0',
          stderr: '',
        });

      compiler = new CompactCompiler('', undefined, undefined, mockExec);
      const displaySpy = vi
        .spyOn(UIService, 'displayEnvInfo')
        .mockImplementation(() => { });

      await compiler.validateEnvironment();

      // Verify default toolchain call (no version flag)
      expect(mockExec).toHaveBeenNthCalledWith(3, 'compact compile  --version');
      expect(displaySpy).toHaveBeenCalledWith(
        'compact 0.1.0',
        'Compactc version: 0.26.0',
        undefined,
        undefined,
      );

      displaySpy.mockRestore();
    });
  });

  describe('compile', () => {
    it('should handle empty source directory', async () => {
      mockReaddir.mockResolvedValue([]);
      compiler = new CompactCompiler('', undefined, undefined, mockExec);

      await expect(compiler.compile()).resolves.not.toThrow();
    });

    it('should throw error if target directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      compiler = new CompactCompiler('', 'nonexistent', undefined, mockExec);

      await expect(compiler.compile()).rejects.toThrow(DirectoryNotFoundError);
    });

    it('should compile files successfully', async () => {
      const mockDirents = [
        {
          name: 'MyToken.compact',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'Ownable.compact',
          isFile: () => true,
          isDirectory: () => false,
        },
      ];
      mockReaddir.mockResolvedValue(mockDirents as any);
      compiler = new CompactCompiler(
        '--skip-zk',
        undefined,
        undefined,
        mockExec,
      );

      await compiler.compile();

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('compact compile --skip-zk'),
      );
    });

    it('should handle compilation errors gracefully', async () => {
      const brokenDirent = {
        name: 'Broken.compact',
        isFile: () => true,
        isDirectory: () => false,
      };

      const mockDirents = [brokenDirent];
      mockReaddir.mockResolvedValue(mockDirents as any);
      mockExistsSync.mockReturnValue(true);

      const testMockExec = vi
        .fn()
        .mockResolvedValueOnce({ stdout: 'compact 0.1.0', stderr: '' }) // checkCompactAvailable
        .mockResolvedValueOnce({ stdout: 'compact 0.1.0', stderr: '' }) // getDevToolsVersion
        .mockResolvedValueOnce({ stdout: 'Compactc 0.26.0', stderr: '' }) // getToolchainVersion
        .mockRejectedValueOnce(new Error('Compilation failed')); // compileFile execution

      compiler = new CompactCompiler('', undefined, undefined, testMockExec);

      // Test that compilation errors are properly propagated
      let thrownError: unknown;
      try {
        await compiler.compile();
        expect.fail('Expected compilation to throw an error');
      } catch (error) {
        thrownError = error;
      }

      expect(thrownError).toBeInstanceOf(Error);
      expect((thrownError as Error).message).toBe(
        `Failed to compile ${brokenDirent.name}: Compilation failed`,
      );
      expect(testMockExec).toHaveBeenCalledTimes(4);
    });
  });

  describe('Real-world scenarios', () => {
    beforeEach(() => {
      const mockDirents = [
        {
          name: 'AccessControl.compact',
          isFile: () => true,
          isDirectory: () => false,
        },
      ];
      mockReaddir.mockResolvedValue(mockDirents as any);
    });

    it('should handle turbo compact command', () => {
      compiler = CompactCompiler.fromArgs([]);

      expect(compiler.testFlags).toBe('');
      expect(compiler.testTargetDir).toBeUndefined();
    });

    it('should handle SKIP_ZK=true turbo compact command', () => {
      compiler = CompactCompiler.fromArgs([], { SKIP_ZK: 'true' });

      expect(compiler.testFlags).toBe('--skip-zk');
    });

    it('should handle turbo compact:access command', () => {
      compiler = CompactCompiler.fromArgs(['--dir', 'access']);

      expect(compiler.testFlags).toBe('');
      expect(compiler.testTargetDir).toBe('access');
    });

    it('should handle turbo compact:security -- --skip-zk command', () => {
      compiler = CompactCompiler.fromArgs(['--dir', 'security', '--skip-zk']);

      expect(compiler.testFlags).toBe('--skip-zk');
      expect(compiler.testTargetDir).toBe('security');
    });

    it('should handle version specification', () => {
      compiler = CompactCompiler.fromArgs(['+0.26.0']);

      expect(compiler.testVersion).toBe('0.26.0');
    });

    it.each([
      {
        name: 'with skip zk env var only',
        args: [
          '--dir',
          'security',
          '--no-communications-commitment',
          '+0.26.0',
        ],
        env: { SKIP_ZK: 'true' },
      },
      {
        name: 'with skip-zk flag only',
        args: [
          '--dir',
          'security',
          '--skip-zk',
          '--no-communications-commitment',
          '+0.26.0',
        ],
        env: { SKIP_ZK: 'false' },
      },
      {
        name: 'with both skip-zk flag and env var',
        args: [
          '--dir',
          'security',
          '--skip-zk',
          '--no-communications-commitment',
          '+0.26.0',
        ],
        env: { SKIP_ZK: 'true' },
      },
    ])('should handle complex command $name', ({ args, env }) => {
      compiler = CompactCompiler.fromArgs(args, env);

      expect(compiler.testFlags).toBe(
        '--skip-zk --no-communications-commitment',
      );
      expect(compiler.testTargetDir).toBe('security');
      expect(compiler.testVersion).toBe('0.26.0');
    });
  });
});
