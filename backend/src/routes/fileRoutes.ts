/**
 * ============================================================================
 * NOVA CHECK EHR - FILE MANAGEMENT ROUTES
 * ============================================================================
 */

import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { PrismaClient, UserRole, FileType } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { config } from '../config/config';
import logger from '../config/logger';
import { authenticateToken, requireRole } from '../middleware/auth';
import { rateLimiters } from '../middleware/security';
import auditService from '../services/auditService';
import cacheService from '../services/cacheService';
import fileUploadService from '../services/fileUploadService';

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

interface FileResponse {
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

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'temp');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error, uploadDir);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${extension}`);
  },
});

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Allowed file types
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5, // Maximum 5 files per request
  },
});

// Validation middleware
const validateFileQuery = [
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
    .isIn(Object.values(FileType))
    .withMessage('Invalid file type filter'),
  query('category')
    .optional()
    .isIn(['MEDICAL_RECORD', 'PATIENT_DOCUMENT', 'INSURANCE', 'IDENTIFICATION', 'LAB_RESULT', 'PRESCRIPTION', 'OTHER'])
    .withMessage('Invalid category filter'),
];

const validateFileUpload = [
  body('category')
    .isIn(['MEDICAL_RECORD', 'PATIENT_DOCUMENT', 'INSURANCE', 'IDENTIFICATION', 'LAB_RESULT', 'PRESCRIPTION', 'OTHER'])
    .withMessage('Invalid file category'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description must not exceed 500 characters'),
  body('patientId')
    .optional()
    .isUUID()
    .withMessage('Invalid patient ID'),
  body('medicalRecordId')
    .optional()
    .isUUID()
    .withMessage('Invalid medical record ID'),
  body('isPublic')
    .optional()
    .isBoolean()
    .withMessage('isPublic must be a boolean'),
];

// Helper functions
const canAccessFile = async (currentUser: any, file: any): Promise<boolean> => {
  // Super admin can access all files
  if (currentUser.role === UserRole.SUPER_ADMIN) {
    return true;
  }

  // File owner can always access their files
  if (file.uploadedBy === currentUser.id) {
    return true;
  }

  // If file is associated with a patient
  if (file.patientId) {
    const patient = await prisma.patient.findUnique({
      where: { id: file.patientId },
      select: { userId: true, facilityId: true },
    });

    if (!patient) {
      return false;
    }

    // Patient can access their own files
    if (currentUser.role === UserRole.PATIENT && currentUser.id === patient.userId) {
      return true;
    }

    // Healthcare providers can access files for patients in their facility
    if ([UserRole.DOCTOR, UserRole.NURSE].includes(currentUser.role)) {
      return currentUser.facilityId === patient.facilityId;
    }

    // Admins can access files for patients in their facility
    if (currentUser.role === UserRole.ADMIN) {
      return currentUser.facilityId === patient.facilityId;
    }
  }

  // Public files can be accessed by authenticated users in the same facility
  if (file.isPublic && currentUser.facilityId) {
    return true;
  }

  return false;
};

const getFileTypeFromMimeType = (mimeType: string): FileType => {
  if (mimeType.startsWith('image/')) {
    return FileType.IMAGE;
  } else if (mimeType === 'application/pdf') {
    return FileType.PDF;
  } else if (mimeType.includes('word') || mimeType.includes('document')) {
    return FileType.DOCUMENT;
  } else if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || mimeType === 'text/csv') {
    return FileType.SPREADSHEET;
  } else {
    return FileType.OTHER;
  }
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Routes

/**
 * @route   GET /api/v1/files
 * @desc    Get files with filtering
 * @access  Private
 */
router.get('/', authenticateToken, validateFileQuery, async (req: AuthRequest, res: Response) => {
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
      type,
      category,
      patientId,
      search,
      sortBy = 'uploadedAt',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause based on user role
    const where: any = {};

    // Role-based filtering
    if (req.user?.role === UserRole.PATIENT) {
      // Patients can only see their own files
      const patient = await prisma.patient.findFirst({
        where: { userId: req.user.id },
        select: { id: true },
      });
      if (patient) {
        where.OR = [
          { patientId: patient.id },
          { uploadedBy: req.user.id },
          { isPublic: true },
        ];
      } else {
        where.uploadedBy = req.user.id;
      }
    } else if ([UserRole.DOCTOR, UserRole.NURSE].includes(req.user?.role)) {
      // Providers can see files for patients in their facility
      if (req.user?.facilityId) {
        where.OR = [
          { uploadedBy: req.user.id },
          { isPublic: true },
          {
            patient: {
              facilityId: req.user.facilityId,
            },
          },
        ];
      }
    } else if (req.user?.role === UserRole.ADMIN && req.user?.facilityId) {
      // Admins can see all files in their facility
      where.OR = [
        { uploadedBy: req.user.id },
        { isPublic: true },
        {
          patient: {
            facilityId: req.user.facilityId,
          },
        },
      ];
    }
    // Super admins can see all files (no additional filtering)

    // Apply additional filters
    if (type) {
      where.fileType = type;
    }

    if (category) {
      where.category = category;
    }

    if (patientId) {
      where.patientId = patientId;
    }

    if (search) {
      where.OR = [
        ...(where.OR || []),
        {
          fileName: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: search,
            mode: 'insensitive',
          },
        },
      ];
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get files with pagination
    const [files, total] = await Promise.all([
      prisma.fileAttachment.findMany({
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
          uploadedByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
      }),
      prisma.fileAttachment.count({ where }),
    ]);

    // Format file data
    const formattedFiles = files.map(file => ({
      ...file,
      formattedSize: formatFileSize(file.fileSize),
      downloadUrl: `/api/v1/files/${file.id}/download`,
      previewUrl: file.fileType === FileType.IMAGE ? `/api/v1/files/${file.id}/preview` : null,
    }));

    const totalPages = Math.ceil(total / limitNum);

    const response: FileResponse = {
      success: true,
      message: 'Files retrieved successfully',
      data: { files: formattedFiles },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get files error', {
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
 * @route   GET /api/v1/files/:id
 * @desc    Get file by ID
 * @access  Private
 */
router.get('/:id', authenticateToken, [param('id').isUUID().withMessage('Invalid file ID')], async (req: AuthRequest, res: Response) => {
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

    const file = await prisma.fileAttachment.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
            userId: true,
            facilityId: true,
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
        uploadedByUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found',
      });
    }

    // Check access permissions
    const hasAccess = await canAccessFile(req.user, file);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to file',
      });
    }

    const formattedFile = {
      ...file,
      formattedSize: formatFileSize(file.fileSize),
      downloadUrl: `/api/v1/files/${file.id}/download`,
      previewUrl: file.fileType === FileType.IMAGE ? `/api/v1/files/${file.id}/preview` : null,
    };

    const response: FileResponse = {
      success: true,
      message: 'File retrieved successfully',
      data: { file: formattedFile },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get file error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      fileId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/files/upload
 * @desc    Upload files
 * @access  Private
 */
router.post('/upload', authenticateToken, rateLimiters.upload, upload.array('files', 5), validateFileUpload, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded',
      });
    }

    const {
      category,
      description,
      patientId,
      medicalRecordId,
      isPublic = false,
    } = req.body;

    // Verify patient access if patientId is provided
    if (patientId) {
      const patient = await prisma.patient.findUnique({
        where: { id: patientId },
        select: { id: true, userId: true, facilityId: true },
      });

      if (!patient) {
        return res.status(404).json({
          success: false,
          message: 'Patient not found',
        });
      }

      // Check access to patient
      const hasAccess = req.user?.role === UserRole.SUPER_ADMIN ||
        (req.user?.role === UserRole.PATIENT && req.user.id === patient.userId) ||
        ([UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN].includes(req.user?.role) && req.user?.facilityId === patient.facilityId);

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to patient',
        });
      }
    }

    // Verify medical record if provided
    if (medicalRecordId) {
      const medicalRecord = await prisma.medicalRecord.findUnique({
        where: { id: medicalRecordId },
        select: { id: true, patientId: true },
      });

      if (!medicalRecord) {
        return res.status(404).json({
          success: false,
          message: 'Medical record not found',
        });
      }

      if (patientId && medicalRecord.patientId !== patientId) {
        return res.status(400).json({
          success: false,
          message: 'Medical record does not belong to the specified patient',
        });
      }
    }

    const uploadedFiles = [];

    try {
      for (const file of files) {
        // Upload file using file upload service
        const uploadResult = await fileUploadService.uploadFile({
          file,
          category,
          userId: req.user?.id,
          patientId,
          medicalRecordId,
        });

        // Create file record in database
        const fileRecord = await prisma.fileAttachment.create({
          data: {
            fileName: file.originalname,
            fileType: getFileTypeFromMimeType(file.mimetype),
            fileSize: file.size,
            mimeType: file.mimetype,
            filePath: uploadResult.filePath,
            category,
            description,
            patientId,
            medicalRecordId,
            uploadedBy: req.user?.id,
            isPublic: Boolean(isPublic),
            uploadedAt: new Date(),
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
            medicalRecord: {
              select: {
                id: true,
                recordNumber: true,
                type: true,
                title: true,
              },
            },
          },
        });

        uploadedFiles.push({
          ...fileRecord,
          formattedSize: formatFileSize(fileRecord.fileSize),
          downloadUrl: `/api/v1/files/${fileRecord.id}/download`,
          previewUrl: fileRecord.fileType === FileType.IMAGE ? `/api/v1/files/${fileRecord.id}/preview` : null,
        });

        // Clean up temporary file
        try {
          await fs.unlink(file.path);
        } catch (cleanupError) {
          logger.warn('Failed to clean up temporary file', {
            filePath: file.path,
            error: cleanupError.message,
          });
        }
      }

      // Cache invalidation
      if (patientId) {
        await cacheService.invalidatePatientCache(patientId);
      }

      // Log audit event
      await auditService.log({
        action: 'FILES_UPLOADED',
        userId: req.user?.id,
        resourceType: 'FileAttachment',
        resourceId: uploadedFiles.map(f => f.id).join(','),
        details: {
          fileCount: uploadedFiles.length,
          category,
          patientId,
          medicalRecordId,
          fileNames: uploadedFiles.map(f => f.fileName),
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      logger.info('Files uploaded successfully', {
        fileCount: uploadedFiles.length,
        uploadedBy: req.user?.id,
        category,
        patientId,
        medicalRecordId,
      });

      const response: FileResponse = {
        success: true,
        message: `${uploadedFiles.length} file(s) uploaded successfully`,
        data: { files: uploadedFiles },
      };

      res.status(201).json(response);
    } catch (uploadError) {
      // Clean up temporary files on error
      for (const file of files) {
        try {
          await fs.unlink(file.path);
        } catch (cleanupError) {
          logger.warn('Failed to clean up temporary file after error', {
            filePath: file.path,
            error: cleanupError.message,
          });
        }
      }
      throw uploadError;
    }
  } catch (error) {
    logger.error('Upload files error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during file upload',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/files/:id/download
 * @desc    Download file
 * @access  Private
 */
router.get('/:id/download', authenticateToken, [param('id').isUUID().withMessage('Invalid file ID')], async (req: AuthRequest, res: Response) => {
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

    const file = await prisma.fileAttachment.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            userId: true,
            facilityId: true,
          },
        },
      },
    });

    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found',
      });
    }

    // Check access permissions
    const hasAccess = await canAccessFile(req.user, file);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to file',
      });
    }

    // Check if file exists on disk
    try {
      await fs.access(file.filePath);
    } catch (fileError) {
      logger.error('File not found on disk', {
        fileId: id,
        filePath: file.filePath,
        error: fileError.message,
      });
      return res.status(404).json({
        success: false,
        message: 'File not found on server',
      });
    }

    // Log download event
    await auditService.log({
      action: 'FILE_DOWNLOADED',
      userId: req.user?.id,
      resourceType: 'FileAttachment',
      resourceId: id,
      details: {
        fileName: file.fileName,
        fileSize: file.fileSize,
        patientId: file.patientId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    // Set appropriate headers
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Content-Length', file.fileSize.toString());

    // Stream the file
    res.sendFile(path.resolve(file.filePath));
  } catch (error) {
    logger.error('Download file error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      fileId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during file download',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/files/:id/preview
 * @desc    Preview file (for images)
 * @access  Private
 */
router.get('/:id/preview', authenticateToken, [param('id').isUUID().withMessage('Invalid file ID')], async (req: AuthRequest, res: Response) => {
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

    const file = await prisma.fileAttachment.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            userId: true,
            facilityId: true,
          },
        },
      },
    });

    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found',
      });
    }

    // Check if file is an image
    if (file.fileType !== FileType.IMAGE) {
      return res.status(400).json({
        success: false,
        message: 'File is not previewable',
      });
    }

    // Check access permissions
    const hasAccess = await canAccessFile(req.user, file);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to file',
      });
    }

    // Check if file exists on disk
    try {
      await fs.access(file.filePath);
    } catch (fileError) {
      logger.error('File not found on disk', {
        fileId: id,
        filePath: file.filePath,
        error: fileError.message,
      });
      return res.status(404).json({
        success: false,
        message: 'File not found on server',
      });
    }

    // Set appropriate headers for image preview
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

    // Stream the file
    res.sendFile(path.resolve(file.filePath));
  } catch (error) {
    logger.error('Preview file error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      fileId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during file preview',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   PUT /api/v1/files/:id
 * @desc    Update file metadata
 * @access  Private
 */
router.put('/:id', authenticateToken, [
  param('id').isUUID().withMessage('Invalid file ID'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description must not exceed 500 characters'),
  body('category')
    .optional()
    .isIn(['MEDICAL_RECORD', 'PATIENT_DOCUMENT', 'INSURANCE', 'IDENTIFICATION', 'LAB_RESULT', 'PRESCRIPTION', 'OTHER'])
    .withMessage('Invalid file category'),
  body('isPublic')
    .optional()
    .isBoolean()
    .withMessage('isPublic must be a boolean'),
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

    // Find existing file
    const existingFile = await prisma.fileAttachment.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            userId: true,
            facilityId: true,
          },
        },
      },
    });

    if (!existingFile) {
      return res.status(404).json({
        success: false,
        message: 'File not found',
      });
    }

    // Check access permissions
    const hasAccess = await canAccessFile(req.user, existingFile);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to file',
      });
    }

    // Only file owner or admin can update
    if (req.user?.role !== UserRole.ADMIN && req.user?.role !== UserRole.SUPER_ADMIN) {
      if (existingFile.uploadedBy !== req.user?.id) {
        return res.status(403).json({
          success: false,
          message: 'Only the file owner can update this file',
        });
      }
    }

    // Prepare update data
    const allowedUpdates: any = {};
    const allowedFields = ['description', 'category', 'isPublic'];

    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        allowedUpdates[field] = updateData[field];
      }
    }

    allowedUpdates.updatedAt = new Date();

    // Update file
    const updatedFile = await prisma.fileAttachment.update({
      where: { id },
      data: allowedUpdates,
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
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
        uploadedByUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    // Cache invalidation
    if (existingFile.patientId) {
      await cacheService.invalidatePatientCache(existingFile.patientId);
    }

    // Log audit event
    await auditService.log({
      action: 'FILE_UPDATED',
      userId: req.user?.id,
      resourceType: 'FileAttachment',
      resourceId: id,
      details: {
        fileName: existingFile.fileName,
        updatedFields: Object.keys(allowedUpdates),
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('File updated successfully', {
      fileId: id,
      updatedBy: req.user?.id,
      updatedFields: Object.keys(allowedUpdates),
    });

    const formattedFile = {
      ...updatedFile,
      formattedSize: formatFileSize(updatedFile.fileSize),
      downloadUrl: `/api/v1/files/${updatedFile.id}/download`,
      previewUrl: updatedFile.fileType === FileType.IMAGE ? `/api/v1/files/${updatedFile.id}/preview` : null,
    };

    const response: FileResponse = {
      success: true,
      message: 'File updated successfully',
      data: { file: formattedFile },
    };

    res.json(response);
  } catch (error) {
    logger.error('Update file error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      fileId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during file update',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   DELETE /api/v1/files/:id
 * @desc    Delete file
 * @access  Private
 */
router.delete('/:id', authenticateToken, [param('id').isUUID().withMessage('Invalid file ID')], async (req: AuthRequest, res: Response) => {
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

    // Find existing file
    const existingFile = await prisma.fileAttachment.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            userId: true,
            facilityId: true,
          },
        },
      },
    });

    if (!existingFile) {
      return res.status(404).json({
        success: false,
        message: 'File not found',
      });
    }

    // Check access permissions
    const hasAccess = await canAccessFile(req.user, existingFile);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to file',
      });
    }

    // Only file owner or admin can delete
    if (req.user?.role !== UserRole.ADMIN && req.user?.role !== UserRole.SUPER_ADMIN) {
      if (existingFile.uploadedBy !== req.user?.id) {
        return res.status(403).json({
          success: false,
          message: 'Only the file owner can delete this file',
        });
      }
    }

    // Delete file from database
    await prisma.fileAttachment.delete({
      where: { id },
    });

    // Delete file from storage
    try {
      await fileUploadService.deleteFile(existingFile.filePath);
    } catch (deleteError) {
      logger.warn('Failed to delete file from storage', {
        fileId: id,
        filePath: existingFile.filePath,
        error: deleteError.message,
      });
    }

    // Cache invalidation
    if (existingFile.patientId) {
      await cacheService.invalidatePatientCache(existingFile.patientId);
    }

    // Log audit event
    await auditService.log({
      action: 'FILE_DELETED',
      userId: req.user?.id,
      resourceType: 'FileAttachment',
      resourceId: id,
      details: {
        fileName: existingFile.fileName,
        fileSize: existingFile.fileSize,
        patientId: existingFile.patientId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('File deleted successfully', {
      fileId: id,
      fileName: existingFile.fileName,
      deletedBy: req.user?.id,
    });

    const response: FileResponse = {
      success: true,
      message: 'File deleted successfully',
    };

    res.json(response);
  } catch (error) {
    logger.error('Delete file error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      fileId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during file deletion',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/files/stats
 * @desc    Get file statistics
 * @access  Private (Healthcare providers)
 */
router.get('/stats', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.SUPER_ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
    const facilityFilter = req.user?.role !== UserRole.SUPER_ADMIN && req.user?.facilityId
      ? { patient: { facilityId: req.user.facilityId } }
      : {};

    const [totalFiles, filesByType, filesByCategory, totalSize, recentFiles] = await Promise.all([
      prisma.fileAttachment.count({ where: facilityFilter }),
      prisma.fileAttachment.groupBy({
        by: ['fileType'],
        where: facilityFilter,
        _count: {
          id: true,
        },
        _sum: {
          fileSize: true,
        },
      }),
      prisma.fileAttachment.groupBy({
        by: ['category'],
        where: facilityFilter,
        _count: {
          id: true,
        },
      }),
      prisma.fileAttachment.aggregate({
        where: facilityFilter,
        _sum: {
          fileSize: true,
        },
      }),
      prisma.fileAttachment.count({
        where: {
          ...facilityFilter,
          uploadedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
      }),
    ]);

    const typeStats = filesByType.reduce((acc, item) => {
      acc[item.fileType] = {
        count: item._count.id,
        size: item._sum.fileSize || 0,
        formattedSize: formatFileSize(item._sum.fileSize || 0),
      };
      return acc;
    }, {} as Record<string, any>);

    const categoryStats = filesByCategory.reduce((acc, item) => {
      acc[item.category] = item._count.id;
      return acc;
    }, {} as Record<string, number>);

    const stats = {
      totalFiles,
      filesByType: typeStats,
      filesByCategory: categoryStats,
      totalSize: totalSize._sum.fileSize || 0,
      formattedTotalSize: formatFileSize(totalSize._sum.fileSize || 0),
      recentFiles,
    };

    const response: FileResponse = {
      success: true,
      message: 'File statistics retrieved successfully',
      data: { stats },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get file stats error', {
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