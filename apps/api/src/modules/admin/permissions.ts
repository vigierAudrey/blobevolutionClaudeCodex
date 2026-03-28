export const AVAILABLE_PERMISSIONS = [
  'users.view',
  'users.suspend',
  'users.delete',
  'pros.verify',
  'pros.manage',
  'reports.view',
  'reports.moderate',
  'analytics.view',
  'permissions.manage',
  // F05 — system.monitor: read-only observability (alerts list, security summary, GDPR compliance report, exports dashboard)
  // system.configure: write/destructive ops + per-user PII endpoints (purge, legal archive, audit logs, security events)
  'system.monitor',
  'system.configure',
  // bookings.manage: bookedCount adjustment (ADMIN correction outil ops) — restricted to trusted admins only
  'bookings.manage',
] as const;

export type Permission = typeof AVAILABLE_PERMISSIONS[number];

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  SUPER_ADMIN: [...AVAILABLE_PERMISSIONS],
  MODERATOR: [
    'users.view',
    'users.suspend',
    'pros.verify',
    'reports.view',
    'reports.moderate',
    'analytics.view',
    'system.monitor'  // F05: moderators can read alerts + security summary
  ],
  ANALYTICS: [
    'users.view',
    'analytics.view'
  ]
};
