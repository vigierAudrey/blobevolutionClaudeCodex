import { getLogTransportMetrics } from '../../observability/log-transport';
import {
  resolveSecurityObservabilityStatus,
  type SecurityObservabilityResponse,
} from './security.contract';

export function buildSecurityObservabilityResponse(): SecurityObservabilityResponse {
  const metrics = getLogTransportMetrics();
  const pipeline = {
    queued: metrics.queued,
    sent: metrics.sent,
    dropped: metrics.dropped,
    failed: metrics.failed,
    breakerState: metrics.breakerState,
  };

  return {
    status: resolveSecurityObservabilityStatus(pipeline),
    timestamp: new Date().toISOString(),
    pipeline,
  };
}
