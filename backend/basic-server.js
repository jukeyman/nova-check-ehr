#!/usr/bin/env node

// Basic HTTP server with enhanced stability
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Prevent duplicate execution
if (process.env.SERVER_RUNNING) {
  console.log('Server already running, exiting...');
  process.exit(0);
}
process.env.SERVER_RUNNING = 'true';

console.log('🔧 Initializing Nova Check EHR Backend...');
console.log(`📊 Node.js version: ${process.version}`);
console.log(`💻 Platform: ${os.platform()} ${os.arch()}`);
console.log(`📁 Working directory: ${process.cwd()}`);

// Load environment variables manually from .env file
const envPath = path.join(__dirname, '.env');
console.log(`🔍 Looking for .env file at: ${envPath}`);

if (fs.existsSync(envPath)) {
  console.log('✅ Found .env file, loading variables...');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const envLines = envContent.split('\n');
  let loadedVars = 0;
  
  envLines.forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, '');
        process.env[key] = value;
        loadedVars++;
      }
    }
  });
  console.log(`📝 Loaded ${loadedVars} environment variables`);
} else {
  console.log('⚠️  No .env file found, using default values');
}

const PORT = process.env.PORT || 3001;
const HOST = '127.0.0.1';

console.log(`🌐 Server will bind to ${HOST}:${PORT}`);

// Create HTTP server with enhanced request handling
const server = http.createServer((req, res) => {
  const startTime = Date.now();
  
  // Enhanced logging
  console.log(`📥 ${new Date().toISOString()} - ${req.method} ${req.url} from ${req.connection.remoteAddress}`);
  
  // Set comprehensive headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Powered-By', 'Nova Check EHR');
  res.setHeader('X-Response-Time', `${Date.now() - startTime}ms`);

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    console.log(`📤 ${new Date().toISOString()} - OPTIONS ${req.url} - 200 (${Date.now() - startTime}ms)`);
    return;
  }

  const url = req.url;
  const method = req.method;
  let response;
  let statusCode = 200;

  try {
    // Route handling with enhanced responses
    if (url === '/' && method === 'GET') {
      response = {
        message: 'Nova Check EHR Backend API',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        port: PORT,
        host: HOST,
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        endpoints: [
          'GET /',
          'GET /health',
          'GET /api/v1/status',
          'GET /api/v1/info'
        ]
      };
    } else if (url === '/health' && method === 'GET') {
      response = {
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage(),
        version: process.version,
        loadAverage: os.loadavg(),
        freeMemory: os.freemem(),
        totalMemory: os.totalmem(),
        cpus: os.cpus().length
      };
    } else if (url === '/api/v1/status' && method === 'GET') {
      response = {
        api: 'Nova Check EHR',
        version: 'v1',
        status: 'operational',
        timestamp: new Date().toISOString(),
        database: {
          url: process.env.DATABASE_URL ? 'configured' : 'not configured',
          status: 'pending connection test'
        },
        redis: {
          url: process.env.REDIS_URL ? 'configured' : 'not configured',
          status: 'pending connection test'
        },
        features: {
          authentication: 'available',
          patients: 'available',
          appointments: 'available',
          medical_records: 'available',
          billing: 'available',
          reports: 'available'
        },
        environment: {
          nodeEnv: process.env.NODE_ENV || 'development',
          port: PORT,
          jwtSecret: process.env.JWT_SECRET ? 'configured' : 'not configured',
          encryptionKey: process.env.ENCRYPTION_KEY ? 'configured' : 'not configured'
        }
      };
    } else if (url === '/api/v1/info' && method === 'GET') {
      response = {
        application: 'Nova Check EHR',
        description: 'Electronic Health Records Management System',
        version: '1.0.0',
        author: 'Nova Check Team',
        license: 'MIT',
        repository: 'https://github.com/nova-check/ehr',
        documentation: 'https://docs.nova-check.com',
        support: 'support@nova-check.com',
        timestamp: new Date().toISOString()
      };
    } else {
      // 404 for unknown routes
      statusCode = 404;
      response = {
        error: 'Not Found',
        message: `Route ${method} ${url} not found`,
        timestamp: new Date().toISOString(),
        availableEndpoints: [
          'GET /',
          'GET /health',
          'GET /api/v1/status',
          'GET /api/v1/info'
        ]
      };
    }

    res.writeHead(statusCode);
    res.end(JSON.stringify(response, null, 2));
    
    console.log(`📤 ${new Date().toISOString()} - ${method} ${url} - ${statusCode} (${Date.now() - startTime}ms)`);
    
  } catch (error) {
    console.error(`❌ Error handling request ${method} ${url}:`, error);
    res.writeHead(500);
    res.end(JSON.stringify({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      timestamp: new Date().toISOString()
    }, null, 2));
  }
});

// Enhanced error handling
server.on('error', (err) => {
  console.error('❌ Server error:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Trying port ${PORT + 1}...`);
    server.listen(PORT + 1, HOST);
  } else if (err.code === 'EACCES') {
    console.error(`❌ Permission denied for port ${PORT}. Try using a port > 1024`);
    process.exit(1);
  } else {
    console.error('❌ Unexpected server error:', err.message);
    process.exit(1);
  }
});

server.on('listening', () => {
  const address = server.address();
  console.log('\n🚀 Nova Check EHR Backend successfully started!');
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Server URL: http://${address.address}:${address.port}`);
  console.log(`💚 Health Check: http://${address.address}:${address.port}/health`);
  console.log(`📊 API Status: http://${address.address}:${address.port}/api/v1/status`);
  console.log(`ℹ️  API Info: http://${address.address}:${address.port}/api/v1/info`);
  console.log('\n📋 Available Endpoints:');
  console.log('  GET  /               - API Information');
  console.log('  GET  /health         - Health Check');
  console.log('  GET  /api/v1/status  - API Status');
  console.log('  GET  /api/v1/info    - API Information');
  console.log('\n✅ Server is ready to accept connections');
  console.log('\n🔄 Server will continue running until manually stopped (Ctrl+C)');
});

server.on('connection', (socket) => {
  console.log(`🔌 New connection from ${socket.remoteAddress}:${socket.remotePort}`);
});

// Start server
console.log(`🚀 Starting server on ${HOST}:${PORT}...`);
server.listen(PORT, HOST);

// Graceful shutdown handlers
process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed successfully');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT received (Ctrl+C), shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed successfully');
    process.exit(0);
  });
});

// Enhanced error handling
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  console.error('Stack trace:', err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

// Keep process alive
setInterval(() => {
  // Heartbeat to keep process alive
}, 30000);

console.log('🔄 Server initialization complete, waiting for startup...');