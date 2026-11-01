import type { KVNamespace } from '@cloudflare/workers-types';

export interface Env {
  AI?: Ai;
  KNOWLEDGE_01?: D1Database;
  KNOWLEDGE_02?: D1Database;
  KNOWLEDGE_03?: D1Database;
  KNOWLEDGE_04?: D1Database;
  KNOWLEDGE_05?: D1Database;
  KNOWLEDGE_06?: D1Database;
  KNOWLEDGE_07?: D1Database;
  KNOWLEDGE_08?: D1Database;
  KNOWLEDGE_09?: D1Database;
  KNOWLEDGE_10?: D1Database;
  HYPERDRIVE?: HyperdriveBinding;
  ACTIVE_CONTEXT?: KVNamespace;
  ARCHIVE_STORE?: KVNamespace;
  OPENAI_API_KEY?: string;
  CLOUDFLARE_CHAT_MODEL?: string;
  CLOUDFLARE_LORA_ID?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  HF_TOKEN?: string;
  RAQA_API_URL?: string;
  RAQA_API_KEY?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_ADMIN_EMAIL?: string;
}

export interface HyperdriveBinding {
  connectionString: string;
  host?: string;
  user?: string;
  password?: string;
  database?: string;
  port?: number;
}
