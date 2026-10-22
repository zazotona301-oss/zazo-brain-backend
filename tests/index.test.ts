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
});
