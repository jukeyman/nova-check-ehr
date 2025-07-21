// ============================================================================
// TOKEN STORAGE UTILITY
// ============================================================================

/**
 * Secure token storage utility for managing authentication tokens
 * Handles access tokens, refresh tokens, and session management
 */

// ============================================================================
// TYPES
// ============================================================================

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  scope?: string;
}

export interface SessionData {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
  lastActivity: number;
  deviceId: string;
  ipAddress?: string;
  userAgent?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STORAGE_KEYS = {
  ACCESS_TOKEN: 'nova_access_token',
  REFRESH_TOKEN: 'nova_refresh_token',
  TOKEN_EXPIRY: 'nova_token_expiry',
  TOKEN_TYPE: 'nova_token_type',
  SESSION_DATA: 'nova_session_data',
  DEVICE_ID: 'nova_device_id',
  REMEMBER_ME: 'nova_remember_me',
  LAST_ACTIVITY: 'nova_last_activity',
} as const;

const TOKEN_REFRESH_THRESHOLD = 5 * 60 * 1000; // 5 minutes before expiry
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes of inactivity
const MAX_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours maximum

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a unique device ID
 */
function generateDeviceId(): string {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 15);
  const userAgent = navigator.userAgent;
  const screen = `${screen.width}x${screen.height}`;
  
  // Create a simple hash of browser characteristics
  const characteristics = `${userAgent}-${screen}-${navigator.language}`;
  let hash = 0;
  for (let i = 0; i < characteristics.length; i++) {
    const char = characteristics.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return `${timestamp}-${randomStr}-${Math.abs(hash).toString(36)}`;
}

/**
 * Get device ID (create if doesn't exist)
 */
function getDeviceId(): string {
  let deviceId = localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  if (!deviceId) {
    deviceId = generateDeviceId();
    localStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
  }
  return deviceId;
}

/**
 * Check if we're in a secure context
 */
function isSecureContext(): boolean {
  return window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost';
}

/**
 * Get storage mechanism based on remember me preference
 */
function getStorage(persistent: boolean = false): Storage {
  return persistent ? localStorage : sessionStorage;
}

/**
 * Encrypt sensitive data (basic implementation)
 * In production, consider using Web Crypto API for stronger encryption
 */
function encryptData(data: string, key: string): string {
  try {
    // Simple XOR encryption (replace with proper encryption in production)
    let encrypted = '';
    for (let i = 0; i < data.length; i++) {
      encrypted += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(encrypted);
  } catch (error) {
    console.warn('Encryption failed, storing data as-is:', error);
    return data;
  }
}

/**
 * Decrypt sensitive data
 */
function decryptData(encryptedData: string, key: string): string {
  try {
    const data = atob(encryptedData);
    let decrypted = '';
    for (let i = 0; i < data.length; i++) {
      decrypted += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return decrypted;
  } catch (error) {
    console.warn('Decryption failed, returning data as-is:', error);
    return encryptedData;
  }
}

/**
 * Get encryption key based on device characteristics
 */
function getEncryptionKey(): string {
  const deviceId = getDeviceId();
  const userAgent = navigator.userAgent;
  return `${deviceId}-${userAgent.slice(0, 20)}`;
}

// ============================================================================
// TOKEN STORAGE CLASS
// ============================================================================

export class TokenStorage {
  private static instance: TokenStorage;
  private encryptionKey: string;
  private activityTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.encryptionKey = getEncryptionKey();
    this.setupActivityTracking();
    this.validateStoredTokens();
  }

  public static getInstance(): TokenStorage {
    if (!TokenStorage.instance) {
      TokenStorage.instance = new TokenStorage();
    }
    return TokenStorage.instance;
  }

  // ========================================================================
  // TOKEN MANAGEMENT
  // ========================================================================

  /**
   * Store authentication tokens
   */
  setTokens(tokenData: TokenData, rememberMe: boolean = false): void {
    try {
      const storage = getStorage(rememberMe);
      const encryptedAccessToken = encryptData(tokenData.accessToken, this.encryptionKey);
      const encryptedRefreshToken = encryptData(tokenData.refreshToken, this.encryptionKey);

      storage.setItem(STORAGE_KEYS.ACCESS_TOKEN, encryptedAccessToken);
      storage.setItem(STORAGE_KEYS.REFRESH_TOKEN, encryptedRefreshToken);
      storage.setItem(STORAGE_KEYS.TOKEN_EXPIRY, tokenData.expiresAt.toString());
      storage.setItem(STORAGE_KEYS.TOKEN_TYPE, tokenData.tokenType);
      storage.setItem(STORAGE_KEYS.REMEMBER_ME, rememberMe.toString());

      if (tokenData.scope) {
        storage.setItem('nova_token_scope', tokenData.scope);
      }

      this.updateLastActivity();
    } catch (error) {
      console.error('Failed to store tokens:', error);
      throw new Error('Failed to store authentication tokens');
    }
  }

  /**
   * Get access token
   */
  getAccessToken(): string | null {
    try {
      const rememberMe = this.getRememberMe();
      const storage = getStorage(rememberMe);
      const encryptedToken = storage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      
      if (!encryptedToken) {
        return null;
      }

      const token = decryptData(encryptedToken, this.encryptionKey);
      
      // Check if token is expired
      if (this.isTokenExpired()) {
        this.clearTokens();
        return null;
      }

      // Check session timeout
      if (this.isSessionExpired()) {
        this.clearTokens();
        return null;
      }

      this.updateLastActivity();
      return token;
    } catch (error) {
      console.error('Failed to get access token:', error);
      return null;
    }
  }

  /**
   * Get refresh token
   */
  getRefreshToken(): string | null {
    try {
      const rememberMe = this.getRememberMe();
      const storage = getStorage(rememberMe);
      const encryptedToken = storage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      
      if (!encryptedToken) {
        return null;
      }

      return decryptData(encryptedToken, this.encryptionKey);
    } catch (error) {
      console.error('Failed to get refresh token:', error);
      return null;
    }
  }

  /**
   * Get token type
   */
  getTokenType(): string {
    const rememberMe = this.getRememberMe();
    const storage = getStorage(rememberMe);
    return storage.getItem(STORAGE_KEYS.TOKEN_TYPE) || 'Bearer';
  }

  /**
   * Get token expiry timestamp
   */
  getTokenExpiry(): number | null {
    const rememberMe = this.getRememberMe();
    const storage = getStorage(rememberMe);
    const expiry = storage.getItem(STORAGE_KEYS.TOKEN_EXPIRY);
    return expiry ? parseInt(expiry, 10) : null;
  }

  /**
   * Check if token exists
   */
  hasToken(): boolean {
    return this.getAccessToken() !== null;
  }

  /**
   * Check if token is expired
   */
  isTokenExpired(): boolean {
    const expiry = this.getTokenExpiry();
    if (!expiry) {
      return true;
    }
    return Date.now() >= expiry;
  }

  /**
   * Check if token needs refresh
   */
  needsRefresh(): boolean {
    const expiry = this.getTokenExpiry();
    if (!expiry) {
      return false;
    }
    return Date.now() >= (expiry - TOKEN_REFRESH_THRESHOLD);
  }

  /**
   * Clear all tokens
   */
  clearTokens(): void {
    try {
      // Clear from both storages
      [localStorage, sessionStorage].forEach(storage => {
        storage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
        storage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
        storage.removeItem(STORAGE_KEYS.TOKEN_EXPIRY);
        storage.removeItem(STORAGE_KEYS.TOKEN_TYPE);
        storage.removeItem(STORAGE_KEYS.SESSION_DATA);
        storage.removeItem(STORAGE_KEYS.REMEMBER_ME);
        storage.removeItem(STORAGE_KEYS.LAST_ACTIVITY);
        storage.removeItem('nova_token_scope');
      });

      this.clearActivityTimer();
    } catch (error) {
      console.error('Failed to clear tokens:', error);
    }
  }

  // ========================================================================
  // SESSION MANAGEMENT
  // ========================================================================

  /**
   * Store session data
   */
  setSessionData(sessionData: SessionData): void {
    try {
      const rememberMe = this.getRememberMe();
      const storage = getStorage(rememberMe);
      const encryptedData = encryptData(JSON.stringify(sessionData), this.encryptionKey);
      storage.setItem(STORAGE_KEYS.SESSION_DATA, encryptedData);
      this.updateLastActivity();
    } catch (error) {
      console.error('Failed to store session data:', error);
    }
  }

  /**
   * Get session data
   */
  getSessionData(): SessionData | null {
    try {
      const rememberMe = this.getRememberMe();
      const storage = getStorage(rememberMe);
      const encryptedData = storage.getItem(STORAGE_KEYS.SESSION_DATA);
      
      if (!encryptedData) {
        return null;
      }

      const decryptedData = decryptData(encryptedData, this.encryptionKey);
      return JSON.parse(decryptedData);
    } catch (error) {
      console.error('Failed to get session data:', error);
      return null;
    }
  }

  /**
   * Update last activity timestamp
   */
  updateLastActivity(): void {
    const rememberMe = this.getRememberMe();
    const storage = getStorage(rememberMe);
    storage.setItem(STORAGE_KEYS.LAST_ACTIVITY, Date.now().toString());
  }

  /**
   * Get last activity timestamp
   */
  getLastActivity(): number | null {
    const rememberMe = this.getRememberMe();
    const storage = getStorage(rememberMe);
    const lastActivity = storage.getItem(STORAGE_KEYS.LAST_ACTIVITY);
    return lastActivity ? parseInt(lastActivity, 10) : null;
  }

  /**
   * Check if session is expired due to inactivity
   */
  isSessionExpired(): boolean {
    const lastActivity = this.getLastActivity();
    if (!lastActivity) {
      return true;
    }

    const now = Date.now();
    const timeSinceActivity = now - lastActivity;
    
    // Check inactivity timeout
    if (timeSinceActivity > SESSION_TIMEOUT) {
      return true;
    }

    // Check maximum session duration
    const sessionData = this.getSessionData();
    if (sessionData && sessionData.lastActivity) {
      const sessionDuration = now - sessionData.lastActivity;
      if (sessionDuration > MAX_SESSION_DURATION) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get remember me preference
   */
  getRememberMe(): boolean {
    // Check both storages for remember me preference
    const localStorage_remember = localStorage.getItem(STORAGE_KEYS.REMEMBER_ME);
    const sessionStorage_remember = sessionStorage.getItem(STORAGE_KEYS.REMEMBER_ME);
    
    return localStorage_remember === 'true' || sessionStorage_remember === 'true';
  }

  /**
   * Get device ID
   */
  getDeviceId(): string {
    return getDeviceId();
  }

  // ========================================================================
  // ACTIVITY TRACKING
  // ========================================================================

  /**
   * Setup activity tracking
   */
  private setupActivityTracking(): void {
    // Track user activity
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    const throttledUpdateActivity = this.throttle(() => {
      if (this.hasToken()) {
        this.updateLastActivity();
      }
    }, 30000); // Update every 30 seconds at most

    activityEvents.forEach(event => {
      document.addEventListener(event, throttledUpdateActivity, { passive: true });
    });

    // Setup periodic session check
    this.activityTimer = setInterval(() => {
      if (this.hasToken() && this.isSessionExpired()) {
        this.clearTokens();
        // Dispatch custom event for session expiry
        window.dispatchEvent(new CustomEvent('sessionExpired'));
      }
    }, 60000); // Check every minute
  }

  /**
   * Clear activity timer
   */
  private clearActivityTimer(): void {
    if (this.activityTimer) {
      clearInterval(this.activityTimer);
      this.activityTimer = null;
    }
  }

  /**
   * Throttle function to limit execution frequency
   */
  private throttle(func: Function, limit: number): Function {
    let inThrottle: boolean;
    return function(this: any, ...args: any[]) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  // ========================================================================
  // VALIDATION AND SECURITY
  // ========================================================================

  /**
   * Validate stored tokens on initialization
   */
  private validateStoredTokens(): void {
    try {
      // Check if tokens are corrupted or invalid
      const accessToken = this.getAccessToken();
      if (accessToken && !this.isValidTokenFormat(accessToken)) {
        console.warn('Invalid token format detected, clearing tokens');
        this.clearTokens();
      }
    } catch (error) {
      console.warn('Token validation failed, clearing tokens:', error);
      this.clearTokens();
    }
  }

  /**
   * Basic token format validation
   */
  private isValidTokenFormat(token: string): boolean {
    // Basic JWT format check (header.payload.signature)
    if (token.includes('.')) {
      const parts = token.split('.');
      return parts.length === 3 && parts.every(part => part.length > 0);
    }
    
    // For other token formats, check minimum length
    return token.length >= 20;
  }

  /**
   * Get security info
   */
  getSecurityInfo(): {
    isSecureContext: boolean;
    hasTokens: boolean;
    tokenExpiry: number | null;
    lastActivity: number | null;
    deviceId: string;
    sessionExpired: boolean;
    needsRefresh: boolean;
  } {
    return {
      isSecureContext: isSecureContext(),
      hasTokens: this.hasToken(),
      tokenExpiry: this.getTokenExpiry(),
      lastActivity: this.getLastActivity(),
      deviceId: this.getDeviceId(),
      sessionExpired: this.isSessionExpired(),
      needsRefresh: this.needsRefresh(),
    };
  }

  // ========================================================================
  // CLEANUP
  // ========================================================================

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.clearActivityTimer();
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const tokenStorage = TokenStorage.getInstance();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export const setTokens = (tokenData: TokenData, rememberMe?: boolean): void =>
  tokenStorage.setTokens(tokenData, rememberMe);

export const getAccessToken = (): string | null => tokenStorage.getAccessToken();

export const getRefreshToken = (): string | null => tokenStorage.getRefreshToken();

export const hasToken = (): boolean => tokenStorage.hasToken();

export const isTokenExpired = (): boolean => tokenStorage.isTokenExpired();

export const needsRefresh = (): boolean => tokenStorage.needsRefresh();

export const clearTokens = (): void => tokenStorage.clearTokens();

export const getSessionData = (): SessionData | null => tokenStorage.getSessionData();

export const setSessionData = (sessionData: SessionData): void =>
  tokenStorage.setSessionData(sessionData);

export const updateLastActivity = (): void => tokenStorage.updateLastActivity();

export const isSessionExpired = (): boolean => tokenStorage.isSessionExpired();

export const getDeviceId = (): string => tokenStorage.getDeviceId();

export const getSecurityInfo = () => tokenStorage.getSecurityInfo();

// ============================================================================
// CLEANUP ON PAGE UNLOAD
// ============================================================================

window.addEventListener('beforeunload', () => {
  tokenStorage.cleanup();
});

// ============================================================================
// EXPORTS
// ============================================================================

export default tokenStorage;