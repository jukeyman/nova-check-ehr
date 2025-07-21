/**
 * ============================================================================
 * NOVA CHECK EHR - FILE ROUTES
 * ============================================================================
 * 
 * RESTful API routes for file management.
 * Handles file uploads, downloads, metadata, and storage operations.
 */

import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import multer from 'multer';
import { FileModel, createApiResponse, createErrorResponse, validatePagination } from '../models';
import { authenticateToken, requireRole } from '../middleware/auth';
import { createAuditMiddleware } from '../models/Audit';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs/promises';

// ============================================================================
// ROUTER SETUP
// ============================================================================

const router = Router();
const prisma = new PrismaClient();
const fileModel = new FileModel(prisma);
const auditMiddleware = createAuditMiddleware(prisma);

// ============================================================================
// MULTER CONFIGURATION
// ============================================================================

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 10, // Maximum 10 files per request
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedMimes = [
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
      'application/json',
      'application/xml',
      'text/xml',
      'application/dicom',
      'application/zip',
      'application/x-zip-compressed',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

// ============================================================================
// VALIDATION RULES
// ============================================================================

const uploadValidation = [
  body('patientId').optional().isUUID(),
  body('encounterId').optional().isUUID(),
  body('category').isIn(['MEDICAL_RECORD', 'LAB_RESULT', 'IMAGING', 'INSURANCE', 'CONSENT', 'REFERRAL', 'OTHER']),
  body('description').optional().trim().isLength({ max: 500 }),
  body('tags').optional().isArray(),
  body('tags.*').optional().trim().isLength({ min: 1, max: 50 }),
  body('isConfidential').optional().isBoolean(),
  body('expiresAt').optional().isISO8601().toDate(),
];

const updateMetadataValidation = [
  param('id').isUUID(),
  body('filename').optional().trim().isLength({ min: 1, max: 255 }),
  body('category').optional().isIn(['MEDICAL_RECORD', 'LAB_RESULT', 'IMAGING', 'INSURANCE', 'CONSENT', 'REFERRAL', 'OTHER']),
  body('description').optional().trim().isLength({ max: 500 }),
  body('tags').optional().isArray(),
  body('tags.*').optional().trim().isLength({ min: 1, max: 50 }),
  body('isConfidential').optional().isBoolean(),
  body('expiresAt').optional().isISO8601().toDate(),
];

const searchValidation = [
  query('search').optional().trim().isLength({ min: 1, max: 200 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sortBy').optional().isIn(['createdAt', 'filename', 'fileSize', 'category']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('patientId').optional().isUUID(),
  query('encounterId').optional().isUUID(),
  query('category').optional().isIn(['MEDICAL_RECORD', 'LAB_RESULT', 'IMAGING', 'INSURANCE', 'CONSENT', 'REFERRAL', 'OTHER']),
  query('mimeType').optional().trim(),
  query('uploadedBy').optional().isUUID(),
  query('isConfidential').optional().isBoolean(),
  query('status').optional().isIn(['ACTIVE', 'ARCHIVED', 'DELETED']),
  query('startDate').optional().isISO8601().toDate(),
  query('endDate').optional().isISO8601().toDate(),
  query('minSize').optional().isInt({ min: 0 }),
  query('maxSize').optional().isInt({ min: 0 }),
  query('tags').optional().trim(),
];

const batchValidation = [
  body('fileIds').isArray({ min: 1, max: 50 }),
  body('fileIds.*').isUUID(),
  body('action').isIn(['DELETE', 'ARCHIVE', 'RESTORE']),
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
 * Check if file exists and user has access
 */
const checkFileAccess = async (req: Request, res: Response, next: any) => {
  try {
    const { id } = req.params;
    const file = await fileModel.findById(id);
    
    if (!file) {
      return res.status(404).json(
        createErrorResponse('File not found')
      );
    }

    // Check if file is deleted
    if (file.status === 'DELETED') {
      return res.status(410).json(
        createErrorResponse('File has been deleted')
      );
    }

    // Store file in request for use in route handlers
    (req as any).file = file;
    next();
  } catch (error) {
    logger.error('Error checking file access:', error);
    res.status(500).json(
      createErrorResponse('Internal server error')
    );
  }
};

/**
 * Handle multer errors
 */
const handleMulterError = (error: any, req: Request, res: Response, next: any) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json(
        createErrorResponse('File too large. Maximum size is 50MB.')
      );
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json(
        createErrorResponse('Too many files. Maximum is 10 files per request.')
      );
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json(
        createErrorResponse('Unexpected file field.')
      );
    }
  }
  
  if (error.message && error.message.includes('File type')) {
    return res.status(400).json(
      createErrorResponse(error.message)
    );
  }
  
  next(error);
};

// ============================================================================
// FILE UPLOAD ROUTES
// ============================================================================

/**
 * @route   POST /api/files/upload
 * @desc    Upload single file
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/upload',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  upload.single('file'),
  handleMulterError,
  uploadValidation,
  handleValidation,
  auditMiddleware('FILE_UPLOAD'),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json(
          createErrorResponse('No file provided')
        );
      }

      const metadata = {
        patientId: req.body.patientId,
        encounterId: req.body.encounterId,
        category: req.body.category,
        description: req.body.description,
        tags: req.body.tags ? JSON.parse(req.body.tags) : [],
        isConfidential: req.body.isConfidential === 'true',
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
      };

      const uploadedBy = (req as any).user.id;

      const result = await fileModel.uploadFile(
        file.buffer,
        file.originalname,
        file.mimetype,
        uploadedBy,
        metadata
      );

      logger.info(`File uploaded: ${result.file.id}`, {
        fileId: result.file.id,
        filename: result.file.filename,
        fileSize: result.file.fileSize,
        category: result.file.category,
        uploadedBy,
      });

      res.status(201).json(
        createApiResponse(result, true, 'File uploaded successfully')
      );
    } catch (error) {
      logger.error('Error uploading file:', error);
      res.status(500).json(
        createErrorResponse('Failed to upload file')
      );
    }
  }
);

/**
 * @route   POST /api/files/upload/multiple
 * @desc    Upload multiple files
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/upload/multiple',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  upload.array('files', 10),
  handleMulterError,
  uploadValidation,
  handleValidation,
  auditMiddleware('FILE_UPLOAD_MULTIPLE'),
  async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json(
          createErrorResponse('No files provided')
        );
      }

      const metadata = {
        patientId: req.body.patientId,
        encounterId: req.body.encounterId,
        category: req.body.category,
        description: req.body.description,
        tags: req.body.tags ? JSON.parse(req.body.tags) : [],
        isConfidential: req.body.isConfidential === 'true',
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
      };

      const uploadedBy = (req as any).user.id;
      const results = [];
      const errors = [];

      for (const file of files) {
        try {
          const result = await fileModel.uploadFile(
            file.buffer,
            file.originalname,
            file.mimetype,
            uploadedBy,
            metadata
          );
          results.push(result);
        } catch (error) {
          logger.error(`Error uploading file ${file.originalname}:`, error);
          errors.push({
            filename: file.originalname,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      logger.info(`Multiple files uploaded: ${results.length} successful, ${errors.length} failed`, {
        successful: results.length,
        failed: errors.length,
        uploadedBy,
      });

      res.status(201).json(
        createApiResponse(
          { successful: results, failed: errors },
          true,
          `${results.length} files uploaded successfully${errors.length > 0 ? `, ${errors.length} failed` : ''}`
        )
      );
    } catch (error) {
      logger.error('Error uploading multiple files:', error);
      res.status(500).json(
        createErrorResponse('Failed to upload files')
      );
    }
  }
);

// ============================================================================
// FILE RETRIEVAL ROUTES
// ============================================================================

/**
 * @route   GET /api/files
 * @desc    Get files with search and pagination
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  searchValidation,
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const pagination = validatePagination({
        page: req.query.page as any,
        limit: req.query.limit as any,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc',
      });

      const filters = {
        search: req.query.search as string,
        patientId: req.query.patientId as string,
        encounterId: req.query.encounterId as string,
        category: req.query.category as any,
        mimeType: req.query.mimeType as string,
        uploadedBy: req.query.uploadedBy as string,
        isConfidential: req.query.isConfidential as any,
        status: req.query.status as any,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        minSize: req.query.minSize as any,
        maxSize: req.query.maxSize as any,
        tags: req.query.tags as string,
      };

      // Remove undefined values
      Object.keys(filters).forEach(key => {
        if (filters[key as keyof typeof filters] === undefined) {
          delete filters[key as keyof typeof filters];
        }
      });

      const result = await fileModel.findMany(filters, pagination);

      res.json(
        createApiResponse(result.data, true, undefined, result.pagination)
      );
    } catch (error) {
      logger.error('Error fetching files:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch files')
      );
    }
  }
);

/**
 * @route   GET /api/files/:id
 * @desc    Get file metadata by ID
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('id').isUUID()],
  handleValidation,
  checkFileAccess,
  auditMiddleware('FILE_VIEW'),
  async (req: Request, res: Response) => {
    try {
      const file = (req as any).file;

      res.json(
        createApiResponse(file, true, 'File metadata retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching file metadata:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch file metadata')
      );
    }
  }
);

/**
 * @route   GET /api/files/:id/download
 * @desc    Download file
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/:id/download',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('id').isUUID()],
  handleValidation,
  checkFileAccess,
  auditMiddleware('FILE_DOWNLOAD'),
  async (req: Request, res: Response) => {
    try {
      const file = (req as any).file;
      const buffer = await fileModel.getFileBuffer(file.id);

      // Set appropriate headers
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.setHeader('Cache-Control', 'private, no-cache');

      logger.info(`File downloaded: ${file.id}`, {
        fileId: file.id,
        filename: file.filename,
        downloadedBy: (req as any).user.id,
      });

      res.send(buffer);
    } catch (error) {
      logger.error('Error downloading file:', error);
      res.status(500).json(
        createErrorResponse('Failed to download file')
      );
    }
  }
);

/**
 * @route   GET /api/files/patient/:patientId
 * @desc    Get files for a specific patient
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/patient/:patientId',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [
    param('patientId').isUUID(),
    ...searchValidation,
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const { patientId } = req.params;
      const pagination = validatePagination({
        page: req.query.page as any,
        limit: req.query.limit as any,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc',
      });

      const result = await fileModel.findByPatient(patientId, pagination);

      res.json(
        createApiResponse(result.data, true, undefined, result.pagination)
      );
    } catch (error) {
      logger.error('Error fetching patient files:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch patient files')
      );
    }
  }
);

/**
 * @route   GET /api/files/encounter/:encounterId
 * @desc    Get files for a specific encounter
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/encounter/:encounterId',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [
    param('encounterId').isUUID(),
    ...searchValidation,
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const { encounterId } = req.params;
      const pagination = validatePagination({
        page: req.query.page as any,
        limit: req.query.limit as any,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc',
      });

      const result = await fileModel.findByEncounter(encounterId, pagination);

      res.json(
        createApiResponse(result.data, true, undefined, result.pagination)
      );
    } catch (error) {
      logger.error('Error fetching encounter files:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch encounter files')
      );
    }
  }
);

// ============================================================================
// FILE MANAGEMENT ROUTES
// ============================================================================

/**
 * @route   PUT /api/files/:id/metadata
 * @desc    Update file metadata
 * @access  Private (Admin, Provider, Staff)
 */
router.put('/:id/metadata',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  updateMetadataValidation,
  handleValidation,
  checkFileAccess,
  auditMiddleware('FILE_METADATA_UPDATE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const updatedBy = (req as any).user.id;

      const file = await fileModel.updateMetadata(id, {
        ...updateData,
        updatedBy,
      });

      logger.info(`File metadata updated: ${id}`, {
        fileId: id,
        updatedBy,
      });

      res.json(
        createApiResponse(file, true, 'File metadata updated successfully')
      );
    } catch (error) {
      logger.error('Error updating file metadata:', error);
      res.status(500).json(
        createErrorResponse('Failed to update file metadata')
      );
    }
  }
);

/**
 * @route   DELETE /api/files/:id
 * @desc    Soft delete file
 * @access  Private (Admin, Provider)
 */
router.delete('/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  [param('id').isUUID()],
  handleValidation,
  checkFileAccess,
  auditMiddleware('FILE_DELETE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deletedBy = (req as any).user.id;

      await fileModel.deleteFile(id, deletedBy);

      logger.info(`File deleted: ${id}`, {
        fileId: id,
        deletedBy,
      });

      res.json(
        createApiResponse(null, true, 'File deleted successfully')
      );
    } catch (error) {
      logger.error('Error deleting file:', error);
      res.status(500).json(
        createErrorResponse('Failed to delete file')
      );
    }
  }
);

/**
 * @route   DELETE /api/files/:id/permanent
 * @desc    Permanently delete file
 * @access  Private (Admin only)
 */
router.delete('/:id/permanent',
  authenticateToken,
  requireRole(['ADMIN']),
  [param('id').isUUID()],
  handleValidation,
  checkFileAccess,
  auditMiddleware('FILE_PERMANENT_DELETE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deletedBy = (req as any).user.id;

      await fileModel.permanentlyDeleteFile(id, deletedBy);

      logger.info(`File permanently deleted: ${id}`, {
        fileId: id,
        deletedBy,
      });

      res.json(
        createApiResponse(null, true, 'File permanently deleted successfully')
      );
    } catch (error) {
      logger.error('Error permanently deleting file:', error);
      res.status(500).json(
        createErrorResponse('Failed to permanently delete file')
      );
    }
  }
);

/**
 * @route   POST /api/files/batch
 * @desc    Batch operations on files
 * @access  Private (Admin, Provider)
 */
router.post('/batch',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  batchValidation,
  handleValidation,
  auditMiddleware('FILE_BATCH_OPERATION'),
  async (req: Request, res: Response) => {
    try {
      const { fileIds, action } = req.body;
      const performedBy = (req as any).user.id;
      const results = [];
      const errors = [];

      for (const fileId of fileIds) {
        try {
          switch (action) {
            case 'DELETE':
              await fileModel.deleteFile(fileId, performedBy);
              results.push({ fileId, action: 'deleted' });
              break;
            case 'ARCHIVE':
              await fileModel.updateMetadata(fileId, { status: 'ARCHIVED' });
              results.push({ fileId, action: 'archived' });
              break;
            case 'RESTORE':
              await fileModel.updateMetadata(fileId, { status: 'ACTIVE' });
              results.push({ fileId, action: 'restored' });
              break;
          }
        } catch (error) {
          logger.error(`Error performing ${action} on file ${fileId}:`, error);
          errors.push({
            fileId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      logger.info(`Batch file operation completed: ${action}`, {
        action,
        successful: results.length,
        failed: errors.length,
        performedBy,
      });

      res.json(
        createApiResponse(
          { successful: results, failed: errors },
          true,
          `Batch ${action.toLowerCase()} completed: ${results.length} successful${errors.length > 0 ? `, ${errors.length} failed` : ''}`
        )
      );
    } catch (error) {
      logger.error('Error performing batch file operation:', error);
      res.status(500).json(
        createErrorResponse('Failed to perform batch operation')
      );
    }
  }
);

// ============================================================================
// FILE STATISTICS ROUTES
// ============================================================================

/**
 * @route   GET /api/files/stats
 * @desc    Get file statistics
 * @access  Private (Admin, Provider)
 */
router.get('/stats',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  async (req: Request, res: Response) => {
    try {
      const stats = await fileModel.getStats();

      res.json(
        createApiResponse(stats, true, 'File statistics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching file stats:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch file statistics')
      );
    }
  }
);

/**
 * @route   POST /api/files/cleanup
 * @desc    Clean up expired files
 * @access  Private (Admin only)
 */
router.post('/cleanup',
  authenticateToken,
  requireRole(['ADMIN']),
  auditMiddleware('FILE_CLEANUP'),
  async (req: Request, res: Response) => {
    try {
      const result = await fileModel.cleanupExpiredFiles();

      logger.info('File cleanup completed', {
        deletedCount: result.deletedCount,
        performedBy: (req as any).user.id,
      });

      res.json(
        createApiResponse(result, true, 'File cleanup completed successfully')
      );
    } catch (error) {
      logger.error('Error during file cleanup:', error);
      res.status(500).json(
        createErrorResponse('Failed to cleanup files')
      );
    }
  }
);

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Global error handler for file routes
 */
router.use((error: any, req: Request, res: Response, next: any) => {
  logger.error('File route error:', error);
  
  if (error.code === 'ENOENT') {
    return res.status(404).json(
      createErrorResponse('File not found on disk')
    );
  }
  
  if (error.code === 'EACCES') {
    return res.status(403).json(
      createErrorResponse('File access denied')
    );
  }
  
  if (error.code === 'ENOSPC') {
    return res.status(507).json(
      createErrorResponse('Insufficient storage space')
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