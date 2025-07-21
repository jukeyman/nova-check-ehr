/**
 * ============================================================================
 * NOVA CHECK EHR - PROVIDER CONTROLLER
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { PrismaClient, UserRole, ProviderStatus, LicenseStatus } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../middleware/errorHandler';
import logger from '../config/logger';
import { CacheService } from '../config/redis';
import { asyncHandler } from '../middleware/errorHandler';
import { sendEmail } from '../services/emailService';
import { hashPassword } from '../middleware/auth';
import { generateRandomPassword } from '../utils/helpers';
import config from '../config/config';

const prisma = new PrismaClient();
const cacheService = new CacheService();

/**
 * Create a new provider
 */
export const createProvider = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    // User information
    email,
    firstName,
    lastName,
    phone,
    // Provider-specific information
    npi,
    specialties,
    licenses,
    education,
    experience,
    languages,
    address,
    bio,
    consultationFee,
    acceptsInsurance,
    insuranceNetworks,
    availableForTelemedicine,
    emergencyContact,
    // Schedule
    schedule,
  } = req.body;

  const createdBy = req.user!.id;

  // Check if user with email already exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    throw new ConflictError('User with this email already exists');
  }

  // Check if provider with NPI already exists
  if (npi) {
    const existingProvider = await prisma.provider.findUnique({
      where: { npi },
    });

    if (existingProvider) {
      throw new ConflictError('Provider with this NPI already exists');
    }
  }

  // Generate temporary password
  const tempPassword = generateRandomPassword();
  const hashedPassword = await hashPassword(tempPassword);

  // Create user and provider in transaction
  const result = await prisma.$transaction(async (tx) => {
    // Create user
    const user = await tx.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phone,
        role: UserRole.PROVIDER,
        isEmailVerified: false,
        mustChangePassword: true,
        createdBy,
      },
    });

    // Create provider
    const provider = await tx.provider.create({
      data: {
        userId: user.id,
        npi,
        bio,
        consultationFee,
        acceptsInsurance,
        insuranceNetworks,
        availableForTelemedicine,
        address,
        emergencyContact,
        status: ProviderStatus.PENDING,
        createdBy,
      },
    });

    // Update user with providerId
    await tx.user.update({
      where: { id: user.id },
      data: { providerId: provider.id },
    });

    // Create specialties
    if (specialties && specialties.length > 0) {
      await tx.providerSpecialty.createMany({
        data: specialties.map((specialty: string) => ({
          providerId: provider.id,
          specialty,
          isPrimary: false,
        })),
      });
    }

    // Create licenses
    if (licenses && licenses.length > 0) {
      await tx.providerLicense.createMany({
        data: licenses.map((license: any) => ({
          providerId: provider.id,
          licenseNumber: license.licenseNumber,
          state: license.state,
          licenseType: license.licenseType,
          issueDate: new Date(license.issueDate),
          expirationDate: new Date(license.expirationDate),
          status: LicenseStatus.ACTIVE,
        })),
      });
    }

    // Create education records
    if (education && education.length > 0) {
      await tx.providerEducation.createMany({
        data: education.map((edu: any) => ({
          providerId: provider.id,
          institution: edu.institution,
          degree: edu.degree,
          fieldOfStudy: edu.fieldOfStudy,
          graduationYear: edu.graduationYear,
          isVerified: false,
        })),
      });
    }

    // Create experience records
    if (experience && experience.length > 0) {
      await tx.providerExperience.createMany({
        data: experience.map((exp: any) => ({
          providerId: provider.id,
          organization: exp.organization,
          position: exp.position,
          startDate: new Date(exp.startDate),
          endDate: exp.endDate ? new Date(exp.endDate) : null,
          description: exp.description,
          isCurrent: exp.isCurrent || false,
        })),
      });
    }

    // Create languages
    if (languages && languages.length > 0) {
      await tx.providerLanguage.createMany({
        data: languages.map((lang: any) => ({
          providerId: provider.id,
          language: lang.language,
          proficiency: lang.proficiency,
        })),
      });
    }

    // Create schedule
    if (schedule && schedule.length > 0) {
      await tx.providerSchedule.createMany({
        data: schedule.map((sched: any) => ({
          providerId: provider.id,
          dayOfWeek: sched.dayOfWeek,
          startTime: sched.startTime,
          endTime: sched.endTime,
          isActive: sched.isActive !== false,
        })),
      });
    }

    return { user, provider };
  });

  // Send welcome email with temporary password
  try {
    await sendEmail({
      to: email,
      subject: 'Welcome to Nova Check EHR - Provider Account Created',
      template: 'provider-welcome',
      data: {
        firstName,
        lastName,
        email,
        tempPassword,
        loginUrl: `${config.app.frontendUrl}/login`,
        supportEmail: config.email.supportEmail,
      },
    });
  } catch (error) {
    logger.error('Failed to send welcome email to provider', {
      error,
      providerId: result.provider.id,
      email,
    });
  }

  // Log provider creation
  await prisma.auditLog.create({
    data: {
      userId: createdBy,
      action: 'PROVIDER_CREATE',
      resource: 'Provider',
      resourceId: result.provider.id,
      details: {
        email,
        firstName,
        lastName,
        npi,
        specialties,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Provider created successfully', {
    providerId: result.provider.id,
    userId: result.user.id,
    email,
    createdBy,
  });

  // Remove sensitive data from response
  const { password, ...userWithoutPassword } = result.user;

  res.status(201).json({
    success: true,
    message: 'Provider created successfully',
    data: {
      user: userWithoutPassword,
      provider: result.provider,
    },
  });
});

/**
 * Get providers with filtering and pagination
 */
export const getProviders = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    page = 1,
    limit = 20,
    specialty,
    status,
    search,
    availableForTelemedicine,
    acceptsInsurance,
    language,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);

  // Build where clause
  const where: any = {};

  if (status) {
    where.status = status;
  }

  if (availableForTelemedicine !== undefined) {
    where.availableForTelemedicine = availableForTelemedicine === 'true';
  }

  if (acceptsInsurance !== undefined) {
    where.acceptsInsurance = acceptsInsurance === 'true';
  }

  // Search filter
  if (search) {
    where.OR = [
      {
        user: {
          firstName: {
            contains: search,
            mode: 'insensitive',
          },
        },
      },
      {
        user: {
          lastName: {
            contains: search,
            mode: 'insensitive',
          },
        },
      },
      {
        npi: {
          contains: search,
        },
      },
      {
        specialties: {
          some: {
            specialty: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
      },
    ];
  }

  // Specialty filter
  if (specialty) {
    where.specialties = {
      some: {
        specialty: {
          equals: specialty,
          mode: 'insensitive',
        },
      },
    };
  }

  // Language filter
  if (language) {
    where.languages = {
      some: {
        language: {
          equals: language,
          mode: 'insensitive',
        },
      },
    };
  }

  // Build order by
  const orderBy: any = {};
  if (sortBy === 'name') {
    orderBy.user = { firstName: sortOrder };
  } else {
    orderBy[sortBy as string] = sortOrder;
  }

  const [providers, total] = await Promise.all([
    prisma.provider.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            isActive: true,
            lastLoginAt: true,
          },
        },
        specialties: true,
        licenses: {
          where: {
            status: LicenseStatus.ACTIVE,
          },
        },
        languages: true,
        schedule: {
          where: {
            isActive: true,
          },
        },
        _count: {
          select: {
            appointments: {
              where: {
                status: 'COMPLETED',
              },
            },
            patients: true,
          },
        },
      },
      orderBy,
      skip: offset,
      take: Number(limit),
    }),
    prisma.provider.count({ where }),
  ]);

  const totalPages = Math.ceil(total / Number(limit));

  res.json({
    success: true,
    data: {
      providers,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages,
        hasNext: Number(page) < totalPages,
        hasPrev: Number(page) > 1,
      },
    },
  });
});

/**
 * Get provider by ID
 */
export const getProviderById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  const provider = await prisma.provider.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      },
      specialties: true,
      licenses: {
        orderBy: { expirationDate: 'desc' },
      },
      education: {
        orderBy: { graduationYear: 'desc' },
      },
      experience: {
        orderBy: { startDate: 'desc' },
      },
      languages: true,
      schedule: {
        orderBy: { dayOfWeek: 'asc' },
      },
      patients: {
        select: {
          id: true,
          patientId: true,
          firstName: true,
          lastName: true,
        },
        take: 10,
      },
      _count: {
        select: {
          appointments: {
            where: {
              status: 'COMPLETED',
            },
          },
          patients: true,
        },
      },
    },
  });

  if (!provider) {
    throw new NotFoundError('Provider not found');
  }

  // Check access permissions for sensitive data
  const canViewSensitiveData = 
    user.role === UserRole.ADMIN ||
    user.role === UserRole.SUPER_ADMIN ||
    (user.role === UserRole.PROVIDER && user.providerId === id);

  let responseData = provider;

  if (!canViewSensitiveData) {
    // Remove sensitive information for non-authorized users
    const { user: providerUser, ...providerWithoutUser } = provider;
    const { email, phone, ...publicUserData } = providerUser;
    
    responseData = {
      ...providerWithoutUser,
      user: publicUserData,
    } as any;
  }

  // Log provider access
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'PROVIDER_VIEW',
      resource: 'Provider',
      resourceId: id,
      details: {
        viewerRole: user.role,
        canViewSensitiveData,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  res.json({
    success: true,
    data: { provider: responseData },
  });
});

/**
 * Update provider
 */
export const updateProvider = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const {
    bio,
    consultationFee,
    acceptsInsurance,
    insuranceNetworks,
    availableForTelemedicine,
    address,
    emergencyContact,
    status,
  } = req.body;

  const user = req.user!;
  const updatedBy = user.id;

  // Check if provider exists
  const existingProvider = await prisma.provider.findUnique({
    where: { id },
    include: {
      user: true,
    },
  });

  if (!existingProvider) {
    throw new NotFoundError('Provider not found');
  }

  // Check permissions
  const canUpdate = 
    user.role === UserRole.ADMIN ||
    user.role === UserRole.SUPER_ADMIN ||
    (user.role === UserRole.PROVIDER && user.providerId === id);

  if (!canUpdate) {
    throw new ForbiddenError('Access denied');
  }

  // Only admins can change status
  if (status && user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
    throw new ForbiddenError('Only administrators can change provider status');
  }

  // Update provider
  const provider = await prisma.provider.update({
    where: { id },
    data: {
      bio,
      consultationFee,
      acceptsInsurance,
      insuranceNetworks,
      availableForTelemedicine,
      address,
      emergencyContact,
      status,
      updatedBy,
      updatedAt: new Date(),
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          isActive: true,
        },
      },
      specialties: true,
      licenses: true,
      languages: true,
    },
  });

  // Send notification if status changed
  if (status && status !== existingProvider.status) {
    try {
      await sendEmail({
        to: existingProvider.user.email,
        subject: `Provider Status Updated - Nova Check EHR`,
        template: 'provider-status-update',
        data: {
          firstName: existingProvider.user.firstName,
          lastName: existingProvider.user.lastName,
          oldStatus: existingProvider.status,
          newStatus: status,
          loginUrl: `${config.app.frontendUrl}/login`,
        },
      });
    } catch (error) {
      logger.error('Failed to send status update email', {
        error,
        providerId: id,
        email: existingProvider.user.email,
      });
    }
  }

  // Log provider update
  await prisma.auditLog.create({
    data: {
      userId: updatedBy,
      action: 'PROVIDER_UPDATE',
      resource: 'Provider',
      resourceId: id,
      details: {
        updatedFields: Object.keys(req.body),
        oldStatus: existingProvider.status,
        newStatus: status,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Provider updated successfully', {
    providerId: id,
    updatedBy,
    updatedFields: Object.keys(req.body),
  });

  res.json({
    success: true,
    message: 'Provider updated successfully',
    data: { provider },
  });
});

/**
 * Delete provider (soft delete)
 */
export const deleteProvider = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  // Check permissions
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
    throw new ForbiddenError('Only administrators can delete providers');
  }

  const provider = await prisma.provider.findUnique({
    where: { id },
    include: {
      user: true,
      appointments: {
        where: {
          status: {
            in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
          },
        },
      },
    },
  });

  if (!provider) {
    throw new NotFoundError('Provider not found');
  }

  // Check for active appointments
  if (provider.appointments.length > 0) {
    throw new ValidationError('Cannot delete provider with active appointments');
  }

  // Soft delete provider and user
  await prisma.$transaction(async (tx) => {
    await tx.provider.update({
      where: { id },
      data: {
        status: ProviderStatus.INACTIVE,
        deletedAt: new Date(),
        deletedBy: user.id,
      },
    });

    await tx.user.update({
      where: { id: provider.userId },
      data: {
        isActive: false,
        deletedAt: new Date(),
        deletedBy: user.id,
      },
    });
  });

  // Log provider deletion
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'PROVIDER_DELETE',
      resource: 'Provider',
      resourceId: id,
      details: {
        providerEmail: provider.user.email,
        providerName: `${provider.user.firstName} ${provider.user.lastName}`,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Provider deleted successfully', {
    providerId: id,
    deletedBy: user.id,
  });

  res.json({
    success: true,
    message: 'Provider deleted successfully',
  });
});

/**
 * Get provider schedule
 */
export const getProviderSchedule = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const schedule = await prisma.providerSchedule.findMany({
    where: {
      providerId: id,
      isActive: true,
    },
    orderBy: {
      dayOfWeek: 'asc',
    },
  });

  res.json({
    success: true,
    data: { schedule },
  });
});

/**
 * Update provider schedule
 */
export const updateProviderSchedule = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { schedule } = req.body;
  const user = req.user!;

  // Check permissions
  const canUpdate = 
    user.role === UserRole.ADMIN ||
    user.role === UserRole.SUPER_ADMIN ||
    (user.role === UserRole.PROVIDER && user.providerId === id);

  if (!canUpdate) {
    throw new ForbiddenError('Access denied');
  }

  // Check if provider exists
  const provider = await prisma.provider.findUnique({
    where: { id },
  });

  if (!provider) {
    throw new NotFoundError('Provider not found');
  }

  // Update schedule in transaction
  await prisma.$transaction(async (tx) => {
    // Delete existing schedule
    await tx.providerSchedule.deleteMany({
      where: { providerId: id },
    });

    // Create new schedule
    if (schedule && schedule.length > 0) {
      await tx.providerSchedule.createMany({
        data: schedule.map((sched: any) => ({
          providerId: id,
          dayOfWeek: sched.dayOfWeek,
          startTime: sched.startTime,
          endTime: sched.endTime,
          isActive: sched.isActive !== false,
        })),
      });
    }
  });

  // Get updated schedule
  const updatedSchedule = await prisma.providerSchedule.findMany({
    where: {
      providerId: id,
      isActive: true,
    },
    orderBy: {
      dayOfWeek: 'asc',
    },
  });

  // Log schedule update
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'PROVIDER_SCHEDULE_UPDATE',
      resource: 'ProviderSchedule',
      resourceId: id,
      details: {
        scheduleCount: schedule?.length || 0,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Provider schedule updated successfully', {
    providerId: id,
    updatedBy: user.id,
    scheduleCount: schedule?.length || 0,
  });

  res.json({
    success: true,
    message: 'Provider schedule updated successfully',
    data: { schedule: updatedSchedule },
  });
});

/**
 * Add provider specialty
 */
export const addProviderSpecialty = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { specialty, isPrimary = false } = req.body;
  const user = req.user!;

  // Check permissions
  const canUpdate = 
    user.role === UserRole.ADMIN ||
    user.role === UserRole.SUPER_ADMIN ||
    (user.role === UserRole.PROVIDER && user.providerId === id);

  if (!canUpdate) {
    throw new ForbiddenError('Access denied');
  }

  // Check if provider exists
  const provider = await prisma.provider.findUnique({
    where: { id },
  });

  if (!provider) {
    throw new NotFoundError('Provider not found');
  }

  // Check if specialty already exists
  const existingSpecialty = await prisma.providerSpecialty.findFirst({
    where: {
      providerId: id,
      specialty,
    },
  });

  if (existingSpecialty) {
    throw new ConflictError('Provider already has this specialty');
  }

  // If this is primary, unset other primary specialties
  if (isPrimary) {
    await prisma.providerSpecialty.updateMany({
      where: {
        providerId: id,
        isPrimary: true,
      },
      data: {
        isPrimary: false,
      },
    });
  }

  // Add specialty
  const providerSpecialty = await prisma.providerSpecialty.create({
    data: {
      providerId: id,
      specialty,
      isPrimary,
    },
  });

  // Log specialty addition
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'PROVIDER_SPECIALTY_ADD',
      resource: 'ProviderSpecialty',
      resourceId: providerSpecialty.id,
      details: {
        providerId: id,
        specialty,
        isPrimary,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Provider specialty added successfully', {
    providerId: id,
    specialty,
    isPrimary,
    addedBy: user.id,
  });

  res.status(201).json({
    success: true,
    message: 'Provider specialty added successfully',
    data: { specialty: providerSpecialty },
  });
});

/**
 * Remove provider specialty
 */
export const removeProviderSpecialty = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id, specialtyId } = req.params;
  const user = req.user!;

  // Check permissions
  const canUpdate = 
    user.role === UserRole.ADMIN ||
    user.role === UserRole.SUPER_ADMIN ||
    (user.role === UserRole.PROVIDER && user.providerId === id);

  if (!canUpdate) {
    throw new ForbiddenError('Access denied');
  }

  // Check if specialty exists
  const specialty = await prisma.providerSpecialty.findFirst({
    where: {
      id: specialtyId,
      providerId: id,
    },
  });

  if (!specialty) {
    throw new NotFoundError('Provider specialty not found');
  }

  // Delete specialty
  await prisma.providerSpecialty.delete({
    where: { id: specialtyId },
  });

  // Log specialty removal
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'PROVIDER_SPECIALTY_REMOVE',
      resource: 'ProviderSpecialty',
      resourceId: specialtyId,
      details: {
        providerId: id,
        specialty: specialty.specialty,
        wasPrimary: specialty.isPrimary,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Provider specialty removed successfully', {
    providerId: id,
    specialtyId,
    removedBy: user.id,
  });

  res.json({
    success: true,
    message: 'Provider specialty removed successfully',
  });
});

/**
 * Get provider statistics
 */
export const getProviderStats = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { startDate, endDate } = req.query;
  const user = req.user!;

  // Check permissions
  const canView = 
    user.role === UserRole.ADMIN ||
    user.role === UserRole.SUPER_ADMIN ||
    (user.role === UserRole.PROVIDER && user.providerId === id);

  if (!canView) {
    throw new ForbiddenError('Access denied');
  }

  // Build date filter
  const dateFilter: any = {};
  if (startDate || endDate) {
    dateFilter.scheduledAt = {};
    if (startDate) {
      dateFilter.scheduledAt.gte = new Date(startDate as string);
    }
    if (endDate) {
      dateFilter.scheduledAt.lte = new Date(endDate as string);
    }
  }

  const [totalAppointments, completedAppointments, cancelledAppointments, totalPatients, appointmentsByType] = await Promise.all([
    prisma.appointment.count({
      where: {
        providerId: id,
        ...dateFilter,
      },
    }),
    prisma.appointment.count({
      where: {
        providerId: id,
        status: 'COMPLETED',
        ...dateFilter,
      },
    }),
    prisma.appointment.count({
      where: {
        providerId: id,
        status: 'CANCELLED',
        ...dateFilter,
      },
    }),
    prisma.patient.count({
      where: {
        careTeam: {
          some: {
            providerId: id,
          },
        },
      },
    }),
    prisma.appointment.groupBy({
      by: ['type'],
      where: {
        providerId: id,
        ...dateFilter,
      },
      _count: true,
    }),
  ]);

  const stats = {
    totalAppointments,
    completedAppointments,
    cancelledAppointments,
    totalPatients,
    completionRate: totalAppointments > 0 ? (completedAppointments / totalAppointments) * 100 : 0,
    cancellationRate: totalAppointments > 0 ? (cancelledAppointments / totalAppointments) * 100 : 0,
    appointmentsByType: appointmentsByType.map(group => ({
      type: group.type,
      count: group._count,
    })),
  };

  res.json({
    success: true,
    data: { stats },
  });
});

/**
 * Search providers
 */
export const searchProviders = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    query,
    specialty,
    location,
    availableForTelemedicine,
    acceptsInsurance,
    language,
    limit = 10,
  } = req.query;

  if (!query) {
    throw new ValidationError('Search query is required');
  }

  // Build search conditions
  const where: any = {
    status: ProviderStatus.ACTIVE,
    user: {
      isActive: true,
    },
  };

  // Text search
  where.OR = [
    {
      user: {
        firstName: {
          contains: query,
          mode: 'insensitive',
        },
      },
    },
    {
      user: {
        lastName: {
          contains: query,
          mode: 'insensitive',
        },
      },
    },
    {
      specialties: {
        some: {
          specialty: {
            contains: query,
            mode: 'insensitive',
          },
        },
      },
    },
    {
      bio: {
        contains: query,
        mode: 'insensitive',
      },
    },
  ];

  // Additional filters
  if (specialty) {
    where.specialties = {
      some: {
        specialty: {
          equals: specialty,
          mode: 'insensitive',
        },
      },
    };
  }

  if (availableForTelemedicine !== undefined) {
    where.availableForTelemedicine = availableForTelemedicine === 'true';
  }

  if (acceptsInsurance !== undefined) {
    where.acceptsInsurance = acceptsInsurance === 'true';
  }

  if (language) {
    where.languages = {
      some: {
        language: {
          equals: language,
          mode: 'insensitive',
        },
      },
    };
  }

  if (location) {
    where.address = {
      contains: location,
      mode: 'insensitive',
    };
  }

  const providers = await prisma.provider.findMany({
    where,
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      specialties: {
        where: {
          isPrimary: true,
        },
      },
      languages: true,
      _count: {
        select: {
          appointments: {
            where: {
              status: 'COMPLETED',
            },
          },
        },
      },
    },
    take: Number(limit),
    orderBy: {
      createdAt: 'desc',
    },
  });

  res.json({
    success: true,
    data: { providers },
  });
});