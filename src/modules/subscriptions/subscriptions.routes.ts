import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { subscriptionsController } from './subscriptions.controller';
import { handleGooglePlayRtdn } from './subscriptions.webhook';

const router = Router();

router.get('/plans', asyncHandler(subscriptionsController.plans));
router.get('/config', asyncHandler(subscriptionsController.config));

// Google Play Real-Time Developer Notifications. This route is UNAUTHENTICATED
// on purpose — it must be reachable by Google Pub/Sub. It is guarded by a
// shared secret in the query string (see subscriptions.webhook.ts).
router.post('/webhooks/google-play', asyncHandler(handleGooglePlayRtdn));

router.use(requireAuth);
router.get('/status', asyncHandler(subscriptionsController.status));
router.post('/validate', asyncHandler(subscriptionsController.validatePurchase));

export default router;
