import fs from 'node:fs';
import path from 'node:path';
import YAML from 'js-yaml';

describe('security OpenAPI contract', () => {
  it('documents canonical security health and observability endpoints', () => {
    const specPath = path.resolve(process.cwd(), '../../docs/openapi/openapi.yaml');
    const spec = YAML.load(fs.readFileSync(specPath, 'utf8')) as {
      paths: Record<string, any>;
      components: { schemas: Record<string, any> };
    };

    expect(spec.paths['/security/health']?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref)
      .toBe('#/components/schemas/SecurityHealthResponse');
    expect(spec.paths['/security/observability']?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref)
      .toBe('#/components/schemas/SecurityObservabilityResponse');
    expect(spec.components.schemas.SecurityHealthResponse).toBeDefined();
    expect(spec.components.schemas.SecurityObservabilityResponse).toBeDefined();
  });
});
