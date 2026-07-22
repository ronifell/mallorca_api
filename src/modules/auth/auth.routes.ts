import { Router } from 'express';
import { authLimiter } from '../../middleware/rateLimit';
import { asyncHandler } from '../../utils/asyncHandler';
import { authController } from './auth.controller';

const router = Router();

router.post('/register', authLimiter, asyncHandler(authController.register));
router.post('/login', authLimiter, asyncHandler(authController.login));
router.post('/google', authLimiter, asyncHandler(authController.googleLogin));
router.post('/refresh', asyncHandler(authController.refresh));
router.post('/logout', asyncHandler(authController.logout));
router.post('/forgot-password', authLimiter, asyncHandler(authController.forgotPassword));
router.post('/reset-password', authLimiter, asyncHandler(authController.resetPassword));
router.get('/verify-email', asyncHandler(authController.verifyEmail));
router.post('/verify-email', asyncHandler(authController.verifyEmail));
router.get('/open-app', asyncHandler(authController.openApp));
router.post('/resend-verification', authLimiter, asyncHandler(authController.resendVerification));

export default router;
