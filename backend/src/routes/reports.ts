/**
 * ============================================================================
 * NOVA CHECK EHR - REPORTS ROUTES
 * ============================================================================
 * 
 * RESTful API routes for report management.
 * Handles report generation, retrieval, and analytics.
 */

import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { ReportModel, createApiResponse, createErrorResponse, validatePagination } from '../models';
import { authenticateToken, requireRole } from '../middleware/auth';
import { createAuditMiddleware } from '../models/Audit';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';

// ============================================================================
// ROUTER SETUP
// ============================================================================

const router = Router();
const prisma = new PrismaClient();
const reportModel = new ReportModel(prisma);
const auditMiddleware = createAuditMiddleware(prisma);

// ============================================================================
// VALIDATION RULES
// ============================================================================

const generateReportValidation = [
  body('title').notEmpty().trim().isLength({ min: 1, max: 200 }),
  body('type').isIn(['CLINICAL', 'ANALYTICS', 'COMPLIANCE', 'FINANCIAL', 'OPERATIONAL']),
  body('format').isIn(['JSON', 'CSV', 'HTML', 'PDF']),
  body('description').optional().trim().isLength({ max: 500 }),
  body('parameters').optional().isObject(),
  body('filters').optional().isObject(),
  body('dateRange').optional().isObject(),
  body('dateRange.startDate').optional().isISO8601().toDate(),
  body('dateRange.endDate').optional().isISO8601().toDate(),
  body('includePatientData').optional().isBoolean(),
  body('includeFinancialData').optional().isBoolean(),
  body('includeClinicalData').optional().isBoolean(),
  body('isScheduled').optional().isBoolean(),
  body('scheduleFrequency').optional().isIn(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
  body('recipients').optional().isArray(),
  body('recipients.*').optional().isEmail(),
];

const searchValidation = [
  query('search').optional().trim().isLength({ min: 1, max: 200 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sortBy').optional().isIn(['createdAt', 'title', 'type', 'status', 'generatedAt']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('type').optional().isIn(['CLINICAL', 'ANALYTICS', 'COMPLIANCE', 'FINANCIAL', 'OPERATIONAL']),
  query('format').optional().isIn(['JSON', 'CSV', 'HTML', 'PDF']),
  query('status').optional().isIn(['PENDING', 'GENERATING', 'COMPLETED', 'FAILED']),
  query('generatedBy').optional().isUUID(),
  query('startDate').optional().isISO8601().toDate(),
  query('endDate').optional().isISO8601().toDate(),
  query('isScheduled').optional().isBoolean(),
];

const clinicalReportValidation = [
  body('patientId').optional().isUUID(),
  body('providerId').optional().isUUID(),
  body('departmentId').optional().isUUID(),
  body('dateRange').isObject(),
  body('dateRange.startDate').isISO8601().toDate(),
  body('dateRange.endDate').isISO8601().toDate(),
  body('includeVitals').optional().isBoolean(),
  body('includeDiagnoses').optional().isBoolean(),
  body('includeProcedures').optional().isBoolean(),
  body('includePrescriptions').optional().isBoolean(),
  body('includeLabResults').optional().isBoolean(),
  body('format').optional().isIn(['JSON', 'CSV', 'HTML', 'PDF']),
];

const analyticsReportValidation = [
  body('metrics').isArray({ min: 1 }),
  body('metrics.*').isIn([
    'PATIENT_VOLUME',
    'APPOINTMENT_TRENDS',
    'REVENUE_ANALYSIS',
    'PROVIDER_PRODUCTIVITY',
    'PATIENT_SATISFACTION',
    'CLINICAL_OUTCOMES',
    'OPERATIONAL_EFFICIENCY',
    'QUALITY_MEASURES'
  ]),
  body('dateRange').isObject(),
  body('dateRange.startDate').isISO8601().toDate(),
  body('dateRange.endDate').isISO8601().toDate(),
  body('groupBy').optional().isIn(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']),
  body('filters').optional().isObject(),
  body('format').optional().isIn(['JSON', 'CSV', 'HTML', 'PDF']),
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
 * Check if report exists and user has access
 */
const checkReportAccess = async (req: Request, res: Response, next: any) => {
  try {
    const { id } = req.params;
    const report = await reportModel.findById(id);
    
    if (!report) {
      return res.status(404).json(
        createErrorResponse('Report not found')
      );
    }

    // Store report in request for use in route handlers
    (req as any).report = report;
    next();
  } catch (error) {
    logger.error('Error checking report access:', error);
    res.status(500).json(
      createErrorResponse('Internal server error')
    );
  }
};

// ============================================================================
// REPORT GENERATION ROUTES
// ============================================================================

/**
 * @route   POST /api/reports/generate
 * @desc    Generate a new report
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/generate',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  generateReportValidation,
  handleValidation,
  auditMiddleware('REPORT_GENERATE'),
  async (req: Request, res: Response) => {
    try {
      const reportData = req.body;
      const generatedBy = (req as any).user.id;

      const report = await reportModel.generateReport({
        ...reportData,
        generatedBy,
      });

      logger.info(`Report generation started: ${report.id}`, {
        reportId: report.id,
        title: report.title,
        type: report.type,
        format: report.format,
        generatedBy,
      });

      res.status(202).json(
        createApiResponse(report, true, 'Report generation started successfully')
      );
    } catch (error) {
      logger.error('Error generating report:', error);
      res.status(500).json(
        createErrorResponse('Failed to generate report')
      );
    }
  }
);

/**
 * @route   POST /api/reports/clinical
 * @desc    Generate clinical report
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/clinical',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  clinicalReportValidation,
  handleValidation,
  auditMiddleware('CLINICAL_REPORT_GENERATE'),
  async (req: Request, res: Response) => {
    try {
      const reportData = req.body;
      const generatedBy = (req as any).user.id;

      const report = await reportModel.generateClinicalReport({
        ...reportData,
        generatedBy,
      });

      logger.info(`Clinical report generated: ${report.id}`, {
        reportId: report.id,
        patientId: reportData.patientId,
        providerId: reportData.providerId,
        generatedBy,
      });

      res.status(201).json(
        createApiResponse(report, true, 'Clinical report generated successfully')
      );
    } catch (error) {
      logger.error('Error generating clinical report:', error);
      res.status(500).json(
        createErrorResponse('Failed to generate clinical report')
      );
    }
  }
);

/**
 * @route   POST /api/reports/analytics
 * @desc    Generate analytics report
 * @access  Private (Admin, Provider)
 */
router.post('/analytics',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  analyticsReportValidation,
  handleValidation,
  auditMiddleware('ANALYTICS_REPORT_GENERATE'),
  async (req: Request, res: Response) => {
    try {
      const reportData = req.body;
      const generatedBy = (req as any).user.id;

      const report = await reportModel.generateAnalyticsReport({
        ...reportData,
        generatedBy,
      });

      logger.info(`Analytics report generated: ${report.id}`, {
        reportId: report.id,
        metrics: reportData.metrics,
        generatedBy,
      });

      res.status(201).json(
        createApiResponse(report, true, 'Analytics report generated successfully')
      );
    } catch (error) {
      logger.error('Error generating analytics report:', error);
      res.status(500).json(
        createErrorResponse('Failed to generate analytics report')
      );
    }
  }
);

// ============================================================================
// REPORT RETRIEVAL ROUTES
// ============================================================================

/**
 * @route   GET /api/reports
 * @desc    Get reports with search and pagination
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
        type: req.query.type as any,
        format: req.query.format as any,
        status: req.query.status as any,
        generatedBy: req.query.generatedBy as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        isScheduled: req.query.isScheduled as any,
      };

      // Remove undefined values
      Object.keys(filters).forEach(key => {
        if (filters[key as keyof typeof filters] === undefined) {
          delete filters[key as keyof typeof filters];
        }
      });

      const result = await reportModel.findMany(filters, pagination);

      res.json(
        createApiResponse(result.data, true, undefined, result.pagination)
      );
    } catch (error) {
      logger.error('Error fetching reports:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch reports')
      );
    }
  }
);

/**
 * @route   GET /api/reports/:id
 * @desc    Get report by ID
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('id').isUUID()],
  handleValidation,
  checkReportAccess,
  auditMiddleware('REPORT_VIEW'),
  async (req: Request, res: Response) => {
    try {
      const report = (req as any).report;

      res.json(
        createApiResponse(report, true, 'Report retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching report:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch report')
      );
    }
  }
);

/**
 * @route   GET /api/reports/:id/download
 * @desc    Download report file
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/:id/download',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('id').isUUID()],
  handleValidation,
  checkReportAccess,
  auditMiddleware('REPORT_DOWNLOAD'),
  async (req: Request, res: Response) => {
    try {
      const report = (req as any).report;
      
      if (report.status !== 'COMPLETED') {
        return res.status(400).json(
          createErrorResponse('Report is not ready for download')
        );
      }

      if (!report.filePath) {
        return res.status(404).json(
          createErrorResponse('Report file not found')
        );
      }

      const buffer = await reportModel.getReportFile(report.id);

      // Set appropriate headers based on format
      const contentTypes = {
        JSON: 'application/json',
        CSV: 'text/csv',
        HTML: 'text/html',
        PDF: 'application/pdf',
      };

      const fileExtensions = {
        JSON: 'json',
        CSV: 'csv',
        HTML: 'html',
        PDF: 'pdf',
      };

      const contentType = contentTypes[report.format as keyof typeof contentTypes] || 'application/octet-stream';
      const extension = fileExtensions[report.format as keyof typeof fileExtensions] || 'txt';
      const filename = `${report.title.replace(/[^a-zA-Z0-9]/g, '_')}_${report.id.slice(0, 8)}.${extension}`;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'private, no-cache');

      logger.info(`Report downloaded: ${report.id}`, {
        reportId: report.id,
        title: report.title,
        format: report.format,
        downloadedBy: (req as any).user.id,
      });

      res.send(buffer);
    } catch (error) {
      logger.error('Error downloading report:', error);
      res.status(500).json(
        createErrorResponse('Failed to download report')
      );
    }
  }
);

/**
 * @route   GET /api/reports/:id/status
 * @desc    Get report generation status
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/:id/status',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('id').isUUID()],
  handleValidation,
  checkReportAccess,
  async (req: Request, res: Response) => {
    try {
      const report = (req as any).report;

      const status = {
        id: report.id,
        status: report.status,
        progress: report.progress || 0,
        generatedAt: report.generatedAt,
        completedAt: report.completedAt,
        errorMessage: report.errorMessage,
        isReady: report.status === 'COMPLETED' && report.filePath,
      };

      res.json(
        createApiResponse(status, true, 'Report status retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching report status:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch report status')
      );
    }
  }
);

// ============================================================================
// REPORT MANAGEMENT ROUTES
// ============================================================================

/**
 * @route   DELETE /api/reports/:id
 * @desc    Delete report
 * @access  Private (Admin, Provider)
 */
router.delete('/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  [param('id').isUUID()],
  handleValidation,
  checkReportAccess,
  auditMiddleware('REPORT_DELETE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deletedBy = (req as any).user.id;

      await reportModel.deleteReport(id, deletedBy);

      logger.info(`Report deleted: ${id}`, {
        reportId: id,
        deletedBy,
      });

      res.json(
        createApiResponse(null, true, 'Report deleted successfully')
      );
    } catch (error) {
      logger.error('Error deleting report:', error);
      res.status(500).json(
        createErrorResponse('Failed to delete report')
      );
    }
  }
);

/**
 * @route   POST /api/reports/:id/regenerate
 * @desc    Regenerate report
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/:id/regenerate',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('id').isUUID()],
  handleValidation,
  checkReportAccess,
  auditMiddleware('REPORT_REGENERATE'),
  async (req: Request, res: Response) => {
    try {
      const report = (req as any).report;
      const regeneratedBy = (req as any).user.id;

      // Create new report with same parameters
      const newReport = await reportModel.generateReport({
        title: `${report.title} (Regenerated)`,
        type: report.type,
        format: report.format,
        description: report.description,
        parameters: report.parameters,
        filters: report.filters,
        dateRange: report.dateRange,
        includePatientData: report.includePatientData,
        includeFinancialData: report.includeFinancialData,
        includeClinicalData: report.includeClinicalData,
        generatedBy: regeneratedBy,
      });

      logger.info(`Report regenerated: ${report.id} -> ${newReport.id}`, {
        originalReportId: report.id,
        newReportId: newReport.id,
        regeneratedBy,
      });

      res.status(202).json(
        createApiResponse(newReport, true, 'Report regeneration started successfully')
      );
    } catch (error) {
      logger.error('Error regenerating report:', error);
      res.status(500).json(
        createErrorResponse('Failed to regenerate report')
      );
    }
  }
);

// ============================================================================
// REPORT STATISTICS ROUTES
// ============================================================================

/**
 * @route   GET /api/reports/stats
 * @desc    Get report statistics
 * @access  Private (Admin, Provider)
 */
router.get('/stats',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  async (req: Request, res: Response) => {
    try {
      const stats = await reportModel.getStats();

      res.json(
        createApiResponse(stats, true, 'Report statistics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching report stats:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch report statistics')
      );
    }
  }
);

// ============================================================================
// REPORT TEMPLATES ROUTES
// ============================================================================

/**
 * @route   GET /api/reports/templates
 * @desc    Get available report templates
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/templates',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  async (req: Request, res: Response) => {
    try {
      // Predefined report templates
      const templates = [
        {
          id: 'patient-summary',
          name: 'Patient Summary Report',
          description: 'Comprehensive patient medical summary',
          type: 'CLINICAL',
          parameters: [
            { name: 'patientId', type: 'string', required: true },
            { name: 'includeVitals', type: 'boolean', default: true },
            { name: 'includeDiagnoses', type: 'boolean', default: true },
            { name: 'includePrescriptions', type: 'boolean', default: true },
          ],
        },
        {
          id: 'appointment-analytics',
          name: 'Appointment Analytics',
          description: 'Analysis of appointment trends and patterns',
          type: 'ANALYTICS',
          parameters: [
            { name: 'dateRange', type: 'object', required: true },
            { name: 'providerId', type: 'string', required: false },
            { name: 'departmentId', type: 'string', required: false },
          ],
        },
        {
          id: 'financial-summary',
          name: 'Financial Summary',
          description: 'Revenue and billing analysis',
          type: 'FINANCIAL',
          parameters: [
            { name: 'dateRange', type: 'object', required: true },
            { name: 'includeInsurance', type: 'boolean', default: true },
            { name: 'includePayments', type: 'boolean', default: true },
          ],
        },
        {
          id: 'compliance-audit',
          name: 'Compliance Audit Report',
          description: 'HIPAA and regulatory compliance audit',
          type: 'COMPLIANCE',
          parameters: [
            { name: 'dateRange', type: 'object', required: true },
            { name: 'auditType', type: 'string', required: true },
          ],
        },
        {
          id: 'provider-productivity',
          name: 'Provider Productivity Report',
          description: 'Analysis of provider performance and productivity',
          type: 'OPERATIONAL',
          parameters: [
            { name: 'providerId', type: 'string', required: false },
            { name: 'dateRange', type: 'object', required: true },
            { name: 'includePatientSatisfaction', type: 'boolean', default: false },
          ],
        },
      ];

      res.json(
        createApiResponse(templates, true, 'Report templates retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching report templates:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch report templates')
      );
    }
  }
);

/**
 * @route   POST /api/reports/templates/:templateId/generate
 * @desc    Generate report from template
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/templates/:templateId/generate',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [
    param('templateId').notEmpty().trim(),
    body('parameters').isObject(),
    body('format').optional().isIn(['JSON', 'CSV', 'HTML', 'PDF']),
    body('title').optional().trim().isLength({ min: 1, max: 200 }),
  ],
  handleValidation,
  auditMiddleware('REPORT_TEMPLATE_GENERATE'),
  async (req: Request, res: Response) => {
    try {
      const { templateId } = req.params;
      const { parameters, format = 'PDF', title } = req.body;
      const generatedBy = (req as any).user.id;

      // Map template ID to report type
      const templateTypeMap: Record<string, string> = {
        'patient-summary': 'CLINICAL',
        'appointment-analytics': 'ANALYTICS',
        'financial-summary': 'FINANCIAL',
        'compliance-audit': 'COMPLIANCE',
        'provider-productivity': 'OPERATIONAL',
      };

      const reportType = templateTypeMap[templateId];
      if (!reportType) {
        return res.status(400).json(
          createErrorResponse('Invalid template ID')
        );
      }

      const reportData = {
        title: title || `${templateId.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())} Report`,
        type: reportType,
        format,
        parameters,
        generatedBy,
      };

      const report = await reportModel.generateReport(reportData);

      logger.info(`Report generated from template: ${templateId}`, {
        templateId,
        reportId: report.id,
        generatedBy,
      });

      res.status(202).json(
        createApiResponse(report, true, 'Report generation from template started successfully')
      );
    } catch (error) {
      logger.error('Error generating report from template:', error);
      res.status(500).json(
        createErrorResponse('Failed to generate report from template')
      );
    }
  }
);

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Global error handler for report routes
 */
router.use((error: any, req: Request, res: Response, next: any) => {
  logger.error('Report route error:', error);
  
  if (error.code === 'ENOENT') {
    return res.status(404).json(
      createErrorResponse('Report file not found')
    );
  }
  
  if (error.code === 'EACCES') {
    return res.status(403).json(
      createErrorResponse('Report file access denied')
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