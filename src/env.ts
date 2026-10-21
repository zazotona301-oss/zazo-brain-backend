import type { KVNamespace } from '@cloudflare/workers-types';

export interface Env {
  HYPERDRIVE?: HyperdriveBinding;
  ACTIVE_CONTEXT?: KVNamespace;
  ARCHIVE_STORE?: KVNamespace;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
}

export interface HyperdriveBinding {
  connectionString: string;
  host?: string;
  user?: string;
  password?: string;
  database?: string;
  port?: number;
}
