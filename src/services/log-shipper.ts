/**
 * LogShipper - Centralized log shipping service for notion-mcp
 * Sends logs to the centralized logging API endpoint with batching and retry logic
 */

export interface LogEntry {
  timestamp: string;      // ISO 8601 format
  level: string;          // Log level (lowercase: info, error, etc.)
  sessionId: string;      // Session/request identifier
  user: string;           // From CORETEXT_USER env var
  integration: string;    // Integration name (google-gmail, jira, etc.)
  component: string;      // One of: client, tools, oauth-client
  action: string;         // Action being performed (tool name)
  message: string;        // Log message
  serverName: string;     // MCP server name
  projectId?: string;     // Project UUID identifier
  organizationId?: string; // Organization UUID identifier
  metadata?: {
    // Tool execution data
    toolParams?: any;
    responseData?: any;
    errorDetails?: any;
    // Performance data
    duration_ms?: number;
    httpStatus?: number;
    responseSize?: number;
    // Context data
    requestId?: string;
    executionId?: string;
    [key: string]: any;
  };
}

export interface LogBatch {
  logs: LogEntry[];
}

export interface LogShipperConfig {
  endpoint: string;       // API Gateway URL
  apiKey?: string;        // API key for authentication (optional during transition)
  requireApiKey?: boolean; // Whether API key is required (default: false)
  batchSize: number;      // Max logs per batch (default: 500)
  flushInterval: number;  // Flush interval in ms (default: 5000)
  maxRetries: number;     // Max retry attempts (default: 3)
  enabled: boolean;       // Enable/disable log shipping
}

export class LogShipper {
  private config: LogShipperConfig;
  private logQueue: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private lastSuccessfulFlush = 0;

  constructor(config: LogShipperConfig) {
    this.config = config;
    
    if (!this.config.enabled) {
      return;
    }

    this.validateConfig();
    this.startFlushTimer();
    
    // Log initialization
    this.logLocally('INFO', 'LogShipper initialized', {
      endpoint: this.config.endpoint,
      batchSize: this.config.batchSize,
      flushInterval: this.config.flushInterval,
      maxRetries: this.config.maxRetries
    });
  }

  private validateConfig(): void {
    if (!this.config.endpoint) {
      throw new Error('LogShipper: endpoint is required');
    }
    
    // API key validation based on requireApiKey flag
    if (this.config.requireApiKey && !this.config.apiKey) {
      throw new Error('LogShipper: apiKey is required when requireApiKey is true');
    }
    
    // Warning for missing API key during transition period
    if (!this.config.apiKey && !this.config.requireApiKey) {
      this.logLocally('WARN', 'API key not configured. Log shipping will work now but will require an API key in the future.', {
        help: 'Set LOG_INGESTION_API_KEY environment variable to prepare for future requirements'
      });
    }
    
    if (!this.config.endpoint.startsWith('https://')) {
      throw new Error('LogShipper: endpoint must use HTTPS');
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    this.flushTimer = setInterval(() => {
      this.flush().catch(error => {
        this.logLocally('ERROR', 'Scheduled flush failed', {
          error: error.message,
          queueSize: this.logQueue.length
        });
      });
    }, this.config.flushInterval);
  }

  /**
   * Add a log entry to the queue
   */
  addLog(logEntry: LogEntry): void {
    if (!this.config.enabled || this.isShuttingDown) {
      return;
    }

    this.logQueue.push(logEntry);

    // Trigger immediate flush if batch size reached
    if (this.logQueue.length >= this.config.batchSize) {
      this.flush().catch(error => {
        this.logLocally('ERROR', 'Immediate flush failed', {
          error: error.message,
          queueSize: this.logQueue.length
        });
      });
    }
  }

  /**
   * Flush all queued logs to the endpoint
   */
  async flush(): Promise<void> {
    if (!this.config.enabled || this.logQueue.length === 0) {
      return;
    }

    const batch = this.logQueue.splice(0, this.config.batchSize);
    
    try {
      await this.sendLogsWithRetry(batch);
      this.lastSuccessfulFlush = Date.now();
      
      this.logLocally('DEBUG', 'Logs shipped successfully', {
        batchSize: batch.length,
        queueRemaining: this.logQueue.length,
        lastFlush: new Date(this.lastSuccessfulFlush).toISOString()
      });
    } catch (error) {
      // Return logs to queue on failure
      this.logQueue.unshift(...batch);
      
      this.logLocally('ERROR', 'Failed to ship logs after retries', {
        error: error instanceof Error ? error.message : String(error),
        batchSize: batch.length,
        queueSize: this.logQueue.length
      });
      
      throw error;
    }
  }

  /**
   * Send logs with retry logic
   */
  private async sendLogsWithRetry(logs: LogEntry[]): Promise<void> {
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.sendLogs(logs);
        return; // Success
      } catch (error: any) {
        const status = error.status || error.response?.status;
        
        // Don't retry on client errors (4xx except 429)
        if (status >= 400 && status < 500 && status !== 429) {
          this.logLocally('ERROR', 'Client error - not retrying', {
            status,
            error: error.message,
            attempt
          });
          throw error;
        }
        
        // On last attempt, throw the error
        if (attempt === this.config.maxRetries) {
          this.logLocally('ERROR', 'Max retries exceeded', {
            status,
            error: error.message,
            attempts: attempt
          });
          throw error;
        }
        
        // Calculate delay with exponential backoff
        const baseDelay = status === 429 ? 1000 : 500; // Longer delay for rate limits
        const delay = baseDelay * Math.pow(2, attempt - 1);
        
        this.logLocally('WARN', 'Retrying log shipment', {
          status,
          error: error.message,
          attempt,
          nextAttemptIn: delay,
          maxRetries: this.config.maxRetries
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Map component values to API-accepted enum values
   */
  private mapComponentToValidEnum(component: string): string {
    const validComponents = ['client', 'tools', 'oauth-client'];
    const componentMap: Record<string, string> = {
      'server': 'client',
      'client': 'client',
      'tools': 'tools',
      'oauth-client': 'oauth-client'
    };
    
    const componentStr = String(component || 'client');
    const mapped = componentMap[componentStr.toLowerCase()];
    return mapped || 'client'; // Default to 'client' for any unmapped components
  }
  
  /**
   * Map log level to API-accepted enum values (lowercase)
   */
  private mapLogLevelToValidEnum(level: string): string {
    const validLevels = ['info', 'error', 'warn', 'debug'];
    const levelMap: Record<string, string> = {
      'info': 'info',
      'error': 'error', 
      'warn': 'warn',
      'warning': 'warn',
      'debug': 'debug',
      'fatal': 'error' // Map fatal to error as API doesn't support fatal
    };
    
    const levelStr = String(level || 'info');
    const mapped = levelMap[levelStr.toLowerCase()];
    return mapped || 'info'; // Default to 'info' for any unmapped levels
  }

  /**
   * Validate and clean log entries to ensure API compatibility
   */
  private validateAndCleanLogs(logs: LogEntry[]): LogEntry[] {
    return logs.map(log => {
      // Ensure all required fields are present and valid
      const cleanedLog: LogEntry = {
        timestamp: log.timestamp || new Date().toISOString(),
        level: this.mapLogLevelToValidEnum(log.level || 'info'),
        sessionId: log.sessionId || this.generateSessionId(),
        user: log.user || process.env.CORETEXT_USER || 'unknown',
        integration: log.integration || 'unknown',
        component: this.mapComponentToValidEnum(log.component || 'client'),
        action: log.action || 'unknown',
        message: String(log.message || 'No message'),
        serverName: log.serverName || 'notion-mcp',
        projectId: log.projectId || process.env.PROJECT_ID || '',
        organizationId: log.organizationId || process.env.ORGANIZATION_ID || ''
      };
      
      // Clean and validate metadata
      if (log.metadata && typeof log.metadata === 'object') {
        cleanedLog.metadata = this.cleanMetadata(log.metadata);
      }
      
      return cleanedLog;
    }).filter(log => {
      // Filter out any logs that still have invalid data
      return log.timestamp && log.level && log.user && log.message;
    });
  }
  
  /**
   * Clean metadata object to ensure JSON serialization compatibility
   */
  private cleanMetadata(metadata: any): any {
    if (!metadata || typeof metadata !== 'object') {
      return {};
    }
    
    const cleaned: any = {};
    
    for (const [key, value] of Object.entries(metadata)) {
      try {
        // Skip undefined values
        if (value === undefined) {
          continue;
        }
        
        // Convert functions to string representation
        if (typeof value === 'function') {
          cleaned[key] = '[Function]';
          continue;
        }
        
        // Handle circular references and complex objects
        if (typeof value === 'object' && value !== null) {
          try {
            // Test if the object can be serialized
            JSON.stringify(value);
            cleaned[key] = value;
          } catch (e) {
            // If serialization fails, convert to string
            cleaned[key] = String(value);
          }
        } else {
          cleaned[key] = value;
        }
      } catch (error) {
        // If any error occurs with this field, skip it
        this.logLocally('WARN', 'Skipping problematic metadata field', {
          field: key,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    return cleaned;
  }

  /**
   * Send logs to the API endpoint
   */
  private async sendLogs(logs: LogEntry[]): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    // Only include API key header if provided
    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }
    
    // Validate and clean logs before sending
    const cleanedLogs = this.validateAndCleanLogs(logs);
    const payload = { logs: cleanedLogs };
    
    // Debug logging - log the exact payload being sent
    this.logLocally('DEBUG', 'Sending log payload', {
      payloadSize: JSON.stringify(payload).length,
      logCount: cleanedLogs.length,
      endpoint: this.config.endpoint,
      hasApiKey: !!this.config.apiKey,
      payload: JSON.stringify(payload, null, 2)
    });
    
    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      // Get response body for debugging
      let responseBody = '';
      try {
        responseBody = await response.text();
      } catch (e) {
        responseBody = 'Unable to read response body';
      }
      
      // Log detailed error information
      this.logLocally('ERROR', 'HTTP error response from log ingestion API', {
        status: response.status,
        statusText: response.statusText,
        responseBody,
        requestPayloadSize: JSON.stringify({ logs: cleanedLogs }).length,
        endpoint: this.config.endpoint,
        headers: Object.keys(headers)
      });
      
      // Provide helpful message for authentication errors
      if ((response.status === 401 || response.status === 403) && !this.config.apiKey) {
        const error = new Error(
          `Authentication required (${response.status}). The log ingestion API now requires an API key. ` +
          'Please set LOG_INGESTION_API_KEY environment variable and restart the server.'
        );
        (error as any).status = response.status;
        throw error;
      }
      
      // Provide specific error message for 400 Bad Request
      if (response.status === 400) {
        const error = new Error(
          `Bad Request (400): The log payload format is invalid. ` +
          `Response: ${responseBody}. ` +
          'Check the payload structure and field formats.'
        );
        (error as any).status = response.status;
        throw error;
      }
      
      const error = new Error(`HTTP ${response.status}: ${response.statusText}. Response: ${responseBody}`);
      (error as any).status = response.status;
      throw error;
    }

    return response.json();
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `notion-mcp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Log locally to stderr (for debugging the log shipper itself)
   */
  private logLocally(level: string, message: string, metadata?: any): void {
    const timestamp = new Date().toISOString();
    const user = process.env.CORETEXT_USER || 'unknown';
    
    const logEntry = {
      timestamp,
      user,
      component: 'log-shipper',
      level,
      message,
      ...(metadata && { metadata })
    };
    
    console.error(`[NOTION-MCP-LOG-SHIPPER] ${JSON.stringify(logEntry)}`);
  }

  /**
   * Get health status of the log shipper
   */
  getHealthStatus(): { healthy: boolean; lastFlush?: string; queueSize: number; config: Partial<LogShipperConfig> } {
    const now = Date.now();
    const timeSinceLastFlush = now - this.lastSuccessfulFlush;
    const isHealthy = this.config.enabled && (this.lastSuccessfulFlush === 0 || timeSinceLastFlush < this.config.flushInterval * 3);
    
    return {
      healthy: isHealthy,
      lastFlush: this.lastSuccessfulFlush > 0 ? new Date(this.lastSuccessfulFlush).toISOString() : undefined,
      queueSize: this.logQueue.length,
      config: {
        enabled: this.config.enabled,
        endpoint: this.config.endpoint,
        batchSize: this.config.batchSize,
        flushInterval: this.config.flushInterval
      }
    };
  }

  /**
   * Graceful shutdown - flush remaining logs
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    
    this.logLocally('INFO', 'LogShipper shutting down', {
      queueSize: this.logQueue.length
    });
    
    if (this.logQueue.length > 0) {
      try {
        await this.flush();
        this.logLocally('INFO', 'Final flush completed successfully');
      } catch (error) {
        this.logLocally('ERROR', 'Final flush failed', {
          error: error instanceof Error ? error.message : String(error),
          lostLogs: this.logQueue.length
        });
      }
    }
  }
}