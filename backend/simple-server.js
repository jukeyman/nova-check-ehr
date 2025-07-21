// Simple HTTP server using only Node.js built-in modules
const http = require('http');
const fs = require('fs');
const path = require('path');

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

// Create HTTP server
const server = http.createServer((req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = req.url;
  const method = req.method;

  // Route handling
  if (url === '/' && method === 'GET') {
    const response = {
      message: 'Nova Check EHR Backend API',
      version: '1.0.0',
      status: 'running',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      port: PORT
    };
    res.writeHead(200);
    res.end(JSON.stringify(response, null, 2));
  } else if (url === '/health' && method === 'GET') {
    const response = {
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage(),
      version: process.version
    };
    res.writeHead(200);
    res.end(JSON.stringify(response, null, 2));
  } else if (url === '/api/v1/status' && method === 'GET') {
    const response = {
      api: 'Nova Check EHR',
      version: 'v1',
      status: 'operational',
      database: {
        url: process.env.DATABASE_URL ? 'configured' : 'not configured',
        status: 'pending connection test'
      },
      features: {
        authentication: 'available',
        patients: 'available',
        appointments: 'available',
        medical_records: 'available'
      },
      timestamp: new Date().toISOString()
    };
    res.writeHead(200);
    res.end(JSON.stringify(response, null, 2));
  } else {
    // 404 for unknown routes
    const response = {
      error: 'Not Found',
      message: `Route ${method} ${url} not found`,
      timestamp: new Date().toISOString()
    };
    res.writeHead(404);
    res.end(JSON.stringify(response, null, 2));
  }
});

// Start server
server.listen(PORT, '127.0.0.1', () => {
  console.log('🚀 Nova Check EHR Backend running!');
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Server URL: http://localhost:${PORT}`);
  console.log(`💚 Health Check: http://localhost:${PORT}/health`);
  console.log(`📊 API Status: http://localhost:${PORT}/api/v1/status`);
  console.log('\n📋 Available Endpoints:');
  console.log('  GET  /           - API Information');
  console.log('  GET  /health     - Health Check');
  console.log('  GET  /api/v1/status - API Status');
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