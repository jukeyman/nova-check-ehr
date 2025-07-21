/**
 * ============================================================================
 * NOVA CHECK EHR - MAIN CONFIGURATION
 * ============================================================================
 */

import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

/**
 * Environment validation schema
 */
const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  API_VERSION: z.string().default('v1'),
  APP_NAME: z.string().default('Nova Check EHR'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:3001'),

  // Database
  DATABASE_URL: z.string().min(1, 'Database URL is required'),
  DATABASE_SSL: z.string().transform(Boolean).default('false'),
  DATABASE_POOL_MIN: z.string().transform(Number).default('2'),
  DATABASE_POOL_MAX: z.string().transform(Number).default('10'),
  DATABASE_TIMEOUT: z.string().transform(Number).default('30000'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().transform(Number).default('0'),
  REDIS_KEY_PREFIX: z.string().default('nova-ehr:'),

  // JWT & Authentication
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT refresh secret must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  JWT_ISSUER: z.string().default('nova-check-ehr'),
  JWT_AUDIENCE: z.string().default('nova-check-ehr-users'),

  // Encryption
  ENCRYPTION_KEY: z.string().min(32, 'Encryption key must be at least 32 characters'),
  ENCRYPTION_ALGORITHM: z.string().default('aes-256-gcm'),

  // Session
  SESSION_SECRET: z.string().min(32, 'Session secret must be at least 32 characters'),
  SESSION_MAX_AGE: z.string().transform(Number).default('86400000'), // 24 hours
  SESSION_SECURE: z.string().transform(Boolean).default('false'),

  // Password
  BCRYPT_ROUNDS: z.string().transform(Number).default('12'),
  PASSWORD_MIN_LENGTH: z.string().transform(Number).default('8'),
  PASSWORD_REQUIRE_UPPERCASE: z.string().transform(Boolean).default('true'),
  PASSWORD_REQUIRE_LOWERCASE: z.string().transform(Boolean).default('true'),
  PASSWORD_REQUIRE_NUMBERS: z.string().transform(Boolean).default('true'),
  PASSWORD_REQUIRE_SYMBOLS: z.string().transform(Boolean).default('true'),

  // Account Security
  MAX_LOGIN_ATTEMPTS: z.string().transform(Number).default('5'),
  ACCOUNT_LOCKOUT_DURATION: z.string().transform(Number).default('900000'), // 15 minutes
  PASSWORD_RESET_EXPIRES: z.string().transform(Number).default('3600000'), // 1 hour
  EMAIL_VERIFICATION_EXPIRES: z.string().transform(Number).default('86400000'), // 24 hours

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  CORS_CREDENTIALS: z.string().transform(Boolean).default('true'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),
  RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS: z.string().transform(Boolean).default('false'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FORMAT: z.enum(['json', 'simple']).default('json'),
  LOG_FILE_ENABLED: z.string().transform(Boolean).default('true'),
  LOG_FILE_PATH: z.string().default('./logs'),
  LOG_MAX_SIZE: z.string().default('20m'),
  LOG_MAX_FILES: z.string().transform(Number).default('14'),

  // File Storage
  STORAGE_TYPE: z.enum(['local', 'minio', 's3']).default('local'),
  UPLOAD_MAX_SIZE: z.string().transform(Number).default('10485760'), // 10MB
  UPLOAD_MAX_FILE_SIZE: z.string().transform(Number).default('10485760'),
  UPLOAD_ALLOWED_TYPES: z.string().default('image/jpeg,image/png,image/gif,application/pdf,text/plain'),
  UPLOAD_PATH: z.string().default('./uploads'),
  UPLOAD_DESTINATION: z.string().default('./uploads'),

  // MinIO
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.string().transform(Number).default('9000'),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_BUCKET: z.string().default('nova-ehr-files'),
  MINIO_USE_SSL: z.string().transform(Boolean).default('false'),

  // AWS S3
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),

  // FHIR Server
  FHIR_SERVER_URL: z.string().url().default('http://localhost:8080/fhir'),
  FHIR_SERVER_USERNAME: z.string().optional(),
  FHIR_SERVER_PASSWORD: z.string().optional(),
  FHIR_VERSION: z.string().default('R4'),

  // Email (SMTP)
  EMAIL_PROVIDER: z.enum(['smtp', 'aws-ses']).default('smtp'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.string().transform(Number).default('587'),
  SMTP_SECURE: z.string().transform(Boolean).default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM_NAME: z.string().default('Nova Check EHR'),
  SMTP_FROM_EMAIL: z.string().email().default('noreply@novacheck.com'),

  // External integrations
  EPIC_CLIENT_ID: z.string().optional(),
  EPIC_CLIENT_SECRET: z.string().optional(),
  EPIC_SANDBOX_URL: z.string().optional(),
  CERNER_CLIENT_ID: z.string().optional(),
  CERNER_CLIENT_SECRET: z.string().optional(),
  CERNER_SANDBOX_URL: z.string().optional(),
  ALLSCRIPTS_CLIENT_ID: z.string().optional(),
  ALLSCRIPTS_CLIENT_SECRET: z.string().optional(),
  ALLSCRIPTS_SANDBOX_URL: z.string().optional(),

  // Payment processing
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // Google services
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),

  // Microsoft Azure
  AZURE_CLIENT_ID: z.string().optional(),
  AZURE_CLIENT_SECRET: z.string().optional(),
  AZURE_TENANT_ID: z.string().optional(),

  // Monitoring and analytics
  SENTRY_ENVIRONMENT: z.string().optional(),
  NEW_RELIC_LICENSE_KEY: z.string().optional(),
  NEW_RELIC_APP_NAME: z.string().optional(),
  DATADOG_API_KEY: z.string().optional(),
  DATADOG_APP_KEY: z.string().optional(),

  // AI/ML Services
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4'),
  OPENAI_MAX_TOKENS: z.string().transform(Number).default('2000'),
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  GOOGLE_CLOUD_PROJECT_ID: z.string().optional(),
  GOOGLE_CLOUD_KEY_FILE: z.string().optional(),

  // Monitoring & Analytics
  ELASTICSEARCH_URL: z.string().default('http://localhost:9200'),
  ELASTICSEARCH_USERNAME: z.string().optional(),
  ELASTICSEARCH_PASSWORD: z.string().optional(),
  PROMETHEUS_PORT: z.string().transform(Number).default('9090'),
  SENTRY_DSN: z.string().optional(),
  GOOGLE_ANALYTICS_ID: z.string().optional(),

  // Payment Processing
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  SQUARE_APPLICATION_ID: z.string().optional(),
  SQUARE_ACCESS_TOKEN: z.string().optional(),
  SQUARE_WEBHOOK_SIGNATURE_KEY: z.string().optional(),

  // Communication Services
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  SLACK_WEBHOOK_URL: z.string().optional(),

  // SMS Configuration
  SMS_PROVIDER: z.enum(['twilio', 'aws-sns']).default('twilio'),
  SMS_FROM_NUMBER: z.string().optional(),

  // HIPAA & Compliance
  HIPAA_ENCRYPTION_ENABLED: z.string().transform(Boolean).default('true'),
  AUDIT_LOG_RETENTION_DAYS: z.string().transform(Number).default('2555'), // 7 years
  PHI_ACCESS_LOG_ENABLED: z.string().transform(Boolean).default('true'),
  BREACH_NOTIFICATION_EMAIL: z.string().email().optional(),
  COMPLIANCE_OFFICER_EMAIL: z.string().email().optional(),
  HIPAA_COMPLIANCE_MODE: z.string().transform(Boolean).default('true'),
  GDPR_COMPLIANCE_MODE: z.string().transform(Boolean).default('true'),
  AUDIT_LOG_ENABLED: z.string().transform(Boolean).default('true'),

  // Health check configuration
  HEALTH_CHECK_ENABLED: z.string().transform(Boolean).default('true'),
  HEALTH_CHECK_INTERVAL: z.string().transform(Number).default('30000'),
  HEALTH_CHECK_TIMEOUT: z.string().transform(Number).default('5000'),

  // System maintenance
  MAINTENANCE_MODE: z.string().transform(Boolean).default('false'),
  MAINTENANCE_MESSAGE: z.string().default('System is under maintenance. Please try again later.'),
  MAINTENANCE_ALLOWED_IPS: z.string().default('127.0.0.1,::1'),

  // Development & Testing
  ENABLE_API_DOCS: z.string().transform(Boolean).default('true'),
  ENABLE_PLAYGROUND: z.string().transform(Boolean).default('false'),
  MOCK_EXTERNAL_SERVICES: z.string().transform(Boolean).default('false'),
  SEED_DATABASE: z.string().transform(Boolean).default('false'),
  DEBUG_ENABLED: z.string().transform(Boolean).default('false'),
  DEBUG_NAMESPACE: z.string().default('nova:*'),

  // Feature Flags
  FEATURE_TELEMEDICINE: z.string().transform(Boolean).default('true'),
  FEATURE_AI_DOCUMENTATION: z.string().transform(Boolean).default('true'),
  FEATURE_VOICE_NOTES: z.string().transform(Boolean).default('false'),
  FEATURE_MOBILE_APP: z.string().transform(Boolean).default('false'),
  FEATURE_PATIENT_PORTAL: z.string().transform(Boolean).default('true'),

  // Performance & Caching
  CACHE_TTL_DEFAULT: z.string().transform(Number).default('300'), // 5 minutes
  CACHE_TTL_USER_SESSION: z.string().transform(Number).default('1800'), // 30 minutes
  CACHE_TTL_PATIENT_DATA: z.string().transform(Number).default('600'), // 10 minutes
  DATABASE_QUERY_TIMEOUT: z.string().transform(Number).default('30000'), // 30 seconds
  API_TIMEOUT: z.string().transform(Number).default('30000'), // 30 seconds

  // Backup & Disaster Recovery
  BACKUP_ENABLED: z.string().transform(Boolean).default('false'),
  BACKUP_SCHEDULE: z.string().default('0 2 * * *'), // Daily at 2 AM
  BACKUP_RETENTION_DAYS: z.string().transform(Number).default('30'),
  BACKUP_STORAGE_PATH: z.string().default('./backups'),

  // SSL/TLS
  SSL_ENABLED: z.string().transform(Boolean).default('false'),
  SSL_CERT_PATH: z.string().optional(),
  SSL_KEY_PATH: z.string().optional(),
  SSL_CA_PATH: z.string().optional(),
});

/**
 * Validate and parse environment variables
 */
const env = envSchema.parse(process.env);

/**
 * Application configuration object
 */
export const config = {
  // Application settings
  env: env.NODE_ENV,
  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  
  app: {
    name: env.APP_NAME,
    version: env.API_VERSION,
    url: env.APP_URL,
    apiUrl: env.API_URL,
  },

  server: {
    port: env.PORT,
    ssl: {
      enabled: env.SSL_ENABLED,
      certPath: env.SSL_CERT_PATH,
      keyPath: env.SSL_KEY_PATH,
      caPath: env.SSL_CA_PATH,
    },
  },

  // Database configuration
  database: {
    url: env.DATABASE_URL,
    ssl: env.DATABASE_SSL,
    pool: {
      min: env.DATABASE_POOL_MIN,
      max: env.DATABASE_POOL_MAX,
    },
    timeout: env.DATABASE_TIMEOUT,
    queryTimeout: env.DATABASE_QUERY_TIMEOUT,
  },

  // Redis configuration
  redis: {
    url: env.REDIS_URL,
    password: env.REDIS_PASSWORD,
    db: env.REDIS_DB,
    keyPrefix: env.REDIS_KEY_PREFIX,
  },

  // JWT configuration
  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
    refreshSecret: env.JWT_REFRESH_SECRET,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  },

  // Encryption configuration
  encryption: {
    key: env.ENCRYPTION_KEY,
    algorithm: env.ENCRYPTION_ALGORITHM,
  },

  // Session configuration
  session: {
    secret: env.SESSION_SECRET,
    maxAge: env.SESSION_MAX_AGE,
    secure: env.SESSION_SECURE,
  },

  // Password configuration
  password: {
    bcryptRounds: env.BCRYPT_ROUNDS,
    minLength: env.PASSWORD_MIN_LENGTH,
    requireUppercase: env.PASSWORD_REQUIRE_UPPERCASE,
    requireLowercase: env.PASSWORD_REQUIRE_LOWERCASE,
    requireNumbers: env.PASSWORD_REQUIRE_NUMBERS,
    requireSymbols: env.PASSWORD_REQUIRE_SYMBOLS,
  },

  // Security configuration
  security: {
    maxLoginAttempts: env.MAX_LOGIN_ATTEMPTS,
    accountLockoutDuration: env.ACCOUNT_LOCKOUT_DURATION,
    passwordResetExpires: env.PASSWORD_RESET_EXPIRES,
    emailVerificationExpires: env.EMAIL_VERIFICATION_EXPIRES,
  },

  // CORS configuration
  cors: {
    allowedOrigins: env.CORS_ORIGIN.split(',').map(origin => origin.trim()),
    credentials: env.CORS_CREDENTIALS,
  },

  // Rate limiting configuration
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS,
    skipSuccessfulRequests: env.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS,
  },

  // Logging configuration
  logging: {
    level: env.LOG_LEVEL,
    format: env.LOG_FORMAT,
    file: {
      enabled: env.LOG_FILE_ENABLED,
      path: env.LOG_FILE_PATH,
      maxSize: env.LOG_MAX_SIZE,
      maxFiles: env.LOG_MAX_FILES,
    },
  },

  // File storage configuration
  storage: {
    type: env.STORAGE_TYPE,
    upload: {
      maxSize: env.UPLOAD_MAX_SIZE,
      allowedTypes: env.UPLOAD_ALLOWED_TYPES.split(',').map(type => type.trim()),
      path: env.UPLOAD_PATH,
    },
    minio: {
      endpoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY,
      bucket: env.MINIO_BUCKET,
      useSSL: env.MINIO_USE_SSL,
    },
    aws: {
      region: env.AWS_REGION,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      bucket: env.AWS_S3_BUCKET,
    },
  },

  // Upload configuration (for backward compatibility)
  upload: {
    maxFileSize: env.UPLOAD_MAX_SIZE,
    allowedTypes: env.UPLOAD_ALLOWED_TYPES.split(',').map(type => type.trim()),
    path: env.UPLOAD_PATH,
  },

  // AWS configuration (for services)
  aws: {
    region: env.AWS_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    s3BucketName: env.AWS_S3_BUCKET,
    s3BackupBucket: env.AWS_S3_BUCKET,
  },

  // SMS configuration
  sms: {
    provider: env.SMS_PROVIDER,
    from: env.SMS_FROM_NUMBER,
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
    },
  },

  // FHIR configuration
  fhir: {
    serverUrl: env.FHIR_SERVER_URL,
    username: env.FHIR_SERVER_USERNAME,
    password: env.FHIR_SERVER_PASSWORD,
    version: env.FHIR_VERSION,
  },

  // Email configuration
  email: {
    provider: env.EMAIL_PROVIDER,
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    },
    from: {
      name: env.SMTP_FROM_NAME,
      email: env.SMTP_FROM_EMAIL,
    },
  },

  // External integrations
  integrations: {
    epic: {
      clientId: env.EPIC_CLIENT_ID,
      clientSecret: env.EPIC_CLIENT_SECRET,
      sandboxUrl: env.EPIC_SANDBOX_URL,
    },
    cerner: {
      clientId: env.CERNER_CLIENT_ID,
      clientSecret: env.CERNER_CLIENT_SECRET,
      sandboxUrl: env.CERNER_SANDBOX_URL,
    },
    allscripts: {
      clientId: env.ALLSCRIPTS_CLIENT_ID,
      clientSecret: env.ALLSCRIPTS_CLIENT_SECRET,
      sandboxUrl: env.ALLSCRIPTS_SANDBOX_URL,
    },
  },

  // Google services
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    mapsApiKey: env.GOOGLE_MAPS_API_KEY,
  },

  // Microsoft Azure
  azure: {
    clientId: env.AZURE_CLIENT_ID,
    clientSecret: env.AZURE_CLIENT_SECRET,
    tenantId: env.AZURE_TENANT_ID,
  },

  // AI/ML services
  ai: {
    openai: {
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      maxTokens: env.OPENAI_MAX_TOKENS,
    },
    azure: {
      endpoint: env.AZURE_OPENAI_ENDPOINT,
      apiKey: env.AZURE_OPENAI_API_KEY,
    },
    google: {
      projectId: env.GOOGLE_CLOUD_PROJECT_ID,
      keyFile: env.GOOGLE_CLOUD_KEY_FILE,
    },
  },

  // Monitoring configuration
  monitoring: {
    elasticsearch: {
      url: env.ELASTICSEARCH_URL,
      username: env.ELASTICSEARCH_USERNAME,
      password: env.ELASTICSEARCH_PASSWORD,
    },
    prometheus: {
      port: env.PROMETHEUS_PORT,
    },
    sentry: {
      dsn: env.SENTRY_DSN,
    },
    analytics: {
      googleAnalyticsId: env.GOOGLE_ANALYTICS_ID,
    },
  },

  // Payment processing
  payments: {
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    },
    square: {
      applicationId: env.SQUARE_APPLICATION_ID,
      accessToken: env.SQUARE_ACCESS_TOKEN,
      webhookSignatureKey: env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    },
  },

  // Communication services
  communications: {
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      phoneNumber: env.TWILIO_PHONE_NUMBER,
    },
    sendgrid: {
      apiKey: env.SENDGRID_API_KEY,
    },
    slack: {
      webhookUrl: env.SLACK_WEBHOOK_URL,
    },
  },

  // HIPAA & Compliance
  hipaa: {
    encryptionEnabled: env.HIPAA_ENCRYPTION_ENABLED,
    auditLogRetentionDays: env.AUDIT_LOG_RETENTION_DAYS,
    phiAccessLogEnabled: env.PHI_ACCESS_LOG_ENABLED,
    breachNotificationEmail: env.BREACH_NOTIFICATION_EMAIL,
    complianceOfficerEmail: env.COMPLIANCE_OFFICER_EMAIL,
    complianceMode: env.HIPAA_COMPLIANCE_MODE,
  },

  // Compliance
  compliance: {
    hipaa: env.HIPAA_COMPLIANCE_MODE,
    gdpr: env.GDPR_COMPLIANCE_MODE,
    auditLogEnabled: env.AUDIT_LOG_ENABLED,
  },

  // Health check
  healthCheck: {
    enabled: env.HEALTH_CHECK_ENABLED,
    interval: env.HEALTH_CHECK_INTERVAL,
    timeout: env.HEALTH_CHECK_TIMEOUT,
  },

  // System maintenance
  maintenance: {
    mode: env.MAINTENANCE_MODE,
    message: env.MAINTENANCE_MESSAGE,
    allowedIPs: env.MAINTENANCE_ALLOWED_IPS.split(',').map(ip => ip.trim()),
  },

  // Debug configuration
  debug: {
    enabled: env.DEBUG_ENABLED,
    namespace: env.DEBUG_NAMESPACE,
  },

  // Development settings
  development: {
    enableApiDocs: env.ENABLE_API_DOCS,
    enablePlayground: env.ENABLE_PLAYGROUND,
    mockExternalServices: env.MOCK_EXTERNAL_SERVICES,
    seedDatabase: env.SEED_DATABASE,
  },

  // Feature flags
  features: {
    telemedicine: env.FEATURE_TELEMEDICINE,
    aiDocumentation: env.FEATURE_AI_DOCUMENTATION,
    voiceNotes: env.FEATURE_VOICE_NOTES,
    mobileApp: env.FEATURE_MOBILE_APP,
    patientPortal: env.FEATURE_PATIENT_PORTAL,
  },

  // Performance & Caching
  cache: {
    ttl: {
      default: env.CACHE_TTL_DEFAULT,
      userSession: env.CACHE_TTL_USER_SESSION,
      patientData: env.CACHE_TTL_PATIENT_DATA,
    },
  },

  // API configuration
  api: {
    timeout: env.API_TIMEOUT,
  },

  // Backup configuration
  backup: {
    enabled: env.BACKUP_ENABLED,
    schedule: env.BACKUP_SCHEDULE,
    retentionDays: env.BACKUP_RETENTION_DAYS,
    storagePath: env.BACKUP_STORAGE_PATH,
  },
} as const;

// Export types
export type Config = typeof config;
export type Environment = typeof env.NODE_ENV;