/**
 * ============================================================================
 * NOVA CHECK EHR - AUTHENTICATION ROUTES
 * ============================================================================
 */

import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { config } from '../config/config';
import logger from '../config/logger';
import { authenticateToken, requireRole } from '../middleware/auth';
import { rateLimiters } from '../middleware/security';
import auditService from '../services/auditService';
import emailService from '../services/emailService';
import cacheService from '../services/cacheService';
import crypto from 'crypto';
import { promisify } from 'util';

const router = Router();
const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    facilityId?: string;
  };
}

interface LoginResponse {
  success: boolean;
  message: string;
  data?: {
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: UserRole;
      status: UserStatus;
      facilityId?: string;
      lastLoginAt?: Date;
    };
    tokens: {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    };
  };
  error?: string;
}

interface RegisterResponse {
  success: boolean;
  message: string;
  data?: {
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: UserRole;
    };
  };
  error?: string;
}

// Validation middleware
const validateRegister = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('role')
    .isIn(Object.values(UserRole))
    .withMessage('Invalid user role'),
  body('facilityId')
    .optional()
    .isUUID()
    .withMessage('Invalid facility ID'),
];

const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

const validatePasswordReset = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
];

const validatePasswordChange = [
  body('token')
    .notEmpty()
    .withMessage('Reset token is required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
];

// Helper functions
const generateTokens = (user: any) => {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    facilityId: user.facilityId,
  };

  const accessToken = jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });

  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh' },
    config.jwt.refreshSecret,
    {
      expiresIn: config.jwt.refreshExpiresIn,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    }
  );

  return {
    accessToken,
    refreshToken,
    expiresIn: parseInt(config.jwt.expiresIn.replace(/\D/g, '')) * 3600, // Convert hours to seconds
  };
};

const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
};

const verifyPassword = async (password: string, hashedPassword: string): Promise<boolean> => {
  return bcrypt.compare(password, hashedPassword);
};

// Routes

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user
 * @access  Public (but may require admin approval)
 */
router.post('/register', rateLimiters.auth, validateRegister, async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { email, password, firstName, lastName, role, facilityId } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists',
      });
    }

    // Validate facility if provided
    if (facilityId) {
      const facility = await prisma.facility.findUnique({
        where: { id: facilityId },
      });

      if (!facility) {
        return res.status(400).json({
          success: false,
          message: 'Invalid facility ID',
        });
      }
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        role,
        facilityId,
        status: role === UserRole.PATIENT ? UserStatus.ACTIVE : UserStatus.PENDING, // Patients are auto-approved
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        facilityId: true,
        createdAt: true,
      },
    });

    // Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: verificationToken,
        emailVerificationExpires: verificationExpires,
      },
    });

    // Send welcome email with verification link
    await emailService.sendWelcomeEmail({
      to: user.email,
      firstName: user.firstName,
      verificationToken,
    });

    // Log audit event
    await auditService.log({
      action: 'USER_REGISTERED',
      userId: user.id,
      resourceType: 'User',
      resourceId: user.id,
      details: {
        email: user.email,
        role: user.role,
        facilityId: user.facilityId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('User registered successfully', {
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const response: RegisterResponse = {
      success: true,
      message: 'User registered successfully. Please check your email to verify your account.',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      },
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Registration error', {
      error: error.message,
      stack: error.stack,
      email: req.body.email,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during registration',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/auth/login
 * @desc    Authenticate user and return JWT tokens
 * @access  Public
 */
router.post('/login', rateLimiters.auth, validateLogin, async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { email, password } = req.body;

    // Find user with facility information
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        facility: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
    });

    if (!user) {
      await auditService.log({
        action: 'LOGIN_FAILED',
        details: {
          email,
          reason: 'User not found',
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Check if user is active
    if (user.status !== UserStatus.ACTIVE) {
      await auditService.log({
        action: 'LOGIN_FAILED',
        userId: user.id,
        details: {
          email,
          reason: 'User not active',
          status: user.status,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      return res.status(401).json({
        success: false,
        message: 'Account is not active. Please contact your administrator.',
      });
    }

    // Verify password
    const isPasswordValid = await verifyPassword(password, user.password);
    if (!isPasswordValid) {
      await auditService.log({
        action: 'LOGIN_FAILED',
        userId: user.id,
        details: {
          email,
          reason: 'Invalid password',
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Check if facility is active (for non-patients)
    if (user.facilityId && user.facility && user.facility.status !== 'ACTIVE') {
      return res.status(401).json({
        success: false,
        message: 'Your facility is currently inactive. Please contact support.',
      });
    }

    // Generate tokens
    const tokens = generateTokens(user);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        loginCount: {
          increment: 1,
        },
      },
    });

    // Cache user session
    await cacheService.cacheUserSession(user.id, {
      id: user.id,
      email: user.email,
      role: user.role,
      facilityId: user.facilityId,
      lastLoginAt: new Date(),
    }, 3600); // 1 hour

    // Log successful login
    await auditService.log({
      action: 'LOGIN_SUCCESS',
      userId: user.id,
      details: {
        email: user.email,
        role: user.role,
        facilityId: user.facilityId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('User logged in successfully', {
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const response: LoginResponse = {
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          status: user.status,
          facilityId: user.facilityId,
          lastLoginAt: user.lastLoginAt,
        },
        tokens,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Login error', {
      error: error.message,
      stack: error.stack,
      email: req.body.email,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Refresh access token using refresh token
 * @access  Public
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required',
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as any;

    if (decoded.type !== 'refresh') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type',
      });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        facilityId: true,
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      return res.status(401).json({
        success: false,
        message: 'User not found or inactive',
      });
    }

    // Generate new tokens
    const tokens = generateTokens(user);

    // Update cache
    await cacheService.cacheUserSession(user.id, {
      id: user.id,
      email: user.email,
      role: user.role,
      facilityId: user.facilityId,
      lastRefreshAt: new Date(),
    }, 3600);

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: { tokens },
    });
  } catch (error) {
    logger.error('Token refresh error', {
      error: error.message,
      stack: error.stack,
    });

    res.status(401).json({
      success: false,
      message: 'Invalid or expired refresh token',
    });
  }
});

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Logout user and invalidate tokens
 * @access  Private
 */
router.post('/logout', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (userId) {
      // Invalidate user session cache
      await cacheService.invalidateUserSession(userId);

      // Log logout
      await auditService.log({
        action: 'LOGOUT',
        userId,
        details: {
          email: req.user?.email,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      logger.info('User logged out', {
        userId,
        email: req.user?.email,
      });
    }

    res.json({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    logger.error('Logout error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during logout',
    });
  }
});

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Send password reset email
 * @access  Public
 */
router.post('/forgot-password', rateLimiters.auth, validatePasswordReset, async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { email } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        status: true,
      },
    });

    // Always return success to prevent email enumeration
    const successResponse = {
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    };

    if (!user || user.status !== UserStatus.ACTIVE) {
      return res.json(successResponse);
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save reset token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpires,
      },
    });

    // Send reset email
    await emailService.sendPasswordResetEmail({
      to: user.email,
      firstName: user.firstName,
      resetToken,
    });

    // Log audit event
    await auditService.log({
      action: 'PASSWORD_RESET_REQUESTED',
      userId: user.id,
      details: {
        email: user.email,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Password reset requested', {
      userId: user.id,
      email: user.email,
    });

    res.json(successResponse);
  } catch (error) {
    logger.error('Forgot password error', {
      error: error.message,
      stack: error.stack,
      email: req.body.email,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Reset password using reset token
 * @access  Public
 */
router.post('/reset-password', rateLimiters.auth, validatePasswordChange, async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { token, password } = req.body;

    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: {
          gt: new Date(),
        },
        status: UserStatus.ACTIVE,
      },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token',
      });
    }

    // Hash new password
    const hashedPassword = await hashPassword(password);

    // Update password and clear reset token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
        passwordChangedAt: new Date(),
      },
    });

    // Invalidate all user sessions
    await cacheService.invalidateUserSession(user.id);

    // Log audit event
    await auditService.log({
      action: 'PASSWORD_RESET_COMPLETED',
      userId: user.id,
      details: {
        email: user.email,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Password reset completed', {
      userId: user.id,
      email: user.email,
    });

    res.json({
      success: true,
      message: 'Password reset successful. Please log in with your new password.',
    });
  } catch (error) {
    logger.error('Reset password error', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

/**
 * @route   POST /api/v1/auth/verify-email
 * @desc    Verify email address using verification token
 * @access  Public
 */
router.post('/verify-email', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required',
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        emailVerificationToken: token,
        emailVerificationExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token',
      });
    }

    // Update user as verified
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
        emailVerifiedAt: new Date(),
      },
    });

    // Log audit event
    await auditService.log({
      action: 'EMAIL_VERIFIED',
      userId: user.id,
      details: {
        email: user.email,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Email verified', {
      userId: user.id,
      email: user.email,
    });

    res.json({
      success: true,
      message: 'Email verified successfully',
    });
  } catch (error) {
    logger.error('Email verification error', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get current user information
 * @access  Private
 */
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        facilityId: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        facility: {
          select: {
            id: true,
            name: true,
            address: true,
            phone: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      data: { user },
    });
  } catch (error) {
    logger.error('Get current user error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

/**
 * @route   PUT /api/v1/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.put('/change-password', authenticateToken, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { currentPassword, newPassword } = req.body;
    const userId = req.user?.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        password: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await verifyPassword(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    // Hash new password
    const hashedNewPassword = await hashPassword(newPassword);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedNewPassword,
        passwordChangedAt: new Date(),
      },
    });

    // Invalidate all user sessions except current one
    await cacheService.invalidateUserSession(userId);

    // Log audit event
    await auditService.log({
      action: 'PASSWORD_CHANGED',
      userId,
      details: {
        email: user.email,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Password changed', {
      userId,
      email: user.email,
    });

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    logger.error('Change password error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

export default router;