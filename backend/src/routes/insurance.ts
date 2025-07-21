/**
 * ============================================================================
 * NOVA CHECK EHR - INSURANCE ROUTES
 * ============================================================================
 * 
 * RESTful API routes for insurance management.
 * Handles insurance policies, claims, and authorizations.
 */

import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { InsuranceModel, createApiResponse, createErrorResponse, validatePagination } from '../models';
import { authenticateToken, requireRole } from '../middleware/auth';
import { createAuditMiddleware } from '../models/Audit';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';

// ============================================================================
// ROUTER SETUP
// ============================================================================

const router = Router();
const prisma = new PrismaClient();
const insuranceModel = new InsuranceModel(prisma);
const auditMiddleware = createAuditMiddleware(prisma);

// ============================================================================
// VALIDATION RULES
// ============================================================================

const createPolicyValidation = [
  body('patientId').isUUID(),
  body('insuranceCompany').notEmpty().trim().isLength({ min: 1, max: 200 }),
  body('policyNumber').notEmpty().trim().isLength({ min: 1, max: 100 }),
  body('groupNumber').optional().trim().isLength({ max: 100 }),
  body('planName').optional().trim().isLength({ max: 200 }),
  body('planType').isIn(['HMO', 'PPO', 'EPO', 'POS', 'HDHP', 'OTHER']),
  body('coverageType').isIn(['PRIMARY', 'SECONDARY', 'TERTIARY']),
  body('effectiveDate').isISO8601().toDate(),
  body('expirationDate').optional().isISO8601().toDate(),
  body('copayAmount').optional().isFloat({ min: 0, max: 10000 }),
  body('deductibleAmount').optional().isFloat({ min: 0, max: 100000 }),
  body('outOfPocketMax').optional().isFloat({ min: 0, max: 100000 }),
  body('subscriberName').notEmpty().trim().isLength({ min: 1, max: 200 }),
  body('subscriberDOB').isISO8601().toDate(),
  body('subscriberSSN').optional().trim().isLength({ max: 20 }),
  body('relationshipToSubscriber').isIn(['SELF', 'SPOUSE', 'CHILD', 'OTHER']),
  body('isActive').optional().isBoolean(),
];

const updatePolicyValidation = [
  param('id').isUUID(),
  body('insuranceCompany').optional().trim().isLength({ min: 1, max: 200 }),
  body('policyNumber').optional().trim().isLength({ min: 1, max: 100 }),
  body('groupNumber').optional().trim().isLength({ max: 100 }),
  body('planName').optional().trim().isLength({ max: 200 }),
  body('planType').optional().isIn(['HMO', 'PPO', 'EPO', 'POS', 'HDHP', 'OTHER']),
  body('coverageType').optional().isIn(['PRIMARY', 'SECONDARY', 'TERTIARY']),
  body('effectiveDate').optional().isISO8601().toDate(),
  body('expirationDate').optional().isISO8601().toDate(),
  body('copayAmount').optional().isFloat({ min: 0, max: 10000 }),
  body('deductibleAmount').optional().isFloat({ min: 0, max: 100000 }),
  body('outOfPocketMax').optional().isFloat({ min: 0, max: 100000 }),
  body('subscriberName').optional().trim().isLength({ min: 1, max: 200 }),
  body('subscriberDOB').optional().isISO8601().toDate(),
  body('subscriberSSN').optional().trim().isLength({ max: 20 }),
  body('relationshipToSubscriber').optional().isIn(['SELF', 'SPOUSE', 'CHILD', 'OTHER']),
  body('isActive').optional().isBoolean(),
];

const createClaimValidation = [
  body('policyId').isUUID(),
  body('appointmentId').optional().isUUID(),
  body('serviceDate').isISO8601().toDate(),
  body('diagnosisCodes').isArray({ min: 1 }),
  body('diagnosisCodes.*').notEmpty().trim(),
  body('procedureCodes').isArray({ min: 1 }),
  body('procedureCodes.*').notEmpty().trim(),
  body('chargedAmount').isFloat({ min: 0, max: 1000000 }),
  body('allowedAmount').optional().isFloat({ min: 0, max: 1000000 }),
  body('paidAmount').optional().isFloat({ min: 0, max: 1000000 }),
  body('patientResponsibility').optional().isFloat({ min: 0, max: 1000000 }),
  body('notes').optional().trim().isLength({ max: 1000 }),
];

const updateClaimStatusValidation = [
  param('id').isUUID(),
  body('status').isIn(['SUBMITTED', 'PENDING', 'APPROVED', 'DENIED', 'PAID']),
  body('statusReason').optional().trim().isLength({ max: 500 }),
  body('allowedAmount').optional().isFloat({ min: 0, max: 1000000 }),
  body('paidAmount').optional().isFloat({ min: 0, max: 1000000 }),
  body('patientResponsibility').optional().isFloat({ min: 0, max: 1000000 }),
  body('denialReason').optional().trim().isLength({ max: 500 }),
  body('processedDate').optional().isISO8601().toDate(),
];

const searchValidation = [
  query('search').optional().trim().isLength({ min: 1, max: 200 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sortBy').optional().isIn(['createdAt', 'effectiveDate', 'expirationDate', 'insuranceCompany']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('patientId').optional().isUUID(),
  query('insuranceCompany').optional().trim(),
  query('planType').optional().isIn(['HMO', 'PPO', 'EPO', 'POS', 'HDHP', 'OTHER']),
  query('coverageType').optional().isIn(['PRIMARY', 'SECONDARY', 'TERTIARY']),
  query('isActive').optional().isBoolean(),
  query('startDate').optional().isISO8601().toDate(),
  query('endDate').optional().isISO8601().toDate(),
];

const claimSearchValidation = [
  query('search').optional().trim().isLength({ min: 1, max: 200 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sortBy').optional().isIn(['createdAt', 'serviceDate', 'chargedAmount', 'status']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('status').optional().isIn(['SUBMITTED', 'PENDING', 'APPROVED', 'DENIED', 'PAID']),
  query('policyId').optional().isUUID(),
  query('patientId').optional().isUUID(),
  query('startDate').optional().isISO8601().toDate(),
  query('endDate').optional().isISO8601().toDate(),
  query('minAmount').optional().isFloat({ min: 0 }),
  query('maxAmount').optional().isFloat({ min: 0 }),
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
 * Check if insurance policy exists and user has access
 */
const checkPolicyAccess = async (req: Request, res: Response, next: any) => {
  try {
    const { id } = req.params;
    const policy = await insuranceModel.findPolicyById(id);
    
    if (!policy) {
      return res.status(404).json(
        createErrorResponse('Insurance policy not found')
      );
    }

    // Store policy in request for use in route handlers
    (req as any).policy = policy;
    next();
  } catch (error) {
    logger.error('Error checking policy access:', error);
    res.status(500).json(
      createErrorResponse('Internal server error')
    );
  }
};

/**
 * Check if insurance claim exists and user has access
 */
const checkClaimAccess = async (req: Request, res: Response, next: any) => {
  try {
    const { id } = req.params;
    const claim = await insuranceModel.findClaimById(id);
    
    if (!claim) {
      return res.status(404).json(
        createErrorResponse('Insurance claim not found')
      );
    }

    // Store claim in request for use in route handlers
    (req as any).claim = claim;
    next();
  } catch (error) {
    logger.error('Error checking claim access:', error);
    res.status(500).json(
      createErrorResponse('Internal server error')
    );
  }
};

// ============================================================================
// INSURANCE POLICY ROUTES
// ============================================================================

/**
 * @route   POST /api/insurance/policies
 * @desc    Create a new insurance policy
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/policies',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  createPolicyValidation,
  handleValidation,
  auditMiddleware('INSURANCE_POLICY_CREATE'),
  async (req: Request, res: Response) => {
    try {
      const policyData = req.body;
      const createdBy = (req as any).user.id;

      const policy = await insuranceModel.createPolicy({
        ...policyData,
        createdBy,
      });

      logger.info(`Insurance policy created: ${policy.id}`, {
        policyId: policy.id,
        patientId: policy.patientId,
        insuranceCompany: policy.insuranceCompany,
        policyNumber: policy.policyNumber,
        createdBy,
      });

      res.status(201).json(
        createApiResponse(policy, true, 'Insurance policy created successfully')
      );
    } catch (error) {
      logger.error('Error creating insurance policy:', error);
      res.status(500).json(
        createErrorResponse('Failed to create insurance policy')
      );
    }
  }
);

/**
 * @route   GET /api/insurance/policies
 * @desc    Get insurance policies with search and pagination
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/policies',
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
        patientId: req.query.patientId as string,
        insuranceCompany: req.query.insuranceCompany as string,
        planType: req.query.planType as any,
        coverageType: req.query.coverageType as any,
        isActive: req.query.isActive as any,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      // Remove undefined values
      Object.keys(filters).forEach(key => {
        if (filters[key as keyof typeof filters] === undefined) {
          delete filters[key as keyof typeof filters];
        }
      });

      const result = await insuranceModel.findManyPolicies(filters, pagination);

      res.json(
        createApiResponse(result.data, true, undefined, result.pagination)
      );
    } catch (error) {
      logger.error('Error fetching insurance policies:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch insurance policies')
      );
    }
  }
);

/**
 * @route   GET /api/insurance/policies/:id
 * @desc    Get insurance policy by ID
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/policies/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('id').isUUID()],
  handleValidation,
  checkPolicyAccess,
  auditMiddleware('INSURANCE_POLICY_VIEW'),
  async (req: Request, res: Response) => {
    try {
      const policy = (req as any).policy;

      res.json(
        createApiResponse(policy, true, 'Insurance policy retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching insurance policy:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch insurance policy')
      );
    }
  }
);

/**
 * @route   PUT /api/insurance/policies/:id
 * @desc    Update insurance policy
 * @access  Private (Admin, Provider, Staff)
 */
router.put('/policies/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  updatePolicyValidation,
  handleValidation,
  checkPolicyAccess,
  auditMiddleware('INSURANCE_POLICY_UPDATE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const updatedBy = (req as any).user.id;

      const policy = await insuranceModel.updatePolicy(id, {
        ...updateData,
        updatedBy,
      });

      logger.info(`Insurance policy updated: ${id}`, {
        policyId: id,
        updatedBy,
      });

      res.json(
        createApiResponse(policy, true, 'Insurance policy updated successfully')
      );
    } catch (error) {
      logger.error('Error updating insurance policy:', error);
      res.status(500).json(
        createErrorResponse('Failed to update insurance policy')
      );
    }
  }
);

/**
 * @route   PATCH /api/insurance/policies/:id/deactivate
 * @desc    Deactivate insurance policy
 * @access  Private (Admin, Provider)
 */
router.patch('/policies/:id/deactivate',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  [
    param('id').isUUID(),
    body('reason').optional().trim().isLength({ max: 500 }),
  ],
  handleValidation,
  checkPolicyAccess,
  auditMiddleware('INSURANCE_POLICY_DEACTIVATE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const deactivatedBy = (req as any).user.id;

      const policy = await insuranceModel.deactivatePolicy(id, deactivatedBy, reason);

      logger.info(`Insurance policy deactivated: ${id}`, {
        policyId: id,
        reason,
        deactivatedBy,
      });

      res.json(
        createApiResponse(policy, true, 'Insurance policy deactivated successfully')
      );
    } catch (error) {
      logger.error('Error deactivating insurance policy:', error);
      res.status(500).json(
        createErrorResponse('Failed to deactivate insurance policy')
      );
    }
  }
);

/**
 * @route   POST /api/insurance/policies/:id/verify
 * @desc    Verify insurance eligibility
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/policies/:id/verify',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('id').isUUID()],
  handleValidation,
  checkPolicyAccess,
  auditMiddleware('INSURANCE_ELIGIBILITY_VERIFY'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const verifiedBy = (req as any).user.id;

      const result = await insuranceModel.verifyEligibility(id, verifiedBy);

      logger.info(`Insurance eligibility verified: ${id}`, {
        policyId: id,
        verifiedBy,
        isEligible: result.isEligible,
      });

      res.json(
        createApiResponse(result, true, 'Insurance eligibility verified successfully')
      );
    } catch (error) {
      logger.error('Error verifying insurance eligibility:', error);
      res.status(500).json(
        createErrorResponse('Failed to verify insurance eligibility')
      );
    }
  }
);

// ============================================================================
// INSURANCE CLAIM ROUTES
// ============================================================================

/**
 * @route   POST /api/insurance/claims
 * @desc    Create a new insurance claim
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/claims',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  createClaimValidation,
  handleValidation,
  auditMiddleware('INSURANCE_CLAIM_CREATE'),
  async (req: Request, res: Response) => {
    try {
      const claimData = req.body;
      const createdBy = (req as any).user.id;

      const claim = await insuranceModel.createClaim({
        ...claimData,
        createdBy,
      });

      logger.info(`Insurance claim created: ${claim.id}`, {
        claimId: claim.id,
        claimNumber: claim.claimNumber,
        policyId: claim.policyId,
        chargedAmount: claim.chargedAmount,
        createdBy,
      });

      res.status(201).json(
        createApiResponse(claim, true, 'Insurance claim created successfully')
      );
    } catch (error) {
      logger.error('Error creating insurance claim:', error);
      res.status(500).json(
        createErrorResponse('Failed to create insurance claim')
      );
    }
  }
);

/**
 * @route   GET /api/insurance/claims
 * @desc    Get insurance claims with search and pagination
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/claims',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  claimSearchValidation,
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
        policyId: req.query.policyId as string,
        patientId: req.query.patientId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        minAmount: req.query.minAmount as any,
        maxAmount: req.query.maxAmount as any,
      };

      // Remove undefined values
      Object.keys(filters).forEach(key => {
        if (filters[key as keyof typeof filters] === undefined) {
          delete filters[key as keyof typeof filters];
        }
      });

      const result = await insuranceModel.findManyClaims(filters, pagination);

      res.json(
        createApiResponse(result.data, true, undefined, result.pagination)
      );
    } catch (error) {
      logger.error('Error fetching insurance claims:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch insurance claims')
      );
    }
  }
);

/**
 * @route   GET /api/insurance/claims/:id
 * @desc    Get insurance claim by ID
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/claims/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('id').isUUID()],
  handleValidation,
  checkClaimAccess,
  auditMiddleware('INSURANCE_CLAIM_VIEW'),
  async (req: Request, res: Response) => {
    try {
      const claim = (req as any).claim;

      res.json(
        createApiResponse(claim, true, 'Insurance claim retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching insurance claim:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch insurance claim')
      );
    }
  }
);

/**
 * @route   PATCH /api/insurance/claims/:id/status
 * @desc    Update insurance claim status
 * @access  Private (Admin, Provider, Staff)
 */
router.patch('/claims/:id/status',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  updateClaimStatusValidation,
  handleValidation,
  checkClaimAccess,
  auditMiddleware('INSURANCE_CLAIM_STATUS_UPDATE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const statusData = req.body;
      const updatedBy = (req as any).user.id;

      const claim = await insuranceModel.updateClaimStatus(id, {
        ...statusData,
        updatedBy,
      });

      logger.info(`Insurance claim status updated: ${id}`, {
        claimId: id,
        claimNumber: claim.claimNumber,
        status: statusData.status,
        updatedBy,
      });

      res.json(
        createApiResponse(claim, true, 'Insurance claim status updated successfully')
      );
    } catch (error) {
      logger.error('Error updating insurance claim status:', error);
      res.status(500).json(
        createErrorResponse('Failed to update insurance claim status')
      );
    }
  }
);

// ============================================================================
// INSURANCE STATISTICS ROUTES
// ============================================================================

/**
 * @route   GET /api/insurance/stats
 * @desc    Get insurance statistics
 * @access  Private (Admin, Provider)
 */
router.get('/stats',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  async (req: Request, res: Response) => {
    try {
      const stats = await insuranceModel.getStats();

      res.json(
        createApiResponse(stats, true, 'Insurance statistics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching insurance stats:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch insurance statistics')
      );
    }
  }
);

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Global error handler for insurance routes
 */
router.use((error: any, req: Request, res: Response, next: any) => {
  logger.error('Insurance route error:', error);
  
  if (error.code === 'P2002') {
    return res.status(409).json(
      createErrorResponse('Insurance record with this information already exists')
    );
  }
  
  if (error.code === 'P2025') {
    return res.status(404).json(
      createErrorResponse('Insurance record not found')
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