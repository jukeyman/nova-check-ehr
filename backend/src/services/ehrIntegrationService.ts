import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { encrypt, decrypt } from '../utils/encryption';

// EHR Provider Types
export type EHRProvider = 'epic' | 'cerner' | 'allscripts' | 'athena' | 'fhir';

// FHIR Resource Types
export interface FHIRPatient {
  resourceType: 'Patient';
  id?: string;
  identifier?: Array<{
    use?: string;
    type?: any;
    system?: string;
    value?: string;
  }>;
  active?: boolean;
  name?: Array<{
    use?: string;
    family?: string;
    given?: string[];
  }>;
  telecom?: Array<{
    system?: string;
    value?: string;
    use?: string;
  }>;
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
  address?: Array<{
    use?: string;
    line?: string[];
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }>;
}

export interface FHIRObservation {
  resourceType: 'Observation';
  id?: string;
  status: 'registered' | 'preliminary' | 'final' | 'amended' | 'corrected' | 'cancelled' | 'entered-in-error' | 'unknown';
  category?: Array<{
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
  }>;
  code: {
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
    text?: string;
  };
  subject: {
    reference: string;
  };
  effectiveDateTime?: string;
  valueQuantity?: {
    value?: number;
    unit?: string;
    system?: string;
    code?: string;
  };
  valueString?: string;
  valueBoolean?: boolean;
}

export interface FHIRAppointment {
  resourceType: 'Appointment';
  id?: string;
  status: 'proposed' | 'pending' | 'booked' | 'arrived' | 'fulfilled' | 'cancelled' | 'noshow' | 'entered-in-error' | 'checked-in' | 'waitlist';
  serviceType?: Array<{
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
  }>;
  appointmentType?: {
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
  };
  reasonCode?: Array<{
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
    text?: string;
  }>;
  description?: string;
  start?: string;
  end?: string;
  minutesDuration?: number;
  participant: Array<{
    actor: {
      reference: string;
      display?: string;
    };
    required?: 'required' | 'optional' | 'information-only';
    status: 'accepted' | 'declined' | 'tentative' | 'needs-action';
  }>;
}

export interface EHRIntegrationConfig {
  provider: EHRProvider;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  redirectUri?: string;
  scopes?: string[];
  sandbox?: boolean;
}

export interface EHRAuthToken {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn: number;
  scope?: string;
  issuedAt: number;
}

class EHRIntegrationService {
  private clients: Map<EHRProvider, AxiosInstance> = new Map();
  private tokens: Map<EHRProvider, EHRAuthToken> = new Map();
  private configs: Map<EHRProvider, EHRIntegrationConfig> = new Map();

  constructor() {
    this.initializeConfigurations();
  }

  private initializeConfigurations(): void {
    // Epic Configuration
    if (process.env.FEATURE_EPIC_INTEGRATION === 'true' && process.env.EPIC_CLIENT_ID) {
      this.configs.set('epic', {
        provider: 'epic',
        clientId: process.env.EPIC_CLIENT_ID,
        clientSecret: process.env.EPIC_CLIENT_SECRET || '',
        baseUrl: process.env.NODE_ENV === 'production' 
          ? process.env.EPIC_PRODUCTION_URL || ''
          : process.env.EPIC_SANDBOX_URL || '',
        redirectUri: process.env.EPIC_REDIRECT_URI,
        scopes: ['patient/*.read', 'user/*.read', 'launch', 'online_access'],
        sandbox: process.env.NODE_ENV !== 'production'
      });
    }

    // Cerner Configuration
    if (process.env.FEATURE_CERNER_INTEGRATION === 'true' && process.env.CERNER_CLIENT_ID) {
      this.configs.set('cerner', {
        provider: 'cerner',
        clientId: process.env.CERNER_CLIENT_ID,
        clientSecret: process.env.CERNER_CLIENT_SECRET || '',
        baseUrl: process.env.NODE_ENV === 'production'
          ? process.env.CERNER_PRODUCTION_URL || ''
          : process.env.CERNER_SANDBOX_URL || '',
        scopes: ['patient/Patient.read', 'patient/Observation.read', 'patient/Appointment.read'],
        sandbox: process.env.NODE_ENV !== 'production'
      });
    }

    // Allscripts Configuration
    if (process.env.FEATURE_ALLSCRIPTS_INTEGRATION === 'true' && process.env.ALLSCRIPTS_CLIENT_ID) {
      this.configs.set('allscripts', {
        provider: 'allscripts',
        clientId: process.env.ALLSCRIPTS_CLIENT_ID,
        clientSecret: process.env.ALLSCRIPTS_CLIENT_SECRET || '',
        baseUrl: process.env.ALLSCRIPTS_API_URL || '',
        scopes: ['read', 'write'],
        sandbox: process.env.NODE_ENV !== 'production'
      });
    }

    // athenahealth Configuration
    if (process.env.FEATURE_ATHENA_INTEGRATION === 'true' && process.env.ATHENA_CLIENT_ID) {
      this.configs.set('athena', {
        provider: 'athena',
        clientId: process.env.ATHENA_CLIENT_ID,
        clientSecret: process.env.ATHENA_CLIENT_SECRET || '',
        baseUrl: process.env.ATHENA_API_URL || '',
        scopes: ['patient/*', 'user/*'],
        sandbox: process.env.NODE_ENV !== 'production'
      });
    }

    // FHIR Server Configuration
    if (process.env.FEATURE_FHIR_ENABLED === 'true' && process.env.FHIR_SERVER_URL) {
      this.configs.set('fhir', {
        provider: 'fhir',
        clientId: process.env.FHIR_SERVER_CLIENT_ID || '',
        clientSecret: process.env.FHIR_SERVER_CLIENT_SECRET || '',
        baseUrl: process.env.FHIR_SERVER_URL,
        scopes: ['read', 'write'],
        sandbox: false
      });
    }

    this.initializeClients();
    logger.info(`EHR Integration Service initialized with ${this.configs.size} providers`);
  }

  private initializeClients(): void {
    for (const [provider, config] of this.configs) {
      const client = axios.create({
        baseURL: config.baseUrl,
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      // Add request interceptor for authentication
      client.interceptors.request.use(async (config) => {
        const token = this.tokens.get(provider);
        if (token && this.isTokenValid(token)) {
          config.headers.Authorization = `${token.tokenType} ${token.accessToken}`;
        }
        return config;
      });

      // Add response interceptor for token refresh
      client.interceptors.response.use(
        (response) => response,
        async (error) => {
          if (error.response?.status === 401) {
            await this.refreshToken(provider);
            // Retry the original request
            return client.request(error.config);
          }
          return Promise.reject(error);
        }
      );

      this.clients.set(provider, client);
    }
  }

  // Authentication Methods
  async authenticate(provider: EHRProvider, authCode?: string): Promise<EHRAuthToken> {
    const config = this.configs.get(provider);
    if (!config) {
      throw new Error(`Provider ${provider} not configured`);
    }

    try {
      let tokenResponse;

      switch (provider) {
        case 'epic':
          tokenResponse = await this.authenticateEpic(config, authCode);
          break;
        case 'cerner':
          tokenResponse = await this.authenticateCerner(config, authCode);
          break;
        case 'allscripts':
          tokenResponse = await this.authenticateAllscripts(config);
          break;
        case 'athena':
          tokenResponse = await this.authenticateAthena(config);
          break;
        case 'fhir':
          tokenResponse = await this.authenticateFHIR(config);
          break;
        default:
          throw new Error(`Authentication not implemented for ${provider}`);
      }

      const token: EHRAuthToken = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        tokenType: tokenResponse.token_type || 'Bearer',
        expiresIn: tokenResponse.expires_in || 3600,
        scope: tokenResponse.scope,
        issuedAt: Date.now()
      };

      // Encrypt and store token
      this.tokens.set(provider, token);
      await this.persistToken(provider, token);

      logger.info(`Successfully authenticated with ${provider}`);
      return token;
    } catch (error) {
      logger.error(`Authentication failed for ${provider}:`, error);
      throw error;
    }
  }

  private async authenticateEpic(config: EHRIntegrationConfig, authCode?: string): Promise<any> {
    if (!authCode) {
      // Return authorization URL for OAuth flow
      const authUrl = `${config.baseUrl}/oauth2/authorize?` +
        `response_type=code&` +
        `client_id=${config.clientId}&` +
        `redirect_uri=${encodeURIComponent(config.redirectUri || '')}&` +
        `scope=${encodeURIComponent(config.scopes?.join(' ') || '')}&` +
        `state=${Math.random().toString(36).substring(7)}`;
      
      throw new Error(`Authorization required. Visit: ${authUrl}`);
    }

    const response = await axios.post(`${config.baseUrl}/oauth2/token`, {
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: authCode,
      redirect_uri: config.redirectUri
    });

    return response.data;
  }

  private async authenticateCerner(config: EHRIntegrationConfig, authCode?: string): Promise<any> {
    if (!authCode) {
      const authUrl = `${config.baseUrl}/oauth2/authorize?` +
        `response_type=code&` +
        `client_id=${config.clientId}&` +
        `redirect_uri=${encodeURIComponent(config.redirectUri || '')}&` +
        `scope=${encodeURIComponent(config.scopes?.join(' ') || '')}&` +
        `aud=${encodeURIComponent(config.baseUrl)}`;
      
      throw new Error(`Authorization required. Visit: ${authUrl}`);
    }

    const response = await axios.post(`${config.baseUrl}/oauth2/token`, {
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: authCode,
      redirect_uri: config.redirectUri
    });

    return response.data;
  }

  private async authenticateAllscripts(config: EHRIntegrationConfig): Promise<any> {
    // Allscripts typically uses client credentials flow
    const response = await axios.post(`${config.baseUrl}/oauth/token`, {
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: config.scopes?.join(' ')
    });

    return response.data;
  }

  private async authenticateAthena(config: EHRIntegrationConfig): Promise<any> {
    // athenahealth uses client credentials flow
    const response = await axios.post(`${config.baseUrl}/oauth2/v1/token`, {
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: config.scopes?.join(' ')
    });

    return response.data;
  }

  private async authenticateFHIR(config: EHRIntegrationConfig): Promise<any> {
    if (process.env.FHIR_SERVER_AUTH_TYPE === 'oauth2') {
      const response = await axios.post(`${config.baseUrl}/oauth/token`, {
        grant_type: 'client_credentials',
        client_id: config.clientId,
        client_secret: config.clientSecret
      });
      return response.data;
    } else {
      // For basic auth or no auth FHIR servers
      return {
        access_token: 'no-auth-required',
        token_type: 'Bearer',
        expires_in: 86400
      };
    }
  }

  // FHIR Resource Operations
  async getPatient(provider: EHRProvider, patientId: string): Promise<FHIRPatient> {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} not initialized`);
    }

    const response = await client.get(`/Patient/${patientId}`);
    return response.data;
  }

  async searchPatients(provider: EHRProvider, searchParams: any): Promise<FHIRPatient[]> {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} not initialized`);
    }

    const params = new URLSearchParams(searchParams);
    const response = await client.get(`/Patient?${params.toString()}`);
    
    return response.data.entry?.map((entry: any) => entry.resource) || [];
  }

  async createPatient(provider: EHRProvider, patient: FHIRPatient): Promise<FHIRPatient> {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} not initialized`);
    }

    const response = await client.post('/Patient', patient);
    return response.data;
  }

  async updatePatient(provider: EHRProvider, patientId: string, patient: FHIRPatient): Promise<FHIRPatient> {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} not initialized`);
    }

    const response = await client.put(`/Patient/${patientId}`, patient);
    return response.data;
  }

  async getObservations(provider: EHRProvider, patientId: string): Promise<FHIRObservation[]> {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} not initialized`);
    }

    const response = await client.get(`/Observation?patient=${patientId}`);
    return response.data.entry?.map((entry: any) => entry.resource) || [];
  }

  async createObservation(provider: EHRProvider, observation: FHIRObservation): Promise<FHIRObservation> {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} not initialized`);
    }

    const response = await client.post('/Observation', observation);
    return response.data;
  }

  async getAppointments(provider: EHRProvider, patientId?: string): Promise<FHIRAppointment[]> {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} not initialized`);
    }

    const params = patientId ? `?patient=${patientId}` : '';
    const response = await client.get(`/Appointment${params}`);
    return response.data.entry?.map((entry: any) => entry.resource) || [];
  }

  async createAppointment(provider: EHRProvider, appointment: FHIRAppointment): Promise<FHIRAppointment> {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} not initialized`);
    }

    const response = await client.post('/Appointment', appointment);
    return response.data;
  }

  async updateAppointment(provider: EHRProvider, appointmentId: string, appointment: FHIRAppointment): Promise<FHIRAppointment> {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`Provider ${provider} not initialized`);
    }

    const response = await client.put(`/Appointment/${appointmentId}`, appointment);
    return response.data;
  }

  // Utility Methods
  private isTokenValid(token: EHRAuthToken): boolean {
    const now = Date.now();
    const expiresAt = token.issuedAt + (token.expiresIn * 1000);
    return now < expiresAt - 60000; // 1 minute buffer
  }

  private async refreshToken(provider: EHRProvider): Promise<void> {
    const token = this.tokens.get(provider);
    const config = this.configs.get(provider);
    
    if (!token?.refreshToken || !config) {
      throw new Error(`Cannot refresh token for ${provider}`);
    }

    try {
      const response = await axios.post(`${config.baseUrl}/oauth2/token`, {
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret
      });

      const newToken: EHRAuthToken = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token || token.refreshToken,
        tokenType: response.data.token_type || 'Bearer',
        expiresIn: response.data.expires_in || 3600,
        scope: response.data.scope,
        issuedAt: Date.now()
      };

      this.tokens.set(provider, newToken);
      await this.persistToken(provider, newToken);
      
      logger.info(`Token refreshed for ${provider}`);
    } catch (error) {
      logger.error(`Token refresh failed for ${provider}:`, error);
      this.tokens.delete(provider);
      throw error;
    }
  }

  private async persistToken(provider: EHRProvider, token: EHRAuthToken): Promise<void> {
    try {
      // In a real implementation, you would store this in a secure database
      // For now, we'll just encrypt and store in memory
      const encryptedToken = encrypt(JSON.stringify(token));
      // Store encryptedToken in database with provider as key
      logger.debug(`Token persisted for ${provider}`);
    } catch (error) {
      logger.error(`Failed to persist token for ${provider}:`, error);
    }
  }

  async getProviderStatus(): Promise<{ [key in EHRProvider]?: boolean }> {
    const status: { [key in EHRProvider]?: boolean } = {};
    
    for (const provider of this.configs.keys()) {
      try {
        const client = this.clients.get(provider);
        if (client) {
          // Try a simple metadata request
          await client.get('/metadata');
          status[provider] = true;
        } else {
          status[provider] = false;
        }
      } catch (error) {
        status[provider] = false;
        logger.error(`Health check failed for ${provider}:`, error);
      }
    }
    
    return status;
  }

  getConfiguredProviders(): EHRProvider[] {
    return Array.from(this.configs.keys());
  }

  async syncPatientData(provider: EHRProvider, patientId: string): Promise<{
    patient: FHIRPatient;
    observations: FHIRObservation[];
    appointments: FHIRAppointment[];
  }> {
    try {
      const [patient, observations, appointments] = await Promise.all([
        this.getPatient(provider, patientId),
        this.getObservations(provider, patientId),
        this.getAppointments(provider, patientId)
      ]);

      return { patient, observations, appointments };
    } catch (error) {
      logger.error(`Failed to sync patient data from ${provider}:`, error);
      throw error;
    }
  }
}

export const ehrIntegrationService = new EHRIntegrationService();
export default ehrIntegrationService;