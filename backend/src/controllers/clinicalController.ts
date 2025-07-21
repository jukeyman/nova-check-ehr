/**
 * ============================================================================
 * NOVA CHECK EHR - CLINICAL CONTROLLER
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { PrismaClient, UserRole, EncounterStatus, VitalSignType, AllergyStatus, MedicationStatus, ConditionStatus, ProcedureStatus } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../middleware/errorHandler';
import logger from '../config/logger';
import { CacheService } from '../config/redis';
import { asyncHandler } from '../middleware/errorHandler';
import { sendEmail } from '../services/emailService';
import { generateClinicalSummary } from '../services/aiService';
import { validateClinicalData } from '../utils/clinicalValidation';
import { format } from 'date-fns';
import config from '../config/config';

const prisma = new PrismaClient();
const cacheService = new CacheService();

/**
 * Create a new encounter
 */
export const createEncounter = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    patientId,
    appointmentId,
    type,
    chiefComplaint,
    historyOfPresentIllness,
    reviewOfSystems,
    physicalExamination,
    assessment,
    plan,
    notes,
    isUrgent = false,
  } = req.body;

  const user = req.user!;
  const providerId = user.providerId;

  if (!providerId) {
    throw new ForbiddenError('Only providers can create encounters');
  }

  // Verify patient exists and provider has access
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      careTeam: {
        where: { providerId },
      },
    },
  });

  if (!patient) {
    throw new NotFoundError('Patient not found');
  }

  if (patient.careTeam.length === 0) {
    throw new ForbiddenError('Provider does not have access to this patient');
  }

  // Verify appointment if provided
  if (appointmentId) {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      throw new NotFoundError('Appointment not found');
    }

    if (appointment.patientId !== patientId || appointment.providerId !== providerId) {
      throw new ForbiddenError('Appointment does not match patient and provider');
    }
  }

  // Create encounter
  const encounter = await prisma.encounter.create({
    data: {
      patientId,
      providerId,
      appointmentId,
      type,
      chiefComplaint,
      historyOfPresentIllness,
      reviewOfSystems,
      physicalExamination,
      assessment,
      plan,
      notes,
      status: EncounterStatus.IN_PROGRESS,
      isUrgent,
      startTime: new Date(),
      createdBy: user.id,
    },
    include: {
      patient: {
        select: {
          id: true,
          patientId: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
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
          specialties: true,
        },
      },
      appointment: {
        select: {
          id: true,
          scheduledAt: true,
          type: true,
        },
      },
    },
  });

  // Update appointment status if linked
  if (appointmentId) {
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'IN_PROGRESS',
        updatedAt: new Date(),
      },
    });
  }

  // Log encounter creation
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'ENCOUNTER_CREATE',
      resource: 'Encounter',
      resourceId: encounter.id,
      details: {
        patientId,
        appointmentId,
        type,
        chiefComplaint,
        isUrgent,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Encounter created successfully', {
    encounterId: encounter.id,
    patientId,
    providerId,
    appointmentId,
    createdBy: user.id,
  });

  res.status(201).json({
    success: true,
    message: 'Encounter created successfully',
    data: { encounter },
  });
});

/**
 * Get encounters with filtering
 */
export const getEncounters = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    page = 1,
    limit = 20,
    patientId,
    providerId,
    status,
    type,
    startDate,
    endDate,
    isUrgent,
    sortBy = 'startTime',
    sortOrder = 'desc',
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  const user = req.user!;

  // Build where clause with role-based filtering
  const where: any = {};

  if (user.role === UserRole.PATIENT && user.patientId) {
    where.patientId = user.patientId;
  } else if (user.role === UserRole.PROVIDER && user.providerId) {
    where.providerId = user.providerId;
  }

  // Additional filters
  if (patientId) {
    // Check if user has access to this patient
    if (user.role === UserRole.PROVIDER && user.providerId) {
      const hasAccess = await prisma.careTeamMember.findFirst({
        where: {
          patientId,
          providerId: user.providerId,
        },
      });
      if (!hasAccess) {
        throw new ForbiddenError('Access denied to patient records');
      }
    }
    where.patientId = patientId;
  }

  if (providerId) {
    where.providerId = providerId;
  }

  if (status) {
    where.status = status;
  }

  if (type) {
    where.type = type;
  }

  if (isUrgent !== undefined) {
    where.isUrgent = isUrgent === 'true';
  }

  // Date range filter
  if (startDate || endDate) {
    where.startTime = {};
    if (startDate) {
      where.startTime.gte = new Date(startDate as string);
    }
    if (endDate) {
      where.startTime.lte = new Date(endDate as string);
    }
  }

  // Build order by
  const orderBy: any = {};
  orderBy[sortBy as string] = sortOrder;

  const [encounters, total] = await Promise.all([
    prisma.encounter.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
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
            specialties: {
              where: { isPrimary: true },
            },
          },
        },
        appointment: {
          select: {
            id: true,
            scheduledAt: true,
            type: true,
          },
        },
        vitalSigns: {
          take: 1,
          orderBy: { recordedAt: 'desc' },
        },
        diagnoses: {
          take: 3,
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy,
      skip: offset,
      take: Number(limit),
    }),
    prisma.encounter.count({ where }),
  ]);

  const totalPages = Math.ceil(total / Number(limit));

  res.json({
    success: true,
    data: {
      encounters,
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
 * Get encounter by ID
 */
export const getEncounterById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  const encounter = await prisma.encounter.findUnique({
    where: { id },
    include: {
      patient: {
        include: {
          allergies: {
            where: { status: AllergyStatus.ACTIVE },
          },
          medications: {
            where: { status: MedicationStatus.ACTIVE },
          },
          conditions: {
            where: { status: ConditionStatus.ACTIVE },
          },
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
          specialties: true,
        },
      },
      appointment: true,
      vitalSigns: {
        orderBy: { recordedAt: 'desc' },
      },
      diagnoses: {
        orderBy: { createdAt: 'desc' },
      },
      procedures: {
        orderBy: { performedAt: 'desc' },
      },
      labResults: {
        orderBy: { collectedAt: 'desc' },
      },
      imagingResults: {
        orderBy: { performedAt: 'desc' },
      },
      prescriptions: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!encounter) {
    throw new NotFoundError('Encounter not found');
  }

  // Check access permissions
  if (user.role === UserRole.PATIENT && user.patientId !== encounter.patientId) {
    throw new ForbiddenError('Access denied');
  }

  if (user.role === UserRole.PROVIDER && user.providerId !== encounter.providerId) {
    // Check if provider has access to patient
    const hasAccess = await prisma.careTeamMember.findFirst({
      where: {
        patientId: encounter.patientId,
        providerId: user.providerId,
      },
    });
    if (!hasAccess) {
      throw new ForbiddenError('Access denied');
    }
  }

  // Log encounter access
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'ENCOUNTER_VIEW',
      resource: 'Encounter',
      resourceId: id,
      details: {
        patientId: encounter.patientId,
        providerId: encounter.providerId,
        encounterType: encounter.type,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  res.json({
    success: true,
    data: { encounter },
  });
});

/**
 * Update encounter
 */
export const updateEncounter = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const {
    chiefComplaint,
    historyOfPresentIllness,
    reviewOfSystems,
    physicalExamination,
    assessment,
    plan,
    notes,
    status,
    endTime,
  } = req.body;

  const user = req.user!;

  // Get existing encounter
  const existingEncounter = await prisma.encounter.findUnique({
    where: { id },
  });

  if (!existingEncounter) {
    throw new NotFoundError('Encounter not found');
  }

  // Check permissions
  if (user.role === UserRole.PROVIDER && user.providerId !== existingEncounter.providerId) {
    throw new ForbiddenError('Access denied');
  }

  // Validate status transition
  if (status && status !== existingEncounter.status) {
    if (existingEncounter.status === EncounterStatus.COMPLETED) {
      throw new ValidationError('Cannot modify completed encounters');
    }
  }

  // Update encounter
  const encounter = await prisma.encounter.update({
    where: { id },
    data: {
      chiefComplaint,
      historyOfPresentIllness,
      reviewOfSystems,
      physicalExamination,
      assessment,
      plan,
      notes,
      status,
      endTime: status === EncounterStatus.COMPLETED ? (endTime || new Date()) : endTime,
      updatedBy: user.id,
      updatedAt: new Date(),
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
  });

  // Update appointment status if encounter is completed
  if (status === EncounterStatus.COMPLETED && existingEncounter.appointmentId) {
    await prisma.appointment.update({
      where: { id: existingEncounter.appointmentId },
      data: {
        status: 'COMPLETED',
        updatedAt: new Date(),
      },
    });
  }

  // Log encounter update
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'ENCOUNTER_UPDATE',
      resource: 'Encounter',
      resourceId: id,
      details: {
        updatedFields: Object.keys(req.body),
        oldStatus: existingEncounter.status,
        newStatus: status,
        patientId: encounter.patientId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Encounter updated successfully', {
    encounterId: id,
    updatedBy: user.id,
    updatedFields: Object.keys(req.body),
  });

  res.json({
    success: true,
    message: 'Encounter updated successfully',
    data: { encounter },
  });
});

/**
 * Add vital signs to encounter
 */
export const addVitalSigns = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { encounterId } = req.params;
  const {
    temperature,
    bloodPressureSystolic,
    bloodPressureDiastolic,
    heartRate,
    respiratoryRate,
    oxygenSaturation,
    weight,
    height,
    bmi,
    painLevel,
    notes,
  } = req.body;

  const user = req.user!;

  // Verify encounter exists and user has access
  const encounter = await prisma.encounter.findUnique({
    where: { id: encounterId },
  });

  if (!encounter) {
    throw new NotFoundError('Encounter not found');
  }

  if (user.role === UserRole.PROVIDER && user.providerId !== encounter.providerId) {
    throw new ForbiddenError('Access denied');
  }

  // Validate vital signs data
  const validationResult = validateClinicalData('vitalSigns', req.body);
  if (!validationResult.isValid) {
    throw new ValidationError(`Invalid vital signs data: ${validationResult.errors.join(', ')}`);
  }

  // Calculate BMI if height and weight provided
  let calculatedBmi = bmi;
  if (height && weight && !bmi) {
    calculatedBmi = (weight / ((height / 100) ** 2)).toFixed(1);
  }

  // Create vital signs record
  const vitalSigns = await prisma.vitalSigns.create({
    data: {
      encounterId,
      patientId: encounter.patientId,
      temperature,
      bloodPressureSystolic,
      bloodPressureDiastolic,
      heartRate,
      respiratoryRate,
      oxygenSaturation,
      weight,
      height,
      bmi: calculatedBmi ? parseFloat(calculatedBmi) : null,
      painLevel,
      notes,
      recordedAt: new Date(),
      recordedBy: user.id,
    },
  });

  // Log vital signs addition
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'VITAL_SIGNS_ADD',
      resource: 'VitalSigns',
      resourceId: vitalSigns.id,
      details: {
        encounterId,
        patientId: encounter.patientId,
        vitalSigns: {
          temperature,
          bloodPressure: `${bloodPressureSystolic}/${bloodPressureDiastolic}`,
          heartRate,
          respiratoryRate,
          oxygenSaturation,
        },
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Vital signs added successfully', {
    vitalSignsId: vitalSigns.id,
    encounterId,
    patientId: encounter.patientId,
    recordedBy: user.id,
  });

  res.status(201).json({
    success: true,
    message: 'Vital signs added successfully',
    data: { vitalSigns },
  });
});

/**
 * Add diagnosis to encounter
 */
export const addDiagnosis = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { encounterId } = req.params;
  const {
    code,
    codeSystem,
    description,
    isPrimary = false,
    severity,
    onset,
    notes,
  } = req.body;

  const user = req.user!;

  if (!user.providerId) {
    throw new ForbiddenError('Only providers can add diagnoses');
  }

  // Verify encounter exists and user has access
  const encounter = await prisma.encounter.findUnique({
    where: { id: encounterId },
  });

  if (!encounter) {
    throw new NotFoundError('Encounter not found');
  }

  if (user.providerId !== encounter.providerId) {
    throw new ForbiddenError('Access denied');
  }

  // If this is primary, unset other primary diagnoses for this encounter
  if (isPrimary) {
    await prisma.diagnosis.updateMany({
      where: {
        encounterId,
        isPrimary: true,
      },
      data: {
        isPrimary: false,
      },
    });
  }

  // Create diagnosis
  const diagnosis = await prisma.diagnosis.create({
    data: {
      encounterId,
      patientId: encounter.patientId,
      providerId: user.providerId,
      code,
      codeSystem,
      description,
      isPrimary,
      severity,
      onset: onset ? new Date(onset) : null,
      notes,
      diagnosedAt: new Date(),
    },
  });

  // Also create or update patient condition
  const existingCondition = await prisma.condition.findFirst({
    where: {
      patientId: encounter.patientId,
      code,
      codeSystem,
    },
  });

  if (!existingCondition) {
    await prisma.condition.create({
      data: {
        patientId: encounter.patientId,
        code,
        codeSystem,
        description,
        severity,
        onset: onset ? new Date(onset) : null,
        status: ConditionStatus.ACTIVE,
        diagnosedBy: user.providerId,
        diagnosedAt: new Date(),
        notes,
      },
    });
  }

  // Log diagnosis addition
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'DIAGNOSIS_ADD',
      resource: 'Diagnosis',
      resourceId: diagnosis.id,
      details: {
        encounterId,
        patientId: encounter.patientId,
        code,
        description,
        isPrimary,
        severity,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Diagnosis added successfully', {
    diagnosisId: diagnosis.id,
    encounterId,
    patientId: encounter.patientId,
    code,
    description,
    addedBy: user.id,
  });

  res.status(201).json({
    success: true,
    message: 'Diagnosis added successfully',
    data: { diagnosis },
  });
});

/**
 * Add procedure to encounter
 */
export const addProcedure = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { encounterId } = req.params;
  const {
    code,
    codeSystem,
    description,
    performedAt,
    duration,
    outcome,
    complications,
    notes,
  } = req.body;

  const user = req.user!;

  if (!user.providerId) {
    throw new ForbiddenError('Only providers can add procedures');
  }

  // Verify encounter exists and user has access
  const encounter = await prisma.encounter.findUnique({
    where: { id: encounterId },
  });

  if (!encounter) {
    throw new NotFoundError('Encounter not found');
  }

  if (user.providerId !== encounter.providerId) {
    throw new ForbiddenError('Access denied');
  }

  // Create procedure
  const procedure = await prisma.procedure.create({
    data: {
      encounterId,
      patientId: encounter.patientId,
      providerId: user.providerId,
      code,
      codeSystem,
      description,
      performedAt: performedAt ? new Date(performedAt) : new Date(),
      duration,
      outcome,
      complications,
      notes,
      status: ProcedureStatus.COMPLETED,
    },
  });

  // Log procedure addition
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'PROCEDURE_ADD',
      resource: 'Procedure',
      resourceId: procedure.id,
      details: {
        encounterId,
        patientId: encounter.patientId,
        code,
        description,
        performedAt: procedure.performedAt.toISOString(),
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Procedure added successfully', {
    procedureId: procedure.id,
    encounterId,
    patientId: encounter.patientId,
    code,
    description,
    addedBy: user.id,
  });

  res.status(201).json({
    success: true,
    message: 'Procedure added successfully',
    data: { procedure },
  });
});

/**
 * Get patient allergies
 */
export const getPatientAllergies = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { patientId } = req.params;
  const { status = 'ACTIVE' } = req.query;
  const user = req.user!;

  // Check access permissions
  if (user.role === UserRole.PATIENT && user.patientId !== patientId) {
    throw new ForbiddenError('Access denied');
  }

  if (user.role === UserRole.PROVIDER && user.providerId) {
    const hasAccess = await prisma.careTeamMember.findFirst({
      where: {
        patientId,
        providerId: user.providerId,
      },
    });
    if (!hasAccess) {
      throw new ForbiddenError('Access denied to patient records');
    }
  }

  const allergies = await prisma.allergy.findMany({
    where: {
      patientId,
      status: status as AllergyStatus,
    },
    include: {
      recordedByUser: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: {
      recordedAt: 'desc',
    },
  });

  res.json({
    success: true,
    data: { allergies },
  });
});

/**
 * Add patient allergy
 */
export const addPatientAllergy = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { patientId } = req.params;
  const {
    allergen,
    allergenType,
    reaction,
    severity,
    onset,
    notes,
  } = req.body;

  const user = req.user!;

  // Check access permissions
  if (user.role === UserRole.PATIENT && user.patientId !== patientId) {
    throw new ForbiddenError('Access denied');
  }

  if (user.role === UserRole.PROVIDER && user.providerId) {
    const hasAccess = await prisma.careTeamMember.findFirst({
      where: {
        patientId,
        providerId: user.providerId,
      },
    });
    if (!hasAccess) {
      throw new ForbiddenError('Access denied to patient records');
    }
  }

  // Check if allergy already exists
  const existingAllergy = await prisma.allergy.findFirst({
    where: {
      patientId,
      allergen,
      status: AllergyStatus.ACTIVE,
    },
  });

  if (existingAllergy) {
    throw new ConflictError('Patient already has this allergy recorded');
  }

  // Create allergy
  const allergy = await prisma.allergy.create({
    data: {
      patientId,
      allergen,
      allergenType,
      reaction,
      severity,
      onset: onset ? new Date(onset) : null,
      notes,
      status: AllergyStatus.ACTIVE,
      recordedAt: new Date(),
      recordedBy: user.id,
    },
  });

  // Log allergy addition
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'ALLERGY_ADD',
      resource: 'Allergy',
      resourceId: allergy.id,
      details: {
        patientId,
        allergen,
        allergenType,
        severity,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Patient allergy added successfully', {
    allergyId: allergy.id,
    patientId,
    allergen,
    severity,
    addedBy: user.id,
  });

  res.status(201).json({
    success: true,
    message: 'Allergy added successfully',
    data: { allergy },
  });
});

/**
 * Get patient medications
 */
export const getPatientMedications = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { patientId } = req.params;
  const { status = 'ACTIVE' } = req.query;
  const user = req.user!;

  // Check access permissions
  if (user.role === UserRole.PATIENT && user.patientId !== patientId) {
    throw new ForbiddenError('Access denied');
  }

  if (user.role === UserRole.PROVIDER && user.providerId) {
    const hasAccess = await prisma.careTeamMember.findFirst({
      where: {
        patientId,
        providerId: user.providerId,
      },
    });
    if (!hasAccess) {
      throw new ForbiddenError('Access denied to patient records');
    }
  }

  const medications = await prisma.medication.findMany({
    where: {
      patientId,
      status: status as MedicationStatus,
    },
    include: {
      prescribedByProvider: {
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
      startDate: 'desc',
    },
  });

  res.json({
    success: true,
    data: { medications },
  });
});

/**
 * Add patient medication
 */
export const addPatientMedication = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { patientId } = req.params;
  const {
    name,
    genericName,
    dosage,
    frequency,
    route,
    startDate,
    endDate,
    indication,
    instructions,
    notes,
  } = req.body;

  const user = req.user!;

  if (!user.providerId) {
    throw new ForbiddenError('Only providers can add medications');
  }

  // Check access permissions
  const hasAccess = await prisma.careTeamMember.findFirst({
    where: {
      patientId,
      providerId: user.providerId,
    },
  });
  if (!hasAccess) {
    throw new ForbiddenError('Access denied to patient records');
  }

  // Create medication
  const medication = await prisma.medication.create({
    data: {
      patientId,
      name,
      genericName,
      dosage,
      frequency,
      route,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      indication,
      instructions,
      notes,
      status: MedicationStatus.ACTIVE,
      prescribedBy: user.providerId,
      prescribedAt: new Date(),
    },
    include: {
      prescribedByProvider: {
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
  });

  // Log medication addition
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'MEDICATION_ADD',
      resource: 'Medication',
      resourceId: medication.id,
      details: {
        patientId,
        medicationName: name,
        dosage,
        frequency,
        indication,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Patient medication added successfully', {
    medicationId: medication.id,
    patientId,
    medicationName: name,
    prescribedBy: user.id,
  });

  res.status(201).json({
    success: true,
    message: 'Medication added successfully',
    data: { medication },
  });
});

/**
 * Generate clinical summary
 */
export const generateClinicalSummaryForEncounter = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { encounterId } = req.params;
  const user = req.user!;

  if (!user.providerId) {
    throw new ForbiddenError('Only providers can generate clinical summaries');
  }

  // Get encounter with all related data
  const encounter = await prisma.encounter.findUnique({
    where: { id: encounterId },
    include: {
      patient: {
        include: {
          allergies: {
            where: { status: AllergyStatus.ACTIVE },
          },
          medications: {
            where: { status: MedicationStatus.ACTIVE },
          },
          conditions: {
            where: { status: ConditionStatus.ACTIVE },
          },
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
      vitalSigns: {
        orderBy: { recordedAt: 'desc' },
        take: 1,
      },
      diagnoses: {
        orderBy: { createdAt: 'desc' },
      },
      procedures: {
        orderBy: { performedAt: 'desc' },
      },
    },
  });

  if (!encounter) {
    throw new NotFoundError('Encounter not found');
  }

  if (user.providerId !== encounter.providerId) {
    throw new ForbiddenError('Access denied');
  }

  try {
    // Generate AI-powered clinical summary
    const summary = await generateClinicalSummary(encounter);

    // Update encounter with generated summary
    await prisma.encounter.update({
      where: { id: encounterId },
      data: {
        aiGeneratedSummary: summary,
        updatedAt: new Date(),
      },
    });

    // Log summary generation
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'CLINICAL_SUMMARY_GENERATE',
        resource: 'Encounter',
        resourceId: encounterId,
        details: {
          patientId: encounter.patientId,
          summaryLength: summary.length,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent') || 'Unknown',
      },
    });

    logger.info('Clinical summary generated successfully', {
      encounterId,
      patientId: encounter.patientId,
      generatedBy: user.id,
    });

    res.json({
      success: true,
      message: 'Clinical summary generated successfully',
      data: { summary },
    });
  } catch (error) {
    logger.error('Failed to generate clinical summary', {
      error,
      encounterId,
      patientId: encounter.patientId,
    });

    throw new AppError('Failed to generate clinical summary', 500);
  }
});

/**
 * Get clinical statistics
 */
export const getClinicalStats = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { startDate, endDate } = req.query;
  const user = req.user!;

  // Build base where clause for role-based filtering
  const baseWhere: any = {};
  if (user.role === UserRole.PROVIDER && user.providerId) {
    baseWhere.providerId = user.providerId;
  } else if (user.role === UserRole.PATIENT && user.patientId) {
    baseWhere.patientId = user.patientId;
  }

  // Add date range filter
  if (startDate || endDate) {
    baseWhere.startTime = {};
    if (startDate) {
      baseWhere.startTime.gte = new Date(startDate as string);
    }
    if (endDate) {
      baseWhere.startTime.lte = new Date(endDate as string);
    }
  }

  const [totalEncounters, encountersByStatus, encountersByType, urgentEncounters, totalDiagnoses, totalProcedures] = await Promise.all([
    prisma.encounter.count({ where: baseWhere }),
    prisma.encounter.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: true,
    }),
    prisma.encounter.groupBy({
      by: ['type'],
      where: baseWhere,
      _count: true,
    }),
    prisma.encounter.count({
      where: {
        ...baseWhere,
        isUrgent: true,
      },
    }),
    prisma.diagnosis.count({
      where: {
        encounter: baseWhere,
      },
    }),
    prisma.procedure.count({
      where: {
        encounter: baseWhere,
      },
    }),
  ]);

  const stats = {
    totalEncounters,
    urgentEncounters,
    totalDiagnoses,
    totalProcedures,
    encountersByStatus: encountersByStatus.map(group => ({
      status: group.status,
      count: group._count,
    })),
    encountersByType: encountersByType.map(group => ({
      type: group.type,
      count: group._count,
    })),
  };

  res.json({
    success: true,
    data: { stats },
  });
});