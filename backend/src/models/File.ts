/**
 * ============================================================================
 * NOVA CHECK EHR - FILE MODEL
 * ============================================================================
 */

import { PrismaClient, File as PrismaFile, FileType, FileStatus } from '@prisma/client';
import { logger } from '../utils/logger';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import { generateUniqueId } from '../utils/generators';
import { formatFileSize, getFileExtension, getMimeType, validateFileType } from '../utils/helpers';
import { FileData, FileUploadData } from '../types';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';

// ============================================================================
// INTERFACES
// ============================================================================

export interface FileWithRelations extends PrismaFile {
  uploadedBy?: any;
  patient?: any;
  encounter?: any;
  tags?: any[];
}

export interface FileSearchFilters {
  patientId?: string;
  encounterId?: string;
  uploadedBy?: string;
  fileType?: FileType;
  status?: FileStatus;
  category?: string;
  tags?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  sizeMin?: number;
  sizeMax?: number;
  search?: string;
}

export interface FileStats {
  totalFiles: number;
  totalSize: number;
  filesByType: Record<FileType, number>;
  filesByStatus: Record<FileStatus, number>;
  filesByCategory: Record<string, number>;
  averageFileSize: number;
  recentUploads: number;
  storageUsed: string;
  storageLimit: string;
  storagePercentage: number;
}

export interface FileUploadResult {
  file: FileWithRelations;
  uploadUrl?: string;
  downloadUrl?: string;
}

export interface FileBatch {
  id: string;
  files: FileWithRelations[];
  totalSize: number;
  uploadedAt: Date;
  uploadedBy: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

export interface FileVersion {
  id: string;
  fileId: string;
  version: number;
  fileName: string;
  filePath: string;
  fileSize: number;
  checksum: string;
  uploadedAt: Date;
  uploadedBy: string;
  isActive: boolean;
}

export interface FileShare {
  id: string;
  fileId: string;
  sharedWith: string;
  sharedBy: string;
  permissions: string[];
  expiresAt?: Date;
  accessCount: number;
  lastAccessedAt?: Date;
  isActive: boolean;
}

export interface FileMetadata {
  dimensions?: {
    width: number;
    height: number;
  };
  duration?: number;
  pages?: number;
  author?: string;
  title?: string;
  subject?: string;
  keywords?: string[];
  createdAt?: Date;
  modifiedAt?: Date;
  application?: string;
  compression?: string;
  colorSpace?: string;
  dpi?: number;
}

// ============================================================================
// FILE MODEL CLASS
// ============================================================================

export class FileModel {
  private prisma: PrismaClient;
  private uploadPath: string;
  private maxFileSize: number;
  private allowedTypes: string[];

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.uploadPath = process.env.UPLOAD_PATH || './uploads';
    this.maxFileSize = parseInt(process.env.MAX_FILE_SIZE || '50000000'); // 50MB default
    this.allowedTypes = [
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
      'video/mp4',
      'video/avi',
      'video/quicktime',
      'audio/mpeg',
      'audio/wav',
      'audio/mp4',
    ];
  }

  /**
   * Upload a new file
   */
  async upload(fileData: FileUploadData, buffer: Buffer): Promise<FileUploadResult> {
    try {
      // Validate file data
      if (!fileData.fileName || !fileData.uploadedBy) {
        throw new ValidationError('Missing required fields: fileName, uploadedBy');
      }

      // Validate file size
      if (buffer.length > this.maxFileSize) {
        throw new ValidationError(`File size exceeds maximum allowed size of ${formatFileSize(this.maxFileSize)}`);
      }

      // Validate file type
      const mimeType = getMimeType(fileData.fileName);
      if (!this.allowedTypes.includes(mimeType)) {
        throw new ValidationError(`File type ${mimeType} is not allowed`);
      }

      // Generate file ID and paths
      const fileId = generateUniqueId('FILE');
      const fileExtension = getFileExtension(fileData.fileName);
      const fileName = `${fileId}${fileExtension}`;
      const relativePath = this.generateFilePath(fileName, fileData.category);
      const fullPath = path.join(this.uploadPath, relativePath);

      // Calculate checksum
      const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

      // Check for duplicate files
      const existingFile = await this.prisma.file.findFirst({
        where: {
          checksum,
          isDeleted: false,
        },
      });

      if (existingFile && fileData.allowDuplicates !== true) {
        logger.info('Duplicate file detected', {
          component: 'FileModel',
          existingFileId: existingFile.id,
          checksum,
        });
        
        return {
          file: existingFile as FileWithRelations,
          downloadUrl: this.generateDownloadUrl(existingFile.id),
        };
      }

      // Ensure directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      // Write file to disk
      await fs.writeFile(fullPath, buffer);

      // Extract metadata
      const metadata = await this.extractMetadata(fullPath, mimeType);

      // Create file record
      const file = await this.prisma.file.create({
        data: {
          id: fileId,
          fileId: fileId,
          fileName: fileData.fileName,
          originalName: fileData.originalName || fileData.fileName,
          filePath: relativePath,
          fileSize: buffer.length,
          mimeType,
          fileType: this.determineFileType(mimeType),
          checksum,
          uploadedBy: fileData.uploadedBy,
          patientId: fileData.patientId,
          encounterId: fileData.encounterId,
          category: fileData.category || 'GENERAL',
          description: fileData.description,
          isPublic: fileData.isPublic || false,
          status: FileStatus.ACTIVE,
          metadata: metadata || {},
          tags: fileData.tags || [],
          expiresAt: fileData.expiresAt,
        },
        include: {
          uploadedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
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
              encounterId: true,
              startTime: true,
              type: true,
            },
          },
        },
      });

      logger.info('File uploaded successfully', {
        component: 'FileModel',
        fileId: file.fileId,
        fileName: file.fileName,
        fileSize: file.fileSize,
        uploadedBy: fileData.uploadedBy,
        patientId: fileData.patientId,
      });

      return {
        file,
        downloadUrl: this.generateDownloadUrl(file.id),
      };
    } catch (error) {
      logger.error('Error uploading file', {
        component: 'FileModel',
        error: (error as Error).message,
        fileName: fileData.fileName,
        uploadedBy: fileData.uploadedBy,
      });
      throw error;
    }
  }

  /**
   * Find file by ID
   */
  async findById(id: string, includeRelations: boolean = false): Promise<FileWithRelations | null> {
    try {
      const file = await this.prisma.file.findUnique({
        where: { 
          id,
          isDeleted: false,
        },
        include: includeRelations ? {
          uploadedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
            },
          },
          encounter: {
            select: {
              encounterId: true,
              startTime: true,
              type: true,
            },
          },
        } : undefined,
      });

      return file;
    } catch (error) {
      logger.error('Error finding file by ID', {
        component: 'FileModel',
        error: (error as Error).message,
        fileId: id,
      });
      throw new AppError('Failed to find file', 500);
    }
  }

  /**
   * Get file buffer for download
   */
  async getFileBuffer(id: string): Promise<{ buffer: Buffer; file: FileWithRelations }> {
    try {
      const file = await this.findById(id, true);
      if (!file) {
        throw new NotFoundError('File not found');
      }

      if (file.status !== FileStatus.ACTIVE) {
        throw new AppError('File is not available for download', 400);
      }

      const fullPath = path.join(this.uploadPath, file.filePath);
      
      try {
        const buffer = await fs.readFile(fullPath);
        
        // Update access count and last accessed time
        await this.prisma.file.update({
          where: { id },
          data: {
            accessCount: { increment: 1 },
            lastAccessedAt: new Date(),
          },
        });

        return { buffer, file };
      } catch (fsError) {
        logger.error('File not found on disk', {
          component: 'FileModel',
          fileId: id,
          filePath: fullPath,
          error: (fsError as Error).message,
        });
        
        // Mark file as missing
        await this.prisma.file.update({
          where: { id },
          data: {
            status: FileStatus.MISSING,
            updatedAt: new Date(),
          },
        });
        
        throw new NotFoundError('File not found on storage');
      }
    } catch (error) {
      logger.error('Error getting file buffer', {
        component: 'FileModel',
        error: (error as Error).message,
        fileId: id,
      });
      throw error;
    }
  }

  /**
   * Update file metadata
   */
  async update(id: string, updateData: Partial<FileData>): Promise<FileWithRelations> {
    try {
      const existingFile = await this.findById(id);
      if (!existingFile) {
        throw new NotFoundError('File not found');
      }

      const updatedFile = await this.prisma.file.update({
        where: { id },
        data: {
          fileName: updateData.fileName,
          description: updateData.description,
          category: updateData.category,
          tags: updateData.tags,
          isPublic: updateData.isPublic,
          expiresAt: updateData.expiresAt,
          metadata: updateData.metadata,
          updatedAt: new Date(),
        },
        include: {
          uploadedBy: {
            select: {
              id: true,
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
        },
      });

      logger.info('File updated successfully', {
        component: 'FileModel',
        fileId: id,
        updatedFields: Object.keys(updateData),
      });

      return updatedFile;
    } catch (error) {
      logger.error('Error updating file', {
        component: 'FileModel',
        error: (error as Error).message,
        fileId: id,
      });
      throw error;
    }
  }

  /**
   * Get files with filters and pagination
   */
  async findMany(
    filters: FileSearchFilters = {},
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<{ files: FileWithRelations[]; total: number; pages: number }> {
    try {
      const skip = (page - 1) * limit;
      
      // Build where clause
      const where: any = {
        isDeleted: false,
      };

      if (filters.patientId) {
        where.patientId = filters.patientId;
      }

      if (filters.encounterId) {
        where.encounterId = filters.encounterId;
      }

      if (filters.uploadedBy) {
        where.uploadedBy = filters.uploadedBy;
      }

      if (filters.fileType) {
        where.fileType = filters.fileType;
      }

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.category) {
        where.category = filters.category;
      }

      if (filters.tags && filters.tags.length > 0) {
        where.tags = {
          hasEvery: filters.tags,
        };
      }

      if (filters.dateFrom || filters.dateTo) {
        where.createdAt = {};
        if (filters.dateFrom) {
          where.createdAt.gte = filters.dateFrom;
        }
        if (filters.dateTo) {
          where.createdAt.lte = filters.dateTo;
        }
      }

      if (filters.sizeMin !== undefined || filters.sizeMax !== undefined) {
        where.fileSize = {};
        if (filters.sizeMin !== undefined) {
          where.fileSize.gte = filters.sizeMin;
        }
        if (filters.sizeMax !== undefined) {
          where.fileSize.lte = filters.sizeMax;
        }
      }

      if (filters.search) {
        where.OR = [
          { fileName: { contains: filters.search, mode: 'insensitive' } },
          { originalName: { contains: filters.search, mode: 'insensitive' } },
          { description: { contains: filters.search, mode: 'insensitive' } },
          { category: { contains: filters.search, mode: 'insensitive' } },
          { tags: { has: filters.search } },
        ];
      }

      // Get files and total count
      const [files, total] = await Promise.all([
        this.prisma.file.findMany({
          where,
          include: {
            uploadedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
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
                encounterId: true,
                startTime: true,
                type: true,
              },
            },
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        this.prisma.file.count({ where }),
      ]);

      const pages = Math.ceil(total / limit);

      return { files, total, pages };
    } catch (error) {
      logger.error('Error finding files', {
        component: 'FileModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to find files', 500);
    }
  }

  /**
   * Get patient files
   */
  async getPatientFiles(patientId: string, category?: string): Promise<FileWithRelations[]> {
    try {
      const where: any = {
        patientId,
        isDeleted: false,
        status: FileStatus.ACTIVE,
      };

      if (category) {
        where.category = category;
      }

      const files = await this.prisma.file.findMany({
        where,
        include: {
          uploadedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          encounter: {
            select: {
              encounterId: true,
              startTime: true,
              type: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return files;
    } catch (error) {
      logger.error('Error getting patient files', {
        component: 'FileModel',
        error: (error as Error).message,
        patientId,
        category,
      });
      throw new AppError('Failed to get patient files', 500);
    }
  }

  /**
   * Get encounter files
   */
  async getEncounterFiles(encounterId: string): Promise<FileWithRelations[]> {
    try {
      const files = await this.prisma.file.findMany({
        where: {
          encounterId,
          isDeleted: false,
          status: FileStatus.ACTIVE,
        },
        include: {
          uploadedBy: {
            select: {
              id: true,
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
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return files;
    } catch (error) {
      logger.error('Error getting encounter files', {
        component: 'FileModel',
        error: (error as Error).message,
        encounterId,
      });
      throw new AppError('Failed to get encounter files', 500);
    }
  }

  /**
   * Delete file (soft delete)
   */
  async delete(id: string, deletedBy: string, reason?: string): Promise<void> {
    try {
      const file = await this.findById(id);
      if (!file) {
        throw new NotFoundError('File not found');
      }

      await this.prisma.file.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy,
          deletionReason: reason,
          status: FileStatus.DELETED,
          updatedAt: new Date(),
        },
      });

      logger.info('File deleted successfully', {
        component: 'FileModel',
        fileId: id,
        deletedBy,
        reason,
      });
    } catch (error) {
      logger.error('Error deleting file', {
        component: 'FileModel',
        error: (error as Error).message,
        fileId: id,
        deletedBy,
      });
      throw error;
    }
  }

  /**
   * Permanently delete file
   */
  async permanentDelete(id: string): Promise<void> {
    try {
      const file = await this.findById(id);
      if (!file) {
        throw new NotFoundError('File not found');
      }

      // Delete file from disk
      const fullPath = path.join(this.uploadPath, file.filePath);
      try {
        await fs.unlink(fullPath);
      } catch (fsError) {
        logger.warn('File not found on disk during permanent deletion', {
          component: 'FileModel',
          fileId: id,
          filePath: fullPath,
        });
      }

      // Delete from database
      await this.prisma.file.delete({
        where: { id },
      });

      logger.info('File permanently deleted', {
        component: 'FileModel',
        fileId: id,
      });
    } catch (error) {
      logger.error('Error permanently deleting file', {
        component: 'FileModel',
        error: (error as Error).message,
        fileId: id,
      });
      throw error;
    }
  }

  /**
   * Get file statistics
   */
  async getStats(dateFrom?: Date, dateTo?: Date): Promise<FileStats> {
    try {
      const where: any = {
        isDeleted: false,
      };
      
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) {
          where.createdAt.gte = dateFrom;
        }
        if (dateTo) {
          where.createdAt.lte = dateTo;
        }
      }

      const [totalFiles, totalSizeResult, filesByType, filesByStatus, filesByCategory, recentUploads] = await Promise.all([
        this.prisma.file.count({ where }),
        this.prisma.file.aggregate({
          where,
          _sum: {
            fileSize: true,
          },
          _avg: {
            fileSize: true,
          },
        }),
        this.prisma.file.groupBy({
          by: ['fileType'],
          where,
          _count: true,
        }),
        this.prisma.file.groupBy({
          by: ['status'],
          where,
          _count: true,
        }),
        this.prisma.file.groupBy({
          by: ['category'],
          where,
          _count: true,
        }),
        this.prisma.file.count({
          where: {
            ...where,
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
            },
          },
        }),
      ]);

      // Format type stats
      const typeStats = filesByType.reduce((acc, item) => {
        acc[item.fileType] = item._count;
        return acc;
      }, {} as Record<FileType, number>);

      // Ensure all types are represented
      Object.values(FileType).forEach(type => {
        if (!(type in typeStats)) {
          typeStats[type] = 0;
        }
      });

      // Format status stats
      const statusStats = filesByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<FileStatus, number>);

      // Ensure all statuses are represented
      Object.values(FileStatus).forEach(status => {
        if (!(status in statusStats)) {
          statusStats[status] = 0;
        }
      });

      // Format category stats
      const categoryStats = filesByCategory.reduce((acc, item) => {
        acc[item.category] = item._count;
        return acc;
      }, {} as Record<string, number>);

      const totalSize = totalSizeResult._sum.fileSize || 0;
      const storageLimit = parseInt(process.env.STORAGE_LIMIT || '10737418240'); // 10GB default
      const storagePercentage = (totalSize / storageLimit) * 100;

      return {
        totalFiles,
        totalSize,
        filesByType: typeStats,
        filesByStatus: statusStats,
        filesByCategory: categoryStats,
        averageFileSize: Math.round(totalSizeResult._avg.fileSize || 0),
        recentUploads,
        storageUsed: formatFileSize(totalSize),
        storageLimit: formatFileSize(storageLimit),
        storagePercentage: Math.round(storagePercentage * 10) / 10,
      };
    } catch (error) {
      logger.error('Error getting file stats', {
        component: 'FileModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to get file statistics', 500);
    }
  }

  /**
   * Clean up expired files
   */
  async cleanupExpiredFiles(): Promise<number> {
    try {
      const expiredFiles = await this.prisma.file.findMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
          isDeleted: false,
        },
        select: {
          id: true,
          fileName: true,
          filePath: true,
        },
      });

      let deletedCount = 0;

      for (const file of expiredFiles) {
        try {
          // Delete file from disk
          const fullPath = path.join(this.uploadPath, file.filePath);
          await fs.unlink(fullPath);

          // Mark as deleted in database
          await this.prisma.file.update({
            where: { id: file.id },
            data: {
              isDeleted: true,
              deletedAt: new Date(),
              deletionReason: 'Expired',
              status: FileStatus.DELETED,
            },
          });

          deletedCount++;
        } catch (error) {
          logger.error('Error deleting expired file', {
            component: 'FileModel',
            fileId: file.id,
            error: (error as Error).message,
          });
        }
      }

      logger.info('Expired files cleanup completed', {
        component: 'FileModel',
        deletedCount,
        totalExpired: expiredFiles.length,
      });

      return deletedCount;
    } catch (error) {
      logger.error('Error cleaning up expired files', {
        component: 'FileModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to cleanup expired files', 500);
    }
  }

  /**
   * Generate file path based on category and date
   */
  private generateFilePath(fileName: string, category?: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    const categoryPath = category ? category.toLowerCase() : 'general';
    return path.join(categoryPath, String(year), month, day, fileName);
  }

  /**
   * Determine file type from MIME type
   */
  private determineFileType(mimeType: string): FileType {
    if (mimeType.startsWith('image/')) {
      return FileType.IMAGE;
    } else if (mimeType.startsWith('video/')) {
      return FileType.VIDEO;
    } else if (mimeType.startsWith('audio/')) {
      return FileType.AUDIO;
    } else if (mimeType === 'application/pdf') {
      return FileType.PDF;
    } else if (
      mimeType.includes('word') ||
      mimeType.includes('document') ||
      mimeType === 'text/plain'
    ) {
      return FileType.DOCUMENT;
    } else if (
      mimeType.includes('excel') ||
      mimeType.includes('spreadsheet') ||
      mimeType === 'text/csv'
    ) {
      return FileType.SPREADSHEET;
    } else {
      return FileType.OTHER;
    }
  }

  /**
   * Extract metadata from file
   */
  private async extractMetadata(filePath: string, mimeType: string): Promise<FileMetadata | null> {
    try {
      const stats = await fs.stat(filePath);
      
      const metadata: FileMetadata = {
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
      };

      // Add type-specific metadata extraction here
      // This is a placeholder - in a real implementation, you would use libraries like:
      // - sharp for images
      // - pdf-parse for PDFs
      // - ffprobe for videos
      // - exifr for EXIF data

      return metadata;
    } catch (error) {
      logger.warn('Error extracting file metadata', {
        component: 'FileModel',
        filePath,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Generate download URL
   */
  private generateDownloadUrl(fileId: string): string {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    return `${baseUrl}/api/v1/files/${fileId}/download`;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default FileModel;