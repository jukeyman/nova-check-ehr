/**
 * ============================================================================
 * NOVA CHECK EHR - FILE CONTROLLER
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { PrismaClient, UserRole, FileType, FileStatus } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError, ForbiddenError } from '../middleware/errorHandler';
import logger from '../config/logger';
import { CacheService } from '../config/redis';
import { asyncHandler } from '../middleware/errorHandler';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import config from '../config/config';
import { sendEmail } from '../services/emailService';
import { scanFileForVirus } from '../services/securityService';
import { extractTextFromPDF, extractTextFromImage } from '../services/ocrService';
import { classifyMedicalDocument } from '../services/aiService';
import { uploadToS3, deleteFromS3, generatePresignedUrl } from '../services/storageService';

const prisma = new PrismaClient();
const cacheService = new CacheService();

// File upload configuration
const storage = multer.memoryStorage();

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
    'text/plain',
    'application/dicom',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ValidationError(`File type ${file.mimetype} is not allowed`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 10, // Maximum 10 files per request
  },
});

/**
 * Upload files middleware
 */
export const uploadFiles = upload.array('files', 10);

/**
 * Upload single file middleware
 */
export const uploadSingleFile = upload.single('file');

/**
 * Process and store uploaded files
 */
export const processFileUpload = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const files = req.files as Express.Multer.File[];
  const {
    patientId,
    encounterId,
    category,
    description,
    isConfidential = false,
  } = req.body;

  const user = req.user!;

  if (!files || files.length === 0) {
    throw new ValidationError('No files uploaded');
  }

  // Verify patient access if patientId provided
  if (patientId) {
    if (user.role === UserRole.PATIENT && user.patientId !== patientId) {
      throw new ForbiddenError('Access denied to patient records');
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
  }

  // Verify encounter access if encounterId provided
  if (encounterId) {
    const encounter = await prisma.encounter.findUnique({
      where: { id: encounterId },
    });

    if (!encounter) {
      throw new NotFoundError('Encounter not found');
    }

    if (user.role === UserRole.PROVIDER && user.providerId !== encounter.providerId) {
      throw new ForbiddenError('Access denied to encounter');
    }
  }

  const uploadedFiles = [];
  const errors = [];

  for (const file of files) {
    try {
      // Generate unique filename
      const fileExtension = path.extname(file.originalname);
      const uniqueFilename = `${uuidv4()}${fileExtension}`;
      const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

      // Check for duplicate files
      const existingFile = await prisma.file.findFirst({
        where: {
          hash: fileHash,
          patientId: patientId || null,
        },
      });

      if (existingFile) {
        errors.push({
          filename: file.originalname,
          error: 'File already exists',
        });
        continue;
      }

      // Virus scan
      const virusScanResult = await scanFileForVirus(file.buffer);
      if (!virusScanResult.isClean) {
        errors.push({
          filename: file.originalname,
          error: 'File failed virus scan',
        });
        continue;
      }

      // Determine file type
      let fileType: FileType = FileType.DOCUMENT;
      if (file.mimetype.startsWith('image/')) {
        fileType = FileType.IMAGE;
      } else if (file.mimetype === 'application/dicom') {
        fileType = FileType.DICOM;
      } else if (file.mimetype === 'application/pdf') {
        fileType = FileType.PDF;
      }

      // Process image files
      let processedBuffer = file.buffer;
      let thumbnailBuffer: Buffer | null = null;
      let metadata: any = {};

      if (fileType === FileType.IMAGE) {
        // Get image metadata
        const imageMetadata = await sharp(file.buffer).metadata();
        metadata = {
          width: imageMetadata.width,
          height: imageMetadata.height,
          format: imageMetadata.format,
          colorSpace: imageMetadata.space,
        };

        // Generate thumbnail
        thumbnailBuffer = await sharp(file.buffer)
          .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();

        // Optimize image if large
        if (file.buffer.length > 2 * 1024 * 1024) { // 2MB
          processedBuffer = await sharp(file.buffer)
            .jpeg({ quality: 85, progressive: true })
            .toBuffer();
        }
      }

      // Extract text content for searchability
      let extractedText = '';
      try {
        if (fileType === FileType.PDF) {
          extractedText = await extractTextFromPDF(file.buffer);
        } else if (fileType === FileType.IMAGE) {
          extractedText = await extractTextFromImage(file.buffer);
        }
      } catch (error) {
        logger.warn('Failed to extract text from file', {
          filename: file.originalname,
          error: error.message,
        });
      }

      // Classify medical document using AI
      let documentCategory = category;
      if (!documentCategory && extractedText) {
        try {
          documentCategory = await classifyMedicalDocument(extractedText);
        } catch (error) {
          logger.warn('Failed to classify document', {
            filename: file.originalname,
            error: error.message,
          });
        }
      }

      // Upload to storage
      let storageUrl: string;
      let thumbnailUrl: string | null = null;

      if (config.storage.provider === 'aws') {
        storageUrl = await uploadToS3(processedBuffer, uniqueFilename, file.mimetype);
        if (thumbnailBuffer) {
          const thumbnailFilename = `thumb_${uniqueFilename}`;
          thumbnailUrl = await uploadToS3(thumbnailBuffer, thumbnailFilename, 'image/jpeg');
        }
      } else {
        // Local storage
        const uploadDir = path.join(process.cwd(), 'uploads');
        const patientDir = path.join(uploadDir, patientId || 'general');
        
        // Ensure directory exists
        await fs.mkdir(patientDir, { recursive: true });
        
        const filePath = path.join(patientDir, uniqueFilename);
        await fs.writeFile(filePath, processedBuffer);
        storageUrl = `/uploads/${patientId || 'general'}/${uniqueFilename}`;

        if (thumbnailBuffer) {
          const thumbnailFilename = `thumb_${uniqueFilename}`;
          const thumbnailPath = path.join(patientDir, thumbnailFilename);
          await fs.writeFile(thumbnailPath, thumbnailBuffer);
          thumbnailUrl = `/uploads/${patientId || 'general'}/${thumbnailFilename}`;
        }
      }

      // Create file record
      const fileRecord = await prisma.file.create({
        data: {
          filename: uniqueFilename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: processedBuffer.length,
          hash: fileHash,
          storageUrl,
          thumbnailUrl,
          type: fileType,
          category: documentCategory,
          description,
          extractedText,
          metadata,
          isConfidential,
          status: FileStatus.ACTIVE,
          patientId: patientId || null,
          encounterId: encounterId || null,
          uploadedBy: user.id,
          uploadedAt: new Date(),
        },
      });

      uploadedFiles.push(fileRecord);

      // Log file upload
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'FILE_UPLOAD',
          resource: 'File',
          resourceId: fileRecord.id,
          details: {
            filename: file.originalname,
            fileType,
            size: file.size,
            patientId,
            encounterId,
            category: documentCategory,
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent') || 'Unknown',
        },
      });

    } catch (error) {
      logger.error('Failed to process file upload', {
        filename: file.originalname,
        error: error.message,
        userId: user.id,
      });

      errors.push({
        filename: file.originalname,
        error: error.message,
      });
    }
  }

  logger.info('File upload completed', {
    uploadedCount: uploadedFiles.length,
    errorCount: errors.length,
    userId: user.id,
    patientId,
  });

  res.status(201).json({
    success: true,
    message: `${uploadedFiles.length} files uploaded successfully`,
    data: {
      uploadedFiles,
      errors: errors.length > 0 ? errors : undefined,
    },
  });
});

/**
 * Get files with filtering
 */
export const getFiles = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    page = 1,
    limit = 20,
    patientId,
    encounterId,
    type,
    category,
    search,
    startDate,
    endDate,
    sortBy = 'uploadedAt',
    sortOrder = 'desc',
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  const user = req.user!;

  // Build where clause with role-based filtering
  const where: any = {
    status: FileStatus.ACTIVE,
  };

  // Role-based access control
  if (user.role === UserRole.PATIENT && user.patientId) {
    where.patientId = user.patientId;
  } else if (user.role === UserRole.PROVIDER && user.providerId) {
    // Provider can see files for patients they have access to
    const accessiblePatients = await prisma.careTeamMember.findMany({
      where: { providerId: user.providerId },
      select: { patientId: true },
    });
    const patientIds = accessiblePatients.map(member => member.patientId);
    where.OR = [
      { patientId: { in: patientIds } },
      { patientId: null }, // General files
    ];
  }

  // Additional filters
  if (patientId) {
    // Verify access to specific patient
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
        throw new ForbiddenError('Access denied to patient files');
      }
    }
    where.patientId = patientId;
  }

  if (encounterId) {
    where.encounterId = encounterId;
  }

  if (type) {
    where.type = type;
  }

  if (category) {
    where.category = category;
  }

  if (search) {
    where.OR = [
      { originalName: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { extractedText: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Date range filter
  if (startDate || endDate) {
    where.uploadedAt = {};
    if (startDate) {
      where.uploadedAt.gte = new Date(startDate as string);
    }
    if (endDate) {
      where.uploadedAt.lte = new Date(endDate as string);
    }
  }

  // Build order by
  const orderBy: any = {};
  orderBy[sortBy as string] = sortOrder;

  const [files, total] = await Promise.all([
    prisma.file.findMany({
      where,
      include: {
        uploadedByUser: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        patient: {
          select: {
            patientId: true,
            firstName: true,
            lastName: true,
          },
        },
        encounter: {
          select: {
            id: true,
            type: true,
            startTime: true,
          },
        },
      },
      orderBy,
      skip: offset,
      take: Number(limit),
    }),
    prisma.file.count({ where }),
  ]);

  const totalPages = Math.ceil(total / Number(limit));

  res.json({
    success: true,
    data: {
      files,
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
 * Get file by ID
 */
export const getFileById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  const file = await prisma.file.findUnique({
    where: { id },
    include: {
      uploadedByUser: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      patient: {
        select: {
          patientId: true,
          firstName: true,
          lastName: true,
        },
      },
      encounter: {
        select: {
          id: true,
          type: true,
          startTime: true,
        },
      },
    },
  });

  if (!file) {
    throw new NotFoundError('File not found');
  }

  // Check access permissions
  if (file.patientId) {
    if (user.role === UserRole.PATIENT && user.patientId !== file.patientId) {
      throw new ForbiddenError('Access denied');
    }

    if (user.role === UserRole.PROVIDER && user.providerId) {
      const hasAccess = await prisma.careTeamMember.findFirst({
        where: {
          patientId: file.patientId,
          providerId: user.providerId,
        },
      });
      if (!hasAccess) {
        throw new ForbiddenError('Access denied');
      }
    }
  }

  // Log file access
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'FILE_VIEW',
      resource: 'File',
      resourceId: id,
      details: {
        filename: file.originalName,
        patientId: file.patientId,
        fileType: file.type,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  res.json({
    success: true,
    data: { file },
  });
});

/**
 * Download file
 */
export const downloadFile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  const file = await prisma.file.findUnique({
    where: { id },
  });

  if (!file) {
    throw new NotFoundError('File not found');
  }

  // Check access permissions
  if (file.patientId) {
    if (user.role === UserRole.PATIENT && user.patientId !== file.patientId) {
      throw new ForbiddenError('Access denied');
    }

    if (user.role === UserRole.PROVIDER && user.providerId) {
      const hasAccess = await prisma.careTeamMember.findFirst({
        where: {
          patientId: file.patientId,
          providerId: user.providerId,
        },
      });
      if (!hasAccess) {
        throw new ForbiddenError('Access denied');
      }
    }
  }

  try {
    if (config.storage.provider === 'aws') {
      // Generate presigned URL for S3
      const downloadUrl = await generatePresignedUrl(file.storageUrl, 3600); // 1 hour expiry
      
      // Log file download
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'FILE_DOWNLOAD',
          resource: 'File',
          resourceId: id,
          details: {
            filename: file.originalName,
            patientId: file.patientId,
            fileType: file.type,
            downloadMethod: 'presigned_url',
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent') || 'Unknown',
        },
      });

      res.json({
        success: true,
        data: {
          downloadUrl,
          filename: file.originalName,
          expiresIn: 3600,
        },
      });
    } else {
      // Local storage - stream file
      const filePath = path.join(process.cwd(), file.storageUrl);
      
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        throw new NotFoundError('File not found on storage');
      }

      // Set headers
      res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', file.size);

      // Stream file
      const fileBuffer = await fs.readFile(filePath);
      
      // Log file download
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'FILE_DOWNLOAD',
          resource: 'File',
          resourceId: id,
          details: {
            filename: file.originalName,
            patientId: file.patientId,
            fileType: file.type,
            downloadMethod: 'direct_stream',
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent') || 'Unknown',
        },
      });

      res.send(fileBuffer);
    }
  } catch (error) {
    logger.error('Failed to download file', {
      fileId: id,
      error: error.message,
      userId: user.id,
    });
    throw new AppError('Failed to download file', 500);
  }
});

/**
 * Update file metadata
 */
export const updateFile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const {
    description,
    category,
    isConfidential,
  } = req.body;

  const user = req.user!;

  const existingFile = await prisma.file.findUnique({
    where: { id },
  });

  if (!existingFile) {
    throw new NotFoundError('File not found');
  }

  // Check permissions - only uploader or admin can update
  if (existingFile.uploadedBy !== user.id && user.role !== UserRole.ADMIN) {
    throw new ForbiddenError('Access denied');
  }

  const updatedFile = await prisma.file.update({
    where: { id },
    data: {
      description,
      category,
      isConfidential,
      updatedAt: new Date(),
    },
  });

  // Log file update
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'FILE_UPDATE',
      resource: 'File',
      resourceId: id,
      details: {
        filename: existingFile.originalName,
        updatedFields: Object.keys(req.body),
        patientId: existingFile.patientId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('File updated successfully', {
    fileId: id,
    updatedBy: user.id,
    updatedFields: Object.keys(req.body),
  });

  res.json({
    success: true,
    message: 'File updated successfully',
    data: { file: updatedFile },
  });
});

/**
 * Delete file
 */
export const deleteFile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  const file = await prisma.file.findUnique({
    where: { id },
  });

  if (!file) {
    throw new NotFoundError('File not found');
  }

  // Check permissions - only uploader or admin can delete
  if (file.uploadedBy !== user.id && user.role !== UserRole.ADMIN) {
    throw new ForbiddenError('Access denied');
  }

  // Soft delete file record
  await prisma.file.update({
    where: { id },
    data: {
      status: FileStatus.DELETED,
      deletedAt: new Date(),
      deletedBy: user.id,
    },
  });

  // Delete from storage (optional - can be done by background job)
  try {
    if (config.storage.provider === 'aws') {
      await deleteFromS3(file.storageUrl);
      if (file.thumbnailUrl) {
        await deleteFromS3(file.thumbnailUrl);
      }
    } else {
      // Local storage
      const filePath = path.join(process.cwd(), file.storageUrl);
      await fs.unlink(filePath).catch(() => {}); // Ignore errors
      
      if (file.thumbnailUrl) {
        const thumbnailPath = path.join(process.cwd(), file.thumbnailUrl);
        await fs.unlink(thumbnailPath).catch(() => {}); // Ignore errors
      }
    }
  } catch (error) {
    logger.warn('Failed to delete file from storage', {
      fileId: id,
      storageUrl: file.storageUrl,
      error: error.message,
    });
  }

  // Log file deletion
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'FILE_DELETE',
      resource: 'File',
      resourceId: id,
      details: {
        filename: file.originalName,
        patientId: file.patientId,
        fileType: file.type,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('File deleted successfully', {
    fileId: id,
    filename: file.originalName,
    deletedBy: user.id,
  });

  res.json({
    success: true,
    message: 'File deleted successfully',
  });
});

/**
 * Get file categories
 */
export const getFileCategories = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const categories = [
    'Lab Results',
    'Imaging',
    'Prescription',
    'Insurance',
    'Consent Form',
    'Medical History',
    'Discharge Summary',
    'Referral',
    'Progress Note',
    'Operative Report',
    'Pathology Report',
    'Radiology Report',
    'Other',
  ];

  res.json({
    success: true,
    data: { categories },
  });
});

/**
 * Get file statistics
 */
export const getFileStats = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { patientId, startDate, endDate } = req.query;
  const user = req.user!;

  // Build base where clause
  const baseWhere: any = {
    status: FileStatus.ACTIVE,
  };

  // Role-based filtering
  if (user.role === UserRole.PATIENT && user.patientId) {
    baseWhere.patientId = user.patientId;
  } else if (user.role === UserRole.PROVIDER && user.providerId) {
    const accessiblePatients = await prisma.careTeamMember.findMany({
      where: { providerId: user.providerId },
      select: { patientId: true },
    });
    const patientIds = accessiblePatients.map(member => member.patientId);
    baseWhere.OR = [
      { patientId: { in: patientIds } },
      { patientId: null },
    ];
  }

  if (patientId) {
    baseWhere.patientId = patientId;
  }

  // Date range filter
  if (startDate || endDate) {
    baseWhere.uploadedAt = {};
    if (startDate) {
      baseWhere.uploadedAt.gte = new Date(startDate as string);
    }
    if (endDate) {
      baseWhere.uploadedAt.lte = new Date(endDate as string);
    }
  }

  const [totalFiles, filesByType, filesByCategory, totalSize] = await Promise.all([
    prisma.file.count({ where: baseWhere }),
    prisma.file.groupBy({
      by: ['type'],
      where: baseWhere,
      _count: true,
      _sum: { size: true },
    }),
    prisma.file.groupBy({
      by: ['category'],
      where: baseWhere,
      _count: true,
    }),
    prisma.file.aggregate({
      where: baseWhere,
      _sum: { size: true },
    }),
  ]);

  const stats = {
    totalFiles,
    totalSize: totalSize._sum.size || 0,
    filesByType: filesByType.map(group => ({
      type: group.type,
      count: group._count,
      totalSize: group._sum.size || 0,
    })),
    filesByCategory: filesByCategory.map(group => ({
      category: group.category,
      count: group._count,
    })),
  };

  res.json({
    success: true,
    data: { stats },
  });
});