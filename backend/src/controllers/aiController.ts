import { Request, Response } from 'express';
import { aiService, AIMessage, AIProvider } from '../services/aiService';
import { ehrIntegrationService, EHRProvider } from '../services/ehrIntegrationService';
import { logger } from '../utils/logger';
import { validateRequest } from '../middleware/validation';
import { body, query, param } from 'express-validator';

// Request/Response Interfaces
interface ChatRequest {
  message: string;
  sessionId?: string;
  patientId?: string;
  provider?: AIProvider;
  context?: {
    patientData?: any;
    clinicalContext?: string;
    urgency?: 'low' | 'medium' | 'high' | 'critical';
  };
}

interface ChatResponse {
  response: string;
  sessionId: string;
  provider: AIProvider;
  model: string;
  confidence?: number;
  suggestions?: string[];
  actions?: Array<{
    type: string;
    label: string;
    data?: any;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

interface DiagnosisRequest {
  symptoms: string[];
  patientHistory: string;
  vitalSigns: {
    temperature?: number;
    bloodPressure?: {
      systolic: number;
      diastolic: number;
    };
    heartRate?: number;
    respiratoryRate?: number;
    oxygenSaturation?: number;
    weight?: number;
    height?: number;
  };
  patientId?: string;
  provider?: AIProvider;
}

interface TreatmentPlanRequest {
  diagnosis: string;
  patientProfile: {
    age: number;
    gender: string;
    weight?: number;
    height?: number;
    medicalHistory?: string[];
    currentMedications?: string[];
  };
  allergies: string[];
  patientId?: string;
  provider?: AIProvider;
}

interface ClinicalNotesRequest {
  patientEncounter: {
    patientId: string;
    providerId: string;
    encounterDate: string;
    chiefComplaint: string;
    historyOfPresentIllness: string;
    reviewOfSystems: any;
    physicalExam: any;
    assessment: string;
    plan: string;
    vitalSigns?: any;
  };
  template?: 'SOAP' | 'DAP' | 'BIRP' | 'GIRP';
  provider?: AIProvider;
}

// Session Management
const chatSessions = new Map<string, {
  id: string;
  messages: AIMessage[];
  patientId?: string;
  createdAt: number;
  lastActivity: number;
}>();

// Validation Rules
export const chatValidation = [
  body('message').notEmpty().withMessage('Message is required'),
  body('sessionId').optional().isString(),
  body('patientId').optional().isString(),
  body('provider').optional().isIn(['deepseek', 'openai', 'claude', 'gemini', 'mistral', 'cohere', 'azure-openai'])
];

export const diagnosisValidation = [
  body('symptoms').isArray().withMessage('Symptoms must be an array'),
  body('patientHistory').notEmpty().withMessage('Patient history is required'),
  body('vitalSigns').isObject().withMessage('Vital signs must be an object'),
  body('provider').optional().isIn(['deepseek', 'openai', 'claude', 'gemini', 'mistral', 'cohere', 'azure-openai'])
];

export const treatmentPlanValidation = [
  body('diagnosis').notEmpty().withMessage('Diagnosis is required'),
  body('patientProfile').isObject().withMessage('Patient profile must be an object'),
  body('allergies').isArray().withMessage('Allergies must be an array'),
  body('provider').optional().isIn(['deepseek', 'openai', 'claude', 'gemini', 'mistral', 'cohere', 'azure-openai'])
];

export const clinicalNotesValidation = [
  body('patientEncounter').isObject().withMessage('Patient encounter must be an object'),
  body('template').optional().isIn(['SOAP', 'DAP', 'BIRP', 'GIRP']),
  body('provider').optional().isIn(['deepseek', 'openai', 'claude', 'gemini', 'mistral', 'cohere', 'azure-openai'])
];

class AIController {
  // Chat Endpoint
  async chat(req: Request, res: Response): Promise<void> {
    try {
      const { message, sessionId, patientId, provider, context }: ChatRequest = req.body;
      
      // Get or create session
      let session = sessionId ? chatSessions.get(sessionId) : null;
      if (!session) {
        const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        session = {
          id: newSessionId,
          messages: [],
          patientId,
          createdAt: Date.now(),
          lastActivity: Date.now()
        };
        chatSessions.set(newSessionId, session);
      }

      // Update session activity
      session.lastActivity = Date.now();

      // Build context-aware system message
      let systemMessage = `You are Nova Check AI, an advanced medical AI assistant integrated into an Electronic Health Record (EHR) system. 
You help healthcare providers with clinical decision support, patient care, and administrative tasks.

Capabilities:
- Clinical diagnosis assistance
- Treatment plan recommendations
- Drug interaction checking
- Medical knowledge queries
- Patient data analysis
- Clinical documentation

Always provide evidence-based recommendations and remind users that final clinical decisions should be made by qualified healthcare professionals.`;

      // Add patient context if available
      if (patientId && context?.patientData) {
        systemMessage += `\n\nCurrent Patient Context:\nPatient ID: ${patientId}\nPatient Data: ${JSON.stringify(context.patientData, null, 2)}`;
      }

      if (context?.clinicalContext) {
        systemMessage += `\n\nClinical Context: ${context.clinicalContext}`;
      }

      if (context?.urgency) {
        systemMessage += `\n\nUrgency Level: ${context.urgency.toUpperCase()}`;
        if (context.urgency === 'critical') {
          systemMessage += ` - This is a critical situation requiring immediate attention.`;
        }
      }

      // Prepare messages for AI
      const messages: AIMessage[] = [
        { role: 'system', content: systemMessage },
        ...session.messages,
        { role: 'user', content: message }
      ];

      // Generate AI response
      const aiResponse = await aiService.generateResponse(messages, {
        provider: provider as AIProvider,
        maxTokens: 1000,
        temperature: 0.3
      });

      // Add messages to session
      session.messages.push(
        { role: 'user', content: message },
        { role: 'assistant', content: aiResponse.content }
      );

      // Keep session history manageable (last 20 messages)
      if (session.messages.length > 20) {
        session.messages = session.messages.slice(-20);
      }

      // Generate suggestions and actions
      const suggestions = await this.generateSuggestions(message, aiResponse.content, context);
      const actions = await this.generateActions(message, patientId, context);

      const response: ChatResponse = {
        response: aiResponse.content,
        sessionId: session.id,
        provider: aiResponse.provider,
        model: aiResponse.model,
        confidence: aiResponse.confidence,
        suggestions,
        actions,
        usage: aiResponse.usage
      };

      res.json(response);
      
      logger.info(`AI chat response generated for session ${session.id} using ${aiResponse.provider}`);
    } catch (error) {
      logger.error('Error in AI chat:', error);
      res.status(500).json({
        error: 'Failed to generate AI response',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Medical Diagnosis Assistance
  async generateDiagnosis(req: Request, res: Response): Promise<void> {
    try {
      const { symptoms, patientHistory, vitalSigns, patientId, provider }: DiagnosisRequest = req.body;
      
      const aiResponse = await aiService.generateMedicalDiagnosis(
        symptoms,
        patientHistory,
        vitalSigns
      );

      // Log for audit trail
      logger.info(`Medical diagnosis generated for patient ${patientId || 'unknown'} using ${aiResponse.provider}`);

      res.json({
        diagnosis: aiResponse.content,
        provider: aiResponse.provider,
        model: aiResponse.model,
        confidence: aiResponse.confidence,
        usage: aiResponse.usage,
        timestamp: new Date().toISOString(),
        patientId
      });
    } catch (error) {
      logger.error('Error generating diagnosis:', error);
      res.status(500).json({
        error: 'Failed to generate diagnosis',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Treatment Plan Generation
  async generateTreatmentPlan(req: Request, res: Response): Promise<void> {
    try {
      const { diagnosis, patientProfile, allergies, patientId, provider }: TreatmentPlanRequest = req.body;
      
      const aiResponse = await aiService.generateTreatmentPlan(
        diagnosis,
        patientProfile,
        allergies
      );

      logger.info(`Treatment plan generated for patient ${patientId || 'unknown'} using ${aiResponse.provider}`);

      res.json({
        treatmentPlan: aiResponse.content,
        provider: aiResponse.provider,
        model: aiResponse.model,
        confidence: aiResponse.confidence,
        usage: aiResponse.usage,
        timestamp: new Date().toISOString(),
        patientId
      });
    } catch (error) {
      logger.error('Error generating treatment plan:', error);
      res.status(500).json({
        error: 'Failed to generate treatment plan',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Clinical Notes Generation
  async generateClinicalNotes(req: Request, res: Response): Promise<void> {
    try {
      const { patientEncounter, template, provider }: ClinicalNotesRequest = req.body;
      
      const aiResponse = await aiService.generateClinicalNotes(
        patientEncounter,
        template
      );

      logger.info(`Clinical notes generated for patient ${patientEncounter.patientId} using ${aiResponse.provider}`);

      res.json({
        clinicalNotes: aiResponse.content,
        template: template || 'SOAP',
        provider: aiResponse.provider,
        model: aiResponse.model,
        confidence: aiResponse.confidence,
        usage: aiResponse.usage,
        timestamp: new Date().toISOString(),
        patientId: patientEncounter.patientId
      });
    } catch (error) {
      logger.error('Error generating clinical notes:', error);
      res.status(500).json({
        error: 'Failed to generate clinical notes',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Get Available AI Providers
  async getProviders(req: Request, res: Response): Promise<void> {
    try {
      const providers = aiService.getAvailableProviders();
      const healthStatus = await aiService.healthCheck();
      
      res.json({
        providers: providers.map(provider => ({
          name: provider,
          status: healthStatus[provider] ? 'healthy' : 'unhealthy',
          features: this.getProviderFeatures(provider)
        })),
        defaultProvider: process.env.AI_CHAT_DEFAULT_MODEL || 'deepseek',
        fallbackProvider: process.env.AI_CHAT_FALLBACK_MODEL || 'openai'
      });
    } catch (error) {
      logger.error('Error getting AI providers:', error);
      res.status(500).json({
        error: 'Failed to get AI providers',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Get EHR Integration Status
  async getEHRStatus(req: Request, res: Response): Promise<void> {
    try {
      const providers = ehrIntegrationService.getConfiguredProviders();
      const status = await ehrIntegrationService.getProviderStatus();
      
      res.json({
        ehrProviders: providers.map(provider => ({
          name: provider,
          status: status[provider] ? 'connected' : 'disconnected',
          features: this.getEHRProviderFeatures(provider)
        })),
        totalProviders: providers.length,
        connectedProviders: Object.values(status).filter(Boolean).length
      });
    } catch (error) {
      logger.error('Error getting EHR status:', error);
      res.status(500).json({
        error: 'Failed to get EHR status',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Sync Patient Data from EHR
  async syncPatientData(req: Request, res: Response): Promise<void> {
    try {
      const { patientId } = req.params;
      const { provider } = req.query;
      
      if (!provider || typeof provider !== 'string') {
        res.status(400).json({ error: 'EHR provider is required' });
        return;
      }

      const syncedData = await ehrIntegrationService.syncPatientData(
        provider as EHRProvider,
        patientId
      );

      logger.info(`Patient data synced for ${patientId} from ${provider}`);

      res.json({
        patientId,
        provider,
        syncedAt: new Date().toISOString(),
        data: syncedData
      });
    } catch (error) {
      logger.error('Error syncing patient data:', error);
      res.status(500).json({
        error: 'Failed to sync patient data',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Get Chat Session
  async getSession(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const session = chatSessions.get(sessionId);
      
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({
        sessionId: session.id,
        patientId: session.patientId,
        messageCount: session.messages.length,
        createdAt: new Date(session.createdAt).toISOString(),
        lastActivity: new Date(session.lastActivity).toISOString(),
        messages: session.messages.slice(-10) // Return last 10 messages
      });
    } catch (error) {
      logger.error('Error getting session:', error);
      res.status(500).json({
        error: 'Failed to get session',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Clear Chat Session
  async clearSession(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      
      if (chatSessions.has(sessionId)) {
        chatSessions.delete(sessionId);
        res.json({ message: 'Session cleared successfully' });
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    } catch (error) {
      logger.error('Error clearing session:', error);
      res.status(500).json({
        error: 'Failed to clear session',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Health Check
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      const aiHealth = await aiService.healthCheck();
      const ehrHealth = await ehrIntegrationService.getProviderStatus();
      
      const overallHealth = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          ai: aiHealth,
          ehr: ehrHealth
        },
        activeSessions: chatSessions.size,
        uptime: process.uptime()
      };

      // Check if any critical services are down
      const aiHealthy = Object.values(aiHealth).some(Boolean);
      if (!aiHealthy) {
        overallHealth.status = 'degraded';
      }

      res.json(overallHealth);
    } catch (error) {
      logger.error('Error in health check:', error);
      res.status(500).json({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // Helper Methods
  private async generateSuggestions(
    userMessage: string,
    aiResponse: string,
    context?: any
  ): Promise<string[]> {
    const suggestions: string[] = [];
    
    // Generate contextual suggestions based on the conversation
    if (userMessage.toLowerCase().includes('symptom')) {
      suggestions.push('Would you like me to suggest possible diagnoses?');
      suggestions.push('Should I check for drug interactions?');
    }
    
    if (userMessage.toLowerCase().includes('diagnosis')) {
      suggestions.push('Generate a treatment plan');
      suggestions.push('Check clinical guidelines');
    }
    
    if (userMessage.toLowerCase().includes('medication') || userMessage.toLowerCase().includes('drug')) {
      suggestions.push('Check for drug interactions');
      suggestions.push('Review dosage recommendations');
    }
    
    return suggestions.slice(0, 3); // Limit to 3 suggestions
  }

  private async generateActions(
    userMessage: string,
    patientId?: string,
    context?: any
  ): Promise<Array<{ type: string; label: string; data?: any }>> {
    const actions: Array<{ type: string; label: string; data?: any }> = [];
    
    if (patientId) {
      actions.push({
        type: 'view_patient',
        label: 'View Patient Record',
        data: { patientId }
      });
    }
    
    if (userMessage.toLowerCase().includes('appointment')) {
      actions.push({
        type: 'schedule_appointment',
        label: 'Schedule Appointment',
        data: { patientId }
      });
    }
    
    if (userMessage.toLowerCase().includes('prescription') || userMessage.toLowerCase().includes('medication')) {
      actions.push({
        type: 'create_prescription',
        label: 'Create Prescription',
        data: { patientId }
      });
    }
    
    return actions;
  }

  private getProviderFeatures(provider: AIProvider): string[] {
    const features: { [key in AIProvider]: string[] } = {
      'deepseek': ['Fast responses', 'Medical knowledge', 'Cost-effective'],
      'openai': ['Advanced reasoning', 'Medical expertise', 'Reliable'],
      'claude': ['Long context', 'Detailed analysis', 'Safety-focused'],
      'gemini': ['Multimodal', 'Fast processing', 'Google integration'],
      'mistral': ['European compliance', 'Efficient', 'Open source'],
      'cohere': ['Enterprise-grade', 'Customizable', 'Reliable'],
      'azure-openai': ['Enterprise security', 'HIPAA compliant', 'Microsoft integration']
    };
    
    return features[provider] || [];
  }

  private getEHRProviderFeatures(provider: EHRProvider): string[] {
    const features: { [key in EHRProvider]: string[] } = {
      'epic': ['Comprehensive EHR', 'FHIR R4', 'Large hospital networks'],
      'cerner': ['Cloud-based', 'Interoperability', 'Population health'],
      'allscripts': ['Practice management', 'EHR integration', 'Specialty-focused'],
      'athena': ['Cloud-native', 'Revenue cycle', 'Patient engagement'],
      'fhir': ['Standard compliance', 'Interoperability', 'Open API']
    };
    
    return features[provider] || [];
  }
}

// Clean up old sessions periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [sessionId, session] of chatSessions.entries()) {
    if (now - session.lastActivity > maxAge) {
      chatSessions.delete(sessionId);
      logger.info(`Cleaned up expired session: ${sessionId}`);
    }
  }
}, 60 * 60 * 1000); // Run every hour

export const aiController = new AIController();
export default aiController;