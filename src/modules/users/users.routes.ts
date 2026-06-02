import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { usersController } from './users.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

const router = Router();

router.use(requireAuth);

router.get('/me', asyncHandler(usersController.me));
router.patch('/me', asyncHandler(usersController.updateMe));
router.delete('/me', asyncHandler(usersController.deleteAccount));
router.get('/me/export', asyncHandler(usersController.exportData));

router.post('/me/photos', upload.single('photo'), asyncHandler(usersController.uploadPhoto));
router.delete('/me/photos/:id', asyncHandler(usersController.deletePhoto));
router.patch('/me/photos/order', asyncHandler(usersController.reorderPhotos));

router.put('/me/fcm-token', asyncHandler(usersController.updateFcm));
router.patch(
  '/me/notification-settings',
  asyncHandler(usersController.updateNotificationSettings),
);

export default router;
