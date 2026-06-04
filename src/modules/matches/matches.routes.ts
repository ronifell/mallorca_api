import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { matchesController } from './matches.controller';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(matchesController.list));
router.get('/:id/profile', asyncHandler(matchesController.profile));
router.delete('/:id', asyncHandler(matchesController.unmatch));

export default router;
