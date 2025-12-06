import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Logger } from './logger.js';
import { RequestTracker } from './request-tracker.js';

export interface ProgressUpdate {
  progress: number;
  total?: number;
  message?: string;
}

interface ProgressState {
  lastProgress: number;
  lastUpdateTime: number;
  updateCount: number;
}

export class ProgressReporter {
  private server: Server;
  private logger: Logger;
  private requestTracker: RequestTracker;
  private progressStates: Map<string | number, ProgressState>;
  private minUpdateInterval: number = 100; // Minimum 100ms between updates

  constructor(server: Server, logger: Logger, requestTracker: RequestTracker) {
    this.server = server;
    this.logger = logger;
    this.requestTracker = requestTracker;
    this.progressStates = new Map();
  }

  /**
   * Report progress for a given token
   */
  async report(
    progressToken: string | number,
    update: ProgressUpdate
  ): Promise<void> {
    // Validate that the progress token is still active
    if (!this.requestTracker.isProgressTokenActive(progressToken)) {
      this.logger.debug('PROGRESS_TOKEN_INACTIVE', 'Progress token no longer active', {
        progressToken,
        progress: update.progress
      });
      return;
    }

    // Get or create progress state
    const state = this.progressStates.get(progressToken);
    const now = Date.now();

    // Validate progress value increases
    if (state && update.progress <= state.lastProgress) {
      this.logger.warn('PROGRESS_NOT_INCREASING', 'Progress value must increase', {
        progressToken,
        lastProgress: state.lastProgress,
        newProgress: update.progress
      });
      return;
    }

    // Check rate limiting
    if (state && (now - state.lastUpdateTime) < this.minUpdateInterval) {
      this.logger.debug('PROGRESS_RATE_LIMITED', 'Progress update rate limited', {
        progressToken,
        timeSinceLastUpdate: now - state.lastUpdateTime,
        minInterval: this.minUpdateInterval
      });
      return;
    }

    try {
      // Send progress notification
      await this.server.notification({
        method: "notifications/progress",
        params: {
          progressToken,
          progress: update.progress,
          ...(update.total !== undefined && { total: update.total }),
          ...(update.message && { message: update.message })
        }
      });

      // Update state
      this.progressStates.set(progressToken, {
        lastProgress: update.progress,
        lastUpdateTime: now,
        updateCount: (state?.updateCount ?? 0) + 1
      });

      // Get request context for better logging
      const context = this.requestTracker.getRequestByProgressToken(progressToken);

      this.logger.info('PROGRESS_REPORTED', 'Progress notification sent', {
        progressToken,
        progress: update.progress,
        total: update.total,
        hasMessage: !!update.message,
        updateCount: (state?.updateCount ?? 0) + 1,
        requestId: context?.requestId,
        toolName: context?.toolName
      });

      // Clean up if progress is complete
      if (update.total !== undefined && update.progress >= update.total) {
        this.cleanup(progressToken);
      }
    } catch (error) {
      this.logger.error('PROGRESS_REPORT_ERROR', 'Failed to send progress notification', {
        progressToken,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Report progress with percentage helper
   */
  async reportPercentage(
    progressToken: string | number,
    percentage: number,
    message?: string
  ): Promise<void> {
    if (percentage < 0 || percentage > 100) {
      this.logger.warn('PROGRESS_PERCENTAGE_INVALID', 'Invalid percentage value', {
        progressToken,
        percentage
      });
      return;
    }

    await this.report(progressToken, {
      progress: percentage,
      total: 100,
      message
    });
  }

  /**
   * Report progress for multi-step operations
   */
  async reportStep(
    progressToken: string | number,
    currentStep: number,
    totalSteps: number,
    message?: string
  ): Promise<void> {
    await this.report(progressToken, {
      progress: currentStep,
      total: totalSteps,
      message
    });
  }

  /**
   * Report progress for batch operations
   */
  async reportBatch(
    progressToken: string | number,
    processedItems: number,
    totalItems: number,
    itemType: string = 'items'
  ): Promise<void> {
    const percentage = Math.round((processedItems / totalItems) * 100);
    await this.report(progressToken, {
      progress: processedItems,
      total: totalItems,
      message: `Processed ${processedItems} of ${totalItems} ${itemType} (${percentage}%)`
    });
  }

  /**
   * Clean up progress state for a token
   */
  cleanup(progressToken: string | number): void {
    const state = this.progressStates.get(progressToken);
    if (state) {
      this.logger.debug('PROGRESS_CLEANUP', 'Cleaning up progress state', {
        progressToken,
        finalProgress: state.lastProgress,
        totalUpdates: state.updateCount
      });
      this.progressStates.delete(progressToken);
    }
  }

  /**
   * Clean up all progress states for completed requests
   */
  cleanupCompletedRequests(): void {
    let cleanedCount = 0;
    
    for (const [progressToken] of this.progressStates.entries()) {
      if (!this.requestTracker.isProgressTokenActive(progressToken)) {
        this.progressStates.delete(progressToken);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.info('PROGRESS_CLEANUP_COMPLETED', 'Cleaned up inactive progress states', {
        cleanedCount,
        remainingStates: this.progressStates.size
      });
    }
  }

  /**
   * Create a progress callback function for use in async operations
   */
  createProgressCallback(progressToken: string | number): (update: ProgressUpdate) => Promise<void> {
    return async (update: ProgressUpdate) => {
      await this.report(progressToken, update);
    };
  }

  /**
   * Create a simple percentage-based progress callback
   */
  createPercentageCallback(progressToken: string | number): (percentage: number, message?: string) => Promise<void> {
    return async (percentage: number, message?: string) => {
      await this.reportPercentage(progressToken, percentage, message);
    };
  }

  /**
   * Get statistics about progress reporting
   */
  getStats(): {
    activeProgressTokens: number;
    progressStates: Array<{
      token: string | number;
      lastProgress: number;
      updateCount: number;
    }>;
  } {
    const progressStates = Array.from(this.progressStates.entries()).map(([token, state]) => ({
      token,
      lastProgress: state.lastProgress,
      updateCount: state.updateCount
    }));

    return {
      activeProgressTokens: this.progressStates.size,
      progressStates
    };
  }

  /**
   * Shutdown and clean up
   */
  shutdown(): void {
    this.logger.info('PROGRESS_REPORTER_SHUTDOWN', 'Shutting down progress reporter', {
      activeStates: this.progressStates.size
    });
    this.progressStates.clear();
  }
}