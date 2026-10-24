import { describe, expect, it } from 'vitest';
import { isTrustedRagDatasetWorkflow } from '../src/github-oidc';

const validClaims = {
  repository_id: '1428993732',
  repository_owner_id: '333149105',
  ref: 'refs/heads/main',
  workflow_ref: 'zazotona301-oss/zazo-brain-backend/.github/workflows/rag-dataset-prep.yml@refs/heads/main',
  event_name: 'schedule',
};

describe('GitHub OIDC dataset-export trust policy', () => {
  it('allows only the configured workflow on the default branch', () => {
    expect(isTrustedRagDatasetWorkflow(validClaims)).toBe(true);
    expect(isTrustedRagDatasetWorkflow({ ...validClaims, event_name: 'workflow_dispatch' })).toBe(true);
  });

  it('rejects other repositories, branches, workflows, and event types', () => {
    expect(isTrustedRagDatasetWorkflow({ ...validClaims, repository_id: 'other' })).toBe(false);
    expect(isTrustedRagDatasetWorkflow({ ...validClaims, repository_owner_id: 'other' })).toBe(false);
    expect(isTrustedRagDatasetWorkflow({ ...validClaims, ref: 'refs/heads/feature' })).toBe(false);
    expect(isTrustedRagDatasetWorkflow({ ...validClaims, workflow_ref: 'other/.github/workflows/work.yml@refs/heads/main' })).toBe(false);
    expect(isTrustedRagDatasetWorkflow({ ...validClaims, event_name: 'pull_request' })).toBe(false);
  });
});
