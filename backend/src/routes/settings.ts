/**
 * ============================================================================
 * NOVA CHECK EHR - SETTINGS ROUTES
 * ============================================================================
 * 
 * RESTful API routes for system configuration, user preferences, and application settings.
 * Handles settings management, validation, and import/export.
 */

import { Router, Request, Response } from 'express';
import { query, body, param, validationResult } from 'express-validator';
import { SettingsModel, createApiResponse, createErrorResponse, validatePagination, calculatePagination } from '../models';
import { authenticateToken, requireRole } from '../middleware/auth';
import { createAuditMiddleware } from '../models/Audit';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';
import { CacheService } from '../services/CacheService';
import multer from 'multer';

// ============================================================================
// ROUTER SETUP
// ============================================================================

const router = Router();
const prisma = new PrismaClient();
const cacheService = new CacheService();
const settingsModel = new SettingsModel(prisma, cacheService);
const auditMiddleware = createAuditMiddleware(prisma);

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/json' || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Only JSON files are allowed'));
    }
  },
});

// ============================================================================
// VALIDATION RULES
// ============================================================================

const settingsSearchValidation = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('search').optional().trim(),
  query('category').optional().trim(),
  query('scope').optional().isIn(['SYSTEM', 'USER', 'ORGANIZATION']),
  query('isPublic').optional().isBoolean(),
  query('isRequired').optional().isBoolean(),
];

const settingValidation = [
  body('key').notEmpty().trim().matches(/^[a-zA-Z0-9._-]+$/),
  body('value').exists(),
  body('category').optional().trim(),
  body('description').optional().trim(),
  body('scope').optional().isIn(['SYSTEM', 'USER', 'ORGANIZATION']),
  body('dataType').optional().isIn(['STRING', 'NUMBER', 'BOOLEAN', 'JSON', 'ARRAY']),
  body('isPublic').optional().isBoolean(),
  body('isRequired').optional().isBoolean(),
  body('validationRules').optional().isObject(),
];

const settingUpdateValidation = [
  body('value').exists(),
  body('description').optional().trim(),
  body('isPublic').optional().isBoolean(),
  body('isRequired').optional().isBoolean(),
  body('validationRules').optional().isObject(),
];

const userPreferencesValidation = [
  body('theme').optional().isIn(['light', 'dark', 'auto']),
  body('language').optional().isIn(['en', 'es', 'fr', 'de', 'zh']),
  body('timezone').optional().trim(),
  body('dateFormat').optional().isIn(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']),
  body('timeFormat').optional().isIn(['12h', '24h']),
  body('notifications').optional().isObject(),
  body('dashboard').optional().isObject(),
  body('accessibility').optional().isObject(),
];

const systemSettingsValidation = [
  body('organizationName').optional().trim(),
  body('organizationLogo').optional().isURL(),
  body('contactEmail').optional().isEmail(),
  body('contactPhone').optional().trim(),
  body('address').optional().isObject(),
  body('businessHours').optional().isObject(),
  body('appointmentSettings').optional().isObject(),
  body('securitySettings').optional().isObject(),
  body('integrationSettings').optional().isObject(),
  body('backupSettings').optional().isObject(),
];

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Validate request and handle errors
 */
const handleValidation = (req: Request, res: Response, next: any) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(
      createErrorResponse('Validation failed', errors.array().map(e => e.msg).join(', '))
    );
  }
  next();
};

/**
 * Check settings access permissions
 */
const checkSettingsAccess = (scope: string) => {
  return (req: Request, res: Response, next: any) => {
    const user = (req as any).user;
    
    if (scope === 'SYSTEM' && !['ADMIN'].includes(user.role)) {
      return res.status(403).json(
        createErrorResponse('Insufficient permissions to access system settings')
      );
    }
    
    if (scope === 'ORGANIZATION' && !['ADMIN', 'MANAGER'].includes(user.role)) {
      return res.status(403).json(
        createErrorResponse('Insufficient permissions to access organization settings')
      );
    }
    
    next();
  };
};

/**
 * Check if user can modify setting
 */
const checkSettingModifyPermission = async (req: Request, res: Response, next: any) => {
  try {
    const { key } = req.params;
    const user = (req as any).user;
    
    const setting = await settingsModel.getSetting(key);
    
    if (!setting) {
      return res.status(404).json(
        createErrorResponse('Setting not found')
      );
    }
    
    if (setting.scope === 'SYSTEM' && !['ADMIN'].includes(user.role)) {
      return res.status(403).json(
        createErrorResponse('Insufficient permissions to modify system settings')
      );
    }
    
    if (setting.scope === 'ORGANIZATION' && !['ADMIN', 'MANAGER'].includes(user.role)) {
      return res.status(403).json(
        createErrorResponse('Insufficient permissions to modify organization settings')
      );
    }
    
    (req as any).setting = setting;
    next();
  } catch (error) {
    logger.error('Error checking setting modify permission:', error);
    res.status(500).json(
      createErrorResponse('Failed to check permissions')
    );
  }
};

// ============================================================================
// SETTINGS ROUTES
// ============================================================================

/**
 * @route   GET /api/settings
 * @desc    Get settings with search and pagination
 * @access  Private (Admin, Manager, Staff)
 */
router.get('/',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STAFF']),
  settingsSearchValidation,
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        category,
        scope,
        isPublic,
        isRequired,
      } = req.query;

      const pagination = validatePagination(page as number, limit as number);
      
      const filters = {
        search: search as string,
        category: category as string,
        scope: scope as any,
        isPublic: isPublic === 'true' ? true : isPublic === 'false' ? false : undefined,
        isRequired: isRequired === 'true' ? true : isRequired === 'false' ? false : undefined,
      };

      const result = await settingsModel.findMany(filters, pagination);
      const paginationInfo = calculatePagination(result.total, pagination.page, pagination.limit);

      res.json(
        createApiResponse(
          {
            settings: result.settings,
            pagination: paginationInfo,
          },
          true,
          'Settings retrieved successfully'
        )
      );
    } catch (error) {
      logger.error('Error fetching settings:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch settings')
      );
    }
  }
);

/**
 * @route   GET /api/settings/:key
 * @desc    Get specific setting by key
 * @access  Private (Admin, Manager, Staff)
 */
router.get('/:key',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STAFF']),
  param('key').notEmpty().trim(),
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const { key } = req.params;
      const user = (req as any).user;

      const setting = await settingsModel.getSetting(key, user.id);

      if (!setting) {
        return res.status(404).json(
          createErrorResponse('Setting not found')
        );
      }

      // Check if user has permission to view this setting
      if (!setting.isPublic && setting.scope === 'SYSTEM' && !['ADMIN'].includes(user.role)) {
        return res.status(403).json(
          createErrorResponse('Insufficient permissions to view this setting')
        );
      }

      res.json(
        createApiResponse(setting, true, 'Setting retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching setting:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch setting')
      );
    }
  }
);

/**
 * @route   POST /api/settings
 * @desc    Create new setting
 * @access  Private (Admin only)
 */
router.post('/',
  authenticateToken,
  requireRole(['ADMIN']),
  settingValidation,
  handleValidation,
  auditMiddleware('SETTING_CREATE'),
  async (req: Request, res: Response) => {
    try {
      const settingData = req.body;
      const userId = (req as any).user.id;

      const setting = await settingsModel.setSetting(
        settingData.key,
        settingData.value,
        {
          category: settingData.category,
          description: settingData.description,
          scope: settingData.scope || 'SYSTEM',
          dataType: settingData.dataType,
          isPublic: settingData.isPublic,
          isRequired: settingData.isRequired,
          validationRules: settingData.validationRules,
          userId,
        }
      );

      res.status(201).json(
        createApiResponse(setting, true, 'Setting created successfully')
      );
    } catch (error) {
      logger.error('Error creating setting:', error);
      
      if (error instanceof Error && error.message.includes('already exists')) {
        return res.status(409).json(
          createErrorResponse('Setting with this key already exists')
        );
      }
      
      res.status(500).json(
        createErrorResponse('Failed to create setting')
      );
    }
  }
);

/**
 * @route   PUT /api/settings/:key
 * @desc    Update setting
 * @access  Private (Admin, Manager)
 */
router.put('/:key',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  param('key').notEmpty().trim(),
  settingUpdateValidation,
  handleValidation,
  checkSettingModifyPermission,
  auditMiddleware('SETTING_UPDATE'),
  async (req: Request, res: Response) => {
    try {
      const { key } = req.params;
      const updateData = req.body;
      const userId = (req as any).user.id;

      const setting = await settingsModel.updateSetting(key, updateData, userId);

      res.json(
        createApiResponse(setting, true, 'Setting updated successfully')
      );
    } catch (error) {
      logger.error('Error updating setting:', error);
      
      if (error instanceof Error && error.message.includes('validation failed')) {
        return res.status(400).json(
          createErrorResponse('Setting validation failed', error.message)
        );
      }
      
      res.status(500).json(
        createErrorResponse('Failed to update setting')
      );
    }
  }
);

/**
 * @route   DELETE /api/settings/:key
 * @desc    Delete setting
 * @access  Private (Admin only)
 */
router.delete('/:key',
  authenticateToken,
  requireRole(['ADMIN']),
  param('key').notEmpty().trim(),
  handleValidation,
  checkSettingModifyPermission,
  auditMiddleware('SETTING_DELETE'),
  async (req: Request, res: Response) => {
    try {
      const { key } = req.params;
      const setting = (req as any).setting;

      if (setting.isRequired) {
        return res.status(400).json(
          createErrorResponse('Cannot delete required setting')
        );
      }

      await settingsModel.deleteSetting(key);

      res.json(
        createApiResponse(null, true, 'Setting deleted successfully')
      );
    } catch (error) {
      logger.error('Error deleting setting:', error);
      res.status(500).json(
        createErrorResponse('Failed to delete setting')
      );
    }
  }
);

// ============================================================================
// USER PREFERENCES ROUTES
// ============================================================================

/**
 * @route   GET /api/settings/preferences
 * @desc    Get user preferences
 * @access  Private (All authenticated users)
 */
router.get('/preferences',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      const preferences = await settingsModel.getUserPreferences(userId);

      res.json(
        createApiResponse(preferences, true, 'User preferences retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching user preferences:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch user preferences')
      );
    }
  }
);

/**
 * @route   PUT /api/settings/preferences
 * @desc    Update user preferences
 * @access  Private (All authenticated users)
 */
router.put('/preferences',
  authenticateToken,
  userPreferencesValidation,
  handleValidation,
  auditMiddleware('USER_PREFERENCES_UPDATE'),
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      const preferencesData = req.body;

      const preferences = await settingsModel.updateUserPreferences(userId, preferencesData);

      res.json(
        createApiResponse(preferences, true, 'User preferences updated successfully')
      );
    } catch (error) {
      logger.error('Error updating user preferences:', error);
      res.status(500).json(
        createErrorResponse('Failed to update user preferences')
      );
    }
  }
);

/**
 * @route   DELETE /api/settings/preferences
 * @desc    Reset user preferences to defaults
 * @access  Private (All authenticated users)
 */
router.delete('/preferences',
  authenticateToken,
  auditMiddleware('USER_PREFERENCES_RESET'),
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      await settingsModel.deleteUserPreferences(userId);

      res.json(
        createApiResponse(null, true, 'User preferences reset to defaults')
      );
    } catch (error) {
      logger.error('Error resetting user preferences:', error);
      res.status(500).json(
        createErrorResponse('Failed to reset user preferences')
      );
    }
  }
);

// ============================================================================
// SYSTEM SETTINGS ROUTES
// ============================================================================

/**
 * @route   GET /api/settings/system
 * @desc    Get system settings
 * @access  Private (Admin, Manager)
 */
router.get('/system',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  async (req: Request, res: Response) => {
    try {
      const settings = await settingsModel.getSystemSettings();

      res.json(
        createApiResponse(settings, true, 'System settings retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching system settings:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch system settings')
      );
    }
  }
);

/**
 * @route   PUT /api/settings/system
 * @desc    Update system settings
 * @access  Private (Admin only)
 */
router.put('/system',
  authenticateToken,
  requireRole(['ADMIN']),
  systemSettingsValidation,
  handleValidation,
  auditMiddleware('SYSTEM_SETTINGS_UPDATE'),
  async (req: Request, res: Response) => {
    try {
      const settingsData = req.body;
      const userId = (req as any).user.id;

      const settings = await settingsModel.updateSystemSettings(settingsData, userId);

      res.json(
        createApiResponse(settings, true, 'System settings updated successfully')
      );
    } catch (error) {
      logger.error('Error updating system settings:', error);
      res.status(500).json(
        createErrorResponse('Failed to update system settings')
      );
    }
  }
);

// ============================================================================
// CATEGORIES ROUTES
// ============================================================================

/**
 * @route   GET /api/settings/categories
 * @desc    Get all setting categories
 * @access  Private (Admin, Manager, Staff)
 */
router.get('/categories',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STAFF']),
  async (req: Request, res: Response) => {
    try {
      const categories = await settingsModel.getCategories();

      res.json(
        createApiResponse(categories, true, 'Setting categories retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching setting categories:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch setting categories')
      );
    }
  }
);

/**
 * @route   GET /api/settings/categories/:category
 * @desc    Get settings by category
 * @access  Private (Admin, Manager, Staff)
 */
router.get('/categories/:category',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER', 'STAFF']),
  param('category').notEmpty().trim(),
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const { category } = req.params;
      const user = (req as any).user;

      const settings = await settingsModel.getSettingsByCategory(category, user.id);

      res.json(
        createApiResponse(settings, true, `Settings for category '${category}' retrieved successfully`)
      );
    } catch (error) {
      logger.error('Error fetching settings by category:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch settings by category')
      );
    }
  }
);

// ============================================================================
// TEMPLATES ROUTES
// ============================================================================

/**
 * @route   GET /api/settings/templates
 * @desc    Get setting templates
 * @access  Private (Admin only)
 */
router.get('/templates',
  authenticateToken,
  requireRole(['ADMIN']),
  async (req: Request, res: Response) => {
    try {
      const templates = await settingsModel.getTemplates();

      res.json(
        createApiResponse(templates, true, 'Setting templates retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching setting templates:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch setting templates')
      );
    }
  }
);

/**
 * @route   POST /api/settings/templates/:templateId/apply
 * @desc    Apply setting template
 * @access  Private (Admin only)
 */
router.post('/templates/:templateId/apply',
  authenticateToken,
  requireRole(['ADMIN']),
  param('templateId').isUUID(),
  handleValidation,
  auditMiddleware('SETTING_TEMPLATE_APPLY'),
  async (req: Request, res: Response) => {
    try {
      const { templateId } = req.params;
      const userId = (req as any).user.id;

      const result = await settingsModel.applyTemplate(templateId, userId);

      res.json(
        createApiResponse(result, true, 'Setting template applied successfully')
      );
    } catch (error) {
      logger.error('Error applying setting template:', error);
      res.status(500).json(
        createErrorResponse('Failed to apply setting template')
      );
    }
  }
);

// ============================================================================
// IMPORT/EXPORT ROUTES
// ============================================================================

/**
 * @route   GET /api/settings/export
 * @desc    Export settings
 * @access  Private (Admin only)
 */
router.get('/export',
  authenticateToken,
  requireRole(['ADMIN']),
  [
    query('scope').optional().isIn(['SYSTEM', 'USER', 'ORGANIZATION']),
    query('category').optional().trim(),
    query('format').optional().isIn(['json', 'yaml']),
  ],
  handleValidation,
  auditMiddleware('SETTINGS_EXPORT'),
  async (req: Request, res: Response) => {
    try {
      const {
        scope,
        category,
        format = 'json',
      } = req.query;

      const options = {
        scope: scope as any,
        category: category as string,
        format: format as string,
      };

      const exportData = await settingsModel.exportSettings(options);

      // Set appropriate headers
      const contentType = format === 'yaml' ? 'text/yaml' : 'application/json';
      const extension = format === 'yaml' ? 'yaml' : 'json';
      const filename = `settings_export_${new Date().toISOString().split('T')[0]}.${extension}`;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      if (format === 'json') {
        res.json(exportData);
      } else {
        // For YAML, you would use a YAML library to convert
        res.json({ message: 'YAML export not implemented', data: exportData });
      }

      logger.info('Settings exported', {
        exportedBy: (req as any).user.id,
        options,
      });
    } catch (error) {
      logger.error('Error exporting settings:', error);
      res.status(500).json(
        createErrorResponse('Failed to export settings')
      );
    }
  }
);

/**
 * @route   POST /api/settings/import
 * @desc    Import settings
 * @access  Private (Admin only)
 */
router.post('/import',
  authenticateToken,
  requireRole(['ADMIN']),
  upload.single('file'),
  [
    body('overwrite').optional().isBoolean(),
    body('validateOnly').optional().isBoolean(),
  ],
  handleValidation,
  auditMiddleware('SETTINGS_IMPORT'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json(
          createErrorResponse('No file uploaded')
        );
      }

      const {
        overwrite = false,
        validateOnly = false,
      } = req.body;

      const fileContent = req.file.buffer.toString('utf8');
      let settingsData;

      try {
        settingsData = JSON.parse(fileContent);
      } catch (parseError) {
        return res.status(400).json(
          createErrorResponse('Invalid JSON file')
        );
      }

      const options = {
        overwrite: overwrite === 'true',
        validateOnly: validateOnly === 'true',
        userId: (req as any).user.id,
      };

      const result = await settingsModel.importSettings(settingsData, options);

      res.json(
        createApiResponse(
          result,
          true,
          validateOnly === 'true' 
            ? 'Settings validation completed'
            : 'Settings imported successfully'
        )
      );

      logger.info('Settings imported', {
        importedBy: (req as any).user.id,
        options,
        importedCount: result.imported?.length || 0,
        skippedCount: result.skipped?.length || 0,
        errorCount: result.errors?.length || 0,
      });
    } catch (error) {
      logger.error('Error importing settings:', error);
      res.status(500).json(
        createErrorResponse('Failed to import settings')
      );
    }
  }
);

// ============================================================================
// VALIDATION ROUTES
// ============================================================================

/**
 * @route   POST /api/settings/validate
 * @desc    Validate setting value
 * @access  Private (Admin, Manager)
 */
router.post('/validate',
  authenticateToken,
  requireRole(['ADMIN', 'MANAGER']),
  [
    body('key').notEmpty().trim(),
    body('value').exists(),
  ],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const { key, value } = req.body;

      const result = await settingsModel.validateSetting(key, value);

      res.json(
        createApiResponse(result, true, 'Setting validation completed')
      );
    } catch (error) {
      logger.error('Error validating setting:', error);
      res.status(500).json(
        createErrorResponse('Failed to validate setting')
      );
    }
  }
);

// ============================================================================
// CACHE MANAGEMENT ROUTES
// ============================================================================

/**
 * @route   DELETE /api/settings/cache
 * @desc    Clear settings cache
 * @access  Private (Admin only)
 */
router.delete('/cache',
  authenticateToken,
  requireRole(['ADMIN']),
  auditMiddleware('SETTINGS_CACHE_CLEAR'),
  async (req: Request, res: Response) => {
    try {
      await settingsModel.clearCache();

      logger.info('Settings cache cleared', {
        clearedBy: (req as any).user.id,
      });

      res.json(
        createApiResponse(null, true, 'Settings cache cleared successfully')
      );
    } catch (error) {
      logger.error('Error clearing settings cache:', error);
      res.status(500).json(
        createErrorResponse('Failed to clear settings cache')
      );
    }
  }
);

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Global error handler for settings routes
 */
router.use((error: any, req: Request, res: Response, next: any) => {
  logger.error('Settings route error:', error);
  
  if (error.message && error.message.includes('validation failed')) {
    return res.status(400).json(
      createErrorResponse('Setting validation failed', error.message)
    );
  }
  
  if (error.message && error.message.includes('already exists')) {
    return res.status(409).json(
      createErrorResponse('Setting already exists')
    );
  }
  
  if (error.message && error.message.includes('Only JSON files are allowed')) {
    return res.status(400).json(
      createErrorResponse('Only JSON files are allowed for import')
    );
  }
  
  res.status(500).json(
    createErrorResponse('Internal server error')
  );
});

// ============================================================================
// EXPORTS
// ============================================================================

export default router;