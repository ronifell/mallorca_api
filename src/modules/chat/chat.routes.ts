import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { chatController } from './chat.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const router = Router();
router.use(requireAuth);

router.post('/matches/:matchId/conversation', asyncHandler(chatController.createForMatch));
router.get('/conversations/:id/messages', asyncHandler(chatController.list));
router.post('/conversations/:id/messages', asyncHandler(chatController.send));
router.post('/conversations/:id/images', upload.single('image'), asyncHandler(chatController.uploadImage));
router.post('/conversations/:id/read', asyncHandler(chatController.markRead));

export default router;
