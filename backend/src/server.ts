/**
 * ============================================================================
 * NOVA CHECK EHR - SERVER ENTRY POINT
 * ============================================================================
 */

import 'dotenv/config';
import App from './app';
import logger from './config/logger';
// Import config after dotenv is loaded
const { config } = require('./config/config');

/**
 * Main server entry point
 */
async function main(): Promise<void> {
  try {
    // Log startup information
    logger.info('🏥 Starting Nova Check EHR System...', {
      version: '1.0.0',
      environment: config.env,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      timestamp: new Date().toISOString(),
    });

    // Validate environment
    validateEnvironment();

    // Create and start application
    const app = new App();
    await app.start();

    logger.info('✅ Nova Check EHR System started successfully');
  } catch (error) {
    logger.error('❌ Failed to start Nova Check EHR System', { error });
    process.exit(1);
  }
}

/**
 * Validate required environment variables
 */
function validateEnvironment(): void {
  const requiredEnvVars = [
    'DATABASE_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'ENCRYPTION_KEY',
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    logger.error('Missing required environment variables', {
      missingVars,
      requiredVars: requiredEnvVars,
    });
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  // Validate JWT secrets are different
  if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
    logger.error('JWT_SECRET and JWT_REFRESH_SECRET must be different');
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different');
  }

  // Validate encryption key length
  if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length < 32) {
    logger.error('ENCRYPTION_KEY must be at least 32 characters long');
    throw new Error('ENCRYPTION_KEY must be at least 32 characters long');
  }

  logger.info('Environment validation passed');
}

// Start the server
if (require.main === module) {
  main().catch((error) => {
    logger.error('Fatal error during startup', { error });
    process.exit(1);
  });
}

export default main;