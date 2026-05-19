#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const apiSrcDir = path.join(rootDir, 'apps/api/src');
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'test-utils' || entry.name === 'scripts') {
      continue;
    }

    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }

    if (entry.isFile() && absolutePath.endsWith('.ts')) {
      files.push(absolutePath);
    }
  }
}

walk(apiSrcDir);

const allowlist = new Set([
  path.join(apiSrcDir, 'utils/password-validator.ts'),
]);

const findings = [];
const consolePattern = /\bconsole\.(log|error|warn|info|debug)\b/;

for (const file of files) {
  if (allowlist.has(file)) {
    continue;
  }

  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    if (consolePattern.test(line)) {
      findings.push(`${path.relative(rootDir, file)}:${index + 1}:${line.trim()}`);
    }
  });
}

if (findings.length > 0) {
  console.error('Runtime console.* calls remain in apps/api/src:');
  for (const finding of findings) {
    console.error(` - ${finding}`);
  }
  process.exit(1);
}

console.log('Runtime console guard passed.');
