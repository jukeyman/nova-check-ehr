import { OpenAI } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { logger } from '../utils/logger';

// AI Provider Types
export type AIProvider = 'deepseek' | 'openai' | 'claude' | 'gemini' | 'mistral' | 'cohere' | 'azure-openai';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  provider: AIProvider;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  confidence?: number;
}

export interface AIConfig {
  provider: AIProvider;
  model: string;
  maxTokens: number;
  temperature: number;
  timeout?: number;
}

class AIService {
  private openai?: OpenAI;
  private anthropic?: Anthropic;
  private googleAI?: GoogleGenerativeAI;
  private defaultProvider: AIProvider;
  private fallbackProvider: AIProvider;

  constructor() {
    this.defaultProvider = (process.env.AI_CHAT_DEFAULT_MODEL as AIProvider) || 'deepseek';
    this.fallbackProvider = (process.env.AI_CHAT_FALLBACK_MODEL as AIProvider) || 'openai';
    this.initializeProviders();
  }

  private initializeProviders(): void {
    try {
      // Initialize OpenAI
      if (process.env.OPENAI_API_KEY && process.env.FEATURE_OPENAI_ENABLED === 'true') {
        this.openai = new OpenAI({
          apiKey: process.env.OPENAI_API_KEY,
        });
        logger.info('OpenAI initialized successfully');
      }

      // Initialize Anthropic
      if (process.env.ANTHROPIC_API_KEY && process.env.FEATURE_CLAUDE_ENABLED === 'true') {
        this.anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });
        logger.info('Anthropic Claude initialized successfully');
      }

      // Initialize Google AI
      if (process.env.GOOGLE_AI_API_KEY && process.env.FEATURE_GEMINI_ENABLED === 'true') {
        this.googleAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
        logger.info('Google Gemini initialized successfully');
      }

      logger.info(`AI Service initialized with default provider: ${this.defaultProvider}`);
    } catch (error) {
      logger.error('Error initializing AI providers:', error);
    }
  }

  async generateResponse(
    messages: AIMessage[],
    config?: Partial<AIConfig>
  ): Promise<AIResponse> {
    const provider = config?.provider || this.defaultProvider;
    
    try {
      switch (provider) {
        case 'deepseek':
          return await this.generateDeepSeekResponse(messages, config);
        case 'openai':
          return await this.generateOpenAIResponse(messages, config);
        case 'claude':
          return await this.generateClaudeResponse(messages, config);
        case 'gemini':
          return await this.generateGeminiResponse(messages, config);
        case 'mistral':
          return await this.generateMistralResponse(messages, config);
        case 'cohere':
          return await this.generateCohereResponse(messages, config);
        case 'azure-openai':
          return await this.generateAzureOpenAIResponse(messages, config);
        default:
          throw new Error(`Unsupported AI provider: ${provider}`);
      }
    } catch (error) {
      logger.error(`Error with ${provider}, trying fallback:`, error);
      
      if (provider !== this.fallbackProvider) {
        return await this.generateResponse(messages, {
          ...config,
          provider: this.fallbackProvider
        });
      }
      
      throw error;
    }
  }

  private async generateDeepSeekResponse(
    messages: AIMessage[],
    config?: Partial<AIConfig>
  ): Promise<AIResponse> {
    if (!process.env.DEEPSEEK_API_KEY || process.env.FEATURE_DEEPSEEK_ENABLED !== 'true') {
      throw new Error('DeepSeek not configured or disabled');
    }

    const response = await axios.post(
      `${process.env.DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: config?.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: messages,
        max_tokens: config?.maxTokens || parseInt(process.env.DEEPSEEK_MAX_TOKENS || '4000'),
        temperature: config?.temperature || parseFloat(process.env.DEEPSEEK_TEMPERATURE || '0.3'),
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: config?.timeout || 30000
      }
    );

    const choice = response.data.choices[0];
    return {
      content: choice.message.content,
      provider: 'deepseek',
      model: response.data.model,
      usage: {
        promptTokens: response.data.usage?.prompt_tokens || 0,
        completionTokens: response.data.usage?.completion_tokens || 0,
        totalTokens: response.data.usage?.total_tokens || 0
      }
    };
  }

  private async generateOpenAIResponse(
    messages: AIMessage[],
    config?: Partial<AIConfig>
  ): Promise<AIResponse> {
    if (!this.openai) {
      throw new Error('OpenAI not initialized');
    }

    const response = await this.openai.chat.completions.create({
      model: config?.model || process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
      messages: messages,
      max_tokens: config?.maxTokens || parseInt(process.env.OPENAI_MAX_TOKENS || '4000'),
      temperature: config?.temperature || parseFloat(process.env.OPENAI_TEMPERATURE || '0.3')
    });

    const choice = response.choices[0];
    return {
      content: choice.message?.content || '',
      provider: 'openai',
      model: response.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0
      }
    };
  }

  private async generateClaudeResponse(
    messages: AIMessage[],
    config?: Partial<AIConfig>
  ): Promise<AIResponse> {
    if (!this.anthropic) {
      throw new Error('Anthropic not initialized');
    }

    // Convert messages format for Claude
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const response = await this.anthropic.messages.create({
      model: config?.model || process.env.ANTHROPIC_MODEL || 'claude-3-opus-20240229',
      max_tokens: config?.maxTokens || parseInt(process.env.ANTHROPIC_MAX_TOKENS || '4000'),
      temperature: config?.temperature || 0.3,
      system: systemMessage,
      messages: conversationMessages
    });

    const content = response.content[0];
    return {
      content: content.type === 'text' ? content.text : '',
      provider: 'claude',
      model: response.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens
      }
    };
  }

  private async generateGeminiResponse(
    messages: AIMessage[],
    config?: Partial<AIConfig>
  ): Promise<AIResponse> {
    if (!this.googleAI) {
      throw new Error('Google AI not initialized');
    }

    const model = this.googleAI.getGenerativeModel({
      model: config?.model || process.env.GOOGLE_AI_MODEL || 'gemini-pro'
    });

    // Convert messages to Gemini format
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');

    const result = await model.generateContent(prompt);
    const response = await result.response;

    return {
      content: response.text(),
      provider: 'gemini',
      model: config?.model || process.env.GOOGLE_AI_MODEL || 'gemini-pro'
    };
  }

  private async generateMistralResponse(
    messages: AIMessage[],
    config?: Partial<AIConfig>
  ): Promise<AIResponse> {
    if (!process.env.MISTRAL_API_KEY || process.env.FEATURE_MISTRAL_ENABLED !== 'true') {
      throw new Error('Mistral not configured or disabled');
    }

    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: config?.model || process.env.MISTRAL_MODEL || 'mistral-large-latest',
        messages: messages,
        max_tokens: config?.maxTokens || 4000,
        temperature: config?.temperature || 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const choice = response.data.choices[0];
    return {
      content: choice.message.content,
      provider: 'mistral',
      model: response.data.model,
      usage: {
        promptTokens: response.data.usage?.prompt_tokens || 0,
        completionTokens: response.data.usage?.completion_tokens || 0,
        totalTokens: response.data.usage?.total_tokens || 0
      }
    };
  }

  private async generateCohereResponse(
    messages: AIMessage[],
    config?: Partial<AIConfig>
  ): Promise<AIResponse> {
    if (!process.env.COHERE_API_KEY || process.env.FEATURE_COHERE_ENABLED !== 'true') {
      throw new Error('Cohere not configured or disabled');
    }

    // Convert messages to Cohere format
    const prompt = messages.map(m => m.content).join('\n\n');

    const response = await axios.post(
      'https://api.cohere.ai/v1/generate',
      {
        model: config?.model || process.env.COHERE_MODEL || 'command-r-plus',
        prompt: prompt,
        max_tokens: config?.maxTokens || 4000,
        temperature: config?.temperature || 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      content: response.data.generations[0].text,
      provider: 'cohere',
      model: config?.model || process.env.COHERE_MODEL || 'command-r-plus'
    };
  }

  private async generateAzureOpenAIResponse(
    messages: AIMessage[],
    config?: Partial<AIConfig>
  ): Promise<AIResponse> {
    if (!process.env.AZURE_OPENAI_API_KEY) {
      throw new Error('Azure OpenAI not configured');
    }

    const response = await axios.post(
      `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=${process.env.AZURE_OPENAI_API_VERSION}`,
      {
        messages: messages,
        max_tokens: config?.maxTokens || 4000,
        temperature: config?.temperature || 0.3
      },
      {
        headers: {
          'api-key': process.env.AZURE_OPENAI_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const choice = response.data.choices[0];
    return {
      content: choice.message.content,
      provider: 'azure-openai',
      model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4',
      usage: {
        promptTokens: response.data.usage?.prompt_tokens || 0,
        completionTokens: response.data.usage?.completion_tokens || 0,
        totalTokens: response.data.usage?.total_tokens || 0
      }
    };
  }

  // Medical AI specialized methods
  async generateMedicalDiagnosis(
    symptoms: string[],
    patientHistory: string,
    vitalSigns: any
  ): Promise<AIResponse> {
    const systemPrompt = `You are a medical AI assistant helping with preliminary diagnosis. 
Provide differential diagnoses based on symptoms, patient history, and vital signs. 
Always recommend consulting with a healthcare professional for final diagnosis.`;
    
    const userPrompt = `
Symptoms: ${symptoms.join(', ')}
Patient History: ${patientHistory}
Vital Signs: ${JSON.stringify(vitalSigns, null, 2)}

Please provide a preliminary assessment with differential diagnoses and recommended next steps.`;

    return await this.generateResponse([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);
  }

  async generateTreatmentPlan(
    diagnosis: string,
    patientProfile: any,
    allergies: string[]
  ): Promise<AIResponse> {
    const systemPrompt = `You are a medical AI assistant helping with treatment planning. 
Provide evidence-based treatment recommendations considering patient allergies and profile. 
Always emphasize the need for physician oversight.`;
    
    const userPrompt = `
Diagnosis: ${diagnosis}
Patient Profile: ${JSON.stringify(patientProfile, null, 2)}
Allergies: ${allergies.join(', ')}

Please provide a comprehensive treatment plan with medications, lifestyle recommendations, and follow-up care.`;

    return await this.generateResponse([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);
  }

  async generateClinicalNotes(
    patientEncounter: any,
    template: string = 'SOAP'
  ): Promise<AIResponse> {
    const systemPrompt = `You are a medical AI assistant helping with clinical documentation. 
Generate structured clinical notes in ${template} format based on patient encounter data.`;
    
    const userPrompt = `
Patient Encounter Data: ${JSON.stringify(patientEncounter, null, 2)}

Please generate comprehensive clinical notes in ${template} format.`;

    return await this.generateResponse([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);
  }

  // Utility methods
  getAvailableProviders(): AIProvider[] {
    const providers: AIProvider[] = [];
    
    if (process.env.FEATURE_DEEPSEEK_ENABLED === 'true' && process.env.DEEPSEEK_API_KEY) {
      providers.push('deepseek');
    }
    if (process.env.FEATURE_OPENAI_ENABLED === 'true' && process.env.OPENAI_API_KEY) {
      providers.push('openai');
    }
    if (process.env.FEATURE_CLAUDE_ENABLED === 'true' && process.env.ANTHROPIC_API_KEY) {
      providers.push('claude');
    }
    if (process.env.FEATURE_GEMINI_ENABLED === 'true' && process.env.GOOGLE_AI_API_KEY) {
      providers.push('gemini');
    }
    if (process.env.FEATURE_MISTRAL_ENABLED === 'true' && process.env.MISTRAL_API_KEY) {
      providers.push('mistral');
    }
    if (process.env.FEATURE_COHERE_ENABLED === 'true' && process.env.COHERE_API_KEY) {
      providers.push('cohere');
    }
    if (process.env.AZURE_OPENAI_API_KEY) {
      providers.push('azure-openai');
    }
    
    return providers;
  }

  async healthCheck(): Promise<{ [key in AIProvider]?: boolean }> {
    const providers = this.getAvailableProviders();
    const results: { [key in AIProvider]?: boolean } = {};

    for (const provider of providers) {
      try {
        const response = await this.generateResponse(
          [{ role: 'user', content: 'Hello' }],
          { provider, maxTokens: 10 }
        );
        results[provider] = !!response.content;
      } catch (error) {
        results[provider] = false;
        logger.error(`Health check failed for ${provider}:`, error);
      }
    }

    return results;
  }
}

export const aiService = new AIService();
export default aiService;