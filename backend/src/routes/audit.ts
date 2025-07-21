/**
 * ============================================================================
 * NOVA CHECK EHR - AUDIT ROUTES
 * ============================================================================
 * 
 * RESTful API routes for audit logs, compliance tracking, and security monitoring.
 * Handles audit events, compliance reports, and security alerts.
 */

import { Router, Request, Response } from 'express';
import { query, body, validationResult } from 'express-validator';
import { AuditModel, createApiResponse, createErrorResponse, validatePagination, calculatePagination } from '../models';
import { authenticateToken, requireRole } from '../middleware/auth';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';

// ============================================================================
// ROUTER SETUP
// ============================================================================

const router = Router();
const prisma = new PrismaClient();
const auditModel = new AuditModel(prisma);

// ============================================================================
// VALIDATION RULES
// ============================================================================

const auditSearchValidation = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('search').optional().trim(),
  query('userId').optional().isUUID(),
  query('patientId').optional().isUUID(),
  query('action').optional().trim(),
  query('resource').optional().trim(),
  query('severity').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  query('startDate').optional().isISO8601().toDate(),
  query('endDate').optional().isISO8601().toDate(),
  query('ipAddress').optional().isIP(),
  query('userAgent').optional().trim(),
  query('success').optional().isBoolean(),
];

const complianceReportValidation = [
  query('startDate').isISO8601().toDate(),
  query('endDate').isISO8601().toDate(),
  query('reportType').optional().isIn(['HIPAA', 'SOX', 'GDPR', 'HITECH', 'CUSTOM']),
  query('includeDetails').optional().isBoolean(),
  query('format').optional().isIn(['json', 'pdf', 'csv']),
];

const patientAccessValidation = [
  query('patientId').isUUID(),
  query('startDate').optional().isISO8601().toDate(),
  query('endDate').optional().isISO8601().toDate(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const userActivityValidation = [
  query('userId').isUUID(),
  query('startDate').optional().isISO8601().toDate(),
  query('endDate').optional().isISO8601().toDate(),
  query('includeDetails').optional().isBoolean(),
];

const cleanupValidation = [
  query('olderThanDays').isInt({ min: 30 }).toInt(),
  query('dryRun').optional().isBoolean(),
];

const manualLogValidation = [
  body('action').notEmpty().trim(),
  body('resource').notEmpty().trim(),
  body('resourceId').optional().isUUID(),
  body('patientId').optional().isUUID(),
  body('details').optional().isObject(),
  body('severity').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
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
 * Check audit access permissions
 */
const checkAuditAccess = (req: Request, res: Response, next: any) => {
  const user = (req as any).user;
  
  // Only admins and compliance officers can access audit logs
  if (!['ADMIN', 'COMPLIANCE_OFFICER'].includes(user.role)) {
    return res.status(403).json(
      createErrorResponse('Insufficient permissions to access audit logs')
    );
  }
  
  next();
};

/**
 * Check patient access permissions
 */
const checkPatientAccessPermission = (req: Request, res: Response, next: any) => {
  const user = (req as any).user;
  const { patientId } = req.query;
  
  // Providers can only access audit logs for their own patients
  if (user.role === 'PROVIDER' && patientId) {
    // In a real implementation, you would check if the provider has access to this patient
    // For now, we'll allow it but log the access
    logger.info('Provider accessing patient audit logs', {
      providerId: user.id,
      patientId,
    });
  }
  
  next();
};

// ============================================================================
// AUDIT LOG ROUTES
// ============================================================================

/**
 * @route   GET /api/audit/logs
 * @desc    Get audit logs with search and pagination
 * @access  Private (Admin, Compliance Officer)
 */
router.get('/logs',
  authenticateToken,
  checkAuditAccess,
  auditSearchValidation,
  handleValidation,
  checkPatientAccessPermission,
  async (req: Request, res: Response) => {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        userId,
        patientId,
        action,
        resource,
        severity,
        startDate,
        endDate,
        ipAddress,
        userAgent,
        success,
      } = req.query;

      const pagination = validatePagination(page as number, limit as number);
      
      const filters = {
        search: search as string,
        userId: userId as string,
        patientId: patientId as string,
        action: action as string,
        resource: resource as string,
        severity: severity as any,
        startDate: startDate as Date,
        endDate: endDate as Date,
        ipAddress: ipAddress as string,
        userAgent: userAgent as string,
        success: success === 'true' ? true : success === 'false' ? false : undefined,
      };

      const result = await auditModel.findMany(filters, pagination);
      const paginationInfo = calculatePagination(result.total, pagination.page, pagination.limit);

      // Log the audit log access
      await auditModel.log({
        userId: (req as any).user.id,
        action: 'AUDIT_LOGS_VIEW',
        resource: 'AUDIT_LOG',
        details: {
          filters,
          resultCount: result.logs.length,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.json(
        createApiResponse(
          {
            logs: result.logs,
            pagination: paginationInfo,
          },
          true,
          'Audit logs retrieved successfully'
        )
      );
    } catch (error) {
      logger.error('Error fetching audit logs:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch audit logs')
      );
    }
  }
);

/**
 * @route   GET /api/audit/logs/:id
 * @desc    Get specific audit log by ID
 * @access  Private (Admin, Compliance Officer)
 */
router.get('/logs/:id',
  authenticateToken,
  checkAuditAccess,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const log = await prisma.auditLog.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
            },
          },
        },
      });

      if (!log) {
        return res.status(404).json(
          createErrorResponse('Audit log not found')
        );
      }

      // Log the audit log access
      await auditModel.log({
        userId: (req as any).user.id,
        action: 'AUDIT_LOG_VIEW',
        resource: 'AUDIT_LOG',
        resourceId: id,
        details: {
          viewedLogId: id,
          viewedLogAction: log.action,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.json(
        createApiResponse(log, true, 'Audit log retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching audit log:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch audit log')
      );
    }
  }
);

/**
 * @route   POST /api/audit/logs
 * @desc    Create manual audit log entry
 * @access  Private (Admin, Compliance Officer)
 */
router.post('/logs',
  authenticateToken,
  checkAuditAccess,
  manualLogValidation,
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const {
        action,
        resource,
        resourceId,
        patientId,
        details,
        severity,
      } = req.body;

      const auditEvent = {
        userId: (req as any).user.id,
        action,
        resource,
        resourceId,
        patientId,
        details: {
          ...details,
          manualEntry: true,
          createdBy: (req as any).user.id,
        },
        severity,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      };

      const log = await auditModel.log(auditEvent);

      res.status(201).json(
        createApiResponse(log, true, 'Manual audit log created successfully')
      );
    } catch (error) {
      logger.error('Error creating manual audit log:', error);
      res.status(500).json(
        createErrorResponse('Failed to create manual audit log')
      );
    }
  }
);

// ============================================================================
// STATISTICS ROUTES
// ============================================================================

/**
 * @route   GET /api/audit/stats
 * @desc    Get audit statistics
 * @access  Private (Admin, Compliance Officer)
 */
router.get('/stats',
  authenticateToken,
  checkAuditAccess,
  [
    query('startDate').optional().isISO8601().toDate(),
    query('endDate').optional().isISO8601().toDate(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const { startDate, endDate } = req.query;
      
      const dateRange = {
        startDate: startDate as Date,
        endDate: endDate as Date,
      };

      const stats = await auditModel.getStats(dateRange);

      // Log the stats access
      await auditModel.log({
        userId: (req as any).user.id,
        action: 'AUDIT_STATS_VIEW',
        resource: 'AUDIT_STATS',
        details: {
          dateRange,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.json(
        createApiResponse(stats, true, 'Audit statistics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching audit statistics:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch audit statistics')
      );
    }
  }
);

// ============================================================================
// COMPLIANCE ROUTES
// ============================================================================

/**
 * @route   GET /api/audit/compliance/report
 * @desc    Generate compliance report
 * @access  Private (Admin, Compliance Officer)
 */
router.get('/compliance/report',
  authenticateToken,
  checkAuditAccess,
  complianceReportValidation,
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const {
        startDate,
        endDate,
        reportType = 'HIPAA',
        includeDetails = false,
        format = 'json',
      } = req.query;

      const dateRange = {
        startDate: startDate as Date,
        endDate: endDate as Date,
      };

      const options = {
        reportType: reportType as string,
        includeDetails: includeDetails === 'true',
      };

      const report = await auditModel.generateComplianceReport(dateRange, options);

      // Log the compliance report generation
      await auditModel.log({
        userId: (req as any).user.id,
        action: 'COMPLIANCE_REPORT_GENERATE',
        resource: 'COMPLIANCE_REPORT',
        details: {
          reportType,
          dateRange,
          format,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      // Set appropriate headers for different formats
      if (format === 'pdf') {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="compliance_report_${reportType}_${new Date().toISOString().split('T')[0]}.pdf"`);
        // In a real implementation, you would generate and return PDF content
        res.json({ message: 'PDF generation not implemented', report });
      } else if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="compliance_report_${reportType}_${new Date().toISOString().split('T')[0]}.csv"`);
        // In a real implementation, you would generate and return CSV content
        res.json({ message: 'CSV generation not implemented', report });
      } else {
        res.json(
          createApiResponse(report, true, 'Compliance report generated successfully')
        );
      }
    } catch (error) {
      logger.error('Error generating compliance report:', error);
      res.status(500).json(
        createErrorResponse('Failed to generate compliance report')
      );
    }
  }
);

// ============================================================================
// PATIENT ACCESS ROUTES
// ============================================================================

/**
 * @route   GET /api/audit/patient-access
 * @desc    Get patient access history
 * @access  Private (Admin, Compliance Officer, Provider)
 */
router.get('/patient-access',
  authenticateToken,
  requireRole(['ADMIN', 'COMPLIANCE_OFFICER', 'PROVIDER']),
  patientAccessValidation,
  handleValidation,
  checkPatientAccessPermission,
  async (req: Request, res: Response) => {
    try {
      const {
        patientId,
        startDate,
        endDate,
        page = 1,
        limit = 20,
      } = req.query;

      const pagination = validatePagination(page as number, limit as number);
      
      const dateRange = {
        startDate: startDate as Date,
        endDate: endDate as Date,
      };

      const result = await auditModel.getPatientAccessHistory(
        patientId as string,
        dateRange,
        pagination
      );
      
      const paginationInfo = calculatePagination(result.total, pagination.page, pagination.limit);

      // Log the patient access history view
      await auditModel.log({
        userId: (req as any).user.id,
        action: 'PATIENT_ACCESS_HISTORY_VIEW',
        resource: 'PATIENT_ACCESS_HISTORY',
        patientId: patientId as string,
        details: {
          dateRange,
          resultCount: result.accessHistory.length,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.json(
        createApiResponse(
          {
            accessHistory: result.accessHistory,
            pagination: paginationInfo,
          },
          true,
          'Patient access history retrieved successfully'
        )
      );
    } catch (error) {
      logger.error('Error fetching patient access history:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch patient access history')
      );
    }
  }
);

// ============================================================================
// USER ACTIVITY ROUTES
// ============================================================================

/**
 * @route   GET /api/audit/user-activity
 * @desc    Get user activity summary
 * @access  Private (Admin, Compliance Officer)
 */
router.get('/user-activity',
  authenticateToken,
  checkAuditAccess,
  userActivityValidation,
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const {
        userId,
        startDate,
        endDate,
        includeDetails = false,
      } = req.query;

      const dateRange = {
        startDate: startDate as Date,
        endDate: endDate as Date,
      };

      const options = {
        includeDetails: includeDetails === 'true',
      };

      const activity = await auditModel.getUserActivitySummary(
        userId as string,
        dateRange,
        options
      );

      // Log the user activity view
      await auditModel.log({
        userId: (req as any).user.id,
        action: 'USER_ACTIVITY_VIEW',
        resource: 'USER_ACTIVITY',
        details: {
          viewedUserId: userId,
          dateRange,
          includeDetails,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.json(
        createApiResponse(activity, true, 'User activity summary retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching user activity summary:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch user activity summary')
      );
    }
  }
);

// ============================================================================
// SECURITY ROUTES
// ============================================================================

/**
 * @route   GET /api/audit/security/alerts
 * @desc    Get security alerts
 * @access  Private (Admin, Compliance Officer)
 */
router.get('/security/alerts',
  authenticateToken,
  checkAuditAccess,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('severity').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    query('resolved').optional().isBoolean(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const {
        page = 1,
        limit = 20,
        severity,
        resolved,
      } = req.query;

      const pagination = validatePagination(page as number, limit as number);
      
      const filters = {
        severity: severity as any,
        resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined,
      };

      // Get security alerts from audit logs
      const auditFilters = {
        severity: filters.severity,
        action: 'SECURITY_ALERT',
      };

      const result = await auditModel.findMany(auditFilters, pagination);
      const paginationInfo = calculatePagination(result.total, pagination.page, pagination.limit);

      // Transform audit logs to security alerts format
      const alerts = result.logs.map(log => ({
        id: log.id,
        type: log.details?.alertType || 'UNKNOWN',
        severity: log.severity,
        message: log.details?.message || log.action,
        userId: log.userId,
        user: log.user,
        timestamp: log.timestamp,
        resolved: log.details?.resolved || false,
        details: log.details,
      }));

      // Log the security alerts access
      await auditModel.log({
        userId: (req as any).user.id,
        action: 'SECURITY_ALERTS_VIEW',
        resource: 'SECURITY_ALERTS',
        details: {
          filters,
          resultCount: alerts.length,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.json(
        createApiResponse(
          {
            alerts,
            pagination: paginationInfo,
          },
          true,
          'Security alerts retrieved successfully'
        )
      );
    } catch (error) {
      logger.error('Error fetching security alerts:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch security alerts')
      );
    }
  }
);

// ============================================================================
// MAINTENANCE ROUTES
// ============================================================================

/**
 * @route   DELETE /api/audit/cleanup
 * @desc    Clean up old audit logs
 * @access  Private (Admin only)
 */
router.delete('/cleanup',
  authenticateToken,
  requireRole(['ADMIN']),
  cleanupValidation,
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const {
        olderThanDays,
        dryRun = false,
      } = req.query;

      const result = await auditModel.cleanupOldLogs(
        olderThanDays as number,
        dryRun === 'true'
      );

      // Log the cleanup operation
      await auditModel.log({
        userId: (req as any).user.id,
        action: 'AUDIT_LOGS_CLEANUP',
        resource: 'AUDIT_LOG',
        details: {
          olderThanDays,
          dryRun: dryRun === 'true',
          deletedCount: result.deletedCount,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.json(
        createApiResponse(
          result,
          true,
          dryRun === 'true' 
            ? 'Audit logs cleanup simulation completed'
            : 'Audit logs cleanup completed successfully'
        )
      );
    } catch (error) {
      logger.error('Error cleaning up audit logs:', error);
      res.status(500).json(
        createErrorResponse('Failed to clean up audit logs')
      );
    }
  }
);

// ============================================================================
// EXPORT ROUTES
// ============================================================================

/**
 * @route   GET /api/audit/export
 * @desc    Export audit logs
 * @access  Private (Admin, Compliance Officer)
 */
router.get('/export',
  authenticateToken,
  checkAuditAccess,
  [
    ...auditSearchValidation,
    query('format').optional().isIn(['json', 'csv', 'excel']),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const {
        format = 'json',
        search,
        userId,
        patientId,
        action,
        resource,
        severity,
        startDate,
        endDate,
        ipAddress,
        userAgent,
        success,
      } = req.query;

      const filters = {
        search: search as string,
        userId: userId as string,
        patientId: patientId as string,
        action: action as string,
        resource: resource as string,
        severity: severity as any,
        startDate: startDate as Date,
        endDate: endDate as Date,
        ipAddress: ipAddress as string,
        userAgent: userAgent as string,
        success: success === 'true' ? true : success === 'false' ? false : undefined,
      };

      // Get all matching logs (without pagination for export)
      const result = await auditModel.findMany(filters, { page: 1, limit: 10000 });

      // Set appropriate headers based on format
      const contentTypes = {
        json: 'application/json',
        csv: 'text/csv',
        excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };

      const fileExtensions = {
        json: 'json',
        csv: 'csv',
        excel: 'xlsx',
      };

      const contentType = contentTypes[format as keyof typeof contentTypes];
      const extension = fileExtensions[format as keyof typeof fileExtensions];
      const filename = `audit_logs_${new Date().toISOString().split('T')[0]}.${extension}`;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      if (format === 'json') {
        res.json(result.logs);
      } else {
        // For CSV and Excel, you would implement conversion logic here
        // This is a placeholder - in a real implementation, you'd use libraries like csv-writer or exceljs
        res.json({
          message: `${format.toUpperCase()} export not implemented yet`,
          data: result.logs,
        });
      }

      // Log the export operation
      await auditModel.log({
        userId: (req as any).user.id,
        action: 'AUDIT_LOGS_EXPORT',
        resource: 'AUDIT_LOG',
        details: {
          format,
          filters,
          exportedCount: result.logs.length,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      logger.info(`Audit logs exported: ${format}`, {
        format,
        exportedBy: (req as any).user.id,
        count: result.logs.length,
      });
    } catch (error) {
      logger.error('Error exporting audit logs:', error);
      res.status(500).json(
        createErrorResponse('Failed to export audit logs')
      );
    }
  }
);

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Global error handler for audit routes
 */
router.use((error: any, req: Request, res: Response, next: any) => {
  logger.error('Audit route error:', error);
  
  if (error.message && error.message.includes('Invalid date range')) {
    return res.status(400).json(
      createErrorResponse('Invalid date range provided')
    );
  }
  
  if (error.message && error.message.includes('Insufficient permissions')) {
    return res.status(403).json(
      createErrorResponse('Insufficient permissions to access audit data')
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