/**
 * ============================================================================
 * NOVA CHECK EHR - CLINICAL ROUTES
 * ============================================================================
 * 
 * RESTful API routes for clinical data management.
 * Handles encounters, vital signs, diagnoses, procedures, and prescriptions.
 */

import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { ClinicalModel, createApiResponse, createErrorResponse, validatePagination } from '../models';
import { authenticateToken, requireRole } from '../middleware/auth';
import { createAuditMiddleware } from '../models/Audit';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';

// ============================================================================
// ROUTER SETUP
// ============================================================================

const router = Router();
const prisma = new PrismaClient();
const clinicalModel = new ClinicalModel(prisma);
const auditMiddleware = createAuditMiddleware(prisma);

// ============================================================================
// VALIDATION RULES
// ============================================================================

const createEncounterValidation = [
  body('patientId').isUUID(),
  body('providerId').isUUID(),
  body('appointmentId').optional().isUUID(),
  body('type').isIn(['ROUTINE', 'URGENT', 'EMERGENCY', 'FOLLOW_UP', 'CONSULTATION']),
  body('status').optional().isIn(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  body('chiefComplaint').notEmpty().trim().isLength({ min: 1, max: 1000 }),
  body('notes').optional().trim().isLength({ max: 5000 }),
  body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
];

const updateEncounterValidation = [
  param('id').isUUID(),
  body('type').optional().isIn(['ROUTINE', 'URGENT', 'EMERGENCY', 'FOLLOW_UP', 'CONSULTATION']),
  body('status').optional().isIn(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  body('chiefComplaint').optional().trim().isLength({ min: 1, max: 1000 }),
  body('notes').optional().trim().isLength({ max: 5000 }),
  body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
];

const vitalSignsValidation = [
  body('encounterId').isUUID(),
  body('temperature').optional().isFloat({ min: 90, max: 110 }),
  body('bloodPressureSystolic').optional().isInt({ min: 50, max: 300 }),
  body('bloodPressureDiastolic').optional().isInt({ min: 30, max: 200 }),
  body('heartRate').optional().isInt({ min: 30, max: 250 }),
  body('respiratoryRate').optional().isInt({ min: 5, max: 60 }),
  body('oxygenSaturation').optional().isFloat({ min: 70, max: 100 }),
  body('height').optional().isFloat({ min: 20, max: 300 }),
  body('weight').optional().isFloat({ min: 1, max: 1000 }),
  body('bmi').optional().isFloat({ min: 10, max: 100 }),
  body('painLevel').optional().isInt({ min: 0, max: 10 }),
];

const diagnosisValidation = [
  body('encounterId').isUUID(),
  body('icdCode').notEmpty().trim().isLength({ min: 1, max: 20 }),
  body('description').notEmpty().trim().isLength({ min: 1, max: 500 }),
  body('type').isIn(['PRIMARY', 'SECONDARY', 'DIFFERENTIAL']),
  body('status').optional().isIn(['ACTIVE', 'RESOLVED', 'INACTIVE']),
  body('severity').optional().isIn(['MILD', 'MODERATE', 'SEVERE']),
  body('notes').optional().trim().isLength({ max: 1000 }),
];

const procedureValidation = [
  body('encounterId').isUUID(),
  body('cptCode').notEmpty().trim().isLength({ min: 1, max: 20 }),
  body('description').notEmpty().trim().isLength({ min: 1, max: 500 }),
  body('status').optional().isIn(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  body('performedDate').optional().isISO8601().toDate(),
  body('duration').optional().isInt({ min: 1, max: 1440 }),
  body('notes').optional().trim().isLength({ max: 1000 }),
  body('complications').optional().trim().isLength({ max: 1000 }),
];

const prescriptionValidation = [
  body('encounterId').isUUID(),
  body('medicationName').notEmpty().trim().isLength({ min: 1, max: 200 }),
  body('dosage').notEmpty().trim().isLength({ min: 1, max: 100 }),
  body('frequency').notEmpty().trim().isLength({ min: 1, max: 100 }),
  body('duration').notEmpty().trim().isLength({ min: 1, max: 100 }),
  body('instructions').optional().trim().isLength({ max: 1000 }),
  body('quantity').optional().isInt({ min: 1, max: 1000 }),
  body('refills').optional().isInt({ min: 0, max: 12 }),
  body('status').optional().isIn(['ACTIVE', 'COMPLETED', 'CANCELLED', 'DISCONTINUED']),
];

const searchValidation = [
  query('search').optional().trim().isLength({ min: 1, max: 200 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sortBy').optional().isIn(['encounterDate', 'createdAt', 'updatedAt']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('status').optional().isIn(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  query('type').optional().isIn(['ROUTINE', 'URGENT', 'EMERGENCY', 'FOLLOW_UP', 'CONSULTATION']),
  query('patientId').optional().isUUID(),
  query('providerId').optional().isUUID(),
  query('startDate').optional().isISO8601().toDate(),
  query('endDate').optional().isISO8601().toDate(),
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
 * Check if encounter exists and user has access
 */
const checkEncounterAccess = async (req: Request, res: Response, next: any) => {
  try {
    const { id } = req.params;
    const encounter = await clinicalModel.findEncounterById(id);
    
    if (!encounter) {
      return res.status(404).json(
        createErrorResponse('Encounter not found')
      );
    }

    // Store encounter in request for use in route handlers
    (req as any).encounter = encounter;
    next();
  } catch (error) {
    logger.error('Error checking encounter access:', error);
    res.status(500).json(
      createErrorResponse('Internal server error')
    );
  }
};

// ============================================================================
// ENCOUNTER ROUTES
// ============================================================================

/**
 * @route   POST /api/clinical/encounters
 * @desc    Create a new clinical encounter
 * @access  Private (Admin, Provider)
 */
router.post('/encounters',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  createEncounterValidation,
  handleValidation,
  auditMiddleware('ENCOUNTER_CREATE'),
  async (req: Request, res: Response) => {
    try {
      const encounterData = req.body;
      const createdBy = (req as any).user.id;

      const encounter = await clinicalModel.createEncounter({
        ...encounterData,
        createdBy,
      });

      logger.info(`Encounter created: ${encounter.id}`, {
        encounterId: encounter.id,
        patientId: encounter.patientId,
        providerId: encounter.providerId,
        createdBy,
      });

      res.status(201).json(
        createApiResponse(encounter, true, 'Encounter created successfully')
      );
    } catch (error) {
      logger.error('Error creating encounter:', error);
      res.status(500).json(
        createErrorResponse('Failed to create encounter')
      );
    }
  }
);

/**
 * @route   GET /api/clinical/encounters
 * @desc    Get encounters with search and pagination
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/encounters',
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

      const result = await clinicalModel.searchEncounters(filters, pagination);

      res.json(
        createApiResponse(result.data, true, undefined, result.pagination)
      );
    } catch (error) {
      logger.error('Error fetching encounters:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch encounters')
      );
    }
  }
);

/**
 * @route   GET /api/clinical/encounters/:id
 * @desc    Get encounter by ID
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/encounters/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('id').isUUID()],
  handleValidation,
  checkEncounterAccess,
  auditMiddleware('ENCOUNTER_VIEW'),
  async (req: Request, res: Response) => {
    try {
      const encounter = (req as any).encounter;

      res.json(
        createApiResponse(encounter, true, 'Encounter retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching encounter:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch encounter')
      );
    }
  }
);

/**
 * @route   PUT /api/clinical/encounters/:id
 * @desc    Update encounter
 * @access  Private (Admin, Provider)
 */
router.put('/encounters/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  updateEncounterValidation,
  handleValidation,
  checkEncounterAccess,
  auditMiddleware('ENCOUNTER_UPDATE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const updatedBy = (req as any).user.id;

      const encounter = await clinicalModel.updateEncounter(id, {
        ...updateData,
        updatedBy,
      });

      logger.info(`Encounter updated: ${id}`, {
        encounterId: id,
        updatedBy,
      });

      res.json(
        createApiResponse(encounter, true, 'Encounter updated successfully')
      );
    } catch (error) {
      logger.error('Error updating encounter:', error);
      res.status(500).json(
        createErrorResponse('Failed to update encounter')
      );
    }
  }
);

/**
 * @route   PATCH /api/clinical/encounters/:id/complete
 * @desc    Complete encounter
 * @access  Private (Admin, Provider)
 */
router.patch('/encounters/:id/complete',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  [
    param('id').isUUID(),
    body('summary').optional().trim().isLength({ max: 2000 }),
    body('followUpInstructions').optional().trim().isLength({ max: 1000 }),
  ],
  handleValidation,
  checkEncounterAccess,
  auditMiddleware('ENCOUNTER_COMPLETE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { summary, followUpInstructions } = req.body;
      const completedBy = (req as any).user.id;

      const encounter = await clinicalModel.completeEncounter(id, completedBy, {
        summary,
        followUpInstructions,
      });

      logger.info(`Encounter completed: ${id}`, {
        encounterId: id,
        completedBy,
      });

      res.json(
        createApiResponse(encounter, true, 'Encounter completed successfully')
      );
    } catch (error) {
      logger.error('Error completing encounter:', error);
      res.status(500).json(
        createErrorResponse('Failed to complete encounter')
      );
    }
  }
);

// ============================================================================
// VITAL SIGNS ROUTES
// ============================================================================

/**
 * @route   POST /api/clinical/vital-signs
 * @desc    Create vital signs record
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/vital-signs',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  vitalSignsValidation,
  handleValidation,
  auditMiddleware('VITAL_SIGNS_CREATE'),
  async (req: Request, res: Response) => {
    try {
      const vitalSignsData = req.body;
      const recordedBy = (req as any).user.id;

      const vitalSigns = await clinicalModel.createVitalSigns({
        ...vitalSignsData,
        recordedBy,
      });

      logger.info(`Vital signs recorded: ${vitalSigns.id}`, {
        vitalSignsId: vitalSigns.id,
        encounterId: vitalSigns.encounterId,
        recordedBy,
      });

      res.status(201).json(
        createApiResponse(vitalSigns, true, 'Vital signs recorded successfully')
      );
    } catch (error) {
      logger.error('Error recording vital signs:', error);
      res.status(500).json(
        createErrorResponse('Failed to record vital signs')
      );
    }
  }
);

/**
 * @route   GET /api/clinical/vital-signs/trends/:patientId
 * @desc    Get vital signs trends for a patient
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/vital-signs/trends/:patientId',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [
    param('patientId').isUUID(),
    query('startDate').optional().isISO8601().toDate(),
    query('endDate').optional().isISO8601().toDate(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const { patientId } = req.params;
      const { startDate, endDate, limit } = req.query;

      const trends = await clinicalModel.getVitalSignsTrends(
        patientId,
        startDate as any,
        endDate as any,
        limit as any
      );

      res.json(
        createApiResponse(trends, true, 'Vital signs trends retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching vital signs trends:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch vital signs trends')
      );
    }
  }
);

// ============================================================================
// DIAGNOSIS ROUTES
// ============================================================================

/**
 * @route   POST /api/clinical/diagnoses
 * @desc    Create diagnosis
 * @access  Private (Admin, Provider)
 */
router.post('/diagnoses',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  diagnosisValidation,
  handleValidation,
  auditMiddleware('DIAGNOSIS_CREATE'),
  async (req: Request, res: Response) => {
    try {
      const diagnosisData = req.body;
      const diagnosedBy = (req as any).user.id;

      const diagnosis = await clinicalModel.createDiagnosis({
        ...diagnosisData,
        diagnosedBy,
      });

      logger.info(`Diagnosis created: ${diagnosis.id}`, {
        diagnosisId: diagnosis.id,
        encounterId: diagnosis.encounterId,
        icdCode: diagnosis.icdCode,
        diagnosedBy,
      });

      res.status(201).json(
        createApiResponse(diagnosis, true, 'Diagnosis created successfully')
      );
    } catch (error) {
      logger.error('Error creating diagnosis:', error);
      res.status(500).json(
        createErrorResponse('Failed to create diagnosis')
      );
    }
  }
);

/**
 * @route   GET /api/clinical/diagnoses/active/:patientId
 * @desc    Get active diagnoses for a patient
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/diagnoses/active/:patientId',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('patientId').isUUID()],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const { patientId } = req.params;

      const diagnoses = await clinicalModel.getActiveDiagnoses(patientId);

      res.json(
        createApiResponse(diagnoses, true, 'Active diagnoses retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching active diagnoses:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch active diagnoses')
      );
    }
  }
);

// ============================================================================
// PROCEDURE ROUTES
// ============================================================================

/**
 * @route   POST /api/clinical/procedures
 * @desc    Create procedure record
 * @access  Private (Admin, Provider)
 */
router.post('/procedures',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  procedureValidation,
  handleValidation,
  auditMiddleware('PROCEDURE_CREATE'),
  async (req: Request, res: Response) => {
    try {
      const procedureData = req.body;
      const performedBy = (req as any).user.id;

      const procedure = await clinicalModel.createProcedure({
        ...procedureData,
        performedBy,
      });

      logger.info(`Procedure created: ${procedure.id}`, {
        procedureId: procedure.id,
        encounterId: procedure.encounterId,
        cptCode: procedure.cptCode,
        performedBy,
      });

      res.status(201).json(
        createApiResponse(procedure, true, 'Procedure recorded successfully')
      );
    } catch (error) {
      logger.error('Error creating procedure:', error);
      res.status(500).json(
        createErrorResponse('Failed to record procedure')
      );
    }
  }
);

// ============================================================================
// PRESCRIPTION ROUTES
// ============================================================================

/**
 * @route   POST /api/clinical/prescriptions
 * @desc    Create prescription
 * @access  Private (Admin, Provider)
 */
router.post('/prescriptions',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  prescriptionValidation,
  handleValidation,
  auditMiddleware('PRESCRIPTION_CREATE'),
  async (req: Request, res: Response) => {
    try {
      const prescriptionData = req.body;
      const prescribedBy = (req as any).user.id;

      const prescription = await clinicalModel.createPrescription({
        ...prescriptionData,
        prescribedBy,
      });

      logger.info(`Prescription created: ${prescription.id}`, {
        prescriptionId: prescription.id,
        encounterId: prescription.encounterId,
        medicationName: prescription.medicationName,
        prescribedBy,
      });

      res.status(201).json(
        createApiResponse(prescription, true, 'Prescription created successfully')
      );
    } catch (error) {
      logger.error('Error creating prescription:', error);
      res.status(500).json(
        createErrorResponse('Failed to create prescription')
      );
    }
  }
);

/**
 * @route   GET /api/clinical/prescriptions/active/:patientId
 * @desc    Get active prescriptions for a patient
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/prescriptions/active/:patientId',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('patientId').isUUID()],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const { patientId } = req.params;

      const prescriptions = await clinicalModel.getActivePrescriptions(patientId);

      res.json(
        createApiResponse(prescriptions, true, 'Active prescriptions retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching active prescriptions:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch active prescriptions')
      );
    }
  }
);

// ============================================================================
// CLINICAL SUMMARY ROUTES
// ============================================================================

/**
 * @route   GET /api/clinical/summary/:patientId
 * @desc    Get comprehensive clinical summary for a patient
 * @access  Private (Admin, Provider)
 */
router.get('/summary/:patientId',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  [param('patientId').isUUID()],
  handleValidation,
  auditMiddleware('CLINICAL_SUMMARY_VIEW'),
  async (req: Request, res: Response) => {
    try {
      const { patientId } = req.params;

      const summary = await clinicalModel.getPatientClinicalSummary(patientId);

      res.json(
        createApiResponse(summary, true, 'Clinical summary retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching clinical summary:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch clinical summary')
      );
    }
  }
);

/**
 * @route   GET /api/clinical/stats
 * @desc    Get clinical statistics
 * @access  Private (Admin, Provider)
 */
router.get('/stats',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  async (req: Request, res: Response) => {
    try {
      const stats = await clinicalModel.getStats();

      res.json(
        createApiResponse(stats, true, 'Clinical statistics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching clinical stats:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch clinical statistics')
      );
    }
  }
);

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Global error handler for clinical routes
 */
router.use((error: any, req: Request, res: Response, next: any) => {
  logger.error('Clinical route error:', error);
  
  if (error.code === 'P2002') {
    return res.status(409).json(
      createErrorResponse('Clinical record with this information already exists')
    );
  }
  
  if (error.code === 'P2025') {
    return res.status(404).json(
      createErrorResponse('Clinical record not found')
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