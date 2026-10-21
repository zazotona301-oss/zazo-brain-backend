import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { Env } from './env';
import type { JWTPayload } from 'jose';

type AccessEnv = { Bindings: Env; Variables: { accessClaims: JWTPayload } };

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function teamIssuer(teamDomain: string): string {
  const normalized = teamDomain.trim().replace(/\/$/, '');
  return normalized.startsWith('http') ? normalized : `https://${normalized}`;
}

function audiences(raw: string): string[] {
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function configurationError(env: Env): string | undefined {
  if (!env.CF_ACCESS_TEAM_DOMAIN?.trim() || !env.CF_ACCESS_AUD?.trim()) {
    return 'Cloudflare Access is not configured';
  }
  return undefined;
}

export const accessJwt: MiddlewareHandler<AccessEnv> = async (c, next) => {
  const configError = configurationError(c.env);
  if (configError) return c.json({ error: 'service_not_configured', message: configError }, 503);

  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return c.json({ error: 'unauthorized' }, 401);
  const token = header.slice('Bearer '.length).trim();
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  try {
    const issuer = teamIssuer(c.env.CF_ACCESS_TEAM_DOMAIN!);
    const jwksUrl = new URL(`${issuer}/cdn-cgi/access/certs`);
    let remoteKeys = jwksCache.get(jwksUrl.href);
    if (!remoteKeys) {
      remoteKeys = createRemoteJWKSet(jwksUrl);
      jwksCache.set(jwksUrl.href, remoteKeys);
    }
    const verified = await jwtVerify(token, remoteKeys, {
      issuer,
      audience: audiences(c.env.CF_ACCESS_AUD!),
      algorithms: ['RS256']
    });
    c.set('accessClaims', verified.payload);
    await next();
  } catch (error) {
    console.warn('Cloudflare Access JWT rejected', error instanceof Error ? error.message : 'unknown error');
    return c.json({ error: 'unauthorized' }, 401);
  }
};
