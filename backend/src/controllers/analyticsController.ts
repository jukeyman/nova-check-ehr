/**
 * ============================================================================
 * NOVA CHECK EHR - ANALYTICS CONTROLLER
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { PrismaClient, UserRole, AppointmentStatus, EncounterStatus } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError, ForbiddenError } from '../middleware/errorHandler';
import logger from '../config/logger';
import { CacheService } from '../config/redis';
import { asyncHandler } from '../middleware/errorHandler';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, subWeeks, subMonths, subYears, format, parseISO } from 'date-fns';
import config from '../config/config';

const prisma = new PrismaClient();
const cacheService = new CacheService();

/**
 * Get dashboard overview
 */
export const getDashboardOverview = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { period = '30d' } = req.query;

  // Calculate date range based on period
  const now = new Date();
  let startDate: Date;
  let endDate = now;

  switch (period) {
    case '7d':
      startDate = subDays(now, 7);
      break;
    case '30d':
      startDate = subDays(now, 30);
      break;
    case '90d':
      startDate = subDays(now, 90);
      break;
    case '1y':
      startDate = subYears(now, 1);
      break;
    default:
      startDate = subDays(now, 30);
  }

  const cacheKey = `dashboard_overview_${user.id}_${period}`;
  const cached = await cacheService.get(cacheKey);
  if (cached) {
    return res.json({
      success: true,
      data: cached,
    });
  }

  let overview: any = {};

  if (user.role === UserRole.ADMIN) {
    overview = await getAdminDashboard(startDate, endDate);
  } else if (user.role === UserRole.PROVIDER) {
    overview = await getProviderDashboard(user.providerId!, startDate, endDate);
  } else if (user.role === UserRole.PATIENT) {
    overview = await getPatientDashboard(user.patientId!, startDate, endDate);
  } else {
    overview = await getStaffDashboard(startDate, endDate);
  }

  // Cache for 5 minutes
  await cacheService.set(cacheKey, overview, 300);

  res.json({
    success: true,
    data: overview,
  });
});

/**
 * Admin dashboard data
 */
async function getAdminDashboard(startDate: Date, endDate: Date) {
  const [totalPatients, totalProviders, totalAppointments, totalEncounters, recentAppointments, appointmentsByStatus, revenueData, patientGrowth, providerUtilization] = await Promise.all([
    // Total patients
    prisma.patient.count({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    }),
    // Total providers
    prisma.provider.count({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    }),
    // Total appointments
    prisma.appointment.count({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    }),
    // Total encounters
    prisma.encounter.count({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    }),
    // Recent appointments
    prisma.appointment.findMany({
      where: {
        scheduledAt: {
          gte: new Date(),
        },
      },
      include: {
        patient: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        provider: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: {
        scheduledAt: 'asc',
      },
      take: 10,
    }),
    // Appointments by status
    prisma.appointment.groupBy({
      by: ['status'],
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      _count: true,
    }),
    // Revenue data (placeholder - would integrate with billing system)
    getRevenueData(startDate, endDate),
    // Patient growth over time
    getPatientGrowthData(startDate, endDate),
    // Provider utilization
    getProviderUtilizationData(startDate, endDate),
  ]);

  return {
    metrics: {
      totalPatients,
      totalProviders,
      totalAppointments,
      totalEncounters,
    },
    recentAppointments,
    appointmentsByStatus: appointmentsByStatus.map(group => ({
      status: group.status,
      count: group._count,
    })),
    revenueData,
    patientGrowth,
    providerUtilization,
  };
}

/**
 * Provider dashboard data
 */
async function getProviderDashboard(providerId: string, startDate: Date, endDate: Date) {
  const [todayAppointments, upcomingAppointments, totalPatients, completedEncounters, appointmentsByStatus, patientsByAge, recentEncounters] = await Promise.all([
    // Today's appointments
    prisma.appointment.findMany({
      where: {
        providerId,
        scheduledAt: {
          gte: startOfDay(new Date()),
          lte: endOfDay(new Date()),
        },
      },
      include: {
        patient: {
          select: {
            firstName: true,
            lastName: true,
            dateOfBirth: true,
          },
        },
      },
      orderBy: {
        scheduledAt: 'asc',
      },
    }),
    // Upcoming appointments
    prisma.appointment.findMany({
      where: {
        providerId,
        scheduledAt: {
          gt: endOfDay(new Date()),
        },
        status: {
          in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
        },
      },
      include: {
        patient: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        scheduledAt: 'asc',
      },
      take: 10,
    }),
    // Total patients under care
    prisma.patient.count({
      where: {
        careTeamMembers: {
          some: {
            providerId,
          },
        },
      },
    }),
    // Completed encounters
    prisma.encounter.count({
      where: {
        providerId,
        status: EncounterStatus.COMPLETED,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    }),
    // Appointments by status
    prisma.appointment.groupBy({
      by: ['status'],
      where: {
        providerId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      _count: true,
    }),
    // Patients by age group
    getPatientsByAgeGroup(providerId),
    // Recent encounters
    prisma.encounter.findMany({
      where: {
        providerId,
      },
      include: {
        patient: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 5,
    }),
  ]);

  return {
    metrics: {
      todayAppointments: todayAppointments.length,
      upcomingAppointments: upcomingAppointments.length,
      totalPatients,
      completedEncounters,
    },
    todayAppointments,
    upcomingAppointments,
    appointmentsByStatus: appointmentsByStatus.map(group => ({
      status: group.status,
      count: group._count,
    })),
    patientsByAge,
    recentEncounters,
  };
}

/**
 * Patient dashboard data
 */
async function getPatientDashboard(patientId: string, startDate: Date, endDate: Date) {
  const [upcomingAppointments, recentEncounters, totalAppointments, completedEncounters, careTeam, recentVitals, medications] = await Promise.all([
    // Upcoming appointments
    prisma.appointment.findMany({
      where: {
        patientId,
        scheduledAt: {
          gte: new Date(),
        },
        status: {
          in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
        },
      },
      include: {
        provider: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: {
        scheduledAt: 'asc',
      },
      take: 5,
    }),
    // Recent encounters
    prisma.encounter.findMany({
      where: {
        patientId,
      },
      include: {
        provider: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 5,
    }),
    // Total appointments
    prisma.appointment.count({
      where: {
        patientId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    }),
    // Completed encounters
    prisma.encounter.count({
      where: {
        patientId,
        status: EncounterStatus.COMPLETED,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    }),
    // Care team
    prisma.careTeamMember.findMany({
      where: {
        patientId,
      },
      include: {
        provider: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
            specialties: true,
          },
        },
      },
    }),
    // Recent vitals
    prisma.vitalSigns.findMany({
      where: {
        encounter: {
          patientId,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 5,
    }),
    // Current medications
    prisma.patientMedication.findMany({
      where: {
        patientId,
        isActive: true,
      },
      include: {
        medication: true,
      },
    }),
  ]);

  return {
    metrics: {
      upcomingAppointments: upcomingAppointments.length,
      totalAppointments,
      completedEncounters,
      careTeamSize: careTeam.length,
    },
    upcomingAppointments,
    recentEncounters,
    careTeam,
    recentVitals,
    medications,
  };
}

/**
 * Staff dashboard data
 */
async function getStaffDashboard(startDate: Date, endDate: Date) {
  const [todayAppointments, totalPatients, totalProviders, pendingTasks] = await Promise.all([
    // Today's appointments
    prisma.appointment.count({
      where: {
        scheduledAt: {
          gte: startOfDay(new Date()),
          lte: endOfDay(new Date()),
        },
      },
    }),
    // Total patients
    prisma.patient.count(),
    // Total providers
    prisma.provider.count(),
    // Pending tasks (placeholder)
    0,
  ]);

  return {
    metrics: {
      todayAppointments,
      totalPatients,
      totalProviders,
      pendingTasks,
    },
  };
}

/**
 * Get appointment analytics
 */
export const getAppointmentAnalytics = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { startDate, endDate, providerId, groupBy = 'day' } = req.query;
  const user = req.user!;

  // Validate date range
  if (!startDate || !endDate) {
    throw new ValidationError('Start date and end date are required');
  }

  const start = parseISO(startDate as string);
  const end = parseISO(endDate as string);

  // Build where clause
  const where: any = {
    scheduledAt: {
      gte: start,
      lte: end,
    },
  };

  // Apply role-based filtering
  if (user.role === UserRole.PROVIDER) {
    where.providerId = user.providerId;
  } else if (user.role === UserRole.PATIENT) {
    where.patientId = user.patientId;
  } else if (providerId && user.role === UserRole.ADMIN) {
    where.providerId = providerId;
  }

  const [appointmentsByStatus, appointmentsByType, appointmentTrends, noShowRate, cancellationRate] = await Promise.all([
    // Appointments by status
    prisma.appointment.groupBy({
      by: ['status'],
      where,
      _count: true,
    }),
    // Appointments by type
    prisma.appointment.groupBy({
      by: ['type'],
      where,
      _count: true,
    }),
    // Appointment trends over time
    getAppointmentTrends(where, groupBy as string),
    // No-show rate
    getNoShowRate(where),
    // Cancellation rate
    getCancellationRate(where),
  ]);

  res.json({
    success: true,
    data: {
      appointmentsByStatus: appointmentsByStatus.map(group => ({
        status: group.status,
        count: group._count,
      })),
      appointmentsByType: appointmentsByType.map(group => ({
        type: group.type,
        count: group._count,
      })),
      appointmentTrends,
      metrics: {
        noShowRate,
        cancellationRate,
      },
    },
  });
});

/**
 * Get patient analytics
 */
export const getPatientAnalytics = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { startDate, endDate } = req.query;
  const user = req.user!;

  // Only admin and providers can access patient analytics
  if (user.role === UserRole.PATIENT) {
    throw new ForbiddenError('Access denied');
  }

  const start = startDate ? parseISO(startDate as string) : subMonths(new Date(), 12);
  const end = endDate ? parseISO(endDate as string) : new Date();

  const [patientGrowth, patientsByAge, patientsByGender, topDiagnoses, patientRetention] = await Promise.all([
    // Patient growth over time
    getPatientGrowthData(start, end),
    // Patients by age group
    getPatientsByAgeGroup(),
    // Patients by gender
    prisma.patient.groupBy({
      by: ['gender'],
      _count: true,
    }),
    // Top diagnoses
    getTopDiagnoses(start, end),
    // Patient retention rate
    getPatientRetentionRate(start, end),
  ]);

  res.json({
    success: true,
    data: {
      patientGrowth,
      patientsByAge,
      patientsByGender: patientsByGender.map(group => ({
        gender: group.gender,
        count: group._count,
      })),
      topDiagnoses,
      metrics: {
        patientRetention,
      },
    },
  });
});

/**
 * Get provider analytics
 */
export const getProviderAnalytics = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { startDate, endDate } = req.query;
  const user = req.user!;

  // Only admin can access provider analytics
  if (user.role !== UserRole.ADMIN) {
    throw new ForbiddenError('Access denied');
  }

  const start = startDate ? parseISO(startDate as string) : subMonths(new Date(), 12);
  const end = endDate ? parseISO(endDate as string) : new Date();

  const [providerUtilization, providerPerformance, providerWorkload, specialtyDistribution] = await Promise.all([
    // Provider utilization rates
    getProviderUtilizationData(start, end),
    // Provider performance metrics
    getProviderPerformanceData(start, end),
    // Provider workload distribution
    getProviderWorkloadData(start, end),
    // Specialty distribution
    prisma.providerSpecialty.groupBy({
      by: ['specialtyId'],
      _count: true,
      include: {
        specialty: {
          select: {
            name: true,
          },
        },
      },
    }),
  ]);

  res.json({
    success: true,
    data: {
      providerUtilization,
      providerPerformance,
      providerWorkload,
      specialtyDistribution,
    },
  });
});

/**
 * Get financial analytics
 */
export const getFinancialAnalytics = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { startDate, endDate } = req.query;
  const user = req.user!;

  // Only admin can access financial analytics
  if (user.role !== UserRole.ADMIN) {
    throw new ForbiddenError('Access denied');
  }

  const start = startDate ? parseISO(startDate as string) : subMonths(new Date(), 12);
  const end = endDate ? parseISO(endDate as string) : new Date();

  const [revenueData, revenueByProvider, revenueByService, collectionRate, outstandingBalance] = await Promise.all([
    // Revenue trends
    getRevenueData(start, end),
    // Revenue by provider
    getRevenueByProvider(start, end),
    // Revenue by service type
    getRevenueByService(start, end),
    // Collection rate
    getCollectionRate(start, end),
    // Outstanding balance
    getOutstandingBalance(),
  ]);

  res.json({
    success: true,
    data: {
      revenueData,
      revenueByProvider,
      revenueByService,
      metrics: {
        collectionRate,
        outstandingBalance,
      },
    },
  });
});

/**
 * Generate custom report
 */
export const generateCustomReport = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    reportType,
    startDate,
    endDate,
    filters = {},
    groupBy = 'day',
    metrics = [],
  } = req.body;

  const user = req.user!;

  // Only admin and providers can generate custom reports
  if (user.role === UserRole.PATIENT) {
    throw new ForbiddenError('Access denied');
  }

  if (!reportType || !startDate || !endDate) {
    throw new ValidationError('Report type, start date, and end date are required');
  }

  const start = parseISO(startDate);
  const end = parseISO(endDate);

  let reportData: any = {};

  switch (reportType) {
    case 'appointments':
      reportData = await generateAppointmentReport(start, end, filters, groupBy, metrics, user);
      break;
    case 'patients':
      reportData = await generatePatientReport(start, end, filters, groupBy, metrics, user);
      break;
    case 'providers':
      reportData = await generateProviderReport(start, end, filters, groupBy, metrics, user);
      break;
    case 'financial':
      reportData = await generateFinancialReport(start, end, filters, groupBy, metrics, user);
      break;
    default:
      throw new ValidationError('Invalid report type');
  }

  // Log report generation
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'REPORT_GENERATE',
      resource: 'Report',
      resourceId: `${reportType}_${Date.now()}`,
      details: {
        reportType,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        filters,
        groupBy,
        metrics,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Custom report generated', {
    reportType,
    userId: user.id,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  });

  res.json({
    success: true,
    data: {
      reportType,
      period: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
      ...reportData,
    },
  });
});

// Helper functions

async function getRevenueData(startDate: Date, endDate: Date) {
  // Placeholder - would integrate with billing system
  return {
    totalRevenue: 125000,
    trends: [
      { date: '2024-01-01', revenue: 10000 },
      { date: '2024-01-02', revenue: 12000 },
      // ... more data points
    ],
  };
}

async function getPatientGrowthData(startDate: Date, endDate: Date) {
  const patients = await prisma.patient.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      createdAt: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  // Group by month
  const growthData = patients.reduce((acc, patient) => {
    const month = format(patient.createdAt, 'yyyy-MM');
    acc[month] = (acc[month] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return Object.entries(growthData).map(([month, count]) => ({
    period: month,
    count,
  }));
}

async function getProviderUtilizationData(startDate: Date, endDate: Date) {
  const providers = await prisma.provider.findMany({
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      appointments: {
        where: {
          scheduledAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      },
      schedules: true,
    },
  });

  return providers.map(provider => {
    const totalSlots = provider.schedules.length * 8; // Assuming 8 slots per schedule
    const bookedSlots = provider.appointments.length;
    const utilization = totalSlots > 0 ? (bookedSlots / totalSlots) * 100 : 0;

    return {
      providerId: provider.id,
      name: `${provider.user.firstName} ${provider.user.lastName}`,
      utilization: Math.round(utilization * 100) / 100,
      totalSlots,
      bookedSlots,
    };
  });
}

async function getPatientsByAgeGroup(providerId?: string) {
  const where: any = {};
  if (providerId) {
    where.careTeamMembers = {
      some: {
        providerId,
      },
    };
  }

  const patients = await prisma.patient.findMany({
    where,
    select: {
      dateOfBirth: true,
    },
  });

  const ageGroups = {
    '0-17': 0,
    '18-34': 0,
    '35-54': 0,
    '55-74': 0,
    '75+': 0,
  };

  const now = new Date();
  patients.forEach(patient => {
    const age = now.getFullYear() - patient.dateOfBirth.getFullYear();
    if (age < 18) ageGroups['0-17']++;
    else if (age < 35) ageGroups['18-34']++;
    else if (age < 55) ageGroups['35-54']++;
    else if (age < 75) ageGroups['55-74']++;
    else ageGroups['75+']++;
  });

  return Object.entries(ageGroups).map(([ageGroup, count]) => ({
    ageGroup,
    count,
  }));
}

async function getAppointmentTrends(where: any, groupBy: string) {
  const appointments = await prisma.appointment.findMany({
    where,
    select: {
      scheduledAt: true,
      status: true,
    },
    orderBy: {
      scheduledAt: 'asc',
    },
  });

  // Group appointments by the specified period
  const trends = appointments.reduce((acc, appointment) => {
    let period: string;
    switch (groupBy) {
      case 'day':
        period = format(appointment.scheduledAt, 'yyyy-MM-dd');
        break;
      case 'week':
        period = format(startOfWeek(appointment.scheduledAt), 'yyyy-MM-dd');
        break;
      case 'month':
        period = format(appointment.scheduledAt, 'yyyy-MM');
        break;
      default:
        period = format(appointment.scheduledAt, 'yyyy-MM-dd');
    }

    if (!acc[period]) {
      acc[period] = { period, total: 0, completed: 0, cancelled: 0, noShow: 0 };
    }

    acc[period].total++;
    if (appointment.status === AppointmentStatus.COMPLETED) {
      acc[period].completed++;
    } else if (appointment.status === AppointmentStatus.CANCELLED) {
      acc[period].cancelled++;
    } else if (appointment.status === AppointmentStatus.NO_SHOW) {
      acc[period].noShow++;
    }

    return acc;
  }, {} as Record<string, any>);

  return Object.values(trends);
}

async function getNoShowRate(where: any) {
  const [totalAppointments, noShowAppointments] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.count({
      where: {
        ...where,
        status: AppointmentStatus.NO_SHOW,
      },
    }),
  ]);

  return totalAppointments > 0 ? (noShowAppointments / totalAppointments) * 100 : 0;
}

async function getCancellationRate(where: any) {
  const [totalAppointments, cancelledAppointments] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.count({
      where: {
        ...where,
        status: AppointmentStatus.CANCELLED,
      },
    }),
  ]);

  return totalAppointments > 0 ? (cancelledAppointments / totalAppointments) * 100 : 0;
}

async function getTopDiagnoses(startDate: Date, endDate: Date) {
  const diagnoses = await prisma.encounterDiagnosis.groupBy({
    by: ['icd10Code'],
    where: {
      encounter: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    },
    _count: true,
    orderBy: {
      _count: {
        icd10Code: 'desc',
      },
    },
    take: 10,
  });

  return diagnoses.map(diagnosis => ({
    icd10Code: diagnosis.icd10Code,
    count: diagnosis._count,
  }));
}

async function getPatientRetentionRate(startDate: Date, endDate: Date) {
  // Placeholder - would calculate based on repeat visits
  return 85.5;
}

async function getProviderPerformanceData(startDate: Date, endDate: Date) {
  // Placeholder - would calculate various performance metrics
  return [];
}

async function getProviderWorkloadData(startDate: Date, endDate: Date) {
  // Placeholder - would calculate workload distribution
  return [];
}

async function getRevenueByProvider(startDate: Date, endDate: Date) {
  // Placeholder - would integrate with billing system
  return [];
}

async function getRevenueByService(startDate: Date, endDate: Date) {
  // Placeholder - would integrate with billing system
  return [];
}

async function getCollectionRate(startDate: Date, endDate: Date) {
  // Placeholder - would calculate from billing data
  return 92.3;
}

async function getOutstandingBalance() {
  // Placeholder - would calculate from billing data
  return 45000;
}

async function generateAppointmentReport(startDate: Date, endDate: Date, filters: any, groupBy: string, metrics: string[], user: any) {
  // Implementation for appointment report
  return {
    summary: 'Appointment report data',
    data: [],
  };
}

async function generatePatientReport(startDate: Date, endDate: Date, filters: any, groupBy: string, metrics: string[], user: any) {
  // Implementation for patient report
  return {
    summary: 'Patient report data',
    data: [],
  };
}

async function generateProviderReport(startDate: Date, endDate: Date, filters: any, groupBy: string, metrics: string[], user: any) {
  // Implementation for provider report
  return {
    summary: 'Provider report data',
    data: [],
  };
}

async function generateFinancialReport(startDate: Date, endDate: Date, filters: any, groupBy: string, metrics: string[], user: any) {
  // Implementation for financial report
  return {
    summary: 'Financial report data',
    data: [],
  };
}