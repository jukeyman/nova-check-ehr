import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { tokenStorage } from '@/utils/tokenStorage';
import toast from 'react-hot-toast';

// ============================================================================
// TYPES
// ============================================================================

export interface ApiResponse<T = any> {
  data: T;
  message?: string;
  success: boolean;
  errors?: string[];
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface ApiError {
  message: string;
  status: number;
  code?: string;
  errors?: string[];
  details?: any;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  filters?: Record<string, any>;
}

export interface RequestConfig extends AxiosRequestConfig {
  skipAuth?: boolean;
  skipErrorHandling?: boolean;
  showSuccessToast?: boolean;
  successMessage?: string;
}

// ============================================================================
// API CONFIGURATION
// ============================================================================

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const API_VERSION = '/api/v1';
const REQUEST_TIMEOUT = 30000; // 30 seconds

// ============================================================================
// AXIOS INSTANCE CREATION
// ============================================================================

const createApiInstance = (): AxiosInstance => {
  const instance = axios.create({
    baseURL: `${API_BASE_URL}${API_VERSION}`,
    timeout: REQUEST_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });

  // Request interceptor for adding auth token
  instance.interceptors.request.use(
    (config) => {
      // Skip auth for certain endpoints
      if (config.skipAuth) {
        return config;
      }

      const token = tokenStorage.getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      // Add request timestamp for debugging
      config.metadata = {
        startTime: Date.now(),
      };

      return config;
    },
    (error) => {
      console.error('Request interceptor error:', error);
      return Promise.reject(error);
    }
  );

  // Response interceptor for handling responses and errors
  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      // Log response time for debugging
      const endTime = Date.now();
      const startTime = response.config.metadata?.startTime || endTime;
      const duration = endTime - startTime;
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`API Request: ${response.config.method?.toUpperCase()} ${response.config.url} - ${duration}ms`);
      }

      // Show success toast if requested
      if (response.config.showSuccessToast) {
        const message = response.config.successMessage || response.data?.message || 'Operation successful';
        toast.success(message);
      }

      return response;
    },
    async (error: AxiosError) => {
      const originalRequest = error.config as RequestConfig & { _retry?: boolean };

      // Handle network errors
      if (!error.response) {
        console.error('Network error:', error.message);
        
        if (!originalRequest?.skipErrorHandling) {
          toast.error('Network error. Please check your connection.');
        }
        
        return Promise.reject({
          message: 'Network error',
          status: 0,
          code: 'NETWORK_ERROR',
        } as ApiError);
      }

      const { status, data } = error.response;

      // Handle token refresh for 401 errors
      if (status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;

        try {
          const refreshToken = tokenStorage.getRefreshToken();
          if (refreshToken) {
            const response = await instance.post('/auth/refresh', {
              refreshToken,
            }, { skipAuth: true });

            const { accessToken, refreshToken: newRefreshToken } = response.data.data;
            
            tokenStorage.setTokens(accessToken, newRefreshToken);
            
            // Retry original request with new token
            originalRequest.headers.Authorization = `Bearer ${accessToken}`;
            return instance(originalRequest);
          }
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
          
          // Clear tokens and redirect to login
          tokenStorage.clearTokens();
          window.location.href = '/auth/login';
          
          return Promise.reject({
            message: 'Session expired. Please log in again.',
            status: 401,
            code: 'SESSION_EXPIRED',
          } as ApiError);
        }
      }

      // Handle other HTTP errors
      const apiError: ApiError = {
        message: data?.message || getDefaultErrorMessage(status),
        status,
        code: data?.code,
        errors: data?.errors,
        details: data?.details,
      };

      // Show error toast unless explicitly disabled
      if (!originalRequest?.skipErrorHandling) {
        const errorMessage = apiError.errors?.join(', ') || apiError.message;
        
        switch (status) {
          case 400:
            toast.error(`Invalid request: ${errorMessage}`);
            break;
          case 403:
            toast.error('Access denied. You do not have permission to perform this action.');
            break;
          case 404:
            toast.error('Resource not found.');
            break;
          case 409:
            toast.error(`Conflict: ${errorMessage}`);
            break;
          case 422:
            toast.error(`Validation error: ${errorMessage}`);
            break;
          case 429:
            toast.error('Too many requests. Please try again later.');
            break;
          case 500:
            toast.error('Server error. Please try again later.');
            break;
          case 503:
            toast.error('Service temporarily unavailable.');
            break;
          default:
            toast.error(errorMessage);
        }
      }

      console.error('API Error:', apiError);
      return Promise.reject(apiError);
    }
  );

  return instance;
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const getDefaultErrorMessage = (status: number): string => {
  switch (status) {
    case 400:
      return 'Bad request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not found';
    case 409:
      return 'Conflict';
    case 422:
      return 'Validation error';
    case 429:
      return 'Too many requests';
    case 500:
      return 'Internal server error';
    case 502:
      return 'Bad gateway';
    case 503:
      return 'Service unavailable';
    case 504:
      return 'Gateway timeout';
    default:
      return 'An error occurred';
  }
};

const buildQueryString = (params: Record<string, any>): string => {
  const searchParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        value.forEach(item => searchParams.append(key, String(item)));
      } else if (typeof value === 'object') {
        searchParams.append(key, JSON.stringify(value));
      } else {
        searchParams.append(key, String(value));
      }
    }
  });
  
  return searchParams.toString();
};

// ============================================================================
// API INSTANCE
// ============================================================================

const api = createApiInstance();

// ============================================================================
// API SERVICE CLASS
// ============================================================================

export class ApiService {
  private static instance: ApiService;
  private axiosInstance: AxiosInstance;

  private constructor() {
    this.axiosInstance = api;
  }

  public static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  // ========================================================================
  // GENERIC HTTP METHODS
  // ========================================================================

  async get<T = any>(
    url: string,
    params?: Record<string, any>,
    config?: RequestConfig
  ): Promise<ApiResponse<T>> {
    const queryString = params ? buildQueryString(params) : '';
    const fullUrl = queryString ? `${url}?${queryString}` : url;
    
    const response = await this.axiosInstance.get<ApiResponse<T>>(fullUrl, config);
    return response.data;
  }

  async post<T = any>(
    url: string,
    data?: any,
    config?: RequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.axiosInstance.post<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  async put<T = any>(
    url: string,
    data?: any,
    config?: RequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.axiosInstance.put<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  async patch<T = any>(
    url: string,
    data?: any,
    config?: RequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.axiosInstance.patch<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  async delete<T = any>(
    url: string,
    config?: RequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.axiosInstance.delete<ApiResponse<T>>(url, config);
    return response.data;
  }

  // ========================================================================
  // FILE UPLOAD METHODS
  // ========================================================================

  async uploadFile<T = any>(
    url: string,
    file: File,
    additionalData?: Record<string, any>,
    onUploadProgress?: (progressEvent: any) => void,
    config?: RequestConfig
  ): Promise<ApiResponse<T>> {
    const formData = new FormData();
    formData.append('file', file);
    
    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      });
    }

    const response = await this.axiosInstance.post<ApiResponse<T>>(url, formData, {
      ...config,
      headers: {
        ...config?.headers,
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress,
    });

    return response.data;
  }

  async uploadMultipleFiles<T = any>(
    url: string,
    files: File[],
    additionalData?: Record<string, any>,
    onUploadProgress?: (progressEvent: any) => void,
    config?: RequestConfig
  ): Promise<ApiResponse<T>> {
    const formData = new FormData();
    
    files.forEach((file, index) => {
      formData.append(`files[${index}]`, file);
    });
    
    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      });
    }

    const response = await this.axiosInstance.post<ApiResponse<T>>(url, formData, {
      ...config,
      headers: {
        ...config?.headers,
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress,
    });

    return response.data;
  }

  // ========================================================================
  // DOWNLOAD METHODS
  // ========================================================================

  async downloadFile(
    url: string,
    filename?: string,
    config?: RequestConfig
  ): Promise<void> {
    const response = await this.axiosInstance.get(url, {
      ...config,
      responseType: 'blob',
    });

    const blob = new Blob([response.data]);
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.href = downloadUrl;
    link.download = filename || 'download';
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  }

  // ========================================================================
  // PAGINATION HELPERS
  // ========================================================================

  async getPaginated<T = any>(
    url: string,
    params?: PaginationParams,
    config?: RequestConfig
  ): Promise<ApiResponse<T[]>> {
    const paginationParams = {
      page: params?.page || 1,
      limit: params?.limit || 20,
      sort: params?.sort,
      order: params?.order || 'desc',
      search: params?.search,
      ...params?.filters,
    };

    return this.get<T[]>(url, paginationParams, config);
  }

  // ========================================================================
  // BATCH OPERATIONS
  // ========================================================================

  async batchRequest<T = any>(
    requests: Array<{
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      url: string;
      data?: any;
      config?: RequestConfig;
    }>
  ): Promise<ApiResponse<T>[]> {
    const promises = requests.map(({ method, url, data, config }) => {
      switch (method) {
        case 'GET':
          return this.get<T>(url, data, config);
        case 'POST':
          return this.post<T>(url, data, config);
        case 'PUT':
          return this.put<T>(url, data, config);
        case 'PATCH':
          return this.patch<T>(url, data, config);
        case 'DELETE':
          return this.delete<T>(url, config);
        default:
          throw new Error(`Unsupported method: ${method}`);
      }
    });

    return Promise.all(promises);
  }

  // ========================================================================
  // HEALTH CHECK
  // ========================================================================

  async healthCheck(): Promise<ApiResponse<{ status: string; timestamp: string }>> {
    return this.get('/health', undefined, { skipAuth: true });
  }

  // ========================================================================
  // UTILITY METHODS
  // ========================================================================

  getBaseUrl(): string {
    return `${API_BASE_URL}${API_VERSION}`;
  }

  setAuthToken(token: string): void {
    this.axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  removeAuthToken(): void {
    delete this.axiosInstance.defaults.headers.common['Authorization'];
  }

  // Cancel all pending requests
  cancelAllRequests(): void {
    // This would require implementing a request tracking system
    // For now, we'll just log the action
    console.log('Cancelling all pending requests');
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const apiService = ApiService.getInstance();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export const get = <T = any>(
  url: string,
  params?: Record<string, any>,
  config?: RequestConfig
): Promise<ApiResponse<T>> => apiService.get<T>(url, params, config);

export const post = <T = any>(
  url: string,
  data?: any,
  config?: RequestConfig
): Promise<ApiResponse<T>> => apiService.post<T>(url, data, config);

export const put = <T = any>(
  url: string,
  data?: any,
  config?: RequestConfig
): Promise<ApiResponse<T>> => apiService.put<T>(url, data, config);

export const patch = <T = any>(
  url: string,
  data?: any,
  config?: RequestConfig
): Promise<ApiResponse<T>> => apiService.patch<T>(url, data, config);

export const del = <T = any>(
  url: string,
  config?: RequestConfig
): Promise<ApiResponse<T>> => apiService.delete<T>(url, config);

export const uploadFile = <T = any>(
  url: string,
  file: File,
  additionalData?: Record<string, any>,
  onUploadProgress?: (progressEvent: any) => void,
  config?: RequestConfig
): Promise<ApiResponse<T>> => 
  apiService.uploadFile<T>(url, file, additionalData, onUploadProgress, config);

export const downloadFile = (
  url: string,
  filename?: string,
  config?: RequestConfig
): Promise<void> => apiService.downloadFile(url, filename, config);

export const getPaginated = <T = any>(
  url: string,
  params?: PaginationParams,
  config?: RequestConfig
): Promise<ApiResponse<T[]>> => apiService.getPaginated<T>(url, params, config);

// ============================================================================
// EXPORTS
// ============================================================================

export default apiService;
export { api };