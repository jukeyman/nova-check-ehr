/**
 * ============================================================================
 * NOVA CHECK EHR - ANALYTICS & REPORTING ROUTES
 * ============================================================================
 */

import { Router, Request, Response } from 'express';
import { query, validationResult } from 'express-validator';
import { PrismaClient, UserRole, AppointmentStatus, MedicalRecordType } from '@prisma/client';
import config from '../config/config';
import logger from '../config/logger';
import { authenticateToken, requireRole } from '../middleware/auth';
import { rateLimiters } from '../middleware/security';
import auditService from '../services/auditService';
import cacheService from '../services/cacheService';
import analyticsService from '../services/analyticsService';
import { llmIntegrationService } from '../services/llmIntegrationService';
import { aiService } from '../services/aiService';

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

interface AnalyticsResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
  metadata?: {
    generatedAt: Date;
    period: string;
    facilityId?: string;
  };
}

// Validation middleware
const validateDateRange = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date format'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date format'),
  query('period')
    .optional()
    .isIn(['day', 'week', 'month', 'quarter', 'year'])
    .withMessage('Invalid period. Must be one of: day, week, month, quarter, year'),
];

const validateMetricsQuery = [
  ...validateDateRange,
  query('facilityId')
    .optional()
    .isUUID()
    .withMessage('Invalid facility ID'),
  query('providerId')
    .optional()
    .isUUID()
    .withMessage('Invalid provider ID'),
  query('departmentId')
    .optional()
    .isUUID()
    .withMessage('Invalid department ID'),
];

// Helper functions
const getDateRange = (period?: string, startDate?: string, endDate?: string) => {
  const now = new Date();
  let start: Date;
  let end: Date = new Date(now);

  if (startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
  } else {
    switch (period) {
      case 'day':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'quarter':
        const quarterStart = Math.floor(now.getMonth() / 3) * 3;
        start = new Date(now.getFullYear(), quarterStart, 1);
        break;
      case 'year':
        start = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // Last 30 days
    }
  }

  return { start, end };
};

const getFacilityFilter = (user: any, facilityId?: string) => {
  if (user.role === UserRole.SUPER_ADMIN) {
    return facilityId ? { facilityId } : {};
  }
  return { facilityId: user.facilityId };
};

const formatPercentage = (value: number, total: number): string => {
  if (total === 0) return '0.00';
  return ((value / total) * 100).toFixed(2);
};

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

// Routes

/**
 * @route   GET /api/v1/analytics/dashboard
 * @desc    Get dashboard analytics overview
 * @access  Private (Healthcare providers and admins)
 */
router.get('/dashboard', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.SUPER_ADMIN]), validateDateRange, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { period = 'month', startDate, endDate } = req.query;
    const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
    const facilityFilter = getFacilityFilter(req.user);

    // Check cache first
    const cacheKey = `dashboard_analytics_${req.user?.id}_${period}_${start.getTime()}_${end.getTime()}`;
    const cachedData = await cacheService.get(cacheKey);
    if (cachedData) {
      return res.json({
        success: true,
        message: 'Dashboard analytics retrieved successfully (cached)',
        data: cachedData,
        metadata: {
          generatedAt: new Date(),
          period: period as string,
          facilityId: req.user?.facilityId,
        },
      });
    }

    // Get dashboard metrics
    const [patientStats, appointmentStats, providerStats, revenueStats, recentActivity] = await Promise.all([
      // Patient statistics
      Promise.all([
        prisma.patient.count({ where: { ...facilityFilter, createdAt: { gte: start, lte: end } } }),
        prisma.patient.count({ where: { ...facilityFilter, status: 'ACTIVE' } }),
        prisma.patient.count({ where: facilityFilter }),
      ]),
      
      // Appointment statistics
      Promise.all([
        prisma.appointment.count({ where: { ...facilityFilter, scheduledAt: { gte: start, lte: end } } }),
        prisma.appointment.count({ where: { ...facilityFilter, status: AppointmentStatus.SCHEDULED, scheduledAt: { gte: start, lte: end } } }),
        prisma.appointment.count({ where: { ...facilityFilter, status: AppointmentStatus.COMPLETED, scheduledAt: { gte: start, lte: end } } }),
        prisma.appointment.count({ where: { ...facilityFilter, status: AppointmentStatus.CANCELLED, scheduledAt: { gte: start, lte: end } } }),
        prisma.appointment.count({ where: { ...facilityFilter, status: AppointmentStatus.NO_SHOW, scheduledAt: { gte: start, lte: end } } }),
      ]),
      
      // Provider statistics
      Promise.all([
        prisma.provider.count({ where: { ...facilityFilter, status: 'ACTIVE' } }),
        prisma.provider.count({ where: facilityFilter }),
      ]),
      
      // Revenue statistics (if available)
      Promise.all([
        prisma.appointment.aggregate({
          where: {
            ...facilityFilter,
            status: AppointmentStatus.COMPLETED,
            scheduledAt: { gte: start, lte: end },
          },
          _sum: { fee: true },
          _avg: { fee: true },
        }),
      ]),
      
      // Recent activity
      Promise.all([
        prisma.appointment.findMany({
          where: {
            ...facilityFilter,
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            patient: { select: { firstName: true, lastName: true } },
            provider: { select: { firstName: true, lastName: true } },
          },
        }),
        prisma.patient.findMany({
          where: {
            ...facilityFilter,
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
            createdAt: true,
          },
        }),
      ]),
    ]);

    const [newPatients, activePatients, totalPatients] = patientStats;
    const [totalAppointments, scheduledAppointments, completedAppointments, cancelledAppointments, noShowAppointments] = appointmentStats;
    const [activeProviders, totalProviders] = providerStats;
    const [revenueData] = revenueStats;
    const [recentAppointments, recentPatients] = recentActivity;

    const dashboardData = {
      patients: {
        new: newPatients,
        active: activePatients,
        total: totalPatients,
        growthRate: formatPercentage(newPatients, totalPatients),
      },
      appointments: {
        total: totalAppointments,
        scheduled: scheduledAppointments,
        completed: completedAppointments,
        cancelled: cancelledAppointments,
        noShow: noShowAppointments,
        completionRate: formatPercentage(completedAppointments, totalAppointments),
        cancellationRate: formatPercentage(cancelledAppointments + noShowAppointments, totalAppointments),
      },
      providers: {
        active: activeProviders,
        total: totalProviders,
        utilizationRate: formatPercentage(activeProviders, totalProviders),
      },
      revenue: {
        total: revenueData._sum.fee || 0,
        average: revenueData._avg.fee || 0,
        formattedTotal: formatCurrency(revenueData._sum.fee || 0),
        formattedAverage: formatCurrency(revenueData._avg.fee || 0),
      },
      recentActivity: {
        appointments: recentAppointments.map(apt => ({
          id: apt.id,
          patient: `${apt.patient.firstName} ${apt.patient.lastName}`,
          provider: `${apt.provider.firstName} ${apt.provider.lastName}`,
          scheduledAt: apt.scheduledAt,
          status: apt.status,
          type: apt.type,
        })),
        patients: recentPatients.map(patient => ({
          id: patient.id,
          patientId: patient.patientId,
          name: `${patient.firstName} ${patient.lastName}`,
          createdAt: patient.createdAt,
        })),
      },
    };

    // Cache the results for 15 minutes
    await cacheService.set(cacheKey, dashboardData, 15 * 60);

    const response: AnalyticsResponse = {
      success: true,
      message: 'Dashboard analytics retrieved successfully',
      data: dashboardData,
      metadata: {
        generatedAt: new Date(),
        period: period as string,
        facilityId: req.user?.facilityId,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get dashboard analytics error', {
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
 * @route   GET /api/v1/analytics/appointments
 * @desc    Get appointment analytics
 * @access  Private (Healthcare providers and admins)
 */
router.get('/appointments', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.SUPER_ADMIN]), validateMetricsQuery, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { period = 'month', startDate, endDate, facilityId, providerId } = req.query;
    const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
    const facilityFilter = getFacilityFilter(req.user, facilityId as string);

    const whereClause: any = {
      ...facilityFilter,
      scheduledAt: { gte: start, lte: end },
    };

    if (providerId) {
      whereClause.providerId = providerId;
    }

    const [appointmentsByStatus, appointmentsByType, appointmentsByDay, appointmentsByProvider, avgDuration] = await Promise.all([
      // Appointments by status
      prisma.appointment.groupBy({
        by: ['status'],
        where: whereClause,
        _count: { id: true },
      }),
      
      // Appointments by type
      prisma.appointment.groupBy({
        by: ['type'],
        where: whereClause,
        _count: { id: true },
      }),
      
      // Appointments by day (time series)
      prisma.$queryRaw`
        SELECT 
          DATE(scheduledAt) as date,
          COUNT(*) as count,
          COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) as cancelled
        FROM Appointment 
        WHERE scheduledAt >= ${start} AND scheduledAt <= ${end}
        ${facilityFilter.facilityId ? prisma.$queryRaw`AND facilityId = ${facilityFilter.facilityId}` : prisma.$queryRaw``}
        ${providerId ? prisma.$queryRaw`AND providerId = ${providerId}` : prisma.$queryRaw``}
        GROUP BY DATE(scheduledAt)
        ORDER BY date
      `,
      
      // Appointments by provider
      prisma.appointment.groupBy({
        by: ['providerId'],
        where: whereClause,
        _count: { id: true },
        _avg: { duration: true },
      }),
      
      // Average appointment duration
      prisma.appointment.aggregate({
        where: whereClause,
        _avg: { duration: true },
      }),
    ]);

    // Get provider details for the provider stats
    const providerIds = appointmentsByProvider.map(p => p.providerId);
    const providers = await prisma.provider.findMany({
      where: { id: { in: providerIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        specialization: true,
      },
    });

    const providerMap = providers.reduce((acc, provider) => {
      acc[provider.id] = provider;
      return acc;
    }, {} as Record<string, any>);

    const analyticsData = {
      summary: {
        totalAppointments: appointmentsByStatus.reduce((sum, item) => sum + item._count.id, 0),
        averageDuration: avgDuration._avg.duration || 0,
        completionRate: formatPercentage(
          appointmentsByStatus.find(s => s.status === AppointmentStatus.COMPLETED)?._count.id || 0,
          appointmentsByStatus.reduce((sum, item) => sum + item._count.id, 0)
        ),
      },
      byStatus: appointmentsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count.id;
        return acc;
      }, {} as Record<string, number>),
      byType: appointmentsByType.reduce((acc, item) => {
        acc[item.type] = item._count.id;
        return acc;
      }, {} as Record<string, number>),
      timeSeries: appointmentsByDay,
      byProvider: appointmentsByProvider.map(item => ({
        providerId: item.providerId,
        provider: providerMap[item.providerId] ? {
          name: `${providerMap[item.providerId].firstName} ${providerMap[item.providerId].lastName}`,
          specialization: providerMap[item.providerId].specialization,
        } : null,
        appointmentCount: item._count.id,
        averageDuration: item._avg.duration || 0,
      })),
    };

    const response: AnalyticsResponse = {
      success: true,
      message: 'Appointment analytics retrieved successfully',
      data: analyticsData,
      metadata: {
        generatedAt: new Date(),
        period: period as string,
        facilityId: req.user?.facilityId,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get appointment analytics error', {
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
 * @route   GET /api/v1/analytics/patients
 * @desc    Get patient analytics
 * @access  Private (Healthcare providers and admins)
 */
router.get('/patients', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.SUPER_ADMIN]), validateMetricsQuery, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { period = 'month', startDate, endDate, facilityId } = req.query;
    const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
    const facilityFilter = getFacilityFilter(req.user, facilityId as string);

    const [patientsByGender, patientsByAge, patientRegistrations, patientsByStatus, topConditions] = await Promise.all([
      // Patients by gender
      prisma.patient.groupBy({
        by: ['gender'],
        where: facilityFilter,
        _count: { id: true },
      }),
      
      // Patients by age group
      prisma.$queryRaw`
        SELECT 
          CASE 
            WHEN TIMESTAMPDIFF(YEAR, dateOfBirth, CURDATE()) < 18 THEN 'Under 18'
            WHEN TIMESTAMPDIFF(YEAR, dateOfBirth, CURDATE()) BETWEEN 18 AND 30 THEN '18-30'
            WHEN TIMESTAMPDIFF(YEAR, dateOfBirth, CURDATE()) BETWEEN 31 AND 50 THEN '31-50'
            WHEN TIMESTAMPDIFF(YEAR, dateOfBirth, CURDATE()) BETWEEN 51 AND 70 THEN '51-70'
            ELSE 'Over 70'
          END as ageGroup,
          COUNT(*) as count
        FROM Patient 
        WHERE dateOfBirth IS NOT NULL
        ${facilityFilter.facilityId ? prisma.$queryRaw`AND facilityId = ${facilityFilter.facilityId}` : prisma.$queryRaw``}
        GROUP BY ageGroup
        ORDER BY ageGroup
      `,
      
      // Patient registrations over time
      prisma.$queryRaw`
        SELECT 
          DATE(createdAt) as date,
          COUNT(*) as count
        FROM Patient 
        WHERE createdAt >= ${start} AND createdAt <= ${end}
        ${facilityFilter.facilityId ? prisma.$queryRaw`AND facilityId = ${facilityFilter.facilityId}` : prisma.$queryRaw``}
        GROUP BY DATE(createdAt)
        ORDER BY date
      `,
      
      // Patients by status
      prisma.patient.groupBy({
        by: ['status'],
        where: facilityFilter,
        _count: { id: true },
      }),
      
      // Top medical conditions (from medical records)
      prisma.medicalRecord.groupBy({
        by: ['diagnosis'],
        where: {
          patient: facilityFilter,
          diagnosis: { not: null },
          createdAt: { gte: start, lte: end },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ]);

    const analyticsData = {
      summary: {
        totalPatients: patientsByStatus.reduce((sum, item) => sum + item._count.id, 0),
        activePatients: patientsByStatus.find(s => s.status === 'ACTIVE')?._count.id || 0,
        newRegistrations: patientRegistrations.reduce((sum: number, item: any) => sum + Number(item.count), 0),
      },
      demographics: {
        byGender: patientsByGender.reduce((acc, item) => {
          acc[item.gender] = item._count.id;
          return acc;
        }, {} as Record<string, number>),
        byAge: patientsByAge,
      },
      registrations: patientRegistrations,
      byStatus: patientsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count.id;
        return acc;
      }, {} as Record<string, number>),
      topConditions: topConditions.map(condition => ({
        diagnosis: condition.diagnosis,
        count: condition._count.id,
      })),
    };

    const response: AnalyticsResponse = {
      success: true,
      message: 'Patient analytics retrieved successfully',
      data: analyticsData,
      metadata: {
        generatedAt: new Date(),
        period: period as string,
        facilityId: req.user?.facilityId,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get patient analytics error', {
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
 * @route   GET /api/v1/analytics/providers
 * @desc    Get provider analytics
 * @access  Private (Admins only)
 */
router.get('/providers', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), validateMetricsQuery, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { period = 'month', startDate, endDate, facilityId } = req.query;
    const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
    const facilityFilter = getFacilityFilter(req.user, facilityId as string);

    const [providersBySpecialization, providerPerformance, providerWorkload, providerRatings] = await Promise.all([
      // Providers by specialization
      prisma.provider.groupBy({
        by: ['specialization'],
        where: facilityFilter,
        _count: { id: true },
      }),
      
      // Provider performance (appointments completed)
      prisma.appointment.groupBy({
        by: ['providerId'],
        where: {
          provider: facilityFilter,
          status: AppointmentStatus.COMPLETED,
          scheduledAt: { gte: start, lte: end },
        },
        _count: { id: true },
        _avg: { duration: true },
      }),
      
      // Provider workload (total appointments)
      prisma.appointment.groupBy({
        by: ['providerId'],
        where: {
          provider: facilityFilter,
          scheduledAt: { gte: start, lte: end },
        },
        _count: { id: true },
      }),
      
      // Provider ratings (if available)
      prisma.appointment.groupBy({
        by: ['providerId'],
        where: {
          provider: facilityFilter,
          rating: { not: null },
          scheduledAt: { gte: start, lte: end },
        },
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ]);

    // Get provider details
    const allProviderIds = [
      ...providerPerformance.map(p => p.providerId),
      ...providerWorkload.map(p => p.providerId),
      ...providerRatings.map(p => p.providerId),
    ];
    const uniqueProviderIds = [...new Set(allProviderIds)];

    const providers = await prisma.provider.findMany({
      where: { id: { in: uniqueProviderIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        specialization: true,
        type: true,
      },
    });

    const providerMap = providers.reduce((acc, provider) => {
      acc[provider.id] = provider;
      return acc;
    }, {} as Record<string, any>);

    // Combine provider data
    const providerStats = uniqueProviderIds.map(providerId => {
      const performance = providerPerformance.find(p => p.providerId === providerId);
      const workload = providerWorkload.find(p => p.providerId === providerId);
      const ratings = providerRatings.find(p => p.providerId === providerId);
      const provider = providerMap[providerId];

      return {
        providerId,
        provider: provider ? {
          name: `${provider.firstName} ${provider.lastName}`,
          specialization: provider.specialization,
          type: provider.type,
        } : null,
        completedAppointments: performance?._count.id || 0,
        totalAppointments: workload?._count.id || 0,
        averageDuration: performance?._avg.duration || 0,
        averageRating: ratings?._avg.rating || 0,
        ratingCount: ratings?._count.rating || 0,
        completionRate: workload?._count.id ? formatPercentage(performance?._count.id || 0, workload._count.id) : '0.00',
      };
    });

    const analyticsData = {
      summary: {
        totalProviders: providers.length,
        activeProviders: providers.filter(p => p.type === 'ACTIVE').length,
        averageRating: providerRatings.reduce((sum, item) => sum + (item._avg.rating || 0), 0) / (providerRatings.length || 1),
      },
      bySpecialization: providersBySpecialization.reduce((acc, item) => {
        acc[item.specialization] = item._count.id;
        return acc;
      }, {} as Record<string, number>),
      performance: providerStats.sort((a, b) => b.completedAppointments - a.completedAppointments),
      topRated: providerStats
        .filter(p => p.ratingCount >= 5) // Only providers with at least 5 ratings
        .sort((a, b) => b.averageRating - a.averageRating)
        .slice(0, 10),
    };

    const response: AnalyticsResponse = {
      success: true,
      message: 'Provider analytics retrieved successfully',
      data: analyticsData,
      metadata: {
        generatedAt: new Date(),
        period: period as string,
        facilityId: req.user?.facilityId,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get provider analytics error', {
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
 * @route   GET /api/v1/analytics/revenue
 * @desc    Get revenue analytics
 * @access  Private (Admins only)
 */
router.get('/revenue', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), validateMetricsQuery, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { period = 'month', startDate, endDate, facilityId } = req.query;
    const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
    const facilityFilter = getFacilityFilter(req.user, facilityId as string);

    const [revenueByDay, revenueByProvider, revenueByType, totalRevenue] = await Promise.all([
      // Revenue by day
      prisma.$queryRaw`
        SELECT 
          DATE(scheduledAt) as date,
          SUM(fee) as revenue,
          COUNT(*) as appointments
        FROM Appointment 
        WHERE status = 'COMPLETED' 
          AND scheduledAt >= ${start} 
          AND scheduledAt <= ${end}
          AND fee IS NOT NULL
        ${facilityFilter.facilityId ? prisma.$queryRaw`AND facilityId = ${facilityFilter.facilityId}` : prisma.$queryRaw``}
        GROUP BY DATE(scheduledAt)
        ORDER BY date
      `,
      
      // Revenue by provider
      prisma.appointment.groupBy({
        by: ['providerId'],
        where: {
          provider: facilityFilter,
          status: AppointmentStatus.COMPLETED,
          scheduledAt: { gte: start, lte: end },
          fee: { not: null },
        },
        _sum: { fee: true },
        _count: { id: true },
        _avg: { fee: true },
      }),
      
      // Revenue by appointment type
      prisma.appointment.groupBy({
        by: ['type'],
        where: {
          provider: facilityFilter,
          status: AppointmentStatus.COMPLETED,
          scheduledAt: { gte: start, lte: end },
          fee: { not: null },
        },
        _sum: { fee: true },
        _count: { id: true },
      }),
      
      // Total revenue metrics
      prisma.appointment.aggregate({
        where: {
          provider: facilityFilter,
          status: AppointmentStatus.COMPLETED,
          scheduledAt: { gte: start, lte: end },
          fee: { not: null },
        },
        _sum: { fee: true },
        _avg: { fee: true },
        _count: { id: true },
      }),
    ]);

    // Get provider details for revenue by provider
    const providerIds = revenueByProvider.map(p => p.providerId);
    const providers = await prisma.provider.findMany({
      where: { id: { in: providerIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        specialization: true,
      },
    });

    const providerMap = providers.reduce((acc, provider) => {
      acc[provider.id] = provider;
      return acc;
    }, {} as Record<string, any>);

    const analyticsData = {
      summary: {
        totalRevenue: totalRevenue._sum.fee || 0,
        averagePerAppointment: totalRevenue._avg.fee || 0,
        totalAppointments: totalRevenue._count || 0,
        formattedTotal: formatCurrency(totalRevenue._sum.fee || 0),
        formattedAverage: formatCurrency(totalRevenue._avg.fee || 0),
      },
      timeSeries: revenueByDay.map((item: any) => ({
        date: item.date,
        revenue: Number(item.revenue),
        appointments: Number(item.appointments),
        formattedRevenue: formatCurrency(Number(item.revenue)),
      })),
      byProvider: revenueByProvider.map(item => ({
        providerId: item.providerId,
        provider: providerMap[item.providerId] ? {
          name: `${providerMap[item.providerId].firstName} ${providerMap[item.providerId].lastName}`,
          specialization: providerMap[item.providerId].specialization,
        } : null,
        revenue: item._sum.fee || 0,
        appointments: item._count.id,
        averagePerAppointment: item._avg.fee || 0,
        formattedRevenue: formatCurrency(item._sum.fee || 0),
      })).sort((a, b) => b.revenue - a.revenue),
      byType: revenueByType.map(item => ({
        type: item.type,
        revenue: item._sum.fee || 0,
        appointments: item._count.id,
        formattedRevenue: formatCurrency(item._sum.fee || 0),
      })).sort((a, b) => b.revenue - a.revenue),
    };

    const response: AnalyticsResponse = {
      success: true,
      message: 'Revenue analytics retrieved successfully',
      data: analyticsData,
      metadata: {
        generatedAt: new Date(),
        period: period as string,
        facilityId: req.user?.facilityId,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get revenue analytics error', {
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
 * @route   GET /api/v1/analytics/reports/custom
 * @desc    Generate custom analytics report
 * @access  Private (Admins only)
 */
router.get('/reports/custom', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), rateLimiters.analytics, async (req: AuthRequest, res: Response) => {
  try {
    const {
      metrics = ['appointments', 'patients'],
      period = 'month',
      startDate,
      endDate,
      facilityId,
      format = 'json',
    } = req.query;

    const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
    const facilityFilter = getFacilityFilter(req.user, facilityId as string);

    // Use analytics service to generate custom report
    const reportData = await analyticsService.generateCustomReport({
      metrics: Array.isArray(metrics) ? metrics : [metrics],
      dateRange: { start, end },
      facilityFilter,
      userId: req.user?.id,
    });

    // Log audit event
    await auditService.log({
      action: 'CUSTOM_REPORT_GENERATED',
      userId: req.user?.id,
      resourceType: 'Analytics',
      details: {
        metrics,
        period,
        facilityId: req.user?.facilityId,
        format,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    if (format === 'csv') {
      // Convert to CSV format
      const csv = await analyticsService.convertToCSV(reportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="analytics-report-${Date.now()}.csv"`);
      return res.send(csv);
    }

    const response: AnalyticsResponse = {
      success: true,
      message: 'Custom analytics report generated successfully',
      data: reportData,
      metadata: {
        generatedAt: new Date(),
        period: period as string,
        facilityId: req.user?.facilityId,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Generate custom report error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during report generation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

export default router;