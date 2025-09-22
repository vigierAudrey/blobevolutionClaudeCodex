#!/usr/bin/env node

/**
 * Analyse détaillée des plans d'exécution PostgreSQL/PostGIS
 * Script pour comprendre l'utilisation des index GIST
 */

const { Client } = require('pg');

const dbConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/blobinfini',
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
};

class ExecutionPlanAnalyzer {
  constructor() {
    this.client = null;
  }

  async connect() {
    this.client = new Client(dbConfig);
    await this.client.connect();
    console.log('✅ Connexion établie pour analyse des plans d\'exécution');
  }

  async disconnect() {
    if (this.client) {
      await this.client.end();
    }
  }

  async runAnalysis(title, query) {
    console.log(`\n=== ${title} ===`);
    console.log(`Requête: ${query.substring(0, 150).replace(/\\s+/g, ' ')}...`);

    try {
      const result = await this.client.query(query);

      if (result.rows.length > 0) {
        const plan = result.rows[0]['QUERY PLAN'][0];
        this.analyzePlan(plan);
        return plan;
      }
    } catch (error) {
      console.error(`❌ Erreur: ${error.message}`);
      return null;
    }
  }

  analyzePlan(plan) {
    console.log(`⏱️  Planning Time: ${plan['Planning Time']}ms`);
    console.log(`⏱️  Execution Time: ${plan['Execution Time']}ms`);

    // Analyse récursive du plan
    this.analyzeNode(plan.Plan, 0);
  }

  analyzeNode(node, depth) {
    const indent = '  '.repeat(depth);
    const nodeType = node['Node Type'];
    const relationName = node['Relation Name'] || '';
    const indexName = node['Index Name'] || '';
    const filter = node['Filter'] || '';
    const indexCond = node['Index Cond'] || '';

    console.log(`${indent}📋 ${nodeType}${relationName ? ` on ${relationName}` : ''}${indexName ? ` using ${indexName}` : ''}`);

    if (node['Actual Total Time']) {
      console.log(`${indent}   ⏱️  Temps: ${node['Actual Total Time']}ms`);
    }

    if (node['Actual Rows']) {
      console.log(`${indent}   📊 Lignes: ${node['Actual Rows']}`);
    }

    if (indexName) {
      if (indexName.includes('geog_idx')) {
        console.log(`${indent}   ✅ Index géospatial utilisé: ${indexName}`);
      } else {
        console.log(`${indent}   📝 Index standard: ${indexName}`);
      }
    }

    if (indexCond) {
      console.log(`${indent}   🔍 Condition index: ${indexCond}`);
    }

    if (filter) {
      console.log(`${indent}   🔍 Filtre: ${filter}`);
    }

    // Analyser les nœuds enfants
    if (node.Plans) {
      node.Plans.forEach(childNode => {
        this.analyzeNode(childNode, depth + 1);
      });
    }
  }

  async checkIndexUsageStats() {
    console.log('\\n=== Statistiques d\'Utilisation des Index ===');

    const query = `
      SELECT
          schemaname,
          relname as table_name,
          indexrelname as index_name,
          idx_scan as index_scans,
          idx_tup_read as tuples_read,
          idx_tup_fetch as tuples_fetched,
          pg_size_pretty(pg_relation_size(indexrelid)) as index_size
      FROM pg_stat_user_indexes
      WHERE indexrelname LIKE '%geog_idx%'
      ORDER BY idx_scan DESC;
    `;

    const result = await this.client.query(query);

    result.rows.forEach(row => {
      console.log(`📊 ${row.table_name}.${row.index_name}:`);
      console.log(`   📈 Scans: ${row.index_scans}`);
      console.log(`   📖 Tuples lus: ${row.tuples_read}`);
      console.log(`   📤 Tuples récupérés: ${row.tuples_fetched}`);
      console.log(`   💾 Taille: ${row.index_size}`);
    });
  }

  async checkIndexDefinitions() {
    console.log('\\n=== Définitions des Index GIST ===');

    const query = `
      SELECT
          tablename,
          indexname,
          indexdef
      FROM pg_indexes
      WHERE indexname LIKE '%geog_idx%'
      ORDER BY tablename;
    `;

    const result = await this.client.query(query);

    result.rows.forEach(row => {
      console.log(`🗂️  ${row.tablename}.${row.indexname}:`);
      console.log(`   ${row.indexdef}`);
    });
  }

  async forceIndexUsage() {
    console.log('\\n=== Test Forçage d\'Utilisation d\'Index ===');

    // Forcer l'utilisation d'index avec des paramètres PostgreSQL
    await this.client.query('SET enable_seqscan = OFF;');
    await this.client.query('SET enable_bitmapscan = OFF;');

    console.log('✅ Sequential scan et bitmap scan désactivés');

    const query = `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT
          id,
          "spotName",
          "spotLat",
          "spotLng"
      FROM "ProAvailability"
      WHERE
          "spotLat" IS NOT NULL
          AND "spotLng" IS NOT NULL
          AND ST_DWithin(
              ST_SetSRID(ST_MakePoint("spotLng", "spotLat"), 4326)::geography,
              ST_SetSRID(ST_MakePoint(7.2620, 43.7102), 4326)::geography,
              50000
          )
      LIMIT 5;
    `;

    await this.runAnalysis('Test avec Index Forcé - ProAvailability', query);

    // Remettre les paramètres par défaut
    await this.client.query('SET enable_seqscan = ON;');
    await this.client.query('SET enable_bitmapscan = ON;');

    console.log('✅ Paramètres par défaut restaurés');
  }

  async analyzeDataDistribution() {
    console.log('\\n=== Analyse de la Distribution des Données ===');

    // Analyser ProAvailability
    const availabilityStats = await this.client.query(`
      SELECT
          COUNT(*) as total_rows,
          COUNT(*) FILTER (WHERE "spotLat" IS NOT NULL AND "spotLng" IS NOT NULL) as rows_with_coords,
          MIN("spotLat") as min_lat,
          MAX("spotLat") as max_lat,
          MIN("spotLng") as min_lng,
          MAX("spotLng") as max_lng
      FROM "ProAvailability";
    `);

    console.log('📊 ProAvailability:');
    const stats = availabilityStats.rows[0];
    console.log(`   Total: ${stats.total_rows} lignes`);
    console.log(`   Avec coordonnées: ${stats.rows_with_coords} lignes`);
    console.log(`   Latitude: ${stats.min_lat} à ${stats.max_lat}`);
    console.log(`   Longitude: ${stats.min_lng} à ${stats.max_lng}`);

    // Analyser RiderProfile
    const riderStats = await this.client.query(`
      SELECT
          COUNT(*) as total_rows,
          COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) as rows_with_coords,
          MIN(lat) as min_lat,
          MAX(lat) as max_lat,
          MIN(lng) as min_lng,
          MAX(lng) as max_lng
      FROM "RiderProfile";
    `);

    console.log('📊 RiderProfile:');
    const riderStatsData = riderStats.rows[0];
    console.log(`   Total: ${riderStatsData.total_rows} lignes`);
    console.log(`   Avec coordonnées: ${riderStatsData.rows_with_coords} lignes`);
    console.log(`   Latitude: ${riderStatsData.min_lat} à ${riderStatsData.max_lat}`);
    console.log(`   Longitude: ${riderStatsData.min_lng} à ${riderStatsData.max_lng}`);
  }

  async testDifferentQueries() {
    console.log('\\n=== Test de Différents Types de Requêtes ===');

    // Test 1: Requête simple avec ST_DWithin
    await this.runAnalysis('Requête Simple ST_DWithin', `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id, "spotLat", "spotLng"
      FROM "ProAvailability"
      WHERE ST_DWithin(
          ST_SetSRID(ST_MakePoint("spotLng", "spotLat"), 4326)::geography,
          ST_SetSRID(ST_MakePoint(7.2620, 43.7102), 4326)::geography,
          20000
      );
    `);

    // Test 2: Requête avec ST_Distance
    await this.runAnalysis('Requête avec ST_Distance', `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id, ST_Distance(
          ST_SetSRID(ST_MakePoint("spotLng", "spotLat"), 4326)::geography,
          ST_SetSRID(ST_MakePoint(7.2620, 43.7102), 4326)::geography
      ) as distance
      FROM "ProAvailability"
      WHERE "spotLat" IS NOT NULL AND "spotLng" IS NOT NULL
      ORDER BY distance
      LIMIT 10;
    `);

    // Test 3: Requête avec bbox (plus efficace)
    await this.runAnalysis('Requête avec Bounding Box', `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id, "spotLat", "spotLng"
      FROM "ProAvailability"
      WHERE ST_SetSRID(ST_MakePoint("spotLng", "spotLat"), 4326) &&
            ST_Expand(ST_SetSRID(ST_MakePoint(7.2620, 43.7102), 4326)::geometry, 0.2);
    `);
  }

  async runCompleteAnalysis() {
    console.log('🔍 Analyse Complète des Plans d\'Exécution PostGIS');
    console.log('====================================================');

    try {
      await this.connect();

      await this.checkIndexDefinitions();
      await this.checkIndexUsageStats();
      await this.analyzeDataDistribution();
      await this.testDifferentQueries();
      await this.forceIndexUsage();

      console.log('\\n🎯 CONCLUSIONS:');
      console.log('1. Vérifiez si les index GIST sont correctement créés');
      console.log('2. Les petites tables peuvent utiliser des sequential scans');
      console.log('3. PostgreSQL choisit automatiquement le plan optimal');
      console.log('4. ST_DWithin est optimisé pour les index GIST');
      console.log('5. Utilisez ANALYZE après insertion de données importantes');

    } catch (error) {
      console.error('❌ Erreur pendant l\'analyse:', error);
    } finally {
      await this.disconnect();
    }
  }
}

// Exécution du script
if (require.main === module) {
  const analyzer = new ExecutionPlanAnalyzer();
  analyzer.runCompleteAnalysis().catch(console.error);
}

module.exports = ExecutionPlanAnalyzer;