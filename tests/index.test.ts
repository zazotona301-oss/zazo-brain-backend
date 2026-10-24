import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

describe('public Worker API boundary', () => {
  it('returns public health without bindings or credentials', async () => {
    const response = await app.request('http://localhost/health', {}, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('exposes the API health endpoint without Access credentials', async () => {
    const response = await app.request('http://localhost/api/health', {}, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('returns CORS headers for the React client', async () => {
    const response = await app.request('http://localhost/api/health', {
      headers: { Origin: 'https://zazo-brain-ui.pages.dev' }
    }, {});
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('does not expose unknown paths', async () => {
    const response = await app.request('http://localhost/private', {}, {});
    expect(response.status).toBe(404);
  });

  it('requires the trusted GitHub OIDC workflow before exporting Neon data', async () => {
    const response = await app.request('http://localhost/api/dataset/export', { method: 'POST' }, {});
    expect(response.status).toBe(401);
  });

  it('does not enable LoRA uploads until Cloudflare and Access configuration is present', async () => {
    const response = await app.request('http://localhost/api/admin/lora-upload', { method: 'POST' }, {});
    expect(response.status).toBe(503);
  });

  it('rejects LoRA upload requests with an invalid Cloudflare Access JWT', async () => {
    const response = await app.request('http://localhost/api/admin/lora-upload', {
      method: 'POST',
      headers: { 'Cf-Access-Jwt-Assertion': 'not.a.jwt' },
    }, {
      CLOUDFLARE_ACCOUNT_ID: 'test-account',
      CLOUDFLARE_API_TOKEN: 'test-cloudflare-token',
      CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
      CF_ACCESS_AUD: 'test-audience',
      CF_ACCESS_ADMIN_EMAIL: 'zazotona301@gmail.com',
    });
    expect(response.status).toBe(401);
  });

  it('validates chat requests before attempting inference', async () => {
    const response = await app.request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'not-a-uuid', messages: [] })
    }, {});
    expect(response.status).toBe(400);
  });

  it('does not fall back to third-party chat providers when Workers AI is unavailable', async () => {
    const response = await app.request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: '123e4567-e89b-42d3-a456-426614174000', messages: [{ role: 'user', content: 'مرحباً' }] })
    }, {});
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: 'service_not_configured',
      message: 'Workers AI binding is not configured'
    });
  });
});
