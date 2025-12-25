import { McpTestClient } from './helpers/mcp-client';

describe('Request Cancellation', () => {
  let client: McpTestClient;

  beforeEach(async () => {
    client = new McpTestClient();
    await client.start();
  });

  afterEach(async () => {
    await client.stop();
  });

  describe('cancellation notifications', () => {
    it('can send cancellation for a request', () => {
      // Send a cancellation notification - should not throw
      expect(() => {
        client.sendCancellation('request-123', 'User cancelled');
      }).not.toThrow();
    });

    it('can send cancellation without reason', () => {
      expect(() => {
        client.sendCancellation('request-456');
      }).not.toThrow();
    });
  });

  describe('notification handling', () => {
    it('can filter notifications by method', async () => {
      client.clearNotifications();

      const notifications = client.getNotifications('notifications/progress');
      expect(Array.isArray(notifications)).toBe(true);
    });

    it('can clear notifications', () => {
      client.clearNotifications();
      const notifications = client.getNotifications();
      expect(notifications).toHaveLength(0);
    });
  });
});
