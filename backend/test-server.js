/**
 * Simple test server to verify basic setup
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Basic middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Nova Check EHR Backend is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});

// Basic API info endpoint
app.get('/api/v1/info', (req, res) => {
  res.json({
    name: 'Nova Check EHR API',
    version: '1.0.0',
    description: 'Healthcare EHR System with AI Integration',
    endpoints: {
      health: '/health',
      info: '/api/v1/info'
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🏥 Nova Check EHR Test Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📋 API info: http://localhost:${PORT}/api/v1/info`);
});

module.exports = app;