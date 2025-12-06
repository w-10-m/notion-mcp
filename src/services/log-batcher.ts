/**
 * LogBatcher - Implements the exact batching logic as specified in requirements
 * Batches logs and sends them to the centralized logging endpoint
 */

import { LogShipper, LogEntry } from './log-shipper.js';

export class LogBatcher {
  private logs: LogEntry[] = [];
  private maxBatchSize: number;
  private flushInterval: number;
  private sessionId: string;
  private logShipper: LogShipper;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(logShipper: LogShipper, maxBatchSize: number = 500, flushInterval: number = 5000) {
    this.logShipper = logShipper;
    this.maxBatchSize = maxBatchSize;
    this.flushInterval = flushInterval;
    this.sessionId = this.generateSessionId();

    // Start the flush timer
    this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
  }

  /**
   * Add a structured log entry to the batch
   */
  addStructuredLog(logEntry: LogEntry): void {
    this.logs.push(logEntry);

    // Flush immediately if batch size reached
    if (this.logs.length >= this.maxBatchSize) {
      this.flush();
    }
  }

  /**
   * Flush all batched logs
   */
  async flush(): Promise<void> {
    if (this.logs.length === 0) return;

    const batch = this.logs.splice(0, this.maxBatchSize);
    try {
      // Send each structured log through the LogShipper
      for (const logEntry of batch) {
        this.logShipper.addLog(logEntry);
      }
      
      // Trigger immediate flush in LogShipper
      await this.logShipper.flush();
    } catch (error) {
      console.error('Failed to send logs:', error);
      // Could implement retry logic here
    }
  }

  /**
   * Get the session ID for this batcher instance
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `notion-mcp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get current batch status
   */
  getBatchStatus(): { queueSize: number; maxBatchSize: number; flushInterval: number; sessionId: string } {
    return {
      queueSize: this.logs.length,
      maxBatchSize: this.maxBatchSize,
      flushInterval: this.flushInterval,
      sessionId: this.sessionId
    };
  }

  /**
   * Shutdown the batcher and flush remaining logs
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    
    // Flush any remaining logs
    await this.flush();
  }
}