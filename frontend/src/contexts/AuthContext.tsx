import React, { createContext, useContext, useEffect, useCallback, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { tokenStorage } from '@/utils/tokenStorage';
import { ApiError } from '@/types/api';
import type { User, LoginCredentials, RegisterData, AuthResponse } from '@/types/auth';

// ============================================================================
// TYPES
// ============================================================================

export interface AuthContextValue {
  // State
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  requiresTwoFactor: boolean;
  
  // Actions
  login: (credentials: LoginCredentials) => Promise<AuthResponse>;
  register: (data: RegisterData) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  verifyTwoFactor: (code: string) => Promise<AuthResponse>;
  refreshToken: () => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<User>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  clearError: () => void;
  
  // Utility
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  hasAllPermissions: (permissions: string[]) => boolean;
  isSessionExpired: () => boolean;
}

// ============================================================================
// CONTEXT CREATION
// ============================================================================

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ============================================================================
// HOOK FOR USING AUTH CONTEXT
// ============================================================================

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  
  return context;
};

// ============================================================================
// PERMISSION UTILITIES
// ============================================================================

const createPermissionHelpers = (user: User | null) => {
  const userPermissions = user?.permissions || [];
  const userRoles = user?.roles || [];
  
  return {
    hasPermission: (permission: string): boolean => {
      return userPermissions.includes(permission);
    },
    
    hasRole: (role: string): boolean => {
      return userRoles.some(userRole => userRole.name === role);
    },
    
    hasAnyPermission: (permissions: string[]): boolean => {
      return permissions.some(permission => userPermissions.includes(permission));
    },
    
    hasAllPermissions: (permissions: string[]): boolean => {
      return permissions.every(permission => userPermissions.includes(permission));
    },
  };
};

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

const useSessionManagement = () => {
  const { updateLastActivity, checkSessionExpiry, logout } = useAuthStore();
  
  // Update activity on user interactions
  const handleUserActivity = useCallback(() => {
    updateLastActivity();
  }, [updateLastActivity]);
  
  // Check for session expiry
  const checkAndHandleExpiry = useCallback(async () => {
    if (checkSessionExpiry()) {
      console.warn('Session expired, logging out user');
      await logout();
    }
  }, [checkSessionExpiry, logout]);
  
  useEffect(() => {
    const events = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click',
    ];
    
    // Add activity listeners
    events.forEach(event => {
      document.addEventListener(event, handleUserActivity, true);
    });
    
    // Set up session expiry check interval
    const expiryCheckInterval = setInterval(checkAndHandleExpiry, 60000); // Check every minute
    
    return () => {
      // Remove activity listeners
      events.forEach(event => {
        document.removeEventListener(event, handleUserActivity, true);
      });
      
      // Clear interval
      clearInterval(expiryCheckInterval);
    };
  }, [handleUserActivity, checkAndHandleExpiry]);
  
  return {
    isSessionExpired: checkSessionExpiry,
  };
};

// ============================================================================
// TOKEN REFRESH MANAGEMENT
// ============================================================================

const useTokenRefresh = () => {
  const { refreshToken, isAuthenticated, logout } = useAuthStore();
  
  // Set up automatic token refresh
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    
    const refreshInterval = setInterval(async () => {
      try {
        const accessToken = tokenStorage.getAccessToken();
        
        if (!accessToken) {
          return;
        }
        
        // Check if token is close to expiry (decode JWT to check exp)
        try {
          const payload = JSON.parse(atob(accessToken.split('.')[1]));
          const expiryTime = payload.exp * 1000; // Convert to milliseconds
          const currentTime = Date.now();
          const timeUntilExpiry = expiryTime - currentTime;
          
          // Refresh if token expires within 5 minutes
          if (timeUntilExpiry <= 5 * 60 * 1000) {
            await refreshToken();
          }
        } catch (error) {
          console.error('Error parsing token:', error);
          // If we can't parse the token, try to refresh anyway
          await refreshToken();
        }
      } catch (error) {
        console.error('Token refresh failed:', error);
        // If refresh fails, logout the user
        await logout();
      }
    }, 4 * 60 * 1000); // Check every 4 minutes
    
    return () => {
      clearInterval(refreshInterval);
    };
  }, [isAuthenticated, refreshToken, logout]);
};

// ============================================================================
// ERROR HANDLING
// ============================================================================

const useErrorHandling = () => {
  const { error, clearError } = useAuthStore();
  
  // Auto-clear errors after a timeout
  useEffect(() => {
    if (error) {
      const timeout = setTimeout(() => {
        clearError();
      }, 10000); // Clear error after 10 seconds
      
      return () => {
        clearTimeout(timeout);
      };
    }
  }, [error, clearError]);
};

// ============================================================================
// AUTH PROVIDER COMPONENT
// ============================================================================

export interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const authStore = useAuthStore();
  const sessionManagement = useSessionManagement();
  
  // Set up token refresh
  useTokenRefresh();
  
  // Set up error handling
  useErrorHandling();
  
  // Initialize authentication on mount
  useEffect(() => {
    if (!authStore.isInitialized) {
      authStore.initializeAuth();
    }
  }, [authStore.isInitialized, authStore.initializeAuth]);
  
  // Create permission helpers
  const permissionHelpers = useMemo(
    () => createPermissionHelpers(authStore.user),
    [authStore.user]
  );
  
  // Enhanced logout with cleanup
  const enhancedLogout = useCallback(async () => {
    try {
      await authStore.logout();
      
      // Clear any cached data
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(cacheName => caches.delete(cacheName))
        );
      }
      
      // Clear local storage (except theme preferences)
      const keysToKeep = ['nova-check-theme'];
      const allKeys = Object.keys(localStorage);
      
      allKeys.forEach(key => {
        if (!keysToKeep.some(keepKey => key.includes(keepKey))) {
          localStorage.removeItem(key);
        }
      });
      
      // Clear session storage
      sessionStorage.clear();
      
    } catch (error) {
      console.error('Enhanced logout failed:', error);
      // Force logout even if cleanup fails
      tokenStorage.clearTokens();
      authStore.setUser(null);
    }
  }, [authStore]);
  
  // Enhanced login with error handling
  const enhancedLogin = useCallback(async (credentials: LoginCredentials) => {
    try {
      const response = await authStore.login(credentials);
      
      // Log successful login (without sensitive data)
      console.log('User logged in successfully:', {
        userId: response.user?.id,
        email: response.user?.email,
        roles: response.user?.roles?.map(role => role.name),
      });
      
      return response;
    } catch (error) {
      const apiError = error as ApiError;
      
      // Log failed login attempt (without sensitive data)
      console.warn('Login failed:', {
        email: credentials.email,
        error: apiError.message,
        code: apiError.code,
      });
      
      throw error;
    }
  }, [authStore]);
  
  // Enhanced register with error handling
  const enhancedRegister = useCallback(async (data: RegisterData) => {
    try {
      const response = await authStore.register(data);
      
      // Log successful registration (without sensitive data)
      console.log('User registered successfully:', {
        userId: response.user?.id,
        email: response.user?.email,
      });
      
      return response;
    } catch (error) {
      const apiError = error as ApiError;
      
      // Log failed registration attempt (without sensitive data)
      console.warn('Registration failed:', {
        email: data.email,
        error: apiError.message,
        code: apiError.code,
      });
      
      throw error;
    }
  }, [authStore]);
  
  // Context value
  const contextValue: AuthContextValue = useMemo(
    () => ({
      // State
      user: authStore.user,
      isAuthenticated: authStore.isAuthenticated,
      isLoading: authStore.isLoading,
      isInitialized: authStore.isInitialized,
      error: authStore.error,
      requiresTwoFactor: authStore.requiresTwoFactor,
      
      // Enhanced actions
      login: enhancedLogin,
      register: enhancedRegister,
      logout: enhancedLogout,
      
      // Direct store actions
      verifyTwoFactor: authStore.verifyTwoFactor,
      refreshToken: authStore.refreshToken,
      updateProfile: authStore.updateProfile,
      changePassword: authStore.changePassword,
      forgotPassword: authStore.forgotPassword,
      resetPassword: authStore.resetPassword,
      verifyEmail: authStore.verifyEmail,
      resendVerificationEmail: authStore.resendVerificationEmail,
      clearError: authStore.clearError,
      
      // Permission helpers
      ...permissionHelpers,
      
      // Session management
      isSessionExpired: sessionManagement.isSessionExpired,
    }),
    [
      authStore.user,
      authStore.isAuthenticated,
      authStore.isLoading,
      authStore.isInitialized,
      authStore.error,
      authStore.requiresTwoFactor,
      enhancedLogin,
      enhancedRegister,
      enhancedLogout,
      authStore.verifyTwoFactor,
      authStore.refreshToken,
      authStore.updateProfile,
      authStore.changePassword,
      authStore.forgotPassword,
      authStore.resetPassword,
      authStore.verifyEmail,
      authStore.resendVerificationEmail,
      authStore.clearError,
      permissionHelpers,
      sessionManagement.isSessionExpired,
    ]
  );
  
  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

// ============================================================================
// HIGHER-ORDER COMPONENT FOR AUTHENTICATION
// ============================================================================

export const withAuth = <P extends object>(
  Component: React.ComponentType<P>,
  allowedRoles?: string[]
) => {
  const AuthenticatedComponent = (props: P) => {
    const { user, isAuthenticated, isLoading } = useAuth();
    
    if (isLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
        </div>
      );
    }
    
    if (!isAuthenticated) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h2>
            <p className="text-gray-600">Please log in to access this page.</p>
          </div>
        </div>
      );
    }
    
    if (allowedRoles && user && !allowedRoles.includes(user.role)) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h2>
            <p className="text-gray-600">You don't have permission to access this page.</p>
          </div>
        </div>
      );
    }
    
    return <Component {...props} />;
  };
  
  AuthenticatedComponent.displayName = `withAuth(${Component.displayName || Component.name})`;
  
  return AuthenticatedComponent;
};

// ============================================================================
// PERMISSION HOOKS
// ============================================================================

export const usePermissions = () => {
  const { user } = useAuth();

  const hasRole = (role: string): boolean => {
    return user?.role === role;
  };

  const hasAnyRole = (roles: string[]): boolean => {
    return user ? roles.includes(user.role) : false;
  };

  const canAccessPatientData = (patientId?: string): boolean => {
    if (!user) return false;
    
    // Super admin and admin can access all patient data
    if (['SUPER_ADMIN', 'ADMIN'].includes(user.role)) {
      return true;
    }
    
    // Patients can only access their own data
    if (user.role === 'PATIENT') {
      return user.id === patientId;
    }
    
    // Providers can access patient data if they're in the care team
    if (user.role === 'PROVIDER') {
      // This would need to be checked against the care team data
      // For now, we'll allow all providers to access patient data
      return true;
    }
    
    return false;
  };

  const canManageUsers = (): boolean => {
    return ['SUPER_ADMIN', 'ADMIN'].includes(user?.role || '');
  };

  const canManageSystem = (): boolean => {
    return user?.role === 'SUPER_ADMIN';
  };

  const canCreateAppointments = (): boolean => {
    return ['SUPER_ADMIN', 'ADMIN', 'PROVIDER', 'PATIENT'].includes(user?.role || '');
  };

  const canManageAppointments = (): boolean => {
    return ['SUPER_ADMIN', 'ADMIN', 'PROVIDER'].includes(user?.role || '');
  };

  const canAccessBilling = (): boolean => {
    return ['SUPER_ADMIN', 'ADMIN', 'PROVIDER'].includes(user?.role || '');
  };

  const canAccessReports = (): boolean => {
    return ['SUPER_ADMIN', 'ADMIN', 'PROVIDER'].includes(user?.role || '');
  };

  return {
    user,
    hasRole,
    hasAnyRole,
    canAccessPatientData,
    canManageUsers,
    canManageSystem,
    canCreateAppointments,
    canManageAppointments,
    canAccessBilling,
    canAccessReports,
  };
};

// ============================================================================
// EXPORTS
// ============================================================================

export default AuthContext;