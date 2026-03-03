#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'http';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  CancelledNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';
import { config } from 'dotenv';
import { loadConfig, validateConfig } from './config.js';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json');
import { LogShipper } from './services/log-shipper.js';
import { Logger } from './services/logger.js';
import { RequestTracker } from './services/request-tracker.js';
import { ProgressReporter } from './services/progress-reporter.js';

// Load environment variables
config();

// Import tools from each template
import { NotionTools } from './tools/notion-tools.js';
import { NotionClient } from './clients/notion-client.js';

// Import OAuth clients only if OAuth is enabled globally

// Import unified OAuth clients for special cases

class NotionMcpServer {
  private server: Server;
  private logShipper!: LogShipper;
  private logger!: Logger;
  private requestTracker!: RequestTracker;
  private progressReporter!: ProgressReporter;
  
  // Initialize template tools
  private notionTools: NotionTools;
  private notionClient: NotionClient;
  
  // OAuth clients

  constructor() {
    // Initialize logging first
    this.initializeLogging();
    
    this.server = new Server(
      {
        name: 'notion-mcp',
        version: PKG_VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize OAuth clients first

    // Initialize template clients and tools
    // Regular client - pass configuration object
    this.notionClient = new NotionClient({
      authToken: process.env.NOTION_ACCESS_TOKEN,
      version: PKG_VERSION,
      logger: this.logger
    });
    this.notionTools = new NotionTools(this.notionClient);

    this.setupHandlers();
    this.setupNotificationHandlers();
  }

  private initializeLogging() {
    const config = loadConfig();
    const validation = validateConfig(config);
    
    if (!validation.isValid) {
      console.error('Configuration validation failed:', validation.errors);
      process.exit(1);
    }
    
    this.logShipper = new LogShipper(config.logShipping);
    this.logger = new Logger({
      logLevel: config.logShipping.logLevel,
      component: 'server',
      enableConsole: true,
      enableShipping: config.logShipping.enabled,
      serverName: 'notion-mcp',
      logShipper: this.logShipper
    });
    
    this.logger.info('SERVER_INIT', 'MCP server initializing', {
      serverName: 'notion-mcp',
      logShippingEnabled: config.logShipping.enabled,
      logLevel: config.logShipping.logLevel
    });
    
    // Initialize request tracking and progress reporting
    this.requestTracker = new RequestTracker(this.logger);
    this.progressReporter = new ProgressReporter(
      this.server,
      this.logger,
      this.requestTracker
    );
    
    // Set up periodic cleanup
    setInterval(() => {
      this.requestTracker.cleanupStaleRequests();
      this.progressReporter.cleanupCompletedRequests();
    }, 60000);
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = [];
      
      // Add notion tools
      tools.push(...this.notionTools.getToolDefinitions());

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name, arguments: args = {} } = request.params;
      const requestId = extra.requestId ?? `fallback-${Date.now()}`;
      const progressToken = request.params._meta?.progressToken;
      
      // Register request for tracking
      const context = this.requestTracker.registerRequest(
        requestId,
        progressToken,
        name
      );

      try {
        // Handle notion tools
        if (this.notionTools.canHandle(name)) {
          return await this.notionTools.executeTool(name, args, context, this.progressReporter);
        }

        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
      } catch (error) {
        // Check if error is due to cancellation
        if (context.abortController.signal.aborted) {
          this.logger.info('REQUEST_ABORTED', 'Request was cancelled', {
            requestId,
            toolName: name,
            reason: context.abortController.signal.reason
          });
          throw new McpError(
            ErrorCode.InternalError,
            'Request was cancelled'
          );
        }
        
        if (error instanceof McpError) {
          throw error;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        // Clean up request tracking
        this.requestTracker.cleanup(requestId);
      }
    });
  }

  private setupNotificationHandlers() {
    // Handle cancellation notifications
    this.server.setNotificationHandler(CancelledNotificationSchema, async (notification) => {
      const { requestId, reason } = notification.params;
      
      this.logger.info('CANCELLATION_RECEIVED', 'Received cancellation notification', {
        requestId,
        reason
      });
      
      // Cancel the request
      if (!requestId) {
        this.logger.debug('CANCELLATION_IGNORED', 'No requestId in cancellation notification');
        return;
      }
      const cancelled = this.requestTracker.cancelRequest(requestId, reason);
      
      if (!cancelled) {
        this.logger.debug('CANCELLATION_IGNORED', 'Cancellation ignored - request not found or already completed', {
          requestId
        });
      }
    });
  }

  private async runStdio() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    this.logger.info('SERVER_START', 'MCP server started successfully', {
      serverName: 'notion-mcp',
      transport: 'stdio'
    });

    console.error('notion-mcp MCP server running on stdio');
  }

  private async runHttp() {
    const port = parseInt(process.env.PORT || '3000', 10);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });

    await this.server.connect(transport);

    const httpServer = createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
      res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', server: 'notion-mcp' }));
        return;
      }

      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON in request body' }));
          return;
        }
        await transport.handleRequest(req, res, body);
        return;
      }

      await transport.handleRequest(req, res);
    });

    httpServer.listen(port, () => {
      this.logger.info('SERVER_START', 'MCP server started successfully', {
        serverName: 'notion-mcp',
        transport: 'http',
        port
      });
      console.error(`notion-mcp MCP server running on http://localhost:${port}`);
    });
  }

  async run() {
    const transportMode = process.env.TRANSPORT_MODE || 'stdio';

    if (transportMode === 'http') {
      await this.runHttp();
    } else {
      await this.runStdio();
    }

    // Handle graceful shutdown for log shipping
    const shutdown = async () => {
      this.logger.info('SERVER_SHUTDOWN', 'MCP server shutting down', {
        serverName: 'notion-mcp'
      });

      // Shutdown request tracking and progress reporting
      if (this.requestTracker) {
        this.requestTracker.shutdown();
      }
      if (this.progressReporter) {
        this.progressReporter.shutdown();
      }

      // Shutdown logging
      if (this.logShipper) {
        await this.logShipper.shutdown();
      }

      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

const server = new NotionMcpServer();
server.run().catch(console.error);