import { Logger } from './logger.js';

export interface RequestContext {
  requestId: string | number;
  abortController: AbortController;
  progressToken?: string | number;
  startTime: number;
  toolName?: string;
}

export class RequestTracker {
  private activeRequests: Map<string | number, RequestContext>;
  private progressTokens: Map<string | number, string | number>; // progressToken -> requestId mapping
  private logger: Logger;

  constructor(logger: Logger) {
    this.activeRequests = new Map();
    this.progressTokens = new Map();
    this.logger = logger;
  }

  /**
   * Register a new request for tracking
   */
  registerRequest(
    requestId: string | number,
    progressToken?: string | number,
    toolName?: string
  ): RequestContext {
    // Check if request already exists
    if (this.activeRequests.has(requestId)) {
      this.logger.warn('REQUEST_DUPLICATE', 'Request ID already registered', {
        requestId,
        existing: true
      });
      return this.activeRequests.get(requestId)!;
    }

    const context: RequestContext = {
      requestId,
      abortController: new AbortController(),
      progressToken,
      startTime: Date.now(),
      toolName
    };

    this.activeRequests.set(requestId, context);

    // Map progress token to request ID if provided
    if (progressToken !== undefined) {
      this.progressTokens.set(progressToken, requestId);
    }

    this.logger.info('REQUEST_REGISTERED', 'New request registered for tracking', {
      requestId,
      hasProgressToken: !!progressToken,
      toolName,
      activeRequestCount: this.activeRequests.size
    });

    return context;
  }

  /**
   * Get request context by ID
   */
  getRequest(requestId: string | number): RequestContext | undefined {
    return this.activeRequests.get(requestId);
  }

  /**
   * Get request context by progress token
   */
  getRequestByProgressToken(progressToken: string | number): RequestContext | undefined {
    const requestId = this.progressTokens.get(progressToken);
    if (!requestId) {
      return undefined;
    }
    return this.activeRequests.get(requestId);
  }

  /**
   * Cancel a request
   */
  cancelRequest(requestId: string | number, reason?: string): boolean {
    const context = this.activeRequests.get(requestId);
    
    if (!context) {
      this.logger.debug('CANCEL_REQUEST_NOT_FOUND', 'Request not found for cancellation', {
        requestId,
        reason,
        activeRequestCount: this.activeRequests.size
      });
      return false;
    }

    // Check if already aborted
    if (context.abortController.signal.aborted) {
      this.logger.debug('CANCEL_REQUEST_ALREADY_ABORTED', 'Request already cancelled', {
        requestId,
        reason
      });
      return false;
    }

    // Abort the request
    context.abortController.abort(reason);

    const duration = Date.now() - context.startTime;
    this.logger.info('REQUEST_CANCELLED', 'Request cancelled successfully', {
      requestId,
      reason,
      duration_ms: duration,
      toolName: context.toolName,
      hadProgressToken: !!context.progressToken
    });

    // Clean up immediately after cancellation
    this.cleanup(requestId);

    return true;
  }

  /**
   * Clean up a completed or cancelled request
   */
  cleanup(requestId: string | number): void {
    const context = this.activeRequests.get(requestId);
    
    if (!context) {
      return;
    }

    // Remove progress token mapping if exists
    if (context.progressToken !== undefined) {
      this.progressTokens.delete(context.progressToken);
    }

    // Remove from active requests
    this.activeRequests.delete(requestId);

    const duration = Date.now() - context.startTime;
    this.logger.debug('REQUEST_CLEANUP', 'Request cleaned up', {
      requestId,
      duration_ms: duration,
      toolName: context.toolName,
      remainingRequests: this.activeRequests.size
    });
  }

  /**
   * Check if a request is still active
   */
  isActive(requestId: string | number): boolean {
    const context = this.activeRequests.get(requestId);
    return !!context && !context.abortController.signal.aborted;
  }

  /**
   * Check if a progress token is valid and active
   */
  isProgressTokenActive(progressToken: string | number): boolean {
    const requestId = this.progressTokens.get(progressToken);
    if (!requestId) {
      return false;
    }
    return this.isActive(requestId);
  }

  /**
   * Get all active request IDs
   */
  getActiveRequestIds(): (string | number)[] {
    return Array.from(this.activeRequests.keys());
  }

  /**
   * Clean up old requests (called periodically)
   */
  cleanupStaleRequests(maxAgeMs: number = 300000): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [requestId, context] of this.activeRequests.entries()) {
      const age = now - context.startTime;
      if (age > maxAgeMs) {
        this.logger.warn('REQUEST_STALE', 'Cleaning up stale request', {
          requestId,
          age_ms: age,
          maxAge_ms: maxAgeMs,
          toolName: context.toolName
        });
        
        // Cancel if still active
        if (!context.abortController.signal.aborted) {
          context.abortController.abort('Request timed out');
        }
        
        this.cleanup(requestId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.info('STALE_CLEANUP_COMPLETE', 'Cleaned up stale requests', {
        cleanedCount,
        remainingRequests: this.activeRequests.size
      });
    }

    return cleanedCount;
  }

  /**
   * Shutdown and clean up all requests
   */
  shutdown(): void {
    this.logger.info('REQUEST_TRACKER_SHUTDOWN', 'Shutting down request tracker', {
      activeRequests: this.activeRequests.size
    });

    // Cancel all active requests
    for (const [requestId, context] of this.activeRequests.entries()) {
      if (!context.abortController.signal.aborted) {
        context.abortController.abort('Server shutting down');
      }
    }

    // Clear all maps
    this.activeRequests.clear();
    this.progressTokens.clear();
  }
}