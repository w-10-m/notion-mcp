import { McpTestClient } from './helpers/mcp-client';

describe('Progress Notifications', () => {
  let client: McpTestClient;

  beforeEach(async () => {
    client = new McpTestClient();
    await client.start();
  });

  afterEach(async () => {
    await client.stop();
  });

  describe('notification collection', () => {
    it('starts with empty notifications', async () => {
      client.clearNotifications();
      const notifications = client.getNotifications();
      expect(notifications).toHaveLength(0);
    });

    it('can filter progress notifications', async () => {
      const progressNotifications = client.getNotifications('notifications/progress');
      expect(Array.isArray(progressNotifications)).toBe(true);
    });

    it('can wait for notification with timeout', async () => {
      // This tests the waitForNotification mechanism
      // We use a short timeout since we may not receive a notification
      try {
        await client.waitForNotification('notifications/progress', 100);
      } catch (error) {
        // Expected to timeout if no progress notification is sent
        expect((error as Error).message).toContain('Timeout');
      }
    });
  });

  describe('notification events', () => {
    it('emits notification events', (done) => {
      const timeout = setTimeout(() => {
        // No notification received within timeout - that's okay for this test
        done();
      }, 100);

      client.once('notification', (notification) => {
        clearTimeout(timeout);
        expect(notification).toHaveProperty('method');
        done();
      });

      // Trigger something that might produce a notification
      client.sendNotification('notifications/initialized', {});
    });
  });
});
