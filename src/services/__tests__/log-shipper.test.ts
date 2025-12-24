import { LogShipper, LogShipperConfig, LogEntry } from '../log-shipper.js';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock console.error
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

describe('LogShipper', () => {
  let shipper: LogShipper;
  let config: LogShipperConfig;

  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockReset();
    mockConsoleError.mockClear();

    config = {
      endpoint: 'https://logs.example.com/api/logs',
      apiKey: 'test-api-key',
      batchSize: 10,
      flushInterval: 5000,
      maxRetries: 3,
      enabled: true
    };
  });

  afterEach(async () => {
    if (shipper) {
      await shipper.shutdown();
    }
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize when enabled', () => {
      shipper = new LogShipper(config);

      expect(shipper.getHealthStatus().config.enabled).toBe(true);
    });

    it('should not initialize when disabled', () => {
      config.enabled = false;
      shipper = new LogShipper(config);

      expect(shipper.getHealthStatus().queueSize).toBe(0);
    });

    it('should throw error when endpoint is missing', () => {
      config.endpoint = '';

      expect(() => new LogShipper(config)).toThrow('LogShipper: endpoint is required');
    });

    it('should throw error when endpoint is not HTTPS', () => {
      config.endpoint = 'http://logs.example.com/api/logs';

      expect(() => new LogShipper(config)).toThrow('LogShipper: endpoint must use HTTPS');
    });

    it('should throw error when API key required but missing', () => {
      config.apiKey = undefined;
      config.requireApiKey = true;

      expect(() => new LogShipper(config)).toThrow('LogShipper: apiKey is required when requireApiKey is true');
    });

    it('should warn when API key is missing but not required', () => {
      config.apiKey = undefined;
      config.requireApiKey = false;
      shipper = new LogShipper(config);

      expect(mockConsoleError).toHaveBeenCalled();
    });
  });

  describe('addLog', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });
      shipper = new LogShipper(config);
    });

    it('should add log to queue', () => {
      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        sessionId: 'test-session',
        user: 'test-user',
        integration: 'test',
        component: 'client',
        action: 'test_action',
        message: 'Test message',
        serverName: 'test-server'
      };

      shipper.addLog(logEntry);

      expect(shipper.getHealthStatus().queueSize).toBe(1);
    });

    it('should not add log when disabled', () => {
      config.enabled = false;
      shipper = new LogShipper(config);

      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        sessionId: 'test-session',
        user: 'test-user',
        integration: 'test',
        component: 'client',
        action: 'test_action',
        message: 'Test message',
        serverName: 'test-server'
      };

      shipper.addLog(logEntry);

      expect(shipper.getHealthStatus().queueSize).toBe(0);
    });

    it('should trigger flush when batch size reached', async () => {
      config.batchSize = 2;
      shipper = new LogShipper(config);

      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        sessionId: 'test-session',
        user: 'test-user',
        integration: 'test',
        component: 'client',
        action: 'test_action',
        message: 'Test message',
        serverName: 'test-server'
      };

      shipper.addLog(logEntry);
      shipper.addLog(logEntry);

      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });
      shipper = new LogShipper(config);
    });

    it('should do nothing when queue is empty', async () => {
      await shipper.flush();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should do nothing when disabled', async () => {
      config.enabled = false;
      shipper = new LogShipper(config);

      await shipper.flush();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should send logs to endpoint', async () => {
      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        sessionId: 'test-session',
        user: 'test-user',
        integration: 'test',
        component: 'client',
        action: 'test_action',
        message: 'Test message',
        serverName: 'test-server'
      };

      shipper.addLog(logEntry);
      await shipper.flush();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://logs.example.com/api/logs',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key'
          })
        })
      );
    });

    it('should not include API key header when not provided', async () => {
      config.apiKey = undefined;
      config.requireApiKey = false;
      shipper = new LogShipper(config);

      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        sessionId: 'test-session',
        user: 'test-user',
        integration: 'test',
        component: 'client',
        action: 'test_action',
        message: 'Test message',
        serverName: 'test-server'
      };

      shipper.addLog(logEntry);
      await shipper.flush();

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers['X-API-Key']).toBeUndefined();
    });

  });

  describe('retry logic', () => {
    beforeEach(() => {
      shipper = new LogShipper(config);
    });

    it('should not retry on 4xx errors (except 429)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Invalid payload')
      });

      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        sessionId: 'test-session',
        user: 'test-user',
        integration: 'test',
        component: 'client',
        action: 'test_action',
        message: 'Test message',
        serverName: 'test-server'
      };

      shipper.addLog(logEntry);

      await expect(shipper.flush()).rejects.toThrow();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should provide helpful message for auth errors', async () => {
      config.apiKey = undefined;
      config.requireApiKey = false;
      shipper = new LogShipper(config);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Authentication required')
      });

      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        sessionId: 'test-session',
        user: 'test-user',
        integration: 'test',
        component: 'client',
        action: 'test_action',
        message: 'Test message',
        serverName: 'test-server'
      };

      shipper.addLog(logEntry);

      await expect(shipper.flush()).rejects.toThrow(/Authentication required/);
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy status', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });
      shipper = new LogShipper(config);

      const status = shipper.getHealthStatus();

      expect(status.healthy).toBe(true);
      expect(status.queueSize).toBe(0);
      expect(status.config.enabled).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('should flush remaining logs on shutdown', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });
      shipper = new LogShipper(config);

      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        sessionId: 'test-session',
        user: 'test-user',
        integration: 'test',
        component: 'client',
        action: 'test_action',
        message: 'Test message',
        serverName: 'test-server'
      };

      shipper.addLog(logEntry);
      await shipper.shutdown();

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle shutdown with empty queue', async () => {
      shipper = new LogShipper(config);

      await expect(shipper.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('log level mapping', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });
      shipper = new LogShipper(config);
    });

    it('should map fatal to error', async () => {
      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'fatal',
        sessionId: 'test-session',
        user: 'test-user',
        integration: 'test',
        component: 'client',
        action: 'test_action',
        message: 'Fatal error',
        serverName: 'test-server'
      };

      shipper.addLog(logEntry);
      await shipper.flush();

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.logs[0].level).toBe('error');
    });
  });

  describe('component mapping', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });
      shipper = new LogShipper(config);
    });

    it('should map server to client', async () => {
      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        sessionId: 'test-session',
        user: 'test-user',
        integration: 'test',
        component: 'server',
        action: 'test_action',
        message: 'Test message',
        serverName: 'test-server'
      };

      shipper.addLog(logEntry);
      await shipper.flush();

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.logs[0].component).toBe('client');
    });
  });
});
