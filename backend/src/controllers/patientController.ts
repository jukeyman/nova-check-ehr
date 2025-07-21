/**
 * ============================================================================
 * NOVA CHECK EHR - PATIENT CONTROLLER
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { PrismaClient, PatientStatus, Gender, BloodType } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError, ForbiddenError } from '../middleware/errorHandler';
import logger from '../config/logger';
import { CacheService } from '../config/redis';
import { asyncHandler } from '../middleware/errorHandler';
import { generatePatientId } from '../utils/generators';
import { calculateAge, formatPhoneNumber } from '../utils/helpers';
import { sendEmail } from '../services/emailService';
import config from '../config/config';

const prisma = new PrismaClient();
const cacheService = new CacheService();

/**
 * Create a new patient
 */
export const createPatient = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    firstName,
    lastName,
    dateOfBirth,
    gender,
    email,
    phone,
    address,
    emergencyContact,
    insurance,
    medicalHistory,
    allergies,
    medications,
    socialHistory,
    familyHistory,
  } = req.body;

  const createdBy = req.user!.id;

  // Generate unique patient ID
  const patientId = await generatePatientId();

  // Check if patient with same email already exists
  if (email) {
    const existingPatient = await prisma.patient.findUnique({
      where: { email },
    });

    if (existingPatient) {
      throw new ValidationError('Patient with this email already exists');
    }
  }

  // Create patient in transaction
  const patient = await prisma.$transaction(async (tx) => {
    // Create patient record
    const newPatient = await tx.patient.create({
      data: {
        patientId,
        firstName,
        lastName,
        dateOfBirth: new Date(dateOfBirth),
        gender,
        email,
        phone: phone ? formatPhoneNumber(phone) : null,
        address,
        emergencyContact,
        insurance,
        medicalHistory,
        socialHistory,
        familyHistory,
        status: PatientStatus.ACTIVE,
        createdBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Create allergies if provided
    if (allergies && allergies.length > 0) {
      await tx.allergy.createMany({
        data: allergies.map((allergy: any) => ({
          patientId: newPatient.id,
          allergen: allergy.allergen,
          reaction: allergy.reaction,
          severity: allergy.severity,
          notes: allergy.notes,
          createdBy,
        })),
      });
    }

    // Create medications if provided
    if (medications && medications.length > 0) {
      await tx.medication.createMany({
        data: medications.map((medication: any) => ({
          patientId: newPatient.id,
          name: medication.name,
          dosage: medication.dosage,
          frequency: medication.frequency,
          route: medication.route,
          startDate: new Date(medication.startDate),
          endDate: medication.endDate ? new Date(medication.endDate) : null,
          prescribedBy: medication.prescribedBy,
          notes: medication.notes,
          status: 'ACTIVE',
          createdBy,
        })),
      });
    }

    return newPatient;
  });

  // Send welcome email if email provided
  if (email) {
    try {
      await sendEmail({
        to: email,
        subject: 'Welcome to Nova Check EHR',
        template: 'patient-welcome',
        data: {
          firstName,
          patientId,
          portalUrl: `${config.app.frontendUrl}/patient-portal`,
        },
      });
    } catch (error) {
      logger.error('Failed to send welcome email to patient', {
        error,
        patientId: patient.id,
        email,
      });
    }
  }

  // Log patient creation
  await prisma.auditLog.create({
    data: {
      userId: createdBy,
      action: 'PATIENT_CREATE',
      resource: 'Patient',
      resourceId: patient.id,
      details: {
        patientId,
        firstName,
        lastName,
        email,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Patient created successfully', {
    patientId: patient.id,
    patientNumber: patientId,
    createdBy,
  });

  // Fetch complete patient data
  const completePatient = await prisma.patient.findUnique({
    where: { id: patient.id },
    include: {
      allergies: true,
      medications: {
        where: { status: 'ACTIVE' },
      },
      appointments: {
        orderBy: { scheduledAt: 'desc' },
        take: 5,
      },
    },
  });

  res.status(201).json({
    success: true,
    message: 'Patient created successfully',
    data: { patient: completePatient },
  });
});

/**
 * Get all patients with filtering and pagination
 */
export const getPatients = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    page = 1,
    limit = 20,
    search,
    status,
    gender,
    ageMin,
    ageMax,
    providerId,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  const user = req.user!;

  // Build where clause
  const where: any = {};

  // Role-based filtering
  if (user.role === 'PROVIDER' && user.providerId) {
    // Providers can only see their assigned patients
    where.careTeam = {
      some: {
        providerId: user.providerId,
      },
    };
  } else if (user.role === 'PATIENT' && user.patientId) {
    // Patients can only see their own record
    where.id = user.patientId;
  }

  // Search filter
  if (search) {
    where.OR = [
      { firstName: { contains: search as string, mode: 'insensitive' } },
      { lastName: { contains: search as string, mode: 'insensitive' } },
      { patientId: { contains: search as string, mode: 'insensitive' } },
      { email: { contains: search as string, mode: 'insensitive' } },
      { phone: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  // Status filter
  if (status) {
    where.status = status;
  }

  // Gender filter
  if (gender) {
    where.gender = gender;
  }

  // Age range filter
  if (ageMin || ageMax) {
    const today = new Date();
    if (ageMax) {
      const minDate = new Date(today.getFullYear() - Number(ageMax) - 1, today.getMonth(), today.getDate());
      where.dateOfBirth = { gte: minDate };
    }
    if (ageMin) {
      const maxDate = new Date(today.getFullYear() - Number(ageMin), today.getMonth(), today.getDate());
      where.dateOfBirth = { ...where.dateOfBirth, lte: maxDate };
    }
  }

  // Provider filter
  if (providerId) {
    where.careTeam = {
      some: {
        providerId: providerId as string,
      },
    };
  }

  // Build order by
  const orderBy: any = {};
  orderBy[sortBy as string] = sortOrder;

  const [patients, total] = await Promise.all([
    prisma.patient.findMany({
      where,
      include: {
        allergies: {
          select: {
            id: true,
            allergen: true,
            severity: true,
          },
        },
        medications: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            name: true,
            dosage: true,
            frequency: true,
          },
        },
        appointments: {
          where: {
            scheduledAt: { gte: new Date() },
            status: { in: ['SCHEDULED', 'CONFIRMED'] },
          },
          orderBy: { scheduledAt: 'asc' },
          take: 1,
          select: {
            id: true,
            scheduledAt: true,
            type: true,
            provider: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        careTeam: {
          include: {
            provider: {
              select: {
                firstName: true,
                lastName: true,
                specialties: true,
              },
            },
          },
        },
      },
      orderBy,
      skip: offset,
      take: Number(limit),
    }),
    prisma.patient.count({ where }),
  ]);

  // Add calculated age to each patient
  const patientsWithAge = patients.map(patient => ({
    ...patient,
    age: calculateAge(patient.dateOfBirth),
    nextAppointment: patient.appointments[0] || null,
    appointments: undefined, // Remove the appointments array since we only need the next one
  }));

  const totalPages = Math.ceil(total / Number(limit));

  res.json({
    success: true,
    data: {
      patients: patientsWithAge,
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
 * Get patient by ID
 */
export const getPatientById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  // Check access permissions
  if (user.role === 'PATIENT' && user.patientId !== id) {
    throw new ForbiddenError('Access denied');
  }

  const patient = await prisma.patient.findUnique({
    where: { id },
    include: {
      allergies: {
        orderBy: { createdAt: 'desc' },
      },
      medications: {
        orderBy: { createdAt: 'desc' },
      },
      conditions: {
        orderBy: { diagnosedAt: 'desc' },
      },
      encounters: {
        include: {
          provider: {
            select: {
              firstName: true,
              lastName: true,
              specialties: true,
            },
          },
          vitalSigns: {
            orderBy: { recordedAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { startTime: 'desc' },
        take: 10,
      },
      appointments: {
        include: {
          provider: {
            select: {
              firstName: true,
              lastName: true,
              specialties: true,
            },
          },
        },
        orderBy: { scheduledAt: 'desc' },
        take: 10,
      },
      careTeam: {
        include: {
          provider: {
            select: {
              firstName: true,
              lastName: true,
              specialties: true,
              licenses: true,
            },
          },
        },
      },
      documents: {
        orderBy: { uploadedAt: 'desc' },
        take: 10,
      },
      labResults: {
        orderBy: { collectedAt: 'desc' },
        take: 10,
      },
      imagingResults: {
        orderBy: { performedAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!patient) {
    throw new NotFoundError('Patient not found');
  }

  // Check provider access
  if (user.role === 'PROVIDER' && user.providerId) {
    const hasAccess = patient.careTeam.some(member => member.providerId === user.providerId);
    if (!hasAccess) {
      throw new ForbiddenError('Access denied');
    }
  }

  // Add calculated fields
  const patientWithCalculatedFields = {
    ...patient,
    age: calculateAge(patient.dateOfBirth),
    bmi: patient.weight && patient.height ? 
      Number((patient.weight / Math.pow(patient.height / 100, 2)).toFixed(1)) : null,
  };

  // Log patient access
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'PATIENT_VIEW',
      resource: 'Patient',
      resourceId: id,
      details: {
        patientId: patient.patientId,
        accessedBy: user.role,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  res.json({
    success: true,
    data: { patient: patientWithCalculatedFields },
  });
});

/**
 * Update patient information
 */
export const updatePatient = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const {
    firstName,
    lastName,
    email,
    phone,
    address,
    emergencyContact,
    insurance,
    medicalHistory,
    socialHistory,
    familyHistory,
    status,
  } = req.body;

  const user = req.user!;
  const updatedBy = user.id;

  // Check if patient exists
  const existingPatient = await prisma.patient.findUnique({
    where: { id },
  });

  if (!existingPatient) {
    throw new NotFoundError('Patient not found');
  }

  // Check access permissions
  if (user.role === 'PATIENT' && user.patientId !== id) {
    throw new ForbiddenError('Access denied');
  }

  // Check if email is already taken by another patient
  if (email && email !== existingPatient.email) {
    const emailExists = await prisma.patient.findUnique({
      where: { email },
    });

    if (emailExists) {
      throw new ValidationError('Email is already taken');
    }
  }

  // Update patient
  const patient = await prisma.patient.update({
    where: { id },
    data: {
      firstName,
      lastName,
      email,
      phone: phone ? formatPhoneNumber(phone) : undefined,
      address,
      emergencyContact,
      insurance,
      medicalHistory,
      socialHistory,
      familyHistory,
      status,
      updatedBy,
      updatedAt: new Date(),
    },
    include: {
      allergies: true,
      medications: {
        where: { status: 'ACTIVE' },
      },
    },
  });

  // Log patient update
  await prisma.auditLog.create({
    data: {
      userId: updatedBy,
      action: 'PATIENT_UPDATE',
      resource: 'Patient',
      resourceId: id,
      details: {
        patientId: existingPatient.patientId,
        updatedFields: Object.keys(req.body),
        updatedBy: user.role,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Patient updated successfully', {
    patientId: id,
    patientNumber: existingPatient.patientId,
    updatedBy,
    updatedFields: Object.keys(req.body),
  });

  res.json({
    success: true,
    message: 'Patient updated successfully',
    data: { patient },
  });
});

/**
 * Delete patient (soft delete)
 */
export const deletePatient = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  // Check if patient exists
  const patient = await prisma.patient.findUnique({
    where: { id },
  });

  if (!patient) {
    throw new NotFoundError('Patient not found');
  }

  // Only admins can delete patients
  if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Insufficient permissions');
  }

  // Soft delete patient
  await prisma.patient.update({
    where: { id },
    data: {
      status: PatientStatus.INACTIVE,
      deletedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Log patient deletion
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'PATIENT_DELETE',
      resource: 'Patient',
      resourceId: id,
      details: {
        patientId: patient.patientId,
        firstName: patient.firstName,
        lastName: patient.lastName,
        deletedBy: user.role,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Patient deleted successfully', {
    patientId: id,
    patientNumber: patient.patientId,
    deletedBy: user.id,
  });

  res.json({
    success: true,
    message: 'Patient deleted successfully',
  });
});

/**
 * Get patient medical summary
 */
export const getPatientSummary = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  // Check access permissions
  if (user.role === 'PATIENT' && user.patientId !== id) {
    throw new ForbiddenError('Access denied');
  }

  const patient = await prisma.patient.findUnique({
    where: { id },
    select: {
      id: true,
      patientId: true,
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      gender: true,
      bloodType: true,
      weight: true,
      height: true,
    },
  });

  if (!patient) {
    throw new NotFoundError('Patient not found');
  }

  // Get summary data
  const [allergies, medications, conditions, recentVitals, recentLabs] = await Promise.all([
    prisma.allergy.findMany({
      where: { patientId: id },
      select: {
        allergen: true,
        reaction: true,
        severity: true,
      },
    }),
    prisma.medication.findMany({
      where: {
        patientId: id,
        status: 'ACTIVE',
      },
      select: {
        name: true,
        dosage: true,
        frequency: true,
      },
    }),
    prisma.condition.findMany({
      where: {
        patientId: id,
        status: 'ACTIVE',
      },
      select: {
        name: true,
        icdCode: true,
        severity: true,
        diagnosedAt: true,
      },
      orderBy: { diagnosedAt: 'desc' },
    }),
    prisma.vitalSigns.findFirst({
      where: { encounter: { patientId: id } },
      orderBy: { recordedAt: 'desc' },
      select: {
        temperature: true,
        bloodPressureSystolic: true,
        bloodPressureDiastolic: true,
        heartRate: true,
        respiratoryRate: true,
        oxygenSaturation: true,
        recordedAt: true,
      },
    }),
    prisma.labResult.findMany({
      where: { patientId: id },
      orderBy: { collectedAt: 'desc' },
      take: 5,
      select: {
        testName: true,
        value: true,
        unit: true,
        referenceRange: true,
        status: true,
        collectedAt: true,
      },
    }),
  ]);

  const summary = {
    patient: {
      ...patient,
      age: calculateAge(patient.dateOfBirth),
      bmi: patient.weight && patient.height ? 
        Number((patient.weight / Math.pow(patient.height / 100, 2)).toFixed(1)) : null,
    },
    allergies,
    medications,
    conditions,
    recentVitals,
    recentLabs,
  };

  res.json({
    success: true,
    data: { summary },
  });
});

/**
 * Search patients
 */
export const searchPatients = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { q, limit = 10 } = req.query;
  const user = req.user!;

  if (!q || (q as string).length < 2) {
    throw new ValidationError('Search query must be at least 2 characters');
  }

  const where: any = {
    OR: [
      { firstName: { contains: q as string, mode: 'insensitive' } },
      { lastName: { contains: q as string, mode: 'insensitive' } },
      { patientId: { contains: q as string, mode: 'insensitive' } },
      { email: { contains: q as string, mode: 'insensitive' } },
    ],
  };

  // Role-based filtering
  if (user.role === 'PROVIDER' && user.providerId) {
    where.careTeam = {
      some: {
        providerId: user.providerId,
      },
    };
  } else if (user.role === 'PATIENT' && user.patientId) {
    where.id = user.patientId;
  }

  const patients = await prisma.patient.findMany({
    where,
    select: {
      id: true,
      patientId: true,
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      email: true,
      phone: true,
      status: true,
    },
    take: Number(limit),
    orderBy: [
      { firstName: 'asc' },
      { lastName: 'asc' },
    ],
  });

  const patientsWithAge = patients.map(patient => ({
    ...patient,
    age: calculateAge(patient.dateOfBirth),
  }));

  res.json({
    success: true,
    data: { patients: patientsWithAge },
  });
});

/**
 * Get patient statistics
 */
export const getPatientStats = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;

  // Build base where clause for role-based filtering
  const baseWhere: any = {};
  if (user.role === 'PROVIDER' && user.providerId) {
    baseWhere.careTeam = {
      some: {
        providerId: user.providerId,
      },
    };
  }

  const [totalPatients, activePatients, newPatientsThisMonth, patientsByGender, patientsByAgeGroup] = await Promise.all([
    prisma.patient.count({ where: baseWhere }),
    prisma.patient.count({
      where: {
        ...baseWhere,
        status: PatientStatus.ACTIVE,
      },
    }),
    prisma.patient.count({
      where: {
        ...baseWhere,
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      },
    }),
    prisma.patient.groupBy({
      by: ['gender'],
      where: baseWhere,
      _count: true,
    }),
    // Age groups calculation would need raw SQL or application logic
    Promise.resolve([]), // Placeholder for age groups
  ]);

  const stats = {
    totalPatients,
    activePatients,
    inactivePatients: totalPatients - activePatients,
    newPatientsThisMonth,
    patientsByGender: patientsByGender.map(group => ({
      gender: group.gender,
      count: group._count,
    })),
    patientsByAgeGroup, // Would need implementation
  };

  res.json({
    success: true,
    data: { stats },
  });
});

/**
 * Export patient data
 */
export const exportPatientData = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { format = 'json' } = req.query;
  const user = req.user!;

  // Check access permissions
  if (user.role === 'PATIENT' && user.patientId !== id) {
    throw new ForbiddenError('Access denied');
  }

  const patient = await prisma.patient.findUnique({
    where: { id },
    include: {
      allergies: true,
      medications: true,
      conditions: true,
      encounters: {
        include: {
          vitalSigns: true,
          provider: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      },
      appointments: {
        include: {
          provider: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      },
      labResults: true,
      imagingResults: true,
      documents: true,
    },
  });

  if (!patient) {
    throw new NotFoundError('Patient not found');
  }

  // Log data export
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'PATIENT_EXPORT',
      resource: 'Patient',
      resourceId: id,
      details: {
        patientId: patient.patientId,
        format,
        exportedBy: user.role,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  if (format === 'csv') {
    // Implement CSV export logic
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="patient-${patient.patientId}.csv"`);
    // CSV implementation would go here
    res.send('CSV export not implemented yet');
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="patient-${patient.patientId}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      patient,
    });
  }
});