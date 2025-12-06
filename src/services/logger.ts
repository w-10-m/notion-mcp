/**
 * Logger - Centralized logging service for notion-mcp
 * Provides structured logging with centralized log shipping capability
 */

import { LogBatcher } from './log-batcher.js';
import { LogShipper, LogEntry } from './log-shipper.js';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LoggerConfig {
  logLevel: LogLevel;
  component: string;
  enableConsole: boolean;
  enableShipping: boolean;
  serverName: string;
  logShipper?: LogShipper;
}

export class Logger {
  private config: LoggerConfig;
  private batcher: LogBatcher | null = null;
  private logLevelPriority: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    FATAL: 4
  };

  constructor(config: LoggerConfig) {
    this.config = config;
    
    if (this.config.enableShipping && config.logShipper) {
      this.batcher = new LogBatcher(config.logShipper);
    }
  }

  /**
   * Log a debug message
   */
  debug(action: string, message: string, metadata?: any): void {
    this.log('DEBUG', action, message, metadata);
  }

  /**
   * Log an info message
   */
  info(action: string, message: string, metadata?: any): void {
    this.log('INFO', action, message, metadata);
  }

  /**
   * Log a warning message
   */
  warn(action: string, message: string, metadata?: any): void {
    this.log('WARN', action, message, metadata);
  }

  /**
   * Log an error message
   */
  error(action: string, message: string, metadata?: any): void {
    this.log('ERROR', action, message, metadata);
  }

  /**
   * Log a fatal error message
   */
  fatal(action: string, message: string, metadata?: any): void {
    this.log('FATAL', action, message, metadata);
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, action: string, message: string, metadata?: any): void {
    // Check if this log level should be processed
    if (this.logLevelPriority[level] < this.logLevelPriority[this.config.logLevel]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const user = process.env.CORETEXT_USER || 'unknown';
    const sessionId = this.batcher?.getSessionId() || `notion-mcp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    const logEntry = {
      timestamp,
      sessionId,
      user,
      integration: '',
      component: this.config.component,
      level,
      action,
      message,
      projectId: process.env.PROJECT_ID || '',
      organizationId: process.env.ORGANIZATION_ID || '',
      ...(metadata && { metadata })
    };

    // Always log to console (stderr) for MCP protocol compliance
    if (this.config.enableConsole) {
      const componentPrefix = `-${this.config.component.toUpperCase()}`;
      console.error(`[${componentPrefix}] ${JSON.stringify(logEntry)}`);
    }

    // Send to centralized logging if enabled
    if (this.config.enableShipping && this.batcher) {
      // Create full log entry matching API specification
      const fullLogEntry = {
        timestamp,
        sessionId,
        user,
        integration: '',
        component: this.config.component,
        action,
        message,
        projectId: process.env.PROJECT_ID || '',
        organizationId: process.env.ORGANIZATION_ID || '',
        ...(metadata && { metadata })
      };
      
      this.batcher.addStructuredLog(fullLogEntry);
    }
  }

  /**
   * Log HTTP request start
   */
  logRequestStart(method: string, url: string, metadata?: any): void {
    this.debug('HTTP_REQUEST_START', `${method} ${url}`, {
      method,
      url,
      ...metadata
    });
  }

  /**
   * Log HTTP request success
   */
  logRequestSuccess(method: string, url: string, status: number, duration: number, metadata?: any): void {
    this.info('HTTP_REQUEST_SUCCESS', `${method} ${url} - ${status} (${duration}ms)`, {
      method,
      url,
      status,
      duration_ms: duration,
      ...metadata
    });
  }

  /**
   * Log HTTP request error
   */
  logRequestError(method: string, url: string, error: any, duration: number, metadata?: any): void {
    this.error('HTTP_REQUEST_ERROR', `${method} ${url} - ${error.message || error}`, {
      method,
      url,
      error: error.message || String(error),
      duration_ms: duration,
      status: error.status || error.response?.status,
      ...metadata
    });
  }

  /**
   * Log tool execution start
   */
  logToolStart(toolName: string, params: any): void {
    this.info(toolName, `Executing ${toolName}`, {
      toolParams: params,
      paramCount: Object.keys(params || {}).length,
      executionId: `exec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
    });
  }

  /**
   * Log tool execution success
   */
  logToolSuccess(toolName: string, duration: number, responseData?: any, httpStatus?: number): void {
    this.info(toolName, `${toolName} completed successfully`, {
      duration_ms: duration,
      responseData: this.truncateIfNeeded(responseData),
      responseSize: responseData ? JSON.stringify(responseData).length : 0,
      ...(httpStatus && { httpStatus })
    });
  }

  /**
   * Log tool execution error
   */
  logToolError(toolName: string, error: any, duration: number, params?: any): void {
    this.error(toolName, `${toolName} failed`, {
      duration_ms: duration,
      errorDetails: {
        message: error.message || String(error),
        stack: error.stack,
        code: error.code,
        status: error.status || error.response?.status
      },
      toolParams: params,
      errorType: error.constructor?.name || 'unknown'
    });
  }

  /**
   * Log authentication events
   */
  logAuthEvent(event: string, success: boolean, metadata?: any): void {
    const level = success ? 'INFO' : 'ERROR';
    this.log(level, 'AUTH_EVENT', `Authentication ${event}: ${success ? 'success' : 'failed'}`, {
      event,
      success,
      ...metadata
    });
  }

  /**
   * Log rate limiting events
   */
  logRateLimit(action: string, delayMs: number, metadata?: any): void {
    this.warn('RATE_LIMIT', `Rate limit applied: ${action}`, {
      action,
      delay_ms: delayMs,
      ...metadata
    });
  }

  /**
   * Truncate large data objects to prevent oversized log entries
   */
  private truncateIfNeeded(data: any, maxSize: number = 10000): any {
    if (!data) return data;
    
    const jsonString = JSON.stringify(data);
    if (jsonString.length <= maxSize) return data;
    
    return {
      _truncated: true,
      _originalSize: jsonString.length,
      _data: `[TRUNCATED - Original size: ${jsonString.length} chars]`
    };
  }

  /**
   * Get logger status
   */
  getStatus(): { config: LoggerConfig; batcherStatus?: any } {
    return {
      config: this.config,
      ...(this.batcher && { batcherStatus: this.batcher.getBatchStatus() })
    };
  }

  /**
   * Shutdown logger and flush remaining logs
   */
  async shutdown(): Promise<void> {
    if (this.batcher) {
      await this.batcher.shutdown();
    }
  }
}