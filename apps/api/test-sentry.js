// Script de test Sentry sur un port différent
require('dotenv').config({ path: '../../.env' });
require('./instrument');

const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', sentry: 'initialized' });
});

// Endpoint de test pour générer une erreur
app.get('/test-error', (req, res) => {
  console.log('🔥 Génération d\'une erreur test pour Sentry...');
  throw new Error('Erreur test BlobInfini !');
});

// Endpoint de test pour une erreur capturée manuellement
app.get('/test-error-manual', (req, res) => {
  const Sentry = require('@sentry/node');
  Sentry.captureException(new Error('Erreur manuelle test BlobInfini !'));
  res.json({ message: 'Erreur envoyée à Sentry' });
});

const PORT = 4001;
app.listen(PORT, () => {
  console.log(`\n✅ Serveur de test Sentry démarré sur http://localhost:${PORT}`);
  console.log(`\n📝 Endpoints disponibles:`);
  console.log(`   - GET http://localhost:${PORT}/health`);
  console.log(`   - GET http://localhost:${PORT}/test-error (lance une erreur)`);
  console.log(`   - GET http://localhost:${PORT}/test-error-manual (erreur manuelle)\n`);
});
