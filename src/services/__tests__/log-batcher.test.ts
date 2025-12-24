import { LogBatcher } from '../log-batcher.js';
import { LogShipper, LogEntry } from '../log-shipper.js';

// Mock the LogShipper
jest.mock('../log-shipper.js');

describe('LogBatcher', () => {
  let batcher: LogBatcher;
  let mockLogShipper: jest.Mocked<LogShipper>;

  beforeEach(() => {
    jest.useFakeTimers();

    mockLogShipper = {
      addLog: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getHealthStatus: jest.fn()
    } as any;

    batcher = new LogBatcher(mockLogShipper, 5, 1000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const defaultBatcher = new LogBatcher(mockLogShipper);
      const status = defaultBatcher.getBatchStatus();

      expect(status.maxBatchSize).toBe(500);
      expect(status.flushInterval).toBe(5000);
      expect(status.queueSize).toBe(0);
    });

    it('should initialize with custom values', () => {
      const status = batcher.getBatchStatus();

      expect(status.maxBatchSize).toBe(5);
      expect(status.flushInterval).toBe(1000);
    });

    it('should generate a session ID', () => {
      const sessionId = batcher.getSessionId();

      expect(sessionId).toMatch(/^notion-mcp-\d+-[a-z0-9]+$/);
    });
  });

  describe('addStructuredLog', () => {
    it('should add log to the queue', () => {
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

      batcher.addStructuredLog(logEntry);

      expect(batcher.getBatchStatus().queueSize).toBe(1);
    });

    it('should flush when batch size is reached', async () => {
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

      // Add logs up to batch size
      for (let i = 0; i < 5; i++) {
        batcher.addStructuredLog({ ...logEntry, message: `Message ${i}` });
      }

      // Allow promises to resolve
      await Promise.resolve();

      expect(mockLogShipper.addLog).toHaveBeenCalledTimes(5);
      expect(mockLogShipper.flush).toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('should do nothing when queue is empty', async () => {
      await batcher.flush();

      expect(mockLogShipper.addLog).not.toHaveBeenCalled();
      expect(mockLogShipper.flush).not.toHaveBeenCalled();
    });

    it('should send logs through LogShipper', async () => {
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

      batcher.addStructuredLog(logEntry);
      await batcher.flush();

      expect(mockLogShipper.addLog).toHaveBeenCalledWith(logEntry);
      expect(mockLogShipper.flush).toHaveBeenCalled();
    });

    it('should handle flush errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      mockLogShipper.flush.mockRejectedValueOnce(new Error('Network error'));

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

      batcher.addStructuredLog(logEntry);
      await batcher.flush();

      expect(consoleSpy).toHaveBeenCalledWith('Failed to send logs:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('getBatchStatus', () => {
    it('should return current batch status', () => {
      const status = batcher.getBatchStatus();

      expect(status).toEqual({
        queueSize: 0,
        maxBatchSize: 5,
        flushInterval: 1000,
        sessionId: expect.stringMatching(/^notion-mcp-\d+-[a-z0-9]+$/)
      });
    });

    it('should reflect queue size changes', () => {
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

      batcher.addStructuredLog(logEntry);
      batcher.addStructuredLog(logEntry);

      expect(batcher.getBatchStatus().queueSize).toBe(2);
    });
  });

  describe('shutdown', () => {
    it('should clear flush timer and flush remaining logs', async () => {
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

      batcher.addStructuredLog(logEntry);
      await batcher.shutdown();

      expect(mockLogShipper.addLog).toHaveBeenCalled();
      expect(mockLogShipper.flush).toHaveBeenCalled();
    });

    it('should handle shutdown with empty queue', async () => {
      await batcher.shutdown();

      expect(mockLogShipper.addLog).not.toHaveBeenCalled();
    });
  });

  describe('automatic flush interval', () => {
    it('should flush on interval', async () => {
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

      batcher.addStructuredLog(logEntry);

      // Fast-forward time
      jest.advanceTimersByTime(1000);

      // Allow promises to resolve
      await Promise.resolve();

      expect(mockLogShipper.flush).toHaveBeenCalled();
    });
  });
});
