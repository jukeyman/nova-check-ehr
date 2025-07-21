/**
 * ============================================================================
 * NOVA CHECK EHR - USER ROUTES
 * ============================================================================
 * 
 * User management routes for the Nova Check EHR API.
 * Handles user CRUD operations, authentication, and profile management.
 */

import { Router } from 'express';
import userRoutes from './userRoutes';

const router = Router();

// Mount all user routes
router.use('/', userRoutes);

export default router;