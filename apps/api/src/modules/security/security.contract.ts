export type SecurityCheckState = 'ok' | 'fail';

export type SecurityHealthStatus = 'SECURE' | 'DEGRADED' | 'UNSAFE';

export type SecurityHealthChecks = {
  config: SecurityCheckState;
  env: SecurityCheckState;
  db: SecurityCheckState;
  redis: SecurityCheckState;
  smtp: SecurityCheckState;
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
  email: {
    email_sent_total: number;
    email_failed_total: number;
    email_timeout_total: number;
    email_latency_ms: {
      p50: number;
      p95: number;
      p99: number;
    };
    by_type: Record<string, {
      email_sent_total: number;
      email_failed_total: number;
      email_timeout_total: number;
      email_latency_ms: {
        p50: number;
        p95: number;
        p99: number;
      };
    }>;
  };
};

export const resolveSecurityHealthStatus = (
  checks: SecurityHealthChecks,
): SecurityHealthStatus => {
  if (checks.config === 'fail' || checks.env === 'fail') {
    return 'UNSAFE';
  }

  if (checks.db === 'fail' || checks.redis === 'fail' || checks.smtp === 'fail') {
    return 'DEGRADED';
  }

  return 'SECURE';
};

export const resolveSecurityObservabilityStatus = (
  pipeline: SecurityObservabilityResponse['pipeline'],
  email?: SecurityObservabilityResponse['email'],
): SecurityObservabilityStatus => {
  if (
    pipeline.breakerState === 'open' ||
    pipeline.failed > 0 ||
    (email?.email_failed_total ?? 0) > 0 ||
    (email?.email_timeout_total ?? 0) > 0
  ) {
    return 'failing';
  }

  if (pipeline.breakerState === 'half-open' || pipeline.dropped > 0 || pipeline.queued > 0) {
    return 'degraded';
  }

  return 'healthy';
};
