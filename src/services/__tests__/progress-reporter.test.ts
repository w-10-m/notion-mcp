import { ProgressReporter, ProgressUpdate } from '../progress-reporter.js';
import { Logger } from '../logger.js';
import { RequestTracker } from '../request-tracker.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Mock dependencies
jest.mock('../logger.js');
jest.mock('../request-tracker.js');

describe('ProgressReporter', () => {
  let reporter: ProgressReporter;
  let mockServer: jest.Mocked<Server>;
  let mockLogger: jest.Mocked<Logger>;
  let mockRequestTracker: jest.Mocked<RequestTracker>;

  beforeEach(() => {
    mockServer = {
      notification: jest.fn().mockResolvedValue(undefined)
    } as any;

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn()
    } as any;

    mockRequestTracker = {
      isProgressTokenActive: jest.fn().mockReturnValue(true),
      getRequestByProgressToken: jest.fn().mockReturnValue({
        requestId: 'req-1',
        toolName: 'test_tool'
      })
    } as any;

    reporter = new ProgressReporter(mockServer, mockLogger, mockRequestTracker);
  });

  describe('report', () => {
    it('should send progress notification', async () => {
      await reporter.report('token-1', { progress: 50, total: 100 });

      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: {
          progressToken: 'token-1',
          progress: 50,
          total: 100
        }
      });
    });

    it('should include message when provided', async () => {
      await reporter.report('token-1', { progress: 50, total: 100, message: 'Processing...' });

      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: {
          progressToken: 'token-1',
          progress: 50,
          total: 100,
          message: 'Processing...'
        }
      });
    });

    it('should not report if progress token is inactive', async () => {
      mockRequestTracker.isProgressTokenActive.mockReturnValue(false);

      await reporter.report('token-1', { progress: 50 });

      expect(mockServer.notification).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'PROGRESS_TOKEN_INACTIVE',
        'Progress token no longer active',
        expect.any(Object)
      );
    });

    it('should not report if progress does not increase', async () => {
      await reporter.report('token-1', { progress: 50 });
      await reporter.report('token-1', { progress: 40 });

      expect(mockServer.notification).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'PROGRESS_NOT_INCREASING',
        'Progress value must increase',
        expect.any(Object)
      );
    });

    it('should handle notification errors', async () => {
      mockServer.notification.mockRejectedValueOnce(new Error('Network error'));

      await reporter.report('token-1', { progress: 50 });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'PROGRESS_REPORT_ERROR',
        'Failed to send progress notification',
        expect.objectContaining({ progressToken: 'token-1' })
      );
    });

    it('should clean up on completion', async () => {
      await reporter.report('token-1', { progress: 100, total: 100 });

      const stats = reporter.getStats();
      expect(stats.activeProgressTokens).toBe(0);
    });

    it('should log progress reported', async () => {
      await reporter.report('token-1', { progress: 50, total: 100 });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'PROGRESS_REPORTED',
        'Progress notification sent',
        expect.objectContaining({
          progressToken: 'token-1',
          progress: 50,
          total: 100
        })
      );
    });
  });

  describe('reportPercentage', () => {
    it('should report percentage with total of 100', async () => {
      await reporter.reportPercentage('token-1', 75, 'Almost done');

      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: {
          progressToken: 'token-1',
          progress: 75,
          total: 100,
          message: 'Almost done'
        }
      });
    });

    it('should reject invalid percentage below 0', async () => {
      await reporter.reportPercentage('token-1', -10);

      expect(mockServer.notification).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'PROGRESS_PERCENTAGE_INVALID',
        'Invalid percentage value',
        expect.any(Object)
      );
    });

    it('should reject invalid percentage above 100', async () => {
      await reporter.reportPercentage('token-1', 150);

      expect(mockServer.notification).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'PROGRESS_PERCENTAGE_INVALID',
        'Invalid percentage value',
        expect.any(Object)
      );
    });
  });

  describe('reportStep', () => {
    it('should report step progress', async () => {
      await reporter.reportStep('token-1', 3, 10, 'Step 3 of 10');

      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: {
          progressToken: 'token-1',
          progress: 3,
          total: 10,
          message: 'Step 3 of 10'
        }
      });
    });
  });

  describe('reportBatch', () => {
    it('should report batch progress with item count', async () => {
      await reporter.reportBatch('token-1', 50, 100, 'records');

      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: {
          progressToken: 'token-1',
          progress: 50,
          total: 100,
          message: 'Processed 50 of 100 records (50%)'
        }
      });
    });

    it('should use default item type', async () => {
      await reporter.reportBatch('token-1', 25, 50);

      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: {
          progressToken: 'token-1',
          progress: 25,
          total: 50,
          message: 'Processed 25 of 50 items (50%)'
        }
      });
    });
  });

  describe('cleanup', () => {
    it('should clean up progress state for token', async () => {
      await reporter.report('token-1', { progress: 50 });
      reporter.cleanup('token-1');

      const stats = reporter.getStats();
      expect(stats.activeProgressTokens).toBe(0);
    });

    it('should log cleanup', async () => {
      await reporter.report('token-1', { progress: 50 });
      reporter.cleanup('token-1');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'PROGRESS_CLEANUP',
        'Cleaning up progress state',
        expect.any(Object)
      );
    });

    it('should handle cleanup of non-existent token', () => {
      expect(() => reporter.cleanup('non-existent')).not.toThrow();
    });
  });

  describe('cleanupCompletedRequests', () => {
    it('should clean up inactive progress tokens', async () => {
      await reporter.report('token-1', { progress: 50 });
      await reporter.report('token-2', { progress: 30 });

      mockRequestTracker.isProgressTokenActive.mockReturnValue(false);
      reporter.cleanupCompletedRequests();

      const stats = reporter.getStats();
      expect(stats.activeProgressTokens).toBe(0);
    });

    it('should log cleanup count', async () => {
      await reporter.report('token-1', { progress: 50 });

      mockRequestTracker.isProgressTokenActive.mockReturnValue(false);
      reporter.cleanupCompletedRequests();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'PROGRESS_CLEANUP_COMPLETED',
        'Cleaned up inactive progress states',
        expect.objectContaining({ cleanedCount: 1 })
      );
    });
  });

  describe('createProgressCallback', () => {
    it('should return a callback that reports progress', async () => {
      const callback = reporter.createProgressCallback('token-1');

      await callback({ progress: 50, total: 100 });

      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: expect.objectContaining({ progressToken: 'token-1', progress: 50 })
      });
    });
  });

  describe('createPercentageCallback', () => {
    it('should return a callback that reports percentage', async () => {
      const callback = reporter.createPercentageCallback('token-1');

      await callback(75, 'Almost done');

      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: expect.objectContaining({ progressToken: 'token-1', progress: 75, total: 100 })
      });
    });
  });

  describe('getStats', () => {
    it('should return progress statistics', async () => {
      await reporter.report('token-1', { progress: 50 });
      await reporter.report('token-2', { progress: 30 });

      const stats = reporter.getStats();

      expect(stats.activeProgressTokens).toBe(2);
      expect(stats.progressStates).toHaveLength(2);
    });

    it('should return empty stats when no progress', () => {
      const stats = reporter.getStats();

      expect(stats.activeProgressTokens).toBe(0);
      expect(stats.progressStates).toHaveLength(0);
    });
  });

  describe('shutdown', () => {
    it('should clear all progress states', async () => {
      await reporter.report('token-1', { progress: 50 });
      await reporter.report('token-2', { progress: 30 });

      reporter.shutdown();

      const stats = reporter.getStats();
      expect(stats.activeProgressTokens).toBe(0);
    });

    it('should log shutdown', () => {
      reporter.shutdown();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'PROGRESS_REPORTER_SHUTDOWN',
        'Shutting down progress reporter',
        expect.any(Object)
      );
    });
  });

  describe('rate limiting', () => {
    it('should rate limit rapid updates', async () => {
      // First update should succeed
      await reporter.report('token-1', { progress: 10 });
      expect(mockServer.notification).toHaveBeenCalledTimes(1);

      // Rapid second update should be rate limited
      await reporter.report('token-1', { progress: 20 });
      expect(mockServer.notification).toHaveBeenCalledTimes(1);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'PROGRESS_RATE_LIMITED',
        'Progress update rate limited',
        expect.any(Object)
      );
    });
  });
});
