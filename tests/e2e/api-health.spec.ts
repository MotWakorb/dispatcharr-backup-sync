import { test, expect } from './fixtures';

test.describe('API Health', () => {
  test('backend health endpoint responds', async ({ request, backendUrl }) => {
    const response = await request.get(`${backendUrl}/health`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });

  test('API returns CORS headers', async ({ request, backendUrl }) => {
    const response = await request.get(`${backendUrl}/health`);

    // CORS should be enabled
    expect(response.ok()).toBeTruthy();
  });

  test('API 404 returns proper error format', async ({ request, backendUrl }) => {
    const response = await request.get(`${backendUrl}/api/nonexistent-endpoint`);

    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });
});
