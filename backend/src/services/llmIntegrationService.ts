import { OpenAI } from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { logger } from '../config/logger';
import { cache } from '../config/redis';

// Types and interfaces
export interface LLMProvider {
  name: string;
  type: 'openai' | 'anthropic' | 'google' | 'deepseek' | 'mistral' | 'cohere' | 'azure' | 'huggingface';
  enabled: boolean;
  priority: number;
  capabilities: string[];
  models: string[];
  rateLimits: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  metadata?: {
    timestamp?: Date;
    userId?: string;
    sessionId?: string;
    context?: string;
  };
}

export interface LLMResponse {
  content: string;
  provider: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  metadata?: {
    responseTime: number;
    confidence?: number;
    reasoning?: string;
  };
}

export interface LLMConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  systemPrompt?: string;
  context?: string;
}

export interface MedicalContext {
  patientId?: string;
  providerId?: string;
  specialty?: string;
  urgency?: 'low' | 'medium' | 'high' | 'critical';
  clinicalData?: {
    symptoms?: string[];
    vitals?: Record<string, any>;
    medications?: string[];
    allergies?: string[];
    medicalHistory?: string[];
  };
}

// Provider configurations
const PROVIDERS: Record<string, LLMProvider> = {
  openai: {
    name: 'OpenAI',
    type: 'openai',
    enabled: !!process.env.OPENAI_API_KEY,
    priority: 1,
    capabilities: ['chat', 'completion', 'medical', 'coding', 'analysis'],
    models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    rateLimits: {
      requestsPerMinute: 60,
      tokensPerMinute: 150000
    }
  },
  deepseek: {
    name: 'DeepSeek',
    type: 'deepseek',
    enabled: !!process.env.DEEPSEEK_API_KEY,
    priority: 2,
    capabilities: ['chat', 'completion', 'coding', 'reasoning'],
    models: ['deepseek-chat', 'deepseek-coder'],
    rateLimits: {
      requestsPerMinute: 100,
      tokensPerMinute: 200000
    }
  },
  anthropic: {
    name: 'Anthropic Claude',
    type: 'anthropic',
    enabled: !!process.env.ANTHROPIC_API_KEY,
    priority: 3,
    capabilities: ['chat', 'completion', 'medical', 'analysis', 'reasoning'],
    models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
    rateLimits: {
      requestsPerMinute: 50,
      tokensPerMinute: 100000
    }
  },
  google: {
    name: 'Google Gemini',
    type: 'google',
    enabled: !!process.env.GOOGLE_AI_API_KEY,
    priority: 4,
    capabilities: ['chat', 'completion', 'multimodal', 'analysis'],
    models: ['gemini-pro', 'gemini-pro-vision'],
    rateLimits: {
      requestsPerMinute: 60,
      tokensPerMinute: 120000
    }
  },
  azure: {
    name: 'Azure OpenAI',
    type: 'azure',
    enabled: !!process.env.AZURE_OPENAI_API_KEY,
    priority: 5,
    capabilities: ['chat', 'completion', 'medical', 'enterprise'],
    models: ['gpt-4', 'gpt-35-turbo'],
    rateLimits: {
      requestsPerMinute: 120,
      tokensPerMinute: 300000
    }
  },
  mistral: {
    name: 'Mistral AI',
    type: 'mistral',
    enabled: !!process.env.MISTRAL_API_KEY,
    priority: 6,
    capabilities: ['chat', 'completion', 'multilingual'],
    models: ['mistral-large', 'mistral-medium', 'mistral-small'],
    rateLimits: {
      requestsPerMinute: 60,
      tokensPerMinute: 100000
    }
  },
  cohere: {
    name: 'Cohere',
    type: 'cohere',
    enabled: !!process.env.COHERE_API_KEY,
    priority: 7,
    capabilities: ['chat', 'completion', 'embedding', 'classification'],
    models: ['command', 'command-light'],
    rateLimits: {
      requestsPerMinute: 100,
      tokensPerMinute: 150000
    }
  },
  huggingface: {
    name: 'Hugging Face',
    type: 'huggingface',
    enabled: !!process.env.HUGGINGFACE_API_KEY,
    priority: 8,
    capabilities: ['chat', 'completion', 'specialized'],
    models: ['meta-llama/Llama-2-70b-chat-hf', 'microsoft/DialoGPT-large'],
    rateLimits: {
      requestsPerMinute: 30,
      tokensPerMinute: 50000
    }
  }
};

// Medical-specific prompts and contexts
const MEDICAL_SYSTEM_PROMPTS = {
  diagnosis: `You are an expert medical AI assistant specializing in clinical diagnosis. 
Provide evidence-based diagnostic suggestions based on patient symptoms, vital signs, and medical history. 
Always include differential diagnoses and recommend appropriate diagnostic tests. 
Emphasize the importance of clinical correlation and professional medical judgment.`,
  
  treatment: `You are an expert medical AI assistant specializing in treatment planning. 
Provide evidence-based treatment recommendations following current clinical guidelines. 
Consider patient-specific factors including allergies, comorbidities, and contraindications. 
Always emphasize the need for healthcare provider oversight and patient monitoring.`,
  
  medication: `You are an expert clinical pharmacist AI assistant. 
Provide medication information including dosing, interactions, contraindications, and monitoring parameters. 
Check for drug-drug interactions and allergies. 
Emphasize the importance of prescriber verification and patient counseling.`,
  
  emergency: `You are an expert emergency medicine AI assistant. 
Provide rapid, evidence-based guidance for urgent medical situations. 
Prioritize life-threatening conditions and time-sensitive interventions. 
Always emphasize the critical importance of immediate professional medical care.`,
  
  general: `You are a knowledgeable medical AI assistant integrated into an Electronic Health Record system. 
Provide accurate, evidence-based medical information while emphasizing that all recommendations 
must be verified by qualified healthcare professionals. Patient safety is the highest priority.`
};

class LLMIntegrationService {
  private openaiClient?: OpenAI;
  private anthropicClient?: Anthropic;
  private googleClient?: GoogleGenerativeAI;
  private rateLimitTracker: Map<string, { count: number; resetTime: number }> = new Map();

  constructor() {
    this.initializeClients();
  }

  private initializeClients(): void {
    try {
      // Initialize OpenAI
      if (process.env.OPENAI_API_KEY) {
        this.openaiClient = new OpenAI({
          apiKey: process.env.OPENAI_API_KEY,
          organization: process.env.OPENAI_ORG_ID,
        });
      }

      // Initialize Anthropic
      if (process.env.ANTHROPIC_API_KEY) {
        this.anthropicClient = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });
      }

      // Initialize Google
      if (process.env.GOOGLE_AI_API_KEY) {
        this.googleClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
      }

      logger.info('LLM clients initialized successfully', {
        providers: Object.keys(PROVIDERS).filter(key => PROVIDERS[key].enabled)
      });
    } catch (error) {
      logger.error('Failed to initialize LLM clients', { error });
    }
  }

  // Rate limiting check
  private checkRateLimit(provider: string): boolean {
    const now = Date.now();
    const key = `rateLimit:${provider}`;
    const limit = this.rateLimitTracker.get(key);
    const providerConfig = PROVIDERS[provider];

    if (!limit || now > limit.resetTime) {
      this.rateLimitTracker.set(key, {
        count: 1,
        resetTime: now + 60000 // 1 minute
      });
      return true;
    }

    if (limit.count >= providerConfig.rateLimits.requestsPerMinute) {
      return false;
    }

    limit.count++;
    return true;
  }

  // Get available providers based on capability
  public getAvailableProviders(capability?: string): LLMProvider[] {
    return Object.values(PROVIDERS)
      .filter(provider => {
        if (!provider.enabled) return false;
        if (capability && !provider.capabilities.includes(capability)) return false;
        return this.checkRateLimit(provider.name.toLowerCase());
      })
      .sort((a, b) => a.priority - b.priority);
  }

  // Select best provider for request
  private selectProvider(config: LLMConfig, capability?: string): LLMProvider | null {
    // If specific provider requested, try to use it
    if (config.provider && PROVIDERS[config.provider]?.enabled) {
      const provider = PROVIDERS[config.provider];
      if (this.checkRateLimit(config.provider)) {
        return provider;
      }
    }

    // Otherwise, select best available provider
    const availableProviders = this.getAvailableProviders(capability);
    return availableProviders.length > 0 ? availableProviders[0] : null;
  }

  // Generate response using OpenAI
  private async generateOpenAIResponse(
    messages: LLMMessage[],
    config: LLMConfig
  ): Promise<LLMResponse> {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    const startTime = Date.now();
    
    const response = await this.openaiClient.chat.completions.create({
      model: config.model || 'gpt-4',
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      temperature: config.temperature || 0.7,
      max_tokens: config.maxTokens || 2000,
      top_p: config.topP || 1,
      frequency_penalty: config.frequencyPenalty || 0,
      presence_penalty: config.presencePenalty || 0,
    });

    const endTime = Date.now();

    return {
      content: response.choices[0]?.message?.content || '',
      provider: 'openai',
      model: config.model || 'gpt-4',
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      metadata: {
        responseTime: endTime - startTime,
      }
    };
  }

  // Generate response using DeepSeek
  private async generateDeepSeekResponse(
    messages: LLMMessage[],
    config: LLMConfig
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    
    const response = await axios.post(
      process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
      {
        model: config.model || 'deepseek-chat',
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 2000,
        stream: false,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const endTime = Date.now();

    return {
      content: response.data.choices[0]?.message?.content || '',
      provider: 'deepseek',
      model: config.model || 'deepseek-chat',
      usage: {
        promptTokens: response.data.usage?.prompt_tokens || 0,
        completionTokens: response.data.usage?.completion_tokens || 0,
        totalTokens: response.data.usage?.total_tokens || 0,
      },
      metadata: {
        responseTime: endTime - startTime,
      }
    };
  }

  // Generate response using Anthropic
  private async generateAnthropicResponse(
    messages: LLMMessage[],
    config: LLMConfig
  ): Promise<LLMResponse> {
    if (!this.anthropicClient) {
      throw new Error('Anthropic client not initialized');
    }

    const startTime = Date.now();
    
    // Convert messages to Anthropic format
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');
    
    const response = await this.anthropicClient.messages.create({
      model: config.model || 'claude-3-sonnet-20240229',
      max_tokens: config.maxTokens || 2000,
      temperature: config.temperature || 0.7,
      system: systemMessage?.content || '',
      messages: conversationMessages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      })),
    });

    const endTime = Date.now();

    return {
      content: response.content[0]?.type === 'text' ? response.content[0].text : '',
      provider: 'anthropic',
      model: config.model || 'claude-3-sonnet-20240229',
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      metadata: {
        responseTime: endTime - startTime,
      }
    };
  }

  // Generate response using Google Gemini
  private async generateGoogleResponse(
    messages: LLMMessage[],
    config: LLMConfig
  ): Promise<LLMResponse> {
    if (!this.googleClient) {
      throw new Error('Google client not initialized');
    }

    const startTime = Date.now();
    
    const model = this.googleClient.getGenerativeModel({
      model: config.model || 'gemini-pro',
    });

    // Convert messages to Google format
    const prompt = messages.map(msg => `${msg.role}: ${msg.content}`).join('\n\n');
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    const endTime = Date.now();

    return {
      content: response.text(),
      provider: 'google',
      model: config.model || 'gemini-pro',
      usage: {
        promptTokens: 0, // Google doesn't provide token usage in free tier
        completionTokens: 0,
        totalTokens: 0,
      },
      metadata: {
        responseTime: endTime - startTime,
      }
    };
  }

  // Generate response using Azure OpenAI
  private async generateAzureResponse(
    messages: LLMMessage[],
    config: LLMConfig
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    
    const response = await axios.post(
      `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${config.model || process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=${process.env.AZURE_OPENAI_API_VERSION}`,
      {
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 2000,
      },
      {
        headers: {
          'api-key': process.env.AZURE_OPENAI_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    const endTime = Date.now();

    return {
      content: response.data.choices[0]?.message?.content || '',
      provider: 'azure',
      model: config.model || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4',
      usage: {
        promptTokens: response.data.usage?.prompt_tokens || 0,
        completionTokens: response.data.usage?.completion_tokens || 0,
        totalTokens: response.data.usage?.total_tokens || 0,
      },
      metadata: {
        responseTime: endTime - startTime,
      }
    };
  }

  // Generate response using Mistral
  private async generateMistralResponse(
    messages: LLMMessage[],
    config: LLMConfig
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: config.model || 'mistral-large-latest',
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 2000,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const endTime = Date.now();

    return {
      content: response.data.choices[0]?.message?.content || '',
      provider: 'mistral',
      model: config.model || 'mistral-large-latest',
      usage: {
        promptTokens: response.data.usage?.prompt_tokens || 0,
        completionTokens: response.data.usage?.completion_tokens || 0,
        totalTokens: response.data.usage?.total_tokens || 0,
      },
      metadata: {
        responseTime: endTime - startTime,
      }
    };
  }

  // Generate response using Cohere
  private async generateCohereResponse(
    messages: LLMMessage[],
    config: LLMConfig
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    
    // Convert messages to Cohere format
    const prompt = messages.map(msg => `${msg.role}: ${msg.content}`).join('\n\n');
    
    const response = await axios.post(
      'https://api.cohere.ai/v1/generate',
      {
        model: config.model || 'command',
        prompt: prompt,
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 2000,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const endTime = Date.now();

    return {
      content: response.data.generations[0]?.text || '',
      provider: 'cohere',
      model: config.model || 'command',
      usage: {
        promptTokens: 0, // Cohere doesn't provide detailed token usage
        completionTokens: 0,
        totalTokens: 0,
      },
      metadata: {
        responseTime: endTime - startTime,
      }
    };
  }

  // Main method to generate response
  public async generateResponse(
    messages: LLMMessage[],
    config: LLMConfig,
    medicalContext?: MedicalContext
  ): Promise<LLMResponse> {
    try {
      // Add medical system prompt if medical context provided
      if (medicalContext) {
        const systemPrompt = this.buildMedicalSystemPrompt(medicalContext);
        messages = [
          { role: 'system', content: systemPrompt },
          ...messages.filter(m => m.role !== 'system')
        ];
      }

      // Select appropriate provider
      const provider = this.selectProvider(config, medicalContext ? 'medical' : undefined);
      if (!provider) {
        throw new Error('No available LLM providers');
      }

      // Generate response based on provider
      let response: LLMResponse;
      
      switch (provider.type) {
        case 'openai':
          response = await this.generateOpenAIResponse(messages, config);
          break;
        case 'deepseek':
          response = await this.generateDeepSeekResponse(messages, config);
          break;
        case 'anthropic':
          response = await this.generateAnthropicResponse(messages, config);
          break;
        case 'google':
          response = await this.generateGoogleResponse(messages, config);
          break;
        case 'azure':
          response = await this.generateAzureResponse(messages, config);
          break;
        case 'mistral':
          response = await this.generateMistralResponse(messages, config);
          break;
        case 'cohere':
          response = await this.generateCohereResponse(messages, config);
          break;
        default:
          throw new Error(`Unsupported provider: ${provider.type}`);
      }

      // Cache response for potential reuse
      if (medicalContext?.patientId) {
        const cacheKey = `llm:response:${medicalContext.patientId}:${Date.now()}`;
        await cache.set(cacheKey, response, 3600); // Cache for 1 hour
      }

      // Log usage for monitoring
      logger.info('LLM response generated', {
        provider: response.provider,
        model: response.model,
        usage: response.usage,
        responseTime: response.metadata?.responseTime,
        patientId: medicalContext?.patientId
      });

      return response;
    } catch (error) {
      logger.error('Failed to generate LLM response', {
        error: error.message,
        provider: config.provider,
        model: config.model,
        medicalContext
      });
      throw error;
    }
  }

  // Build medical system prompt based on context
  private buildMedicalSystemPrompt(context: MedicalContext): string {
    let prompt = MEDICAL_SYSTEM_PROMPTS.general;

    if (context.urgency === 'critical') {
      prompt = MEDICAL_SYSTEM_PROMPTS.emergency;
    } else if (context.specialty) {
      // Add specialty-specific context
      prompt += `\n\nSpecialty Focus: ${context.specialty}`;
    }

    if (context.clinicalData) {
      prompt += '\n\nClinical Context:';
      if (context.clinicalData.symptoms?.length) {
        prompt += `\nSymptoms: ${context.clinicalData.symptoms.join(', ')}`;
      }
      if (context.clinicalData.medications?.length) {
        prompt += `\nCurrent Medications: ${context.clinicalData.medications.join(', ')}`;
      }
      if (context.clinicalData.allergies?.length) {
        prompt += `\nAllergies: ${context.clinicalData.allergies.join(', ')}`;
      }
    }

    prompt += '\n\nIMPORTANT: All recommendations must be verified by qualified healthcare professionals. This is an AI assistant and not a replacement for professional medical judgment.';

    return prompt;
  }

  // Medical-specific methods
  public async generateDiagnosis(
    symptoms: string[],
    vitals: Record<string, any>,
    medicalHistory: string[],
    config: Partial<LLMConfig> = {}
  ): Promise<LLMResponse> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: MEDICAL_SYSTEM_PROMPTS.diagnosis
      },
      {
        role: 'user',
        content: `Patient presents with the following:

Symptoms: ${symptoms.join(', ')}

Vital Signs: ${JSON.stringify(vitals, null, 2)}

Medical History: ${medicalHistory.join(', ')}

Please provide a differential diagnosis with reasoning and recommended diagnostic tests.`
      }
    ];

    return this.generateResponse(messages, {
      provider: config.provider || 'openai',
      model: config.model || 'gpt-4',
      temperature: 0.3, // Lower temperature for medical accuracy
      ...config
    });
  }

  public async generateTreatmentPlan(
    diagnosis: string,
    patientInfo: Record<string, any>,
    config: Partial<LLMConfig> = {}
  ): Promise<LLMResponse> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: MEDICAL_SYSTEM_PROMPTS.treatment
      },
      {
        role: 'user',
        content: `Based on the diagnosis: ${diagnosis}

Patient Information: ${JSON.stringify(patientInfo, null, 2)}

Please provide a comprehensive treatment plan including medications, lifestyle modifications, follow-up care, and monitoring parameters.`
      }
    ];

    return this.generateResponse(messages, {
      provider: config.provider || 'openai',
      model: config.model || 'gpt-4',
      temperature: 0.3,
      ...config
    });
  }

  // Health check for all providers
  public async healthCheck(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {};

    for (const [key, provider] of Object.entries(PROVIDERS)) {
      if (!provider.enabled) {
        health[key] = false;
        continue;
      }

      try {
        // Simple test request to check provider health
        const testMessages: LLMMessage[] = [
          { role: 'user', content: 'Hello, please respond with "OK"' }
        ];
        
        const response = await this.generateResponse(testMessages, {
          provider: key,
          model: provider.models[0],
          maxTokens: 10
        });
        
        health[key] = response.content.toLowerCase().includes('ok');
      } catch (error) {
        health[key] = false;
        logger.warn(`Health check failed for provider ${key}`, { error: error.message });
      }
    }

    return health;
  }

  // Get provider statistics
  public getProviderStats(): Record<string, any> {
    return {
      providers: PROVIDERS,
      rateLimits: Object.fromEntries(this.rateLimitTracker),
      enabledProviders: Object.keys(PROVIDERS).filter(key => PROVIDERS[key].enabled)
    };
  }
}

export const llmIntegrationService = new LLMIntegrationService();
export default llmIntegrationService;