export interface ServerConfig {
  // Log shipping configuration
  logShipping: {
    enabled: boolean;
    endpoint: string;
    apiKey?: string;
    requireApiKey?: boolean;
    batchSize: number;
    flushInterval: number;
    maxRetries: number;
    logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  };
  
  notion: {
    nOTIONACCESSTOKEN: string;
  };
}

export function loadConfig(): ServerConfig {
  return {
    // Log shipping configuration
    logShipping: {
      enabled: process.env.LOG_SHIPPING_ENABLED === 'true',
      endpoint: process.env.LOG_INGESTION_URL || '',
      ...(process.env.LOG_INGESTION_API_KEY && { apiKey: process.env.LOG_INGESTION_API_KEY }),
      requireApiKey: process.env.LOG_SHIPPING_REQUIRE_API_KEY === 'true',
      batchSize: parseInt(process.env.LOG_SHIPPING_BATCH_SIZE || '500', 10),
      flushInterval: parseInt(process.env.LOG_SHIPPING_INTERVAL || '5000', 10),
      maxRetries: parseInt(process.env.LOG_SHIPPING_MAX_RETRIES || '3', 10),
      logLevel: (process.env.LOG_LEVEL || 'ERROR') as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'
    },
    
    notion: {
      nOTIONACCESSTOKEN: process.env.NOTION_ACCESS_TOKEN || '',
    },
  };
}

export function validateConfig(config: ServerConfig): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate log shipping configuration
  if (config.logShipping.enabled) {
    if (!config.logShipping.endpoint) {
      errors.push('LOG_INGESTION_URL environment variable is required when log shipping is enabled');
    }
    
    // API key validation based on requireApiKey flag
    if (config.logShipping.requireApiKey && !config.logShipping.apiKey) {
      errors.push('LOG_INGESTION_API_KEY environment variable is required when LOG_SHIPPING_REQUIRE_API_KEY is true');
    }
    
    // Warning for missing API key (not an error during transition)
    if (!config.logShipping.apiKey && !config.logShipping.requireApiKey) {
      console.warn('[CONFIG WARNING] LOG_INGESTION_API_KEY not set. Log shipping will work now but will require an API key in the future.');
      console.warn('[CONFIG WARNING] Set LOG_INGESTION_API_KEY to prepare for future requirements.');
    }
    
    if (config.logShipping.endpoint && !config.logShipping.endpoint.startsWith('https://')) {
      errors.push('LOG_INGESTION_URL must use HTTPS protocol');
    }
    if (config.logShipping.batchSize < 1 || config.logShipping.batchSize > 1000) {
      errors.push('LOG_SHIPPING_BATCH_SIZE must be between 1 and 1000');
    }
    if (config.logShipping.flushInterval < 1000) {
      errors.push('LOG_SHIPPING_INTERVAL must be at least 1000ms');
    }
    if (!['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].includes(config.logShipping.logLevel)) {
      errors.push('LOG_LEVEL must be one of: DEBUG, INFO, WARN, ERROR, FATAL');
    }
  }

  // Validate notion configuration
  // Standard authentication validation
  if (!config.notion.nOTIONACCESSTOKEN) {
    errors.push('NOTION_ACCESS_TOKEN environment variable is required for notion');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}