import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { discoveryController } from './discovery.controller';

const router = Router();
router.use(requireAuth);

router.get('/feed', asyncHandler(discoveryController.feed));
router.post('/reset', asyncHandler(discoveryController.resetFeed));
router.post('/like/:id', asyncHandler(discoveryController.like));
router.post('/pass/:id', asyncHandler(discoveryController.pass));
router.get('/likes/sent', asyncHandler(discoveryController.sentLikes));
router.get('/likes/received', asyncHandler(discoveryController.receivedLikes));
router.delete('/likes/sent/:id', asyncHandler(discoveryController.unlike));

export default router;
