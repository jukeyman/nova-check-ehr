/**
 * ============================================================================
 * NOVA CHECK EHR - CLINICAL DATA MANAGEMENT ROUTES
 * ============================================================================
 */

import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { PrismaClient, UserRole, MedicalRecordType, VitalSignType } from '@prisma/client';
import config from '../config/config';
import logger from '../config/logger';
import { authenticateToken, requireRole } from '../middleware/auth';
import { rateLimiters } from '../middleware/security';
import auditService from '../services/auditService';
import cacheService from '../services/cacheService';
import fileUploadService from '../services/fileUploadService';
import notificationService from '../services/notificationService';

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

interface ClinicalResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Validation middleware
const validateMedicalRecord = [
  body('patientId')
    .isUUID()
    .withMessage('Invalid patient ID'),
  body('type')
    .isIn(Object.values(MedicalRecordType))
    .withMessage('Invalid medical record type'),
  body('title')
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3 and 200 characters'),
  body('description')
    .trim()
    .isLength({ min: 10, max: 5000 })
    .withMessage('Description must be between 10 and 5000 characters'),
  body('diagnosis')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Diagnosis must not exceed 1000 characters'),
  body('treatment')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Treatment must not exceed 1000 characters'),
  body('medications')
    .optional()
    .isArray()
    .withMessage('Medications must be an array'),
  body('allergies')
    .optional()
    .isArray()
    .withMessage('Allergies must be an array'),
  body('followUpRequired')
    .optional()
    .isBoolean()
    .withMessage('Follow up required must be a boolean'),
  body('followUpDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid follow up date'),
];

const validateVitalSigns = [
  body('patientId')
    .isUUID()
    .withMessage('Invalid patient ID'),
  body('type')
    .isIn(Object.values(VitalSignType))
    .withMessage('Invalid vital sign type'),
  body('value')
    .isNumeric()
    .withMessage('Value must be numeric'),
  body('unit')
    .trim()
    .isLength({ min: 1, max: 20 })
    .withMessage('Unit must be between 1 and 20 characters'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes must not exceed 500 characters'),
  body('recordedAt')
    .optional()
    .isISO8601()
    .withMessage('Invalid recorded date'),
];

const validatePrescription = [
  body('patientId')
    .isUUID()
    .withMessage('Invalid patient ID'),
  body('medicationName')
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Medication name must be between 2 and 200 characters'),
  body('dosage')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Dosage must be between 1 and 100 characters'),
  body('frequency')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Frequency must be between 1 and 100 characters'),
  body('duration')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Duration must be between 1 and 100 characters'),
  body('instructions')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Instructions must not exceed 1000 characters'),
  body('startDate')
    .isISO8601()
    .withMessage('Invalid start date'),
  body('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date'),
];

const validateLabResult = [
  body('patientId')
    .isUUID()
    .withMessage('Invalid patient ID'),
  body('testName')
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Test name must be between 2 and 200 characters'),
  body('testCode')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Test code must not exceed 50 characters'),
  body('result')
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Result must be between 1 and 500 characters'),
  body('unit')
    .optional()
    .trim()
    .isLength({ max: 20 })
    .withMessage('Unit must not exceed 20 characters'),
  body('referenceRange')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Reference range must not exceed 100 characters'),
  body('status')
    .optional()
    .isIn(['NORMAL', 'ABNORMAL', 'CRITICAL', 'PENDING'])
    .withMessage('Invalid status'),
  body('performedAt')
    .isISO8601()
    .withMessage('Invalid performed date'),
];

const validateClinicalQuery = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('type')
    .optional()
    .isIn(Object.values(MedicalRecordType))
    .withMessage('Invalid type filter'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date'),
];

// Helper functions
const canAccessPatientClinicalData = async (currentUser: any, patientId: string): Promise<boolean> => {
  // Super admin can access all data
  if (currentUser.role === UserRole.SUPER_ADMIN) {
    return true;
  }

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      userId: true,
      facilityId: true,
    },
  });

  if (!patient) {
    return false;
  }

  // Patients can only access their own data
  if (currentUser.role === UserRole.PATIENT) {
    return currentUser.id === patient.userId;
  }

  // Healthcare providers can access patients in their facility
  if ([UserRole.DOCTOR, UserRole.NURSE].includes(currentUser.role)) {
    return currentUser.facilityId === patient.facilityId;
  }

  // Admins can access patients in their facility
  if (currentUser.role === UserRole.ADMIN) {
    return currentUser.facilityId === patient.facilityId;
  }

  return false;
};

const generateRecordNumber = (type: string): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  const prefix = type.substring(0, 3).toUpperCase();
  return `${prefix}-${timestamp}-${random}`.toUpperCase();
};

// Routes

/**
 * @route   GET /api/v1/clinical/medical-records
 * @desc    Get medical records with filtering
 * @access  Private
 */
router.get('/medical-records', authenticateToken, validateClinicalQuery, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const {
      page = 1,
      limit = 20,
      patientId,
      type,
      providerId,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause based on user role
    const where: any = {};

    // Role-based filtering
    if (req.user?.role === UserRole.PATIENT) {
      // Patients can only see their own records
      const patient = await prisma.patient.findFirst({
        where: { userId: req.user.id },
        select: { id: true },
      });
      if (patient) {
        where.patientId = patient.id;
      } else {
        return res.status(404).json({
          success: false,
          message: 'Patient profile not found',
        });
      }
    } else if ([UserRole.DOCTOR, UserRole.NURSE].includes(req.user?.role)) {
      // Providers can see records for patients in their facility
      if (req.user?.facilityId) {
        where.patient = {
          facilityId: req.user.facilityId,
        };
      }
    } else if (req.user?.role === UserRole.ADMIN && req.user?.facilityId) {
      // Admins can see all records in their facility
      where.patient = {
        facilityId: req.user.facilityId,
      };
    }
    // Super admins can see all records (no additional filtering)

    // Apply additional filters
    if (patientId) {
      // Check access to specific patient
      const hasAccess = await canAccessPatientClinicalData(req.user, patientId as string);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to patient data',
        });
      }
      where.patientId = patientId;
    }

    if (type) {
      where.type = type;
    }

    if (providerId) {
      where.providerId = providerId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate as string);
      }
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get medical records with pagination
    const [medicalRecords, total] = await Promise.all([
      prisma.medicalRecord.findMany({
        where,
        skip,
        take: limitNum,
        orderBy,
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
            select: {
              id: true,
              providerNumber: true,
              firstName: true,
              lastName: true,
              specialization: true,
            },
          },
          appointment: {
            select: {
              id: true,
              appointmentNumber: true,
              scheduledAt: true,
              type: true,
            },
          },
          attachments: {
            select: {
              id: true,
              fileName: true,
              fileType: true,
              fileSize: true,
              uploadedAt: true,
            },
          },
        },
      }),
      prisma.medicalRecord.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    const response: ClinicalResponse = {
      success: true,
      message: 'Medical records retrieved successfully',
      data: { medicalRecords },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get medical records error', {
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
 * @route   GET /api/v1/clinical/medical-records/:id
 * @desc    Get medical record by ID
 * @access  Private
 */
router.get('/medical-records/:id', authenticateToken, [param('id').isUUID().withMessage('Invalid medical record ID')], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { id } = req.params;

    const medicalRecord = await prisma.medicalRecord.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            userId: true,
            facilityId: true,
          },
        },
        provider: {
          select: {
            id: true,
            providerNumber: true,
            firstName: true,
            lastName: true,
            specialization: true,
            type: true,
          },
        },
        appointment: {
          select: {
            id: true,
            appointmentNumber: true,
            scheduledAt: true,
            type: true,
            status: true,
          },
        },
        attachments: {
          select: {
            id: true,
            fileName: true,
            fileType: true,
            fileSize: true,
            filePath: true,
            uploadedAt: true,
          },
        },
        vitalSigns: {
          select: {
            id: true,
            type: true,
            value: true,
            unit: true,
            recordedAt: true,
          },
        },
        prescriptions: {
          select: {
            id: true,
            medicationName: true,
            dosage: true,
            frequency: true,
            duration: true,
            status: true,
            startDate: true,
            endDate: true,
          },
        },
        labResults: {
          select: {
            id: true,
            testName: true,
            result: true,
            unit: true,
            referenceRange: true,
            status: true,
            performedAt: true,
          },
        },
      },
    });

    if (!medicalRecord) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found',
      });
    }

    // Check access permissions
    const hasAccess = await canAccessPatientClinicalData(req.user, medicalRecord.patientId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to patient data',
      });
    }

    const response: ClinicalResponse = {
      success: true,
      message: 'Medical record retrieved successfully',
      data: { medicalRecord },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get medical record error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      recordId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/clinical/medical-records
 * @desc    Create a new medical record
 * @access  Private (Healthcare providers)
 */
router.post('/medical-records', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE]), rateLimiters.api, validateMedicalRecord, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const {
      patientId,
      appointmentId,
      type,
      title,
      description,
      diagnosis,
      treatment,
      medications,
      allergies,
      followUpRequired,
      followUpDate,
      notes,
    } = req.body;

    // Check access to patient
    const hasAccess = await canAccessPatientClinicalData(req.user, patientId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to patient data',
      });
    }

    // Verify patient exists
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, facilityId: true },
    });

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found',
      });
    }

    // Get provider information
    const provider = await prisma.provider.findFirst({
      where: { userId: req.user?.id },
      select: { id: true },
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found',
      });
    }

    // Verify appointment if provided
    if (appointmentId) {
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: { id: true, patientId: true, providerId: true },
      });

      if (!appointment) {
        return res.status(404).json({
          success: false,
          message: 'Appointment not found',
        });
      }

      if (appointment.patientId !== patientId || appointment.providerId !== provider.id) {
        return res.status(400).json({
          success: false,
          message: 'Appointment does not match patient and provider',
        });
      }
    }

    // Generate record number
    const recordNumber = generateRecordNumber(type);

    // Create medical record
    const medicalRecord = await prisma.medicalRecord.create({
      data: {
        recordNumber,
        patientId,
        providerId: provider.id,
        appointmentId,
        type,
        title,
        description,
        diagnosis,
        treatment,
        medications: medications ? JSON.stringify(medications) : null,
        allergies: allergies ? JSON.stringify(allergies) : null,
        followUpRequired: followUpRequired || false,
        followUpDate: followUpDate ? new Date(followUpDate) : null,
        notes,
        createdAt: new Date(),
        updatedAt: new Date(),
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
          select: {
            id: true,
            providerNumber: true,
            firstName: true,
            lastName: true,
            specialization: true,
          },
        },
        appointment: {
          select: {
            id: true,
            appointmentNumber: true,
            scheduledAt: true,
            type: true,
          },
        },
      },
    });

    // Cache patient data update
    await cacheService.invalidatePatientCache(patientId);

    // Log audit event
    await auditService.log({
      action: 'MEDICAL_RECORD_CREATED',
      userId: req.user?.id,
      resourceType: 'MedicalRecord',
      resourceId: medicalRecord.id,
      details: {
        recordNumber: medicalRecord.recordNumber,
        patientId,
        type,
        title,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    // Send notification to patient
    await notificationService.createNotification({
      userId: patient.userId,
      type: 'MEDICAL_RECORD',
      title: 'New Medical Record',
      message: `A new ${type.toLowerCase()} record has been added to your medical history`,
      data: {
        medicalRecordId: medicalRecord.id,
        type,
        title,
      },
    });

    logger.info('Medical record created successfully', {
      recordId: medicalRecord.id,
      recordNumber: medicalRecord.recordNumber,
      patientId,
      providerId: provider.id,
      createdBy: req.user?.id,
    });

    const response: ClinicalResponse = {
      success: true,
      message: 'Medical record created successfully',
      data: { medicalRecord },
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Create medical record error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during medical record creation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   PUT /api/v1/clinical/medical-records/:id
 * @desc    Update medical record
 * @access  Private (Healthcare providers)
 */
router.put('/medical-records/:id', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE]), [
  param('id').isUUID().withMessage('Invalid medical record ID'),
  body('title')
    .optional()
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3 and 200 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ min: 10, max: 5000 })
    .withMessage('Description must be between 10 and 5000 characters'),
  body('diagnosis')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Diagnosis must not exceed 1000 characters'),
  body('treatment')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Treatment must not exceed 1000 characters'),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Find existing medical record
    const existingRecord = await prisma.medicalRecord.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, userId: true } },
        provider: { select: { id: true, userId: true } },
      },
    });

    if (!existingRecord) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found',
      });
    }

    // Check access permissions
    const hasAccess = await canAccessPatientClinicalData(req.user, existingRecord.patientId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to patient data',
      });
    }

    // Only the creating provider or admin can update
    if (req.user?.role !== UserRole.ADMIN && req.user?.role !== UserRole.SUPER_ADMIN) {
      if (existingRecord.provider?.userId !== req.user?.id) {
        return res.status(403).json({
          success: false,
          message: 'Only the creating provider can update this record',
        });
      }
    }

    // Prepare update data
    const allowedUpdates: any = {};
    const allowedFields = ['title', 'description', 'diagnosis', 'treatment', 'medications', 'allergies', 'followUpRequired', 'followUpDate', 'notes'];

    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        if (field === 'medications' || field === 'allergies') {
          allowedUpdates[field] = Array.isArray(updateData[field]) ? JSON.stringify(updateData[field]) : updateData[field];
        } else if (field === 'followUpDate') {
          allowedUpdates[field] = updateData[field] ? new Date(updateData[field]) : null;
        } else {
          allowedUpdates[field] = updateData[field];
        }
      }
    }

    allowedUpdates.updatedAt = new Date();

    // Update medical record
    const updatedRecord = await prisma.medicalRecord.update({
      where: { id },
      data: allowedUpdates,
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
          select: {
            id: true,
            providerNumber: true,
            firstName: true,
            lastName: true,
            specialization: true,
          },
        },
      },
    });

    // Cache invalidation
    await cacheService.invalidatePatientCache(existingRecord.patientId);

    // Log audit event
    await auditService.log({
      action: 'MEDICAL_RECORD_UPDATED',
      userId: req.user?.id,
      resourceType: 'MedicalRecord',
      resourceId: id,
      details: {
        recordNumber: existingRecord.recordNumber,
        updatedFields: Object.keys(allowedUpdates),
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Medical record updated successfully', {
      recordId: id,
      updatedBy: req.user?.id,
      updatedFields: Object.keys(allowedUpdates),
    });

    const response: ClinicalResponse = {
      success: true,
      message: 'Medical record updated successfully',
      data: { medicalRecord: updatedRecord },
    };

    res.json(response);
  } catch (error) {
    logger.error('Update medical record error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      recordId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during medical record update',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/clinical/vital-signs
 * @desc    Record vital signs
 * @access  Private (Healthcare providers)
 */
router.post('/vital-signs', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE]), rateLimiters.api, validateVitalSigns, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const {
      patientId,
      medicalRecordId,
      type,
      value,
      unit,
      notes,
      recordedAt,
    } = req.body;

    // Check access to patient
    const hasAccess = await canAccessPatientClinicalData(req.user, patientId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to patient data',
      });
    }

    // Get provider information
    const provider = await prisma.provider.findFirst({
      where: { userId: req.user?.id },
      select: { id: true },
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found',
      });
    }

    // Verify medical record if provided
    if (medicalRecordId) {
      const medicalRecord = await prisma.medicalRecord.findUnique({
        where: { id: medicalRecordId },
        select: { id: true, patientId: true },
      });

      if (!medicalRecord || medicalRecord.patientId !== patientId) {
        return res.status(400).json({
          success: false,
          message: 'Medical record does not match patient',
        });
      }
    }

    // Create vital signs record
    const vitalSigns = await prisma.vitalSigns.create({
      data: {
        patientId,
        providerId: provider.id,
        medicalRecordId,
        type,
        value: parseFloat(value),
        unit,
        notes,
        recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
        createdAt: new Date(),
      },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
          },
        },
        provider: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            specialization: true,
          },
        },
      },
    });

    // Cache invalidation
    await cacheService.invalidatePatientCache(patientId);

    // Log audit event
    await auditService.log({
      action: 'VITAL_SIGNS_RECORDED',
      userId: req.user?.id,
      resourceType: 'VitalSigns',
      resourceId: vitalSigns.id,
      details: {
        patientId,
        type,
        value,
        unit,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Vital signs recorded successfully', {
      vitalSignsId: vitalSigns.id,
      patientId,
      type,
      value,
      recordedBy: req.user?.id,
    });

    const response: ClinicalResponse = {
      success: true,
      message: 'Vital signs recorded successfully',
      data: { vitalSigns },
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Record vital signs error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during vital signs recording',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/clinical/vital-signs/:patientId
 * @desc    Get patient's vital signs
 * @access  Private
 */
router.get('/vital-signs/:patientId', authenticateToken, [
  param('patientId').isUUID().withMessage('Invalid patient ID'),
  ...validateClinicalQuery,
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { patientId } = req.params;
    const {
      page = 1,
      limit = 20,
      type,
      startDate,
      endDate,
      sortBy = 'recordedAt',
      sortOrder = 'desc',
    } = req.query;

    // Check access to patient
    const hasAccess = await canAccessPatientClinicalData(req.user, patientId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to patient data',
      });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = { patientId };

    if (type) {
      where.type = type;
    }

    if (startDate || endDate) {
      where.recordedAt = {};
      if (startDate) {
        where.recordedAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.recordedAt.lte = new Date(endDate as string);
      }
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get vital signs with pagination
    const [vitalSigns, total] = await Promise.all([
      prisma.vitalSigns.findMany({
        where,
        skip,
        take: limitNum,
        orderBy,
        include: {
          provider: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              specialization: true,
            },
          },
          medicalRecord: {
            select: {
              id: true,
              recordNumber: true,
              type: true,
              title: true,
            },
          },
        },
      }),
      prisma.vitalSigns.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    const response: ClinicalResponse = {
      success: true,
      message: 'Vital signs retrieved successfully',
      data: { vitalSigns },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get vital signs error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      patientId: req.params.patientId,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/clinical/prescriptions
 * @desc    Create a prescription
 * @access  Private (Doctors only)
 */
router.post('/prescriptions', authenticateToken, requireRole([UserRole.DOCTOR]), rateLimiters.api, validatePrescription, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const {
      patientId,
      medicalRecordId,
      medicationName,
      dosage,
      frequency,
      duration,
      instructions,
      startDate,
      endDate,
    } = req.body;

    // Check access to patient
    const hasAccess = await canAccessPatientClinicalData(req.user, patientId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to patient data',
      });
    }

    // Get provider information
    const provider = await prisma.provider.findFirst({
      where: { userId: req.user?.id },
      select: { id: true, type: true },
    });

    if (!provider || provider.type !== 'DOCTOR') {
      return res.status(403).json({
        success: false,
        message: 'Only doctors can prescribe medications',
      });
    }

    // Generate prescription number
    const prescriptionNumber = generateRecordNumber('PRESCRIPTION');

    // Create prescription
    const prescription = await prisma.prescription.create({
      data: {
        prescriptionNumber,
        patientId,
        providerId: provider.id,
        medicalRecordId,
        medicationName,
        dosage,
        frequency,
        duration,
        instructions,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        status: 'ACTIVE',
        createdAt: new Date(),
      },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
          },
        },
        provider: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            specialization: true,
          },
        },
      },
    });

    // Cache invalidation
    await cacheService.invalidatePatientCache(patientId);

    // Log audit event
    await auditService.log({
      action: 'PRESCRIPTION_CREATED',
      userId: req.user?.id,
      resourceType: 'Prescription',
      resourceId: prescription.id,
      details: {
        prescriptionNumber: prescription.prescriptionNumber,
        patientId,
        medicationName,
        dosage,
        frequency,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Prescription created successfully', {
      prescriptionId: prescription.id,
      prescriptionNumber: prescription.prescriptionNumber,
      patientId,
      medicationName,
      prescribedBy: req.user?.id,
    });

    const response: ClinicalResponse = {
      success: true,
      message: 'Prescription created successfully',
      data: { prescription },
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Create prescription error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during prescription creation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/clinical/prescriptions/:patientId
 * @desc    Get patient's prescriptions
 * @access  Private
 */
router.get('/prescriptions/:patientId', authenticateToken, [
  param('patientId').isUUID().withMessage('Invalid patient ID'),
  ...validateClinicalQuery,
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { patientId } = req.params;
    const {
      page = 1,
      limit = 20,
      status,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    // Check access to patient
    const hasAccess = await canAccessPatientClinicalData(req.user, patientId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to patient data',
      });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = { patientId };

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate as string);
      }
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get prescriptions with pagination
    const [prescriptions, total] = await Promise.all([
      prisma.prescription.findMany({
        where,
        skip,
        take: limitNum,
        orderBy,
        include: {
          provider: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              specialization: true,
            },
          },
          medicalRecord: {
            select: {
              id: true,
              recordNumber: true,
              type: true,
              title: true,
            },
          },
        },
      }),
      prisma.prescription.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    const response: ClinicalResponse = {
      success: true,
      message: 'Prescriptions retrieved successfully',
      data: { prescriptions },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get prescriptions error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      patientId: req.params.patientId,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/clinical/lab-results
 * @desc    Record lab results
 * @access  Private (Healthcare providers)
 */
router.post('/lab-results', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE]), rateLimiters.api, validateLabResult, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const {
      patientId,
      medicalRecordId,
      testName,
      testCode,
      result,
      unit,
      referenceRange,
      status = 'NORMAL',
      performedAt,
      notes,
    } = req.body;

    // Check access to patient
    const hasAccess = await canAccessPatientClinicalData(req.user, patientId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to patient data',
      });
    }

    // Get provider information
    const provider = await prisma.provider.findFirst({
      where: { userId: req.user?.id },
      select: { id: true },
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found',
      });
    }

    // Create lab result
    const labResult = await prisma.labResult.create({
      data: {
        patientId,
        providerId: provider.id,
        medicalRecordId,
        testName,
        testCode,
        result,
        unit,
        referenceRange,
        status,
        performedAt: new Date(performedAt),
        notes,
        createdAt: new Date(),
      },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
          },
        },
        provider: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            specialization: true,
          },
        },
      },
    });

    // Cache invalidation
    await cacheService.invalidatePatientCache(patientId);

    // Log audit event
    await auditService.log({
      action: 'LAB_RESULT_RECORDED',
      userId: req.user?.id,
      resourceType: 'LabResult',
      resourceId: labResult.id,
      details: {
        patientId,
        testName,
        result,
        status,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Lab result recorded successfully', {
      labResultId: labResult.id,
      patientId,
      testName,
      result,
      recordedBy: req.user?.id,
    });

    const response: ClinicalResponse = {
      success: true,
      message: 'Lab result recorded successfully',
      data: { labResult },
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Record lab result error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during lab result recording',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/clinical/lab-results/:patientId
 * @desc    Get patient's lab results
 * @access  Private
 */
router.get('/lab-results/:patientId', authenticateToken, [
  param('patientId').isUUID().withMessage('Invalid patient ID'),
  ...validateClinicalQuery,
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { patientId } = req.params;
    const {
      page = 1,
      limit = 20,
      status,
      testName,
      startDate,
      endDate,
      sortBy = 'performedAt',
      sortOrder = 'desc',
    } = req.query;

    // Check access to patient
    const hasAccess = await canAccessPatientClinicalData(req.user, patientId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to patient data',
      });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = { patientId };

    if (status) {
      where.status = status;
    }

    if (testName) {
      where.testName = {
        contains: testName,
        mode: 'insensitive',
      };
    }

    if (startDate || endDate) {
      where.performedAt = {};
      if (startDate) {
        where.performedAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.performedAt.lte = new Date(endDate as string);
      }
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get lab results with pagination
    const [labResults, total] = await Promise.all([
      prisma.labResult.findMany({
        where,
        skip,
        take: limitNum,
        orderBy,
        include: {
          provider: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              specialization: true,
            },
          },
          medicalRecord: {
            select: {
              id: true,
              recordNumber: true,
              type: true,
              title: true,
            },
          },
        },
      }),
      prisma.labResult.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    const response: ClinicalResponse = {
      success: true,
      message: 'Lab results retrieved successfully',
      data: { labResults },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get lab results error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      patientId: req.params.patientId,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/clinical/stats
 * @desc    Get clinical statistics
 * @access  Private (Healthcare providers)
 */
router.get('/stats', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.SUPER_ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
    const facilityFilter = req.user?.role !== UserRole.SUPER_ADMIN && req.user?.facilityId
      ? { patient: { facilityId: req.user.facilityId } }
      : {};

    const [totalRecords, recordsByType, totalVitalSigns, totalPrescriptions, totalLabResults, recentRecords] = await Promise.all([
      prisma.medicalRecord.count({ where: facilityFilter }),
      prisma.medicalRecord.groupBy({
        by: ['type'],
        where: facilityFilter,
        _count: {
          id: true,
        },
      }),
      prisma.vitalSigns.count({ where: facilityFilter }),
      prisma.prescription.count({ where: facilityFilter }),
      prisma.labResult.count({ where: facilityFilter }),
      prisma.medicalRecord.count({
        where: {
          ...facilityFilter,
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
      }),
    ]);

    const typeStats = recordsByType.reduce((acc, item) => {
      acc[item.type] = item._count.id;
      return acc;
    }, {} as Record<string, number>);

    const stats = {
      totalRecords,
      recordsByType: typeStats,
      totalVitalSigns,
      totalPrescriptions,
      totalLabResults,
      recentRecords,
    };

    const response: ClinicalResponse = {
      success: true,
      message: 'Clinical statistics retrieved successfully',
      data: { stats },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get clinical stats error', {
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

export default router;