import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../services/api';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'PATIENT' | 'PROVIDER' | 'ADMIN' | 'SUPER_ADMIN';
  profilePicture?: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  address?: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  emergencyContact?: {
    name: string;
    relationship: string;
    phone: string;
  };
  preferences?: {
    language: string;
    timezone: string;
    notifications: {
      email: boolean;
      sms: boolean;
      push: boolean;
    };
  };
  isActive: boolean;
  isVerified: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (userData: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (userData: Partial<User>) => Promise<void>;
  refreshToken: () => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'PATIENT' | 'PROVIDER';
  phone?: string;
  dateOfBirth?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,
      isAuthenticated: false,

      login: async (email: string, password: string) => {
        try {
          set({ isLoading: true });
          const response = await api.post('/auth/login', { email, password });
          const { user, token } = response.data;
          
          // Set authorization header for future requests
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
          
          set({
            user,
            token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error: any) {
          set({ isLoading: false });
          throw new Error(error.response?.data?.message || 'Login failed');
        }
      },

      register: async (userData: RegisterData) => {
        try {
          set({ isLoading: true });
          const response = await api.post('/auth/register', userData);
          const { user, token } = response.data;
          
          // Set authorization header for future requests
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
          
          set({
            user,
            token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error: any) {
          set({ isLoading: false });
          throw new Error(error.response?.data?.message || 'Registration failed');
        }
      },

      logout: async () => {
        try {
          const { token } = get();
          if (token) {
            await api.post('/auth/logout');
          }
        } catch (error) {
          console.error('Logout error:', error);
        } finally {
          // Clear authorization header
          delete api.defaults.headers.common['Authorization'];
          
          set({
            user: null,
            token: null,
            isAuthenticated: false,
          });
        }
      },

      updateUser: async (userData: Partial<User>) => {
        try {
          set({ isLoading: true });
          const response = await api.put('/auth/profile', userData);
          const updatedUser = response.data;
          
          set({
            user: updatedUser,
            isLoading: false,
          });
        } catch (error: any) {
          set({ isLoading: false });
          throw new Error(error.response?.data?.message || 'Profile update failed');
        }
      },

      refreshToken: async () => {
        try {
          const response = await api.post('/auth/refresh');
          const { token } = response.data;
          
          // Update authorization header
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
          
          set({ token });
        } catch (error) {
          // If refresh fails, logout user
          get().logout();
          throw error;
        }
      },

      forgotPassword: async (email: string) => {
        try {
          await api.post('/auth/forgot-password', { email });
        } catch (error: any) {
          throw new Error(error.response?.data?.message || 'Failed to send reset email');
        }
      },

      resetPassword: async (token: string, password: string) => {
        try {
          await api.post('/auth/reset-password', { token, password });
        } catch (error: any) {
          throw new Error(error.response?.data?.message || 'Password reset failed');
        }
      },

      verifyEmail: async (token: string) => {
        try {
          const response = await api.post('/auth/verify-email', { token });
          const { user } = response.data;
          
          set({ user });
        } catch (error: any) {
          throw new Error(error.response?.data?.message || 'Email verification failed');
        }
      },

      resendVerification: async () => {
        try {
          await api.post('/auth/resend-verification');
        } catch (error: any) {
          throw new Error(error.response?.data?.message || 'Failed to resend verification');
        }
      },

      checkAuth: async () => {
        try {
          const { token } = get();
          if (!token) {
            return;
          }
          
          // Set authorization header
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
          
          const response = await api.get('/auth/me');
          const user = response.data;
          
          set({
            user,
            isAuthenticated: true,
          });
        } catch (error) {
          // If check fails, logout user
          get().logout();
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// Initialize auth check on app start
if (typeof window !== 'undefined') {
  const { token } = useAuthStore.getState();
  if (token) {
    useAuthStore.getState().checkAuth();
  }
}