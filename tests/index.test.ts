import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

describe('public health and protected API boundary', () => {
  it('returns public health without bindings or credentials', async () => {
    const response = await app.request('http://localhost/health', {}, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('fails closed when Access is not configured', async () => {
    const response = await app.request('http://localhost/api/worlds', {}, {});
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'service_not_configured' });
  });

  it('does not expose unknown paths', async () => {
    const response = await app.request('http://localhost/private', {}, {});
    expect(response.status).toBe(404);
  });
});
