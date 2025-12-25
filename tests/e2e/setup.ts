// E2E Test Setup
// Note: Since E2E tests spawn the server as a separate process,
// HTTP mocking (nock) won't work across process boundaries.
// Tests focus on MCP protocol compliance rather than API success.

// Increase timeout for process-based tests
jest.setTimeout(30000);

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
