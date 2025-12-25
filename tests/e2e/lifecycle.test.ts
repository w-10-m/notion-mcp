import { McpTestClient } from './helpers/mcp-client';

describe('Server Lifecycle', () => {
  let client: McpTestClient;

  beforeEach(() => {
    client = new McpTestClient();
  });

  afterEach(async () => {
    await client.stop();
  });

  describe('startup', () => {
    it('starts and responds to initialize', async () => {
      await client.start();

      expect(client.isRunning()).toBe(true);
    });

    it('starts with custom environment variables', async () => {
      await client.start({
        NOTION_ACCESS_TOKEN: 'custom-test-key',
        LOG_SHIPPING_ENABLED: 'false'
      });

      expect(client.isRunning()).toBe(true);
    });

    it('throws error if started twice', async () => {
      await client.start();

      await expect(client.start()).rejects.toThrow('Server already running');
    });
  });

  describe('shutdown', () => {
    it('stops gracefully', async () => {
      await client.start();
      expect(client.isRunning()).toBe(true);

      await client.stop();
      expect(client.isRunning()).toBe(false);
    });

    it('handles stop when not running', async () => {
      await client.stop();
      expect(client.isRunning()).toBe(false);
    });

    it('emits exit event on shutdown', async () => {
      await client.start();

      const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        client.once('exit', resolve);
      });

      await client.stop();

      const exitInfo = await exitPromise;
      expect(exitInfo).toHaveProperty('code');
      expect(exitInfo).toHaveProperty('signal');
    });
  });

  describe('tools listing', () => {
    it('lists available tools', async () => {
      await client.start();

      const tools = await client.listTools();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);

      const tool = tools[0];
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('inputSchema');
    });

    it('includes expected Notion tools', async () => {
      await client.start();

      const tools = await client.listTools();
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain('notion_create_page');
      expect(toolNames).toContain('notion_get_page');
      expect(toolNames).toContain('notion_search');
    });
  });
});
