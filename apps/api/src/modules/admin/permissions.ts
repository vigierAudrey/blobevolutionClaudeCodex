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
  'system.configure'
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
    'analytics.view'
  ],
  ANALYTICS: [
    'users.view',
    'analytics.view'
  ]
};
