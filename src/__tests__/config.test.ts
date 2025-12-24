import { loadConfig, validateConfig, ServerConfig } from '../config.js';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load default configuration', () => {
      process.env.NOTION_ACCESS_TOKEN = 'test-token';
      const config = loadConfig();

      expect(config.logShipping.enabled).toBe(false);
      expect(config.logShipping.batchSize).toBe(500);
      expect(config.logShipping.flushInterval).toBe(5000);
      expect(config.logShipping.maxRetries).toBe(3);
      expect(config.logShipping.logLevel).toBe('ERROR');
    });

    it('should load log shipping configuration from environment', () => {
      process.env.LOG_SHIPPING_ENABLED = 'true';
      process.env.LOG_INGESTION_URL = 'https://logs.example.com';
      process.env.LOG_INGESTION_API_KEY = 'api-key';
      process.env.LOG_SHIPPING_BATCH_SIZE = '100';
      process.env.LOG_SHIPPING_INTERVAL = '10000';
      process.env.LOG_SHIPPING_MAX_RETRIES = '5';
      process.env.LOG_LEVEL = 'DEBUG';
      process.env.NOTION_ACCESS_TOKEN = 'test-token';

      const config = loadConfig();

      expect(config.logShipping.enabled).toBe(true);
      expect(config.logShipping.endpoint).toBe('https://logs.example.com');
      expect(config.logShipping.apiKey).toBe('api-key');
      expect(config.logShipping.batchSize).toBe(100);
      expect(config.logShipping.flushInterval).toBe(10000);
      expect(config.logShipping.maxRetries).toBe(5);
      expect(config.logShipping.logLevel).toBe('DEBUG');
    });

    it('should load notion configuration', () => {
      process.env.NOTION_ACCESS_TOKEN = 'notion_access_token';

      const config = loadConfig();

      expect(config.notion.nOTIONACCESSTOKEN).toBe('notion_access_token');
    });
  });

  describe('validateConfig', () => {
    it('should validate a valid configuration', () => {
      const config: ServerConfig = {
        logShipping: {
          enabled: false,
          endpoint: '',
          batchSize: 500,
          flushInterval: 5000,
          maxRetries: 3,
          logLevel: 'ERROR'
        },
        notion: {
          nOTIONACCESSTOKEN: 'test-token'
        }
      };

      const result = validateConfig(config);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require NOTION_ACCESS_TOKEN', () => {
      const config: ServerConfig = {
        logShipping: {
          enabled: false,
          endpoint: '',
          batchSize: 500,
          flushInterval: 5000,
          maxRetries: 3,
          logLevel: 'ERROR'
        },
        notion: {
          nOTIONACCESSTOKEN: ''
        }
      };

      const result = validateConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('NOTION_ACCESS_TOKEN environment variable is required for notion');
    });

    describe('log shipping validation', () => {
      it('should require endpoint when log shipping is enabled', () => {
        const config: ServerConfig = {
          logShipping: {
            enabled: true,
            endpoint: '',
            batchSize: 500,
            flushInterval: 5000,
            maxRetries: 3,
            logLevel: 'ERROR'
          },
          notion: {
            nOTIONACCESSTOKEN: 'test-token'
          }
        };

        const result = validateConfig(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('LOG_INGESTION_URL environment variable is required when log shipping is enabled');
      });

      it('should require HTTPS for endpoint', () => {
        const config: ServerConfig = {
          logShipping: {
            enabled: true,
            endpoint: 'http://logs.example.com',
            batchSize: 500,
            flushInterval: 5000,
            maxRetries: 3,
            logLevel: 'ERROR'
          },
          notion: {
            nOTIONACCESSTOKEN: 'test-token'
          }
        };

        const result = validateConfig(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('LOG_INGESTION_URL must use HTTPS protocol');
      });

      it('should validate batch size range', () => {
        const config: ServerConfig = {
          logShipping: {
            enabled: true,
            endpoint: 'https://logs.example.com',
            batchSize: 1500,
            flushInterval: 5000,
            maxRetries: 3,
            logLevel: 'ERROR'
          },
          notion: {
            nOTIONACCESSTOKEN: 'test-token'
          }
        };

        const result = validateConfig(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('LOG_SHIPPING_BATCH_SIZE must be between 1 and 1000');
      });

      it('should validate minimum flush interval', () => {
        const config: ServerConfig = {
          logShipping: {
            enabled: true,
            endpoint: 'https://logs.example.com',
            batchSize: 500,
            flushInterval: 500,
            maxRetries: 3,
            logLevel: 'ERROR'
          },
          notion: {
            nOTIONACCESSTOKEN: 'test-token'
          }
        };

        const result = validateConfig(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('LOG_SHIPPING_INTERVAL must be at least 1000ms');
      });

      it('should require API key when requireApiKey is true', () => {
        const config: ServerConfig = {
          logShipping: {
            enabled: true,
            endpoint: 'https://logs.example.com',
            requireApiKey: true,
            batchSize: 500,
            flushInterval: 5000,
            maxRetries: 3,
            logLevel: 'ERROR'
          },
          notion: {
            nOTIONACCESSTOKEN: 'test-token'
          }
        };

        const result = validateConfig(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('LOG_INGESTION_API_KEY environment variable is required when LOG_SHIPPING_REQUIRE_API_KEY is true');
      });
    });
  });
});
