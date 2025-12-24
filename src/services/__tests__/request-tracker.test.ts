import { RequestTracker } from '../request-tracker.js';
import { Logger } from '../logger.js';

// Mock the Logger
jest.mock('../logger.js');

describe('RequestTracker', () => {
  let tracker: RequestTracker;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn()
    } as any;

    tracker = new RequestTracker(mockLogger);
  });

  describe('registerRequest', () => {
    it('should register a new request', () => {
      const context = tracker.registerRequest('req-1');

      expect(context.requestId).toBe('req-1');
      expect(context.abortController).toBeInstanceOf(AbortController);
      expect(context.startTime).toBeLessThanOrEqual(Date.now());
      expect(mockLogger.info).toHaveBeenCalledWith(
        'REQUEST_REGISTERED',
        'New request registered for tracking',
        expect.objectContaining({ requestId: 'req-1' })
      );
    });

    it('should register request with progress token', () => {
      const context = tracker.registerRequest('req-1', 'progress-1');

      expect(context.progressToken).toBe('progress-1');
      expect(tracker.getRequestByProgressToken('progress-1')).toBe(context);
    });

    it('should register request with tool name', () => {
      const context = tracker.registerRequest('req-1', undefined, 'test_tool');

      expect(context.toolName).toBe('test_tool');
    });

    it('should return existing context for duplicate request ID', () => {
      const context1 = tracker.registerRequest('req-1');
      const context2 = tracker.registerRequest('req-1');

      expect(context1).toBe(context2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'REQUEST_DUPLICATE',
        'Request ID already registered',
        expect.any(Object)
      );
    });
  });

  describe('getRequest', () => {
    it('should return registered request', () => {
      const context = tracker.registerRequest('req-1');
      expect(tracker.getRequest('req-1')).toBe(context);
    });

    it('should return undefined for non-existent request', () => {
      expect(tracker.getRequest('non-existent')).toBeUndefined();
    });
  });

  describe('getRequestByProgressToken', () => {
    it('should return request by progress token', () => {
      const context = tracker.registerRequest('req-1', 'progress-1');
      expect(tracker.getRequestByProgressToken('progress-1')).toBe(context);
    });

    it('should return undefined for non-existent progress token', () => {
      expect(tracker.getRequestByProgressToken('non-existent')).toBeUndefined();
    });
  });

  describe('cancelRequest', () => {
    it('should cancel an active request', () => {
      const context = tracker.registerRequest('req-1');
      const result = tracker.cancelRequest('req-1', 'User cancelled');

      expect(result).toBe(true);
      expect(context.abortController.signal.aborted).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'REQUEST_CANCELLED',
        'Request cancelled successfully',
        expect.objectContaining({ requestId: 'req-1', reason: 'User cancelled' })
      );
    });

    it('should return false for non-existent request', () => {
      const result = tracker.cancelRequest('non-existent');

      expect(result).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'CANCEL_REQUEST_NOT_FOUND',
        'Request not found for cancellation',
        expect.any(Object)
      );
    });

    it('should clean up request after cancellation', () => {
      tracker.registerRequest('req-1', 'progress-1');
      tracker.cancelRequest('req-1');

      expect(tracker.getRequest('req-1')).toBeUndefined();
      expect(tracker.getRequestByProgressToken('progress-1')).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('should remove request from tracking', () => {
      tracker.registerRequest('req-1', 'progress-1');
      tracker.cleanup('req-1');

      expect(tracker.getRequest('req-1')).toBeUndefined();
      expect(tracker.getRequestByProgressToken('progress-1')).toBeUndefined();
    });

    it('should handle cleanup of non-existent request gracefully', () => {
      expect(() => tracker.cleanup('non-existent')).not.toThrow();
    });
  });

  describe('isActive', () => {
    it('should return true for active request', () => {
      tracker.registerRequest('req-1');
      expect(tracker.isActive('req-1')).toBe(true);
    });

    it('should return false for non-existent request', () => {
      expect(tracker.isActive('non-existent')).toBe(false);
    });

    it('should return false for cancelled request', () => {
      const context = tracker.registerRequest('req-1');
      context.abortController.abort();
      expect(tracker.isActive('req-1')).toBe(false);
    });
  });

  describe('isProgressTokenActive', () => {
    it('should return true for active progress token', () => {
      tracker.registerRequest('req-1', 'progress-1');
      expect(tracker.isProgressTokenActive('progress-1')).toBe(true);
    });

    it('should return false for non-existent progress token', () => {
      expect(tracker.isProgressTokenActive('non-existent')).toBe(false);
    });

    it('should return false for cancelled request progress token', () => {
      const context = tracker.registerRequest('req-1', 'progress-1');
      context.abortController.abort();
      expect(tracker.isProgressTokenActive('progress-1')).toBe(false);
    });
  });

  describe('getActiveRequestIds', () => {
    it('should return all active request IDs', () => {
      tracker.registerRequest('req-1');
      tracker.registerRequest('req-2');
      tracker.registerRequest('req-3');

      const ids = tracker.getActiveRequestIds();
      expect(ids).toContain('req-1');
      expect(ids).toContain('req-2');
      expect(ids).toContain('req-3');
      expect(ids).toHaveLength(3);
    });

    it('should return empty array when no requests', () => {
      expect(tracker.getActiveRequestIds()).toHaveLength(0);
    });
  });

  describe('cleanupStaleRequests', () => {
    it('should clean up requests older than maxAge', () => {
      const context = tracker.registerRequest('req-1');
      (context as any).startTime = Date.now() - 400000;

      const cleanedCount = tracker.cleanupStaleRequests(300000);

      expect(cleanedCount).toBe(1);
      expect(tracker.getRequest('req-1')).toBeUndefined();
    });

    it('should not clean up recent requests', () => {
      tracker.registerRequest('req-1');

      const cleanedCount = tracker.cleanupStaleRequests(300000);

      expect(cleanedCount).toBe(0);
      expect(tracker.getRequest('req-1')).toBeDefined();
    });
  });

  describe('shutdown', () => {
    it('should cancel all active requests', () => {
      const context1 = tracker.registerRequest('req-1');
      const context2 = tracker.registerRequest('req-2');

      tracker.shutdown();

      expect(context1.abortController.signal.aborted).toBe(true);
      expect(context2.abortController.signal.aborted).toBe(true);
    });

    it('should clear all tracking maps', () => {
      tracker.registerRequest('req-1', 'progress-1');
      tracker.shutdown();

      expect(tracker.getActiveRequestIds()).toHaveLength(0);
    });
  });
});
