import type { AnalyticsEventType, ConsentLevel } from '@blobinfini/database';

export const PRIVACY_THRESHOLD = 20;

export const ANALYTICS_EVENT_TTL_DAYS = Number(process.env.ANALYTICS_EVENT_RETENTION_DAYS || '90');
export const ANALYTICS_ZONE_GRID_DEGREES = Number(process.env.ANALYTICS_ZONE_GRID_DEGREES || '1');

export type AnalyticsPeriod = '7d' | '30d' | '90d' | '1y';

export const PERIOD_TO_DAYS: Record<AnalyticsPeriod, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

export const RIDER_ACTIVITY_EVENTS = [
  'RIDER_SEARCH_PROS',
  'RIDER_BOOKING_REQUEST',
  'RIDER_MATCH_DECISION',
  'MESSAGE_SENT',
  'BLOBOSPHERE_VIEW',
  'BLOBOSPHERE_OUTBOUND',
] as const satisfies AnalyticsEventType[];

export const PRO_ACTIVITY_EVENTS = [
  'PRO_BOOKING_RESPONSE',
  'MESSAGE_SENT',
  'PRO_PROFILE_UPDATE',
  'PRO_SLOTS_UPDATE',
  'PRO_DASHBOARD_OPEN',
] as const satisfies AnalyticsEventType[];

export const DEDUPED_EVENT_TYPES = new Set<AnalyticsEventType>([
  ...RIDER_ACTIVITY_EVENTS,
  ...PRO_ACTIVITY_EVENTS,
  'BLOBOSPHERE_SIGNUP',
]);

export const PUBLIC_EVENT_TYPES = [
  'BLOBOSPHERE_VIEW',
  'BLOBOSPHERE_OUTBOUND',
  'BLOBOSPHERE_SIGNUP',
  'PRO_DASHBOARD_OPEN',
  'PUBLIC_PRO_PROFILE_VIEW',
] as const satisfies AnalyticsEventType[];

export const ANALYTICS_ALLOWED_CONSENT_LEVELS: ConsentLevel[] = ['personalized', 'npa'];

export const ANALYTICS_DEFINITIONS = {
  riderActiveDay: 'Match decision, message sent, blobosphere view or outbound click (consented). Note: legacy reservation signal removed (feature deprecated).',
  proActiveDay: 'Message sent, profile/slot update, or pro dashboard open (consented). Note: legacy reservation response signal removed (feature deprecated).',
  stickiness: 'Average daily active users divided by monthly active users for the selected period.',
  retention: 'Share of new users active on day+1/day+7/day+30 after signup, based on activity events.',
  ttfvRider: 'Time between signup and first value action (message sent or match accept). Note: legacy reservation signal removed (feature deprecated).',
  ttfvPro: 'Time between pro verification and first message sent. Note: legacy reservation signal removed (feature deprecated).',
  supplyDemand: 'Historical demand signals versus pro availabilities by sport and large zone (data frozen — legacy module deprecated).',
  trustSafety: 'Verified pro rate, reports per 1k users, and moderation median delay (when available).',
  blobosphere: 'Pageviews, outbound clicks, and signup conversions aggregated per article.',
  lessonRequests: 'Riders with an active lesson request (wantsLesson=true on their profile). Pro contacts = ContactRequests sent to lesson-seeking riders. Response time approximated from rider profile.updatedAt to first ContactRequest.',
} as const;
