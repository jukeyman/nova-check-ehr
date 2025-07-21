/**
 * ============================================================================
 * NOVA CHECK EHR - ANALYTICS ROUTES
 * ============================================================================
 * 
 * RESTful API routes for analytics and business intelligence.
 * Handles metrics, dashboards, and data analysis.
 */

import { Router, Request, Response } from 'express';
import { query, validationResult } from 'express-validator';
import { AnalyticsModel, createApiResponse, createErrorResponse } from '../models';
import { authenticateToken, requireRole } from '../middleware/auth';
import { createAuditMiddleware } from '../models/Audit';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';
import { CacheService } from '../services/CacheService';

// ============================================================================
// ROUTER SETUP
// ============================================================================

const router = Router();
const prisma = new PrismaClient();
const cacheService = new CacheService();
const analyticsModel = new AnalyticsModel(prisma, cacheService);
const auditMiddleware = createAuditMiddleware(prisma);

// ============================================================================
// VALIDATION RULES
// ============================================================================

const dateRangeValidation = [
  query('startDate').optional().isISO8601().toDate(),
  query('endDate').optional().isISO8601().toDate(),
  query('period').optional().isIn(['today', 'yesterday', 'last7days', 'last30days', 'last90days', 'thisMonth', 'lastMonth', 'thisYear', 'lastYear']),
];

const dashboardValidation = [
  ...dateRangeValidation,
  query('providerId').optional().isUUID(),
  query('departmentId').optional().isUUID(),
  query('refresh').optional().isBoolean(),
];

const patientAnalyticsValidation = [
  ...dateRangeValidation,
  query('ageGroup').optional().isIn(['0-17', '18-34', '35-54', '55-74', '75+']),
  query('gender').optional().isIn(['MALE', 'FEMALE', 'OTHER']),
  query('insuranceType').optional().isIn(['PRIVATE', 'MEDICARE', 'MEDICAID', 'UNINSURED', 'OTHER']),
];

const providerAnalyticsValidation = [
  ...dateRangeValidation,
  query('providerId').optional().isUUID(),
  query('specialty').optional().trim(),
  query('departmentId').optional().isUUID(),
];

const financialAnalyticsValidation = [
  ...dateRangeValidation,
  query('includeInsurance').optional().isBoolean(),
  query('includePayments').optional().isBoolean(),
  query('groupBy').optional().isIn(['day', 'week', 'month', 'quarter']),
];

const operationalAnalyticsValidation = [
  ...dateRangeValidation,
  query('metric').optional().isIn(['appointments', 'waitTimes', 'noShows', 'cancellations', 'utilization']),
  query('departmentId').optional().isUUID(),
];

const clinicalAnalyticsValidation = [
  ...dateRangeValidation,
  query('diagnosisCode').optional().trim(),
  query('procedureCode').optional().trim(),
  query('providerId').optional().isUUID(),
];

const trendAnalysisValidation = [
  ...dateRangeValidation,
  query('metric').isIn(['patients', 'appointments', 'revenue', 'satisfaction', 'outcomes']),
  query('granularity').optional().isIn(['daily', 'weekly', 'monthly']),
  query('compareWith').optional().isIn(['previousPeriod', 'previousYear']),
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
 * Parse date range from query parameters
 */
const parseDateRange = (req: Request, res: Response, next: any) => {
  const { startDate, endDate, period } = req.query;
  
  let dateRange = { startDate: undefined as Date | undefined, endDate: undefined as Date | undefined };
  
  if (period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    switch (period) {
      case 'today':
        dateRange.startDate = today;
        dateRange.endDate = new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1);
        break;
      case 'yesterday':
        dateRange.startDate = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        dateRange.endDate = new Date(today.getTime() - 1);
        break;
      case 'last7days':
        dateRange.startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        dateRange.endDate = now;
        break;
      case 'last30days':
        dateRange.startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        dateRange.endDate = now;
        break;
      case 'last90days':
        dateRange.startDate = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
        dateRange.endDate = now;
        break;
      case 'thisMonth':
        dateRange.startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        dateRange.endDate = now;
        break;
      case 'lastMonth':
        dateRange.startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        dateRange.endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        break;
      case 'thisYear':
        dateRange.startDate = new Date(now.getFullYear(), 0, 1);
        dateRange.endDate = now;
        break;
      case 'lastYear':
        dateRange.startDate = new Date(now.getFullYear() - 1, 0, 1);
        dateRange.endDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
        break;
    }
  } else if (startDate || endDate) {
    dateRange.startDate = startDate as Date;
    dateRange.endDate = endDate as Date;
  }
  
  (req as any).dateRange = dateRange;
  next();
};

// ============================================================================
// DASHBOARD ROUTES
// ============================================================================

/**
 * @route   GET /api/analytics/dashboard
 * @desc    Get dashboard metrics
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/dashboard',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  dashboardValidation,
  handleValidation,
  parseDateRange,
  auditMiddleware('ANALYTICS_DASHBOARD_VIEW'),
  async (req: Request, res: Response) => {
    try {
      const dateRange = (req as any).dateRange;
      const { providerId, departmentId, refresh } = req.query;
      
      const filters = {
        providerId: providerId as string,
        departmentId: departmentId as string,
        refresh: refresh === 'true',
      };

      const metrics = await analyticsModel.getDashboardMetrics(dateRange, filters);

      res.json(
        createApiResponse(metrics, true, 'Dashboard metrics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching dashboard metrics:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch dashboard metrics')
      );
    }
  }
);

// ============================================================================
// PATIENT ANALYTICS ROUTES
// ============================================================================

/**
 * @route   GET /api/analytics/patients
 * @desc    Get patient analytics
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/patients',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  patientAnalyticsValidation,
  handleValidation,
  parseDateRange,
  async (req: Request, res: Response) => {
    try {
      const dateRange = (req as any).dateRange;
      const { ageGroup, gender, insuranceType } = req.query;
      
      const filters = {
        ageGroup: ageGroup as string,
        gender: gender as any,
        insuranceType: insuranceType as any,
      };

      const analytics = await analyticsModel.getPatientAnalytics(dateRange, filters);

      res.json(
        createApiResponse(analytics, true, 'Patient analytics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching patient analytics:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch patient analytics')
      );
    }
  }
);

/**
 * @route   GET /api/analytics/patients/demographics
 * @desc    Get patient demographics breakdown
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/patients/demographics',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  dateRangeValidation,
  handleValidation,
  parseDateRange,
  async (req: Request, res: Response) => {
    try {
      const dateRange = (req as any).dateRange;
      const analytics = await analyticsModel.getPatientAnalytics(dateRange);

      const demographics = {
        ageDistribution: analytics.ageDistribution,
        genderDistribution: analytics.genderDistribution,
        insuranceDistribution: analytics.insuranceDistribution,
        geographicDistribution: analytics.geographicDistribution,
      };

      res.json(
        createApiResponse(demographics, true, 'Patient demographics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching patient demographics:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch patient demographics')
      );
    }
  }
);

// ============================================================================
// PROVIDER ANALYTICS ROUTES
// ============================================================================

/**
 * @route   GET /api/analytics/providers
 * @desc    Get provider analytics
 * @access  Private (Admin, Provider)
 */
router.get('/providers',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  providerAnalyticsValidation,
  handleValidation,
  parseDateRange,
  async (req: Request, res: Response) => {
    try {
      const dateRange = (req as any).dateRange;
      const { providerId, specialty, departmentId } = req.query;
      
      const filters = {
        providerId: providerId as string,
        specialty: specialty as string,
        departmentId: departmentId as string,
      };

      const analytics = await analyticsModel.getProviderAnalytics(dateRange, filters);

      res.json(
        createApiResponse(analytics, true, 'Provider analytics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching provider analytics:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch provider analytics')
      );
    }
  }
);

/**
 * @route   GET /api/analytics/providers/productivity
 * @desc    Get provider productivity metrics
 * @access  Private (Admin, Provider)
 */
router.get('/providers/productivity',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  providerAnalyticsValidation,
  handleValidation,
  parseDateRange,
  async (req: Request, res: Response) => {
    try {
      const dateRange = (req as any).dateRange;
      const { providerId, departmentId } = req.query;
      
      const filters = {
        providerId: providerId as string,
        departmentId: departmentId as string,
      };

      const analytics = await analyticsModel.getProviderAnalytics(dateRange, filters);

      const productivity = {
        appointmentsPerDay: analytics.appointmentsPerDay,
        patientsPerDay: analytics.patientsPerDay,
        averageAppointmentDuration: analytics.averageAppointmentDuration,
        utilizationRate: analytics.utilizationRate,
        revenuePerAppointment: analytics.revenuePerAppointment,
        patientSatisfactionScore: analytics.patientSatisfactionScore,
      };

      res.json(
        createApiResponse(productivity, true, 'Provider productivity metrics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching provider productivity:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch provider productivity metrics')
      );
    }
  }
);

// ============================================================================
// FINANCIAL ANALYTICS ROUTES
// ============================================================================

/**
 * @route   GET /api/analytics/financial
 * @desc    Get financial analytics
 * @access  Private (Admin, Provider)
 */
router.get('/financial',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  financialAnalyticsValidation,
  handleValidation,
  parseDateRange,
  async (req: Request, res: Response) => {
    try {
      const dateRange = (req as any).dateRange;
      const { includeInsurance, includePayments, groupBy } = req.query;
      
      const filters = {
        includeInsurance: includeInsurance === 'true',
        includePayments: includePayments === 'true',
        groupBy: groupBy as string,
      };

      const analytics = await analyticsModel.getFinancialAnalytics(dateRange, filters);

      res.json(
        createApiResponse(analytics, true, 'Financial analytics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching financial analytics:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch financial analytics')
      );
    }
  }
);

/**
 * @route   GET /api/analytics/financial/revenue
 * @desc    Get revenue analytics
 * @access  Private (Admin, Provider)
 */
router.get('/financial/revenue',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  financialAnalyticsValidation,
  handleValidation,
  parseDateRange,
  async (req: Request, res: Response) => {
    try {
      const dateRange = (req as any).dateRange;
      const { groupBy } = req.query;
      
      const filters = {
        groupBy: groupBy as string,
      };

      const analytics = await analyticsModel.getFinancialAnalytics(dateRange, filters);

      const revenue = {
        totalRevenue: analytics.totalRevenue,
        revenueByPeriod: analytics.revenueByPeriod,
        revenueByProvider: analytics.revenueByProvider,
        revenueByInsurance: analytics.revenueByInsurance,
        outstandingAmount: analytics.outstandingAmount,
        collectionRate: analytics.collectionRate,
      };

      res.json(
        createApiResponse(revenue, true, 'Revenue analytics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching revenue analytics:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch revenue analytics')
      );
    }
  }
);

// ============================================================================
// OPERATIONAL ANALYTICS ROUTES
// ============================================================================

/**
 * @route   GET /api/analytics/operational
 * @desc    Get operational analytics
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/operational',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  operationalAnalyticsValidation,
  handleValidation,
  parseDateRange,
  async (req: Request, res: Response) => {
    try {
      const dateRange = (req as any).dateRange;
      const { metric, departmentId } = req.query;
      
      const filters = {
        metric: metric as string,
        departmentId: departmentId as string,
      };

      const analytics = await analyticsModel.getOperationalAnalytics(dateRange, filters);

      res.json(
        createApiResponse(analytics, true, 'Operational analytics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching operational analytics:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch operational analytics')
      );
    }
  }
);

/**
 * @route   GET /api/analytics/operational/appointments
 * @desc    Get appointment analytics
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/operational/appointments',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  operationalAnalyticsValidation,
  handleValidation,
  parseDateRange,
  async (req: Request, res: Response) => {
    try {
      const dateRange = (req as any).dateRange;
      const { departmentId } = req.query;
      
      const filters = {
        departmentId: departmentId as string,
      };

      const analytics = await analyticsModel.getOperationalAnalytics(dateRange, filters);

      const appointments = {
        totalAppointments: analytics.totalAppointments,
        scheduledAppointments: analytics.scheduledAppointments,
        completedAppointments: analytics.completedAppointments,
        cancelledAppointments: analytics.cancelledAppointments,
        noShowAppointments: analytics.noShowAppointments,
        averageWaitTime: analytics.averageWaitTime,
        appointmentsByType: analytics.appointmentsByType,
        appointmentsByStatus: analytics.appointmentsByStatus,
      };

      res.json(
        createApiResponse(appointments, true, 'Appointment analytics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching appointment analytics:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch appointment analytics')
      );
    }
  }
);

// ============================================================================
// CLINICAL ANALYTICS ROUTES
// ============================================================================

/**
 * @route   GET /api/analytics/clinical
 * @desc    Get clinical analytics
 * @access  Private (Admin, Provider)
 */
router.get('/clinical',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  clinicalAnalyticsValidation,
  handleValidation,
  parseDateRange,
  async (req: Request, res: Response) => {
    try {
      const dateRange = (req as any).dateRange;
      const { diagnosisCode, procedureCode, providerId } = req.query;
      
      const filters = {
        diagnosisCode: diagnosisCode as string,
        procedureCode: procedureCode as string,
        providerId: providerId as string,
      };

      const analytics = await analyticsModel.getClinicalAnalytics(dateRange, filters);

      res.json(
        createApiResponse(analytics, true, 'Clinical analytics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching clinical analytics:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch clinical analytics')
      );
    }
  }
);

/**
 * @route   GET /api/analytics/clinical/outcomes
 * @desc    Get clinical outcomes analytics
 * @access  Private (Admin, Provider)
 */
router.get('/clinical/outcomes',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  clinicalAnalyticsValidation,
  handleValidation,
  parseDateRange,
  async (req: Request, res: Response) => {
    try {
      const dateRange = (req as any).dateRange;
      const { providerId } = req.query;
      
      const filters = {
        providerId: providerId as string,
      };

      const analytics = await analyticsModel.getClinicalAnalytics(dateRange, filters);

      const outcomes = {
        totalEncounters: analytics.totalEncounters,
        averageEncounterDuration: analytics.averageEncounterDuration,
        commonDiagnoses: analytics.commonDiagnoses,
        commonProcedures: analytics.commonProcedures,
        readmissionRate: analytics.readmissionRate,
        patientSatisfactionScore: analytics.patientSatisfactionScore,
        qualityMetrics: analytics.qualityMetrics,
      };

      res.json(
        createApiResponse(outcomes, true, 'Clinical outcomes analytics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching clinical outcomes:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch clinical outcomes analytics')
      );
    }
  }
);

// ============================================================================
// TREND ANALYSIS ROUTES
// ============================================================================

/**
 * @route   GET /api/analytics/trends
 * @desc    Get trend analysis
 * @access  Private (Admin, Provider)
 */
router.get('/trends',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  trendAnalysisValidation,
  handleValidation,
  parseDateRange,
  async (req: Request, res: Response) => {
    try {
      const dateRange = (req as any).dateRange;
      const { metric, granularity, compareWith } = req.query;
      
      const filters = {
        metric: metric as string,
        granularity: granularity as string,
        compareWith: compareWith as string,
      };

      const trends = await analyticsModel.getTrendAnalysis(dateRange, filters);

      res.json(
        createApiResponse(trends, true, 'Trend analysis retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching trend analysis:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch trend analysis')
      );
    }
  }
);

// ============================================================================
// CACHE MANAGEMENT ROUTES
// ============================================================================

/**
 * @route   DELETE /api/analytics/cache
 * @desc    Clear analytics cache
 * @access  Private (Admin only)
 */
router.delete('/cache',
  authenticateToken,
  requireRole(['ADMIN']),
  auditMiddleware('ANALYTICS_CACHE_CLEAR'),
  async (req: Request, res: Response) => {
    try {
      await analyticsModel.clearCache();

      logger.info('Analytics cache cleared', {
        clearedBy: (req as any).user.id,
      });

      res.json(
        createApiResponse(null, true, 'Analytics cache cleared successfully')
      );
    } catch (error) {
      logger.error('Error clearing analytics cache:', error);
      res.status(500).json(
        createErrorResponse('Failed to clear analytics cache')
      );
    }
  }
);

// ============================================================================
// EXPORT ROUTES
// ============================================================================

/**
 * @route   GET /api/analytics/export
 * @desc    Export analytics data
 * @access  Private (Admin, Provider)
 */
router.get('/export',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  [
    ...dateRangeValidation,
    query('type').isIn(['dashboard', 'patients', 'providers', 'financial', 'operational', 'clinical']),
    query('format').optional().isIn(['json', 'csv', 'excel']),
  ],
  handleValidation,
  parseDateRange,
  auditMiddleware('ANALYTICS_EXPORT'),
  async (req: Request, res: Response) => {
    try {
      const dateRange = (req as any).dateRange;
      const { type, format = 'json' } = req.query;
      
      let data;
      switch (type) {
        case 'dashboard':
          data = await analyticsModel.getDashboardMetrics(dateRange);
          break;
        case 'patients':
          data = await analyticsModel.getPatientAnalytics(dateRange);
          break;
        case 'providers':
          data = await analyticsModel.getProviderAnalytics(dateRange);
          break;
        case 'financial':
          data = await analyticsModel.getFinancialAnalytics(dateRange);
          break;
        case 'operational':
          data = await analyticsModel.getOperationalAnalytics(dateRange);
          break;
        case 'clinical':
          data = await analyticsModel.getClinicalAnalytics(dateRange);
          break;
        default:
          return res.status(400).json(
            createErrorResponse('Invalid analytics type')
          );
      }

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
      const filename = `analytics_${type}_${new Date().toISOString().split('T')[0]}.${extension}`;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      if (format === 'json') {
        res.json(data);
      } else {
        // For CSV and Excel, you would implement conversion logic here
        // This is a placeholder - in a real implementation, you'd use libraries like csv-writer or exceljs
        res.json({
          message: `${format.toUpperCase()} export not implemented yet`,
          data,
        });
      }

      logger.info(`Analytics data exported: ${type}`, {
        type,
        format,
        exportedBy: (req as any).user.id,
      });
    } catch (error) {
      logger.error('Error exporting analytics data:', error);
      res.status(500).json(
        createErrorResponse('Failed to export analytics data')
      );
    }
  }
);

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Global error handler for analytics routes
 */
router.use((error: any, req: Request, res: Response, next: any) => {
  logger.error('Analytics route error:', error);
  
  if (error.message && error.message.includes('Invalid date range')) {
    return res.status(400).json(
      createErrorResponse('Invalid date range provided')
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