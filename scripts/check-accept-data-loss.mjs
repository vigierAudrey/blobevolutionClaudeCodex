#!/usr/bin/env node

/**
 * CI GUARD #2: Verify no unprotected --accept-data-loss usage
 *
 * This script ensures that the dangerous flag "--accept-data-loss" only appears
 * in explicitly whitelisted files (the security wrapper + documentation).
 *
 * WHITELIST (authorized files):
 * - packages/database/scripts/safe-db-push.mjs (security wrapper)
 * - packages/database/SECURITY.md (documentation)
 * - .github/workflows/ci.yml (CI guard message)
 * - scripts/check-accept-data-loss.mjs (this file)
 *
 * Any other occurrence is considered a CRITICAL security violation.
 *
 * Usage:
 *   node scripts/check-accept-data-loss.mjs
 *   npm run guard:accept-data-loss
 */

import { execSync } from 'child_process';
import { exit } from 'process';

console.log('\n🔍 CI GUARD: Scanning for unprotected --accept-data-loss usage...\n');

// WHITELIST: Only these files are allowed to contain --accept-data-loss
const WHITELIST = [
  'packages/database/scripts/safe-db-push.mjs',
  'packages/database/SECURITY.md',
  '.github/workflows/ci.yml',
  'scripts/check-accept-data-loss.mjs'
];

try {
  // Search for --accept-data-loss in all files
  const result = execSync(
    'git grep -n --no-color --extended-regexp -- "--accept-data-loss" || true',
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );

  if (!result.trim()) {
    console.log('✅ No occurrences of --accept-data-loss found.');
    console.log('✅ GUARD CHECK PASSED\n');
    exit(0);
  }

  // Parse results
  const lines = result.trim().split('\n');
  const violations = [];

  for (const line of lines) {
    // Format: filepath:linenum:content
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const filepath = line.substring(0, colonIndex);

    // Check if file is in whitelist
    if (!WHITELIST.includes(filepath)) {
      violations.push(line);
    }
  }

  if (violations.length === 0) {
    console.log('✅ All occurrences are in whitelisted files:');
    WHITELIST.forEach(file => console.log(`   - ${file}`));
    console.log('\n✅ GUARD CHECK PASSED\n');
    exit(0);
  }

  // VIOLATIONS FOUND
  console.error('❌ CRITICAL: Unprotected --accept-data-loss usage detected!\n');
  console.error('Violations found:\n');
  violations.forEach(v => console.error(`   ${v}`));
  console.error('\n🚨 SECURITY VIOLATION:');
  console.error('   The flag --accept-data-loss may ONLY appear in whitelisted files.');
  console.error('\nWhitelisted files:');
  WHITELIST.forEach(file => console.error(`   - ${file}`));
  console.error('\n💡 Action required:');
  console.error('   - If this is a legitimate wrapper, add it to the whitelist in this script');
  console.error('   - Otherwise, remove the --accept-data-loss flag and use the safe wrapper:\n');
  console.error('     ALLOW_ACCEPT_DATA_LOSS=true NODE_ENV=test npm run db:push --workspace @blobinfini/database\n');

  exit(1);

} catch (error) {
  if (error.status && error.status !== 0) {
    console.error('❌ Guard check failed with error:', error.message);
    exit(1);
  }
  throw error;
}
