/**
 * ============================================================================
 * NOVA CHECK EHR - FILE UPLOAD SERVICE
 * ============================================================================
 */

import multer from 'multer';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import logger from '../config/logger';
import config from '../config/config';
import auditService from './auditService';
import { Request } from 'express';

const prisma = new PrismaClient();

interface FileUploadOptions {
  maxSize?: number;
  allowedTypes?: string[];
  allowedExtensions?: string[];
  generateThumbnail?: boolean;
  encrypt?: boolean;
  virusScan?: boolean;
  watermark?: boolean;
}

interface UploadedFile {
  id: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
  url?: string;
  thumbnailUrl?: string;
  checksum: string;
  encrypted: boolean;
  uploadedBy: string;
  uploadedAt: Date;
  metadata?: any;
}

interface FileMetadata {
  width?: number;
  height?: number;
  duration?: number;
  pages?: number;
  format?: string;
  colorSpace?: string;
  hasAlpha?: boolean;
  density?: number;
}

class FileUploadService {
  private s3Client: S3Client | null = null;
  private uploadDir: string;
  private thumbnailDir: string;
  private tempDir: string;

  constructor() {
    this.uploadDir = path.join(process.cwd(), 'uploads');
    this.thumbnailDir = path.join(this.uploadDir, 'thumbnails');
    this.tempDir = path.join(this.uploadDir, 'temp');
    
    this.initializeDirectories();
    this.initializeS3();
  }

  private async initializeDirectories() {
    try {
      await fs.mkdir(this.uploadDir, { recursive: true });
      await fs.mkdir(this.thumbnailDir, { recursive: true });
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to initialize upload directories', { error: error.message });
    }
  }

  private initializeS3() {
    if (config.aws?.accessKeyId && config.aws?.secretAccessKey) {
      this.s3Client = new S3Client({
        region: config.aws.region || 'us-east-1',
        credentials: {
          accessKeyId: config.aws.accessKeyId,
          secretAccessKey: config.aws.secretAccessKey,
        },
      });
      logger.info('S3 client initialized');
    } else {
      logger.info('S3 credentials not provided, using local storage');
    }
  }

  private generateFileName(originalName: string, userId: string): string {
    const ext = path.extname(originalName);
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `${userId}_${timestamp}_${random}${ext}`;
  }

  private calculateChecksum(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  private async encryptFile(buffer: Buffer, key?: string): Promise<{ encrypted: Buffer; key: string; iv: string }> {
    const encryptionKey = key || crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', encryptionKey);
    
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    
    return {
      encrypted,
      key: encryptionKey.toString('hex'),
      iv: iv.toString('hex'),
    };
  }

  private async decryptFile(encryptedBuffer: Buffer, key: string, iv: string): Promise<Buffer> {
    const decipher = crypto.createDecipher('aes-256-cbc', Buffer.from(key, 'hex'));
    return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
  }

  private async extractMetadata(buffer: Buffer, mimeType: string): Promise<FileMetadata> {
    const metadata: FileMetadata = {};

    try {
      if (mimeType.startsWith('image/')) {
        const imageInfo = await sharp(buffer).metadata();
        metadata.width = imageInfo.width;
        metadata.height = imageInfo.height;
        metadata.format = imageInfo.format;
        metadata.colorSpace = imageInfo.space;
        metadata.hasAlpha = imageInfo.hasAlpha;
        metadata.density = imageInfo.density;
      }
      // Add more metadata extraction for other file types as needed
    } catch (error) {
      logger.warn('Failed to extract file metadata', { error: error.message, mimeType });
    }

    return metadata;
  }

  private async generateThumbnail(buffer: Buffer, mimeType: string): Promise<Buffer | null> {
    try {
      if (mimeType.startsWith('image/')) {
        return await sharp(buffer)
          .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
      }
      // Add thumbnail generation for other file types (PDF, video) as needed
      return null;
    } catch (error) {
      logger.warn('Failed to generate thumbnail', { error: error.message, mimeType });
      return null;
    }
  }

  private async addWatermark(buffer: Buffer, mimeType: string): Promise<Buffer> {
    try {
      if (mimeType.startsWith('image/')) {
        const watermarkText = 'NOVA CHECK EHR';
        const { width, height } = await sharp(buffer).metadata();
        
        const watermark = Buffer.from(
          `<svg width="${width}" height="${height}">
            <text x="50%" y="50%" font-family="Arial" font-size="24" fill="rgba(255,255,255,0.5)" text-anchor="middle" dominant-baseline="middle" transform="rotate(-45 ${width/2} ${height/2})">${watermarkText}</text>
          </svg>`
        );

        return await sharp(buffer)
          .composite([{ input: watermark, blend: 'overlay' }])
          .toBuffer();
      }
      return buffer;
    } catch (error) {
      logger.warn('Failed to add watermark', { error: error.message, mimeType });
      return buffer;
    }
  }

  private async virusScan(buffer: Buffer): Promise<boolean> {
    // Placeholder for virus scanning integration
    // In production, integrate with ClamAV, VirusTotal, or similar service
    try {
      // Simple check for common malicious patterns
      const content = buffer.toString('hex');
      const maliciousPatterns = [
        '4d5a', // PE executable header
        '504b0304', // ZIP file header (could contain malicious content)
      ];
      
      for (const pattern of maliciousPatterns) {
        if (content.toLowerCase().includes(pattern)) {
          logger.warn('Potential malicious file detected', { pattern });
          return false;
        }
      }
      
      return true;
    } catch (error) {
      logger.error('Virus scan failed', { error: error.message });
      return false;
    }
  }

  private validateFile(file: Express.Multer.File, options: FileUploadOptions): void {
    // Check file size
    if (options.maxSize && file.size > options.maxSize) {
      throw new Error(`File size exceeds maximum allowed size of ${options.maxSize} bytes`);
    }

    // Check MIME type
    if (options.allowedTypes && !options.allowedTypes.includes(file.mimetype)) {
      throw new Error(`File type ${file.mimetype} is not allowed`);
    }

    // Check file extension
    if (options.allowedExtensions) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!options.allowedExtensions.includes(ext)) {
        throw new Error(`File extension ${ext} is not allowed`);
      }
    }

    // Check for null bytes (potential security issue)
    if (file.originalname.includes('\0')) {
      throw new Error('Invalid file name');
    }

    // Check for path traversal attempts
    if (file.originalname.includes('..') || file.originalname.includes('/') || file.originalname.includes('\\')) {
      throw new Error('Invalid file name');
    }
  }

  async uploadFile(
    file: Express.Multer.File,
    userId: string,
    options: FileUploadOptions = {},
    req?: Request
  ): Promise<UploadedFile> {
    try {
      // Validate file
      this.validateFile(file, options);

      // Virus scan if enabled
      if (options.virusScan) {
        const isClean = await this.virusScan(file.buffer);
        if (!isClean) {
          throw new Error('File failed virus scan');
        }
      }

      let fileBuffer = file.buffer;
      const fileName = this.generateFileName(file.originalname, userId);
      const checksum = this.calculateChecksum(fileBuffer);

      // Add watermark if enabled
      if (options.watermark) {
        fileBuffer = await this.addWatermark(fileBuffer, file.mimetype);
      }

      // Encrypt file if enabled
      let encryptionKey: string | undefined;
      let encryptionIv: string | undefined;
      if (options.encrypt) {
        const encrypted = await this.encryptFile(fileBuffer);
        fileBuffer = encrypted.encrypted;
        encryptionKey = encrypted.key;
        encryptionIv = encrypted.iv;
      }

      // Extract metadata
      const metadata = await this.extractMetadata(file.buffer, file.mimetype);

      // Generate thumbnail if enabled
      let thumbnailBuffer: Buffer | null = null;
      let thumbnailFileName: string | undefined;
      if (options.generateThumbnail) {
        thumbnailBuffer = await this.generateThumbnail(file.buffer, file.mimetype);
        if (thumbnailBuffer) {
          thumbnailFileName = `thumb_${fileName.replace(path.extname(fileName), '.jpg')}`;
        }
      }

      let filePath: string;
      let thumbnailPath: string | undefined;
      let fileUrl: string | undefined;
      let thumbnailUrl: string | undefined;

      // Upload to S3 or local storage
      if (this.s3Client && config.aws?.s3BucketName) {
        // Upload to S3
        const s3Key = `uploads/${fileName}`;
        await this.s3Client.send(new PutObjectCommand({
          Bucket: config.aws.s3BucketName,
          Key: s3Key,
          Body: fileBuffer,
          ContentType: file.mimetype,
          Metadata: {
            originalName: file.originalname,
            uploadedBy: userId,
            checksum,
          },
        }));

        filePath = s3Key;
        fileUrl = await this.getSignedUrl(s3Key);

        // Upload thumbnail to S3
        if (thumbnailBuffer && thumbnailFileName) {
          const thumbnailS3Key = `thumbnails/${thumbnailFileName}`;
          await this.s3Client.send(new PutObjectCommand({
            Bucket: config.aws.s3BucketName,
            Key: thumbnailS3Key,
            Body: thumbnailBuffer,
            ContentType: 'image/jpeg',
          }));
          thumbnailPath = thumbnailS3Key;
          thumbnailUrl = await this.getSignedUrl(thumbnailS3Key);
        }
      } else {
        // Save to local storage
        filePath = path.join(this.uploadDir, fileName);
        await fs.writeFile(filePath, fileBuffer);

        // Save thumbnail to local storage
        if (thumbnailBuffer && thumbnailFileName) {
          thumbnailPath = path.join(this.thumbnailDir, thumbnailFileName);
          await fs.writeFile(thumbnailPath, thumbnailBuffer);
          thumbnailUrl = `/uploads/thumbnails/${thumbnailFileName}`;
        }

        fileUrl = `/uploads/${fileName}`;
      }

      // Save file record to database
      const fileRecord = await prisma.file.create({
        data: {
          id: uuidv4(),
          originalName: file.originalname,
          fileName,
          mimeType: file.mimetype,
          size: file.size,
          path: filePath,
          thumbnailPath,
          checksum,
          encrypted: !!options.encrypt,
          encryptionKey,
          encryptionIv,
          uploadedBy: userId,
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      });

      // Log file upload
      await auditService.logDataModification(
        'FILE',
        fileRecord.id,
        userId,
        'USER', // This should be passed from the request context
        'CREATE',
        {
          fileName: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
        },
        true,
        undefined,
        req
      );

      const uploadedFile: UploadedFile = {
        id: fileRecord.id,
        originalName: fileRecord.originalName,
        fileName: fileRecord.fileName,
        mimeType: fileRecord.mimeType,
        size: fileRecord.size,
        path: fileRecord.path,
        url: fileUrl,
        thumbnailUrl,
        checksum: fileRecord.checksum,
        encrypted: fileRecord.encrypted,
        uploadedBy: fileRecord.uploadedBy,
        uploadedAt: fileRecord.createdAt,
        metadata: fileRecord.metadata ? JSON.parse(fileRecord.metadata) : undefined,
      };

      logger.info('File uploaded successfully', {
        fileId: fileRecord.id,
        fileName: file.originalname,
        size: file.size,
        userId,
      });

      return uploadedFile;
    } catch (error) {
      logger.error('File upload failed', {
        error: error.message,
        fileName: file.originalname,
        userId,
      });
      throw error;
    }
  }

  async getFile(fileId: string, userId?: string): Promise<UploadedFile | null> {
    try {
      const fileRecord = await prisma.file.findUnique({
        where: { id: fileId },
      });

      if (!fileRecord) {
        return null;
      }

      // Check access permissions (implement your authorization logic here)
      // For now, we'll allow access if userId matches uploadedBy or if no userId is provided
      if (userId && fileRecord.uploadedBy !== userId) {
        // Add more sophisticated permission checking here
        logger.warn('Unauthorized file access attempt', { fileId, userId, uploadedBy: fileRecord.uploadedBy });
        return null;
      }

      let fileUrl: string | undefined;
      let thumbnailUrl: string | undefined;

      if (this.s3Client && config.aws?.s3BucketName) {
        fileUrl = await this.getSignedUrl(fileRecord.path);
        if (fileRecord.thumbnailPath) {
          thumbnailUrl = await this.getSignedUrl(fileRecord.thumbnailPath);
        }
      } else {
        fileUrl = `/uploads/${fileRecord.fileName}`;
        if (fileRecord.thumbnailPath) {
          thumbnailUrl = `/uploads/thumbnails/${path.basename(fileRecord.thumbnailPath)}`;
        }
      }

      return {
        id: fileRecord.id,
        originalName: fileRecord.originalName,
        fileName: fileRecord.fileName,
        mimeType: fileRecord.mimeType,
        size: fileRecord.size,
        path: fileRecord.path,
        url: fileUrl,
        thumbnailUrl,
        checksum: fileRecord.checksum,
        encrypted: fileRecord.encrypted,
        uploadedBy: fileRecord.uploadedBy,
        uploadedAt: fileRecord.createdAt,
        metadata: fileRecord.metadata ? JSON.parse(fileRecord.metadata) : undefined,
      };
    } catch (error) {
      logger.error('Failed to get file', { error: error.message, fileId });
      return null;
    }
  }

  async downloadFile(fileId: string, userId?: string): Promise<{ buffer: Buffer; file: UploadedFile } | null> {
    try {
      const file = await this.getFile(fileId, userId);
      if (!file) {
        return null;
      }

      let buffer: Buffer;

      if (this.s3Client && config.aws?.s3BucketName) {
        // Download from S3
        const response = await this.s3Client.send(new GetObjectCommand({
          Bucket: config.aws.s3BucketName,
          Key: file.path,
        }));
        
        const chunks: Buffer[] = [];
        const stream = response.Body as any;
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        buffer = Buffer.concat(chunks);
      } else {
        // Read from local storage
        buffer = await fs.readFile(file.path);
      }

      // Decrypt if encrypted
      if (file.encrypted) {
        const fileRecord = await prisma.file.findUnique({
          where: { id: fileId },
          select: { encryptionKey: true, encryptionIv: true },
        });
        
        if (fileRecord?.encryptionKey && fileRecord?.encryptionIv) {
          buffer = await this.decryptFile(buffer, fileRecord.encryptionKey, fileRecord.encryptionIv);
        }
      }

      // Log file access
      if (userId) {
        await auditService.logDataAccess(
          'FILE',
          fileId,
          userId,
          'USER', // This should be passed from the request context
          'VIEW',
          { fileName: file.originalName }
        );
      }

      return { buffer, file };
    } catch (error) {
      logger.error('Failed to download file', { error: error.message, fileId });
      return null;
    }
  }

  async deleteFile(fileId: string, userId: string, req?: Request): Promise<boolean> {
    try {
      const fileRecord = await prisma.file.findUnique({
        where: { id: fileId },
      });

      if (!fileRecord) {
        return false;
      }

      // Check permissions (implement your authorization logic here)
      if (fileRecord.uploadedBy !== userId) {
        logger.warn('Unauthorized file deletion attempt', { fileId, userId, uploadedBy: fileRecord.uploadedBy });
        return false;
      }

      // Delete from S3 or local storage
      if (this.s3Client && config.aws?.s3BucketName) {
        // Delete from S3
        await this.s3Client.send(new DeleteObjectCommand({
          Bucket: config.aws.s3BucketName,
          Key: fileRecord.path,
        }));

        // Delete thumbnail from S3
        if (fileRecord.thumbnailPath) {
          await this.s3Client.send(new DeleteObjectCommand({
            Bucket: config.aws.s3BucketName,
            Key: fileRecord.thumbnailPath,
          }));
        }
      } else {
        // Delete from local storage
        try {
          await fs.unlink(fileRecord.path);
        } catch (error) {
          logger.warn('Failed to delete file from local storage', { error: error.message, path: fileRecord.path });
        }

        // Delete thumbnail from local storage
        if (fileRecord.thumbnailPath) {
          try {
            await fs.unlink(fileRecord.thumbnailPath);
          } catch (error) {
            logger.warn('Failed to delete thumbnail from local storage', { error: error.message, path: fileRecord.thumbnailPath });
          }
        }
      }

      // Delete from database
      await prisma.file.delete({
        where: { id: fileId },
      });

      // Log file deletion
      await auditService.logDataModification(
        'FILE',
        fileId,
        userId,
        'USER', // This should be passed from the request context
        'DELETE',
        {
          fileName: fileRecord.originalName,
          size: fileRecord.size,
        },
        true,
        undefined,
        req
      );

      logger.info('File deleted successfully', {
        fileId,
        fileName: fileRecord.originalName,
        userId,
      });

      return true;
    } catch (error) {
      logger.error('Failed to delete file', { error: error.message, fileId });
      return false;
    }
  }

  async getUserFiles(userId: string, page: number = 1, limit: number = 20) {
    try {
      const [files, total] = await Promise.all([
        prisma.file.findMany({
          where: { uploadedBy: userId },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.file.count({ where: { uploadedBy: userId } }),
      ]);

      const filesWithUrls = await Promise.all(
        files.map(async (file) => {
          let fileUrl: string | undefined;
          let thumbnailUrl: string | undefined;

          if (this.s3Client && config.aws?.s3BucketName) {
            fileUrl = await this.getSignedUrl(file.path);
            if (file.thumbnailPath) {
              thumbnailUrl = await this.getSignedUrl(file.thumbnailPath);
            }
          } else {
            fileUrl = `/uploads/${file.fileName}`;
            if (file.thumbnailPath) {
              thumbnailUrl = `/uploads/thumbnails/${path.basename(file.thumbnailPath)}`;
            }
          }

          return {
            id: file.id,
            originalName: file.originalName,
            fileName: file.fileName,
            mimeType: file.mimeType,
            size: file.size,
            url: fileUrl,
            thumbnailUrl,
            encrypted: file.encrypted,
            uploadedAt: file.createdAt,
            metadata: file.metadata ? JSON.parse(file.metadata) : undefined,
          };
        })
      );

      return {
        files: filesWithUrls,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Failed to get user files', { error: error.message, userId });
      throw new Error('Failed to get user files');
    }
  }

  private async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    if (!this.s3Client || !config.aws?.s3BucketName) {
      throw new Error('S3 not configured');
    }

    const command = new GetObjectCommand({
      Bucket: config.aws.s3BucketName,
      Key: key,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  getMulterConfig(options: FileUploadOptions = {}): multer.Options {
    return {
      storage: multer.memoryStorage(),
      limits: {
        fileSize: options.maxSize || 10 * 1024 * 1024, // 10MB default
        files: 1,
      },
      fileFilter: (req, file, cb) => {
        try {
          this.validateFile(file, options);
          cb(null, true);
        } catch (error) {
          cb(error as Error, false);
        }
      },
    };
  }

  // Predefined configurations for common file types
  static getImageUploadConfig(): FileUploadOptions {
    return {
      maxSize: 5 * 1024 * 1024, // 5MB
      allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
      generateThumbnail: true,
      virusScan: true,
    };
  }

  static getDocumentUploadConfig(): FileUploadOptions {
    return {
      maxSize: 25 * 1024 * 1024, // 25MB
      allowedTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
      ],
      allowedExtensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt'],
      virusScan: true,
      encrypt: true,
    };
  }

  static getMedicalImageConfig(): FileUploadOptions {
    return {
      maxSize: 100 * 1024 * 1024, // 100MB for medical images
      allowedTypes: [
        'image/jpeg',
        'image/png',
        'image/tiff',
        'application/dicom',
      ],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.dcm'],
      generateThumbnail: true,
      virusScan: true,
      encrypt: true,
      watermark: true,
    };
  }
}

// Export singleton instance
const fileUploadService = new FileUploadService();
export default fileUploadService;

// Export the class for testing
export { FileUploadService };