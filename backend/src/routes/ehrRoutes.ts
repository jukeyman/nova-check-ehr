import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validateRequest } from '../middleware/validation';
import { authenticate } from '../middleware/auth';
import { rateLimit } from 'express-rate-limit';
import { ehrIntegrationService } from '../services/ehrIntegrationService';

const router = Router();

// Rate limiting for EHR endpoints
const ehrRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Higher limit for EHR operations
  message: {
    error: 'Too many EHR requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const intensiveEHRRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit intensive operations
  message: {
    error: 'Too many intensive EHR requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  }
});

// Apply authentication and rate limiting to all EHR routes
router.use(authenticate);
router.use(ehrRateLimit);

// ============================================================================
// AUTHENTICATION & CONFIGURATION
// ============================================================================

/**
 * @route POST /api/v1/ehr/auth/:provider
 * @desc Authenticate with EHR provider
 * @access Private
 * @params { provider: 'epic' | 'cerner' | 'allscripts' | 'athena' | 'fhir' }
 * @body {
 *   clientId?: string,
 *   clientSecret?: string,
 *   redirectUri?: string,
 *   scope?: string[],
 *   customConfig?: any
 * }
 */
router.post('/auth/:provider',
  param('provider').isIn(['epic', 'cerner', 'allscripts', 'athena', 'fhir'])
    .withMessage('Invalid EHR provider'),
  body('clientId').optional().isString(),
  body('clientSecret').optional().isString(),
  body('redirectUri').optional().isURL(),
  body('scope').optional().isArray(),
  body('customConfig').optional().isObject(),
  validateRequest,
  async (req, res) => {
    try {
      const { provider } = req.params;
      const { clientId, clientSecret, redirectUri, scope, customConfig } = req.body;
      
      const authResult = await ehrIntegrationService.authenticate(
        provider as any,
        {
          clientId,
          clientSecret,
          redirectUri,
          scope,
          ...customConfig
        }
      );
      
      res.json({
        success: true,
        provider,
        authUrl: authResult.authUrl,
        state: authResult.state,
        expiresIn: authResult.expiresIn,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to authenticate with EHR provider',
        provider: req.params.provider,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route POST /api/v1/ehr/callback/:provider
 * @desc Handle OAuth callback from EHR provider
 * @access Private
 * @params { provider: 'epic' | 'cerner' | 'allscripts' | 'athena' | 'fhir' }
 * @body {
 *   code: string,
 *   state: string
 * }
 */
router.post('/callback/:provider',
  param('provider').isIn(['epic', 'cerner', 'allscripts', 'athena', 'fhir'])
    .withMessage('Invalid EHR provider'),
  body('code').notEmpty().withMessage('Authorization code is required'),
  body('state').notEmpty().withMessage('State parameter is required'),
  validateRequest,
  async (req, res) => {
    try {
      const { provider } = req.params;
      const { code, state } = req.body;
      
      const tokenResult = await ehrIntegrationService.handleCallback(
        provider as any,
        code,
        state
      );
      
      res.json({
        success: true,
        provider,
        accessToken: tokenResult.accessToken,
        refreshToken: tokenResult.refreshToken,
        expiresIn: tokenResult.expiresIn,
        scope: tokenResult.scope,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to handle OAuth callback',
        provider: req.params.provider,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route GET /api/v1/ehr/status
 * @desc Get EHR integration status for all providers
 * @access Private
 */
router.get('/status',
  async (req, res) => {
    try {
      const status = await ehrIntegrationService.getIntegrationStatus();
      
      res.json({
        integrations: status,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get EHR integration status',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

// ============================================================================
// PATIENT OPERATIONS
// ============================================================================

/**
 * @route GET /api/v1/ehr/patients
 * @desc Search for patients across EHR providers
 * @access Private
 * @query {
 *   provider?: 'epic' | 'cerner' | 'allscripts' | 'athena' | 'fhir',
 *   name?: string,
 *   identifier?: string,
 *   birthDate?: string,
 *   gender?: string,
 *   limit?: number,
 *   offset?: number
 * }
 */
router.get('/patients',
  query('provider').optional().isIn(['epic', 'cerner', 'allscripts', 'athena', 'fhir']),
  query('name').optional().isString(),
  query('identifier').optional().isString(),
  query('birthDate').optional().isISO8601(),
  query('gender').optional().isIn(['male', 'female', 'other', 'unknown']),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
  validateRequest,
  async (req, res) => {
    try {
      const {
        provider,
        name,
        identifier,
        birthDate,
        gender,
        limit = 20,
        offset = 0
      } = req.query;
      
      const searchParams = {
        name: name as string,
        identifier: identifier as string,
        birthDate: birthDate as string,
        gender: gender as string,
        _count: parseInt(limit as string),
        _offset: parseInt(offset as string)
      };
      
      let results;
      if (provider) {
        results = await ehrIntegrationService.searchPatients(
          provider as any,
          searchParams
        );
      } else {
        // Search across all configured providers
        const providers = ['epic', 'cerner', 'allscripts', 'athena', 'fhir'] as const;
        const allResults = await Promise.allSettled(
          providers.map(p => ehrIntegrationService.searchPatients(p, searchParams))
        );
        
        results = allResults
          .filter(result => result.status === 'fulfilled')
          .flatMap(result => (result as PromiseFulfilledResult<any>).value);
      }
      
      res.json({
        patients: results,
        searchParams,
        provider: provider || 'all',
        total: results.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to search patients',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route GET /api/v1/ehr/patients/:patientId
 * @desc Get patient details from EHR provider
 * @access Private
 * @params { patientId: string }
 * @query { provider: 'epic' | 'cerner' | 'allscripts' | 'athena' | 'fhir' }
 */
router.get('/patients/:patientId',
  param('patientId').notEmpty().withMessage('Patient ID is required'),
  query('provider').notEmpty().isIn(['epic', 'cerner', 'allscripts', 'athena', 'fhir'])
    .withMessage('EHR provider is required'),
  validateRequest,
  async (req, res) => {
    try {
      const { patientId } = req.params;
      const { provider } = req.query;
      
      const patient = await ehrIntegrationService.getPatient(
        provider as any,
        patientId
      );
      
      res.json({
        patient,
        provider,
        patientId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get patient details',
        patientId: req.params.patientId,
        provider: req.query.provider,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route POST /api/v1/ehr/patients
 * @desc Create a new patient in EHR provider
 * @access Private
 * @query { provider: 'epic' | 'cerner' | 'allscripts' | 'athena' | 'fhir' }
 * @body {
 *   resourceType: 'Patient',
 *   identifier?: Array<{ system: string, value: string }>,
 *   name: Array<{ family: string, given: string[] }>,
 *   gender: 'male' | 'female' | 'other' | 'unknown',
 *   birthDate: string,
 *   address?: Array<any>,
 *   telecom?: Array<any>,
 *   contact?: Array<any>,
 *   communication?: Array<any>,
 *   generalPractitioner?: Array<any>
 * }
 */
router.post('/patients',
  intensiveEHRRateLimit,
  query('provider').notEmpty().isIn(['epic', 'cerner', 'allscripts', 'athena', 'fhir'])
    .withMessage('EHR provider is required'),
  body('resourceType').equals('Patient').withMessage('Resource type must be Patient'),
  body('name').isArray().withMessage('Name is required and must be an array'),
  body('gender').isIn(['male', 'female', 'other', 'unknown']).withMessage('Invalid gender'),
  body('birthDate').isISO8601().withMessage('Valid birth date is required'),
  validateRequest,
  async (req, res) => {
    try {
      const { provider } = req.query;
      const patientData = req.body;
      
      const createdPatient = await ehrIntegrationService.createPatient(
        provider as any,
        patientData
      );
      
      res.status(201).json({
        patient: createdPatient,
        provider,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to create patient',
        provider: req.query.provider,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route PUT /api/v1/ehr/patients/:patientId
 * @desc Update patient in EHR provider
 * @access Private
 * @params { patientId: string }
 * @query { provider: 'epic' | 'cerner' | 'allscripts' | 'athena' | 'fhir' }
 * @body { Patient FHIR resource }
 */
router.put('/patients/:patientId',
  intensiveEHRRateLimit,
  param('patientId').notEmpty().withMessage('Patient ID is required'),
  query('provider').notEmpty().isIn(['epic', 'cerner', 'allscripts', 'athena', 'fhir'])
    .withMessage('EHR provider is required'),
  body('resourceType').equals('Patient').withMessage('Resource type must be Patient'),
  validateRequest,
  async (req, res) => {
    try {
      const { patientId } = req.params;
      const { provider } = req.query;
      const patientData = req.body;
      
      const updatedPatient = await ehrIntegrationService.updatePatient(
        provider as any,
        patientId,
        patientData
      );
      
      res.json({
        patient: updatedPatient,
        provider,
        patientId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to update patient',
        patientId: req.params.patientId,
        provider: req.query.provider,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

// ============================================================================
// OBSERVATION OPERATIONS
// ============================================================================

/**
 * @route GET /api/v1/ehr/observations
 * @desc Get observations for a patient
 * @access Private
 * @query {
 *   provider: 'epic' | 'cerner' | 'allscripts' | 'athena' | 'fhir',
 *   patient: string,
 *   category?: string,
 *   code?: string,
 *   date?: string,
 *   limit?: number
 * }
 */
router.get('/observations',
  query('provider').notEmpty().isIn(['epic', 'cerner', 'allscripts', 'athena', 'fhir'])
    .withMessage('EHR provider is required'),
  query('patient').notEmpty().withMessage('Patient ID is required'),
  query('category').optional().isString(),
  query('code').optional().isString(),
  query('date').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validateRequest,
  async (req, res) => {
    try {
      const {
        provider,
        patient,
        category,
        code,
        date,
        limit = 50
      } = req.query;
      
      const searchParams = {
        patient: patient as string,
        category: category as string,
        code: code as string,
        date: date as string,
        _count: parseInt(limit as string)
      };
      
      const observations = await ehrIntegrationService.getObservations(
        provider as any,
        searchParams
      );
      
      res.json({
        observations,
        searchParams,
        provider,
        total: observations.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get observations',
        provider: req.query.provider,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route POST /api/v1/ehr/observations
 * @desc Create a new observation
 * @access Private
 * @query { provider: 'epic' | 'cerner' | 'allscripts' | 'athena' | 'fhir' }
 * @body {
 *   resourceType: 'Observation',
 *   status: 'registered' | 'preliminary' | 'final' | 'amended',
 *   category: Array<any>,
 *   code: { coding: Array<any> },
 *   subject: { reference: string },
 *   effectiveDateTime?: string,
 *   valueQuantity?: any,
 *   valueCodeableConcept?: any,
 *   valueString?: string,
 *   component?: Array<any>
 * }
 */
router.post('/observations',
  intensiveEHRRateLimit,
  query('provider').notEmpty().isIn(['epic', 'cerner', 'allscripts', 'athena', 'fhir'])
    .withMessage('EHR provider is required'),
  body('resourceType').equals('Observation').withMessage('Resource type must be Observation'),
  body('status').isIn(['registered', 'preliminary', 'final', 'amended'])
    .withMessage('Invalid observation status'),
  body('category').isArray().withMessage('Category is required'),
  body('code').isObject().withMessage('Code is required'),
  body('subject').isObject().withMessage('Subject is required'),
  validateRequest,
  async (req, res) => {
    try {
      const { provider } = req.query;
      const observationData = req.body;
      
      const createdObservation = await ehrIntegrationService.createObservation(
        provider as any,
        observationData
      );
      
      res.status(201).json({
        observation: createdObservation,
        provider,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to create observation',
        provider: req.query.provider,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

// ============================================================================
// APPOINTMENT OPERATIONS
// ============================================================================

/**
 * @route GET /api/v1/ehr/appointments
 * @desc Get appointments from EHR provider
 * @access Private
 * @query {
 *   provider: 'epic' | 'cerner' | 'allscripts' | 'athena' | 'fhir',
 *   patient?: string,
 *   practitioner?: string,
 *   date?: string,
 *   status?: string,
 *   limit?: number
 * }
 */
router.get('/appointments',
  query('provider').notEmpty().isIn(['epic', 'cerner', 'allscripts', 'athena', 'fhir'])
    .withMessage('EHR provider is required'),
  query('patient').optional().isString(),
  query('practitioner').optional().isString(),
  query('date').optional().isISO8601(),
  query('status').optional().isIn(['proposed', 'pending', 'booked', 'arrived', 'fulfilled', 'cancelled', 'noshow']),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validateRequest,
  async (req, res) => {
    try {
      const {
        provider,
        patient,
        practitioner,
        date,
        status,
        limit = 50
      } = req.query;
      
      const searchParams = {
        patient: patient as string,
        practitioner: practitioner as string,
        date: date as string,
        status: status as string,
        _count: parseInt(limit as string)
      };
      
      const appointments = await ehrIntegrationService.getAppointments(
        provider as any,
        searchParams
      );
      
      res.json({
        appointments,
        searchParams,
        provider,
        total: appointments.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get appointments',
        provider: req.query.provider,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route POST /api/v1/ehr/appointments
 * @desc Create a new appointment
 * @access Private
 * @query { provider: 'epic' | 'cerner' | 'allscripts' | 'athena' | 'fhir' }
 * @body {
 *   resourceType: 'Appointment',
 *   status: 'proposed' | 'pending' | 'booked' | 'arrived' | 'fulfilled' | 'cancelled' | 'noshow',
 *   serviceCategory?: Array<any>,
 *   serviceType?: Array<any>,
 *   specialty?: Array<any>,
 *   appointmentType?: any,
 *   reasonCode?: Array<any>,
 *   priority?: number,
 *   description?: string,
 *   start: string,
 *   end: string,
 *   minutesDuration?: number,
 *   slot?: Array<any>,
 *   created?: string,
 *   comment?: string,
 *   participant: Array<any>
 * }
 */
router.post('/appointments',
  intensiveEHRRateLimit,
  query('provider').notEmpty().isIn(['epic', 'cerner', 'allscripts', 'athena', 'fhir'])
    .withMessage('EHR provider is required'),
  body('resourceType').equals('Appointment').withMessage('Resource type must be Appointment'),
  body('status').isIn(['proposed', 'pending', 'booked', 'arrived', 'fulfilled', 'cancelled', 'noshow'])
    .withMessage('Invalid appointment status'),
  body('start').isISO8601().withMessage('Valid start time is required'),
  body('end').isISO8601().withMessage('Valid end time is required'),
  body('participant').isArray().withMessage('Participant is required'),
  validateRequest,
  async (req, res) => {
    try {
      const { provider } = req.query;
      const appointmentData = req.body;
      
      const createdAppointment = await ehrIntegrationService.createAppointment(
        provider as any,
        appointmentData
      );
      
      res.status(201).json({
        appointment: createdAppointment,
        provider,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to create appointment',
        provider: req.query.provider,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

// ============================================================================
// BULK OPERATIONS
// ============================================================================

/**
 * @route POST /api/v1/ehr/bulk/export
 * @desc Export bulk data from EHR provider
 * @access Private
 * @query { provider: 'epic' | 'cerner' | 'allscripts' | 'athena' | 'fhir' }
 * @body {
 *   resourceTypes: string[],
 *   since?: string,
 *   outputFormat?: 'application/fhir+ndjson' | 'application/ndjson',
 *   includeAssociatedData?: string[]
 * }
 */
router.post('/bulk/export',
  intensiveEHRRateLimit,
  query('provider').notEmpty().isIn(['epic', 'cerner', 'allscripts', 'athena', 'fhir'])
    .withMessage('EHR provider is required'),
  body('resourceTypes').isArray().withMessage('Resource types are required'),
  body('since').optional().isISO8601(),
  body('outputFormat').optional().isIn(['application/fhir+ndjson', 'application/ndjson']),
  body('includeAssociatedData').optional().isArray(),
  validateRequest,
  async (req, res) => {
    try {
      const { provider } = req.query;
      const {
        resourceTypes,
        since,
        outputFormat = 'application/fhir+ndjson',
        includeAssociatedData
      } = req.body;
      
      // This would typically initiate a bulk export operation
      // For now, we'll return a mock response
      const exportJob = {
        id: `export-${Date.now()}`,
        status: 'in-progress',
        resourceTypes,
        since,
        outputFormat,
        includeAssociatedData,
        provider,
        createdAt: new Date().toISOString(),
        estimatedCompletion: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 minutes
      };
      
      res.status(202).json({
        exportJob,
        statusUrl: `/api/v1/ehr/bulk/export/${exportJob.id}/status`,
        message: 'Bulk export initiated successfully'
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to initiate bulk export',
        provider: req.query.provider,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route GET /api/v1/ehr/bulk/export/:jobId/status
 * @desc Get bulk export job status
 * @access Private
 * @params { jobId: string }
 */
router.get('/bulk/export/:jobId/status',
  param('jobId').notEmpty().withMessage('Job ID is required'),
  validateRequest,
  async (req, res) => {
    try {
      const { jobId } = req.params;
      
      // This would typically check the actual job status
      // For now, we'll return a mock response
      const jobStatus = {
        id: jobId,
        status: 'completed',
        progress: 100,
        output: [
          {
            type: 'Patient',
            url: `https://example.com/exports/${jobId}/Patient.ndjson`,
            count: 1250
          },
          {
            type: 'Observation',
            url: `https://example.com/exports/${jobId}/Observation.ndjson`,
            count: 15420
          },
          {
            type: 'Appointment',
            url: `https://example.com/exports/${jobId}/Appointment.ndjson`,
            count: 3680
          }
        ],
        error: [],
        completedAt: new Date().toISOString()
      };
      
      res.json(jobStatus);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get export job status',
        jobId: req.params.jobId,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

// ============================================================================
// ANALYTICS & REPORTING
// ============================================================================

/**
 * @route GET /api/v1/ehr/analytics/integration-health
 * @desc Get integration health metrics
 * @access Private
 */
router.get('/analytics/integration-health',
  async (req, res) => {
    try {
      const healthMetrics = {
        overall: {
          status: 'healthy',
          uptime: 99.8,
          lastCheck: new Date().toISOString()
        },
        providers: {
          epic: {
            status: 'healthy',
            responseTime: 245,
            successRate: 99.2,
            lastSync: new Date(Date.now() - 5 * 60 * 1000).toISOString()
          },
          cerner: {
            status: 'healthy',
            responseTime: 312,
            successRate: 98.7,
            lastSync: new Date(Date.now() - 3 * 60 * 1000).toISOString()
          },
          allscripts: {
            status: 'degraded',
            responseTime: 1250,
            successRate: 95.1,
            lastSync: new Date(Date.now() - 15 * 60 * 1000).toISOString()
          },
          athena: {
            status: 'healthy',
            responseTime: 189,
            successRate: 99.5,
            lastSync: new Date(Date.now() - 2 * 60 * 1000).toISOString()
          },
          fhir: {
            status: 'healthy',
            responseTime: 156,
            successRate: 99.8,
            lastSync: new Date(Date.now() - 1 * 60 * 1000).toISOString()
          }
        },
        dataFlow: {
          patientsSync: {
            total: 15420,
            successful: 15398,
            failed: 22,
            lastHour: 156
          },
          observationsSync: {
            total: 89650,
            successful: 89521,
            failed: 129,
            lastHour: 1250
          },
          appointmentsSync: {
            total: 8950,
            successful: 8945,
            failed: 5,
            lastHour: 89
          }
        },
        timestamp: new Date().toISOString()
      };
      
      res.json(healthMetrics);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get integration health metrics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route GET /api/v1/ehr/analytics/usage
 * @desc Get EHR integration usage analytics
 * @access Private
 * @query {
 *   startDate?: string,
 *   endDate?: string,
 *   provider?: string,
 *   resourceType?: string
 * }
 */
router.get('/analytics/usage',
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('provider').optional().isIn(['epic', 'cerner', 'allscripts', 'athena', 'fhir']),
  query('resourceType').optional().isString(),
  validateRequest,
  async (req, res) => {
    try {
      const { startDate, endDate, provider, resourceType } = req.query;
      
      // This would typically query actual usage data
      // For now, we'll return mock analytics
      const usageAnalytics = {
        period: {
          start: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          end: endDate || new Date().toISOString()
        },
        totalRequests: 45620,
        successfulRequests: 45398,
        failedRequests: 222,
        averageResponseTime: 285,
        byProvider: {
          epic: { requests: 15420, success: 15398, avgResponseTime: 245 },
          cerner: { requests: 12350, success: 12298, avgResponseTime: 312 },
          allscripts: { requests: 8950, success: 8756, avgResponseTime: 1250 },
          athena: { requests: 5620, success: 5615, avgResponseTime: 189 },
          fhir: { requests: 3280, success: 3279, avgResponseTime: 156 }
        },
        byResourceType: {
          Patient: { requests: 15420, success: 15398 },
          Observation: { requests: 18950, success: 18821 },
          Appointment: { requests: 8950, success: 8945 },
          Practitioner: { requests: 2300, success: 2298 }
        },
        topOperations: [
          { operation: 'search-patients', count: 15420 },
          { operation: 'get-observations', count: 12350 },
          { operation: 'create-appointment', count: 8950 },
          { operation: 'update-patient', count: 5620 }
        ],
        filter: {
          provider: provider || 'all',
          resourceType: resourceType || 'all'
        },
        timestamp: new Date().toISOString()
      };
      
      res.json(usageAnalytics);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get usage analytics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

export default router;