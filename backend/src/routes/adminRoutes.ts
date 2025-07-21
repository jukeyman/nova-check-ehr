/**
 * ============================================================================
 * NOVA CHECK EHR - ADMIN MANAGEMENT ROUTES
 * ============================================================================
 */

import { Router, Request, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import config from '../config/config';
import logger from '../config/logger';
import { authenticateToken, requireRole } from '../middleware/auth';
import { rateLimiters } from '../middleware/security';
import auditService from '../services/auditService';
import cacheService from '../services/cacheService';
import emailService from '../services/emailService';
import smsService from '../services/smsService';
import { generateId } from '../utils/helpers';

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

interface AdminResponse {
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
const validateUserCreation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
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
];

const validateUserUpdate = [
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
  body('role')
    .optional()
    .isIn(Object.values(UserRole))
    .withMessage('Invalid user role'),
  body('status')
    .optional()
    .isIn(Object.values(UserStatus))
    .withMessage('Invalid user status'),
  body('facilityId')
    .optional()
    .isUUID()
    .withMessage('Invalid facility ID'),
  body('phone')
    .optional()
    .isMobilePhone('any')
    .withMessage('Invalid phone number'),
];

const validateFacilityCreation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Facility name must be between 2 and 100 characters'),
  body('type')
    .isIn(['HOSPITAL', 'CLINIC', 'URGENT_CARE', 'SPECIALTY', 'OTHER'])
    .withMessage('Invalid facility type'),
  body('address')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Address must be between 5 and 200 characters'),
  body('city')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('City must be between 2 and 50 characters'),
  body('state')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('State must be between 2 and 50 characters'),
  body('zipCode')
    .trim()
    .isLength({ min: 5, max: 10 })
    .withMessage('Zip code must be between 5 and 10 characters'),
  body('phone')
    .isMobilePhone('any')
    .withMessage('Valid phone number is required'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
];

const validateSystemSettings = [
  body('maintenanceMode')
    .optional()
    .isBoolean()
    .withMessage('Maintenance mode must be a boolean'),
  body('allowRegistration')
    .optional()
    .isBoolean()
    .withMessage('Allow registration must be a boolean'),
  body('maxFileSize')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Max file size must be between 1 and 100 MB'),
  body('sessionTimeout')
    .optional()
    .isInt({ min: 15, max: 1440 })
    .withMessage('Session timeout must be between 15 and 1440 minutes'),
];

// Helper functions
const canManageUser = (adminRole: UserRole, targetRole: UserRole): boolean => {
  if (adminRole === UserRole.SUPER_ADMIN) return true;
  if (adminRole === UserRole.ADMIN) {
    return targetRole !== UserRole.SUPER_ADMIN && targetRole !== UserRole.ADMIN;
  }
  return false;
};

const generateTempPassword = (): string => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

// Routes

/**
 * @route   GET /api/v1/admin/users
 * @desc    Get all users with filtering and pagination
 * @access  Private (Admins only)
 */
router.get('/users', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
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
    const whereClause: any = {};

    // Role-based filtering
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      whereClause.facilityId = req.user?.facilityId;
      whereClause.role = { not: UserRole.SUPER_ADMIN };
    }

    if (search) {
      whereClause.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (role) {
      whereClause.role = role;
    }

    if (status) {
      whereClause.status = status;
    }

    if (facilityId && req.user?.role === UserRole.SUPER_ADMIN) {
      whereClause.facilityId = facilityId;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        skip,
        take: limitNum,
        orderBy: { [sortBy as string]: sortOrder },
        include: {
          facility: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
          provider: {
            select: {
              id: true,
              specialization: true,
              type: true,
            },
          },
        },
      }),
      prisma.user.count({ where: whereClause }),
    ]);

    // Remove sensitive information
    const sanitizedUsers = users.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    const response: AdminResponse = {
      success: true,
      message: 'Users retrieved successfully',
      data: sanitizedUsers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
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
 * @route   GET /api/v1/admin/users/:id
 * @desc    Get user by ID
 * @access  Private (Admins only)
 */
router.get('/users/:id', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        facility: true,
        provider: {
          include: {
            appointments: {
              take: 5,
              orderBy: { createdAt: 'desc' },
              include: {
                patient: {
                  select: {
                    firstName: true,
                    lastName: true,
                    patientId: true,
                  },
                },
              },
            },
          },
        },
        patient: {
          include: {
            appointments: {
              take: 5,
              orderBy: { createdAt: 'desc' },
              include: {
                provider: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
        },
        auditLogs: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check access permissions
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      if (user.facilityId !== req.user?.facilityId || user.role === UserRole.SUPER_ADMIN) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }
    }

    // Remove sensitive information
    const { password, ...userWithoutPassword } = user;

    const response: AdminResponse = {
      success: true,
      message: 'User retrieved successfully',
      data: userWithoutPassword,
    };

    res.json(response);
  } catch (error) {
    logger.error('Get user by ID error', {
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
 * @route   POST /api/v1/admin/users
 * @desc    Create new user
 * @access  Private (Admins only)
 */
router.post('/users', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), rateLimiters.auth, validateUserCreation, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { email, firstName, lastName, role, facilityId, phone } = req.body;

    // Check if admin can create this role
    if (!canManageUser(req.user?.role as UserRole, role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions to create user with this role',
      });
    }

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

    // Validate facility access
    let targetFacilityId = facilityId;
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      targetFacilityId = req.user?.facilityId;
    }

    if (targetFacilityId) {
      const facility = await prisma.facility.findUnique({
        where: { id: targetFacilityId },
      });

      if (!facility) {
        return res.status(404).json({
          success: false,
          message: 'Facility not found',
        });
      }
    }

    // Generate temporary password
    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    // Create user
    const newUser = await prisma.user.create({
      data: {
        id: generateId('user'),
        email,
        password: hashedPassword,
        firstName,
        lastName,
        role,
        facilityId: targetFacilityId,
        phone,
        status: UserStatus.ACTIVE,
        mustChangePassword: true,
        emailVerified: false,
      },
      include: {
        facility: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });

    // Send welcome email with temporary password
    try {
      await emailService.sendWelcomeEmail({
        to: email,
        firstName,
        tempPassword,
        loginUrl: `${config.app.frontendUrl}/login`,
      });
    } catch (emailError) {
      logger.warn('Failed to send welcome email', {
        error: emailError.message,
        userId: newUser.id,
      });
    }

    // Log audit event
    await auditService.log({
      action: 'USER_CREATED',
      userId: req.user?.id,
      resourceType: 'User',
      resourceId: newUser.id,
      details: {
        targetUserId: newUser.id,
        targetUserEmail: email,
        targetUserRole: role,
        facilityId: targetFacilityId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    // Remove sensitive information
    const { password, ...userWithoutPassword } = newUser;

    const response: AdminResponse = {
      success: true,
      message: 'User created successfully. Welcome email sent with temporary password.',
      data: userWithoutPassword,
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Create user error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      requestBody: { ...req.body, password: '[REDACTED]' },
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   PUT /api/v1/admin/users/:id
 * @desc    Update user
 * @access  Private (Admins only)
 */
router.put('/users/:id', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), validateUserUpdate, async (req: AuthRequest, res: Response) => {
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

    // Get existing user
    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check permissions
    if (!canManageUser(req.user?.role as UserRole, existingUser.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions to update this user',
      });
    }

    if (updateData.role && !canManageUser(req.user?.role as UserRole, updateData.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions to assign this role',
      });
    }

    // Validate facility access
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      if (existingUser.facilityId !== req.user?.facilityId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }
      // Prevent changing facility for non-super admins
      delete updateData.facilityId;
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...updateData,
        updatedAt: new Date(),
      },
      include: {
        facility: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });

    // Invalidate user cache
    await cacheService.delete(`user_${id}`);

    // Log audit event
    await auditService.log({
      action: 'USER_UPDATED',
      userId: req.user?.id,
      resourceType: 'User',
      resourceId: id,
      details: {
        targetUserId: id,
        changes: updateData,
        previousRole: existingUser.role,
        newRole: updateData.role || existingUser.role,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    // Remove sensitive information
    const { password, ...userWithoutPassword } = updatedUser;

    const response: AdminResponse = {
      success: true,
      message: 'User updated successfully',
      data: userWithoutPassword,
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
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   DELETE /api/v1/admin/users/:id
 * @desc    Deactivate user (soft delete)
 * @access  Private (Admins only)
 */
router.delete('/users/:id', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Get existing user
    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check permissions
    if (!canManageUser(req.user?.role as UserRole, existingUser.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions to deactivate this user',
      });
    }

    // Prevent self-deactivation
    if (id === req.user?.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate your own account',
      });
    }

    // Validate facility access
    if (req.user?.role !== UserRole.SUPER_ADMIN && existingUser.facilityId !== req.user?.facilityId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Deactivate user (soft delete)
    const deactivatedUser = await prisma.user.update({
      where: { id },
      data: {
        status: UserStatus.INACTIVE,
        deactivatedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Invalidate user cache
    await cacheService.delete(`user_${id}`);

    // Log audit event
    await auditService.log({
      action: 'USER_DEACTIVATED',
      userId: req.user?.id,
      resourceType: 'User',
      resourceId: id,
      details: {
        targetUserId: id,
        targetUserEmail: existingUser.email,
        targetUserRole: existingUser.role,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    const response: AdminResponse = {
      success: true,
      message: 'User deactivated successfully',
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
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/admin/users/:id/reset-password
 * @desc    Reset user password
 * @access  Private (Admins only)
 */
router.post('/users/:id/reset-password', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), rateLimiters.auth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Get existing user
    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check permissions
    if (!canManageUser(req.user?.role as UserRole, existingUser.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions to reset password for this user',
      });
    }

    // Validate facility access
    if (req.user?.role !== UserRole.SUPER_ADMIN && existingUser.facilityId !== req.user?.facilityId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Generate new temporary password
    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    // Update user password
    await prisma.user.update({
      where: { id },
      data: {
        password: hashedPassword,
        mustChangePassword: true,
        passwordResetAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Send password reset email
    try {
      await emailService.sendPasswordResetEmail({
        to: existingUser.email,
        firstName: existingUser.firstName,
        tempPassword,
        loginUrl: `${config.app.frontendUrl}/login`,
      });
    } catch (emailError) {
      logger.warn('Failed to send password reset email', {
        error: emailError.message,
        userId: id,
      });
    }

    // Invalidate user cache
    await cacheService.delete(`user_${id}`);

    // Log audit event
    await auditService.log({
      action: 'PASSWORD_RESET_BY_ADMIN',
      userId: req.user?.id,
      resourceType: 'User',
      resourceId: id,
      details: {
        targetUserId: id,
        targetUserEmail: existingUser.email,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    const response: AdminResponse = {
      success: true,
      message: 'Password reset successfully. New temporary password sent via email.',
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
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/admin/facilities
 * @desc    Get all facilities
 * @access  Private (Super admins only)
 */
router.get('/facilities', authenticateToken, requireRole([UserRole.SUPER_ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      type,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const whereClause: any = {};

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (type) {
      whereClause.type = type;
    }

    if (status) {
      whereClause.status = status;
    }

    const [facilities, total] = await Promise.all([
      prisma.facility.findMany({
        where: whereClause,
        skip,
        take: limitNum,
        orderBy: { [sortBy as string]: sortOrder },
        include: {
          _count: {
            select: {
              users: true,
              providers: true,
              patients: true,
            },
          },
        },
      }),
      prisma.facility.count({ where: whereClause }),
    ]);

    const response: AdminResponse = {
      success: true,
      message: 'Facilities retrieved successfully',
      data: facilities,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get facilities error', {
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
 * @route   POST /api/v1/admin/facilities
 * @desc    Create new facility
 * @access  Private (Super admins only)
 */
router.post('/facilities', authenticateToken, requireRole([UserRole.SUPER_ADMIN]), validateFacilityCreation, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const facilityData = req.body;

    // Create facility
    const newFacility = await prisma.facility.create({
      data: {
        id: generateId('facility'),
        ...facilityData,
        status: 'ACTIVE',
      },
    });

    // Log audit event
    await auditService.log({
      action: 'FACILITY_CREATED',
      userId: req.user?.id,
      resourceType: 'Facility',
      resourceId: newFacility.id,
      details: {
        facilityName: newFacility.name,
        facilityType: newFacility.type,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    const response: AdminResponse = {
      success: true,
      message: 'Facility created successfully',
      data: newFacility,
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Create facility error', {
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
 * @route   GET /api/v1/admin/system/settings
 * @desc    Get system settings
 * @access  Private (Super admins only)
 */
router.get('/system/settings', authenticateToken, requireRole([UserRole.SUPER_ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
    // Get system settings from cache or database
    const cacheKey = 'system_settings';
    let settings = await cacheService.get(cacheKey);

    if (!settings) {
      settings = await prisma.systemSetting.findMany({
        select: {
          key: true,
          value: true,
          description: true,
          updatedAt: true,
        },
      });

      // Cache for 1 hour
      await cacheService.set(cacheKey, settings, 60 * 60);
    }

    // Convert to key-value object
    const settingsObject = settings.reduce((acc: any, setting: any) => {
      acc[setting.key] = {
        value: setting.value,
        description: setting.description,
        updatedAt: setting.updatedAt,
      };
      return acc;
    }, {});

    const response: AdminResponse = {
      success: true,
      message: 'System settings retrieved successfully',
      data: settingsObject,
    };

    res.json(response);
  } catch (error) {
    logger.error('Get system settings error', {
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
 * @route   PUT /api/v1/admin/system/settings
 * @desc    Update system settings
 * @access  Private (Super admins only)
 */
router.put('/system/settings', authenticateToken, requireRole([UserRole.SUPER_ADMIN]), validateSystemSettings, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const settingsUpdates = req.body;
    const updatedSettings = [];

    // Update each setting
    for (const [key, value] of Object.entries(settingsUpdates)) {
      const updatedSetting = await prisma.systemSetting.upsert({
        where: { key },
        update: {
          value: String(value),
          updatedAt: new Date(),
        },
        create: {
          key,
          value: String(value),
          description: `System setting: ${key}`,
        },
      });
      updatedSettings.push(updatedSetting);
    }

    // Invalidate cache
    await cacheService.delete('system_settings');

    // Log audit event
    await auditService.log({
      action: 'SYSTEM_SETTINGS_UPDATED',
      userId: req.user?.id,
      resourceType: 'SystemSettings',
      details: {
        updatedSettings: Object.keys(settingsUpdates),
        changes: settingsUpdates,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    const response: AdminResponse = {
      success: true,
      message: 'System settings updated successfully',
      data: updatedSettings,
    };

    res.json(response);
  } catch (error) {
    logger.error('Update system settings error', {
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
 * @route   GET /api/v1/admin/audit-logs
 * @desc    Get audit logs
 * @access  Private (Admins only)
 */
router.get('/audit-logs', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
    const {
      page = 1,
      limit = 50,
      action,
      userId,
      resourceType,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const whereClause: any = {};

    // Role-based filtering
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      whereClause.user = {
        facilityId: req.user?.facilityId,
      };
    }

    if (action) {
      whereClause.action = action;
    }

    if (userId) {
      whereClause.userId = userId;
    }

    if (resourceType) {
      whereClause.resourceType = resourceType;
    }

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        whereClause.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        whereClause.createdAt.lte = new Date(endDate as string);
      }
    }

    const [auditLogs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: whereClause,
        skip,
        take: limitNum,
        orderBy: { [sortBy as string]: sortOrder },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
      }),
      prisma.auditLog.count({ where: whereClause }),
    ]);

    const response: AdminResponse = {
      success: true,
      message: 'Audit logs retrieved successfully',
      data: auditLogs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get audit logs error', {
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
 * @route   GET /api/v1/admin/stats
 * @desc    Get admin dashboard statistics
 * @access  Private (Admins only)
 */
router.get('/stats', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
    const facilityFilter = req.user?.role === UserRole.SUPER_ADMIN ? {} : { facilityId: req.user?.facilityId };

    const [userStats, facilityStats, activityStats, systemStats] = await Promise.all([
      // User statistics
      Promise.all([
        prisma.user.count({ where: { ...facilityFilter, status: UserStatus.ACTIVE } }),
        prisma.user.count({ where: { ...facilityFilter, status: UserStatus.INACTIVE } }),
        prisma.user.groupBy({
          by: ['role'],
          where: facilityFilter,
          _count: { id: true },
        }),
      ]),
      
      // Facility statistics (super admin only)
      req.user?.role === UserRole.SUPER_ADMIN ? Promise.all([
        prisma.facility.count({ where: { status: 'ACTIVE' } }),
        prisma.facility.count({ where: { status: 'INACTIVE' } }),
        prisma.facility.groupBy({
          by: ['type'],
          _count: { id: true },
        }),
      ]) : [0, 0, []],
      
      // Activity statistics (last 30 days)
      Promise.all([
        prisma.auditLog.count({
          where: {
            ...facilityFilter,
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        }),
        prisma.user.count({
          where: {
            ...facilityFilter,
            lastLoginAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        }),
      ]),
      
      // System statistics
      Promise.all([
        prisma.patient.count({ where: facilityFilter }),
        prisma.provider.count({ where: facilityFilter }),
        prisma.appointment.count({ where: { provider: facilityFilter } }),
        prisma.medicalRecord.count({ where: { patient: facilityFilter } }),
      ]),
    ]);

    const [activeUsers, inactiveUsers, usersByRole] = userStats;
    const [activeFacilities, inactiveFacilities, facilitiesByType] = facilityStats;
    const [recentActivity, activeUsersLast30Days] = activityStats;
    const [totalPatients, totalProviders, totalAppointments, totalMedicalRecords] = systemStats;

    const stats = {
      users: {
        active: activeUsers,
        inactive: inactiveUsers,
        total: activeUsers + inactiveUsers,
        byRole: usersByRole.reduce((acc, item) => {
          acc[item.role] = item._count.id;
          return acc;
        }, {} as Record<string, number>),
      },
      facilities: req.user?.role === UserRole.SUPER_ADMIN ? {
        active: activeFacilities,
        inactive: inactiveFacilities,
        total: activeFacilities + inactiveFacilities,
        byType: facilitiesByType.reduce((acc, item) => {
          acc[item.type] = item._count.id;
          return acc;
        }, {} as Record<string, number>),
      } : null,
      activity: {
        recentActions: recentActivity,
        activeUsersLast30Days,
      },
      system: {
        totalPatients,
        totalProviders,
        totalAppointments,
        totalMedicalRecords,
      },
    };

    const response: AdminResponse = {
      success: true,
      message: 'Admin statistics retrieved successfully',
      data: stats,
    };

    res.json(response);
  } catch (error) {
    logger.error('Get admin stats error', {
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