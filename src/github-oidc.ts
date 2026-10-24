import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
export const RAG_DATASET_OIDC_AUDIENCE = 'zazo-rag-data-prep';
const RAG_DATASET_WORKFLOW_REF = 'zazotona301-oss/zazo-brain-backend/.github/workflows/rag-dataset-prep.yml@refs/heads/main';
const GITHUB_REPOSITORY_ID = '1428993732';
const GITHUB_REPOSITORY_OWNER_ID = '333149105';
const githubJwks = createRemoteJWKSet(new URL(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`));

export function isTrustedRagDatasetWorkflow(payload: JWTPayload): boolean {
  return payload.repository_id === GITHUB_REPOSITORY_ID
    && payload.repository_owner_id === GITHUB_REPOSITORY_OWNER_ID
    && payload.ref === 'refs/heads/main'
    && payload.workflow_ref === RAG_DATASET_WORKFLOW_REF
    && (payload.event_name === 'schedule' || payload.event_name === 'workflow_dispatch');
}

export async function isAuthorizedRagDatasetWorkflow(request: Request): Promise<boolean> {
  const authorization = request.headers.get('Authorization');
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return false;

  try {
    const { payload } = await jwtVerify(match[1], githubJwks, {
      issuer: GITHUB_OIDC_ISSUER,
      audience: RAG_DATASET_OIDC_AUDIENCE,
    });
    return isTrustedRagDatasetWorkflow(payload);
  } catch {
    return false;
  }
}
