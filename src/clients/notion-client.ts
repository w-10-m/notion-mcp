import axios, { AxiosInstance } from 'axios';
import { Logger } from '../services/logger.js';
import { RequestOptions, ProgressCallback } from '../types.js';

export interface NotionClientConfig {
  nOTIONACCESSTOKEN?: string;
  timeout?: number;
  rateLimit?: number; // requests per minute
  authToken?: string;
  logger?: Logger;
}

export class NotionClient {
  private httpClient: AxiosInstance;
  private config: NotionClientConfig;
  private sessionId: string;
  private logger: Logger;

  constructor(config: NotionClientConfig) {
    this.config = config;
    
    // Generate unique session ID for this client instance
    this.sessionId = `notion-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    // Initialize logger (fallback to console if not provided)
    this.logger = config.logger || new Logger(
      {
        logLevel: 'ERROR',
        component: 'client',
        enableConsole: true,
        enableShipping: false,
        serverName: 'notion-mcp'
      }
    );
    
    this.logger.info('CLIENT_INIT', 'Client instance created', { 
      baseUrl: this.resolveBaseUrl(),
      timeout: this.config.timeout || 30000,
      hasRateLimit: !!this.config.rateLimit,
      configKeys: Object.keys(config)
    });

    
    this.httpClient = axios.create({
      baseURL: this.resolveBaseUrl(),
      timeout: this.config.timeout || 30000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'notion-mcp/1.0.0',
        'Notion-Version': '2022-06-28',
        ...this.getAuthHeaders()
      },
    });

    // Add request interceptor for rate limiting
    if (this.config.rateLimit) {
      this.setupRateLimit(this.config.rateLimit);
    }

    // Add request interceptor for logging
    this.httpClient.interceptors.request.use(
      (config) => {
        this.logger.logRequestStart(
          config.method?.toUpperCase() || 'GET',
          `${config.baseURL}${config.url}`,
          {
            hasData: !!config.data,
            hasParams: !!(config.params && Object.keys(config.params).length > 0),
            headers: Object.keys(config.headers || {})
          }
        );
        
        if (config.data) {
          this.logger.debug('HTTP_REQUEST_BODY', 'Request body data', {
            dataType: typeof config.data,
            dataSize: JSON.stringify(config.data).length
          });
        }
        
        if (config.params && Object.keys(config.params).length > 0) {
          this.logger.debug('HTTP_REQUEST_PARAMS', 'Query parameters', {
            paramCount: Object.keys(config.params).length,
            paramKeys: Object.keys(config.params)
          });
        }
        
        return config;
      },
      (error) => {
        this.logger.error('HTTP_REQUEST_ERROR', 'Request interceptor error', {
          error: error.message,
          code: error.code
        });
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging and error handling
    this.httpClient.interceptors.response.use(
      (response) => {
        this.logger.logRequestSuccess(
          response.config?.method?.toUpperCase() || 'GET',
          `${response.config?.baseURL}${response.config?.url}`,
          response.status,
          0, // Duration will be calculated in endpoint methods
          {
            statusText: response.statusText,
            responseSize: JSON.stringify(response.data).length,
            headers: Object.keys(response.headers || {})
          }
        );
        return response;
      },
      (error) => {
        this.logger.logRequestError(
          error.config?.method?.toUpperCase() || 'GET',
          `${error.config?.baseURL}${error.config?.url}`,
          error,
          0, // Duration will be calculated in endpoint methods
          {
            hasResponseData: !!error.response?.data
          }
        );
        throw error;
      }
    );
  }

  private setupRateLimit(requestsPerMinute: number) {
    const interval = 60000 / requestsPerMinute; // ms between requests
    let lastRequestTime = 0;

    this.logger.info('RATE_LIMIT_SETUP', 'Rate limiting configured', {
      requestsPerMinute,
      intervalMs: interval
    });

    this.httpClient.interceptors.request.use(async (config) => {
      const now = Date.now();
      const timeSinceLastRequest = now - lastRequestTime;
      
      if (timeSinceLastRequest < interval) {
        const delayMs = interval - timeSinceLastRequest;
        this.logger.logRateLimit('HTTP_REQUEST', delayMs, {
          timeSinceLastRequest,
          requiredInterval: interval
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      
      lastRequestTime = Date.now();
      return config;
    });
  }

  private resolveBaseUrl(): string {
    // Debug logging for base_url resolution
    // console.error('[NotionClient] Resolving base URL...');
    // console.error('[NotionClient] Template base_url:', 'https://api.notion.com/v1');
    // console.error('[NotionClient] CustomConfig baseUrl:', '');
    
    let baseUrl = 'https://api.notion.com/v1';
    
    // console.error('[NotionClient] Initial resolved baseUrl:', baseUrl);
    
    // If no base URL was found, throw an error
    if (!baseUrl) {
      throw new Error(`No base URL configured for notion. Please provide base_url in template or customConfig.baseUrl.`);
    }
    
    // Handle dynamic domain replacement for patterns like CONFLUENCE_DOMAIN, JIRA_DOMAIN, etc.
    const domainEnvVar = `NOTION_DOMAIN`;
    const domain = process.env[domainEnvVar];
    // console.error(`[NotionClient] Domain env var (${domainEnvVar}):`, domain);
    
    // Check for SERVICE_DOMAIN pattern (e.g., CONFLUENCE_DOMAIN, JIRA_DOMAIN, SLACK_DOMAIN)
    // This handles both YOUR_DOMAIN and {SERVICE}_DOMAIN patterns in base URLs
    if (baseUrl.includes('YOUR_DOMAIN') || baseUrl.includes(`${domainEnvVar}`)) {
      if (!domain) {
        throw new Error(`Missing domain configuration. Please set ${domainEnvVar} environment variable.`);
      }
      
      // Replace the placeholder with the actual domain value
      // This handles patterns like https://CONFLUENCE_DOMAIN.atlassian.net
      if (baseUrl.includes('YOUR_DOMAIN')) {
        baseUrl = baseUrl.replace(/YOUR_DOMAIN/g, domain);
      } 
      if (baseUrl.includes(`${domainEnvVar}`)) {
        // Replace all occurrences of the service-specific domain placeholder
        const regex = new RegExp(domainEnvVar, 'g');
        baseUrl = baseUrl.replace(regex, domain);
      }
      
      this.logger.info('DOMAIN_RESOLVED', `Resolved base URL with domain`, {
        template: 'notion',
        baseUrl: baseUrl
      });
    }
    
    // console.error('[NotionClient] Final resolved baseUrl:', baseUrl);
    return baseUrl;
  }

  private getAuthHeaders(): Record<string, string> {
    // Bearer/API key authentication (static tokens)
    // Determine the correct environment variable name based on auth type and configuration
    let envVarName;
    // Use first required env var if specified
    envVarName = 'NOTION_ACCESS_TOKEN';
    
    const token = this.config.authToken || this.config['nOTIONACCESSTOKEN'] || process.env[envVarName];
    if (token) {
      this.logger.logAuthEvent('static_token_auth_setup', true, {
        authType: 'bearer',
        tokenPreview: token.substring(0, 8) + '...',
        header: 'Authorization',
        source: 'static_configuration',
        envVar: envVarName
      });
      return {
        'Authorization': `Bearer ${token}`
              };
    }
    this.logger.warn('AUTH_WARNING', 'No authentication token found', {
      authType: 'bearer',
      warning: 'API calls may be rate limited',
      checkedSources: ['config.authToken', 'environment variables'],
      expectedEnvVar: envVarName
    });
    return {};
      }

  /**
   * Initialize the client (for OAuth clients that need initialization)
   */
  async initialize(): Promise<void> {
    this.logger.debug('CLIENT_INITIALIZE', 'No initialization required for this auth type');
      }

  /**
   * Get the session ID for this client instance
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Make an authenticated request with proper headers and cancellation support
   */
  private async makeAuthenticatedRequest(config: any, options?: RequestOptions): Promise<any> {
    // Add abort signal if provided
    if (options?.signal) {
      config.signal = options.signal;
    }
    // For non-OAuth requests, log what auth headers are being used
    this.logger.info('REQUEST_AUTH', 'Using pre-configured authentication headers', {
      authType: 'static',
      requestUrl: config.url,
      authHeaders: config.headers?.Authorization ? 'present' : 'missing',
      headerKeys: Object.keys(config.headers || {})
    });
        
    return this.httpClient.request(config);
  }

  private buildPath(template: string, params: Record<string, any>): string {
    let path = template;
    
    // Custom encoding that preserves forward slashes for API paths
    const encodePathComponent = (value: string): string => {
      // For Google API resource names like "people/c123", preserve the forward slash
      return encodeURIComponent(value).replace(/%2F/g, '/');
    };
    
    // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
    const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
    let match;
    const processedParams: string[] = [];
    
    while ((match = googlePathTemplateRegex.exec(template)) !== null) {
      const fullMatch = match[0]; // e.g., "{resourceName=people/*}"
      const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
      
      if (paramName && params[paramName] !== undefined) {
        path = path.replace(fullMatch, encodePathComponent(String(params[paramName])));
        processedParams.push(paramName);
      }
    }
    
    // Handle standard path templates: {resourceName}
    for (const [key, value] of Object.entries(params)) {
      if (!processedParams.includes(key)) {
        const standardTemplate = `{${key}}`;
        if (path.includes(standardTemplate)) {
          path = path.replace(standardTemplate, encodePathComponent(String(value)));
          processedParams.push(key);
        }
      }
    }
    
    this.logger.debug('PATH_BUILD', 'Built API path from template', {
      template,
      resultPath: path,
      paramCount: Object.keys(params).length,
      paramKeys: Object.keys(params),
      processedParams,
      hasGoogleTemplates: googlePathTemplateRegex.test(template)
    });
    return path;
  }

  /* DEBUG: endpoint={"name":"list_databases","method":"GET","path":"/databases","description":"⚠️ DEPRECATED: This endpoint is deprecated by Notion API. Use the search endpoint with database filter instead.","parameters":{"start_cursor":{"type":"string","required":false,"description":"Pagination cursor","location":"query"},"page_size":{"type":"number","required":false,"description":"Number of results per page (max 100)","location":"query","default":100}},"response_format":"json","category":"Database Operations"} */
  async listDatabases(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'list_databases',
      method: 'GET',
      path: '/databases',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/databases';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/databases', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting list_databases request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.get(requestPath, { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed list_databases request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'list_databases',
        method: 'GET',
        path: '/databases',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'list_databases',
          method: 'GET',
          path: '/databases',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'list_databases',
        method: 'GET',
        path: '/databases',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute list_databases: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"get_database","method":"GET","path":"/databases/{database_id}","description":"Get database by ID","parameters":{"database_id":{"type":"string","required":true,"description":"Database ID to fetch","location":"path"}},"response_format":"json","category":"Database Operations"} */
  async getDatabase(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'get_database',
      method: 'GET',
      path: '/databases/{database_id}',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/databases/{database_id}';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/databases/{database_id}', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting get_database request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.get(requestPath, { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed get_database request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'get_database',
        method: 'GET',
        path: '/databases/{database_id}',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'get_database',
          method: 'GET',
          path: '/databases/{database_id}',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'get_database',
        method: 'GET',
        path: '/databases/{database_id}',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute get_database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"query_database","method":"POST","path":"/databases/{database_id}/query","description":"Query database pages","parameters":{"database_id":{"type":"string","required":true,"description":"Database ID to query","location":"path"},"filter":{"type":"object","required":false,"description":"Filter object to apply","location":"body"},"sorts":{"type":"array","required":false,"description":"Array of sort objects","location":"body"},"start_cursor":{"type":"string","required":false,"description":"Pagination cursor","location":"body"},"page_size":{"type":"number","required":false,"description":"Number of results per page (max 100)","location":"body","default":100}},"response_format":"json","category":"Database Operations"} */
  async queryDatabase(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'query_database',
      method: 'POST',
      path: '/databases/{database_id}/query',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/databases/{database_id}/query';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/databases/{database_id}/query', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting query_database request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.post(requestPath, hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined), { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed query_database request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'query_database',
        method: 'POST',
        path: '/databases/{database_id}/query',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'query_database',
          method: 'POST',
          path: '/databases/{database_id}/query',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'query_database',
        method: 'POST',
        path: '/databases/{database_id}/query',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute query_database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"create_database","method":"POST","path":"/databases","description":"Create a new database","parameters":{"parent":{"type":"object","required":true,"description":"Parent page object","location":"body"},"title":{"type":"array","required":true,"description":"Array of rich text objects for title","location":"body"},"properties":{"type":"object","required":true,"description":"Database properties schema","location":"body"},"icon":{"type":"object","required":false,"description":"Database icon object","location":"body"},"cover":{"type":"object","required":false,"description":"Database cover object","location":"body"}},"response_format":"json","category":"Page Creation & Editing"} */
  async createDatabase(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'create_database',
      method: 'POST',
      path: '/databases',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/databases';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/databases', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting create_database request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.post(requestPath, hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined), { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed create_database request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'create_database',
        method: 'POST',
        path: '/databases',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'create_database',
          method: 'POST',
          path: '/databases',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'create_database',
        method: 'POST',
        path: '/databases',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute create_database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"update_database","method":"PATCH","path":"/databases/{database_id}","description":"Update database properties","parameters":{"database_id":{"type":"string","required":true,"description":"Database ID to update","location":"path"},"title":{"type":"array","required":false,"description":"Array of rich text objects for title","location":"body"},"properties":{"type":"object","required":false,"description":"Database properties to update","location":"body"},"icon":{"type":"object","required":false,"description":"Database icon object","location":"body"},"cover":{"type":"object","required":false,"description":"Database cover object","location":"body"}},"response_format":"json","category":"Page Creation & Editing"} */
  async updateDatabase(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'update_database',
      method: 'PATCH',
      path: '/databases/{database_id}',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/databases/{database_id}';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/databases/{database_id}', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting update_database request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.patch(requestPath, hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined), { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed update_database request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'update_database',
        method: 'PATCH',
        path: '/databases/{database_id}',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'update_database',
          method: 'PATCH',
          path: '/databases/{database_id}',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'update_database',
        method: 'PATCH',
        path: '/databases/{database_id}',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute update_database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"get_page","method":"GET","path":"/pages/{page_id}","description":"Get page by ID","parameters":{"page_id":{"type":"string","required":true,"description":"Page ID to fetch","location":"path"}},"response_format":"json","category":"Page Creation & Editing"} */
  async getPage(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'get_page',
      method: 'GET',
      path: '/pages/{page_id}',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/pages/{page_id}';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/pages/{page_id}', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting get_page request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.get(requestPath, { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed get_page request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'get_page',
        method: 'GET',
        path: '/pages/{page_id}',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'get_page',
          method: 'GET',
          path: '/pages/{page_id}',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'get_page',
        method: 'GET',
        path: '/pages/{page_id}',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute get_page: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"create_page","method":"POST","path":"/pages","description":"Create a new page. Note: Creating pages directly in workspace root requires special permissions - use database or page parents instead.","parameters":{"parent":{"type":"object","required":true,"description":"Parent object (database or page)","location":"body"},"properties":{"type":"object","required":false,"description":"Page properties (required for database pages)","location":"body"},"children":{"type":"array","required":false,"description":"Array of block objects for page content","location":"body"},"icon":{"type":"object","required":false,"description":"Page icon object","location":"body"},"cover":{"type":"object","required":false,"description":"Page cover object","location":"body"}},"response_format":"json","category":"Page Creation & Editing"} */
  async createPage(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'create_page',
      method: 'POST',
      path: '/pages',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/pages';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/pages', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting create_page request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.post(requestPath, hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined), { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed create_page request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'create_page',
        method: 'POST',
        path: '/pages',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'create_page',
          method: 'POST',
          path: '/pages',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'create_page',
        method: 'POST',
        path: '/pages',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute create_page: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"update_page","method":"PATCH","path":"/pages/{page_id}","description":"Update page properties","parameters":{"page_id":{"type":"string","required":true,"description":"Page ID to update","location":"path"},"properties":{"type":"object","required":false,"description":"Page properties to update","location":"body"},"archived":{"type":"boolean","required":false,"description":"Archive or unarchive the page","location":"body"},"icon":{"type":"object","required":false,"description":"Page icon object","location":"body"},"cover":{"type":"object","required":false,"description":"Page cover object","location":"body"}},"response_format":"json","category":"Page Creation & Editing"} */
  async updatePage(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'update_page',
      method: 'PATCH',
      path: '/pages/{page_id}',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/pages/{page_id}';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/pages/{page_id}', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting update_page request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.patch(requestPath, hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined), { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed update_page request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'update_page',
        method: 'PATCH',
        path: '/pages/{page_id}',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'update_page',
          method: 'PATCH',
          path: '/pages/{page_id}',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'update_page',
        method: 'PATCH',
        path: '/pages/{page_id}',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute update_page: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"get_page_property","method":"GET","path":"/pages/{page_id}/properties/{property_id}","description":"Get page property by ID","parameters":{"page_id":{"type":"string","required":true,"description":"Page ID containing the property","location":"path"},"property_id":{"type":"string","required":true,"description":"Property ID to fetch","location":"path"},"start_cursor":{"type":"string","required":false,"description":"Pagination cursor","location":"query"},"page_size":{"type":"number","required":false,"description":"Number of results per page (max 100)","location":"query","default":100}},"response_format":"json","category":"Page Creation & Editing"} */
  async getPageProperty(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'get_page_property',
      method: 'GET',
      path: '/pages/{page_id}/properties/{property_id}',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/pages/{page_id}/properties/{property_id}';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/pages/{page_id}/properties/{property_id}', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting get_page_property request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.get(requestPath, { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed get_page_property request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'get_page_property',
        method: 'GET',
        path: '/pages/{page_id}/properties/{property_id}',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'get_page_property',
          method: 'GET',
          path: '/pages/{page_id}/properties/{property_id}',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'get_page_property',
        method: 'GET',
        path: '/pages/{page_id}/properties/{property_id}',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute get_page_property: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"get_block_children","method":"GET","path":"/blocks/{block_id}/children","description":"Get block children","parameters":{"block_id":{"type":"string","required":true,"description":"Block ID to get children for","location":"path"},"start_cursor":{"type":"string","required":false,"description":"Pagination cursor","location":"query"},"page_size":{"type":"number","required":false,"description":"Number of results per page (max 100)","location":"query","default":100}},"response_format":"json","category":"Block Content"} */
  async getBlockChildren(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'get_block_children',
      method: 'GET',
      path: '/blocks/{block_id}/children',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/blocks/{block_id}/children';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/blocks/{block_id}/children', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting get_block_children request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.get(requestPath, { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed get_block_children request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'get_block_children',
        method: 'GET',
        path: '/blocks/{block_id}/children',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'get_block_children',
          method: 'GET',
          path: '/blocks/{block_id}/children',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'get_block_children',
        method: 'GET',
        path: '/blocks/{block_id}/children',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute get_block_children: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"append_block_children","method":"PATCH","path":"/blocks/{block_id}/children","description":"Append blocks to a parent block","parameters":{"block_id":{"type":"string","required":true,"description":"Parent block ID","location":"path"},"children":{"type":"array","required":true,"description":"Array of block objects to append","location":"body"}},"response_format":"json","category":"Block Content"} */
  async appendBlockChildren(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'append_block_children',
      method: 'PATCH',
      path: '/blocks/{block_id}/children',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/blocks/{block_id}/children';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/blocks/{block_id}/children', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting append_block_children request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.patch(requestPath, hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined), { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed append_block_children request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'append_block_children',
        method: 'PATCH',
        path: '/blocks/{block_id}/children',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'append_block_children',
          method: 'PATCH',
          path: '/blocks/{block_id}/children',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'append_block_children',
        method: 'PATCH',
        path: '/blocks/{block_id}/children',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute append_block_children: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"get_block","method":"GET","path":"/blocks/{block_id}","description":"Get block by ID","parameters":{"block_id":{"type":"string","required":true,"description":"Block ID to fetch","location":"path"}},"response_format":"json","category":"Block Content"} */
  async getBlock(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'get_block',
      method: 'GET',
      path: '/blocks/{block_id}',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/blocks/{block_id}';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/blocks/{block_id}', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting get_block request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.get(requestPath, { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed get_block request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'get_block',
        method: 'GET',
        path: '/blocks/{block_id}',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'get_block',
          method: 'GET',
          path: '/blocks/{block_id}',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'get_block',
        method: 'GET',
        path: '/blocks/{block_id}',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute get_block: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"update_block","method":"PATCH","path":"/blocks/{block_id}","description":"Update block content","parameters":{"block_id":{"type":"string","required":true,"description":"Block ID to update","location":"path"},"paragraph":{"type":"object","required":false,"description":"Updated paragraph block content","location":"body"},"heading_1":{"type":"object","required":false,"description":"Updated heading 1 block content","location":"body"},"heading_2":{"type":"object","required":false,"description":"Updated heading 2 block content","location":"body"},"heading_3":{"type":"object","required":false,"description":"Updated heading 3 block content","location":"body"},"bulleted_list_item":{"type":"object","required":false,"description":"Updated bulleted list item content","location":"body"},"numbered_list_item":{"type":"object","required":false,"description":"Updated numbered list item content","location":"body"},"to_do":{"type":"object","required":false,"description":"Updated to-do block content","location":"body"},"toggle":{"type":"object","required":false,"description":"Updated toggle block content","location":"body"},"code":{"type":"object","required":false,"description":"Updated code block content","location":"body"},"embed":{"type":"object","required":false,"description":"Updated embed block content","location":"body"},"image":{"type":"object","required":false,"description":"Updated image block content","location":"body"},"video":{"type":"object","required":false,"description":"Updated video block content","location":"body"},"file":{"type":"object","required":false,"description":"Updated file block content","location":"body"},"pdf":{"type":"object","required":false,"description":"Updated PDF block content","location":"body"},"bookmark":{"type":"object","required":false,"description":"Updated bookmark block content","location":"body"},"callout":{"type":"object","required":false,"description":"Updated callout block content","location":"body"},"quote":{"type":"object","required":false,"description":"Updated quote block content","location":"body"},"equation":{"type":"object","required":false,"description":"Updated equation block content","location":"body"},"divider":{"type":"object","required":false,"description":"Updated divider block content","location":"body"},"table_of_contents":{"type":"object","required":false,"description":"Updated table of contents block content","location":"body"},"column":{"type":"object","required":false,"description":"Updated column block content","location":"body"},"column_list":{"type":"object","required":false,"description":"Updated column list block content","location":"body"},"link_preview":{"type":"object","required":false,"description":"Updated link preview block content","location":"body"},"synced_block":{"type":"object","required":false,"description":"Updated synced block content","location":"body"},"table":{"type":"object","required":false,"description":"Updated table block content","location":"body"},"table_row":{"type":"object","required":false,"description":"Updated table row block content","location":"body"},"archived":{"type":"boolean","required":false,"description":"Archive or unarchive the block","location":"body"}},"response_format":"json","category":"Page Creation & Editing"} */
  async updateBlock(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'update_block',
      method: 'PATCH',
      path: '/blocks/{block_id}',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/blocks/{block_id}';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/blocks/{block_id}', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting update_block request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.patch(requestPath, hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined), { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed update_block request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'update_block',
        method: 'PATCH',
        path: '/blocks/{block_id}',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'update_block',
          method: 'PATCH',
          path: '/blocks/{block_id}',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'update_block',
        method: 'PATCH',
        path: '/blocks/{block_id}',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute update_block: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"delete_block","method":"DELETE","path":"/blocks/{block_id}","description":"Delete a block","parameters":{"block_id":{"type":"string","required":true,"description":"Block ID to delete","location":"path"}},"response_format":"json","category":"Block Content"} */
  async deleteBlock(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'delete_block',
      method: 'DELETE',
      path: '/blocks/{block_id}',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/blocks/{block_id}';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/blocks/{block_id}', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting delete_block request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.delete(requestPath, { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed delete_block request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'delete_block',
        method: 'DELETE',
        path: '/blocks/{block_id}',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'delete_block',
          method: 'DELETE',
          path: '/blocks/{block_id}',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'delete_block',
        method: 'DELETE',
        path: '/blocks/{block_id}',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute delete_block: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"list_users","method":"GET","path":"/users","description":"List all users","parameters":{"start_cursor":{"type":"string","required":false,"description":"Pagination cursor","location":"query"},"page_size":{"type":"number","required":false,"description":"Number of results per page (max 100)","location":"query","default":100}},"response_format":"json","category":"Workspace Collaboration"} */
  async listUsers(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'list_users',
      method: 'GET',
      path: '/users',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/users';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/users', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting list_users request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.get(requestPath, { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed list_users request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'list_users',
        method: 'GET',
        path: '/users',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'list_users',
          method: 'GET',
          path: '/users',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'list_users',
        method: 'GET',
        path: '/users',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute list_users: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"get_user","method":"GET","path":"/users/{user_id}","description":"Get user by ID","parameters":{"user_id":{"type":"string","required":true,"description":"User ID to fetch","location":"path"}},"response_format":"json","category":"Workspace Collaboration"} */
  async getUser(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'get_user',
      method: 'GET',
      path: '/users/{user_id}',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/users/{user_id}';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/users/{user_id}', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting get_user request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.get(requestPath, { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed get_user request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'get_user',
        method: 'GET',
        path: '/users/{user_id}',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'get_user',
          method: 'GET',
          path: '/users/{user_id}',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'get_user',
        method: 'GET',
        path: '/users/{user_id}',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute get_user: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"get_me","method":"GET","path":"/users/me","description":"Get current bot user","parameters":{},"response_format":"json","category":"Workspace Collaboration"} */
  async getMe(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'get_me',
      method: 'GET',
      path: '/users/me',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/users/me';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/users/me', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting get_me request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.get(requestPath, { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed get_me request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'get_me',
        method: 'GET',
        path: '/users/me',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'get_me',
          method: 'GET',
          path: '/users/me',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'get_me',
        method: 'GET',
        path: '/users/me',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute get_me: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"search","method":"POST","path":"/search","description":"Search pages and databases","parameters":{"query":{"type":"string","required":false,"description":"Search query string","location":"body"},"sort":{"type":"object","required":false,"description":"Sort configuration","location":"body"},"filter":{"type":"object","required":false,"description":"Filter configuration","location":"body"},"start_cursor":{"type":"string","required":false,"description":"Pagination cursor","location":"body"},"page_size":{"type":"number","required":false,"description":"Number of results per page (max 100)","location":"body","default":100}},"response_format":"json","category":"Page Creation & Editing"} */
  async search(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'search',
      method: 'POST',
      path: '/search',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/search';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/search', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting search request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.post(requestPath, hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined), { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed search request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'search',
        method: 'POST',
        path: '/search',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'search',
          method: 'POST',
          path: '/search',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'search',
        method: 'POST',
        path: '/search',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute search: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"create_comment","method":"POST","path":"/comments","description":"Create a comment on a page or block","parameters":{"parent":{"type":"object","required":true,"description":"Parent object (page or block)","location":"body"},"rich_text":{"type":"array","required":true,"description":"Array of rich text objects for comment content","location":"body"}},"response_format":"json","category":"Page Creation & Editing"} */
  async createComment(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'create_comment',
      method: 'POST',
      path: '/comments',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/comments';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            if (params[""] !== undefined) {
        bodyParams[""] = params[""];
        extractedParams.push("");
      }
            
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/comments', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting create_comment request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.post(requestPath, hasRawArrayBody ? rawBodyData : (Object.keys(bodyParams).length > 0 ? bodyParams : undefined), { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed create_comment request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'create_comment',
        method: 'POST',
        path: '/comments',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'create_comment',
          method: 'POST',
          path: '/comments',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'create_comment',
        method: 'POST',
        path: '/comments',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute create_comment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /* DEBUG: endpoint={"name":"get_comments","method":"GET","path":"/comments","description":"Get comments for a page or block","parameters":{"block_id":{"type":"string","required":true,"description":"Block ID to get comments for","location":"query"},"start_cursor":{"type":"string","required":false,"description":"Pagination cursor","location":"query"},"page_size":{"type":"number","required":false,"description":"Number of results per page (max 100)","location":"query","default":100}},"response_format":"json","category":"Page Creation & Editing"} */
  async getComments(params: any, options?: RequestOptions): Promise<any> {
    const startTime = Date.now();
    this.logger.info('ENDPOINT_START', 'Endpoint execution started', {
      endpoint: 'get_comments',
      method: 'GET',
      path: '/comments',
      paramCount: Object.keys(params || {}).length,
      paramKeys: Object.keys(params || {})
    });
    
    try {
      
      // Extract and separate parameters by location: path, query, body
      const pathTemplate = '/comments';
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const bodyParams: Record<string, any> = {};
      const extractedParams: string[] = [];
      
      // Handle Google-style path templates: {resourceName=people/*} and {person.resourceName=people/*}
      const googlePathTemplateRegex = /{([^}=]+)=[^}]*}/g;
      let match;
      
      while ((match = googlePathTemplateRegex.exec(pathTemplate)) !== null) {
        const paramName = match[1]; // e.g., "resourceName" or "person.resourceName"
        if (paramName && params[paramName] !== undefined) {
          pathParams[paramName] = params[paramName];
          extractedParams.push(paramName);
        }
      }
      
      // Handle standard path templates: {resourceName}
      const standardPathParams = pathTemplate.match(/{([^}=]+)}/g) || [];
      standardPathParams.forEach(paramTemplate => {
        const paramName = paramTemplate.slice(1, -1); // Remove { }
        // Only process if not already handled by Google template logic
        if (!extractedParams.includes(paramName)) {
          if (params[paramName] !== undefined) {
            pathParams[paramName] = params[paramName];
            extractedParams.push(paramName);
          } else {
            // Provide default values for optional path parameters
            if (paramName === 'userId') {
              pathParams[paramName] = 'me'; // Default to authenticated user
              extractedParams.push(paramName);
            }
          }
        }
      });
      
      // Check if any parameter has raw_array flag
      let hasRawArrayBody = false;
      let rawBodyData: any = undefined;
      
      // Separate remaining parameters by location (query vs body)
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      if (params[""] !== undefined) {
        queryParams[""] = params[""];
        extractedParams.push("");
      }
      
      // Any remaining unprocessed parameters default to body for backward compatibility
      for (const [key, value] of Object.entries(params)) {
        if (!extractedParams.includes(key)) {
          bodyParams[key] = value;
        }
      }
      
      // Validate required parameters
      
      const path = this.buildPath('/comments', pathParams);
      // For GraphQL endpoints that use '/' as the path, use empty string to avoid double slash
      const requestPath = path === '/' ? '' : path;
      
      // Report initial progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 0,
          total: 100,
          message: `Starting get_comments request...`
        });
      }
      
      // Use standard HTTP client for other auth types with abort signal
      const requestConfig: any = {};
      if (options?.signal) {
        requestConfig.signal = options.signal;
      }
      
      const response = await this.httpClient.get(requestPath, { params: queryParams, ...requestConfig });
      
      // Report completion progress if callback provided
      if (options?.onProgress) {
        await options.onProgress({
          progress: 100,
          total: 100,
          message: `Completed get_comments request`
        });
      }
      
      const duration = Date.now() - startTime;
      this.logger.info('ENDPOINT_SUCCESS', 'Endpoint execution completed successfully', {
        endpoint: 'get_comments',
        method: 'GET',
        path: '/comments',
        duration_ms: duration,
        responseDataSize: JSON.stringify(response.data).length
      });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Check if error is due to cancellation
      if (axios.isCancel(error)) {
        this.logger.info('REQUEST_CANCELLED', 'Request was cancelled', {
          endpoint: 'get_comments',
          method: 'GET',
          path: '/comments',
          duration_ms: duration
        });
        throw new Error('Request was cancelled');
      }
      
      this.logger.error('ENDPOINT_ERROR', 'Endpoint execution failed', {
        endpoint: 'get_comments',
        method: 'GET',
        path: '/comments',
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      throw new Error(`Failed to execute get_comments: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

}