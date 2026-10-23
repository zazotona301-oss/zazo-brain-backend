import { z } from 'zod';

export const idSchema = z.string().uuid();
const textField = z.string().min(1).max(100_000);
const contextField = z.string().max(100_000).default('');
const responseField = z.string().max(100_000).default('');

export const worldSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
  description: z.string().max(5000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});
export const roomSchema = z.object({
  worldId: idSchema,
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
  description: z.string().max(5000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});
export const memorySchema = z.object({
  id: idSchema.optional(),
  worldId: idSchema.optional(),
  roomId: idSchema.optional(),
  instruction: textField,
  context: contextField,
  response: responseField,
  metadata: z.record(z.string(), z.unknown()).optional(),
  embedding: z.array(z.number().finite()).length(1536).optional()
});
export const conversationSchema = z.object({
  id: idSchema.optional(),
  worldId: idSchema.optional(),
  roomId: idSchema.optional(),
  title: z.string().max(300).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});
export const messageSchema = z.object({
  id: idSchema.optional(),
  conversationId: idSchema,
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: textField,
  metadata: z.record(z.string(), z.unknown()).optional()
});
export const chatRequestSchema = z.object({
  conversationId: idSchema,
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(20_000)
  })).min(1).max(40)
});
export const activeContextSchema = z.object({
  value: z.unknown(),
  ttlSeconds: z.number().int().positive().max(31_536_000).optional()
});

export async function jsonBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const body: unknown = await request.json();
  return schema.parse(body);
}
