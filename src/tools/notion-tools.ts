import { NotionClient } from '../clients/notion-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '../services/logger.js';
import { RequestContext } from '../services/request-tracker.js';
import { ProgressReporter } from '../services/progress-reporter.js';

export interface NotionToolsConfig {
  nOTIONACCESSTOKEN?: string;
  authToken?: string;
  logger?: Logger;
}

export class NotionTools {
  private client: NotionClient;
  private initialized = false;
  private logger: Logger;

  constructor(client: NotionClient) {
    this.client = client;
    
    // Get logger from client if available, otherwise create fallback
    this.logger = (client as any).logger || new Logger(
      {
        logLevel: 'ERROR',
        component: 'tools',
        enableConsole: true,
        enableShipping: false,
        serverName: ''
      }
    );
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      // Log tools initialization now that client is ready
      this.logger.info('TOOLS_INIT', 'Tools instance initialization started', { 
        integration: 'notion',
        isOAuth: false
      });
      
      this.logger.info('CLIENT_INITIALIZATION', 'Starting client initialization', {
        isOAuth: false
      });
      
      
      this.initialized = true;
      this.logger.info('CLIENT_INITIALIZATION', 'Client initialization completed', {
        initialized: this.initialized
      });
    }
  }

  getToolDefinitions(): Tool[] {
    return [
      {
        name: 'notion_list_databases',
        description: '⚠️ DEPRECATED: This endpoint is deprecated by Notion API. Use the search endpoint with database filter instead.',
        inputSchema: {
          type: 'object',
          properties: {
            start_cursor: {
              type: 'string',
              description: 'Pagination cursor'
            },
            page_size: {
              type: 'number',
              description: 'Number of results per page (max 100)'
            }
          },
          required: []
        }
      },
      {
        name: 'notion_get_database',
        description: 'Get database by ID',
        inputSchema: {
          type: 'object',
          properties: {
            database_id: {
              type: 'string',
              description: 'Database ID to fetch'
            }
          },
          required: ['database_id']
        }
      },
      {
        name: 'notion_query_database',
        description: 'Query database pages',
        inputSchema: {
          type: 'object',
          properties: {
            database_id: {
              type: 'string',
              description: 'Database ID to query'
            },
            filter: {
              type: 'object',
              description: 'Filter object to apply'
            },
            sorts: {
              type: 'array',
              description: 'Array of sort objects'
            },
            start_cursor: {
              type: 'string',
              description: 'Pagination cursor'
            },
            page_size: {
              type: 'number',
              description: 'Number of results per page (max 100)'
            }
          },
          required: ['database_id']
        }
      },
      {
        name: 'notion_create_database',
        description: 'Create a new database',
        inputSchema: {
          type: 'object',
          properties: {
            parent: {
              type: 'object',
              description: 'Parent page object'
            },
            title: {
              type: 'array',
              description: 'Array of rich text objects for title'
            },
            properties: {
              type: 'object',
              description: 'Database properties schema'
            },
            icon: {
              type: 'object',
              description: 'Database icon object'
            },
            cover: {
              type: 'object',
              description: 'Database cover object'
            }
          },
          required: ['parent','title','properties']
        }
      },
      {
        name: 'notion_update_database',
        description: 'Update database properties',
        inputSchema: {
          type: 'object',
          properties: {
            database_id: {
              type: 'string',
              description: 'Database ID to update'
            },
            title: {
              type: 'array',
              description: 'Array of rich text objects for title'
            },
            properties: {
              type: 'object',
              description: 'Database properties to update'
            },
            icon: {
              type: 'object',
              description: 'Database icon object'
            },
            cover: {
              type: 'object',
              description: 'Database cover object'
            }
          },
          required: ['database_id']
        }
      },
      {
        name: 'notion_get_page',
        description: 'Get page by ID',
        inputSchema: {
          type: 'object',
          properties: {
            page_id: {
              type: 'string',
              description: 'Page ID to fetch'
            }
          },
          required: ['page_id']
        }
      },
      {
        name: 'notion_create_page',
        description: 'Create a new page. Note: Creating pages directly in workspace root requires special permissions - use database or page parents instead.',
        inputSchema: {
          type: 'object',
          properties: {
            parent: {
              type: 'object',
              description: 'Parent object (database or page)'
            },
            properties: {
              type: 'object',
              description: 'Page properties (required for database pages)'
            },
            children: {
              type: 'array',
              description: 'Array of block objects for page content'
            },
            icon: {
              type: 'object',
              description: 'Page icon object'
            },
            cover: {
              type: 'object',
              description: 'Page cover object'
            }
          },
          required: ['parent']
        }
      },
      {
        name: 'notion_update_page',
        description: 'Update page properties',
        inputSchema: {
          type: 'object',
          properties: {
            page_id: {
              type: 'string',
              description: 'Page ID to update'
            },
            properties: {
              type: 'object',
              description: 'Page properties to update'
            },
            archived: {
              type: 'boolean',
              description: 'Archive or unarchive the page'
            },
            icon: {
              type: 'object',
              description: 'Page icon object'
            },
            cover: {
              type: 'object',
              description: 'Page cover object'
            }
          },
          required: ['page_id']
        }
      },
      {
        name: 'notion_get_page_property',
        description: 'Get page property by ID',
        inputSchema: {
          type: 'object',
          properties: {
            page_id: {
              type: 'string',
              description: 'Page ID containing the property'
            },
            property_id: {
              type: 'string',
              description: 'Property ID to fetch'
            },
            start_cursor: {
              type: 'string',
              description: 'Pagination cursor'
            },
            page_size: {
              type: 'number',
              description: 'Number of results per page (max 100)'
            }
          },
          required: ['page_id','property_id']
        }
      },
      {
        name: 'notion_get_block_children',
        description: 'Get block children',
        inputSchema: {
          type: 'object',
          properties: {
            block_id: {
              type: 'string',
              description: 'Block ID to get children for'
            },
            start_cursor: {
              type: 'string',
              description: 'Pagination cursor'
            },
            page_size: {
              type: 'number',
              description: 'Number of results per page (max 100)'
            }
          },
          required: ['block_id']
        }
      },
      {
        name: 'notion_append_block_children',
        description: 'Append blocks to a parent block',
        inputSchema: {
          type: 'object',
          properties: {
            block_id: {
              type: 'string',
              description: 'Parent block ID'
            },
            children: {
              type: 'array',
              description: 'Array of block objects to append'
            }
          },
          required: ['block_id','children']
        }
      },
      {
        name: 'notion_get_block',
        description: 'Get block by ID',
        inputSchema: {
          type: 'object',
          properties: {
            block_id: {
              type: 'string',
              description: 'Block ID to fetch'
            }
          },
          required: ['block_id']
        }
      },
      {
        name: 'notion_update_block',
        description: 'Update block content',
        inputSchema: {
          type: 'object',
          properties: {
            block_id: {
              type: 'string',
              description: 'Block ID to update'
            },
            paragraph: {
              type: 'object',
              description: 'Updated paragraph block content'
            },
            heading_1: {
              type: 'object',
              description: 'Updated heading 1 block content'
            },
            heading_2: {
              type: 'object',
              description: 'Updated heading 2 block content'
            },
            heading_3: {
              type: 'object',
              description: 'Updated heading 3 block content'
            },
            bulleted_list_item: {
              type: 'object',
              description: 'Updated bulleted list item content'
            },
            numbered_list_item: {
              type: 'object',
              description: 'Updated numbered list item content'
            },
            to_do: {
              type: 'object',
              description: 'Updated to-do block content'
            },
            toggle: {
              type: 'object',
              description: 'Updated toggle block content'
            },
            code: {
              type: 'object',
              description: 'Updated code block content'
            },
            embed: {
              type: 'object',
              description: 'Updated embed block content'
            },
            image: {
              type: 'object',
              description: 'Updated image block content'
            },
            video: {
              type: 'object',
              description: 'Updated video block content'
            },
            file: {
              type: 'object',
              description: 'Updated file block content'
            },
            pdf: {
              type: 'object',
              description: 'Updated PDF block content'
            },
            bookmark: {
              type: 'object',
              description: 'Updated bookmark block content'
            },
            callout: {
              type: 'object',
              description: 'Updated callout block content'
            },
            quote: {
              type: 'object',
              description: 'Updated quote block content'
            },
            equation: {
              type: 'object',
              description: 'Updated equation block content'
            },
            divider: {
              type: 'object',
              description: 'Updated divider block content'
            },
            table_of_contents: {
              type: 'object',
              description: 'Updated table of contents block content'
            },
            column: {
              type: 'object',
              description: 'Updated column block content'
            },
            column_list: {
              type: 'object',
              description: 'Updated column list block content'
            },
            link_preview: {
              type: 'object',
              description: 'Updated link preview block content'
            },
            synced_block: {
              type: 'object',
              description: 'Updated synced block content'
            },
            table: {
              type: 'object',
              description: 'Updated table block content'
            },
            table_row: {
              type: 'object',
              description: 'Updated table row block content'
            },
            archived: {
              type: 'boolean',
              description: 'Archive or unarchive the block'
            }
          },
          required: ['block_id']
        }
      },
      {
        name: 'notion_delete_block',
        description: 'Delete a block',
        inputSchema: {
          type: 'object',
          properties: {
            block_id: {
              type: 'string',
              description: 'Block ID to delete'
            }
          },
          required: ['block_id']
        }
      },
      {
        name: 'notion_list_users',
        description: 'List all users',
        inputSchema: {
          type: 'object',
          properties: {
            start_cursor: {
              type: 'string',
              description: 'Pagination cursor'
            },
            page_size: {
              type: 'number',
              description: 'Number of results per page (max 100)'
            }
          },
          required: []
        }
      },
      {
        name: 'notion_get_user',
        description: 'Get user by ID',
        inputSchema: {
          type: 'object',
          properties: {
            user_id: {
              type: 'string',
              description: 'User ID to fetch'
            }
          },
          required: ['user_id']
        }
      },
      {
        name: 'notion_get_me',
        description: 'Get current bot user',
        inputSchema: {
          type: 'object',
          properties: {
          },
          required: []
        }
      },
      {
        name: 'notion_search',
        description: 'Search pages and databases',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query string'
            },
            sort: {
              type: 'object',
              description: 'Sort configuration'
            },
            filter: {
              type: 'object',
              description: 'Filter configuration'
            },
            start_cursor: {
              type: 'string',
              description: 'Pagination cursor'
            },
            page_size: {
              type: 'number',
              description: 'Number of results per page (max 100)'
            }
          },
          required: []
        }
      },
      {
        name: 'notion_create_comment',
        description: 'Create a comment on a page or block',
        inputSchema: {
          type: 'object',
          properties: {
            parent: {
              type: 'object',
              description: 'Parent object (page or block)'
            },
            rich_text: {
              type: 'array',
              description: 'Array of rich text objects for comment content'
            }
          },
          required: ['parent','rich_text']
        }
      },
      {
        name: 'notion_get_comments',
        description: 'Get comments for a page or block',
        inputSchema: {
          type: 'object',
          properties: {
            block_id: {
              type: 'string',
              description: 'Block ID to get comments for'
            },
            start_cursor: {
              type: 'string',
              description: 'Pagination cursor'
            },
            page_size: {
              type: 'number',
              description: 'Number of results per page (max 100)'
            }
          },
          required: ['block_id']
        }
      }
    ];
  }

  canHandle(toolName: string): boolean {
    const supportedTools: string[] = [
      'notion_list_databases',
      'notion_get_database',
      'notion_query_database',
      'notion_create_database',
      'notion_update_database',
      'notion_get_page',
      'notion_create_page',
      'notion_update_page',
      'notion_get_page_property',
      'notion_get_block_children',
      'notion_append_block_children',
      'notion_get_block',
      'notion_update_block',
      'notion_delete_block',
      'notion_list_users',
      'notion_get_user',
      'notion_get_me',
      'notion_search',
      'notion_create_comment',
      'notion_get_comments'
    ];
    return supportedTools.includes(toolName);
  }

  async executeTool(name: string, args: any, context?: RequestContext, progressReporter?: ProgressReporter): Promise<any> {
    const startTime = Date.now();
    
    this.logger.logToolStart(name, args);
    
    // Check for early cancellation
    if (context?.abortController.signal.aborted) {
      this.logger.info('TOOL_CANCELLED_EARLY', 'Tool execution cancelled before start', {
        tool: name,
        requestId: context.requestId
      });
      throw new Error('Request was cancelled');
    }
    
    await this.ensureInitialized();
    
    // Validate tool is supported
    if (!this.canHandle(name)) {
      this.logger.error('TOOL_ERROR', 'Unknown tool requested', {
        tool: name,
        supportedTools: ['notion_list_databases', 'notion_get_database', 'notion_query_database', 'notion_create_database', 'notion_update_database', 'notion_get_page', 'notion_create_page', 'notion_update_page', 'notion_get_page_property', 'notion_get_block_children', 'notion_append_block_children', 'notion_get_block', 'notion_update_block', 'notion_delete_block', 'notion_list_users', 'notion_get_user', 'notion_get_me', 'notion_search', 'notion_create_comment', 'notion_get_comments']
      });
      throw new Error(`Unknown tool: ${name}`);
    }
    
    // Validate required parameters
    this.logger.debug('PARAM_VALIDATION', 'Validating tool parameters', {
      tool: name,
      providedArgs: Object.keys(args || {})
    });
    
    try {
      let result;
      
      // Create request options with cancellation and progress support
      const requestOptions = {
        signal: context?.abortController.signal,
        onProgress: context?.progressToken && progressReporter ? 
          progressReporter.createProgressCallback(context.progressToken) : 
          undefined
      };
      
      switch (name) {
        case 'notion_list_databases':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_list_databases',
            clientMethod: 'listDatabases',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting list_databases operation...`
            });
          }
          
          result = await this.client.listDatabases(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed list_databases operation`
            });
          }
          break;
        case 'notion_get_database':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_get_database',
            clientMethod: 'getDatabase',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting get_database operation...`
            });
          }
          
          result = await this.client.getDatabase(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed get_database operation`
            });
          }
          break;
        case 'notion_query_database':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_query_database',
            clientMethod: 'queryDatabase',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting query_database operation...`
            });
          }
          
          result = await this.client.queryDatabase(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed query_database operation`
            });
          }
          break;
        case 'notion_create_database':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_create_database',
            clientMethod: 'createDatabase',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting create_database operation...`
            });
          }
          
          result = await this.client.createDatabase(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed create_database operation`
            });
          }
          break;
        case 'notion_update_database':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_update_database',
            clientMethod: 'updateDatabase',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting update_database operation...`
            });
          }
          
          result = await this.client.updateDatabase(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed update_database operation`
            });
          }
          break;
        case 'notion_get_page':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_get_page',
            clientMethod: 'getPage',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting get_page operation...`
            });
          }
          
          result = await this.client.getPage(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed get_page operation`
            });
          }
          break;
        case 'notion_create_page':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_create_page',
            clientMethod: 'createPage',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting create_page operation...`
            });
          }
          
          result = await this.client.createPage(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed create_page operation`
            });
          }
          break;
        case 'notion_update_page':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_update_page',
            clientMethod: 'updatePage',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting update_page operation...`
            });
          }
          
          result = await this.client.updatePage(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed update_page operation`
            });
          }
          break;
        case 'notion_get_page_property':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_get_page_property',
            clientMethod: 'getPageProperty',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting get_page_property operation...`
            });
          }
          
          result = await this.client.getPageProperty(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed get_page_property operation`
            });
          }
          break;
        case 'notion_get_block_children':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_get_block_children',
            clientMethod: 'getBlockChildren',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting get_block_children operation...`
            });
          }
          
          result = await this.client.getBlockChildren(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed get_block_children operation`
            });
          }
          break;
        case 'notion_append_block_children':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_append_block_children',
            clientMethod: 'appendBlockChildren',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting append_block_children operation...`
            });
          }
          
          result = await this.client.appendBlockChildren(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed append_block_children operation`
            });
          }
          break;
        case 'notion_get_block':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_get_block',
            clientMethod: 'getBlock',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting get_block operation...`
            });
          }
          
          result = await this.client.getBlock(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed get_block operation`
            });
          }
          break;
        case 'notion_update_block':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_update_block',
            clientMethod: 'updateBlock',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting update_block operation...`
            });
          }
          
          result = await this.client.updateBlock(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed update_block operation`
            });
          }
          break;
        case 'notion_delete_block':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_delete_block',
            clientMethod: 'deleteBlock',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting delete_block operation...`
            });
          }
          
          result = await this.client.deleteBlock(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed delete_block operation`
            });
          }
          break;
        case 'notion_list_users':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_list_users',
            clientMethod: 'listUsers',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting list_users operation...`
            });
          }
          
          result = await this.client.listUsers(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed list_users operation`
            });
          }
          break;
        case 'notion_get_user':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_get_user',
            clientMethod: 'getUser',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting get_user operation...`
            });
          }
          
          result = await this.client.getUser(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed get_user operation`
            });
          }
          break;
        case 'notion_get_me':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_get_me',
            clientMethod: 'getMe',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting get_me operation...`
            });
          }
          
          result = await this.client.getMe(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed get_me operation`
            });
          }
          break;
        case 'notion_search':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_search',
            clientMethod: 'search',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting search operation...`
            });
          }
          
          result = await this.client.search(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed search operation`
            });
          }
          break;
        case 'notion_create_comment':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_create_comment',
            clientMethod: 'createComment',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting create_comment operation...`
            });
          }
          
          result = await this.client.createComment(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed create_comment operation`
            });
          }
          break;
        case 'notion_get_comments':
          this.logger.debug('TOOL_EXECUTE', 'Calling client method', {
            tool: 'notion_get_comments',
            clientMethod: 'getComments',
            hasAbortSignal: !!requestOptions.signal,
            hasProgressCallback: !!requestOptions.onProgress
          });
          
          // Report initial progress
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 0,
              total: 100,
              message: `Starting get_comments operation...`
            });
          }
          
          result = await this.client.getComments(args, requestOptions);
          
          // Report completion
          if (context?.progressToken && progressReporter) {
            await progressReporter.report(context.progressToken, {
              progress: 100,
              total: 100,
              message: `Completed get_comments operation`
            });
          }
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      const duration = Date.now() - startTime;
      this.logger.logToolSuccess(name, duration, result);

      // Return raw result for non-OAuth templates
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if error is due to cancellation
      const isCancelled = context?.abortController.signal.aborted || 
                         (error instanceof Error && error.message === 'Request was cancelled');
      
      if (isCancelled) {
        this.logger.info('TOOL_CANCELLED', 'Tool execution cancelled', {
          tool: name,
          duration_ms: duration,
          requestId: context?.requestId
        });
      } else {
        this.logger.logToolError(name, error, duration, args);
      }
      throw error;
    }
  }
}