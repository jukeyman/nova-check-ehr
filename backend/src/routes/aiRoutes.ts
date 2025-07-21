import { Router } from 'express';
import { aiController, chatValidation, diagnosisValidation, treatmentPlanValidation, clinicalNotesValidation } from '../controllers/aiController';
import { validateRequest } from '../middleware/validation';
import { authenticate } from '../middleware/auth';
import { rateLimit } from 'express-rate-limit';
import { body, query, param } from 'express-validator';

const router = Router();

// Rate limiting for AI endpoints
const aiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many AI requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const intensiveAIRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit intensive operations
  message: {
    error: 'Too many intensive AI requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  }
});

// Apply authentication and rate limiting to all AI routes
router.use(authenticate);
router.use(aiRateLimit);

// ============================================================================
// CHAT ENDPOINTS
// ============================================================================

/**
 * @route POST /api/v1/ai/chat
 * @desc Send a message to the AI chat agent
 * @access Private
 * @body {
 *   message: string,
 *   sessionId?: string,
 *   patientId?: string,
 *   provider?: AIProvider,
 *   context?: {
 *     patientData?: any,
 *     clinicalContext?: string,
 *     urgency?: 'low' | 'medium' | 'high' | 'critical'
 *   }
 * }
 */
router.post('/chat', 
  chatValidation,
  validateRequest,
  aiController.chat.bind(aiController)
);

/**
 * @route GET /api/v1/ai/chat/session/:sessionId
 * @desc Get chat session details
 * @access Private
 */
router.get('/chat/session/:sessionId',
  param('sessionId').notEmpty().withMessage('Session ID is required'),
  validateRequest,
  aiController.getSession.bind(aiController)
);

/**
 * @route DELETE /api/v1/ai/chat/session/:sessionId
 * @desc Clear chat session
 * @access Private
 */
router.delete('/chat/session/:sessionId',
  param('sessionId').notEmpty().withMessage('Session ID is required'),
  validateRequest,
  aiController.clearSession.bind(aiController)
);

// ============================================================================
// MEDICAL AI ENDPOINTS
// ============================================================================

/**
 * @route POST /api/v1/ai/diagnosis
 * @desc Generate medical diagnosis assistance
 * @access Private
 * @body {
 *   symptoms: string[],
 *   patientHistory: string,
 *   vitalSigns: {
 *     temperature?: number,
 *     bloodPressure?: { systolic: number, diastolic: number },
 *     heartRate?: number,
 *     respiratoryRate?: number,
 *     oxygenSaturation?: number,
 *     weight?: number,
 *     height?: number
 *   },
 *   patientId?: string,
 *   provider?: AIProvider
 * }
 */
router.post('/diagnosis',
  intensiveAIRateLimit,
  diagnosisValidation,
  validateRequest,
  aiController.generateDiagnosis.bind(aiController)
);

/**
 * @route POST /api/v1/ai/treatment-plan
 * @desc Generate treatment plan recommendations
 * @access Private
 * @body {
 *   diagnosis: string,
 *   patientProfile: {
 *     age: number,
 *     gender: string,
 *     weight?: number,
 *     height?: number,
 *     medicalHistory?: string[],
 *     currentMedications?: string[]
 *   },
 *   allergies: string[],
 *   patientId?: string,
 *   provider?: AIProvider
 * }
 */
router.post('/treatment-plan',
  intensiveAIRateLimit,
  treatmentPlanValidation,
  validateRequest,
  aiController.generateTreatmentPlan.bind(aiController)
);

/**
 * @route POST /api/v1/ai/clinical-notes
 * @desc Generate clinical notes from patient encounter
 * @access Private
 * @body {
 *   patientEncounter: {
 *     patientId: string,
 *     providerId: string,
 *     encounterDate: string,
 *     chiefComplaint: string,
 *     historyOfPresentIllness: string,
 *     reviewOfSystems: any,
 *     physicalExam: any,
 *     assessment: string,
 *     plan: string,
 *     vitalSigns?: any
 *   },
 *   template?: 'SOAP' | 'DAP' | 'BIRP' | 'GIRP',
 *   provider?: AIProvider
 * }
 */
router.post('/clinical-notes',
  intensiveAIRateLimit,
  clinicalNotesValidation,
  validateRequest,
  aiController.generateClinicalNotes.bind(aiController)
);

// ============================================================================
// PROVIDER & STATUS ENDPOINTS
// ============================================================================

/**
 * @route GET /api/v1/ai/providers
 * @desc Get available AI providers and their status
 * @access Private
 */
router.get('/providers',
  aiController.getProviders.bind(aiController)
);

/**
 * @route GET /api/v1/ai/ehr-status
 * @desc Get EHR integration status
 * @access Private
 */
router.get('/ehr-status',
  aiController.getEHRStatus.bind(aiController)
);

/**
 * @route GET /api/v1/ai/health
 * @desc Health check for AI services
 * @access Private
 */
router.get('/health',
  aiController.healthCheck.bind(aiController)
);

// ============================================================================
// EHR INTEGRATION ENDPOINTS
// ============================================================================

/**
 * @route POST /api/v1/ai/sync-patient/:patientId
 * @desc Sync patient data from EHR provider
 * @access Private
 * @query { provider: EHRProvider }
 */
router.post('/sync-patient/:patientId',
  param('patientId').notEmpty().withMessage('Patient ID is required'),
  query('provider').notEmpty().withMessage('EHR provider is required')
    .isIn(['epic', 'cerner', 'allscripts', 'athena', 'fhir'])
    .withMessage('Invalid EHR provider'),
  validateRequest,
  aiController.syncPatientData.bind(aiController)
);

// ============================================================================
// ADVANCED AI FEATURES
// ============================================================================

/**
 * @route POST /api/v1/ai/drug-interaction
 * @desc Check for drug interactions
 * @access Private
 * @body {
 *   medications: string[],
 *   patientId?: string,
 *   provider?: AIProvider
 * }
 */
router.post('/drug-interaction',
  body('medications').isArray().withMessage('Medications must be an array'),
  body('patientId').optional().isString(),
  body('provider').optional().isIn(['deepseek', 'openai', 'claude', 'gemini', 'mistral', 'cohere', 'azure-openai']),
  validateRequest,
  async (req, res) => {
    try {
      const { medications, patientId, provider } = req.body;
      
      // This would integrate with a drug interaction service
      // For now, we'll use AI to analyze potential interactions
      const systemPrompt = `You are a clinical pharmacist AI assistant. Analyze the following medications for potential drug interactions, contraindications, and safety concerns. Provide detailed information about:
1. Major drug interactions
2. Minor interactions
3. Contraindications
4. Dosage considerations
5. Monitoring recommendations

Always recommend consulting with a pharmacist or physician for final verification.`;
      
      const userPrompt = `Medications to analyze: ${medications.join(', ')}`;
      
      const aiService = require('../services/aiService').aiService;
      const response = await aiService.generateResponse([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], { provider });
      
      res.json({
        interactions: response.content,
        medications,
        provider: response.provider,
        model: response.model,
        patientId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to check drug interactions',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route POST /api/v1/ai/clinical-guidelines
 * @desc Get clinical guidelines for a condition
 * @access Private
 * @body {
 *   condition: string,
 *   patientProfile?: any,
 *   provider?: AIProvider
 * }
 */
router.post('/clinical-guidelines',
  body('condition').notEmpty().withMessage('Condition is required'),
  body('patientProfile').optional().isObject(),
  body('provider').optional().isIn(['deepseek', 'openai', 'claude', 'gemini', 'mistral', 'cohere', 'azure-openai']),
  validateRequest,
  async (req, res) => {
    try {
      const { condition, patientProfile, provider } = req.body;
      
      const systemPrompt = `You are a medical AI assistant specializing in clinical guidelines. Provide evidence-based clinical guidelines for the specified condition, including:
1. Diagnostic criteria
2. Treatment protocols
3. Monitoring requirements
4. Follow-up recommendations
5. Quality measures
6. References to major medical societies' guidelines

Base recommendations on current evidence and established clinical practice guidelines.`;
      
      let userPrompt = `Condition: ${condition}`;
      if (patientProfile) {
        userPrompt += `\nPatient Profile: ${JSON.stringify(patientProfile, null, 2)}`;
      }
      
      const aiService = require('../services/aiService').aiService;
      const response = await aiService.generateResponse([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], { provider });
      
      res.json({
        guidelines: response.content,
        condition,
        provider: response.provider,
        model: response.model,
        patientProfile,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get clinical guidelines',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route POST /api/v1/ai/icd-coding
 * @desc Generate ICD-10 codes for diagnoses
 * @access Private
 * @body {
 *   diagnoses: string[],
 *   clinicalContext?: string,
 *   provider?: AIProvider
 * }
 */
router.post('/icd-coding',
  body('diagnoses').isArray().withMessage('Diagnoses must be an array'),
  body('clinicalContext').optional().isString(),
  body('provider').optional().isIn(['deepseek', 'openai', 'claude', 'gemini', 'mistral', 'cohere', 'azure-openai']),
  validateRequest,
  async (req, res) => {
    try {
      const { diagnoses, clinicalContext, provider } = req.body;
      
      const systemPrompt = `You are a medical coding AI assistant specializing in ICD-10-CM coding. For each diagnosis provided, suggest the most appropriate ICD-10-CM codes with:
1. Primary code
2. Alternative codes if applicable
3. Code description
4. Coding rationale
5. Documentation requirements

Ensure codes are specific and accurate based on clinical context.`;
      
      let userPrompt = `Diagnoses to code: ${diagnoses.join(', ')}`;
      if (clinicalContext) {
        userPrompt += `\nClinical Context: ${clinicalContext}`;
      }
      
      const aiService = require('../services/aiService').aiService;
      const response = await aiService.generateResponse([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], { provider });
      
      res.json({
        coding: response.content,
        diagnoses,
        provider: response.provider,
        model: response.model,
        clinicalContext,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to generate ICD codes',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route POST /api/v1/ai/risk-assessment
 * @desc Perform clinical risk assessment
 * @access Private
 * @body {
 *   patientData: any,
 *   riskFactors: string[],
 *   assessmentType: 'cardiovascular' | 'diabetes' | 'fall' | 'general',
 *   provider?: AIProvider
 * }
 */
router.post('/risk-assessment',
  body('patientData').isObject().withMessage('Patient data is required'),
  body('riskFactors').isArray().withMessage('Risk factors must be an array'),
  body('assessmentType').isIn(['cardiovascular', 'diabetes', 'fall', 'general']).withMessage('Invalid assessment type'),
  body('provider').optional().isIn(['deepseek', 'openai', 'claude', 'gemini', 'mistral', 'cohere', 'azure-openai']),
  validateRequest,
  async (req, res) => {
    try {
      const { patientData, riskFactors, assessmentType, provider } = req.body;
      
      const systemPrompt = `You are a clinical risk assessment AI assistant. Perform a comprehensive ${assessmentType} risk assessment based on patient data and risk factors. Provide:
1. Risk score/category
2. Key risk factors identified
3. Protective factors
4. Risk mitigation strategies
5. Monitoring recommendations
6. Timeline for reassessment

Use evidence-based risk assessment tools and guidelines.`;
      
      const userPrompt = `Patient Data: ${JSON.stringify(patientData, null, 2)}\nRisk Factors: ${riskFactors.join(', ')}\nAssessment Type: ${assessmentType}`;
      
      const aiService = require('../services/aiService').aiService;
      const response = await aiService.generateResponse([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], { provider });
      
      res.json({
        riskAssessment: response.content,
        assessmentType,
        riskFactors,
        provider: response.provider,
        model: response.model,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to perform risk assessment',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

// ============================================================================
// ANALYTICS & INSIGHTS
// ============================================================================

/**
 * @route GET /api/v1/ai/analytics/usage
 * @desc Get AI usage analytics
 * @access Private
 */
router.get('/analytics/usage',
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date'),
  query('provider').optional().isIn(['deepseek', 'openai', 'claude', 'gemini', 'mistral', 'cohere', 'azure-openai']),
  validateRequest,
  async (req, res) => {
    try {
      // This would typically query a database for usage analytics
      // For now, we'll return mock data
      const analytics = {
        totalRequests: 1250,
        successRate: 98.5,
        averageResponseTime: 1.2,
        topProviders: [
          { provider: 'deepseek', usage: 45.2 },
          { provider: 'openai', usage: 32.1 },
          { provider: 'claude', usage: 22.7 }
        ],
        topFeatures: [
          { feature: 'chat', usage: 52.3 },
          { feature: 'diagnosis', usage: 23.1 },
          { feature: 'treatment-plan', usage: 15.6 },
          { feature: 'clinical-notes', usage: 9.0 }
        ],
        costAnalysis: {
          totalCost: 125.50,
          costPerRequest: 0.10,
          costByProvider: {
            deepseek: 45.20,
            openai: 52.30,
            claude: 28.00
          }
        },
        timestamp: new Date().toISOString()
      };
      
      res.json(analytics);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get usage analytics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * @route GET /api/v1/ai/analytics/performance
 * @desc Get AI performance metrics
 * @access Private
 */
router.get('/analytics/performance',
  async (req, res) => {
    try {
      const performance = {
        responseTime: {
          average: 1.2,
          p95: 2.1,
          p99: 3.5
        },
        accuracy: {
          overall: 94.2,
          byFeature: {
            diagnosis: 92.1,
            treatmentPlan: 95.3,
            clinicalNotes: 96.8,
            drugInteraction: 93.5
          }
        },
        reliability: {
          uptime: 99.8,
          errorRate: 1.5,
          failoverRate: 0.2
        },
        userSatisfaction: {
          averageRating: 4.6,
          totalRatings: 1847,
          feedbackSentiment: 'positive'
        },
        timestamp: new Date().toISOString()
      };
      
      res.json(performance);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get performance metrics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

export default router;