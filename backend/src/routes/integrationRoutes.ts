import { Router } from 'express';
import { Request, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { logger } from '../utils/logger';
import { rateLimiter, authorize } from '../middleware/auth';
import { ehrIntegrationService } from '../services/ehrIntegrationService';
import { llmIntegrationService } from '../services/llmIntegrationService';
import { aiService } from '../services/aiService';

const router = Router();

// Get all available integrations
router.get('/',
  rateLimiter.standard,
  async (req: Request, res: Response) => {
    try {
      const integrations = {
        ehr: {
          epic: {
            name: 'Epic',
            status: process.env.EPIC_CLIENT_ID ? 'configured' : 'not_configured',
            features: ['patient_data', 'appointments', 'clinical_notes']
          },
          cerner: {
            name: 'Cerner',
            status: process.env.CERNER_CLIENT_ID ? 'configured' : 'not_configured',
            features: ['patient_data', 'appointments', 'medications']
          },
          allscripts: {
            name: 'Allscripts',
            status: process.env.ALLSCRIPTS_CLIENT_ID ? 'configured' : 'not_configured',
            features: ['patient_data', 'clinical_data']
          },
          athenahealth: {
            name: 'athenahealth',
            status: process.env.ATHENAHEALTH_CLIENT_ID ? 'configured' : 'not_configured',
            features: ['patient_data', 'appointments', 'billing']
          },
          fhir: {
            name: 'FHIR Server',
            status: process.env.FHIR_SERVER_URL ? 'configured' : 'not_configured',
            features: ['standardized_data', 'interoperability']
          }
        },
        ai: {
          openai: {
            name: 'OpenAI',
            status: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
            models: ['gpt-4', 'gpt-3.5-turbo']
          },
          deepseek: {
            name: 'DeepSeek',
            status: process.env.DEEPSEEK_API_KEY ? 'configured' : 'not_configured',
            models: ['deepseek-chat', 'deepseek-coder']
          },
          anthropic: {
            name: 'Anthropic Claude',
            status: process.env.ANTHROPIC_API_KEY ? 'configured' : 'not_configured',
            models: ['claude-3-opus', 'claude-3-sonnet']
          },
          google: {
            name: 'Google Gemini',
            status: process.env.GOOGLE_AI_API_KEY ? 'configured' : 'not_configured',
            models: ['gemini-pro', 'gemini-pro-vision']
          },
          azure: {
            name: 'Azure OpenAI',
            status: process.env.AZURE_OPENAI_API_KEY ? 'configured' : 'not_configured',
            models: ['gpt-4', 'gpt-35-turbo']
          },
          mistral: {
            name: 'Mistral AI',
            status: process.env.MISTRAL_API_KEY ? 'configured' : 'not_configured',
            models: ['mistral-large', 'mistral-medium']
          },
          cohere: {
            name: 'Cohere',
            status: process.env.COHERE_API_KEY ? 'configured' : 'not_configured',
            models: ['command', 'command-light']
          },
          huggingface: {
            name: 'Hugging Face',
            status: process.env.HUGGINGFACE_API_KEY ? 'configured' : 'not_configured',
            models: ['custom_models']
          }
        },
        communication: {
          twilio: {
            name: 'Twilio',
            status: process.env.TWILIO_ACCOUNT_SID ? 'configured' : 'not_configured',
            features: ['sms', 'voice', 'video']
          },
          sendgrid: {
            name: 'SendGrid',
            status: process.env.SENDGRID_API_KEY ? 'configured' : 'not_configured',
            features: ['email', 'templates']
          },
          slack: {
            name: 'Slack',
            status: process.env.SLACK_BOT_TOKEN ? 'configured' : 'not_configured',
            features: ['notifications', 'alerts']
          }
        },
        payment: {
          stripe: {
            name: 'Stripe',
            status: process.env.STRIPE_SECRET_KEY ? 'configured' : 'not_configured',
            features: ['payments', 'subscriptions', 'invoicing']
          },
          square: {
            name: 'Square',
            status: process.env.SQUARE_ACCESS_TOKEN ? 'configured' : 'not_configured',
            features: ['payments', 'pos']
          }
        },
        storage: {
          aws_s3: {
            name: 'AWS S3',
            status: process.env.AWS_ACCESS_KEY_ID ? 'configured' : 'not_configured',
            features: ['file_storage', 'backup']
          },
          google_cloud: {
            name: 'Google Cloud Storage',
            status: process.env.GOOGLE_CLOUD_PROJECT_ID ? 'configured' : 'not_configured',
            features: ['file_storage', 'ai_services']
          },
          minio: {
            name: 'MinIO',
            status: process.env.MINIO_ENDPOINT ? 'configured' : 'not_configured',
            features: ['local_storage', 'backup']
          }
        },
        monitoring: {
          sentry: {
            name: 'Sentry',
            status: process.env.SENTRY_DSN ? 'configured' : 'not_configured',
            features: ['error_tracking', 'performance']
          },
          datadog: {
            name: 'DataDog',
            status: process.env.DATADOG_API_KEY ? 'configured' : 'not_configured',
            features: ['monitoring', 'logging', 'apm']
          },
          newrelic: {
            name: 'New Relic',
            status: process.env.NEW_RELIC_LICENSE_KEY ? 'configured' : 'not_configured',
            features: ['apm', 'infrastructure']
          }
        }
      };

      res.json(integrations);
    } catch (error) {
      logger.error('Integration list error:', error);
      res.status(500).json({ error: 'Failed to fetch integrations' });
    }
  }
);

// Test EHR integration
router.post('/ehr/:provider/test',
  rateLimiter.standard,
  authorize(['ADMIN']),
  async (req: Request, res: Response) => {
    try {
      const { provider } = req.params;
      
      if (!['epic', 'cerner', 'allscripts', 'athenahealth', 'fhir'].includes(provider)) {
        return res.status(400).json({ error: 'Invalid EHR provider' });
      }

      const testResult = await ehrIntegrationService.testConnection(provider);
      
      res.json({
        provider,
        status: testResult.success ? 'connected' : 'failed',
        message: testResult.message,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('EHR integration test error:', error);
      res.status(500).json({ error: 'Failed to test EHR integration' });
    }
  }
);

// Test AI provider
router.post('/ai/:provider/test',
  rateLimiter.standard,
  authorize(['ADMIN']),
  async (req: Request, res: Response) => {
    try {
      const { provider } = req.params;
      
      const availableProviders = llmIntegrationService.getAvailableProviders();
      const providerExists = availableProviders.some(p => p.name.toLowerCase() === provider.toLowerCase());
      
      if (!providerExists) {
        return res.status(400).json({ error: 'Invalid AI provider' });
      }

      const testMessage = 'Hello, this is a test message to verify the AI integration.';
      const response = await llmIntegrationService.generateResponse([
        { role: 'user', content: testMessage }
      ], { provider: provider.toLowerCase() });
      
      res.json({
        provider,
        status: 'connected',
        testMessage,
        response: response.content,
        model: response.model,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('AI provider test error:', error);
      res.status(500).json({ 
        provider: req.params.provider,
        status: 'failed',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// Get integration health status
router.get('/health',
  rateLimiter.standard,
  async (req: Request, res: Response) => {
    try {
      const [ehrHealth, aiHealth] = await Promise.all([
        ehrIntegrationService.getHealthStatus(),
        llmIntegrationService.healthCheck()
      ]);

      const overallHealth = {
        ehr: ehrHealth,
        ai: aiHealth,
        timestamp: new Date().toISOString(),
        overall: Object.values(ehrHealth).every(Boolean) && Object.values(aiHealth).every(Boolean) ? 'healthy' : 'degraded'
      };

      res.json(overallHealth);
    } catch (error) {
      logger.error('Integration health check error:', error);
      res.status(500).json({ error: 'Failed to check integration health' });
    }
  }
);

// Configure integration
router.post('/configure',
  rateLimiter.standard,
  authorize(['ADMIN']),
  [
    body('type').isIn(['ehr', 'ai', 'communication', 'payment', 'storage', 'monitoring']),
    body('provider').isString().notEmpty(),
    body('config').isObject()
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { type, provider, config } = req.body;
      
      // In a real implementation, this would update environment variables or database configuration
      logger.info('Integration configuration updated', { type, provider, userId: req.user?.id });
      
      res.json({
        message: 'Integration configured successfully',
        type,
        provider,
        status: 'configured',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Integration configuration error:', error);
      res.status(500).json({ error: 'Failed to configure integration' });
    }
  }
);

// Get integration logs
router.get('/logs',
  rateLimiter.standard,
  authorize(['ADMIN']),
  [
    query('type').optional().isIn(['ehr', 'ai', 'communication', 'payment', 'storage', 'monitoring']),
    query('provider').optional().isString(),
    query('level').optional().isIn(['error', 'warn', 'info', 'debug']),
    query('limit').optional().isInt({ min: 1, max: 1000 }),
    query('offset').optional().isInt({ min: 0 })
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { type, provider, level = 'info', limit = 100, offset = 0 } = req.query;
      
      // Mock integration logs - in real implementation, fetch from logging service
      const mockLogs = [
        {
          id: '1',
          timestamp: new Date().toISOString(),
          type: 'ai',
          provider: 'openai',
          level: 'info',
          message: 'AI request processed successfully',
          metadata: { requestId: 'req_123', responseTime: 1200 }
        },
        {
          id: '2',
          timestamp: new Date(Date.now() - 60000).toISOString(),
          type: 'ehr',
          provider: 'epic',
          level: 'info',
          message: 'Patient data synchronized',
          metadata: { patientId: 'pat_456', recordCount: 5 }
        },
        {
          id: '3',
          timestamp: new Date(Date.now() - 120000).toISOString(),
          type: 'ai',
          provider: 'deepseek',
          level: 'error',
          message: 'API rate limit exceeded',
          metadata: { retryAfter: 60 }
        }
      ];

      // Filter logs based on query parameters
      let filteredLogs = mockLogs;
      if (type) filteredLogs = filteredLogs.filter(log => log.type === type);
      if (provider) filteredLogs = filteredLogs.filter(log => log.provider === provider);
      if (level) filteredLogs = filteredLogs.filter(log => log.level === level);
      
      const paginatedLogs = filteredLogs.slice(Number(offset), Number(offset) + Number(limit));

      res.json({
        logs: paginatedLogs,
        total: filteredLogs.length,
        limit: Number(limit),
        offset: Number(offset)
      });
    } catch (error) {
      logger.error('Integration logs error:', error);
      res.status(500).json({ error: 'Failed to fetch integration logs' });
    }
  }
);

// Get integration metrics
router.get('/metrics',
  rateLimiter.standard,
  [
    query('type').optional().isIn(['ehr', 'ai', 'communication', 'payment', 'storage', 'monitoring']),
    query('timeframe').optional().isIn(['1h', '24h', '7d', '30d'])
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { type, timeframe = '24h' } = req.query;
      
      // Mock metrics - in real implementation, fetch from monitoring service
      const metrics = {
        ai: {
          totalRequests: 1250,
          successRate: 98.5,
          averageResponseTime: 1200,
          errorRate: 1.5,
          requestsByProvider: {
            openai: 450,
            deepseek: 380,
            anthropic: 220,
            google: 200
          }
        },
        ehr: {
          totalSyncs: 85,
          successRate: 96.5,
          averageSyncTime: 5000,
          errorRate: 3.5,
          syncsByProvider: {
            epic: 35,
            cerner: 25,
            fhir: 25
          }
        },
        communication: {
          emailsSent: 450,
          smsSent: 120,
          deliveryRate: 99.2
        },
        storage: {
          filesUploaded: 75,
          totalStorage: '2.5GB',
          uploadSuccessRate: 99.8
        }
      };

      const result = type ? { [type]: metrics[type as keyof typeof metrics] } : metrics;
      
      res.json({
        metrics: result,
        timeframe,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Integration metrics error:', error);
      res.status(500).json({ error: 'Failed to fetch integration metrics' });
    }
  }
);

// Sync all integrations
router.post('/sync',
  rateLimiter.standard,
  authorize(['ADMIN']),
  async (req: Request, res: Response) => {
    try {
      const syncResults = {
        ehr: await ehrIntegrationService.syncAll(),
        ai: await llmIntegrationService.refreshProviders(),
        timestamp: new Date().toISOString()
      };

      res.json({
        message: 'Integration sync completed',
        results: syncResults
      });
    } catch (error) {
      logger.error('Integration sync error:', error);
      res.status(500).json({ error: 'Failed to sync integrations' });
    }
  }
);

export default router;