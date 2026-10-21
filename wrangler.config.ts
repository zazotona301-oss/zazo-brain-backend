type WorkerConfig = { name: string; main: string; compatibility_date: string; compatibility_flags: string[]; observability: { enabled: boolean } };

/**
 * Intentionally contains no resource IDs or secrets. Copy wrangler.toml.example
 * to a deployment-specific config after creating the Cloudflare resources.
 */
const config: WorkerConfig = {
  name: 'zazo-brain-backend',
  main: 'src/index.ts',
  compatibility_date: '2026-10-21',
  compatibility_flags: ['nodejs_compat'],
  observability: { enabled: true }
};

export default config;
