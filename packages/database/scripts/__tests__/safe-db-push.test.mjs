import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateDbPushGuard } from '../safe-db-push.mjs';

test('authorizes db push when NODE_ENV=test and unlock flag are set', () => {
  const result = evaluateDbPushGuard({
    ALLOW_ACCEPT_DATA_LOSS: 'true',
    NODE_ENV: 'test'
  });

  assert.equal(result.testContext, 'NODE_ENV=test');
});

test('authorizes db push when CI_TEST_DB=true and unlock flag are set', () => {
  const result = evaluateDbPushGuard({
    ALLOW_ACCEPT_DATA_LOSS: 'true',
    CI_TEST_DB: 'true'
  });

  assert.equal(result.testContext, 'CI_TEST_DB=true');
});

test('rejects legacy CI_TEST=true without the explicit CI_TEST_DB guard', () => {
  assert.throws(
    () =>
      evaluateDbPushGuard({
        ALLOW_ACCEPT_DATA_LOSS: 'true',
        CI_TEST: 'true'
      }),
    /CI_TEST_DB=true/
  );
});

test('rejects production contexts even when test flags are present', () => {
  assert.throws(
    () =>
      evaluateDbPushGuard({
        ALLOW_ACCEPT_DATA_LOSS: 'true',
        NODE_ENV: 'test',
        APP_ENV: 'production'
      }),
    /FORBIDDEN in production/
  );
});
