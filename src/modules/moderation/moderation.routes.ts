import { Router } from 'express';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
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
  r.get('/reports', asyncHandler(adminController.listReports));
  r.post('/reports/:id/resolve', asyncHandler(adminController.resolveReport));
  r.post('/users/:id/suspend', asyncHandler(adminController.suspend));
  r.post('/users/:id/ban', asyncHandler(adminController.ban));
  r.post('/users/:id/reinstate', asyncHandler(adminController.reinstate));
  return r;
})();
