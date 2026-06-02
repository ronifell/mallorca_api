import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { subscriptionsController } from './subscriptions.controller';

const router = Router();

router.get('/plans', asyncHandler(subscriptionsController.plans));

router.use(requireAuth);
router.get('/status', asyncHandler(subscriptionsController.status));
router.post('/validate', asyncHandler(subscriptionsController.validatePurchase));

export default router;
