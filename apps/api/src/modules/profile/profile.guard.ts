import { requireRole } from '../../lib/role-guard';

export const requireRiderRole = requireRole('RIDER');
