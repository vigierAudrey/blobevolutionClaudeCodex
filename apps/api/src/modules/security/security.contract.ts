export type SecurityCheckState = 'ok' | 'fail';

export type SecurityHealthStatus = 'SECURE' | 'DEGRADED' | 'UNSAFE';

export type SecurityHealthChecks = {
  config: SecurityCheckState;
  env: SecurityCheckState;
  db: SecurityCheckState;
  redis: SecurityCheckState;
};

export type SecurityHealthResponse = {
  status: SecurityHealthStatus;
  timestamp: string;
  checks: SecurityHealthChecks;
};

export type SecurityObservabilityStatus = 'healthy' | 'degraded' | 'failing';

export type SecurityObservabilityResponse = {
  status: SecurityObservabilityStatus;
  timestamp: string;
  pipeline: {
    queued: number;
    sent: number;
    dropped: number;
    failed: number;
    breakerState: 'closed' | 'open' | 'half-open';
  };
};

export const resolveSecurityHealthStatus = (
  checks: SecurityHealthChecks,
): SecurityHealthStatus => {
  if (checks.config === 'fail' || checks.env === 'fail') {
    return 'UNSAFE';
  }

  if (checks.db === 'fail' || checks.redis === 'fail') {
    return 'DEGRADED';
  }

  return 'SECURE';
};

export const resolveSecurityObservabilityStatus = (
  pipeline: SecurityObservabilityResponse['pipeline'],
): SecurityObservabilityStatus => {
  if (pipeline.breakerState === 'open' || pipeline.failed > 0) {
    return 'failing';
  }

  if (pipeline.breakerState === 'half-open' || pipeline.dropped > 0 || pipeline.queued > 0) {
    return 'degraded';
  }

  return 'healthy';
};
