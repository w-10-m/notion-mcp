import { Logger, LogLevel } from '../logger.js';

// Mock console.error to capture log output
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

// Helper to safely get log output
const getLogOutput = (callIndex = 0): string => {
  const call = mockConsoleError.mock.calls[callIndex];
  return call ? String(call[0]) : '';
};

describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    mockConsoleError.mockClear();
    logger = new Logger({
      logLevel: 'DEBUG',
      component: 'test',
      enableConsole: true,
      enableShipping: false,
      serverName: 'test-server'
    });
  });

  afterAll(() => {
    mockConsoleError.mockRestore();
  });

  describe('log level filtering', () => {
    it('should log messages at or above the configured level', () => {
      const infoLogger = new Logger({
        logLevel: 'INFO',
        component: 'test',
        enableConsole: true,
        enableShipping: false,
        serverName: 'test-server'
      });

      infoLogger.debug('TEST', 'debug message');
      expect(mockConsoleError).not.toHaveBeenCalled();

      infoLogger.info('TEST', 'info message');
      expect(mockConsoleError).toHaveBeenCalledTimes(1);
    });

    it('should respect log level hierarchy', () => {
      const levels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

      levels.forEach((configLevel, configIndex) => {
        mockConsoleError.mockClear();
        const testLogger = new Logger({
          logLevel: configLevel,
          component: 'test',
          enableConsole: true,
          enableShipping: false,
          serverName: 'test-server'
        });

        testLogger.debug('TEST', 'debug');
        testLogger.info('TEST', 'info');
        testLogger.warn('TEST', 'warn');
        testLogger.error('TEST', 'error');
        testLogger.fatal('TEST', 'fatal');

        const expectedCalls = levels.length - configIndex;
        expect(mockConsoleError).toHaveBeenCalledTimes(expectedCalls);
      });
    });
  });

  describe('log methods', () => {
    it('should log debug messages', () => {
      logger.debug('TEST_ACTION', 'test message');
      expect(mockConsoleError).toHaveBeenCalled();
      const logOutput = getLogOutput();
      expect(logOutput).toContain('TEST_ACTION');
      expect(logOutput).toContain('test message');
    });

    it('should log info messages', () => {
      logger.info('TEST_ACTION', 'info message');
      expect(mockConsoleError).toHaveBeenCalled();
    });

    it('should log warn messages', () => {
      logger.warn('TEST_ACTION', 'warn message');
      expect(mockConsoleError).toHaveBeenCalled();
    });

    it('should log error messages', () => {
      logger.error('TEST_ACTION', 'error message');
      expect(mockConsoleError).toHaveBeenCalled();
    });

    it('should log fatal messages', () => {
      logger.fatal('TEST_ACTION', 'fatal message');
      expect(mockConsoleError).toHaveBeenCalled();
    });

    it('should include metadata in log output', () => {
      logger.info('TEST', 'message', { key: 'value', count: 42 });
      const logOutput = getLogOutput();
      expect(logOutput).toContain('key');
      expect(logOutput).toContain('value');
    });
  });

  describe('specialized logging methods', () => {
    it('should log request start', () => {
      logger.logRequestStart('GET', '/api/test');
      expect(mockConsoleError).toHaveBeenCalled();
      const logOutput = getLogOutput();
      expect(logOutput).toContain('GET');
      expect(logOutput).toContain('/api/test');
    });

    it('should log request success', () => {
      logger.logRequestSuccess('POST', '/api/create', 200, 150);
      expect(mockConsoleError).toHaveBeenCalled();
      const logOutput = getLogOutput();
      expect(logOutput).toContain('200');
    });

    it('should log request error', () => {
      logger.logRequestError('PUT', '/api/update', new Error('Connection failed'), 500);
      expect(mockConsoleError).toHaveBeenCalled();
      const logOutput = getLogOutput();
      expect(logOutput).toContain('Connection failed');
    });

    it('should log tool start', () => {
      logger.logToolStart('test_tool', { param1: 'value1' });
      expect(mockConsoleError).toHaveBeenCalled();
      const logOutput = getLogOutput();
      expect(logOutput).toContain('test_tool');
    });

    it('should log tool success', () => {
      logger.logToolSuccess('test_tool', 100, { result: 'ok' });
      expect(mockConsoleError).toHaveBeenCalled();
    });

    it('should log tool error', () => {
      logger.logToolError('test_tool', new Error('Tool failed'), 50);
      expect(mockConsoleError).toHaveBeenCalled();
      const logOutput = getLogOutput();
      expect(logOutput).toContain('Tool failed');
    });

    it('should log auth events', () => {
      logger.logAuthEvent('login', true);
      expect(mockConsoleError).toHaveBeenCalled();
      const logOutput = getLogOutput();
      expect(logOutput).toContain('success');
    });

    it('should log rate limit events', () => {
      logger.logRateLimit('api_call', 1000);
      expect(mockConsoleError).toHaveBeenCalled();
      const logOutput = getLogOutput();
      expect(logOutput).toContain('1000');
    });
  });

  describe('console output', () => {
    it('should not log to console when disabled', () => {
      const silentLogger = new Logger({
        logLevel: 'DEBUG',
        component: 'test',
        enableConsole: false,
        enableShipping: false,
        serverName: 'test-server'
      });

      silentLogger.info('TEST', 'silent message');
      expect(mockConsoleError).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('should return logger configuration', () => {
      const status = logger.getStatus();
      expect(status.config.logLevel).toBe('DEBUG');
      expect(status.config.component).toBe('test');
      expect(status.config.enableConsole).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('should shutdown without errors', async () => {
      await expect(logger.shutdown()).resolves.toBeUndefined();
    });
  });
});
