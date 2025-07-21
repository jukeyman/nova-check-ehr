import { apiService, ApiResponse } from './api';
import { tokenStorage } from '@/utils/tokenStorage';
import { User, LoginCredentials, RegisterData, TwoFactorData } from '@/types/auth';

// ============================================================================
// TYPES
// ============================================================================

export interface LoginResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  requiresTwoFactor?: boolean;
  twoFactorToken?: string;
}

export interface RegisterResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  requiresEmailVerification?: boolean;
}

export interface TwoFactorResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
}

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetConfirm {
  token: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface UpdateProfileRequest {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  preferences?: {
    language?: string;
    timezone?: string;
    notifications?: {
      email?: boolean;
      sms?: boolean;
      push?: boolean;
    };
  };
}

export interface EmailVerificationRequest {
  token: string;
}

export interface ResendVerificationRequest {
  email: string;
}

export interface TwoFactorSetupResponse {
  qrCode: string;
  secret: string;
  backupCodes: string[];
}

export interface TwoFactorVerifySetup {
  token: string;
  code: string;
}

export interface SessionInfo {
  id: string;
  userId: string;
  deviceInfo: {
    userAgent: string;
    ip: string;
    location?: string;
  };
  createdAt: string;
  lastActivity: string;
  isActive: boolean;
  isCurrent: boolean;
}

// ============================================================================
// AUTH SERVICE CLASS
// ============================================================================

export class AuthService {
  private static instance: AuthService;

  private constructor() {}

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  // ========================================================================
  // AUTHENTICATION METHODS
  // ========================================================================

  /**
   * Login with email and password
   */
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const response = await apiService.post<LoginResponse>('/auth/login', credentials, {
      skipAuth: true,
      showSuccessToast: true,
      successMessage: 'Login successful!',
    });

    const { user, accessToken, refreshToken, requiresTwoFactor, twoFactorToken } = response.data;

    if (!requiresTwoFactor) {
      // Store tokens if 2FA is not required
      tokenStorage.setTokens(accessToken, refreshToken);
      tokenStorage.setUser(user);
    } else if (twoFactorToken) {
      // Store temporary 2FA token
      tokenStorage.setTwoFactorToken(twoFactorToken);
    }

    return response.data;
  }

  /**
   * Complete two-factor authentication
   */
  async verifyTwoFactor(data: TwoFactorData): Promise<TwoFactorResponse> {
    const twoFactorToken = tokenStorage.getTwoFactorToken();
    
    if (!twoFactorToken) {
      throw new Error('Two-factor token not found. Please restart the login process.');
    }

    const response = await apiService.post<TwoFactorResponse>('/auth/verify-2fa', {
      ...data,
      twoFactorToken,
    }, {
      skipAuth: true,
      showSuccessToast: true,
      successMessage: 'Two-factor authentication successful!',
    });

    const { user, accessToken, refreshToken } = response.data;

    // Clear 2FA token and store auth tokens
    tokenStorage.clearTwoFactorToken();
    tokenStorage.setTokens(accessToken, refreshToken);
    tokenStorage.setUser(user);

    return response.data;
  }

  /**
   * Register new user
   */
  async register(data: RegisterData): Promise<RegisterResponse> {
    const response = await apiService.post<RegisterResponse>('/auth/register', data, {
      skipAuth: true,
      showSuccessToast: true,
      successMessage: 'Registration successful!',
    });

    const { user, accessToken, refreshToken, requiresEmailVerification } = response.data;

    if (!requiresEmailVerification) {
      // Store tokens if email verification is not required
      tokenStorage.setTokens(accessToken, refreshToken);
      tokenStorage.setUser(user);
    }

    return response.data;
  }

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    try {
      const refreshToken = tokenStorage.getRefreshToken();
      
      if (refreshToken) {
        await apiService.post('/auth/logout', { refreshToken }, {
          showSuccessToast: true,
          successMessage: 'Logged out successfully!',
        });
      }
    } catch (error) {
      console.error('Logout error:', error);
      // Continue with local logout even if server logout fails
    } finally {
      // Clear all stored data
      tokenStorage.clearAll();
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(): Promise<RefreshTokenResponse> {
    const refreshToken = tokenStorage.getRefreshToken();
    
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await apiService.post<RefreshTokenResponse>('/auth/refresh', {
      refreshToken,
    }, {
      skipAuth: true,
    });

    const { accessToken, refreshToken: newRefreshToken } = response.data;
    
    // Update stored tokens
    tokenStorage.setTokens(accessToken, newRefreshToken);

    return response.data;
  }

  // ========================================================================
  // PASSWORD MANAGEMENT
  // ========================================================================

  /**
   * Request password reset
   */
  async requestPasswordReset(data: PasswordResetRequest): Promise<void> {
    await apiService.post('/auth/password-reset/request', data, {
      skipAuth: true,
      showSuccessToast: true,
      successMessage: 'Password reset email sent!',
    });
  }

  /**
   * Confirm password reset
   */
  async confirmPasswordReset(data: PasswordResetConfirm): Promise<void> {
    await apiService.post('/auth/password-reset/confirm', data, {
      skipAuth: true,
      showSuccessToast: true,
      successMessage: 'Password reset successful!',
    });
  }

  /**
   * Change password (authenticated user)
   */
  async changePassword(data: ChangePasswordRequest): Promise<void> {
    await apiService.post('/auth/change-password', data, {
      showSuccessToast: true,
      successMessage: 'Password changed successfully!',
    });
  }

  // ========================================================================
  // EMAIL VERIFICATION
  // ========================================================================

  /**
   * Verify email address
   */
  async verifyEmail(data: EmailVerificationRequest): Promise<void> {
    const response = await apiService.post<{ user: User; accessToken: string; refreshToken: string }>(
      '/auth/verify-email',
      data,
      {
        skipAuth: true,
        showSuccessToast: true,
        successMessage: 'Email verified successfully!',
      }
    );

    const { user, accessToken, refreshToken } = response.data;
    
    // Store tokens after email verification
    tokenStorage.setTokens(accessToken, refreshToken);
    tokenStorage.setUser(user);
  }

  /**
   * Resend email verification
   */
  async resendEmailVerification(data: ResendVerificationRequest): Promise<void> {
    await apiService.post('/auth/resend-verification', data, {
      skipAuth: true,
      showSuccessToast: true,
      successMessage: 'Verification email sent!',
    });
  }

  // ========================================================================
  // TWO-FACTOR AUTHENTICATION SETUP
  // ========================================================================

  /**
   * Setup two-factor authentication
   */
  async setupTwoFactor(): Promise<TwoFactorSetupResponse> {
    const response = await apiService.post<TwoFactorSetupResponse>('/auth/2fa/setup');
    return response.data;
  }

  /**
   * Verify and enable two-factor authentication
   */
  async verifyTwoFactorSetup(data: TwoFactorVerifySetup): Promise<void> {
    await apiService.post('/auth/2fa/verify-setup', data, {
      showSuccessToast: true,
      successMessage: 'Two-factor authentication enabled!',
    });
  }

  /**
   * Disable two-factor authentication
   */
  async disableTwoFactor(password: string): Promise<void> {
    await apiService.post('/auth/2fa/disable', { password }, {
      showSuccessToast: true,
      successMessage: 'Two-factor authentication disabled!',
    });
  }

  /**
   * Generate new backup codes
   */
  async generateBackupCodes(): Promise<{ backupCodes: string[] }> {
    const response = await apiService.post<{ backupCodes: string[] }>('/auth/2fa/backup-codes');
    return response.data;
  }

  // ========================================================================
  // PROFILE MANAGEMENT
  // ========================================================================

  /**
   * Get current user profile
   */
  async getProfile(): Promise<User> {
    const response = await apiService.get<User>('/auth/profile');
    
    // Update stored user data
    tokenStorage.setUser(response.data);
    
    return response.data;
  }

  /**
   * Update user profile
   */
  async updateProfile(data: UpdateProfileRequest): Promise<User> {
    const response = await apiService.patch<User>('/auth/profile', data, {
      showSuccessToast: true,
      successMessage: 'Profile updated successfully!',
    });

    // Update stored user data
    tokenStorage.setUser(response.data);

    return response.data;
  }

  /**
   * Upload profile avatar
   */
  async uploadAvatar(file: File): Promise<{ avatarUrl: string }> {
    const response = await apiService.uploadFile<{ avatarUrl: string }>(
      '/auth/profile/avatar',
      file,
      {},
      undefined,
      {
        showSuccessToast: true,
        successMessage: 'Avatar updated successfully!',
      }
    );

    return response.data;
  }

  /**
   * Delete profile avatar
   */
  async deleteAvatar(): Promise<void> {
    await apiService.delete('/auth/profile/avatar', {
      showSuccessToast: true,
      successMessage: 'Avatar removed successfully!',
    });
  }

  // ========================================================================
  // SESSION MANAGEMENT
  // ========================================================================

  /**
   * Get active sessions
   */
  async getSessions(): Promise<SessionInfo[]> {
    const response = await apiService.get<SessionInfo[]>('/auth/sessions');
    return response.data;
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(sessionId: string): Promise<void> {
    await apiService.delete(`/auth/sessions/${sessionId}`, {
      showSuccessToast: true,
      successMessage: 'Session revoked successfully!',
    });
  }

  /**
   * Revoke all other sessions
   */
  async revokeAllOtherSessions(): Promise<void> {
    await apiService.post('/auth/sessions/revoke-others', {}, {
      showSuccessToast: true,
      successMessage: 'All other sessions revoked!',
    });
  }

  // ========================================================================
  // UTILITY METHODS
  // ========================================================================

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    const token = tokenStorage.getAccessToken();
    const user = tokenStorage.getUser();
    return !!(token && user);
  }

  /**
   * Get current user from storage
   */
  getCurrentUser(): User | null {
    return tokenStorage.getUser();
  }

  /**
   * Check if access token is expired
   */
  isTokenExpired(): boolean {
    return tokenStorage.isTokenExpired();
  }

  /**
   * Check if user has specific permission
   */
  hasPermission(permission: string): boolean {
    const user = this.getCurrentUser();
    if (!user) return false;

    // Check if user has the specific permission
    return user.permissions?.includes(permission) || false;
  }

  /**
   * Check if user has specific role
   */
  hasRole(role: string): boolean {
    const user = this.getCurrentUser();
    if (!user) return false;

    return user.role === role;
  }

  /**
   * Check if user has any of the specified roles
   */
  hasAnyRole(roles: string[]): boolean {
    const user = this.getCurrentUser();
    if (!user) return false;

    return roles.includes(user.role);
  }

  /**
   * Get user's full name
   */
  getUserFullName(): string {
    const user = this.getCurrentUser();
    if (!user) return '';

    return `${user.firstName} ${user.lastName}`.trim();
  }

  /**
   * Get user's initials
   */
  getUserInitials(): string {
    const user = this.getCurrentUser();
    if (!user) return '';

    const firstInitial = user.firstName?.charAt(0)?.toUpperCase() || '';
    const lastInitial = user.lastName?.charAt(0)?.toUpperCase() || '';
    
    return `${firstInitial}${lastInitial}`;
  }

  /**
   * Clear all authentication data
   */
  clearAuthData(): void {
    tokenStorage.clearAll();
  }

  /**
   * Validate session and refresh token if needed
   */
  async validateSession(): Promise<boolean> {
    try {
      if (!this.isAuthenticated()) {
        return false;
      }

      if (this.isTokenExpired()) {
        await this.refreshToken();
      }

      // Verify token with server
      await this.getProfile();
      return true;
    } catch (error) {
      console.error('Session validation failed:', error);
      this.clearAuthData();
      return false;
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const authService = AuthService.getInstance();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export const login = (credentials: LoginCredentials): Promise<LoginResponse> =>
  authService.login(credentials);

export const register = (data: RegisterData): Promise<RegisterResponse> =>
  authService.register(data);

export const logout = (): Promise<void> => authService.logout();

export const refreshToken = (): Promise<RefreshTokenResponse> =>
  authService.refreshToken();

export const getProfile = (): Promise<User> => authService.getProfile();

export const updateProfile = (data: UpdateProfileRequest): Promise<User> =>
  authService.updateProfile(data);

export const changePassword = (data: ChangePasswordRequest): Promise<void> =>
  authService.changePassword(data);

export const isAuthenticated = (): boolean => authService.isAuthenticated();

export const getCurrentUser = (): User | null => authService.getCurrentUser();

export const hasPermission = (permission: string): boolean =>
  authService.hasPermission(permission);

export const hasRole = (role: string): boolean => authService.hasRole(role);

export const hasAnyRole = (roles: string[]): boolean =>
  authService.hasAnyRole(roles);

// ============================================================================
// EXPORTS
// ============================================================================

export default authService;