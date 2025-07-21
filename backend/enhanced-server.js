// Enhanced HTTP server with patient management and EHR functionality
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Load environment variables manually from .env file
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const envLines = envContent.split('\n');
  
  envLines.forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, '');
        process.env[key] = value;
      }
    }
  });
}

const PORT = process.env.PORT || 3001;

// In-memory data store (replace with database in production)
let patients = [
  {
    id: '1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@email.com',
    phone: '(555) 123-4567',
    dateOfBirth: '1985-06-15',
    gender: 'male',
    address: {
      street: '123 Main St',
      city: 'Anytown',
      state: 'CA',
      zipCode: '12345'
    },
    emergencyContact: {
      name: 'Jane Doe',
      relationship: 'Spouse',
      phone: '(555) 123-4568'
    },
    insurance: {
      provider: 'Blue Cross Blue Shield',
      policyNumber: 'BC123456789',
      groupNumber: 'GRP001'
    },
    medicalHistory: [
      'Hypertension',
      'Type 2 Diabetes'
    ],
    allergies: [
      'Penicillin',
      'Shellfish'
    ],
    medications: [
      {
        name: 'Metformin',
        dosage: '500mg',
        frequency: 'Twice daily'
      },
      {
        name: 'Lisinopril',
        dosage: '10mg',
        frequency: 'Once daily'
      }
    ],
    vitals: {
      bloodPressure: '130/85',
      heartRate: 72,
      temperature: 98.6,
      weight: 180,
      height: 70
    },
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-20T14:45:00Z'
  },
  {
    id: '2',
    firstName: 'Sarah',
    lastName: 'Johnson',
    email: 'sarah.johnson@email.com',
    phone: '(555) 987-6543',
    dateOfBirth: '1992-03-22',
    gender: 'female',
    address: {
      street: '456 Oak Ave',
      city: 'Springfield',
      state: 'IL',
      zipCode: '62701'
    },
    emergencyContact: {
      name: 'Michael Johnson',
      relationship: 'Brother',
      phone: '(555) 987-6544'
    },
    insurance: {
      provider: 'Aetna',
      policyNumber: 'AET987654321',
      groupNumber: 'GRP002'
    },
    medicalHistory: [
      'Asthma'
    ],
    allergies: [
      'Pollen',
      'Dust mites'
    ],
    medications: [
      {
        name: 'Albuterol Inhaler',
        dosage: '90mcg',
        frequency: 'As needed'
      }
    ],
    vitals: {
      bloodPressure: '118/75',
      heartRate: 68,
      temperature: 98.4,
      weight: 135,
      height: 65
    },
    createdAt: '2024-01-10T09:15:00Z',
    updatedAt: '2024-01-18T11:20:00Z'
  }
];

let appointments = [
  {
    id: '1',
    patientId: '1',
    patientName: 'John Doe',
    providerId: 'dr-smith',
    providerName: 'Dr. Emily Smith',
    date: '2024-01-25',
    time: '10:00',
    type: 'Follow-up',
    status: 'scheduled',
    reason: 'Diabetes management check-up',
    duration: 30,
    notes: 'Review blood sugar logs and medication adherence'
  },
  {
    id: '2',
    patientId: '2',
    patientName: 'Sarah Johnson',
    providerId: 'dr-wilson',
    providerName: 'Dr. Michael Wilson',
    date: '2024-01-26',
    time: '14:30',
    type: 'Annual Physical',
    status: 'scheduled',
    reason: 'Annual wellness exam',
    duration: 60,
    notes: 'Complete physical examination and preventive care'
  }
];

let medicalRecords = [
  {
    id: '1',
    patientId: '1',
    date: '2024-01-20',
    type: 'Lab Results',
    title: 'Blood Work - Diabetes Panel',
    provider: 'Dr. Emily Smith',
    content: {
      glucose: '145 mg/dL',
      hba1c: '7.2%',
      cholesterol: '185 mg/dL',
      triglycerides: '150 mg/dL'
    },
    status: 'final'
  },
  {
    id: '2',
    patientId: '1',
    date: '2024-01-15',
    type: 'Visit Note',
    title: 'Routine Follow-up',
    provider: 'Dr. Emily Smith',
    content: {
      chiefComplaint: 'Routine diabetes follow-up',
      assessment: 'Diabetes well controlled with current medications',
      plan: 'Continue current medications, follow-up in 3 months'
    },
    status: 'final'
  }
];

// Utility functions
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function generateId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function sendResponse(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res, statusCode, message) {
  sendResponse(res, statusCode, {
    error: true,
    message,
    timestamp: new Date().toISOString()
  });
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  try {
    // Root endpoint
    if (pathname === '/' && method === 'GET') {
      sendResponse(res, 200, {
        message: 'Nova Check EHR Backend API',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        port: PORT,
        endpoints: {
          patients: '/api/v1/patients',
          appointments: '/api/v1/appointments',
          medicalRecords: '/api/v1/medical-records',
          health: '/health',
          status: '/api/v1/status'
        }
      });
    }
    // Health check
    else if (pathname === '/health' && method === 'GET') {
      sendResponse(res, 200, {
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage(),
        version: process.version
      });
    }
    // API Status
    else if (pathname === '/api/v1/status' && method === 'GET') {
      sendResponse(res, 200, {
        api: 'Nova Check EHR',
        version: 'v1',
        status: 'operational',
        database: {
          url: process.env.DATABASE_URL ? 'configured' : 'not configured',
          status: 'simulated (in-memory)'
        },
        features: {
          authentication: 'available',
          patients: 'available',
          appointments: 'available',
          medical_records: 'available'
        },
        statistics: {
          totalPatients: patients.length,
          totalAppointments: appointments.length,
          totalRecords: medicalRecords.length
        },
        timestamp: new Date().toISOString()
      });
    }
    // Patients endpoints
    else if (pathname === '/api/v1/patients' && method === 'GET') {
      const page = parseInt(url.searchParams.get('page')) || 1;
      const limit = parseInt(url.searchParams.get('limit')) || 10;
      const search = url.searchParams.get('search') || '';
      
      let filteredPatients = patients;
      if (search) {
        filteredPatients = patients.filter(patient => 
          patient.firstName.toLowerCase().includes(search.toLowerCase()) ||
          patient.lastName.toLowerCase().includes(search.toLowerCase()) ||
          patient.email.toLowerCase().includes(search.toLowerCase())
        );
      }
      
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedPatients = filteredPatients.slice(startIndex, endIndex);
      
      sendResponse(res, 200, {
        patients: paginatedPatients,
        pagination: {
          page,
          limit,
          total: filteredPatients.length,
          pages: Math.ceil(filteredPatients.length / limit)
        },
        timestamp: new Date().toISOString()
      });
    }
    else if (pathname === '/api/v1/patients' && method === 'POST') {
      const body = await parseBody(req);
      const newPatient = {
        id: generateId(),
        ...body,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      patients.push(newPatient);
      sendResponse(res, 201, {
        message: 'Patient created successfully',
        patient: newPatient
      });
    }
    else if (pathname.match(/^\/api\/v1\/patients\/([^/]+)$/) && method === 'GET') {
      const patientId = pathname.split('/').pop();
      const patient = patients.find(p => p.id === patientId);
      if (!patient) {
        sendError(res, 404, 'Patient not found');
        return;
      }
      sendResponse(res, 200, { patient });
    }
    else if (pathname.match(/^\/api\/v1\/patients\/([^/]+)$/) && method === 'PUT') {
      const patientId = pathname.split('/').pop();
      const body = await parseBody(req);
      const patientIndex = patients.findIndex(p => p.id === patientId);
      if (patientIndex === -1) {
        sendError(res, 404, 'Patient not found');
        return;
      }
      patients[patientIndex] = {
        ...patients[patientIndex],
        ...body,
        updatedAt: new Date().toISOString()
      };
      sendResponse(res, 200, {
        message: 'Patient updated successfully',
        patient: patients[patientIndex]
      });
    }
    else if (pathname.match(/^\/api\/v1\/patients\/([^/]+)$/) && method === 'DELETE') {
      const patientId = pathname.split('/').pop();
      const patientIndex = patients.findIndex(p => p.id === patientId);
      if (patientIndex === -1) {
        sendError(res, 404, 'Patient not found');
        return;
      }
      patients.splice(patientIndex, 1);
      sendResponse(res, 200, {
        message: 'Patient deleted successfully'
      });
    }
    // Appointments endpoints
    else if (pathname === '/api/v1/appointments' && method === 'GET') {
      const patientId = url.searchParams.get('patientId');
      const providerId = url.searchParams.get('providerId');
      const date = url.searchParams.get('date');
      
      let filteredAppointments = appointments;
      if (patientId) {
        filteredAppointments = filteredAppointments.filter(apt => apt.patientId === patientId);
      }
      if (providerId) {
        filteredAppointments = filteredAppointments.filter(apt => apt.providerId === providerId);
      }
      if (date) {
        filteredAppointments = filteredAppointments.filter(apt => apt.date === date);
      }
      
      sendResponse(res, 200, {
        appointments: filteredAppointments,
        total: filteredAppointments.length,
        timestamp: new Date().toISOString()
      });
    }
    else if (pathname === '/api/v1/appointments' && method === 'POST') {
      const body = await parseBody(req);
      const newAppointment = {
        id: generateId(),
        ...body,
        status: 'scheduled',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      appointments.push(newAppointment);
      sendResponse(res, 201, {
        message: 'Appointment created successfully',
        appointment: newAppointment
      });
    }
    // Medical Records endpoints
    else if (pathname === '/api/v1/medical-records' && method === 'GET') {
      const patientId = url.searchParams.get('patientId');
      
      let filteredRecords = medicalRecords;
      if (patientId) {
        filteredRecords = medicalRecords.filter(record => record.patientId === patientId);
      }
      
      sendResponse(res, 200, {
        records: filteredRecords,
        total: filteredRecords.length,
        timestamp: new Date().toISOString()
      });
    }
    else if (pathname === '/api/v1/medical-records' && method === 'POST') {
      const body = await parseBody(req);
      const newRecord = {
        id: generateId(),
        ...body,
        date: new Date().toISOString().split('T')[0],
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      medicalRecords.push(newRecord);
      sendResponse(res, 201, {
        message: 'Medical record created successfully',
        record: newRecord
      });
    }
    // Dashboard stats endpoint
    else if (pathname === '/api/v1/dashboard/stats' && method === 'GET') {
      const today = new Date().toISOString().split('T')[0];
      const todayAppointments = appointments.filter(apt => apt.date === today);
      
      sendResponse(res, 200, {
        stats: {
          totalPatients: patients.length,
          totalAppointments: appointments.length,
          todayAppointments: todayAppointments.length,
          totalRecords: medicalRecords.length,
          activeProviders: 5, // Mock data
          systemUptime: process.uptime(),
          lastUpdated: new Date().toISOString()
        }
      });
    }
    // 404 for unknown routes
    else {
      sendError(res, 404, `Route ${method} ${pathname} not found`);
    }
  } catch (error) {
    console.error('Server error:', error);
    sendError(res, 500, 'Internal server error');
  }
});

// Start server
server.listen(PORT, '127.0.0.1', () => {
  console.log('🚀 Nova Check EHR Enhanced Backend running!');
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Server URL: http://localhost:${PORT}`);
  console.log(`💚 Health Check: http://localhost:${PORT}/health`);
  console.log(`📊 API Status: http://localhost:${PORT}/api/v1/status`);
  console.log('\n📋 Available API Endpoints:');
  console.log('  GET    /                           - API Information');
  console.log('  GET    /health                     - Health Check');
  console.log('  GET    /api/v1/status              - API Status');
  console.log('  GET    /api/v1/patients            - List patients');
  console.log('  POST   /api/v1/patients            - Create patient');
  console.log('  GET    /api/v1/patients/:id        - Get patient');
  console.log('  PUT    /api/v1/patients/:id        - Update patient');
  console.log('  DELETE /api/v1/patients/:id        - Delete patient');
  console.log('  GET    /api/v1/appointments         - List appointments');
  console.log('  POST   /api/v1/appointments         - Create appointment');
  console.log('  GET    /api/v1/medical-records      - List medical records');
  console.log('  POST   /api/v1/medical-records      - Create medical record');
  console.log('  GET    /api/v1/dashboard/stats      - Dashboard statistics');
  console.log('\n📊 Current Data:');
  console.log(`  Patients: ${patients.length}`);
  console.log(`  Appointments: ${appointments.length}`);
  console.log(`  Medical Records: ${medicalRecords.length}`);
  console.log('\n✅ Server is ready to accept connections');
});

server.on('error', (err) => {
  console.error('❌ Server error:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please try a different port.`);
  }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Error handling
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = server;