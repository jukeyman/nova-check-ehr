/**
 * ============================================================================
 * NOVA CHECK EHR - AUTHENTICATION ROUTES
 * ============================================================================
 * 
 * Authentication routes for the Nova Check EHR API.
 * Handles user login, registration, password reset, and token management.
 */

import { Router } from 'express';
import authRoutes from './authRoutes';

const router = Router();

// Mount all authentication routes
router.use('/', authRoutes);

export default router;