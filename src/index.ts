import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import type { Env } from './env';
import { ConfigurationError, query } from './db';
import { ARCHIVE_TTL_SECONDS, exportDataset } from './export';
import { activeContextSchema, conversationSchema, idSchema, jsonBody, memorySchema, messageSchema, roomSchema, worldSchema } from './validation';

type AppEnv = { Bindings: Env };
const app = new Hono<AppEnv>();
app.use('*', cors({ origin: '*', allowHeaders: ['Content-Type'], allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
const jsonObject = (value: Record<string, unknown> | undefined): string => JSON.stringify(value ?? {});
const limitFrom = (c: Context<AppEnv>): number => Math.min(Math.max(Number(c.req.query('limit') ?? '50') || 50, 1), 10_000);
const parseId = (value: string): string => idSchema.parse(value);

app.get('/', (c) => c.json({ service: 'zazo-brain-backend', status: 'ok', storage: { neon: Boolean(c.env.HYPERDRIVE), kv: Boolean(c.env.ACTIVE_CONTEXT && c.env.ARCHIVE_STORE) } }));
app.get('/health', (c) => c.json({ status: 'ok', service: 'zazo-brain-backend', time: new Date().toISOString() }));
app.get('/api/health', (c) => c.json({ status: 'ok', storage: { neon: Boolean(c.env.HYPERDRIVE), kv: Boolean(c.env.ACTIVE_CONTEXT && c.env.ARCHIVE_STORE) } }));

app.post('/api/transcribe', async (c) => {
  if (!c.env.OPENAI_API_KEY) return c.json({ error: 'service_not_configured', message: 'Audio transcription is not configured on this Worker' }, 503);
  const form = await c.req.raw.formData();
  const incoming = form.get('file');
  if (!incoming || typeof incoming !== 'object' || !('arrayBuffer' in incoming)) return c.json({ error: 'validation_error', message: 'file is required' }, 400);
  const file = incoming as File;
  if (file.size > 25 * 1024 * 1024) return c.json({ error: 'file_too_large', message: 'Audio files must be smaller than 25 MB' }, 413);
  const requestForm = new FormData();
  requestForm.append('file', file, file.name || 'audio.webm');
  requestForm.append('model', 'whisper-1');
  const language = form.get('language');
  if (typeof language === 'string' && language) requestForm.append('language', language.slice(0, 10));
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.env.OPENAI_API_KEY}` },
    body: requestForm
  });
  const payload = await response.json().catch(() => ({})) as { text?: unknown };
  if (!response.ok) return c.json({ error: 'transcription_failed', message: 'The transcription provider rejected the file' }, 502);
  return c.json({ text: typeof payload.text === 'string' ? payload.text : '', provider: 'openai-whisper' });
});

app.get('/api/worlds', async (c) => c.json(await query(c.env, 'SELECT * FROM worlds ORDER BY created_at DESC LIMIT $1', [limitFrom(c)])));
app.post('/api/worlds', async (c) => {
  const data = await jsonBody(c.req.raw, worldSchema);
  const rows = await query(c.env, 'INSERT INTO worlds (name, slug, description, metadata) VALUES ($1,$2,$3,$4::jsonb) RETURNING *', [data.name, data.slug, data.description ?? null, jsonObject(data.metadata)]);
  return c.json(rows[0], 201);
});
app.get('/api/worlds/:id', async (c) => {
  const rows = await query(c.env, 'SELECT * FROM worlds WHERE id = $1', [parseId(c.req.param('id'))]);
  return rows[0] ? c.json(rows[0]) : c.json({ error: 'not_found' }, 404);
});
app.delete('/api/worlds/:id', async (c) => {
  const rows = await query(c.env, 'DELETE FROM worlds WHERE id = $1 RETURNING id', [parseId(c.req.param('id'))]);
  return rows[0] ? c.json({ deleted: rows[0].id }) : c.json({ error: 'not_found' }, 404);
});

app.get('/api/rooms', async (c) => c.json(await query(c.env, 'SELECT * FROM rooms ORDER BY created_at DESC LIMIT $1', [limitFrom(c)])));
app.get('/api/worlds/:worldId/rooms', async (c) => c.json(await query(c.env, 'SELECT * FROM rooms WHERE world_id = $1 ORDER BY created_at DESC LIMIT $2', [parseId(c.req.param('worldId')), limitFrom(c)])));
app.post('/api/rooms', async (c) => {
  const data = await jsonBody(c.req.raw, roomSchema);
  const rows = await query(c.env, 'INSERT INTO rooms (world_id, name, slug, description, metadata) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *', [data.worldId, data.name, data.slug, data.description ?? null, jsonObject(data.metadata)]);
  return c.json(rows[0], 201);
});
app.get('/api/rooms/:id', async (c) => {
  const rows = await query(c.env, 'SELECT * FROM rooms WHERE id = $1', [parseId(c.req.param('id'))]);
  return rows[0] ? c.json(rows[0]) : c.json({ error: 'not_found' }, 404);
});
app.delete('/api/rooms/:id', async (c) => {
  const rows = await query(c.env, 'DELETE FROM rooms WHERE id = $1 RETURNING id', [parseId(c.req.param('id'))]);
  return rows[0] ? c.json({ deleted: rows[0].id }) : c.json({ error: 'not_found' }, 404);
});

app.get('/api/memories', async (c) => c.json(await query(c.env, 'SELECT * FROM memories ORDER BY created_at DESC LIMIT $1', [limitFrom(c)])));
app.post('/api/memories', async (c) => {
  const data = await jsonBody(c.req.raw, memorySchema);
  const worldId = data.worldId ?? null;
  let roomId = data.roomId ?? null;
  if (!worldId && !roomId) {
    const defaults = await query<{ id: string }>(c.env, "SELECT id FROM rooms WHERE slug = 'general' ORDER BY created_at ASC LIMIT 1");
    roomId = defaults[0]?.id ?? null;
    if (!roomId) return c.json({ error: 'configuration_error', message: 'No default room is configured' }, 503);
  }
  const vector = data.embedding ? `[${data.embedding.join(',')}]` : null;
  const rows = data.id
    ? await query(c.env, 'INSERT INTO memories (id, world_id, room_id, instruction, context, response, metadata, embedding) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::vector) ON CONFLICT (id) DO UPDATE SET updated_at = now() RETURNING *', [data.id, worldId, roomId, data.instruction, data.context, data.response, jsonObject(data.metadata), vector])
    : await query(c.env, 'INSERT INTO memories (world_id, room_id, instruction, context, response, metadata, embedding) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::vector) RETURNING *', [worldId, roomId, data.instruction, data.context, data.response, jsonObject(data.metadata), vector]);
  return c.json(rows[0], 201);
});
app.get('/api/memories/:id', async (c) => {
  const rows = await query(c.env, 'SELECT * FROM memories WHERE id = $1', [parseId(c.req.param('id'))]);
  return rows[0] ? c.json(rows[0]) : c.json({ error: 'not_found' }, 404);
});
app.delete('/api/memories/:id', async (c) => {
  const rows = await query(c.env, 'DELETE FROM memories WHERE id = $1 RETURNING id', [parseId(c.req.param('id'))]);
  return rows[0] ? c.json({ deleted: rows[0].id }) : c.json({ error: 'not_found' }, 404);
});

app.get('/api/conversations', async (c) => c.json(await query(c.env, 'SELECT * FROM conversations ORDER BY created_at DESC LIMIT $1', [limitFrom(c)])));
app.post('/api/conversations', async (c) => {
  const data = await jsonBody(c.req.raw, conversationSchema);
  const rows = data.id
    ? await query(c.env, 'INSERT INTO conversations (id, world_id, room_id, title, metadata) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = now() RETURNING *', [data.id, data.worldId ?? null, data.roomId ?? null, data.title ?? null, jsonObject(data.metadata)])
    : await query(c.env, 'INSERT INTO conversations (world_id, room_id, title, metadata) VALUES ($1,$2,$3,$4::jsonb) RETURNING *', [data.worldId ?? null, data.roomId ?? null, data.title ?? null, jsonObject(data.metadata)]);
  return c.json(rows[0], 201);
});
app.put('/api/conversations/:id', async (c) => {
  const data = await jsonBody(c.req.raw, conversationSchema);
  const rows = await query(c.env, 'UPDATE conversations SET title = COALESCE($2, title), metadata = COALESCE($3::jsonb, metadata), updated_at = now() WHERE id = $1 RETURNING *', [parseId(c.req.param('id')), data.title ?? null, data.metadata ? jsonObject(data.metadata) : null]);
  return rows[0] ? c.json(rows[0]) : c.json({ error: 'not_found' }, 404);
});
app.get('/api/conversations/:id', async (c) => {
  const rows = await query(c.env, 'SELECT * FROM conversations WHERE id = $1', [parseId(c.req.param('id'))]);
  return rows[0] ? c.json(rows[0]) : c.json({ error: 'not_found' }, 404);
});
app.delete('/api/conversations/:id', async (c) => {
  const rows = await query(c.env, 'DELETE FROM conversations WHERE id = $1 RETURNING id', [parseId(c.req.param('id'))]);
  return rows[0] ? c.json({ deleted: rows[0].id }) : c.json({ error: 'not_found' }, 404);
});

app.get('/api/messages', async (c) => c.json(await query(c.env, 'SELECT * FROM messages ORDER BY created_at DESC LIMIT $1', [limitFrom(c)])));
app.get('/api/conversations/:conversationId/messages', async (c) => c.json(await query(c.env, 'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT $2', [parseId(c.req.param('conversationId')), limitFrom(c)])));
app.post('/api/messages', async (c) => {
  const data = await jsonBody(c.req.raw, messageSchema);
  const rows = data.id
    ? await query(c.env, 'INSERT INTO messages (id, conversation_id, role, content, metadata) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, metadata = EXCLUDED.metadata RETURNING *', [data.id, data.conversationId, data.role, data.content, jsonObject(data.metadata)])
    : await query(c.env, 'INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1,$2,$3,$4::jsonb) RETURNING *', [data.conversationId, data.role, data.content, jsonObject(data.metadata)]);
  await query(c.env, 'UPDATE conversations SET updated_at = now() WHERE id = $1', [data.conversationId]);
  return c.json(rows[0], 201);
});
app.get('/api/messages/:id', async (c) => {
  const rows = await query(c.env, 'SELECT * FROM messages WHERE id = $1', [parseId(c.req.param('id'))]);
  return rows[0] ? c.json(rows[0]) : c.json({ error: 'not_found' }, 404);
});
app.delete('/api/messages/:id', async (c) => {
  const rows = await query(c.env, 'DELETE FROM messages WHERE id = $1 RETURNING id', [parseId(c.req.param('id'))]);
  return rows[0] ? c.json({ deleted: rows[0].id }) : c.json({ error: 'not_found' }, 404);
});

app.get('/api/search', async (c) => {
  const q = c.req.query('q')?.trim();
  if (!q) return c.json({ error: 'validation_error', message: 'q is required' }, 400);
  const limit = limitFrom(c);
  const memoryText = "instruction || ' ' || context || ' ' || response";
  const memories = await query(c.env, `SELECT id, 'memory' AS type, instruction, context, response, created_at, ts_rank(to_tsvector('simple', ${memoryText}), plainto_tsquery('simple', $1)) AS rank FROM memories WHERE to_tsvector('simple', ${memoryText}) @@ plainto_tsquery('simple', $1) ORDER BY rank DESC, created_at DESC LIMIT $2`, [q, limit]);
  const messages = await query(c.env, `SELECT id, 'message' AS type, content, created_at, ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $1)) AS rank FROM messages WHERE to_tsvector('simple', content) @@ plainto_tsquery('simple', $1) ORDER BY rank DESC, created_at DESC LIMIT $2`, [q, limit]);
  return c.json({ query: q, results: [...memories, ...messages].sort((a, b) => Number(b.rank) - Number(a.rank)).slice(0, limit) });
});

app.get('/api/context/active', async (c) => {
  if (!c.env.ACTIVE_CONTEXT) return c.json({ error: 'service_not_configured', message: 'ACTIVE_CONTEXT binding is not configured' }, 503);
  const value = await c.env.ACTIVE_CONTEXT.get('active-context', 'json');
  return c.json({ value: value ?? null });
});
app.put('/api/context/active', async (c) => {
  if (!c.env.ACTIVE_CONTEXT) return c.json({ error: 'service_not_configured', message: 'ACTIVE_CONTEXT binding is not configured' }, 503);
  const data = await jsonBody(c.req.raw, activeContextSchema);
  await c.env.ACTIVE_CONTEXT.put('active-context', JSON.stringify(data.value), { expirationTtl: data.ttlSeconds ?? ARCHIVE_TTL_SECONDS });
  return c.json({ saved: true, expirationTtl: data.ttlSeconds ?? ARCHIVE_TTL_SECONDS });
});

app.post('/api/dataset/export', async (c) => {
  const result = await exportDataset(c.env, 'manual');
  return c.json(result, 202);
});

app.onError((error, c) => {
  if (error instanceof z.ZodError) return c.json({ error: 'validation_error', issues: error.issues }, 400);
  if (error instanceof ConfigurationError) return c.json({ error: 'service_not_configured', message: error.message }, 503);
  console.error('Unhandled request error', error);
  return c.json({ error: 'internal_error' }, 500);
});
app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      const result = await exportDataset(env, 'scheduled');
      console.log('Scheduled dataset export completed', result);
    } catch (error) {
      console.error('Scheduled dataset export failed', error);
      throw error;
    }
  }
};

export { app };
