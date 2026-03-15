#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const apiSrcDir = path.join(rootDir, 'apps/api/src');
const routeFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'scripts' || entry.name === 'test-utils') {
      continue;
    }

    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }

    if (entry.isFile() && absolutePath.endsWith('.ts')) {
      routeFiles.push(absolutePath);
    }
  }
}

walk(apiSrcDir);

const healthRouteDefinitions = [];
const observabilityRouteDefinitions = [];
const apiSecurityAliases = [];

for (const file of routeFiles) {
  const source = fs.readFileSync(file, 'utf8');

  if (source.includes("securityRouter.get('/health'") || source.includes('securityRouter.get("/health"')) {
    healthRouteDefinitions.push(file);
  }

  if (source.includes("app.get('/security/health'") || source.includes('app.get("/security/health"')) {
    healthRouteDefinitions.push(file);
  }

  if (
    source.includes("securityRouter.get('/observability'") ||
    source.includes('securityRouter.get("/observability"')
  ) {
    observabilityRouteDefinitions.push(file);
  }

  if (source.includes("app.use('/api/security'") || source.includes('app.use("/api/security"')) {
    apiSecurityAliases.push(file);
  }
}

let failed = false;

if (healthRouteDefinitions.length !== 1) {
  failed = true;
  console.error(
    `Expected exactly one canonical /security/health implementation, found ${healthRouteDefinitions.length}.`,
  );
  for (const file of healthRouteDefinitions) {
    console.error(` - ${path.relative(rootDir, file)}`);
  }
}

if (apiSecurityAliases.length > 0) {
  failed = true;
  console.error('Deprecated /api/security alias detected:');
  for (const file of apiSecurityAliases) {
    console.error(` - ${path.relative(rootDir, file)}`);
  }
}

if (observabilityRouteDefinitions.length !== 1) {
  failed = true;
  console.error(
    `Expected exactly one canonical /security/observability implementation, found ${observabilityRouteDefinitions.length}.`,
  );
  for (const file of observabilityRouteDefinitions) {
    console.error(` - ${path.relative(rootDir, file)}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log('Security route guard passed.');
