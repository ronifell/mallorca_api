import { Router } from 'express';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { adminController as adminExtController } from '../admin/admin.controller';
import { adminController, moderationController } from './moderation.controller';

const router = Router();
router.use(requireAuth);

router.get('/blocks', asyncHandler(moderationController.listBlocks));
router.post('/blocks/:id', asyncHandler(moderationController.block));
router.delete('/blocks/:id', asyncHandler(moderationController.unblock));
router.post('/reports/:id', asyncHandler(moderationController.report));

export default router;

export const adminRouter = (() => {
  const r = Router();
  r.use(requireAuth, requireAdmin);

  // Session helper
  r.get('/me', asyncHandler(adminExtController.me));

  // Dashboard
  r.get('/stats', asyncHandler(adminExtController.stats));

  // Users management
  r.get('/users', asyncHandler(adminExtController.listUsers));
  r.get('/users/:id', asyncHandler(adminExtController.userDetail));
  r.post('/users/:id/suspend', asyncHandler(adminController.suspend));
  r.post('/users/:id/ban', asyncHandler(adminController.ban));
  r.post('/users/:id/reinstate', asyncHandler(adminController.reinstate));
  r.post('/users/:id/premium', asyncHandler(adminExtController.setPremium));
  r.post('/users/:id/role', asyncHandler(adminExtController.setRole));
  r.delete('/users/:id', asyncHandler(adminExtController.hardDelete));

  // Reports
  r.get('/reports', asyncHandler(adminController.listReports));
  r.post('/reports/:id/resolve', asyncHandler(adminController.resolveReport));

  // Subscriptions
  r.get('/subscriptions', asyncHandler(adminExtController.listSubscriptions));

  return r;
})();
