/**
 * ============================================================================
 * NOVA CHECK EHR - PATIENT MANAGEMENT ROUTES
 * ============================================================================
 */

import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { PrismaClient, UserRole, PatientStatus, Gender } from '@prisma/client';
import config from '../config/config';
import logger from '../config/logger';
import { authenticateToken, requireRole } from '../middleware/auth';
import { rateLimiters } from '../middleware/security';
import auditService from '../services/auditService';
import cacheService from '../services/cacheService';
import emailService from '../services/emailService';
import smsService from '../services/smsService';

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

interface PatientResponse {
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
const validateCreatePatient = [
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('dateOfBirth')
    .isISO8601()
    .withMessage('Invalid date of birth'),
  body('gender')
    .isIn(Object.values(Gender))
    .withMessage('Invalid gender'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('phone')
    .optional()
    .isMobilePhone('any')
    .withMessage('Invalid phone number'),
  body('emergencyContactName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Emergency contact name must be between 2 and 100 characters'),
  body('emergencyContactPhone')
    .optional()
    .isMobilePhone('any')
    .withMessage('Invalid emergency contact phone number'),
  body('address.street')
    .optional()
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Street address must be between 5 and 200 characters'),
  body('address.city')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('City must be between 2 and 100 characters'),
  body('address.state')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('State must be between 2 and 50 characters'),
  body('address.zipCode')
    .optional()
    .trim()
    .isLength({ min: 5, max: 10 })
    .withMessage('Zip code must be between 5 and 10 characters'),
  body('address.country')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Country must be between 2 and 50 characters'),
];

const validateUpdatePatient = [
  param('id').isUUID().withMessage('Invalid patient ID'),
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('phone')
    .optional()
    .isMobilePhone('any')
    .withMessage('Invalid phone number'),
  body('emergencyContactName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Emergency contact name must be between 2 and 100 characters'),
  body('emergencyContactPhone')
    .optional()
    .isMobilePhone('any')
    .withMessage('Invalid emergency contact phone number'),
];

const validatePatientQuery = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('status')
    .optional()
    .isIn(Object.values(PatientStatus))
    .withMessage('Invalid status filter'),
  query('gender')
    .optional()
    .isIn(Object.values(Gender))
    .withMessage('Invalid gender filter'),
];

const validateMedicalRecord = [
  param('patientId').isUUID().withMessage('Invalid patient ID'),
  body('type')
    .isIn(['DIAGNOSIS', 'TREATMENT', 'MEDICATION', 'ALLERGY', 'VITAL_SIGNS', 'LAB_RESULT', 'IMAGING', 'PROCEDURE', 'NOTE'])
    .withMessage('Invalid medical record type'),
  body('title')
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3 and 200 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description must not exceed 2000 characters'),
  body('providerId')
    .isUUID()
    .withMessage('Invalid provider ID'),
];

// Helper functions
const canAccessPatient = async (currentUser: any, patientId: string): Promise<boolean> => {
  // Super admin can access all patients
  if (currentUser.role === UserRole.SUPER_ADMIN) {
    return true;
  }

  // Check if patient exists and get facility info
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { facilityId: true, userId: true },
  });

  if (!patient) {
    return false;
  }

  // Patients can only access their own records
  if (currentUser.role === UserRole.PATIENT) {
    return currentUser.id === patient.userId;
  }

  // Healthcare providers can access patients in their facility
  if (currentUser.facilityId && patient.facilityId) {
    return currentUser.facilityId === patient.facilityId;
  }

  return false;
};

const generatePatientId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `PAT-${timestamp}-${random}`.toUpperCase();
};

// Routes

/**
 * @route   GET /api/v1/patients
 * @desc    Get all patients with filtering and pagination
 * @access  Private (Healthcare providers)
 */
router.get('/', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.SUPER_ADMIN]), validatePatientQuery, async (req: AuthRequest, res: Response) => {
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
      search,
      status,
      gender,
      ageMin,
      ageMax,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = {};

    // Facility-based filtering for non-super admins
    if (req.user?.role !== UserRole.SUPER_ADMIN && req.user?.facilityId) {
      where.facilityId = req.user.facilityId;
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { patientId: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    if (gender) {
      where.gender = gender;
    }

    // Age filtering
    if (ageMin || ageMax) {
      const currentDate = new Date();
      if (ageMax) {
        const minBirthDate = new Date(currentDate.getFullYear() - parseInt(ageMax as string), currentDate.getMonth(), currentDate.getDate());
        where.dateOfBirth = { ...where.dateOfBirth, gte: minBirthDate };
      }
      if (ageMin) {
        const maxBirthDate = new Date(currentDate.getFullYear() - parseInt(ageMin as string), currentDate.getMonth(), currentDate.getDate());
        where.dateOfBirth = { ...where.dateOfBirth, lte: maxBirthDate };
      }
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get patients with pagination
    const [patients, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        skip,
        take: limitNum,
        orderBy,
        select: {
          id: true,
          patientId: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          gender: true,
          email: true,
          phone: true,
          status: true,
          emergencyContactName: true,
          emergencyContactPhone: true,
          createdAt: true,
          updatedAt: true,
          facility: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              email: true,
              lastLoginAt: true,
            },
          },
        },
      }),
      prisma.patient.count({ where }),
    ]);

    // Calculate age for each patient
    const patientsWithAge = patients.map(patient => {
      const age = new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear();
      return { ...patient, age };
    });

    const totalPages = Math.ceil(total / limitNum);

    const response: PatientResponse = {
      success: true,
      message: 'Patients retrieved successfully',
      data: { patients: patientsWithAge },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get patients error', {
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
 * @route   GET /api/v1/patients/:id
 * @desc    Get patient by ID
 * @access  Private
 */
router.get('/:id', authenticateToken, [param('id').isUUID().withMessage('Invalid patient ID')], async (req: AuthRequest, res: Response) => {
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

    // Check access permissions
    const hasAccess = await canAccessPatient(req.user, id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const patient = await prisma.patient.findUnique({
      where: { id },
      include: {
        facility: {
          select: {
            id: true,
            name: true,
            address: true,
            phone: true,
          },
        },
        user: {
          select: {
            id: true,
            email: true,
            lastLoginAt: true,
            emailVerified: true,
          },
        },
        address: true,
        insurance: true,
        medicalRecords: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            title: true,
            description: true,
            createdAt: true,
            provider: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                specialization: true,
              },
            },
          },
        },
        appointments: {
          take: 5,
          orderBy: { scheduledAt: 'desc' },
          select: {
            id: true,
            type: true,
            status: true,
            scheduledAt: true,
            provider: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                specialization: true,
              },
            },
          },
        },
      },
    });

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found',
      });
    }

    // Calculate age
    const age = new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear();
    const patientWithAge = { ...patient, age };

    const response: PatientResponse = {
      success: true,
      message: 'Patient retrieved successfully',
      data: { patient: patientWithAge },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get patient error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      patientId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/patients
 * @desc    Create a new patient
 * @access  Private (Healthcare providers)
 */
router.post('/', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.SUPER_ADMIN]), rateLimiters.api, validateCreatePatient, async (req: AuthRequest, res: Response) => {
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
      firstName,
      lastName,
      dateOfBirth,
      gender,
      email,
      phone,
      emergencyContactName,
      emergencyContactPhone,
      address,
      insurance,
      medicalHistory,
      allergies,
      medications,
    } = req.body;

    // Check if patient with same email already exists
    if (email) {
      const existingPatient = await prisma.patient.findFirst({
        where: { email },
      });

      if (existingPatient) {
        return res.status(409).json({
          success: false,
          message: 'Patient with this email already exists',
        });
      }
    }

    // Generate unique patient ID
    const patientId = generatePatientId();

    // Create patient in transaction
    const patient = await prisma.$transaction(async (tx) => {
      // Create patient
      const newPatient = await tx.patient.create({
        data: {
          patientId,
          firstName,
          lastName,
          dateOfBirth: new Date(dateOfBirth),
          gender,
          email,
          phone,
          emergencyContactName,
          emergencyContactPhone,
          facilityId: req.user?.facilityId,
          status: PatientStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Create address if provided
      if (address) {
        await tx.patientAddress.create({
          data: {
            patientId: newPatient.id,
            street: address.street,
            city: address.city,
            state: address.state,
            zipCode: address.zipCode,
            country: address.country || 'USA',
            isPrimary: true,
          },
        });
      }

      // Create insurance if provided
      if (insurance) {
        await tx.patientInsurance.create({
          data: {
            patientId: newPatient.id,
            provider: insurance.provider,
            policyNumber: insurance.policyNumber,
            groupNumber: insurance.groupNumber,
            isPrimary: true,
          },
        });
      }

      // Create initial medical records if provided
      if (medicalHistory && medicalHistory.length > 0) {
        for (const record of medicalHistory) {
          await tx.medicalRecord.create({
            data: {
              patientId: newPatient.id,
              providerId: req.user?.id,
              type: 'NOTE',
              title: 'Medical History',
              description: record,
              createdAt: new Date(),
            },
          });
        }
      }

      // Create allergy records if provided
      if (allergies && allergies.length > 0) {
        for (const allergy of allergies) {
          await tx.medicalRecord.create({
            data: {
              patientId: newPatient.id,
              providerId: req.user?.id,
              type: 'ALLERGY',
              title: 'Allergy',
              description: allergy,
              createdAt: new Date(),
            },
          });
        }
      }

      // Create medication records if provided
      if (medications && medications.length > 0) {
        for (const medication of medications) {
          await tx.medicalRecord.create({
            data: {
              patientId: newPatient.id,
              providerId: req.user?.id,
              type: 'MEDICATION',
              title: 'Current Medication',
              description: medication,
              createdAt: new Date(),
            },
          });
        }
      }

      return newPatient;
    });

    // Send welcome email if email provided
    if (email) {
      await emailService.sendPatientWelcomeEmail({
        to: email,
        firstName,
        patientId,
        facilityName: req.user?.facilityId ? 'Your Healthcare Facility' : 'Nova Check EHR',
      });
    }

    // Log audit event
    await auditService.log({
      action: 'PATIENT_CREATED',
      userId: req.user?.id,
      resourceType: 'Patient',
      resourceId: patient.id,
      details: {
        patientId: patient.patientId,
        patientName: `${firstName} ${lastName}`,
        facilityId: req.user?.facilityId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Patient created successfully', {
      patientId: patient.id,
      patientNumber: patient.patientId,
      createdBy: req.user?.id,
    });

    const response: PatientResponse = {
      success: true,
      message: 'Patient created successfully',
      data: { patient },
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Create patient error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during patient creation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   PUT /api/v1/patients/:id
 * @desc    Update patient
 * @access  Private
 */
router.put('/:id', authenticateToken, validateUpdatePatient, async (req: AuthRequest, res: Response) => {
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

    // Check access permissions
    const hasAccess = await canAccessPatient(req.user, id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Find existing patient
    const existingPatient = await prisma.patient.findUnique({
      where: { id },
    });

    if (!existingPatient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found',
      });
    }

    // Prepare update data
    const allowedUpdates: any = {};
    const allowedFields = ['firstName', 'lastName', 'email', 'phone', 'emergencyContactName', 'emergencyContactPhone'];

    // Only healthcare providers can update status
    if (req.user?.role !== UserRole.PATIENT) {
      allowedFields.push('status');
    }

    // Filter allowed updates
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        allowedUpdates[field] = updateData[field];
      }
    }

    allowedUpdates.updatedAt = new Date();

    // Update patient
    const updatedPatient = await prisma.patient.update({
      where: { id },
      data: allowedUpdates,
      select: {
        id: true,
        patientId: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        gender: true,
        email: true,
        phone: true,
        status: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Invalidate patient cache
    await cacheService.invalidatePatientCache(id);

    // Log audit event
    await auditService.log({
      action: 'PATIENT_UPDATED',
      userId: req.user?.id,
      resourceType: 'Patient',
      resourceId: id,
      details: {
        updatedFields: Object.keys(allowedUpdates),
        patientId: existingPatient.patientId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Patient updated successfully', {
      patientId: id,
      updatedBy: req.user?.id,
      updatedFields: Object.keys(allowedUpdates),
    });

    const response: PatientResponse = {
      success: true,
      message: 'Patient updated successfully',
      data: { patient: updatedPatient },
    };

    res.json(response);
  } catch (error) {
    logger.error('Update patient error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      patientId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during patient update',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/patients/:id/medical-records
 * @desc    Get patient medical records
 * @access  Private
 */
router.get('/:id/medical-records', authenticateToken, [
  param('id').isUUID().withMessage('Invalid patient ID'),
  ...validatePatientQuery,
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
    const {
      page = 1,
      limit = 20,
      type,
      providerId,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    // Check access permissions
    const hasAccess = await canAccessPatient(req.user, id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = { patientId: id };

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
          provider: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              specialization: true,
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

    const response: PatientResponse = {
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
      patientId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/patients/:patientId/medical-records
 * @desc    Create medical record for patient
 * @access  Private (Healthcare providers)
 */
router.post('/:patientId/medical-records', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.SUPER_ADMIN]), validateMedicalRecord, async (req: AuthRequest, res: Response) => {
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
    const { type, title, description, providerId, data, attachments } = req.body;

    // Check access permissions
    const hasAccess = await canAccessPatient(req.user, patientId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Verify provider exists and has access
    const provider = await prisma.user.findUnique({
      where: { id: providerId },
      select: { id: true, role: true, facilityId: true },
    });

    if (!provider || ![UserRole.DOCTOR, UserRole.NURSE].includes(provider.role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid provider ID',
      });
    }

    // Create medical record
    const medicalRecord = await prisma.medicalRecord.create({
      data: {
        patientId,
        providerId,
        type,
        title,
        description,
        data: data ? JSON.stringify(data) : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      include: {
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

    // Invalidate patient cache
    await cacheService.invalidatePatientCache(patientId);

    // Log audit event
    await auditService.log({
      action: 'MEDICAL_RECORD_CREATED',
      userId: req.user?.id,
      resourceType: 'MedicalRecord',
      resourceId: medicalRecord.id,
      details: {
        patientId,
        recordType: type,
        title,
        providerId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Medical record created successfully', {
      recordId: medicalRecord.id,
      patientId,
      type,
      createdBy: req.user?.id,
    });

    const response: PatientResponse = {
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
      patientId: req.params.patientId,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during medical record creation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/patients/:id/appointments
 * @desc    Get patient appointments
 * @access  Private
 */
router.get('/:id/appointments', authenticateToken, [
  param('id').isUUID().withMessage('Invalid patient ID'),
  ...validatePatientQuery,
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
    const {
      page = 1,
      limit = 20,
      status,
      providerId,
      startDate,
      endDate,
      sortBy = 'scheduledAt',
      sortOrder = 'desc',
    } = req.query;

    // Check access permissions
    const hasAccess = await canAccessPatient(req.user, id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = { patientId: id };

    if (status) {
      where.status = status;
    }

    if (providerId) {
      where.providerId = providerId;
    }

    if (startDate || endDate) {
      where.scheduledAt = {};
      if (startDate) {
        where.scheduledAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.scheduledAt.lte = new Date(endDate as string);
      }
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get appointments with pagination
    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
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
          facility: {
            select: {
              id: true,
              name: true,
              address: true,
            },
          },
        },
      }),
      prisma.appointment.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    const response: PatientResponse = {
      success: true,
      message: 'Appointments retrieved successfully',
      data: { appointments },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get patient appointments error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      patientId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/patients/stats
 * @desc    Get patient statistics
 * @access  Private (Healthcare providers)
 */
router.get('/stats', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.SUPER_ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
    const facilityFilter = req.user?.role !== UserRole.SUPER_ADMIN && req.user?.facilityId
      ? { facilityId: req.user.facilityId }
      : {};

    const [totalPatients, activePatients, inactivePatients, patientsByGender, patientsByAgeGroup] = await Promise.all([
      prisma.patient.count({ where: facilityFilter }),
      prisma.patient.count({ where: { ...facilityFilter, status: PatientStatus.ACTIVE } }),
      prisma.patient.count({ where: { ...facilityFilter, status: PatientStatus.INACTIVE } }),
      prisma.patient.groupBy({
        by: ['gender'],
        where: facilityFilter,
        _count: {
          id: true,
        },
      }),
      // Age group calculation would need raw SQL or application logic
      prisma.patient.findMany({
        where: facilityFilter,
        select: {
          dateOfBirth: true,
        },
      }),
    ]);

    // Calculate age groups
    const currentYear = new Date().getFullYear();
    const ageGroups = {
      '0-18': 0,
      '19-35': 0,
      '36-50': 0,
      '51-65': 0,
      '65+': 0,
    };

    patientsByAgeGroup.forEach(patient => {
      const age = currentYear - new Date(patient.dateOfBirth).getFullYear();
      if (age <= 18) ageGroups['0-18']++;
      else if (age <= 35) ageGroups['19-35']++;
      else if (age <= 50) ageGroups['36-50']++;
      else if (age <= 65) ageGroups['51-65']++;
      else ageGroups['65+']++;
    });

    const genderStats = patientsByGender.reduce((acc, item) => {
      acc[item.gender] = item._count.id;
      return acc;
    }, {} as Record<string, number>);

    const stats = {
      total: totalPatients,
      active: activePatients,
      inactive: inactivePatients,
      byGender: genderStats,
      byAgeGroup: ageGroups,
    };

    const response: PatientResponse = {
      success: true,
      message: 'Patient statistics retrieved successfully',
      data: { stats },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get patient stats error', {
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