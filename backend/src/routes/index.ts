/**
 * ============================================================================
 * NOVA CHECK EHR - ROUTES INDEX
 * ============================================================================
 * 
 * Central routing configuration for the Nova Check EHR API.
 * Exports all route modules and provides route registration utilities.
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { createApiResponse, createErrorResponse } from '../models';

// ============================================================================
// ROUTE IMPORTS
// ============================================================================

import authRoutes from './auth';
import usersRoutes from './users';
import patientsRoutes from './patients';
import appointmentsRoutes from './appointments';
import clinicalRoutes from './clinical';
import notificationsRoutes from './notifications';
import invoicesRoutes from './invoices';
import insuranceRoutes from './insurance';
import filesRoutes from './files';
import reportsRoutes from './reports';
import analyticsRoutes from './analytics';
import auditRoutes from './audit';
import settingsRoutes from './settings';
import aiRoutes from './aiRoutes';

// ============================================================================
// MAIN ROUTER SETUP
// ============================================================================

const router = Router();

// ============================================================================
// API HEALTH CHECK
// ============================================================================

/**
 * @route   GET /api/health
 * @desc    API health check endpoint
 * @access  Public
 */
router.get('/health', (req: Request, res: Response) => {
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.API_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024 * 100) / 100,
      external: Math.round(process.memoryUsage().external / 1024 / 1024 * 100) / 100,
    },
    cpu: {
      usage: process.cpuUsage(),
    },
  };

  logger.debug('Health check requested', {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  res.json(
    createApiResponse(healthData, true, 'API is healthy')
  );
});

/**
 * @route   GET /api/version
 * @desc    API version information
 * @access  Public
 */
router.get('/version', (req: Request, res: Response) => {
  const versionData = {
    version: process.env.API_VERSION || '1.0.0',
    buildDate: process.env.BUILD_DATE || new Date().toISOString(),
    gitCommit: process.env.GIT_COMMIT || 'unknown',
    environment: process.env.NODE_ENV || 'development',
    features: {
      authentication: true,
      fileUpload: true,
      notifications: true,
      analytics: true,
      audit: true,
      reporting: true,
      insurance: true,
      billing: true,
    },
  };

  res.json(
    createApiResponse(versionData, true, 'Version information retrieved')
  );
});

// ============================================================================
// ROUTE REGISTRATION
// ============================================================================

/**
 * Register all API routes with their respective base paths
 */
const registerRoutes = () => {
  // Authentication routes
  router.use('/auth', authRoutes);
  
  // Core entity routes
  router.use('/users', usersRoutes);
  router.use('/patients', patientsRoutes);
  router.use('/appointments', appointmentsRoutes);
  router.use('/clinical', clinicalRoutes);
  
  // Communication and notifications
  router.use('/notifications', notificationsRoutes);
  
  // Financial and billing
  router.use('/invoices', invoicesRoutes);
  router.use('/insurance', insuranceRoutes);
  
  // File and document management
  router.use('/files', filesRoutes);
  
  // Reporting and analytics
  router.use('/reports', reportsRoutes);
  router.use('/analytics', analyticsRoutes);
  
  // System management
  router.use('/audit', auditRoutes);
  router.use('/settings', settingsRoutes);
  
  // AI and ML services
  router.use('/ai', aiRoutes);
  
  logger.info('All API routes registered successfully');
};

// Register all routes
registerRoutes();

// ============================================================================
// CATCH-ALL ROUTE
// ============================================================================

/**
 * @route   * /api/*
 * @desc    Catch-all route for undefined endpoints
 * @access  Public
 */
router.all('*', (req: Request, res: Response) => {
  logger.warn('API endpoint not found', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  res.status(404).json(
    createErrorResponse(
      `API endpoint not found: ${req.method} ${req.path}`,
      'The requested API endpoint does not exist. Please check the API documentation.'
    )
  );
});

// ============================================================================
// EXPORTS
// ============================================================================

export default router;
export {
  authRoutes,
  usersRoutes,
  patientsRoutes,
  appointmentsRoutes,
  clinicalRoutes,
  notificationsRoutes,
  invoicesRoutes,
  insuranceRoutes,
  filesRoutes,
  reportsRoutes,
  analyticsRoutes,
  auditRoutes,
  settingsRoutes,
  aiRoutes,
};