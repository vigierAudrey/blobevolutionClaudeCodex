/**
 * C15 — Contract tests for OpenAPI spec alignment with contact/pending DTO.
 *
 * Oracles :
 *  - /contact/pending ne documente PAS de query params cursor/take/nextCursor
 *  - le schéma item est strict (additionalProperties: false)
 *  - les champs requis sont exactement : id, message, createdAt, conversationId, proName
 *  - aucun champ sensible documenté : pro, proUserId, lessonRequestId, conversation, members, user, email, riderProfile
 *  - /contact/respond documente les 3 codes 409 attendus : ALREADY_RESPONDED, CONTACT_REQUEST_ALREADY_RESOLVED, CONCURRENT_UPDATE
 *  - /contact/respond documente 429
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'js-yaml';

type OpenApiSpec = {
  paths: Record<string, {
    get?: { parameters?: Array<{ name: string }>; responses?: Record<string, unknown> };
    post?: { responses?: Record<string, unknown> };
  }>;
};

const SPEC_PATH = path.resolve(process.cwd(), '../../docs/openapi/openapi.yaml');

function loadSpec(): OpenApiSpec {
  return YAML.load(fs.readFileSync(SPEC_PATH, 'utf8')) as OpenApiSpec;
}

// ─── /contact/pending ─────────────────────────────────────────────────────────

describe('OpenAPI /contact/pending — DTO strict (C15)', () => {
  let spec: OpenApiSpec;

  beforeAll(() => {
    spec = loadSpec();
  });

  it('route /contact/pending GET est documentée', () => {
    expect(spec.paths['/contact/pending']?.get).toBeDefined();
  });

  it('ne documente aucun query param (pas de cursor, pas de take)', () => {
    const params = spec.paths['/contact/pending']?.get?.parameters ?? [];
    const names = params.map((p) => p.name);
    expect(names).not.toContain('cursor');
    expect(names).not.toContain('take');
    expect(names).toHaveLength(0);
  });

  function getItemSchema(s: OpenApiSpec) {
    const resp200 = (s.paths['/contact/pending']?.get?.responses?.['200'] as {
      content?: {
        'application/json'?: {
          schema?: {
            properties?: {
              requests?: {
                items?: {
                  additionalProperties?: unknown;
                  required?: string[];
                  properties?: Record<string, unknown>;
                };
              };
              nextCursor?: unknown;
            };
            additionalProperties?: unknown;
          };
        };
      };
    });
    return resp200?.content?.['application/json']?.schema;
  }

  it('ne documente pas nextCursor dans la réponse 200', () => {
    const schema = getItemSchema(spec);
    expect(schema?.properties).not.toHaveProperty('nextCursor');
  });

  it('la réponse est stricte (additionalProperties: false sur l\'enveloppe)', () => {
    const schema = getItemSchema(spec);
    expect(schema?.additionalProperties).toBe(false);
  });

  it('l\'item est strict (additionalProperties: false)', () => {
    const schema = getItemSchema(spec);
    expect(schema?.properties?.requests?.items?.additionalProperties).toBe(false);
  });

  it('les champs requis de l\'item sont exactement id, message, createdAt, conversationId, proName', () => {
    const schema = getItemSchema(spec);
    const required = schema?.properties?.requests?.items?.required ?? [];
    expect(required.sort()).toEqual(['conversationId', 'createdAt', 'id', 'message', 'proName']);
  });

  it('les propriétés documentées sont exactement les 5 champs du DTO', () => {
    const schema = getItemSchema(spec);
    const props = Object.keys(schema?.properties?.requests?.items?.properties ?? {});
    expect(props.sort()).toEqual(['conversationId', 'createdAt', 'id', 'message', 'proName']);
  });

  const FORBIDDEN_FIELDS = [
    'pro', 'proUserId', 'lessonRequestId', 'conversation',
    'members', 'user', 'email', 'riderProfile',
  ];

  for (const field of FORBIDDEN_FIELDS) {
    it(`ne documente pas le champ sensible "${field}"`, () => {
      const schema = getItemSchema(spec);
      const props = schema?.properties?.requests?.items?.properties ?? {};
      expect(props).not.toHaveProperty(field);
    });
  }

  it('documente une réponse 401 pour le cas non authentifié', () => {
    const responses = spec.paths['/contact/pending']?.get?.responses ?? {};
    expect(responses['401']).toBeDefined();
  });
});

// ─── /contact/respond ─────────────────────────────────────────────────────────

describe('OpenAPI /contact/respond — codes erreurs 409/429 (C15)', () => {
  let spec: OpenApiSpec;

  beforeAll(() => {
    spec = loadSpec();
  });

  function get409Schema(s: OpenApiSpec) {
    const resp409 = (s.paths['/contact/respond']?.post?.responses?.['409'] as {
      content?: {
        'application/json'?: {
          schema?: {
            properties?: {
              error?: { enum?: string[] };
            };
          };
        };
      };
    });
    return resp409?.content?.['application/json']?.schema;
  }

  it('documente une réponse 409', () => {
    expect(spec.paths['/contact/respond']?.post?.responses?.['409']).toBeDefined();
  });

  it('409 enum inclut ALREADY_RESPONDED (permanent)', () => {
    const schema = get409Schema(spec);
    expect(schema?.properties?.error?.enum).toContain('ALREADY_RESPONDED');
  });

  it('409 enum inclut CONTACT_REQUEST_ALREADY_RESOLVED (permanent)', () => {
    const schema = get409Schema(spec);
    expect(schema?.properties?.error?.enum).toContain('CONTACT_REQUEST_ALREADY_RESOLVED');
  });

  it('409 enum inclut CONCURRENT_UPDATE (retryable)', () => {
    const schema = get409Schema(spec);
    expect(schema?.properties?.error?.enum).toContain('CONCURRENT_UPDATE');
  });

  it('documente une réponse 429 (rate limit)', () => {
    expect(spec.paths['/contact/respond']?.post?.responses?.['429']).toBeDefined();
  });
});
