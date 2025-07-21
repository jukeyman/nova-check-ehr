/**
 * ============================================================================
 * NOVA CHECK EHR - APPOINTMENT ROUTES
 * ============================================================================
 * 
 * RESTful API routes for appointment management operations.
 * Handles scheduling, rescheduling, cancellation, and provider schedules.
 */

import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { AppointmentModel, createApiResponse, createErrorResponse, validatePagination } from '../models';
import { authenticateToken, requireRole } from '../middleware/auth';
import { createAuditMiddleware } from '../models/Audit';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';

// ============================================================================
// ROUTER SETUP
// ============================================================================

const router = Router();
const prisma = new PrismaClient();
const appointmentModel = new AppointmentModel(prisma);
const auditMiddleware = createAuditMiddleware(prisma);

// ============================================================================
// VALIDATION RULES
// ============================================================================

const createAppointmentValidation = [
  body('patientId').isUUID(),
  body('providerId').isUUID(),
  body('appointmentDate').isISO8601().toDate(),
  body('startTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('endTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('type').isIn(['ROUTINE', 'URGENT', 'EMERGENCY', 'FOLLOW_UP', 'CONSULTATION', 'PROCEDURE']),
  body('reason').notEmpty().trim().isLength({ min: 1, max: 500 }),
  body('notes').optional().trim().isLength({ max: 1000 }),
  body('duration').optional().isInt({ min: 15, max: 480 }),
  body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
];

const updateAppointmentValidation = [
  param('id').isUUID(),
  body('appointmentDate').optional().isISO8601().toDate(),
  body('startTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('endTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('type').optional().isIn(['ROUTINE', 'URGENT', 'EMERGENCY', 'FOLLOW_UP', 'CONSULTATION', 'PROCEDURE']),
  body('reason').optional().trim().isLength({ min: 1, max: 500 }),
  body('notes').optional().trim().isLength({ max: 1000 }),
  body('status').optional().isIn(['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
  body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
];

const searchValidation = [
  query('search').optional().trim().isLength({ min: 1, max: 200 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sortBy').optional().isIn(['appointmentDate', 'startTime', 'createdAt', 'updatedAt']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('status').optional().isIn(['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
  query('type').optional().isIn(['ROUTINE', 'URGENT', 'EMERGENCY', 'FOLLOW_UP', 'CONSULTATION', 'PROCEDURE']),
  query('patientId').optional().isUUID(),
  query('providerId').optional().isUUID(),
  query('startDate').optional().isISO8601().toDate(),
  query('endDate').optional().isISO8601().toDate(),
];

const availabilityValidation = [
  query('providerId').isUUID(),
  query('date').isISO8601().toDate(),
  query('duration').optional().isInt({ min: 15, max: 480 }).toInt(),
];

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Validate request and handle errors
 */
const handleValidation = (req: Request, res: Response, next: any) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(
      createErrorResponse('Validation failed', errors.array().map(e => e.msg).join(', '))
    );
  }
  next();
};

/**
 * Check if appointment exists and user has access
 */
const checkAppointmentAccess = async (req: Request, res: Response, next: any) => {
  try {
    const { id } = req.params;
    const appointment = await appointmentModel.findById(id);
    
    if (!appointment) {
      return res.status(404).json(
        createErrorResponse('Appointment not found')
      );
    }

    // Store appointment in request for use in route handlers
    (req as any).appointment = appointment;
    next();
  } catch (error) {
    logger.error('Error checking appointment access:', error);
    res.status(500).json(
      createErrorResponse('Internal server error')
    );
  }
};

/**
 * Validate appointment time constraints
 */
const validateAppointmentTime = (req: Request, res: Response, next: any) => {
  const { startTime, endTime, appointmentDate } = req.body;
  
  if (startTime && endTime) {
    const start = new Date(`2000-01-01T${startTime}:00`);
    const end = new Date(`2000-01-01T${endTime}:00`);
    
    if (start >= end) {
      return res.status(400).json(
        createErrorResponse('End time must be after start time')
      );
    }
  }
  
  if (appointmentDate) {
    const appointmentDateTime = new Date(appointmentDate);
    const now = new Date();
    
    if (appointmentDateTime < now) {
      return res.status(400).json(
        createErrorResponse('Appointment date cannot be in the past')
      );
    }
  }
  
  next();
};

// ============================================================================
// ROUTES
// ============================================================================

/**
 * @route   POST /api/appointments
 * @desc    Create a new appointment
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  createAppointmentValidation,
  handleValidation,
  validateAppointmentTime,
  auditMiddleware('APPOINTMENT_CREATE'),
  async (req: Request, res: Response) => {
    try {
      const appointmentData = req.body;
      const createdBy = (req as any).user.id;

      // Check for conflicts
      const conflicts = await appointmentModel.checkConflicts(
        appointmentData.providerId,
        appointmentData.appointmentDate,
        appointmentData.startTime,
        appointmentData.endTime
      );

      if (conflicts.length > 0) {
        return res.status(409).json(
          createErrorResponse('Appointment conflicts with existing appointments', 
            `Conflicts found: ${conflicts.map(c => c.reason).join(', ')}`)
        );
      }

      const appointment = await appointmentModel.create({
        ...appointmentData,
        createdBy,
      });

      logger.info(`Appointment created: ${appointment.id}`, {
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        providerId: appointment.providerId,
        createdBy,
      });

      res.status(201).json(
        createApiResponse(appointment, true, 'Appointment created successfully')
      );
    } catch (error) {
      logger.error('Error creating appointment:', error);
      res.status(500).json(
        createErrorResponse('Failed to create appointment')
      );
    }
  }
);

/**
 * @route   GET /api/appointments
 * @desc    Get appointments with search and pagination
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  searchValidation,
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const pagination = validatePagination({
        page: req.query.page as any,
        limit: req.query.limit as any,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc',
      });

      const filters = {
        search: req.query.search as string,
        status: req.query.status as any,
        type: req.query.type as any,
        patientId: req.query.patientId as string,
        providerId: req.query.providerId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        priority: req.query.priority as any,
      };

      // Remove undefined values
      Object.keys(filters).forEach(key => {
        if (filters[key as keyof typeof filters] === undefined) {
          delete filters[key as keyof typeof filters];
        }
      });

      const result = await appointmentModel.findMany(filters, pagination);

      res.json(
        createApiResponse(result.data, true, undefined, result.pagination)
      );
    } catch (error) {
      logger.error('Error fetching appointments:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch appointments')
      );
    }
  }
);

/**
 * @route   GET /api/appointments/stats
 * @desc    Get appointment statistics
 * @access  Private (Admin, Provider)
 */
router.get('/stats',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  async (req: Request, res: Response) => {
    try {
      const stats = await appointmentModel.getStats();

      res.json(
        createApiResponse(stats, true, 'Appointment statistics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching appointment stats:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch appointment statistics')
      );
    }
  }
);

/**
 * @route   GET /api/appointments/availability
 * @desc    Check provider availability for appointment scheduling
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/availability',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  availabilityValidation,
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const { providerId, date, duration } = req.query;

      const schedule = await appointmentModel.getProviderSchedule(
        providerId as string,
        new Date(date as string),
        duration as any
      );

      res.json(
        createApiResponse(schedule, true, 'Provider availability retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching provider availability:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch provider availability')
      );
    }
  }
);

/**
 * @route   GET /api/appointments/today
 * @desc    Get today's appointments for a provider
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/today',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [
    query('providerId').optional().isUUID(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const providerId = req.query.providerId as string || (req as any).user.id;

      const appointments = await appointmentModel.getTodaysAppointments(providerId);

      res.json(
        createApiResponse(appointments, true, "Today's appointments retrieved successfully")
      );
    } catch (error) {
      logger.error('Error fetching today\'s appointments:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch today\'s appointments')
      );
    }
  }
);

/**
 * @route   GET /api/appointments/upcoming
 * @desc    Get upcoming appointments for a patient
 * @access  Private (Admin, Provider, Staff, Patient)
 */
router.get('/upcoming',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF', 'PATIENT']),
  [
    query('patientId').optional().isUUID(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const patientId = req.query.patientId as string || (req as any).user.patientId;
      const limit = req.query.limit as any || 10;

      if (!patientId) {
        return res.status(400).json(
          createErrorResponse('Patient ID is required')
        );
      }

      const appointments = await appointmentModel.getUpcomingAppointments(patientId, limit);

      res.json(
        createApiResponse(appointments, true, 'Upcoming appointments retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching upcoming appointments:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch upcoming appointments')
      );
    }
  }
);

/**
 * @route   GET /api/appointments/:id
 * @desc    Get appointment by ID
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('id').isUUID()],
  handleValidation,
  checkAppointmentAccess,
  auditMiddleware('APPOINTMENT_VIEW'),
  async (req: Request, res: Response) => {
    try {
      const appointment = (req as any).appointment;

      res.json(
        createApiResponse(appointment, true, 'Appointment retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching appointment:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch appointment')
      );
    }
  }
);

/**
 * @route   PUT /api/appointments/:id
 * @desc    Update appointment
 * @access  Private (Admin, Provider, Staff)
 */
router.put('/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  updateAppointmentValidation,
  handleValidation,
  validateAppointmentTime,
  checkAppointmentAccess,
  auditMiddleware('APPOINTMENT_UPDATE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const updatedBy = (req as any).user.id;
      const currentAppointment = (req as any).appointment;

      // Check for conflicts if time or date is being changed
      if (updateData.appointmentDate || updateData.startTime || updateData.endTime) {
        const conflicts = await appointmentModel.checkConflicts(
          currentAppointment.providerId,
          updateData.appointmentDate || currentAppointment.appointmentDate,
          updateData.startTime || currentAppointment.startTime,
          updateData.endTime || currentAppointment.endTime,
          id // Exclude current appointment from conflict check
        );

        if (conflicts.length > 0) {
          return res.status(409).json(
            createErrorResponse('Appointment conflicts with existing appointments',
              `Conflicts found: ${conflicts.map(c => c.reason).join(', ')}`)
          );
        }
      }

      const appointment = await appointmentModel.update(id, {
        ...updateData,
        updatedBy,
      });

      logger.info(`Appointment updated: ${id}`, {
        appointmentId: id,
        updatedBy,
      });

      res.json(
        createApiResponse(appointment, true, 'Appointment updated successfully')
      );
    } catch (error) {
      logger.error('Error updating appointment:', error);
      res.status(500).json(
        createErrorResponse('Failed to update appointment')
      );
    }
  }
);

/**
 * @route   PATCH /api/appointments/:id/cancel
 * @desc    Cancel appointment
 * @access  Private (Admin, Provider, Staff, Patient)
 */
router.patch('/:id/cancel',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF', 'PATIENT']),
  [
    param('id').isUUID(),
    body('reason').optional().trim().isLength({ max: 500 }),
  ],
  handleValidation,
  checkAppointmentAccess,
  auditMiddleware('APPOINTMENT_CANCEL'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const cancelledBy = (req as any).user.id;

      const appointment = await appointmentModel.cancel(id, cancelledBy, reason);

      logger.info(`Appointment cancelled: ${id}`, {
        appointmentId: id,
        cancelledBy,
        reason,
      });

      res.json(
        createApiResponse(appointment, true, 'Appointment cancelled successfully')
      );
    } catch (error) {
      logger.error('Error cancelling appointment:', error);
      res.status(500).json(
        createErrorResponse('Failed to cancel appointment')
      );
    }
  }
);

/**
 * @route   PATCH /api/appointments/:id/complete
 * @desc    Mark appointment as completed
 * @access  Private (Admin, Provider)
 */
router.patch('/:id/complete',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  [
    param('id').isUUID(),
    body('notes').optional().trim().isLength({ max: 1000 }),
    body('outcome').optional().trim().isLength({ max: 500 }),
  ],
  handleValidation,
  checkAppointmentAccess,
  auditMiddleware('APPOINTMENT_COMPLETE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { notes, outcome } = req.body;
      const completedBy = (req as any).user.id;

      const appointment = await appointmentModel.complete(id, completedBy, {
        notes,
        outcome,
      });

      logger.info(`Appointment completed: ${id}`, {
        appointmentId: id,
        completedBy,
      });

      res.json(
        createApiResponse(appointment, true, 'Appointment completed successfully')
      );
    } catch (error) {
      logger.error('Error completing appointment:', error);
      res.status(500).json(
        createErrorResponse('Failed to complete appointment')
      );
    }
  }
);

/**
 * @route   PATCH /api/appointments/:id/no-show
 * @desc    Mark appointment as no-show
 * @access  Private (Admin, Provider, Staff)
 */
router.patch('/:id/no-show',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [
    param('id').isUUID(),
    body('notes').optional().trim().isLength({ max: 1000 }),
  ],
  handleValidation,
  checkAppointmentAccess,
  auditMiddleware('APPOINTMENT_NO_SHOW'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      const updatedBy = (req as any).user.id;

      const appointment = await appointmentModel.update(id, {
        status: 'NO_SHOW',
        notes: notes || 'Patient did not show up for appointment',
        updatedBy,
      });

      logger.info(`Appointment marked as no-show: ${id}`, {
        appointmentId: id,
        updatedBy,
      });

      res.json(
        createApiResponse(appointment, true, 'Appointment marked as no-show')
      );
    } catch (error) {
      logger.error('Error marking appointment as no-show:', error);
      res.status(500).json(
        createErrorResponse('Failed to mark appointment as no-show')
      );
    }
  }
);

/**
 * @route   POST /api/appointments/:id/reschedule
 * @desc    Reschedule appointment
 * @access  Private (Admin, Provider, Staff, Patient)
 */
router.post('/:id/reschedule',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF', 'PATIENT']),
  [
    param('id').isUUID(),
    body('appointmentDate').isISO8601().toDate(),
    body('startTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    body('endTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    body('reason').optional().trim().isLength({ max: 500 }),
  ],
  handleValidation,
  validateAppointmentTime,
  checkAppointmentAccess,
  auditMiddleware('APPOINTMENT_RESCHEDULE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { appointmentDate, startTime, endTime, reason } = req.body;
      const rescheduledBy = (req as any).user.id;
      const currentAppointment = (req as any).appointment;

      // Check for conflicts
      const conflicts = await appointmentModel.checkConflicts(
        currentAppointment.providerId,
        appointmentDate,
        startTime,
        endTime,
        id // Exclude current appointment from conflict check
      );

      if (conflicts.length > 0) {
        return res.status(409).json(
          createErrorResponse('New appointment time conflicts with existing appointments',
            `Conflicts found: ${conflicts.map(c => c.reason).join(', ')}`)
        );
      }

      const appointment = await appointmentModel.update(id, {
        appointmentDate,
        startTime,
        endTime,
        status: 'SCHEDULED',
        notes: reason ? `Rescheduled: ${reason}` : 'Appointment rescheduled',
        updatedBy: rescheduledBy,
      });

      logger.info(`Appointment rescheduled: ${id}`, {
        appointmentId: id,
        rescheduledBy,
        newDate: appointmentDate,
        newTime: `${startTime}-${endTime}`,
      });

      res.json(
        createApiResponse(appointment, true, 'Appointment rescheduled successfully')
      );
    } catch (error) {
      logger.error('Error rescheduling appointment:', error);
      res.status(500).json(
        createErrorResponse('Failed to reschedule appointment')
      );
    }
  }
);

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Global error handler for appointment routes
 */
router.use((error: any, req: Request, res: Response, next: any) => {
  logger.error('Appointment route error:', error);
  
  if (error.code === 'P2002') {
    return res.status(409).json(
      createErrorResponse('Appointment conflict detected')
    );
  }
  
  if (error.code === 'P2025') {
    return res.status(404).json(
      createErrorResponse('Appointment not found')
    );
  }
  
  res.status(500).json(
    createErrorResponse('Internal server error')
  );
});

// ============================================================================
// EXPORTS
// ============================================================================

export default router;