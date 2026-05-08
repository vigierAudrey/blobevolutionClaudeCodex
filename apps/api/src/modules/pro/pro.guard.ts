import { requireRole } from '../../lib/role-guard';

export const requireProRole = requireRole('PRO');
