#!/usr/bin/env node

/**
 * Script de test de performance PostgreSQL/PostGIS
 * Alternative à psql utilisant Node.js et pg
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuration de la base de données
const dbConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/blobinfini',
  // Options supplémentaires pour les performances
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10, // pool size
};

class PostGISPerformanceTester {
  constructor() {
    this.client = null;
    this.results = [];
  }

  async connect() {
    this.client = new Client(dbConfig);
    await this.client.connect();
    console.log('✅ Connexion à la base de données établie');
  }

  async disconnect() {
    if (this.client) {
      await this.client.end();
      console.log('✅ Connexion fermée');
    }
  }

  async runQuery(description, query) {
    console.log(`\n=== ${description} ===`);
    console.log(`Requête: ${query.substring(0, 100)}...`);

    const startTime = process.hrtime.bigint();

    try {
      const result = await this.client.query(query);
      const endTime = process.hrtime.bigint();
      const executionTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds

      console.log(`✅ Exécutée en ${executionTime.toFixed(2)}ms`);
      console.log(`📊 ${result.rows.length} lignes retournées`);

      this.results.push({
        description,
        executionTime,
        rowCount: result.rows.length,
        success: true
      });

      return result;
    } catch (error) {
      const endTime = process.hrtime.bigint();
      const executionTime = Number(endTime - startTime) / 1000000;

      console.error(`❌ Erreur: ${error.message}`);

      this.results.push({
        description,
        executionTime,
        rowCount: 0,
        success: false,
        error: error.message
      });

      throw error;
    }
  }

  async checkExtensions() {
    const query = `
      SELECT
          extname as extension,
          extversion as version
      FROM pg_extension
      WHERE extname IN ('postgis', 'postgis_topology')
    `;

    const result = await this.runQuery('Vérification Extensions PostGIS', query);

    if (result.rows.length === 0) {
      console.warn('⚠️  Aucune extension PostGIS trouvée');
    } else {
      result.rows.forEach(row => {
        console.log(`📦 ${row.extension} v${row.version}`);
      });
    }

    return result;
  }

  async checkIndexes() {
    const query = `
      SELECT
          schemaname,
          tablename,
          indexname,
          indexdef
      FROM pg_indexes
      WHERE indexname LIKE '%geog_idx%'
      ORDER BY tablename, indexname
    `;

    const result = await this.runQuery('Vérification Index GIST', query);

    if (result.rows.length === 0) {
      console.warn('⚠️  Aucun index géospatial trouvé');
    } else {
      result.rows.forEach(row => {
        console.log(`🗂️  ${row.tablename}.${row.indexname}`);
      });
    }

    return result;
  }

  async getTableStats() {
    const query = `
      SELECT
          schemaname,
          relname as tablename,
          n_tup_ins as rows_inserted,
          n_tup_upd as rows_updated,
          n_tup_del as rows_deleted,
          n_live_tup as live_rows
      FROM pg_stat_user_tables
      WHERE relname IN ('ProAvailability', 'ProOffer', 'ProProfile', 'LastSearch', 'RiderProfile')
      ORDER BY relname
    `;

    const result = await this.runQuery('Statistiques des Tables', query);

    result.rows.forEach(row => {
      console.log(`📊 ${row.tablename}: ${row.live_rows} lignes actives`);
    });

    return result;
  }

  async testProAvailabilityDistance() {
    const query = `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT
          id,
          "spotName",
          "spotLat",
          "spotLng",
          sport,
          price,
          ST_Distance(
              ST_SetSRID(ST_MakePoint("spotLng", "spotLat"), 4326)::geography,
              ST_SetSRID(ST_MakePoint(7.2620, 43.7102), 4326)::geography
          ) / 1000 as distance_km
      FROM "ProAvailability"
      WHERE
          "spotLat" IS NOT NULL
          AND "spotLng" IS NOT NULL
          AND ST_DWithin(
              ST_SetSRID(ST_MakePoint("spotLng", "spotLat"), 4326)::geography,
              ST_SetSRID(ST_MakePoint(7.2620, 43.7102), 4326)::geography,
              20000
          )
          AND status = 'OPEN'
      ORDER BY distance_km
      LIMIT 10
    `;

    const result = await this.runQuery('Test ProAvailability Distance (Nice, 20km)', query);

    // Parse EXPLAIN ANALYZE results
    if (result.rows.length > 0) {
      const plan = result.rows[0]['QUERY PLAN'][0];
      const executionTime = plan['Execution Time'];
      const planningTime = plan['Planning Time'];

      console.log(`⏱️  Planning Time: ${planningTime}ms`);
      console.log(`⏱️  Execution Time: ${executionTime}ms`);

      // Check if index was used
      const planStr = JSON.stringify(plan);
      if (planStr.includes('Index Scan') || planStr.includes('geog_idx')) {
        console.log('✅ Index géospatial utilisé');
      } else {
        console.log('⚠️  Index géospatial possiblement non utilisé');
      }
    }

    return result;
  }

  async testProOfferDistance() {
    const query = `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT
          id,
          title,
          lat,
          lng,
          sport,
          level,
          "hourlyRate",
          ST_Distance(
              ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
              ST_SetSRID(ST_MakePoint(-1.5586, 43.4832), 4326)::geography
          ) / 1000 as distance_km
      FROM "ProOffer"
      WHERE
          "isActive" = true
          AND ST_DWithin(
              ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
              ST_SetSRID(ST_MakePoint(-1.5586, 43.4832), 4326)::geography,
              15000
          )
      ORDER BY distance_km
      LIMIT 10
    `;

    const result = await this.runQuery('Test ProOffer Distance (Biarritz, 15km)', query);

    if (result.rows.length > 0) {
      const plan = result.rows[0]['QUERY PLAN'][0];
      const executionTime = plan['Execution Time'];
      const planningTime = plan['Planning Time'];

      console.log(`⏱️  Planning Time: ${planningTime}ms`);
      console.log(`⏱️  Execution Time: ${executionTime}ms`);

      const planStr = JSON.stringify(plan);
      if (planStr.includes('Index Scan') || planStr.includes('geog_idx')) {
        console.log('✅ Index géospatial utilisé');
      } else {
        console.log('⚠️  Index géospatial possiblement non utilisé');
      }
    }

    return result;
  }

  async testProProfileDistance() {
    const query = `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT
          id,
          "businessName",
          lat,
          lng,
          verified,
          "pricePerHour",
          ST_Distance(
              ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
              ST_SetSRID(ST_MakePoint(3.8767, 43.6108), 4326)::geography
          ) / 1000 as distance_km
      FROM "ProProfile"
      WHERE
          lat IS NOT NULL
          AND lng IS NOT NULL
          AND ST_DWithin(
              ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
              ST_SetSRID(ST_MakePoint(3.8767, 43.6108), 4326)::geography,
              25000
          )
      ORDER BY distance_km
      LIMIT 10
    `;

    const result = await this.runQuery('Test ProProfile Distance (Montpellier, 25km)', query);

    if (result.rows.length > 0) {
      const plan = result.rows[0]['QUERY PLAN'][0];
      const executionTime = plan['Execution Time'];
      const planningTime = plan['Planning Time'];

      console.log(`⏱️  Planning Time: ${planningTime}ms`);
      console.log(`⏱️  Execution Time: ${executionTime}ms`);

      const planStr = JSON.stringify(plan);
      if (planStr.includes('Index Scan') || planStr.includes('geog_idx')) {
        console.log('✅ Index géospatial utilisé');
      } else {
        console.log('⚠️  Index géospatial possiblement non utilisé');
      }
    }

    return result;
  }

  async testComplexJoinQuery() {
    const query = `
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT
          pp.id as profile_id,
          pp."businessName",
          pp.lat as profile_lat,
          pp.lng as profile_lng,
          po.title as offer_title,
          po.sport,
          po.level,
          po."hourlyRate",
          ST_Distance(
              ST_SetSRID(ST_MakePoint(pp.lng, pp.lat), 4326)::geography,
              ST_SetSRID(ST_MakePoint(5.3698, 43.2965), 4326)::geography
          ) / 1000 as distance_km
      FROM "ProProfile" pp
      INNER JOIN "ProOffer" po ON po."proProfileId" = pp.id
      WHERE
          pp.lat IS NOT NULL
          AND pp.lng IS NOT NULL
          AND po."isActive" = true
          AND ST_DWithin(
              ST_SetSRID(ST_MakePoint(pp.lng, pp.lat), 4326)::geography,
              ST_SetSRID(ST_MakePoint(5.3698, 43.2965), 4326)::geography,
              30000
          )
      ORDER BY distance_km
      LIMIT 20
    `;

    const result = await this.runQuery('Test Requête Complexe Multi-Tables (Marseille, 30km)', query);

    if (result.rows.length > 0) {
      const plan = result.rows[0]['QUERY PLAN'][0];
      const executionTime = plan['Execution Time'];
      const planningTime = plan['Planning Time'];

      console.log(`⏱️  Planning Time: ${planningTime}ms`);
      console.log(`⏱️  Execution Time: ${executionTime}ms`);

      const planStr = JSON.stringify(plan);
      if (planStr.includes('Index Scan') || planStr.includes('geog_idx')) {
        console.log('✅ Index géospatial utilisé');
      } else {
        console.log('⚠️  Index géospatial possiblement non utilisé');
      }
    }

    return result;
  }

  async getIndexStats() {
    const query = `
      SELECT
          schemaname,
          relname as tablename,
          indexrelname as indexname,
          idx_tup_read as tuples_read,
          idx_tup_fetch as tuples_fetched,
          pg_size_pretty(pg_relation_size(indexrelid)) as index_size
      FROM pg_stat_user_indexes
      WHERE indexrelname LIKE '%geog_idx%'
      ORDER BY relname, indexrelname
    `;

    const result = await this.runQuery('Statistiques Utilisation Index', query);

    result.rows.forEach(row => {
      console.log(`📊 ${row.tablename}.${row.indexname}: ${row.index_size}, ${row.tuples_read} tuples lus`);
    });

    return result;
  }

  async runFullTest() {
    console.log('🚀 Démarrage du test de performance PostGIS');
    console.log('============================================');

    try {
      await this.connect();

      // Tests de vérification
      await this.checkExtensions();
      await this.checkIndexes();
      await this.getTableStats();

      // Tests de performance
      await this.testProAvailabilityDistance();
      await this.testProOfferDistance();
      await this.testProProfileDistance();
      await this.testComplexJoinQuery();

      // Statistiques finales
      await this.getIndexStats();

      // Résumé des résultats
      this.printSummary();

    } catch (error) {
      console.error('❌ Erreur pendant les tests:', error.message);
    } finally {
      await this.disconnect();
    }
  }

  printSummary() {
    console.log('\n📋 RÉSUMÉ DES TESTS DE PERFORMANCE');
    console.log('=====================================');

    const successfulTests = this.results.filter(r => r.success);
    const failedTests = this.results.filter(r => !r.success);

    console.log(`✅ Tests réussis: ${successfulTests.length}`);
    console.log(`❌ Tests échoués: ${failedTests.length}`);

    if (successfulTests.length > 0) {
      const avgTime = successfulTests.reduce((sum, r) => sum + r.executionTime, 0) / successfulTests.length;
      const maxTime = Math.max(...successfulTests.map(r => r.executionTime));
      const minTime = Math.min(...successfulTests.map(r => r.executionTime));

      console.log(`⏱️  Temps moyen: ${avgTime.toFixed(2)}ms`);
      console.log(`⏱️  Temps min: ${minTime.toFixed(2)}ms`);
      console.log(`⏱️  Temps max: ${maxTime.toFixed(2)}ms`);
    }

    console.log('\n🎯 RECOMMANDATIONS:');
    console.log('1. Vérifiez que les index GIST sont utilisés dans les plans d\'exécution');
    console.log('2. Exécutez ANALYZE régulièrement après insertion de données');
    console.log('3. Surveillez la taille des index géospatiaux');
    console.log('4. Utilisez toujours ST_DWithin pour les requêtes de distance');
    console.log('5. Assurez-vous que les coordonnées sont en SRID 4326');
  }
}

// Exécution du script
if (require.main === module) {
  const tester = new PostGISPerformanceTester();
  tester.runFullTest().catch(console.error);
}

module.exports = PostGISPerformanceTester;