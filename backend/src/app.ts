/**
 * ============================================================================
 * NOVA CHECK EHR - MAIN APPLICATION SERVER
 * ============================================================================
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import { config } from './config/config';
import logger from './config/logger';
import { connectDatabase } from './config/database';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/logging';
import { rateLimiters } from './middleware/security';
import { auditService } from './services/auditService';
import { cacheService } from './services/cacheService';
import { notificationService } from './services/notificationService';
import { emailService } from './services/emailService';
import { smsService } from './services/smsService';
import { fileUploadService } from './services/fileUploadService';
import { llmIntegrationService } from './services/llmIntegrationService';
import { aiService } from './services/aiService';
import { ehrIntegrationService } from './services/ehrIntegrationService';

class App {
  public app: Application;
  private server: any;

  constructor() {
    this.app = express();
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  /**
   * Initialize middleware
   */
  private initializeMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }));

    // CORS configuration
    this.app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = config.cors.allowedOrigins;
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
          return callback(null, true);
        }
        
        const error = new Error(`CORS policy violation: Origin ${origin} not allowed`);
        logger.warn('CORS policy violation', { origin, allowedOrigins });
        return callback(error, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'Cache-Control',
        'Pragma',
        'X-API-Key',
        'X-Client-Version',
      ],
      exposedHeaders: [
        'X-Total-Count',
        'X-Page-Count',
        'X-Current-Page',
        'X-Per-Page',
        'X-Rate-Limit-Limit',
        'X-Rate-Limit-Remaining',
        'X-Rate-Limit-Reset',
      ],
      maxAge: 86400, // 24 hours
    }));

    // Compression middleware
    this.app.use(compression({
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
      level: 6,
      threshold: 1024,
    }));

    // Body parsing middleware
    this.app.use(express.json({ 
      limit: config.upload.maxFileSize,
      verify: (req: any, res, buf) => {
        req.rawBody = buf;
      },
    }));
    this.app.use(express.urlencoded({ 
      extended: true, 
      limit: config.upload.maxFileSize,
    }));

    // Static files
    this.app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
    this.app.use('/public', express.static(path.join(__dirname, '../public')));

    // Request logging
    if (config.app.nodeEnv === 'development') {
      this.app.use(morgan('dev'));
    } else {
      this.app.use(morgan('combined', {
        stream: {
          write: (message: string) => {
            logger.info(message.trim());
          },
        },
      }));
    }

    // Custom request logger
    this.app.use(requestLogger);

    // Trust proxy (for rate limiting and IP detection)
    this.app.set('trust proxy', 1);

    // Disable X-Powered-By header
    this.app.disable('x-powered-by');
  }

  /**
   * Initialize routes
   */
  private initializeRoutes(): void {
    // Root endpoint
    this.app.get('/', (req: Request, res: Response) => {
      res.json({
        success: true,
        message: 'Welcome to Nova Check EHR API',
        version: '1.0.0',
        documentation: '/api/v1',
        health: '/api/v1/health',
        timestamp: new Date().toISOString(),
        environment: config.app.nodeEnv,
      });
    });

    // API routes
    this.app.use('/api/v1', routes);

    // AI and integration routes
    this.app.use('/api/v1/ai', routes);
    this.app.use('/api/v1/ehr', routes);
    this.app.use('/api/v1/analytics', routes);
    this.app.use('/api/v1/integrations', routes);

    // Catch-all for undefined routes
    this.app.use('*', (req: Request, res: Response) => {
      logger.warn('Route not found', {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.status(404).json({
        success: false,
        message: 'Route not found',
        error: `${req.method} ${req.originalUrl} is not a valid endpoint`,
        documentation: '/api/v1',
        timestamp: new Date().toISOString(),
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
   * Initialize services
   */
  private async initializeServices(): Promise<void> {
    try {
      logger.info('Initializing services...');

      // Initialize cache service
      await cacheService.connect();
      logger.info('Cache service initialized');

      // Initialize email service
      await emailService.initialize();
      logger.info('Email service initialized');

      // Initialize SMS service
      await smsService.initialize();
      logger.info('SMS service initialized');

      // Initialize file upload service
      await fileUploadService.initialize();
      logger.info('File upload service initialized');

      // Initialize notification service
      await notificationService.initialize();
      logger.info('Notification service initialized');

      // Initialize audit service
      await auditService.initialize();
      logger.info('Audit service initialized');

      // Initialize AI and integration services
      await llmIntegrationService.initialize();
      logger.info('LLM integration service initialized');

      await aiService.initialize();
      logger.info('AI service initialized');

      await ehrIntegrationService.initialize();
      logger.info('EHR integration service initialized');

      logger.info('All services initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize services', { error });
      throw error;
    }
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    try {
      // Connect to database
      await connectDatabase();
      logger.info('Database connected successfully');

      // Initialize services
      await this.initializeServices();

      // Start server
      const port = config.app.port;
      this.server = this.app.listen(port, () => {
        logger.info(`🚀 Nova Check EHR API server started`, {
          port,
          environment: config.app.nodeEnv,
          version: '1.0.0',
          timestamp: new Date().toISOString(),
        });

        // Log available endpoints
        logger.info('Available endpoints:', {
          root: `http://localhost:${port}/`,
          api: `http://localhost:${port}/api/v1`,
          health: `http://localhost:${port}/api/v1/health`,
          docs: `http://localhost:${port}/api/v1`,
          aiChat: `http://localhost:${port}/api/v1/ai/chat`,
          ehrIntegration: `http://localhost:${port}/api/v1/ehr`,
          analytics: `http://localhost:${port}/api/v1/analytics`,
        });

        // Log enabled AI features
        const availableProviders = llmIntegrationService.getAvailableProviders();
        if (availableProviders.length > 0) {
          logger.info(`🧠 Available LLM Providers: ${availableProviders.map(p => p.name).join(', ')}`);
        }
      });

      // Handle server errors
      this.server.on('error', (error: any) => {
        if (error.syscall !== 'listen') {
          throw error;
        }

        const bind = typeof port === 'string' ? `Pipe ${port}` : `Port ${port}`;

        switch (error.code) {
          case 'EACCES':
            logger.error(`${bind} requires elevated privileges`);
            process.exit(1);
            break;
          case 'EADDRINUSE':
            logger.error(`${bind} is already in use`);
            process.exit(1);
            break;
          default:
            throw error;
        }
      });

    } catch (error) {
      logger.error('Failed to start server', { error });
      process.exit(1);
    }
  }

  /**
   * Graceful shutdown
   */
  public async shutdown(): Promise<void> {
    logger.info('Shutting down server gracefully...');

    try {
      // Close server
      if (this.server) {
        await new Promise<void>((resolve, reject) => {
          this.server.close((error: any) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
        logger.info('HTTP server closed');
      }

      // Close services
      await Promise.all([
        cacheService.disconnect(),
        emailService.shutdown(),
        smsService.shutdown(),
        notificationService.shutdown(),
        auditService.shutdown(),
        llmIntegrationService.shutdown(),
        aiService.shutdown(),
        ehrIntegrationService.shutdown(),
      ]);
      logger.info('Services shut down');

      logger.info('Server shut down gracefully');
    } catch (error) {
      logger.error('Error during shutdown', { error });
      throw error;
    }
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled Rejection', { reason, promise });
  process.exit(1);
});

// Handle SIGTERM
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  const app = new App();
  await app.shutdown();
  process.exit(0);
});

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  const app = new App();
  await app.shutdown();
  process.exit(0);
});

export default App;