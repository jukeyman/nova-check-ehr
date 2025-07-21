/**
 * ============================================================================
 * NOVA CHECK EHR - PATIENT ROUTES
 * ============================================================================
 * 
 * RESTful API routes for patient management operations.
 * Handles CRUD operations, search, statistics, and medical summaries.
 */

import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { PatientModel, createApiResponse, createErrorResponse, validatePagination } from '../models';
import { authenticateToken, requireRole } from '../middleware/auth';
import { createAuditMiddleware } from '../models/Audit';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';

// ============================================================================
// ROUTER SETUP
// ============================================================================

const router = Router();
const prisma = new PrismaClient();
const patientModel = new PatientModel(prisma);
const auditMiddleware = createAuditMiddleware(prisma);

// ============================================================================
// VALIDATION RULES
// ============================================================================

const createPatientValidation = [
  body('firstName').notEmpty().trim().isLength({ min: 1, max: 100 }),
  body('lastName').notEmpty().trim().isLength({ min: 1, max: 100 }),
  body('dateOfBirth').isISO8601().toDate(),
  body('gender').isIn(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().isMobilePhone('any'),
  body('ssn').optional().isLength({ min: 9, max: 11 }),
  body('address.street').optional().trim().isLength({ max: 200 }),
  body('address.city').optional().trim().isLength({ max: 100 }),
  body('address.state').optional().trim().isLength({ max: 50 }),
  body('address.zipCode').optional().trim().isLength({ max: 20 }),
  body('address.country').optional().trim().isLength({ max: 100 }),
  body('emergencyContact.name').optional().trim().isLength({ max: 200 }),
  body('emergencyContact.relationship').optional().trim().isLength({ max: 100 }),
  body('emergencyContact.phone').optional().isMobilePhone('any'),
  body('emergencyContact.email').optional().isEmail().normalizeEmail(),
  body('insuranceInfo.primaryInsurance.provider').optional().trim().isLength({ max: 200 }),
  body('insuranceInfo.primaryInsurance.policyNumber').optional().trim().isLength({ max: 100 }),
  body('insuranceInfo.primaryInsurance.groupNumber').optional().trim().isLength({ max: 100 }),
];

const updatePatientValidation = [
  param('id').isUUID(),
  body('firstName').optional().trim().isLength({ min: 1, max: 100 }),
  body('lastName').optional().trim().isLength({ min: 1, max: 100 }),
  body('dateOfBirth').optional().isISO8601().toDate(),
  body('gender').optional().isIn(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().isMobilePhone('any'),
  body('ssn').optional().isLength({ min: 9, max: 11 }),
];

const searchValidation = [
  query('search').optional().trim().isLength({ min: 1, max: 200 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sortBy').optional().isIn(['firstName', 'lastName', 'dateOfBirth', 'createdAt', 'updatedAt']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('status').optional().isIn(['ACTIVE', 'INACTIVE', 'DECEASED']),
  query('gender').optional().isIn(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']),
  query('ageMin').optional().isInt({ min: 0, max: 150 }).toInt(),
  query('ageMax').optional().isInt({ min: 0, max: 150 }).toInt(),
  query('providerId').optional().isUUID(),
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
 * Check if patient exists and user has access
 */
const checkPatientAccess = async (req: Request, res: Response, next: any) => {
  try {
    const { id } = req.params;
    const patient = await patientModel.findById(id);
    
    if (!patient) {
      return res.status(404).json(
        createErrorResponse('Patient not found')
      );
    }

    // Store patient in request for use in route handlers
    (req as any).patient = patient;
    next();
  } catch (error) {
    logger.error('Error checking patient access:', error);
    res.status(500).json(
      createErrorResponse('Internal server error')
    );
  }
};

// ============================================================================
// ROUTES
// ============================================================================

/**
 * @route   POST /api/patients
 * @desc    Create a new patient
 * @access  Private (Admin, Provider)
 */
router.post('/',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  createPatientValidation,
  handleValidation,
  auditMiddleware('PATIENT_CREATE'),
  async (req: Request, res: Response) => {
    try {
      const patientData = req.body;
      const createdBy = (req as any).user.id;

      const patient = await patientModel.create({
        ...patientData,
        createdBy,
      });

      logger.info(`Patient created: ${patient.id}`, {
        patientId: patient.id,
        createdBy,
      });

      res.status(201).json(
        createApiResponse(patient, true, 'Patient created successfully')
      );
    } catch (error) {
      logger.error('Error creating patient:', error);
      res.status(500).json(
        createErrorResponse('Failed to create patient')
      );
    }
  }
);

/**
 * @route   GET /api/patients
 * @desc    Get patients with search and pagination
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
        gender: req.query.gender as any,
        ageMin: req.query.ageMin as any,
        ageMax: req.query.ageMax as any,
        providerId: req.query.providerId as string,
        createdAfter: req.query.createdAfter as string,
        createdBefore: req.query.createdBefore as string,
      };

      // Remove undefined values
      Object.keys(filters).forEach(key => {
        if (filters[key as keyof typeof filters] === undefined) {
          delete filters[key as keyof typeof filters];
        }
      });

      const result = await patientModel.findMany(filters, pagination);

      res.json(
        createApiResponse(result.data, true, undefined, result.pagination)
      );
    } catch (error) {
      logger.error('Error fetching patients:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch patients')
      );
    }
  }
);

/**
 * @route   GET /api/patients/stats
 * @desc    Get patient statistics
 * @access  Private (Admin, Provider)
 */
router.get('/stats',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  async (req: Request, res: Response) => {
    try {
      const stats = await patientModel.getStats();

      res.json(
        createApiResponse(stats, true, 'Patient statistics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching patient stats:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch patient statistics')
      );
    }
  }
);

/**
 * @route   GET /api/patients/search
 * @desc    Search patients by various criteria
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/search',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [
    query('query').notEmpty().trim().isLength({ min: 1, max: 200 }),
    query('type').optional().isIn(['name', 'email', 'phone', 'patientId', 'ssn']),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const { query: searchQuery, type, limit } = req.query;

      const results = await patientModel.search(
        searchQuery as string,
        type as any,
        limit as any
      );

      res.json(
        createApiResponse(results, true, 'Search completed successfully')
      );
    } catch (error) {
      logger.error('Error searching patients:', error);
      res.status(500).json(
        createErrorResponse('Failed to search patients')
      );
    }
  }
);

/**
 * @route   GET /api/patients/:id
 * @desc    Get patient by ID
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('id').isUUID()],
  handleValidation,
  checkPatientAccess,
  auditMiddleware('PATIENT_VIEW'),
  async (req: Request, res: Response) => {
    try {
      const patient = (req as any).patient;

      res.json(
        createApiResponse(patient, true, 'Patient retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching patient:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch patient')
      );
    }
  }
);

/**
 * @route   PUT /api/patients/:id
 * @desc    Update patient
 * @access  Private (Admin, Provider)
 */
router.put('/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  updatePatientValidation,
  handleValidation,
  checkPatientAccess,
  auditMiddleware('PATIENT_UPDATE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const updatedBy = (req as any).user.id;

      const patient = await patientModel.update(id, {
        ...updateData,
        updatedBy,
      });

      logger.info(`Patient updated: ${id}`, {
        patientId: id,
        updatedBy,
      });

      res.json(
        createApiResponse(patient, true, 'Patient updated successfully')
      );
    } catch (error) {
      logger.error('Error updating patient:', error);
      res.status(500).json(
        createErrorResponse('Failed to update patient')
      );
    }
  }
);

/**
 * @route   DELETE /api/patients/:id
 * @desc    Soft delete patient
 * @access  Private (Admin)
 */
router.delete('/:id',
  authenticateToken,
  requireRole(['ADMIN']),
  [param('id').isUUID()],
  handleValidation,
  checkPatientAccess,
  auditMiddleware('PATIENT_DELETE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deletedBy = (req as any).user.id;

      await patientModel.softDelete(id, deletedBy);

      logger.info(`Patient deleted: ${id}`, {
        patientId: id,
        deletedBy,
      });

      res.json(
        createApiResponse(null, true, 'Patient deleted successfully')
      );
    } catch (error) {
      logger.error('Error deleting patient:', error);
      res.status(500).json(
        createErrorResponse('Failed to delete patient')
      );
    }
  }
);

/**
 * @route   GET /api/patients/:id/summary
 * @desc    Get comprehensive patient medical summary
 * @access  Private (Admin, Provider)
 */
router.get('/:id/summary',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  [param('id').isUUID()],
  handleValidation,
  checkPatientAccess,
  auditMiddleware('PATIENT_SUMMARY_VIEW'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const summary = await patientModel.getMedicalSummary(id);

      res.json(
        createApiResponse(summary, true, 'Patient summary retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching patient summary:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch patient summary')
      );
    }
  }
);

/**
 * @route   GET /api/patients/provider/:providerId
 * @desc    Get patients by provider
 * @access  Private (Admin, Provider)
 */
router.get('/provider/:providerId',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  [
    param('providerId').isUUID(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const { providerId } = req.params;
      const pagination = validatePagination({
        page: req.query.page as any,
        limit: req.query.limit as any,
      });

      const result = await patientModel.findByProvider(providerId, pagination);

      res.json(
        createApiResponse(result.data, true, undefined, result.pagination)
      );
    } catch (error) {
      logger.error('Error fetching patients by provider:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch patients by provider')
      );
    }
  }
);

/**
 * @route   GET /api/patients/:id/appointments
 * @desc    Get patient appointments
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/:id/appointments',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [
    param('id').isUUID(),
    query('status').optional().isIn(['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
    query('startDate').optional().isISO8601().toDate(),
    query('endDate').optional().isISO8601().toDate(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  handleValidation,
  checkPatientAccess,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, startDate, endDate } = req.query;
      const pagination = validatePagination({
        page: req.query.page as any,
        limit: req.query.limit as any,
      });

      // This would typically use the AppointmentModel
      // For now, we'll return a placeholder response
      const appointments = {
        data: [],
        pagination: {
          page: pagination.page || 1,
          limit: pagination.limit || 20,
          total: 0,
          totalPages: 0,
        },
      };

      res.json(
        createApiResponse(appointments.data, true, undefined, appointments.pagination)
      );
    } catch (error) {
      logger.error('Error fetching patient appointments:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch patient appointments')
      );
    }
  }
);

/**
 * @route   GET /api/patients/:id/encounters
 * @desc    Get patient clinical encounters
 * @access  Private (Admin, Provider)
 */
router.get('/:id/encounters',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  [
    param('id').isUUID(),
    query('status').optional().isIn(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
    query('type').optional().isIn(['ROUTINE', 'URGENT', 'EMERGENCY', 'FOLLOW_UP', 'CONSULTATION']),
    query('startDate').optional().isISO8601().toDate(),
    query('endDate').optional().isISO8601().toDate(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  handleValidation,
  checkPatientAccess,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, type, startDate, endDate } = req.query;
      const pagination = validatePagination({
        page: req.query.page as any,
        limit: req.query.limit as any,
      });

      // This would typically use the ClinicalModel
      // For now, we'll return a placeholder response
      const encounters = {
        data: [],
        pagination: {
          page: pagination.page || 1,
          limit: pagination.limit || 20,
          total: 0,
          totalPages: 0,
        },
      };

      res.json(
        createApiResponse(encounters.data, true, undefined, encounters.pagination)
      );
    } catch (error) {
      logger.error('Error fetching patient encounters:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch patient encounters')
      );
    }
  }
);

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Global error handler for patient routes
 */
router.use((error: any, req: Request, res: Response, next: any) => {
  logger.error('Patient route error:', error);
  
  if (error.code === 'P2002') {
    return res.status(409).json(
      createErrorResponse('Patient with this information already exists')
    );
  }
  
  if (error.code === 'P2025') {
    return res.status(404).json(
      createErrorResponse('Patient not found')
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