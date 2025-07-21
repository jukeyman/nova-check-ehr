// Simple AI Chat Agent for Nova Check EHR
// Advanced NLP capabilities with EHR integration

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// Load environment variables manually
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) {
      process.env[key.trim()] = value.trim();
    }
  });
}

// In-memory data stores (shared with enhanced-server)
let patients = [
  {
    id: 1,
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '1985-03-15',
    email: 'john.doe@email.com',
    phone: '555-0123',
    address: '123 Main St, Anytown, ST 12345',
    insuranceProvider: 'Blue Cross Blue Shield',
    insuranceId: 'BC123456789',
    emergencyContact: 'Jane Doe - 555-0124',
    allergies: ['Penicillin', 'Shellfish'],
    medications: ['Lisinopril 10mg', 'Metformin 500mg'],
    medicalHistory: ['Hypertension', 'Type 2 Diabetes'],
    createdAt: new Date().toISOString()
  },
  {
    id: 2,
    firstName: 'Sarah',
    lastName: 'Johnson',
    dateOfBirth: '1992-07-22',
    email: 'sarah.johnson@email.com',
    phone: '555-0456',
    address: '456 Oak Ave, Somewhere, ST 67890',
    insuranceProvider: 'Aetna',
    insuranceId: 'AET987654321',
    emergencyContact: 'Mike Johnson - 555-0457',
    allergies: ['Latex'],
    medications: ['Birth Control'],
    medicalHistory: ['Asthma'],
    createdAt: new Date().toISOString()
  }
];

let appointments = [
  {
    id: 1,
    patientId: 1,
    patientName: 'John Doe',
    providerId: 1,
    providerName: 'Dr. Smith',
    date: '2024-01-15',
    time: '10:00 AM',
    type: 'Follow-up',
    status: 'Scheduled',
    notes: 'Routine diabetes check-up',
    createdAt: new Date().toISOString()
  },
  {
    id: 2,
    patientId: 2,
    patientName: 'Sarah Johnson',
    providerId: 2,
    providerName: 'Dr. Wilson',
    date: '2024-01-16',
    time: '2:30 PM',
    type: 'Annual Physical',
    status: 'Scheduled',
    notes: 'Annual wellness exam',
    createdAt: new Date().toISOString()
  }
];

let medicalRecords = [
  {
    id: 1,
    patientId: 1,
    patientName: 'John Doe',
    providerId: 1,
    providerName: 'Dr. Smith',
    date: '2024-01-10',
    type: 'Progress Note',
    diagnosis: 'Type 2 Diabetes Mellitus',
    treatment: 'Continue current medication regimen',
    notes: 'Patient reports good glucose control. HbA1c: 7.2%',
    vitals: {
      bloodPressure: '130/80',
      heartRate: '72',
      temperature: '98.6°F',
      weight: '180 lbs',
      height: '5\'10"'
    },
    createdAt: new Date().toISOString()
  },
  {
    id: 2,
    patientId: 2,
    patientName: 'Sarah Johnson',
    providerId: 2,
    providerName: 'Dr. Wilson',
    date: '2024-01-08',
    type: 'Lab Results',
    diagnosis: 'Normal Annual Labs',
    treatment: 'Continue current health maintenance',
    notes: 'All lab values within normal limits',
    vitals: {
      bloodPressure: '118/75',
      heartRate: '68',
      temperature: '98.4°F',
      weight: '135 lbs',
      height: '5\'6"'
    },
    createdAt: new Date().toISOString()
  }
];

// AI Chat Sessions
let chatSessions = new Map();
let sessionCounter = 0;

// Medical Knowledge Base
const medicalKnowledgeBase = {
  conditions: {
    'diabetes': {
      description: 'A group of metabolic disorders characterized by high blood sugar levels',
      symptoms: ['increased thirst', 'frequent urination', 'fatigue', 'blurred vision'],
      treatments: ['insulin therapy', 'metformin', 'lifestyle modifications', 'blood glucose monitoring'],
      icd10: 'E11.9'
    },
    'hypertension': {
      description: 'High blood pressure, a condition where blood pressure is consistently elevated',
      symptoms: ['headaches', 'shortness of breath', 'nosebleeds', 'chest pain'],
      treatments: ['ACE inhibitors', 'diuretics', 'lifestyle changes', 'regular monitoring'],
      icd10: 'I10'
    },
    'asthma': {
      description: 'A respiratory condition marked by attacks of spasm in the bronchi',
      symptoms: ['wheezing', 'shortness of breath', 'chest tightness', 'coughing'],
      treatments: ['bronchodilators', 'corticosteroids', 'avoiding triggers', 'action plan'],
      icd10: 'J45.9'
    }
  },
  medications: {
    'metformin': {
      class: 'Biguanide',
      indication: 'Type 2 diabetes mellitus',
      dosage: '500mg-2000mg daily',
      sideEffects: ['nausea', 'diarrhea', 'metallic taste'],
      contraindications: ['kidney disease', 'liver disease']
    },
    'lisinopril': {
      class: 'ACE Inhibitor',
      indication: 'Hypertension, heart failure',
      dosage: '5mg-40mg daily',
      sideEffects: ['dry cough', 'hyperkalemia', 'angioedema'],
      contraindications: ['pregnancy', 'bilateral renal artery stenosis']
    }
  },
  procedures: {
    'blood_glucose_test': {
      description: 'Test to measure blood sugar levels',
      preparation: 'Fasting for 8-12 hours',
      normalRange: '70-100 mg/dL (fasting)',
      cpt: '82947'
    },
    'blood_pressure_check': {
      description: 'Measurement of arterial blood pressure',
      preparation: 'Rest for 5 minutes before measurement',
      normalRange: '<120/80 mmHg',
      cpt: '99000'
    }
  }
};

// Advanced NLP Engine
class AdvancedNLPEngine {
  constructor() {
    this.intents = {
      'patient_lookup': ['find patient', 'search patient', 'patient information', 'patient details'],
      'appointment_schedule': ['schedule appointment', 'book appointment', 'appointment booking'],
      'medical_record': ['medical record', 'patient history', 'medical history', 'health record'],
      'medication_info': ['medication', 'drug information', 'prescription', 'medicine'],
      'condition_info': ['condition', 'disease', 'diagnosis', 'symptoms'],
      'lab_results': ['lab results', 'test results', 'laboratory', 'blood work'],
      'vital_signs': ['vital signs', 'vitals', 'blood pressure', 'heart rate', 'temperature'],
      'general_query': ['what is', 'tell me about', 'explain', 'information about']
    };
    
    this.entities = {
      'patient_name': /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g,
      'patient_id': /\b(?:patient )?(?:id )?#?(\d+)\b/gi,
      'date': /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/g,
      'medication': /\b(metformin|lisinopril|insulin|aspirin|ibuprofen)\b/gi,
      'condition': /\b(diabetes|hypertension|asthma|depression|anxiety)\b/gi,
      'vital_type': /\b(blood pressure|heart rate|temperature|weight|height)\b/gi
    };
  }
  
  classifyIntent(text) {
    const lowerText = text.toLowerCase();
    
    for (const [intent, keywords] of Object.entries(this.intents)) {
      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
          return intent;
        }
      }
    }
    
    return 'general_query';
  }
  
  extractEntities(text) {
    const entities = {};
    
    for (const [entityType, regex] of Object.entries(this.entities)) {
      const matches = text.match(regex);
      if (matches) {
        entities[entityType] = matches;
      }
    }
    
    return entities;
  }
  
  processQuery(text) {
    const intent = this.classifyIntent(text);
    const entities = this.extractEntities(text);
    
    return {
      intent,
      entities,
      originalText: text,
      confidence: this.calculateConfidence(intent, entities, text)
    };
  }
  
  calculateConfidence(intent, entities, text) {
    let confidence = 0.5; // Base confidence
    
    // Increase confidence based on entity matches
    const entityCount = Object.keys(entities).length;
    confidence += entityCount * 0.1;
    
    // Increase confidence for specific medical terms
    const medicalTerms = ['patient', 'doctor', 'medication', 'appointment', 'diagnosis'];
    const medicalMatches = medicalTerms.filter(term => text.toLowerCase().includes(term));
    confidence += medicalMatches.length * 0.05;
    
    return Math.min(confidence, 1.0);
  }
}

// AI Response Generator
class AIResponseGenerator {
  constructor(nlpEngine) {
    this.nlpEngine = nlpEngine;
  }
  
  async generateResponse(query, sessionId) {
    const analysis = this.nlpEngine.processQuery(query);
    const session = chatSessions.get(sessionId) || { context: {}, history: [] };
    
    let response;
    
    switch (analysis.intent) {
      case 'patient_lookup':
        response = await this.handlePatientLookup(analysis, session);
        break;
      case 'appointment_schedule':
        response = await this.handleAppointmentQuery(analysis, session);
        break;
      case 'medical_record':
        response = await this.handleMedicalRecordQuery(analysis, session);
        break;
      case 'medication_info':
        response = await this.handleMedicationQuery(analysis, session);
        break;
      case 'condition_info':
        response = await this.handleConditionQuery(analysis, session);
        break;
      case 'lab_results':
        response = await this.handleLabResultsQuery(analysis, session);
        break;
      case 'vital_signs':
        response = await this.handleVitalSignsQuery(analysis, session);
        break;
      default:
        response = await this.handleGeneralQuery(analysis, session);
    }
    
    // Update session
    session.history.push({ query, response, timestamp: new Date().toISOString() });
    chatSessions.set(sessionId, session);
    
    return {
      response,
      intent: analysis.intent,
      entities: analysis.entities,
      confidence: analysis.confidence,
      sessionId
    };
  }
  
  async handlePatientLookup(analysis, session) {
    const { entities } = analysis;
    
    if (entities.patient_name) {
      const name = entities.patient_name[0];
      const patient = patients.find(p => 
        `${p.firstName} ${p.lastName}`.toLowerCase().includes(name.toLowerCase())
      );
      
      if (patient) {
        session.context.currentPatient = patient;
        return `Found patient: ${patient.firstName} ${patient.lastName}\n` +
               `DOB: ${patient.dateOfBirth}\n` +
               `Phone: ${patient.phone}\n` +
               `Insurance: ${patient.insuranceProvider}\n` +
               `Allergies: ${patient.allergies.join(', ')}\n` +
               `Current Medications: ${patient.medications.join(', ')}`;
      } else {
        return `No patient found with the name "${name}". Please check the spelling or try a different search.`;
      }
    }
    
    if (entities.patient_id) {
      const id = parseInt(entities.patient_id[0]);
      const patient = patients.find(p => p.id === id);
      
      if (patient) {
        session.context.currentPatient = patient;
        return `Found patient ID ${id}: ${patient.firstName} ${patient.lastName}\n` +
               `DOB: ${patient.dateOfBirth}\n` +
               `Phone: ${patient.phone}\n` +
               `Insurance: ${patient.insuranceProvider}`;
      } else {
        return `No patient found with ID ${id}.`;
      }
    }
    
    return 'Please specify a patient name or ID to search for patient information.';
  }
  
  async handleAppointmentQuery(analysis, session) {
    const currentPatient = session.context.currentPatient;
    
    if (currentPatient) {
      const patientAppointments = appointments.filter(a => a.patientId === currentPatient.id);
      
      if (patientAppointments.length > 0) {
        let response = `Appointments for ${currentPatient.firstName} ${currentPatient.lastName}:\n`;
        patientAppointments.forEach(apt => {
          response += `• ${apt.date} at ${apt.time} - ${apt.type} with ${apt.providerName} (${apt.status})\n`;
        });
        return response;
      } else {
        return `No appointments found for ${currentPatient.firstName} ${currentPatient.lastName}.`;
      }
    }
    
    // Show all appointments if no specific patient
    let response = 'Upcoming appointments:\n';
    appointments.forEach(apt => {
      response += `• ${apt.patientName} - ${apt.date} at ${apt.time} with ${apt.providerName}\n`;
    });
    return response;
  }
  
  async handleMedicalRecordQuery(analysis, session) {
    const currentPatient = session.context.currentPatient;
    
    if (currentPatient) {
      const records = medicalRecords.filter(r => r.patientId === currentPatient.id);
      
      if (records.length > 0) {
        let response = `Medical records for ${currentPatient.firstName} ${currentPatient.lastName}:\n`;
        records.forEach(record => {
          response += `\n• ${record.date} - ${record.type}\n`;
          response += `  Diagnosis: ${record.diagnosis}\n`;
          response += `  Treatment: ${record.treatment}\n`;
          response += `  Notes: ${record.notes}\n`;
        });
        return response;
      } else {
        return `No medical records found for ${currentPatient.firstName} ${currentPatient.lastName}.`;
      }
    }
    
    return 'Please specify a patient first to view their medical records.';
  }
  
  async handleMedicationQuery(analysis, session) {
    const { entities } = analysis;
    
    if (entities.medication) {
      const medication = entities.medication[0].toLowerCase();
      const medInfo = medicalKnowledgeBase.medications[medication];
      
      if (medInfo) {
        return `${medication.charAt(0).toUpperCase() + medication.slice(1)} Information:\n` +
               `Class: ${medInfo.class}\n` +
               `Indication: ${medInfo.indication}\n` +
               `Typical Dosage: ${medInfo.dosage}\n` +
               `Common Side Effects: ${medInfo.sideEffects.join(', ')}\n` +
               `Contraindications: ${medInfo.contraindications.join(', ')}`;
      }
    }
    
    const currentPatient = session.context.currentPatient;
    if (currentPatient) {
      return `Current medications for ${currentPatient.firstName} ${currentPatient.lastName}:\n` +
             currentPatient.medications.map(med => `• ${med}`).join('\n');
    }
    
    return 'Please specify a medication name or select a patient to view their medications.';
  }
  
  async handleConditionQuery(analysis, session) {
    const { entities } = analysis;
    
    if (entities.condition) {
      const condition = entities.condition[0].toLowerCase();
      const conditionInfo = medicalKnowledgeBase.conditions[condition];
      
      if (conditionInfo) {
        return `${condition.charAt(0).toUpperCase() + condition.slice(1)} Information:\n` +
               `Description: ${conditionInfo.description}\n` +
               `Common Symptoms: ${conditionInfo.symptoms.join(', ')}\n` +
               `Treatments: ${conditionInfo.treatments.join(', ')}\n` +
               `ICD-10 Code: ${conditionInfo.icd10}`;
      }
    }
    
    const currentPatient = session.context.currentPatient;
    if (currentPatient) {
      return `Medical history for ${currentPatient.firstName} ${currentPatient.lastName}:\n` +
             currentPatient.medicalHistory.map(condition => `• ${condition}`).join('\n');
    }
    
    return 'Please specify a condition name or select a patient to view their medical history.';
  }
  
  async handleLabResultsQuery(analysis, session) {
    const currentPatient = session.context.currentPatient;
    
    if (currentPatient) {
      const labRecords = medicalRecords.filter(r => 
        r.patientId === currentPatient.id && r.type.toLowerCase().includes('lab')
      );
      
      if (labRecords.length > 0) {
        let response = `Lab results for ${currentPatient.firstName} ${currentPatient.lastName}:\n`;
        labRecords.forEach(record => {
          response += `\n• ${record.date} - ${record.type}\n`;
          response += `  Results: ${record.diagnosis}\n`;
          response += `  Notes: ${record.notes}\n`;
        });
        return response;
      } else {
        return `No lab results found for ${currentPatient.firstName} ${currentPatient.lastName}.`;
      }
    }
    
    return 'Please specify a patient first to view their lab results.';
  }
  
  async handleVitalSignsQuery(analysis, session) {
    const currentPatient = session.context.currentPatient;
    
    if (currentPatient) {
      const recentRecord = medicalRecords
        .filter(r => r.patientId === currentPatient.id && r.vitals)
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      
      if (recentRecord) {
        const vitals = recentRecord.vitals;
        return `Latest vital signs for ${currentPatient.firstName} ${currentPatient.lastName} (${recentRecord.date}):\n` +
               `• Blood Pressure: ${vitals.bloodPressure}\n` +
               `• Heart Rate: ${vitals.heartRate} bpm\n` +
               `• Temperature: ${vitals.temperature}\n` +
               `• Weight: ${vitals.weight}\n` +
               `• Height: ${vitals.height}`;
      } else {
        return `No vital signs recorded for ${currentPatient.firstName} ${currentPatient.lastName}.`;
      }
    }
    
    return 'Please specify a patient first to view their vital signs.';
  }
  
  async handleGeneralQuery(analysis, session) {
    const query = analysis.originalText.toLowerCase();
    
    if (query.includes('help') || query.includes('what can you do')) {
      return 'I\'m your AI medical assistant. I can help you with:\n' +
             '• Patient lookup and information\n' +
             '• Appointment scheduling and viewing\n' +
             '• Medical records and history\n' +
             '• Medication information\n' +
             '• Condition and diagnosis details\n' +
             '• Lab results and vital signs\n' +
             '• General medical knowledge\n\n' +
             'Try asking: "Find patient John Doe" or "Show appointments for today"';
    }
    
    if (query.includes('stats') || query.includes('dashboard')) {
      return `System Statistics:\n` +
             `• Total Patients: ${patients.length}\n` +
             `• Scheduled Appointments: ${appointments.length}\n` +
             `• Medical Records: ${medicalRecords.length}\n` +
             `• Active Chat Sessions: ${chatSessions.size}`;
    }
    
    return 'I\'m here to help with medical information and patient data. ' +
           'You can ask me about patients, appointments, medications, or medical conditions. ' +
           'Type "help" for more information about what I can do.';
  }
}

// Initialize AI components
const nlpEngine = new AdvancedNLPEngine();
const responseGenerator = new AIResponseGenerator(nlpEngine);

// HTTP Server
const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;
  
  try {
    // AI Chat endpoints
    if (pathname === '/api/ai/chat' && method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', async () => {
        try {
          const { message, sessionId } = JSON.parse(body);
          const response = await responseGenerator.generateResponse(message, sessionId || `session_${++sessionCounter}`);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request body' }));
        }
      });
      return;
    }
    
    if (pathname === '/api/ai/sessions' && method === 'GET') {
      const sessions = Array.from(chatSessions.entries()).map(([id, session]) => ({
        id,
        messageCount: session.history.length,
        lastActivity: session.history[session.history.length - 1]?.timestamp || null,
        context: session.context
      }));
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
      return;
    }
    
    if (pathname.startsWith('/api/ai/sessions/') && method === 'GET') {
      const sessionId = pathname.split('/')[4];
      const session = chatSessions.get(sessionId);
      
      if (session) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessionId, ...session }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
      }
      return;
    }
    
    if (pathname === '/api/ai/knowledge' && method === 'GET') {
      const query = parsedUrl.query.q;
      if (query) {
        const results = searchKnowledgeBase(query);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ query, results }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ knowledgeBase: medicalKnowledgeBase }));
      }
      return;
    }
    
    // Voice processing endpoint (simulated)
    if (pathname === '/api/ai/voice' && method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', async () => {
        try {
          const { audioData, sessionId } = JSON.parse(body);
          
          // Simulate voice-to-text conversion
          const transcribedText = simulateVoiceToText(audioData);
          const response = await responseGenerator.generateResponse(transcribedText, sessionId || `session_${++sessionCounter}`);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ...response,
            transcription: transcribedText,
            audioResponse: simulateTextToSpeech(response.response)
          }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid voice data' }));
        }
      });
      return;
    }
    
    // Health check
    if (pathname === '/api/ai/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          nlpEngine: 'active',
          responseGenerator: 'active',
          knowledgeBase: 'loaded',
          chatSessions: chatSessions.size
        }
      }));
      return;
    }
    
    // API info
    if (pathname === '/api/ai' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'Nova Check AI Chat Agent',
        version: '1.0.0',
        description: 'Advanced NLP-powered medical assistant with EHR integration',
        endpoints: {
          'POST /api/ai/chat': 'Send chat message',
          'GET /api/ai/sessions': 'List chat sessions',
          'GET /api/ai/sessions/:id': 'Get session details',
          'GET /api/ai/knowledge': 'Search knowledge base',
          'POST /api/ai/voice': 'Voice input processing',
          'GET /api/ai/health': 'Health check'
        },
        capabilities: [
          'Natural Language Processing',
          'Intent Classification',
          'Entity Extraction',
          'Medical Knowledge Base',
          'Patient Data Access',
          'Voice Processing (Simulated)',
          'Context-Aware Responses'
        ]
      }));
      return;
    }
    
    // 404 for unknown routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
    
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

// Helper functions
function searchKnowledgeBase(query) {
  const results = [];
  const lowerQuery = query.toLowerCase();
  
  // Search conditions
  for (const [name, info] of Object.entries(medicalKnowledgeBase.conditions)) {
    if (name.includes(lowerQuery) || 
        info.description.toLowerCase().includes(lowerQuery) ||
        info.symptoms.some(s => s.toLowerCase().includes(lowerQuery))) {
      results.push({ type: 'condition', name, ...info });
    }
  }
  
  // Search medications
  for (const [name, info] of Object.entries(medicalKnowledgeBase.medications)) {
    if (name.includes(lowerQuery) || 
        info.indication.toLowerCase().includes(lowerQuery) ||
        info.class.toLowerCase().includes(lowerQuery)) {
      results.push({ type: 'medication', name, ...info });
    }
  }
  
  // Search procedures
  for (const [name, info] of Object.entries(medicalKnowledgeBase.procedures)) {
    if (name.includes(lowerQuery) || 
        info.description.toLowerCase().includes(lowerQuery)) {
      results.push({ type: 'procedure', name, ...info });
    }
  }
  
  return results;
}

function simulateVoiceToText(audioData) {
  // Simulate voice recognition - in real implementation, this would use
  // services like Google Speech-to-Text, Azure Speech, or AWS Transcribe
  const sampleQueries = [
    'Find patient John Doe',
    'Show me the appointments for today',
    'What medications is Sarah Johnson taking',
    'Tell me about diabetes symptoms',
    'Show vital signs for patient ID 1'
  ];
  
  return sampleQueries[Math.floor(Math.random() * sampleQueries.length)];
}

function simulateTextToSpeech(text) {
  // Simulate text-to-speech conversion - in real implementation, this would use
  // services like Google Text-to-Speech, Azure Speech, or AWS Polly
  return {
    audioUrl: 'data:audio/wav;base64,simulated_audio_data',
    duration: Math.ceil(text.length / 10), // Rough estimate
    voice: 'en-US-Standard-A'
  };
}

// Start server
const PORT = process.env.AI_CHAT_PORT || 3002;
server.listen(PORT, () => {
  console.log(`🤖 Nova Check AI Chat Agent running on http://localhost:${PORT}`);
  console.log('🧠 Advanced NLP Engine: Active');
  console.log('📚 Medical Knowledge Base: Loaded');
  console.log('🎤 Voice Processing: Simulated');
  console.log('💬 Chat Sessions: Ready');
  console.log('\n🔗 Available Endpoints:');
  console.log(`   POST http://localhost:${PORT}/api/ai/chat`);
  console.log(`   GET  http://localhost:${PORT}/api/ai/sessions`);
  console.log(`   GET  http://localhost:${PORT}/api/ai/knowledge`);
  console.log(`   POST http://localhost:${PORT}/api/ai/voice`);
  console.log(`   GET  http://localhost:${PORT}/api/ai/health`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down AI Chat Agent...');
  server.close(() => {
    console.log('✅ AI Chat Agent stopped');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('✅ AI Chat Agent stopped');
    process.exit(0);
  });
});