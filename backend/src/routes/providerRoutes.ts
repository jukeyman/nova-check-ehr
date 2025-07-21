/**
 * ============================================================================
 * NOVA CHECK EHR - PROVIDER MANAGEMENT ROUTES
 * ============================================================================
 */

import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { PrismaClient, UserRole, ProviderStatus, ProviderType } from '@prisma/client';
import config from '../config/config';
import logger from '../config/logger';
import { authenticateToken, requireRole } from '../middleware/auth';
import { rateLimiters } from '../middleware/security';
import auditService from '../services/auditService';
import cacheService from '../services/cacheService';
import emailService from '../services/emailService';
import calendarService from '../services/calendarService';

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

interface ProviderResponse {
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
const validateCreateProvider = [
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('phone')
    .isMobilePhone('any')
    .withMessage('Invalid phone number'),
  body('specialization')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Specialization must be between 2 and 100 characters'),
  body('licenseNumber')
    .trim()
    .isLength({ min: 5, max: 50 })
    .withMessage('License number must be between 5 and 50 characters'),
  body('type')
    .isIn(Object.values(ProviderType))
    .withMessage('Invalid provider type'),
  body('yearsOfExperience')
    .optional()
    .isInt({ min: 0, max: 60 })
    .withMessage('Years of experience must be between 0 and 60'),
  body('education')
    .optional()
    .isArray()
    .withMessage('Education must be an array'),
  body('certifications')
    .optional()
    .isArray()
    .withMessage('Certifications must be an array'),
  body('languages')
    .optional()
    .isArray()
    .withMessage('Languages must be an array'),
];

const validateUpdateProvider = [
  param('id').isUUID().withMessage('Invalid provider ID'),
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
  body('specialization')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Specialization must be between 2 and 100 characters'),
  body('yearsOfExperience')
    .optional()
    .isInt({ min: 0, max: 60 })
    .withMessage('Years of experience must be between 0 and 60'),
];

const validateProviderQuery = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('status')
    .optional()
    .isIn(Object.values(ProviderStatus))
    .withMessage('Invalid status filter'),
  query('type')
    .optional()
    .isIn(Object.values(ProviderType))
    .withMessage('Invalid type filter'),
  query('specialization')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Specialization filter must be at least 2 characters'),
];

const validateSchedule = [
  param('id').isUUID().withMessage('Invalid provider ID'),
  body('schedule')
    .isArray()
    .withMessage('Schedule must be an array'),
  body('schedule.*.dayOfWeek')
    .isInt({ min: 0, max: 6 })
    .withMessage('Day of week must be between 0 (Sunday) and 6 (Saturday)'),
  body('schedule.*.startTime')
    .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('Start time must be in HH:MM format'),
  body('schedule.*.endTime')
    .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('End time must be in HH:MM format'),
  body('schedule.*.isAvailable')
    .isBoolean()
    .withMessage('isAvailable must be a boolean'),
];

// Helper functions
const canManageProvider = (currentUser: any, targetProviderId?: string): boolean => {
  // Super admin can manage all providers
  if (currentUser.role === UserRole.SUPER_ADMIN) {
    return true;
  }

  // Admin can manage providers in their facility
  if (currentUser.role === UserRole.ADMIN && currentUser.facilityId) {
    return true;
  }

  // Providers can only manage their own profile
  if ([UserRole.DOCTOR, UserRole.NURSE].includes(currentUser.role)) {
    return currentUser.id === targetProviderId;
  }

  return false;
};

const generateProviderNumber = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `PRV-${timestamp}-${random}`.toUpperCase();
};

// Routes

/**
 * @route   GET /api/v1/providers
 * @desc    Get all providers with filtering and pagination
 * @access  Private
 */
router.get('/', authenticateToken, validateProviderQuery, async (req: AuthRequest, res: Response) => {
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
      status,
      type,
      specialization,
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
    } else if (facilityId) {
      where.facilityId = facilityId;
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { providerNumber: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
        { specialization: { contains: search as string, mode: 'insensitive' } },
        { licenseNumber: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    if (type) {
      where.type = type;
    }

    if (specialization) {
      where.specialization = { contains: specialization as string, mode: 'insensitive' };
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get providers with pagination
    const [providers, total] = await Promise.all([
      prisma.provider.findMany({
        where,
        skip,
        take: limitNum,
        orderBy,
        select: {
          id: true,
          providerNumber: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          specialization: true,
          type: true,
          status: true,
          yearsOfExperience: true,
          licenseNumber: true,
          rating: true,
          totalAppointments: true,
          createdAt: true,
          updatedAt: true,
          facility: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              lastLoginAt: true,
              emailVerified: true,
            },
          },
        },
      }),
      prisma.provider.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    const response: ProviderResponse = {
      success: true,
      message: 'Providers retrieved successfully',
      data: { providers },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get providers error', {
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
 * @route   GET /api/v1/providers/:id
 * @desc    Get provider by ID
 * @access  Private
 */
router.get('/:id', authenticateToken, [param('id').isUUID().withMessage('Invalid provider ID')], async (req: AuthRequest, res: Response) => {
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

    const provider = await prisma.provider.findUnique({
      where: { id },
      include: {
        facility: {
          select: {
            id: true,
            name: true,
            address: true,
            phone: true,
          },
        },
        user: {
          select: {
            id: true,
            email: true,
            lastLoginAt: true,
            emailVerified: true,
          },
        },
        schedule: {
          orderBy: { dayOfWeek: 'asc' },
        },
        appointments: {
          take: 10,
          orderBy: { scheduledAt: 'desc' },
          select: {
            id: true,
            type: true,
            status: true,
            scheduledAt: true,
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                patientId: true,
              },
            },
          },
        },
        reviews: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            patient: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found',
      });
    }

    // Check access permissions for detailed view
    if (req.user?.role === UserRole.PATIENT) {
      // Patients can only see basic provider info
      const publicProvider = {
        id: provider.id,
        providerNumber: provider.providerNumber,
        firstName: provider.firstName,
        lastName: provider.lastName,
        specialization: provider.specialization,
        type: provider.type,
        yearsOfExperience: provider.yearsOfExperience,
        rating: provider.rating,
        totalAppointments: provider.totalAppointments,
        facility: provider.facility,
        schedule: provider.schedule,
        reviews: provider.reviews,
      };

      return res.json({
        success: true,
        message: 'Provider retrieved successfully',
        data: { provider: publicProvider },
      });
    }

    // Full access for healthcare providers and admins
    const response: ProviderResponse = {
      success: true,
      message: 'Provider retrieved successfully',
      data: { provider },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get provider error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      providerId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/providers
 * @desc    Create a new provider
 * @access  Private (Admin, Super Admin)
 */
router.post('/', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), rateLimiters.api, validateCreateProvider, async (req: AuthRequest, res: Response) => {
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
      firstName,
      lastName,
      email,
      phone,
      specialization,
      licenseNumber,
      type,
      yearsOfExperience,
      education,
      certifications,
      languages,
      bio,
      facilityId,
    } = req.body;

    // Check if provider with same email or license already exists
    const existingProvider = await prisma.provider.findFirst({
      where: {
        OR: [
          { email },
          { licenseNumber },
        ],
      },
    });

    if (existingProvider) {
      return res.status(409).json({
        success: false,
        message: 'Provider with this email or license number already exists',
      });
    }

    // Generate unique provider number
    const providerNumber = generateProviderNumber();

    // Determine facility ID
    const targetFacilityId = facilityId || req.user?.facilityId;
    if (!targetFacilityId && req.user?.role !== UserRole.SUPER_ADMIN) {
      return res.status(400).json({
        success: false,
        message: 'Facility ID is required',
      });
    }

    // Create provider in transaction
    const provider = await prisma.$transaction(async (tx) => {
      // Create user account first
      const user = await tx.user.create({
        data: {
          email,
          password: 'temp_password_' + Math.random().toString(36).substr(2, 8), // Temporary password
          role: type === ProviderType.DOCTOR ? UserRole.DOCTOR : UserRole.NURSE,
          firstName,
          lastName,
          phone,
          facilityId: targetFacilityId,
          emailVerified: false,
          status: 'PENDING',
        },
      });

      // Create provider profile
      const newProvider = await tx.provider.create({
        data: {
          providerNumber,
          userId: user.id,
          firstName,
          lastName,
          email,
          phone,
          specialization,
          licenseNumber,
          type,
          yearsOfExperience: yearsOfExperience || 0,
          education: education ? JSON.stringify(education) : null,
          certifications: certifications ? JSON.stringify(certifications) : null,
          languages: languages ? JSON.stringify(languages) : null,
          bio,
          facilityId: targetFacilityId,
          status: ProviderStatus.PENDING,
          rating: 0,
          totalAppointments: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Create default schedule (Monday to Friday, 9 AM to 5 PM)
      const defaultSchedule = [];
      for (let day = 1; day <= 5; day++) {
        defaultSchedule.push({
          providerId: newProvider.id,
          dayOfWeek: day,
          startTime: '09:00',
          endTime: '17:00',
          isAvailable: true,
          maxAppointments: 16, // 30-minute slots
        });
      }

      await tx.providerSchedule.createMany({
        data: defaultSchedule,
      });

      return newProvider;
    });

    // Send welcome email
    await emailService.sendProviderWelcomeEmail({
      to: email,
      firstName,
      providerNumber,
      facilityName: targetFacilityId ? 'Your Healthcare Facility' : 'Nova Check EHR',
      loginUrl: `${config.frontend.url}/login`,
    });

    // Log audit event
    await auditService.log({
      action: 'PROVIDER_CREATED',
      userId: req.user?.id,
      resourceType: 'Provider',
      resourceId: provider.id,
      details: {
        providerNumber: provider.providerNumber,
        providerName: `${firstName} ${lastName}`,
        specialization,
        type,
        facilityId: targetFacilityId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Provider created successfully', {
      providerId: provider.id,
      providerNumber: provider.providerNumber,
      createdBy: req.user?.id,
    });

    const response: ProviderResponse = {
      success: true,
      message: 'Provider created successfully',
      data: { provider },
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Create provider error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during provider creation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   PUT /api/v1/providers/:id
 * @desc    Update provider
 * @access  Private
 */
router.put('/:id', authenticateToken, validateUpdateProvider, async (req: AuthRequest, res: Response) => {
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

    // Check permissions
    if (!canManageProvider(req.user, id)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Find existing provider
    const existingProvider = await prisma.provider.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!existingProvider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found',
      });
    }

    // Prepare update data
    const allowedUpdates: any = {};
    const allowedFields = ['firstName', 'lastName', 'phone', 'specialization', 'yearsOfExperience', 'bio', 'education', 'certifications', 'languages'];

    // Only admins can update status and license
    if ([UserRole.ADMIN, UserRole.SUPER_ADMIN].includes(req.user?.role)) {
      allowedFields.push('status', 'licenseNumber', 'type');
    }

    // Filter allowed updates
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        if (['education', 'certifications', 'languages'].includes(field) && Array.isArray(updateData[field])) {
          allowedUpdates[field] = JSON.stringify(updateData[field]);
        } else {
          allowedUpdates[field] = updateData[field];
        }
      }
    }

    allowedUpdates.updatedAt = new Date();

    // Update provider and user in transaction
    const updatedProvider = await prisma.$transaction(async (tx) => {
      // Update provider
      const provider = await tx.provider.update({
        where: { id },
        data: allowedUpdates,
        select: {
          id: true,
          providerNumber: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          specialization: true,
          type: true,
          status: true,
          yearsOfExperience: true,
          licenseNumber: true,
          bio: true,
          education: true,
          certifications: true,
          languages: true,
          rating: true,
          totalAppointments: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Update user if name or phone changed
      if (updateData.firstName || updateData.lastName || updateData.phone) {
        await tx.user.update({
          where: { id: existingProvider.userId },
          data: {
            firstName: updateData.firstName || existingProvider.firstName,
            lastName: updateData.lastName || existingProvider.lastName,
            phone: updateData.phone || existingProvider.phone,
          },
        });
      }

      return provider;
    });

    // Invalidate provider cache
    await cacheService.invalidateProviderCache(id);

    // Log audit event
    await auditService.log({
      action: 'PROVIDER_UPDATED',
      userId: req.user?.id,
      resourceType: 'Provider',
      resourceId: id,
      details: {
        updatedFields: Object.keys(allowedUpdates),
        providerNumber: existingProvider.providerNumber,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Provider updated successfully', {
      providerId: id,
      updatedBy: req.user?.id,
      updatedFields: Object.keys(allowedUpdates),
    });

    const response: ProviderResponse = {
      success: true,
      message: 'Provider updated successfully',
      data: { provider: updatedProvider },
    };

    res.json(response);
  } catch (error) {
    logger.error('Update provider error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      providerId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during provider update',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/providers/:id/schedule
 * @desc    Get provider schedule
 * @access  Private
 */
router.get('/:id/schedule', authenticateToken, [param('id').isUUID().withMessage('Invalid provider ID')], async (req: AuthRequest, res: Response) => {
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
    const { date, week, month } = req.query;

    // Get provider schedule
    const schedule = await prisma.providerSchedule.findMany({
      where: { providerId: id },
      orderBy: { dayOfWeek: 'asc' },
    });

    if (!schedule.length) {
      return res.status(404).json({
        success: false,
        message: 'Provider schedule not found',
      });
    }

    // Get availability for specific date/period if requested
    let availability = null;
    if (date || week || month) {
      availability = await calendarService.getProviderAvailability(id, {
        date: date as string,
        week: week as string,
        month: month as string,
      });
    }

    const response: ProviderResponse = {
      success: true,
      message: 'Provider schedule retrieved successfully',
      data: {
        schedule,
        availability,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get provider schedule error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      providerId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   PUT /api/v1/providers/:id/schedule
 * @desc    Update provider schedule
 * @access  Private (Provider themselves or Admin)
 */
router.put('/:id/schedule', authenticateToken, validateSchedule, async (req: AuthRequest, res: Response) => {
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
    const { schedule } = req.body;

    // Check permissions
    if (!canManageProvider(req.user, id)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Verify provider exists
    const provider = await prisma.provider.findUnique({
      where: { id },
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found',
      });
    }

    // Update schedule in transaction
    const updatedSchedule = await prisma.$transaction(async (tx) => {
      // Delete existing schedule
      await tx.providerSchedule.deleteMany({
        where: { providerId: id },
      });

      // Create new schedule
      const scheduleData = schedule.map((item: any) => ({
        providerId: id,
        dayOfWeek: item.dayOfWeek,
        startTime: item.startTime,
        endTime: item.endTime,
        isAvailable: item.isAvailable,
        maxAppointments: item.maxAppointments || 16,
      }));

      await tx.providerSchedule.createMany({
        data: scheduleData,
      });

      return tx.providerSchedule.findMany({
        where: { providerId: id },
        orderBy: { dayOfWeek: 'asc' },
      });
    });

    // Invalidate provider cache
    await cacheService.invalidateProviderCache(id);

    // Log audit event
    await auditService.log({
      action: 'PROVIDER_SCHEDULE_UPDATED',
      userId: req.user?.id,
      resourceType: 'ProviderSchedule',
      resourceId: id,
      details: {
        providerId: id,
        scheduleItems: schedule.length,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Provider schedule updated successfully', {
      providerId: id,
      updatedBy: req.user?.id,
      scheduleItems: schedule.length,
    });

    const response: ProviderResponse = {
      success: true,
      message: 'Provider schedule updated successfully',
      data: { schedule: updatedSchedule },
    };

    res.json(response);
  } catch (error) {
    logger.error('Update provider schedule error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      providerId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during schedule update',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/providers/:id/appointments
 * @desc    Get provider appointments
 * @access  Private
 */
router.get('/:id/appointments', authenticateToken, [
  param('id').isUUID().withMessage('Invalid provider ID'),
  ...validateProviderQuery,
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

    const { id } = req.params;
    const {
      page = 1,
      limit = 20,
      status,
      startDate,
      endDate,
      sortBy = 'scheduledAt',
      sortOrder = 'asc',
    } = req.query;

    // Check permissions
    if (!canManageProvider(req.user, id) && req.user?.role !== UserRole.PATIENT) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = { providerId: id };

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.scheduledAt = {};
      if (startDate) {
        where.scheduledAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.scheduledAt.lte = new Date(endDate as string);
      }
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get appointments with pagination
    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        skip,
        take: limitNum,
        orderBy,
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              patientId: true,
              dateOfBirth: true,
              phone: true,
            },
          },
          facility: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      prisma.appointment.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    const response: ProviderResponse = {
      success: true,
      message: 'Provider appointments retrieved successfully',
      data: { appointments },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get provider appointments error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      providerId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/providers/stats
 * @desc    Get provider statistics
 * @access  Private (Admin, Super Admin)
 */
router.get('/stats', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
    const facilityFilter = req.user?.role !== UserRole.SUPER_ADMIN && req.user?.facilityId
      ? { facilityId: req.user.facilityId }
      : {};

    const [totalProviders, activeProviders, pendingProviders, providersByType, providersBySpecialization] = await Promise.all([
      prisma.provider.count({ where: facilityFilter }),
      prisma.provider.count({ where: { ...facilityFilter, status: ProviderStatus.ACTIVE } }),
      prisma.provider.count({ where: { ...facilityFilter, status: ProviderStatus.PENDING } }),
      prisma.provider.groupBy({
        by: ['type'],
        where: facilityFilter,
        _count: {
          id: true,
        },
      }),
      prisma.provider.groupBy({
        by: ['specialization'],
        where: facilityFilter,
        _count: {
          id: true,
        },
        take: 10,
        orderBy: {
          _count: {
            id: 'desc',
          },
        },
      }),
    ]);

    const typeStats = providersByType.reduce((acc, item) => {
      acc[item.type] = item._count.id;
      return acc;
    }, {} as Record<string, number>);

    const specializationStats = providersBySpecialization.reduce((acc, item) => {
      acc[item.specialization] = item._count.id;
      return acc;
    }, {} as Record<string, number>);

    const stats = {
      total: totalProviders,
      active: activeProviders,
      pending: pendingProviders,
      byType: typeStats,
      bySpecialization: specializationStats,
    };

    const response: ProviderResponse = {
      success: true,
      message: 'Provider statistics retrieved successfully',
      data: { stats },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get provider stats error', {
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