// ============================================================================
// NOVA CHECK EHR - CONFIGURATION INDEX
// ============================================================================

import dotenv from 'dotenv';
import { z } from 'zod';

import { logger } from '../utils/logger';

// Load environment variables
dotenv.config();

// ============================================================================
// ENVIRONMENT VALIDATION SCHEMA
// ============================================================================

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  API_VERSION: z.string().default('v1'),
  APP_NAME: z.string().default('Nova Check EHR'),
  APP_URL: z.string().url().optional(),
  
  // Database
  DATABASE_URL: z.string().min(1, 'Database URL is required'),
  DATABASE_POOL_SIZE: z.string().transform(Number).default('10'),
  DATABASE_TIMEOUT: z.string().transform(Number).default('30000'),
  
  // JWT
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT refresh secret must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  
  // Encryption
  ENCRYPTION_KEY: z.string().min(32, 'Encryption key must be at least 32 characters'),
  
  // Redis
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().transform(Number).default('0'),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),
  RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS: z.string().transform(val => val === 'true').default('false'),
  
  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
  
  // File Upload
  MAX_REQUEST_SIZE: z.string().default('10mb'),
  UPLOAD_PATH: z.string().default('./uploads'),
  MAX_FILE_SIZE: z.string().transform(Number).default('5242880'), // 5MB
  ALLOWED_FILE_TYPES: z.string().default('image/jpeg,image/png,image/gif,application/pdf,text/plain'),
  
  // Email (SMTP)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).optional(),
  SMTP_SECURE: z.string().transform(val => val === 'true').optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().optional(),
  
  // Email (SendGrid)
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM_EMAIL: z.string().email().optional(),
  
  // Email (Mailgun)
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  MAILGUN_FROM_EMAIL: z.string().email().optional(),
  
  // SMS (Twilio)
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  
  // AWS S3
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_S3_BUCKET: z.string().optional(),
  
  // Google Cloud Storage
  GOOGLE_CLOUD_PROJECT_ID: z.string().optional(),
  GOOGLE_CLOUD_KEY_FILE: z.string().optional(),
  GOOGLE_CLOUD_STORAGE_BUCKET: z.string().optional(),
  
  // External APIs
  OPENAI_API_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  
  // Monitoring
  SENTRY_DSN: z.string().optional(),
  NEW_RELIC_LICENSE_KEY: z.string().optional(),
  DATADOG_API_KEY: z.string().optional(),
  
  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FORMAT: z.enum(['json', 'simple']).default('json'),
  LOG_FILE_ENABLED: z.string().transform(val => val === 'true').default('true'),
  LOG_FILE_PATH: z.string().default('./logs'),
  LOG_MAX_SIZE: z.string().default('20m'),
  LOG_MAX_FILES: z.string().default('14d'),
  
  // Security
  BCRYPT_ROUNDS: z.string().transform(Number).default('12'),
  SESSION_SECRET: z.string().optional(),
  CSRF_SECRET: z.string().optional(),
  
  // Health Checks
  HEALTH_CHECK_ENABLED: z.string().transform(val => val === 'true').default('true'),
  HEALTH_CHECK_INTERVAL: z.string().transform(Number).default('30000'), // 30 seconds
  
  // Feature Flags
  FEATURE_AUDIT_LOGGING: z.string().transform(val => val === 'true').default('true'),
  FEATURE_EMAIL_NOTIFICATIONS: z.string().transform(val => val === 'true').default('true'),
  FEATURE_SMS_NOTIFICATIONS: z.string().transform(val => val === 'true').default('false'),
  FEATURE_FILE_UPLOAD: z.string().transform(val => val === 'true').default('true'),
  FEATURE_RATE_LIMITING: z.string().transform(val => val === 'true').default('true'),
  
  // Cache
  CACHE_TTL: z.string().transform(Number).default('3600'), // 1 hour
  CACHE_MAX_ITEMS: z.string().transform(Number).default('1000'),
  
  // Pagination
  DEFAULT_PAGE_SIZE: z.string().transform(Number).default('20'),
  MAX_PAGE_SIZE: z.string().transform(Number).default('100'),
});

// ============================================================================
// VALIDATE AND EXPORT CONFIGURATION
// ============================================================================

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  logger.error('Invalid environment configuration:', {
    errors: parseResult.error.format(),
  });
  process.exit(1);
}

const env = parseResult.data;

// Additional validation
if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
  logger.error('JWT_SECRET and JWT_REFRESH_SECRET must be different');
  process.exit(1);
}

// ============================================================================
// CONFIGURATION OBJECT
// ============================================================================

export const config = {
  // Application
  NODE_ENV: env.NODE_ENV,
  PORT: env.PORT,
  API_VERSION: env.API_VERSION,
  APP_NAME: env.APP_NAME,
  APP_URL: env.APP_URL,
  
  // Database
  DATABASE_URL: env.DATABASE_URL,
  DATABASE_POOL_SIZE: env.DATABASE_POOL_SIZE,
  DATABASE_TIMEOUT: env.DATABASE_TIMEOUT,
  
  // JWT
  JWT_SECRET: env.JWT_SECRET,
  JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
  JWT_EXPIRES_IN: env.JWT_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN: env.JWT_REFRESH_EXPIRES_IN,
  
  // Encryption
  ENCRYPTION_KEY: env.ENCRYPTION_KEY,
  
  // Redis
  REDIS: {
    URL: env.REDIS_URL,
    HOST: env.REDIS_HOST,
    PORT: env.REDIS_PORT,
    PASSWORD: env.REDIS_PASSWORD,
    DB: env.REDIS_DB,
  },
  
  // Rate Limiting
  RATE_LIMIT: {
    WINDOW_MS: env.RATE_LIMIT_WINDOW_MS,
    MAX_REQUESTS: env.RATE_LIMIT_MAX_REQUESTS,
    SKIP_SUCCESSFUL_REQUESTS: env.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS,
  },
  
  // CORS
  CORS_ORIGINS: env.CORS_ORIGINS,
  
  // File Upload
  UPLOAD: {
    MAX_REQUEST_SIZE: env.MAX_REQUEST_SIZE,
    PATH: env.UPLOAD_PATH,
    MAX_FILE_SIZE: env.MAX_FILE_SIZE,
    ALLOWED_TYPES: env.ALLOWED_FILE_TYPES.split(',').map(type => type.trim()),
  },
  
  // Email
  EMAIL: {
    SMTP: {
      HOST: env.SMTP_HOST,
      PORT: env.SMTP_PORT,
      SECURE: env.SMTP_SECURE,
      USER: env.SMTP_USER,
      PASS: env.SMTP_PASS,
      FROM: env.SMTP_FROM,
    },
    SENDGRID: {
      API_KEY: env.SENDGRID_API_KEY,
      FROM_EMAIL: env.SENDGRID_FROM_EMAIL,
    },
    MAILGUN: {
      API_KEY: env.MAILGUN_API_KEY,
      DOMAIN: env.MAILGUN_DOMAIN,
      FROM_EMAIL: env.MAILGUN_FROM_EMAIL,
    },
  },
  
  // SMS
  SMS: {
    TWILIO: {
      ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
      AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
      PHONE_NUMBER: env.TWILIO_PHONE_NUMBER,
    },
  },
  
  // AWS
  AWS: {
    ACCESS_KEY_ID: env.AWS_ACCESS_KEY_ID,
    SECRET_ACCESS_KEY: env.AWS_SECRET_ACCESS_KEY,
    REGION: env.AWS_REGION,
    S3_BUCKET: env.AWS_S3_BUCKET,
  },
  
  // Google Cloud
  GOOGLE_CLOUD: {
    PROJECT_ID: env.GOOGLE_CLOUD_PROJECT_ID,
    KEY_FILE: env.GOOGLE_CLOUD_KEY_FILE,
    STORAGE_BUCKET: env.GOOGLE_CLOUD_STORAGE_BUCKET,
  },
  
  // External APIs
  EXTERNAL_APIS: {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    STRIPE: {
      SECRET_KEY: env.STRIPE_SECRET_KEY,
      WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
    },
  },
  
  // Monitoring
  MONITORING: {
    SENTRY_DSN: env.SENTRY_DSN,
    NEW_RELIC_LICENSE_KEY: env.NEW_RELIC_LICENSE_KEY,
    DATADOG_API_KEY: env.DATADOG_API_KEY,
  },
  
  // Logging
  LOGGING: {
    LEVEL: env.LOG_LEVEL,
    FORMAT: env.LOG_FORMAT,
    FILE_ENABLED: env.LOG_FILE_ENABLED,
    FILE_PATH: env.LOG_FILE_PATH,
    MAX_SIZE: env.LOG_MAX_SIZE,
    MAX_FILES: env.LOG_MAX_FILES,
  },
  
  // Security
  SECURITY: {
    BCRYPT_ROUNDS: env.BCRYPT_ROUNDS,
    SESSION_SECRET: env.SESSION_SECRET,
    CSRF_SECRET: env.CSRF_SECRET,
  },
  
  // Health Checks
  HEALTH_CHECK: {
    ENABLED: env.HEALTH_CHECK_ENABLED,
    INTERVAL: env.HEALTH_CHECK_INTERVAL,
  },
  
  // Feature Flags
  FEATURES: {
    AUDIT_LOGGING: env.FEATURE_AUDIT_LOGGING,
    EMAIL_NOTIFICATIONS: env.FEATURE_EMAIL_NOTIFICATIONS,
    SMS_NOTIFICATIONS: env.FEATURE_SMS_NOTIFICATIONS,
    FILE_UPLOAD: env.FEATURE_FILE_UPLOAD,
    RATE_LIMITING: env.FEATURE_RATE_LIMITING,
  },
  
  // Cache
  CACHE: {
    TTL: env.CACHE_TTL,
    MAX_ITEMS: env.CACHE_MAX_ITEMS,
  },
  
  // Pagination
  PAGINATION: {
    DEFAULT_PAGE_SIZE: env.DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE: env.MAX_PAGE_SIZE,
  },
} as const;

// ============================================================================
// CONFIGURATION VALIDATION
// ============================================================================

/**
 * Validate configuration at startup
 */
export const validateConfig = (): void => {
  const requiredInProduction = [
    'DATABASE_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'ENCRYPTION_KEY',
  ];

  if (config.NODE_ENV === 'production') {
    const missing = requiredInProduction.filter(key => {
      const value = process.env[key];
      return !value || value.trim() === '';
    });

    if (missing.length > 0) {
      logger.error('Missing required environment variables for production:', {
        missing,
      });
      process.exit(1);
    }
  }

  logger.info('Configuration validated successfully', {
    environment: config.NODE_ENV,
    port: config.PORT,
    features: config.FEATURES,
  });
};

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Config = typeof config;
export type Environment = typeof env.NODE_ENV;

// Validate configuration on import
validateConfig();