import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';

type OpenApiDoc = {
  paths?: Record<string, any>;
  components?: {
    schemas?: Record<string, any>;
  };
};

describe('OpenAPI contract - booking/matching geo hardening', () => {
  const specPath = path.resolve(process.cwd(), '../../docs/openapi/openapi.yaml');

  function loadSpec(): OpenApiDoc {
    const raw = fs.readFileSync(specPath, 'utf-8');
    return yaml.load(raw) as OpenApiDoc;
  }

  it('NearbyPro schema does not expose precise coordinates or email', () => {
    const doc = loadSpec();
    const schema = doc.components?.schemas?.NearbyPro;
    expect(schema).toBeDefined();

    const properties = schema.properties ?? {};
    expect(properties).not.toHaveProperty('lat');
    expect(properties).not.toHaveProperty('lng');
    expect(properties).not.toHaveProperty('email');
    expect(properties).not.toHaveProperty('proId');
    expect(properties).not.toHaveProperty('distanceKm');

    expect(properties).toHaveProperty('proPublicId');
    expect(properties).toHaveProperty('distanceBucket');

    expect(properties.distanceBucket.enum).toEqual(['<5km', '5-15km', '15-30km', '>30km']);
  });

  it('LessonLead schema keeps rider location coarse and non-identifying', () => {
    const doc = loadSpec();
    const schema = doc.components?.schemas?.LessonLead;
    expect(schema).toBeDefined();

    const properties = schema.properties ?? {};
    expect(properties).not.toHaveProperty('userId');
    expect(properties).not.toHaveProperty('lat');
    expect(properties).not.toHaveProperty('lng');
    expect(properties).not.toHaveProperty('distanceKm');
    expect(properties).toHaveProperty('distanceBucket');
    expect(properties.distanceBucket.enum).toEqual(['<5km', '5-15km', '15-30km', '>30km']);
  });

  it('booking/pros/nearby response points to NearbyPro schema', () => {
    const doc = loadSpec();
    const itemsRef = doc.paths?.['/booking/pros/nearby']?.get?.responses?.['200']?.content?.['application/json']
      ?.schema?.properties?.pros?.items?.$ref;
    expect(itemsRef).toBe('#/components/schemas/NearbyPro');
  });

  it('booking geo routes document France-only guard responses', () => {
    const doc = loadSpec();
    const geoOperations = [
      doc.paths?.['/booking/availability']?.post,
      doc.paths?.['/booking/availability/{availabilityId}']?.patch,
      doc.paths?.['/booking/availability/search']?.get,
      doc.paths?.['/booking/pros/nearby']?.get,
    ];

    for (const operation of geoOperations) {
      const badRequestSchema = operation?.responses?.['400']?.content?.['application/json']?.schema;
      expect(badRequestSchema?.oneOf).toEqual(
        expect.arrayContaining([
          { $ref: '#/components/schemas/ValidationError' },
          { $ref: '#/components/schemas/ErrorResponse' },
        ]),
      );
      expect(operation?.responses?.['403']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/ErrorResponse',
      );
    }
  });

  it('matching search request schema mirrors server validation constraints', () => {
    const doc = loadSpec();
    const schema = doc.components?.schemas?.MatchingSearchRequest;
    expect(schema).toBeDefined();

    expect(schema.properties.level.enum).toEqual(['beginner', 'intermediate', 'advanced', 'anytime']);
    expect(schema.properties.excludeIds.maxItems).toBe(200);
    expect(schema.properties.limit.maximum).toBe(100);
    expect(String(schema.properties.cursor.description)).not.toContain('offset:');
  });

  it('matching search response schema is aligned with runtime pagination payload', () => {
    const doc = loadSpec();
    const schema = doc.components?.schemas?.MatchingSearchResponse;
    expect(schema).toBeDefined();

    const properties = schema.properties ?? {};
    expect(properties).toHaveProperty('hasMore');
    expect(properties).toHaveProperty('nextCursor');
    expect(properties.nextCursor.nullable).toBe(true);
    expect(properties).toHaveProperty('page');
    expect(properties).toHaveProperty('pageSize');
  });

  it('matching batch decisions maxItems matches backend guard', () => {
    const doc = loadSpec();
    const schema = doc.components?.schemas?.MatchingBatchDecisions;
    expect(schema).toBeDefined();
    expect(schema.properties.items.maxItems).toBe(50);
  });
});
