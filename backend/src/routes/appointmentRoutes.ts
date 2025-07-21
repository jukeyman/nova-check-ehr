/**
 * ============================================================================
 * NOVA CHECK EHR - APPOINTMENT MANAGEMENT ROUTES
 * ============================================================================
 */

import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { PrismaClient, UserRole, AppointmentStatus, AppointmentType } from '@prisma/client';
import config from '../config/config';
import logger from '../config/logger';
import { authenticateToken, requireRole } from '../middleware/auth';
import { rateLimiters } from '../middleware/security';
import auditService from '../services/auditService';
import cacheService from '../services/cacheService';
import emailService from '../services/emailService';
import smsService from '../services/smsService';
import calendarService from '../services/calendarService';
import notificationService from '../services/notificationService';

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

interface AppointmentResponse {
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
const validateCreateAppointment = [
  body('patientId')
    .isUUID()
    .withMessage('Invalid patient ID'),
  body('providerId')
    .isUUID()
    .withMessage('Invalid provider ID'),
  body('scheduledAt')
    .isISO8601()
    .withMessage('Invalid scheduled date/time'),
  body('type')
    .isIn(Object.values(AppointmentType))
    .withMessage('Invalid appointment type'),
  body('duration')
    .optional()
    .isInt({ min: 15, max: 480 })
    .withMessage('Duration must be between 15 and 480 minutes'),
  body('reason')
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage('Reason must be between 5 and 500 characters'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Notes must not exceed 1000 characters'),
  body('priority')
    .optional()
    .isIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
    .withMessage('Invalid priority level'),
];

const validateUpdateAppointment = [
  param('id').isUUID().withMessage('Invalid appointment ID'),
  body('scheduledAt')
    .optional()
    .isISO8601()
    .withMessage('Invalid scheduled date/time'),
  body('duration')
    .optional()
    .isInt({ min: 15, max: 480 })
    .withMessage('Duration must be between 15 and 480 minutes'),
  body('reason')
    .optional()
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage('Reason must be between 5 and 500 characters'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Notes must not exceed 1000 characters'),
  body('status')
    .optional()
    .isIn(Object.values(AppointmentStatus))
    .withMessage('Invalid appointment status'),
  body('priority')
    .optional()
    .isIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
    .withMessage('Invalid priority level'),
];

const validateAppointmentQuery = [
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
    .isIn(Object.values(AppointmentStatus))
    .withMessage('Invalid status filter'),
  query('type')
    .optional()
    .isIn(Object.values(AppointmentType))
    .withMessage('Invalid type filter'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date'),
];

const validateAvailabilityQuery = [
  query('providerId')
    .isUUID()
    .withMessage('Invalid provider ID'),
  query('date')
    .isISO8601()
    .withMessage('Invalid date'),
  query('duration')
    .optional()
    .isInt({ min: 15, max: 480 })
    .withMessage('Duration must be between 15 and 480 minutes'),
];

// Helper functions
const canAccessAppointment = async (currentUser: any, appointmentId: string): Promise<boolean> => {
  // Super admin can access all appointments
  if (currentUser.role === UserRole.SUPER_ADMIN) {
    return true;
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      patientId: true,
      providerId: true,
      facilityId: true,
      patient: {
        select: { userId: true },
      },
      provider: {
        select: { userId: true },
      },
    },
  });

  if (!appointment) {
    return false;
  }

  // Patients can only access their own appointments
  if (currentUser.role === UserRole.PATIENT) {
    return currentUser.id === appointment.patient?.userId;
  }

  // Providers can access their own appointments
  if ([UserRole.DOCTOR, UserRole.NURSE].includes(currentUser.role)) {
    if (currentUser.id === appointment.provider?.userId) {
      return true;
    }
    // Also check facility access
    return currentUser.facilityId === appointment.facilityId;
  }

  // Admins can access appointments in their facility
  if (currentUser.role === UserRole.ADMIN) {
    return currentUser.facilityId === appointment.facilityId;
  }

  return false;
};

const generateAppointmentNumber = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `APT-${timestamp}-${random}`.toUpperCase();
};

const isProviderAvailable = async (providerId: string, scheduledAt: Date, duration: number = 30): Promise<boolean> => {
  const endTime = new Date(scheduledAt.getTime() + duration * 60000);
  
  // Check for conflicting appointments
  const conflictingAppointments = await prisma.appointment.count({
    where: {
      providerId,
      status: {
        in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.IN_PROGRESS],
      },
      OR: [
        {
          scheduledAt: {
            gte: scheduledAt,
            lt: endTime,
          },
        },
        {
          AND: [
            { scheduledAt: { lte: scheduledAt } },
            {
              scheduledAt: {
                gte: new Date(scheduledAt.getTime() - 30 * 60000), // 30 minutes before
              },
            },
          ],
        },
      ],
    },
  });

  return conflictingAppointments === 0;
};

const sendAppointmentNotifications = async (appointment: any, action: string) => {
  try {
    const { patient, provider } = appointment;

    // Send email notifications
    if (patient?.email) {
      switch (action) {
        case 'CREATED':
          await emailService.sendAppointmentConfirmation({
            to: patient.email,
            patientName: `${patient.firstName} ${patient.lastName}`,
            providerName: `${provider.firstName} ${provider.lastName}`,
            appointmentDate: appointment.scheduledAt,
            appointmentType: appointment.type,
            facilityName: appointment.facility?.name || 'Healthcare Facility',
          });
          break;
        case 'UPDATED':
          await emailService.sendAppointmentUpdate({
            to: patient.email,
            patientName: `${patient.firstName} ${patient.lastName}`,
            providerName: `${provider.firstName} ${provider.lastName}`,
            appointmentDate: appointment.scheduledAt,
            appointmentType: appointment.type,
            status: appointment.status,
          });
          break;
        case 'CANCELLED':
          await emailService.sendAppointmentCancellation({
            to: patient.email,
            patientName: `${patient.firstName} ${patient.lastName}`,
            providerName: `${provider.firstName} ${provider.lastName}`,
            appointmentDate: appointment.scheduledAt,
            reason: appointment.cancellationReason,
          });
          break;
      }
    }

    // Send SMS notifications if phone number available
    if (patient?.phone) {
      const message = `Appointment ${action.toLowerCase()}: ${appointment.type} with Dr. ${provider.lastName} on ${new Date(appointment.scheduledAt).toLocaleDateString()}`;
      await smsService.sendSMS({
        to: patient.phone,
        message,
      });
    }

    // Send in-app notifications
    await notificationService.createNotification({
      userId: patient.userId,
      type: 'APPOINTMENT',
      title: `Appointment ${action}`,
      message: `Your appointment with Dr. ${provider.lastName} has been ${action.toLowerCase()}`,
      data: {
        appointmentId: appointment.id,
        action,
      },
    });

  } catch (error) {
    logger.error('Failed to send appointment notifications', {
      error: error.message,
      appointmentId: appointment.id,
      action,
    });
  }
};

// Routes

/**
 * @route   GET /api/v1/appointments
 * @desc    Get appointments with filtering and pagination
 * @access  Private
 */
router.get('/', authenticateToken, validateAppointmentQuery, async (req: AuthRequest, res: Response) => {
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
      status,
      type,
      patientId,
      providerId,
      facilityId,
      startDate,
      endDate,
      sortBy = 'scheduledAt',
      sortOrder = 'asc',
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause based on user role
    const where: any = {};

    // Role-based filtering
    if (req.user?.role === UserRole.PATIENT) {
      // Patients can only see their own appointments
      const patient = await prisma.patient.findFirst({
        where: { userId: req.user.id },
        select: { id: true },
      });
      if (patient) {
        where.patientId = patient.id;
      } else {
        return res.status(404).json({
          success: false,
          message: 'Patient profile not found',
        });
      }
    } else if ([UserRole.DOCTOR, UserRole.NURSE].includes(req.user?.role)) {
      // Providers can see their own appointments or facility appointments
      const provider = await prisma.provider.findFirst({
        where: { userId: req.user.id },
        select: { id: true },
      });
      if (provider) {
        where.OR = [
          { providerId: provider.id },
          { facilityId: req.user.facilityId },
        ];
      }
    } else if (req.user?.role === UserRole.ADMIN && req.user?.facilityId) {
      // Admins can see all appointments in their facility
      where.facilityId = req.user.facilityId;
    }
    // Super admins can see all appointments (no additional filtering)

    // Apply additional filters
    if (status) {
      where.status = status;
    }

    if (type) {
      where.type = type;
    }

    if (patientId) {
      where.patientId = patientId;
    }

    if (providerId) {
      where.providerId = providerId;
    }

    if (facilityId && req.user?.role === UserRole.SUPER_ADMIN) {
      where.facilityId = facilityId;
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
              patientId: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              phone: true,
              email: true,
            },
          },
          provider: {
            select: {
              id: true,
              providerNumber: true,
              firstName: true,
              lastName: true,
              specialization: true,
              type: true,
            },
          },
          facility: {
            select: {
              id: true,
              name: true,
              address: true,
            },
          },
        },
      }),
      prisma.appointment.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    const response: AppointmentResponse = {
      success: true,
      message: 'Appointments retrieved successfully',
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
    logger.error('Get appointments error', {
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
 * @route   GET /api/v1/appointments/:id
 * @desc    Get appointment by ID
 * @access  Private
 */
router.get('/:id', authenticateToken, [param('id').isUUID().withMessage('Invalid appointment ID')], async (req: AuthRequest, res: Response) => {
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

    // Check access permissions
    const hasAccess = await canAccessAppointment(req.user, id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            phone: true,
            email: true,
            address: true,
            insurance: true,
          },
        },
        provider: {
          select: {
            id: true,
            providerNumber: true,
            firstName: true,
            lastName: true,
            specialization: true,
            type: true,
            phone: true,
            email: true,
          },
        },
        facility: {
          select: {
            id: true,
            name: true,
            address: true,
            phone: true,
          },
        },
        medicalRecords: {
          select: {
            id: true,
            type: true,
            title: true,
            description: true,
            createdAt: true,
          },
        },
      },
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found',
      });
    }

    const response: AppointmentResponse = {
      success: true,
      message: 'Appointment retrieved successfully',
      data: { appointment },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get appointment error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      appointmentId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/appointments
 * @desc    Create a new appointment
 * @access  Private
 */
router.post('/', authenticateToken, rateLimiters.api, validateCreateAppointment, async (req: AuthRequest, res: Response) => {
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
      patientId,
      providerId,
      scheduledAt,
      type,
      duration = 30,
      reason,
      notes,
      priority = 'NORMAL',
    } = req.body;

    const scheduledDate = new Date(scheduledAt);

    // Validate appointment is in the future
    if (scheduledDate <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Appointment must be scheduled for a future date/time',
      });
    }

    // Verify patient exists and user has access
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      include: { user: true },
    });

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found',
      });
    }

    // Check patient access permissions
    if (req.user?.role === UserRole.PATIENT && req.user.id !== patient.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Verify provider exists and is available
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: true, facility: true },
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found',
      });
    }

    if (provider.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: 'Provider is not available for appointments',
      });
    }

    // Check provider availability
    const isAvailable = await isProviderAvailable(providerId, scheduledDate, duration);
    if (!isAvailable) {
      return res.status(409).json({
        success: false,
        message: 'Provider is not available at the requested time',
      });
    }

    // Generate appointment number
    const appointmentNumber = generateAppointmentNumber();

    // Create appointment
    const appointment = await prisma.appointment.create({
      data: {
        appointmentNumber,
        patientId,
        providerId,
        facilityId: provider.facilityId,
        scheduledAt: scheduledDate,
        type,
        duration,
        reason,
        notes,
        priority,
        status: AppointmentStatus.SCHEDULED,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            userId: true,
          },
        },
        provider: {
          select: {
            id: true,
            providerNumber: true,
            firstName: true,
            lastName: true,
            specialization: true,
          },
        },
        facility: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Send notifications
    await sendAppointmentNotifications(appointment, 'CREATED');

    // Cache appointment data
    await cacheService.cacheAppointmentData(appointment.id, appointment);

    // Log audit event
    await auditService.log({
      action: 'APPOINTMENT_CREATED',
      userId: req.user?.id,
      resourceType: 'Appointment',
      resourceId: appointment.id,
      details: {
        appointmentNumber: appointment.appointmentNumber,
        patientId,
        providerId,
        scheduledAt: scheduledDate,
        type,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Appointment created successfully', {
      appointmentId: appointment.id,
      appointmentNumber: appointment.appointmentNumber,
      patientId,
      providerId,
      createdBy: req.user?.id,
    });

    const response: AppointmentResponse = {
      success: true,
      message: 'Appointment created successfully',
      data: { appointment },
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Create appointment error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during appointment creation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   PUT /api/v1/appointments/:id
 * @desc    Update appointment
 * @access  Private
 */
router.put('/:id', authenticateToken, validateUpdateAppointment, async (req: AuthRequest, res: Response) => {
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

    // Check access permissions
    const hasAccess = await canAccessAppointment(req.user, id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Find existing appointment
    const existingAppointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: { include: { user: true } },
        provider: { include: { user: true } },
        facility: true,
      },
    });

    if (!existingAppointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found',
      });
    }

    // Check if appointment can be modified
    if (existingAppointment.status === AppointmentStatus.COMPLETED) {
      return res.status(400).json({
        success: false,
        message: 'Cannot modify completed appointment',
      });
    }

    // Prepare update data
    const allowedUpdates: any = {};
    const allowedFields = ['scheduledAt', 'duration', 'reason', 'notes', 'priority'];

    // Only healthcare providers can update status
    if ([UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.SUPER_ADMIN].includes(req.user?.role)) {
      allowedFields.push('status');
    }

    // Filter allowed updates
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        if (field === 'scheduledAt') {
          const newScheduledAt = new Date(updateData[field]);
          if (newScheduledAt <= new Date()) {
            return res.status(400).json({
              success: false,
              message: 'Appointment must be scheduled for a future date/time',
            });
          }
          // Check provider availability for new time
          if (newScheduledAt.getTime() !== existingAppointment.scheduledAt.getTime()) {
            const isAvailable = await isProviderAvailable(
              existingAppointment.providerId,
              newScheduledAt,
              updateData.duration || existingAppointment.duration
            );
            if (!isAvailable) {
              return res.status(409).json({
                success: false,
                message: 'Provider is not available at the requested time',
              });
            }
          }
          allowedUpdates[field] = newScheduledAt;
        } else {
          allowedUpdates[field] = updateData[field];
        }
      }
    }

    allowedUpdates.updatedAt = new Date();

    // Update appointment
    const updatedAppointment = await prisma.appointment.update({
      where: { id },
      data: allowedUpdates,
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            userId: true,
          },
        },
        provider: {
          select: {
            id: true,
            providerNumber: true,
            firstName: true,
            lastName: true,
            specialization: true,
          },
        },
        facility: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Send notifications if significant changes
    if (updateData.scheduledAt || updateData.status) {
      await sendAppointmentNotifications(updatedAppointment, 'UPDATED');
    }

    // Update cache
    await cacheService.cacheAppointmentData(id, updatedAppointment);

    // Log audit event
    await auditService.log({
      action: 'APPOINTMENT_UPDATED',
      userId: req.user?.id,
      resourceType: 'Appointment',
      resourceId: id,
      details: {
        updatedFields: Object.keys(allowedUpdates),
        appointmentNumber: existingAppointment.appointmentNumber,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Appointment updated successfully', {
      appointmentId: id,
      updatedBy: req.user?.id,
      updatedFields: Object.keys(allowedUpdates),
    });

    const response: AppointmentResponse = {
      success: true,
      message: 'Appointment updated successfully',
      data: { appointment: updatedAppointment },
    };

    res.json(response);
  } catch (error) {
    logger.error('Update appointment error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      appointmentId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during appointment update',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   DELETE /api/v1/appointments/:id
 * @desc    Cancel appointment
 * @access  Private
 */
router.delete('/:id', authenticateToken, [
  param('id').isUUID().withMessage('Invalid appointment ID'),
  body('reason')
    .optional()
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage('Cancellation reason must be between 5 and 500 characters'),
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
    const { reason } = req.body;

    // Check access permissions
    const hasAccess = await canAccessAppointment(req.user, id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Find existing appointment
    const existingAppointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: { include: { user: true } },
        provider: { include: { user: true } },
        facility: true,
      },
    });

    if (!existingAppointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found',
      });
    }

    // Check if appointment can be cancelled
    if ([AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED].includes(existingAppointment.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel completed or already cancelled appointment',
      });
    }

    // Update appointment status to cancelled
    const cancelledAppointment = await prisma.appointment.update({
      where: { id },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancellationReason: reason,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            userId: true,
          },
        },
        provider: {
          select: {
            id: true,
            providerNumber: true,
            firstName: true,
            lastName: true,
            specialization: true,
          },
        },
        facility: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Send notifications
    await sendAppointmentNotifications(cancelledAppointment, 'CANCELLED');

    // Update cache
    await cacheService.cacheAppointmentData(id, cancelledAppointment);

    // Log audit event
    await auditService.log({
      action: 'APPOINTMENT_CANCELLED',
      userId: req.user?.id,
      resourceType: 'Appointment',
      resourceId: id,
      details: {
        appointmentNumber: existingAppointment.appointmentNumber,
        reason,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Appointment cancelled successfully', {
      appointmentId: id,
      cancelledBy: req.user?.id,
      reason,
    });

    const response: AppointmentResponse = {
      success: true,
      message: 'Appointment cancelled successfully',
      data: { appointment: cancelledAppointment },
    };

    res.json(response);
  } catch (error) {
    logger.error('Cancel appointment error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      appointmentId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during appointment cancellation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/appointments/availability
 * @desc    Check provider availability
 * @access  Private
 */
router.get('/availability', authenticateToken, validateAvailabilityQuery, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { providerId, date, duration = 30 } = req.query;

    // Verify provider exists
    const provider = await prisma.provider.findUnique({
      where: { id: providerId as string },
      select: { id: true, status: true },
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found',
      });
    }

    if (provider.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: 'Provider is not available',
      });
    }

    // Get availability for the specified date
    const availability = await calendarService.getProviderAvailability(providerId as string, {
      date: date as string,
      duration: parseInt(duration as string),
    });

    const response: AppointmentResponse = {
      success: true,
      message: 'Provider availability retrieved successfully',
      data: { availability },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get availability error', {
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
 * @route   GET /api/v1/appointments/stats
 * @desc    Get appointment statistics
 * @access  Private (Healthcare providers)
 */
router.get('/stats', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.SUPER_ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
    const facilityFilter = req.user?.role !== UserRole.SUPER_ADMIN && req.user?.facilityId
      ? { facilityId: req.user.facilityId }
      : {};

    const [totalAppointments, scheduledAppointments, completedAppointments, cancelledAppointments, appointmentsByType, appointmentsByStatus] = await Promise.all([
      prisma.appointment.count({ where: facilityFilter }),
      prisma.appointment.count({ where: { ...facilityFilter, status: AppointmentStatus.SCHEDULED } }),
      prisma.appointment.count({ where: { ...facilityFilter, status: AppointmentStatus.COMPLETED } }),
      prisma.appointment.count({ where: { ...facilityFilter, status: AppointmentStatus.CANCELLED } }),
      prisma.appointment.groupBy({
        by: ['type'],
        where: facilityFilter,
        _count: {
          id: true,
        },
      }),
      prisma.appointment.groupBy({
        by: ['status'],
        where: facilityFilter,
        _count: {
          id: true,
        },
      }),
    ]);

    const typeStats = appointmentsByType.reduce((acc, item) => {
      acc[item.type] = item._count.id;
      return acc;
    }, {} as Record<string, number>);

    const statusStats = appointmentsByStatus.reduce((acc, item) => {
      acc[item.status] = item._count.id;
      return acc;
    }, {} as Record<string, number>);

    const stats = {
      total: totalAppointments,
      scheduled: scheduledAppointments,
      completed: completedAppointments,
      cancelled: cancelledAppointments,
      byType: typeStats,
      byStatus: statusStats,
    };

    const response: AppointmentResponse = {
      success: true,
      message: 'Appointment statistics retrieved successfully',
      data: { stats },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get appointment stats error', {
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