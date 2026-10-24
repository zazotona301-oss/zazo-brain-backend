import type { KVNamespace } from '@cloudflare/workers-types';

export interface Env {
  AI?: Ai;
  HYPERDRIVE?: HyperdriveBinding;
  ACTIVE_CONTEXT?: KVNamespace;
  ARCHIVE_STORE?: KVNamespace;
  OPENAI_API_KEY?: string;
  CLOUDFLARE_CHAT_MODEL?: string;
  CLOUDFLARE_LORA_ID?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
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
