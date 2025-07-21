/**
 * Nova Check EHR - Advanced AI Chat Agent
 * Comprehensive NLP-powered assistant for physicians
 * Features: Voice/Text commands, Full EHR access, Medical knowledge base
 */

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// AI/NLP Libraries (simulated - in production use OpenAI, Azure Cognitive Services, etc.)
class AdvancedNLPEngine {
  constructor() {
    this.medicalKnowledgeBase = new MedicalKnowledgeBase();
    this.intentClassifier = new IntentClassifier();
    this.entityExtractor = new EntityExtractor();
    this.responseGenerator = new ResponseGenerator();
  }

  async processQuery(query, context = {}) {
    try {
      // Intent classification
      const intent = await this.intentClassifier.classify(query);
      
      // Entity extraction
      const entities = await this.entityExtractor.extract(query);
      
      // Context understanding
      const contextualData = await this.analyzeContext(context);
      
      // Generate response
      const response = await this.responseGenerator.generate({
        query,
        intent,
        entities,
        context: contextualData
      });
      
      return {
        intent,
        entities,
        response,
        confidence: response.confidence,
        actions: response.suggestedActions
      };
    } catch (error) {
      console.error('NLP Processing Error:', error);
      return {
        intent: 'error',
        entities: [],
        response: { text: 'I apologize, but I encountered an error processing your request. Please try again.' },
        confidence: 0,
        actions: []
      };
    }
  }

  async analyzeContext(context) {
    return {
      currentPatient: context.patientId || null,
      userRole: context.userRole || 'physician',
      timestamp: new Date().toISOString(),
      sessionId: context.sessionId,
      previousQueries: context.history || []
    };
  }
}

class MedicalKnowledgeBase {
  constructor() {
    this.drugDatabase = new Map();
    this.diseaseDatabase = new Map();
    this.procedureDatabase = new Map();
    this.guidelinesDatabase = new Map();
    this.initializeKnowledgeBase();
  }

  initializeKnowledgeBase() {
    // Drug information
    this.drugDatabase.set('metformin', {
      name: 'Metformin',
      class: 'Biguanide',
      indications: ['Type 2 Diabetes', 'PCOS'],
      contraindications: ['Severe kidney disease', 'Metabolic acidosis'],
      dosage: '500-2000mg daily',
      sideEffects: ['GI upset', 'Lactic acidosis (rare)'],
      interactions: ['Contrast agents', 'Alcohol']
    });

    // Disease information
    this.diseaseDatabase.set('diabetes_type2', {
      name: 'Type 2 Diabetes Mellitus',
      icd10: 'E11',
      symptoms: ['Polyuria', 'Polydipsia', 'Fatigue', 'Blurred vision'],
      diagnosticCriteria: 'HbA1c ≥6.5% or FPG ≥126 mg/dL',
      treatment: ['Lifestyle modification', 'Metformin', 'Insulin if needed'],
      complications: ['Nephropathy', 'Retinopathy', 'Neuropathy', 'CVD']
    });

    // Clinical guidelines
    this.guidelinesDatabase.set('hypertension', {
      source: 'AHA/ACC 2017',
      stages: {
        normal: '<120/80',
        elevated: '120-129/<80',
        stage1: '130-139/80-89',
        stage2: '≥140/90'
      },
      treatment: {
        lifestyle: 'All stages',
        medication: 'Stage 1 with CVD risk, Stage 2 all patients'
      }
    });
  }

  async searchDrug(drugName) {
    const normalizedName = drugName.toLowerCase().replace(/\s+/g, '');
    return this.drugDatabase.get(normalizedName) || null;
  }

  async searchDisease(diseaseName) {
    const normalizedName = diseaseName.toLowerCase().replace(/\s+/g, '_');
    return this.diseaseDatabase.get(normalizedName) || null;
  }

  async getGuidelines(condition) {
    const normalizedCondition = condition.toLowerCase();
    return this.guidelinesDatabase.get(normalizedCondition) || null;
  }
}

class IntentClassifier {
  constructor() {
    this.intents = {
      'patient_lookup': ['find patient', 'search patient', 'patient information', 'patient details'],
      'medication_info': ['drug information', 'medication', 'prescription', 'dosage'],
      'lab_results': ['lab results', 'blood work', 'test results', 'laboratory'],
      'appointment_schedule': ['schedule', 'appointment', 'calendar', 'availability'],
      'diagnosis_help': ['diagnosis', 'differential', 'symptoms', 'condition'],
      'treatment_plan': ['treatment', 'therapy', 'management', 'care plan'],
      'medical_history': ['history', 'past medical', 'previous', 'prior'],
      'vital_signs': ['vitals', 'blood pressure', 'temperature', 'heart rate'],
      'billing_info': ['billing', 'insurance', 'charges', 'payment'],
      'clinical_guidelines': ['guidelines', 'protocol', 'recommendations', 'standards']
    };
  }

  async classify(query) {
    const normalizedQuery = query.toLowerCase();
    
    for (const [intent, keywords] of Object.entries(this.intents)) {
      for (const keyword of keywords) {
        if (normalizedQuery.includes(keyword)) {
          return {
            intent,
            confidence: this.calculateConfidence(normalizedQuery, keywords)
          };
        }
      }
    }
    
    return { intent: 'general_query', confidence: 0.5 };
  }

  calculateConfidence(query, keywords) {
    const matches = keywords.filter(keyword => query.includes(keyword)).length;
    return Math.min(0.9, 0.3 + (matches * 0.2));
  }
}

class EntityExtractor {
  constructor() {
    this.patterns = {
      patientId: /patient\s+(id\s+)?(\d+)/i,
      patientName: /patient\s+([a-zA-Z]+\s+[a-zA-Z]+)/i,
      medication: /(metformin|insulin|lisinopril|atorvastatin|amlodipine)/i,
      dosage: /(\d+)\s*(mg|mcg|g|ml|units?)/i,
      date: /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|today|yesterday|tomorrow)/i,
      time: /(\d{1,2}:\d{2}\s*(am|pm)?)/i,
      labValue: /(\d+\.?\d*)\s*(mg\/dl|mmol\/l|%)/i
    };
  }

  async extract(query) {
    const entities = {};
    
    for (const [entityType, pattern] of Object.entries(this.patterns)) {
      const match = query.match(pattern);
      if (match) {
        entities[entityType] = {
          value: match[1] || match[0],
          raw: match[0],
          position: match.index
        };
      }
    }
    
    return entities;
  }
}

class ResponseGenerator {
  constructor() {
    this.templates = {
      patient_lookup: 'I found the patient information you requested.',
      medication_info: 'Here\'s the medication information:',
      lab_results: 'Here are the latest lab results:',
      appointment_schedule: 'I can help you with scheduling.',
      diagnosis_help: 'Based on the symptoms, here are potential diagnoses:',
      treatment_plan: 'Here\'s a recommended treatment approach:',
      error: 'I apologize, but I couldn\'t process that request.'
    };
  }

  async generate({ query, intent, entities, context }) {
    const template = this.templates[intent.intent] || this.templates.error;
    
    return {
      text: template,
      confidence: intent.confidence,
      suggestedActions: this.generateActions(intent.intent, entities),
      data: await this.fetchRelevantData(intent.intent, entities, context)
    };
  }

  generateActions(intent, entities) {
    const actions = {
      patient_lookup: ['View Full Record', 'Schedule Appointment', 'Add Note'],
      medication_info: ['Prescribe', 'Check Interactions', 'View Alternatives'],
      lab_results: ['Order New Tests', 'Compare Previous', 'Flag Abnormal'],
      appointment_schedule: ['Book Appointment', 'Check Availability', 'Send Reminder']
    };
    
    return actions[intent] || ['Get More Info'];
  }

  async fetchRelevantData(intent, entities, context) {
    // This would integrate with the EHR database
    // For demo purposes, returning mock data
    return {
      timestamp: new Date().toISOString(),
      source: 'EHR Database',
      relevantRecords: []
    };
  }
}

class VoiceProcessor {
  constructor() {
    this.isListening = false;
    this.speechRecognition = null;
  }

  async initializeSpeechRecognition() {
    // In a real implementation, this would use Web Speech API or cloud services
    return {
      start: () => console.log('Voice recognition started'),
      stop: () => console.log('Voice recognition stopped'),
      onResult: (callback) => console.log('Voice result handler set')
    };
  }

  async processAudioInput(audioBuffer) {
    // Simulate speech-to-text processing
    return {
      transcript: 'Show me patient John Doe\'s latest lab results',
      confidence: 0.95,
      language: 'en-US'
    };
  }

  async generateSpeechResponse(text) {
    // Simulate text-to-speech
    return {
      audioUrl: '/api/tts/response.mp3',
      duration: 3.5,
      format: 'mp3'
    };
  }
}

class EHRDataAccess {
  constructor() {
    this.permissions = new Set(['read_patients', 'read_appointments', 'read_medical_records', 'read_lab_results']);
  }

  async getPatientData(patientId, fields = []) {
    if (!this.hasPermission('read_patients')) {
      throw new Error('Insufficient permissions');
    }

    // Mock patient data - in production, this would query the actual database
    return {
      id: patientId,
      name: 'John Doe',
      age: 45,
      gender: 'Male',
      mrn: 'MRN001234',
      allergies: ['Penicillin', 'Shellfish'],
      medications: [
        { name: 'Metformin', dosage: '500mg BID', startDate: '2023-01-15' },
        { name: 'Lisinopril', dosage: '10mg daily', startDate: '2023-02-01' }
      ],
      vitals: {
        lastRecorded: '2024-01-15',
        bloodPressure: '130/85',
        heartRate: 72,
        temperature: 98.6,
        weight: 180
      },
      labResults: [
        { test: 'HbA1c', value: '7.2%', date: '2024-01-10', normal: '4.0-5.6%' },
        { test: 'Creatinine', value: '1.1 mg/dL', date: '2024-01-10', normal: '0.7-1.3 mg/dL' }
      ]
    };
  }

  async searchPatients(criteria) {
    // Mock search results
    return [
      { id: 1, name: 'John Doe', mrn: 'MRN001234', dob: '1978-05-15' },
      { id: 2, name: 'Jane Smith', mrn: 'MRN001235', dob: '1985-08-22' }
    ];
  }

  async getAppointments(patientId, dateRange) {
    return [
      {
        id: 1,
        patientId,
        date: '2024-01-20',
        time: '10:00 AM',
        type: 'Follow-up',
        provider: 'Dr. Smith',
        status: 'Scheduled'
      }
    ];
  }

  async getMedicalHistory(patientId) {
    return {
      conditions: [
        { condition: 'Type 2 Diabetes', diagnosisDate: '2023-01-15', status: 'Active' },
        { condition: 'Hypertension', diagnosisDate: '2023-02-01', status: 'Active' }
      ],
      procedures: [
        { procedure: 'Annual Physical', date: '2024-01-10', provider: 'Dr. Smith' }
      ],
      hospitalizations: []
    };
  }

  hasPermission(permission) {
    return this.permissions.has(permission);
  }
}

class ChatAgent {
  constructor() {
    this.nlpEngine = new AdvancedNLPEngine();
    this.voiceProcessor = new VoiceProcessor();
    this.ehrAccess = new EHRDataAccess();
    this.sessions = new Map();
    this.conversationHistory = new Map();
  }

  async processMessage(message, sessionId, context = {}) {
    try {
      // Get or create session
      let session = this.sessions.get(sessionId) || this.createSession(sessionId);
      
      // Add message to conversation history
      this.addToHistory(sessionId, 'user', message);
      
      // Process with NLP engine
      const nlpResult = await this.nlpEngine.processQuery(message, {
        ...context,
        sessionId,
        history: this.conversationHistory.get(sessionId) || []
      });
      
      // Execute actions based on intent
      const actionResult = await this.executeIntent(nlpResult, context);
      
      // Generate comprehensive response
      const response = await this.generateResponse(nlpResult, actionResult);
      
      // Add response to history
      this.addToHistory(sessionId, 'assistant', response.text);
      
      // Update session
      session.lastActivity = new Date();
      session.messageCount++;
      
      return {
        success: true,
        response,
        sessionId,
        metadata: {
          intent: nlpResult.intent,
          confidence: nlpResult.confidence,
          processingTime: Date.now() - session.lastActivity.getTime()
        }
      };
    } catch (error) {
      console.error('Chat Agent Error:', error);
      return {
        success: false,
        error: error.message,
        response: {
          text: 'I apologize, but I encountered an error. Please try again or contact support.',
          type: 'error'
        }
      };
    }
  }

  async executeIntent(nlpResult, context) {
    const { intent, entities } = nlpResult;
    
    switch (intent.intent) {
      case 'patient_lookup':
        return await this.handlePatientLookup(entities, context);
      case 'medication_info':
        return await this.handleMedicationInfo(entities);
      case 'lab_results':
        return await this.handleLabResults(entities, context);
      case 'appointment_schedule':
        return await this.handleAppointmentSchedule(entities, context);
      case 'diagnosis_help':
        return await this.handleDiagnosisHelp(entities);
      case 'clinical_guidelines':
        return await this.handleClinicalGuidelines(entities);
      default:
        return { type: 'general', data: null };
    }
  }

  async handlePatientLookup(entities, context) {
    try {
      let patientData;
      
      if (entities.patientId) {
        patientData = await this.ehrAccess.getPatientData(entities.patientId.value);
      } else if (entities.patientName) {
        const searchResults = await this.ehrAccess.searchPatients({ name: entities.patientName.value });
        if (searchResults.length > 0) {
          patientData = await this.ehrAccess.getPatientData(searchResults[0].id);
        }
      } else if (context.currentPatient) {
        patientData = await this.ehrAccess.getPatientData(context.currentPatient);
      }
      
      return {
        type: 'patient_data',
        data: patientData,
        actions: ['View Full Record', 'Schedule Appointment', 'Add Note']
      };
    } catch (error) {
      return { type: 'error', data: { message: error.message } };
    }
  }

  async handleMedicationInfo(entities) {
    if (entities.medication) {
      const drugInfo = await this.nlpEngine.medicalKnowledgeBase.searchDrug(entities.medication.value);
      return {
        type: 'medication_info',
        data: drugInfo,
        actions: ['Prescribe', 'Check Interactions', 'View Alternatives']
      };
    }
    return { type: 'error', data: { message: 'Please specify a medication name' } };
  }

  async handleLabResults(entities, context) {
    const patientId = entities.patientId?.value || context.currentPatient;
    if (patientId) {
      const patientData = await this.ehrAccess.getPatientData(patientId);
      return {
        type: 'lab_results',
        data: patientData.labResults,
        actions: ['Order New Tests', 'Compare Previous', 'Flag Abnormal']
      };
    }
    return { type: 'error', data: { message: 'Please specify a patient' } };
  }

  async handleAppointmentSchedule(entities, context) {
    const patientId = entities.patientId?.value || context.currentPatient;
    if (patientId) {
      const appointments = await this.ehrAccess.getAppointments(patientId);
      return {
        type: 'appointments',
        data: appointments,
        actions: ['Book Appointment', 'Check Availability', 'Send Reminder']
      };
    }
    return { type: 'error', data: { message: 'Please specify a patient' } };
  }

  async handleDiagnosisHelp(entities) {
    // This would integrate with medical decision support systems
    return {
      type: 'diagnosis_support',
      data: {
        suggestions: [
          { condition: 'Type 2 Diabetes', probability: 0.85, reasoning: 'Based on symptoms and lab values' },
          { condition: 'Metabolic Syndrome', probability: 0.65, reasoning: 'Multiple risk factors present' }
        ]
      },
      actions: ['Order Additional Tests', 'Consult Specialist', 'Review Guidelines']
    };
  }

  async handleClinicalGuidelines(entities) {
    // Extract condition from entities or context
    const condition = entities.medication?.value || 'general';
    const guidelines = await this.nlpEngine.medicalKnowledgeBase.getGuidelines(condition);
    
    return {
      type: 'clinical_guidelines',
      data: guidelines,
      actions: ['View Full Guidelines', 'Save to Favorites', 'Share with Team']
    };
  }

  async generateResponse(nlpResult, actionResult) {
    const baseResponse = nlpResult.response;
    
    if (actionResult.type === 'error') {
      return {
        text: actionResult.data.message,
        type: 'error',
        data: null,
        actions: []
      };
    }
    
    return {
      text: this.formatResponseText(actionResult),
      type: actionResult.type,
      data: actionResult.data,
      actions: actionResult.actions || [],
      confidence: nlpResult.confidence
    };
  }

  formatResponseText(actionResult) {
    switch (actionResult.type) {
      case 'patient_data':
        const patient = actionResult.data;
        return `Found patient: ${patient.name} (MRN: ${patient.mrn}). Age: ${patient.age}, Gender: ${patient.gender}. Current medications: ${patient.medications.map(m => m.name).join(', ')}.`;
      
      case 'medication_info':
        const drug = actionResult.data;
        if (drug) {
          return `${drug.name} (${drug.class}): Used for ${drug.indications.join(', ')}. Typical dosage: ${drug.dosage}. Common side effects: ${drug.sideEffects.join(', ')}.`;
        }
        return 'Medication information not found in database.';
      
      case 'lab_results':
        const labs = actionResult.data;
        return `Latest lab results: ${labs.map(lab => `${lab.test}: ${lab.value} (Normal: ${lab.normal})`).join(', ')}.`;
      
      case 'appointments':
        const appts = actionResult.data;
        return `Upcoming appointments: ${appts.map(apt => `${apt.date} at ${apt.time} - ${apt.type}`).join(', ')}.`;
      
      default:
        return 'I\'ve processed your request. How else can I help you?';
    }
  }

  createSession(sessionId) {
    const session = {
      id: sessionId,
      createdAt: new Date(),
      lastActivity: new Date(),
      messageCount: 0,
      context: {}
    };
    
    this.sessions.set(sessionId, session);
    this.conversationHistory.set(sessionId, []);
    
    return session;
  }

  addToHistory(sessionId, role, message) {
    if (!this.conversationHistory.has(sessionId)) {
      this.conversationHistory.set(sessionId, []);
    }
    
    const history = this.conversationHistory.get(sessionId);
    history.push({
      role,
      message,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 50 messages
    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }
  }

  async processVoiceInput(audioBuffer, sessionId, context) {
    try {
      // Convert speech to text
      const speechResult = await this.voiceProcessor.processAudioInput(audioBuffer);
      
      // Process the text message
      const response = await this.processMessage(speechResult.transcript, sessionId, context);
      
      // Generate speech response
      const speechResponse = await this.voiceProcessor.generateSpeechResponse(response.response.text);
      
      return {
        ...response,
        voice: {
          transcript: speechResult.transcript,
          confidence: speechResult.confidence,
          audioResponse: speechResponse
        }
      };
    } catch (error) {
      console.error('Voice processing error:', error);
      throw error;
    }
  }
}

// Express server setup
const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Initialize chat agent
const chatAgent = new ChatAgent();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// File upload for voice messages
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// REST API Endpoints
app.post('/api/chat/message', async (req, res) => {
  try {
    const { message, sessionId, context } = req.body;
    
    if (!message || !sessionId) {
      return res.status(400).json({ error: 'Message and sessionId are required' });
    }
    
    const response = await chatAgent.processMessage(message, sessionId, context);
    res.json(response);
  } catch (error) {
    console.error('Chat message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/chat/voice', upload.single('audio'), async (req, res) => {
  try {
    const { sessionId, context } = req.body;
    const audioBuffer = req.file?.buffer;
    
    if (!audioBuffer || !sessionId) {
      return res.status(400).json({ error: 'Audio file and sessionId are required' });
    }
    
    const response = await chatAgent.processVoiceInput(
      audioBuffer, 
      sessionId, 
      JSON.parse(context || '{}')
    );
    
    res.json(response);
  } catch (error) {
    console.error('Voice message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/chat/session/:sessionId/history', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const history = chatAgent.conversationHistory.get(sessionId) || [];
    res.json({ history });
  } catch (error) {
    console.error('History retrieval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/chat/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    chatAgent.sessions.delete(sessionId);
    chatAgent.conversationHistory.delete(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('Session deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/chat/knowledge/search', async (req, res) => {
  try {
    const { query, type } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }
    
    const knowledgeBase = chatAgent.nlpEngine.medicalKnowledgeBase;
    let results;
    
    switch (type) {
      case 'drug':
        results = await knowledgeBase.searchDrug(query);
        break;
      case 'disease':
        results = await knowledgeBase.searchDisease(query);
        break;
      case 'guidelines':
        results = await knowledgeBase.getGuidelines(query);
        break;
      default:
        results = {
          drugs: await knowledgeBase.searchDrug(query),
          diseases: await knowledgeBase.searchDisease(query),
          guidelines: await knowledgeBase.getGuidelines(query)
        };
    }
    
    res.json({ results });
  } catch (error) {
    console.error('Knowledge search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// WebSocket for real-time chat
wss.on('connection', (ws) => {
  console.log('New WebSocket connection established');
  
  ws.on('message', async (data) => {
    try {
      const { type, payload } = JSON.parse(data);
      
      switch (type) {
        case 'chat_message':
          const response = await chatAgent.processMessage(
            payload.message,
            payload.sessionId,
            payload.context
          );
          ws.send(JSON.stringify({ type: 'chat_response', payload: response }));
          break;
          
        case 'voice_start':
          ws.send(JSON.stringify({ type: 'voice_ready', payload: { ready: true } }));
          break;
          
        case 'voice_data':
          // Handle streaming voice data
          break;
          
        default:
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'Unknown message type' } }));
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({ type: 'error', payload: { message: 'Processing error' } }));
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      nlpEngine: 'operational',
      voiceProcessor: 'operational',
      ehrAccess: 'operational',
      knowledgeBase: 'operational'
    }
  });
});

// Start server
const PORT = process.env.AI_CHAT_PORT || 3002;
server.listen(PORT, () => {
  console.log(`🤖 AI Chat Agent Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready for real-time communication`);
  console.log(`🧠 Advanced NLP engine initialized`);
  console.log(`🎤 Voice processing capabilities enabled`);
  console.log(`📊 EHR data access configured`);
  console.log(`📚 Medical knowledge base loaded`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down AI Chat Agent Server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = { app, chatAgent, server };