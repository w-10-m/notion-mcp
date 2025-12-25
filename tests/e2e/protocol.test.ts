import { McpTestClient } from './helpers/mcp-client';

describe('JSON-RPC Protocol', () => {
  let client: McpTestClient;

  beforeEach(async () => {
    client = new McpTestClient();
    await client.start();
  });

  afterEach(async () => {
    await client.stop();
  });

  describe('request/response', () => {
    it('returns tools/list with all tools', async () => {
      const tools = await client.listTools();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('returns error for unknown method', async () => {
      await expect(
        client.request('unknown/method')
      ).rejects.toThrow();
    });

    it('includes all expected Notion tools', async () => {
      const tools = await client.listTools();
      const toolNames = tools.map(t => t.name);

      const expectedTools = [
        'notion_append_block_children',
        'notion_create_comment',
        'notion_create_database',
        'notion_create_page',
        'notion_delete_block',
        'notion_get_block',
        'notion_get_block_children',
        'notion_get_comments',
        'notion_get_database',
        'notion_get_me',
        'notion_get_page',
        'notion_get_page_property',
        'notion_get_user',
        'notion_list_databases',
        'notion_list_users',
        'notion_query_database',
        'notion_search',
        'notion_update_block',
        'notion_update_database',
        'notion_update_page'
      ];

      for (const tool of expectedTools) {
        expect(toolNames).toContain(tool);
      }
    });
  });

  describe('error handling', () => {
    it('returns error for missing required parameters', async () => {
      await expect(
        client.callTool('notion_create_page', {})
      ).rejects.toThrow();
    });

    it('returns error for non-existent tool', async () => {
      await expect(
        client.callTool('non_existent_tool', {})
      ).rejects.toThrow();
    });

    it('returns API error when credentials are invalid', async () => {
      await expect(
        client.callTool('notion_get_me', {})
      ).rejects.toThrow();
    });
  });

  describe('notifications', () => {
    it('can send notifications', () => {
      expect(() => {
        client.sendNotification('notifications/initialized', {});
      }).not.toThrow();
    });

    it('can send cancellation notification', () => {
      expect(() => {
        client.sendCancellation('request-123', 'User cancelled');
      }).not.toThrow();
    });
  });

  describe('tool schema validation', () => {
    it('each tool has required schema properties', async () => {
      const tools = await client.listTools();

      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.name).toBe('string');
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe('string');
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });

    it('notion_create_page has a valid input schema', async () => {
      const tools = await client.listTools();
      const createPageTool = tools.find(t => t.name === 'notion_create_page');

      expect(createPageTool).toBeDefined();
      expect(createPageTool!.inputSchema).toBeDefined();
      expect(createPageTool!.inputSchema.type).toBe('object');
      expect(createPageTool!.inputSchema.properties).toBeDefined();
    });
  });
});
