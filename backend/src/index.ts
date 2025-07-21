/**
 * ============================================================================
 * NOVA CHECK EHR - BACKEND SERVER ENTRY POINT
 * ============================================================================
 */

import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';

// Import configurations
import { config } from '@/config/config';
import { logger } from '@/config/logger';
import { connectDatabase } from '@/config/database';
import { connectRedis } from '@/config/redis';
import { initializeSocketIO } from '@/config/socket';

// Import middleware
import { errorHandler } from '@/middleware/errorHandler';
import { requestLogger } from '@/middleware/requestLogger';
import { authMiddleware } from '@/middleware/auth';
import { hipaaMiddleware } from '@/middleware/hipaa';
import { validationMiddleware } from '@/middleware/validation';
import { corsMiddleware } from '@/middleware/cors';
import { securityMiddleware } from '@/middleware/security';

// Import routes
import authRoutes from '@/routes/auth';
import userRoutes from '@/routes/users';
import patientRoutes from '@/routes/patients';
import providerRoutes from '@/routes/providers';
import appointmentRoutes from '@/routes/appointments';
import encounterRoutes from '@/routes/encounters';
import clinicalRoutes from '@/routes/clinical';
import billingRoutes from '@/routes/billing';
import messageRoutes from '@/routes/messages';
import documentRoutes from '@/routes/documents';
import reportRoutes from '@/routes/reports';
import adminRoutes from '@/routes/admin';
import healthRoutes from '@/routes/health';
import webhookRoutes from '@/routes/webhooks';
import fhirRoutes from '@/routes/fhir';

// Import utilities
import { gracefulShutdown } from '@/utils/gracefulShutdown';
import { setupSwagger } from '@/config/swagger';
import { initializeJobs } from '@/jobs';

// Load environment variables
dotenv.config();

/**
 * Express Application Setup
 */
class Application {
  public app: express.Application;
  public server: any;
  public io: SocketIOServer;
  private port: number;

  constructor() {
    this.app = express();
    this.port = config.server.port;
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  /**
   * Initialize middleware
   */
  private initializeMiddleware(): void {
    // Trust proxy for accurate IP addresses
    this.app.set('trust proxy', 1);

    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'", 'wss:', 'ws:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    }));

    // CORS configuration
    this.app.use(corsMiddleware);

    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    this.app.use(cookieParser());

    // Request logging
    this.app.use(requestLogger);

    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      message: {
        error: 'Too many requests from this IP, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
      },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/health' || req.path === '/api/health';
      },
    });
    this.app.use(limiter);

    // Custom security middleware
    this.app.use(securityMiddleware);

    // HIPAA compliance middleware
    this.app.use(hipaaMiddleware);
  }

  /**
   * Initialize routes
   */
  private initializeRoutes(): void {
    // Health check routes (no auth required)
    this.app.use('/health', healthRoutes);
    this.app.use('/api/health', healthRoutes);

    // Webhook routes (special auth handling)
    this.app.use('/api/webhooks', webhookRoutes);

    // API routes with authentication
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/users', authMiddleware, userRoutes);
    this.app.use('/api/patients', authMiddleware, patientRoutes);
    this.app.use('/api/providers', authMiddleware, providerRoutes);
    this.app.use('/api/appointments', authMiddleware, appointmentRoutes);
    this.app.use('/api/encounters', authMiddleware, encounterRoutes);
    this.app.use('/api/clinical', authMiddleware, clinicalRoutes);
    this.app.use('/api/billing', authMiddleware, billingRoutes);
    this.app.use('/api/messages', authMiddleware, messageRoutes);
    this.app.use('/api/documents', authMiddleware, documentRoutes);
    this.app.use('/api/reports', authMiddleware, reportRoutes);
    this.app.use('/api/admin', authMiddleware, adminRoutes);
    this.app.use('/api/fhir', authMiddleware, fhirRoutes);

    // API documentation
    if (config.env !== 'production') {
      setupSwagger(this.app);
    }

    // 404 handler for API routes
    this.app.use('/api/*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'API endpoint not found',
        code: 'ENDPOINT_NOT_FOUND',
        path: req.path,
        method: req.method,
      });
    });

    // Root route
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Nova Check EHR API',
        version: '1.0.0',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: config.env,
        documentation: config.env !== 'production' ? '/api-docs' : undefined,
      });
    });

    // Catch-all 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'Resource not found',
        code: 'NOT_FOUND',
        path: req.path,
        method: req.method,
      });
    });
  }

  /**
   * Initialize error handling
   */
  private initializeErrorHandling(): void {
    this.app.use(errorHandler);
  }

  /**
   * Initialize Socket.IO
   */
  private initializeSocketIO(): void {
    this.server = createServer(this.app);
    this.io = initializeSocketIO(this.server);
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    try {
      // Initialize Socket.IO
      this.initializeSocketIO();

      // Connect to database
      await connectDatabase();
      logger.info('✅ Database connected successfully');

      // Connect to Redis
      await connectRedis();
      logger.info('✅ Redis connected successfully');

      // Initialize background jobs
      await initializeJobs();
      logger.info('✅ Background jobs initialized');

      // Start server
      this.server.listen(this.port, () => {
        logger.info(`🚀 Nova Check EHR API Server started`);
        logger.info(`📍 Environment: ${config.env}`);
        logger.info(`🌐 Server running on port ${this.port}`);
        logger.info(`📚 API Documentation: http://localhost:${this.port}/api-docs`);
        logger.info(`🏥 Health Check: http://localhost:${this.port}/health`);
        
        if (config.env === 'development') {
          logger.info(`🔧 Development mode enabled`);
          logger.info(`📊 Database Studio: npx prisma studio`);
        }
      });

      // Setup graceful shutdown
      gracefulShutdown(this.server, this.io);

    } catch (error) {
      logger.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }
}

/**
 * Start the application
 */
const application = new Application();

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
if (require.main === module) {
  application.start().catch((error) => {
    logger.error('Failed to start application:', error);
    process.exit(1);
  });
}

export default application;
export { Application };