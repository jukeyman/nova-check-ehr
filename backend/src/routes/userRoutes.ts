/**
 * ============================================================================
 * NOVA CHECK EHR - USER MANAGEMENT ROUTES
 * ============================================================================
 */

import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { config } from '../config/config';
import logger from '../config/logger';
import { authenticateToken, requireRole } from '../middleware/auth';
import { rateLimiters } from '../middleware/security';
import auditService from '../services/auditService';
import emailService from '../services/emailService';
import cacheService from '../services/cacheService';
import crypto from 'crypto';

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

interface UserResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Validation middleware
const validateCreateUser = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
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
  body('phone')
    .optional()
    .isMobilePhone('any')
    .withMessage('Invalid phone number'),
  body('dateOfBirth')
    .optional()
    .isISO8601()
    .withMessage('Invalid date of birth'),
];

const validateUpdateUser = [
  param('id').isUUID().withMessage('Invalid user ID'),
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('phone')
    .optional()
    .isMobilePhone('any')
    .withMessage('Invalid phone number'),
  body('dateOfBirth')
    .optional()
    .isISO8601()
    .withMessage('Invalid date of birth'),
  body('status')
    .optional()
    .isIn(Object.values(UserStatus))
    .withMessage('Invalid user status'),
];

const validateUserQuery = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('role')
    .optional()
    .isIn(Object.values(UserRole))
    .withMessage('Invalid role filter'),
  query('status')
    .optional()
    .isIn(Object.values(UserStatus))
    .withMessage('Invalid status filter'),
  query('facilityId')
    .optional()
    .isUUID()
    .withMessage('Invalid facility ID'),
];

// Helper functions
const generateTemporaryPassword = (): string => {
  return crypto.randomBytes(8).toString('hex');
};

const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
};

const canManageUser = (currentUser: any, targetUser: any): boolean => {
  // Super admin can manage anyone
  if (currentUser.role === UserRole.SUPER_ADMIN) {
    return true;
  }

  // Admin can manage users in their facility (except other admins)
  if (currentUser.role === UserRole.ADMIN) {
    return (
      currentUser.facilityId === targetUser.facilityId &&
      targetUser.role !== UserRole.SUPER_ADMIN &&
      targetUser.role !== UserRole.ADMIN
    );
  }

  // Users can only manage themselves
  return currentUser.id === targetUser.id;
};

// Routes

/**
 * @route   GET /api/v1/users
 * @desc    Get all users with filtering and pagination
 * @access  Private (Admin+)
 */
router.get('/', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), validateUserQuery, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const {
      page = 1,
      limit = 20,
      search,
      role,
      status,
      facilityId,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = {};

    // Facility-based filtering for non-super admins
    if (req.user?.role !== UserRole.SUPER_ADMIN && req.user?.facilityId) {
      where.facilityId = req.user.facilityId;
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    if (role) {
      where.role = role;
    }

    if (status) {
      where.status = status;
    }

    if (facilityId) {
      where.facilityId = facilityId;
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get users with pagination
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limitNum,
        orderBy,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          facilityId: true,
          phone: true,
          dateOfBirth: true,
          emailVerified: true,
          lastLoginAt: true,
          loginCount: true,
          createdAt: true,
          updatedAt: true,
          facility: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    const response: UserResponse = {
      success: true,
      message: 'Users retrieved successfully',
      data: { users },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get users error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/users/:id
 * @desc    Get user by ID
 * @access  Private
 */
router.get('/:id', authenticateToken, [param('id').isUUID().withMessage('Invalid user ID')], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        facilityId: true,
        phone: true,
        dateOfBirth: true,
        emailVerified: true,
        lastLoginAt: true,
        loginCount: true,
        createdAt: true,
        updatedAt: true,
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

    // Check if user can view this profile
    if (!canManageUser(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const response: UserResponse = {
      success: true,
      message: 'User retrieved successfully',
      data: { user },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get user error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      targetUserId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/users
 * @desc    Create a new user
 * @access  Private (Admin+)
 */
router.post('/', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), rateLimiters.api, validateCreateUser, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const {
      email,
      firstName,
      lastName,
      role,
      facilityId,
      phone,
      dateOfBirth,
      sendWelcomeEmail = true,
    } = req.body;

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

      // Non-super admins can only create users in their facility
      if (req.user?.role !== UserRole.SUPER_ADMIN && req.user?.facilityId !== facilityId) {
        return res.status(403).json({
          success: false,
          message: 'You can only create users in your facility',
        });
      }
    }

    // Generate temporary password
    const temporaryPassword = generateTemporaryPassword();
    const hashedPassword = await hashPassword(temporaryPassword);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        role,
        facilityId: facilityId || req.user?.facilityId,
        phone,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        status: UserStatus.PENDING,
        emailVerified: false,
        mustChangePassword: true,
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
        phone: true,
        dateOfBirth: true,
        createdAt: true,
      },
    });

    // Send welcome email with temporary password
    if (sendWelcomeEmail) {
      await emailService.sendWelcomeEmail({
        to: user.email,
        firstName: user.firstName,
        temporaryPassword,
        loginUrl: `${config.app.frontendUrl}/login`,
      });
    }

    // Log audit event
    await auditService.log({
      action: 'USER_CREATED',
      userId: req.user?.id,
      resourceType: 'User',
      resourceId: user.id,
      details: {
        createdUserEmail: user.email,
        createdUserRole: user.role,
        facilityId: user.facilityId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('User created successfully', {
      userId: user.id,
      email: user.email,
      role: user.role,
      createdBy: req.user?.id,
    });

    const response: UserResponse = {
      success: true,
      message: 'User created successfully',
      data: {
        user,
        temporaryPassword: sendWelcomeEmail ? undefined : temporaryPassword,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Create user error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      email: req.body.email,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during user creation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   PUT /api/v1/users/:id
 * @desc    Update user
 * @access  Private
 */
router.put('/:id', authenticateToken, validateUpdateUser, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Find existing user
    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check if user can update this profile
    if (!canManageUser(req.user, existingUser)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Prepare update data
    const allowedUpdates: any = {};
    const allowedFields = ['firstName', 'lastName', 'phone', 'dateOfBirth'];

    // Only admins can update status
    if (req.user?.role === UserRole.ADMIN || req.user?.role === UserRole.SUPER_ADMIN) {
      allowedFields.push('status');
    }

    // Filter allowed updates
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        if (field === 'dateOfBirth' && updateData[field]) {
          allowedUpdates[field] = new Date(updateData[field]);
        } else {
          allowedUpdates[field] = updateData[field];
        }
      }
    }

    allowedUpdates.updatedAt = new Date();

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id },
      data: allowedUpdates,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        facilityId: true,
        phone: true,
        dateOfBirth: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        facility: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Invalidate user cache
    await cacheService.invalidateUserSession(id);

    // Log audit event
    await auditService.log({
      action: 'USER_UPDATED',
      userId: req.user?.id,
      resourceType: 'User',
      resourceId: id,
      details: {
        updatedFields: Object.keys(allowedUpdates),
        targetUserEmail: existingUser.email,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('User updated successfully', {
      userId: id,
      updatedBy: req.user?.id,
      updatedFields: Object.keys(allowedUpdates),
    });

    const response: UserResponse = {
      success: true,
      message: 'User updated successfully',
      data: { user: updatedUser },
    };

    res.json(response);
  } catch (error) {
    logger.error('Update user error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      targetUserId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during user update',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   DELETE /api/v1/users/:id
 * @desc    Delete user (soft delete)
 * @access  Private (Admin+)
 */
router.delete('/:id', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), [param('id').isUUID().withMessage('Invalid user ID')], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { id } = req.params;

    // Find existing user
    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Prevent self-deletion
    if (req.user?.id === id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account',
      });
    }

    // Check if user can delete this profile
    if (!canManageUser(req.user, existingUser)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Soft delete user
    await prisma.user.update({
      where: { id },
      data: {
        status: UserStatus.INACTIVE,
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Invalidate user cache
    await cacheService.invalidateUserSession(id);

    // Log audit event
    await auditService.log({
      action: 'USER_DELETED',
      userId: req.user?.id,
      resourceType: 'User',
      resourceId: id,
      details: {
        deletedUserEmail: existingUser.email,
        deletedUserRole: existingUser.role,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('User deleted successfully', {
      userId: id,
      deletedBy: req.user?.id,
      email: existingUser.email,
    });

    const response: UserResponse = {
      success: true,
      message: 'User deleted successfully',
    };

    res.json(response);
  } catch (error) {
    logger.error('Delete user error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      targetUserId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during user deletion',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/users/:id/activate
 * @desc    Activate user account
 * @access  Private (Admin+)
 */
router.post('/:id/activate', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), [param('id').isUUID().withMessage('Invalid user ID')], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check if user can manage this profile
    if (!canManageUser(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Activate user
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        status: UserStatus.ACTIVE,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });

    // Send activation notification email
    await emailService.sendAccountActivatedEmail({
      to: updatedUser.email,
      firstName: updatedUser.firstName,
    });

    // Log audit event
    await auditService.log({
      action: 'USER_ACTIVATED',
      userId: req.user?.id,
      resourceType: 'User',
      resourceId: id,
      details: {
        activatedUserEmail: updatedUser.email,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('User activated successfully', {
      userId: id,
      activatedBy: req.user?.id,
      email: updatedUser.email,
    });

    const response: UserResponse = {
      success: true,
      message: 'User activated successfully',
      data: { user: updatedUser },
    };

    res.json(response);
  } catch (error) {
    logger.error('Activate user error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      targetUserId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during user activation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/users/:id/deactivate
 * @desc    Deactivate user account
 * @access  Private (Admin+)
 */
router.post('/:id/deactivate', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), [param('id').isUUID().withMessage('Invalid user ID')], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { id } = req.params;

    // Prevent self-deactivation
    if (req.user?.id === id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account',
      });
    }

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check if user can manage this profile
    if (!canManageUser(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Deactivate user
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        status: UserStatus.INACTIVE,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });

    // Invalidate user sessions
    await cacheService.invalidateUserSession(id);

    // Log audit event
    await auditService.log({
      action: 'USER_DEACTIVATED',
      userId: req.user?.id,
      resourceType: 'User',
      resourceId: id,
      details: {
        deactivatedUserEmail: updatedUser.email,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('User deactivated successfully', {
      userId: id,
      deactivatedBy: req.user?.id,
      email: updatedUser.email,
    });

    const response: UserResponse = {
      success: true,
      message: 'User deactivated successfully',
      data: { user: updatedUser },
    };

    res.json(response);
  } catch (error) {
    logger.error('Deactivate user error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      targetUserId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during user deactivation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/users/:id/reset-password
 * @desc    Reset user password (admin action)
 * @access  Private (Admin+)
 */
router.post('/:id/reset-password', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), [param('id').isUUID().withMessage('Invalid user ID')], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { id } = req.params;
    const { sendEmail = true } = req.body;

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check if user can manage this profile
    if (!canManageUser(req.user, user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Generate new temporary password
    const temporaryPassword = generateTemporaryPassword();
    const hashedPassword = await hashPassword(temporaryPassword);

    // Update user password
    await prisma.user.update({
      where: { id },
      data: {
        password: hashedPassword,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Invalidate user sessions
    await cacheService.invalidateUserSession(id);

    // Send password reset email
    if (sendEmail) {
      await emailService.sendPasswordResetByAdminEmail({
        to: user.email,
        firstName: user.firstName,
        temporaryPassword,
        adminName: `${req.user?.firstName} ${req.user?.lastName}`,
      });
    }

    // Log audit event
    await auditService.log({
      action: 'PASSWORD_RESET_BY_ADMIN',
      userId: req.user?.id,
      resourceType: 'User',
      resourceId: id,
      details: {
        targetUserEmail: user.email,
        emailSent: sendEmail,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Password reset by admin', {
      userId: id,
      resetBy: req.user?.id,
      email: user.email,
      emailSent: sendEmail,
    });

    const response: UserResponse = {
      success: true,
      message: 'Password reset successfully',
      data: {
        temporaryPassword: sendEmail ? undefined : temporaryPassword,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Reset password error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      targetUserId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during password reset',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/users/stats
 * @desc    Get user statistics
 * @access  Private (Admin+)
 */
router.get('/stats', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
    const facilityFilter = req.user?.role !== UserRole.SUPER_ADMIN && req.user?.facilityId
      ? { facilityId: req.user.facilityId }
      : {};

    const [totalUsers, activeUsers, pendingUsers, inactiveUsers, usersByRole] = await Promise.all([
      prisma.user.count({ where: facilityFilter }),
      prisma.user.count({ where: { ...facilityFilter, status: UserStatus.ACTIVE } }),
      prisma.user.count({ where: { ...facilityFilter, status: UserStatus.PENDING } }),
      prisma.user.count({ where: { ...facilityFilter, status: UserStatus.INACTIVE } }),
      prisma.user.groupBy({
        by: ['role'],
        where: facilityFilter,
        _count: {
          id: true,
        },
      }),
    ]);

    const roleStats = usersByRole.reduce((acc, item) => {
      acc[item.role] = item._count.id;
      return acc;
    }, {} as Record<string, number>);

    const stats = {
      total: totalUsers,
      active: activeUsers,
      pending: pendingUsers,
      inactive: inactiveUsers,
      byRole: roleStats,
    };

    const response: UserResponse = {
      success: true,
      message: 'User statistics retrieved successfully',
      data: { stats },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get user stats error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

export default router;