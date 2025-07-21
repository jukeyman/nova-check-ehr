import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeStore } from '@/stores/themeStore';
import { tokenStorage } from '@/utils/tokenStorage';
import toast from 'react-hot-toast';

// ============================================================================
// TYPES
// ============================================================================

export interface SocketContextValue {
  // Connection State
  socket: Socket | null;
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  
  // Actions
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;
  
  // Event Handlers
  on: (event: string, handler: (...args: any[]) => void) => void;
  off: (event: string, handler?: (...args: any[]) => void) => void;
  emit: (event: string, ...args: any[]) => void;
  
  // Room Management
  joinRoom: (room: string) => void;
  leaveRoom: (room: string) => void;
  
  // Utility
  getConnectionStats: () => SocketStats;
}

export interface SocketStats {
  connected: boolean;
  connectTime: Date | null;
  disconnectTime: Date | null;
  reconnectAttempts: number;
  lastPing: number | null;
  transport: string | null;
}

// Real-time event types
export interface SocketEvents {
  // Patient Events
  'patient:created': (patient: any) => void;
  'patient:updated': (patient: any) => void;
  'patient:deleted': (patientId: string) => void;
  
  // Appointment Events
  'appointment:created': (appointment: any) => void;
  'appointment:updated': (appointment: any) => void;
  'appointment:cancelled': (appointmentId: string) => void;
  'appointment:reminder': (appointment: any) => void;
  
  // Provider Events
  'provider:status_changed': (provider: any) => void;
  'provider:schedule_updated': (provider: any) => void;
  
  // Medical Record Events
  'medical_record:updated': (record: any) => void;
  'lab_result:available': (result: any) => void;
  'imaging_result:available': (result: any) => void;
  
  // Billing Events
  'invoice:created': (invoice: any) => void;
  'payment:received': (payment: any) => void;
  'insurance:claim_updated': (claim: any) => void;
  
  // System Events
  'system:maintenance': (maintenance: any) => void;
  'system:alert': (alert: any) => void;
  'system:notification': (notification: any) => void;
  
  // User Events
  'user:online': (userId: string) => void;
  'user:offline': (userId: string) => void;
  'user:typing': (data: { userId: string; room: string }) => void;
  
  // Chat Events
  'message:new': (message: any) => void;
  'message:read': (messageId: string) => void;
  
  // Connection Events
  'connect': () => void;
  'disconnect': (reason: string) => void;
  'connect_error': (error: Error) => void;
  'reconnect': (attemptNumber: number) => void;
  'reconnect_attempt': (attemptNumber: number) => void;
  'reconnect_error': (error: Error) => void;
  'reconnect_failed': () => void;
}

// ============================================================================
// CONTEXT CREATION
// ============================================================================

const SocketContext = createContext<SocketContextValue | undefined>(undefined);

// ============================================================================
// HOOK FOR USING SOCKET CONTEXT
// ============================================================================

export const useSocket = (): SocketContextValue => {
  const context = useContext(SocketContext);
  
  if (context === undefined) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  
  return context;
};

// ============================================================================
// SOCKET CONFIGURATION
// ============================================================================

const getSocketConfig = (token: string | null) => {
  const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
  
  return {
    url: baseURL,
    options: {
      auth: {
        token,
      },
      transports: ['websocket', 'polling'],
      upgrade: true,
      rememberUpgrade: true,
      timeout: 20000,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      maxReconnectionAttempts: 5,
      randomizationFactor: 0.5,
      forceNew: false,
      autoConnect: false,
    },
  };
};

// ============================================================================
// SOCKET PROVIDER COMPONENT
// ============================================================================

export interface SocketProviderProps {
  children: React.ReactNode;
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();
  const { soundEnabled } = useThemeStore();
  
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [stats, setStats] = useState<SocketStats>({
    connected: false,
    connectTime: null,
    disconnectTime: null,
    reconnectAttempts: 0,
    lastPing: null,
    transport: null,
  });
  
  // Refs
  const socketRef = useRef<Socket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // ========================================================================
  // CONNECTION MANAGEMENT
  // ========================================================================
  
  const connect = useCallback(() => {
    if (socketRef.current?.connected || isConnecting || !isAuthenticated) {
      return;
    }
    
    setIsConnecting(true);
    setConnectionError(null);
    
    const token = tokenStorage.getAccessToken();
    const { url, options } = getSocketConfig(token);
    
    try {
      socketRef.current = io(url, options);
      const socket = socketRef.current;
      
      // Connection event handlers
      socket.on('connect', () => {
        console.log('Socket connected:', socket.id);
        setIsConnected(true);
        setIsConnecting(false);
        setConnectionError(null);
        setStats(prev => ({
          ...prev,
          connected: true,
          connectTime: new Date(),
          transport: socket.io.engine.transport.name,
          reconnectAttempts: 0,
        }));
        
        // Join user-specific room
        if (user?.id) {
          socket.emit('join:user', user.id);
        }
        
        // Start ping monitoring
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        
        pingIntervalRef.current = setInterval(() => {
          const start = Date.now();
          socket.emit('ping', start, (response: number) => {
            const ping = Date.now() - start;
            setStats(prev => ({ ...prev, lastPing: ping }));
          });
        }, 30000); // Ping every 30 seconds
      });
      
      socket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        setIsConnected(false);
        setIsConnecting(false);
        setStats(prev => ({
          ...prev,
          connected: false,
          disconnectTime: new Date(),
        }));
        
        // Clear ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        
        // Show notification for unexpected disconnections
        if (reason === 'io server disconnect' || reason === 'transport close') {
          toast.error('Connection lost. Attempting to reconnect...');
        }
      });
      
      socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        setIsConnecting(false);
        setConnectionError(error.message);
        
        // Show error notification
        toast.error(`Connection failed: ${error.message}`);
      });
      
      socket.on('reconnect', (attemptNumber) => {
        console.log('Socket reconnected after', attemptNumber, 'attempts');
        toast.success('Connection restored!');
        setStats(prev => ({ ...prev, reconnectAttempts: attemptNumber }));
      });
      
      socket.on('reconnect_attempt', (attemptNumber) => {
        console.log('Socket reconnection attempt:', attemptNumber);
        setStats(prev => ({ ...prev, reconnectAttempts: attemptNumber }));
      });
      
      socket.on('reconnect_error', (error) => {
        console.error('Socket reconnection error:', error);
      });
      
      socket.on('reconnect_failed', () => {
        console.error('Socket reconnection failed');
        setConnectionError('Failed to reconnect after multiple attempts');
        toast.error('Unable to restore connection. Please refresh the page.');
      });
      
      // Transport upgrade
      socket.io.on('upgrade', () => {
        setStats(prev => ({
          ...prev,
          transport: socket.io.engine.transport.name,
        }));
      });
      
      // Connect the socket
      socket.connect();
      
    } catch (error) {
      console.error('Failed to create socket:', error);
      setIsConnecting(false);
      setConnectionError('Failed to initialize connection');
    }
  }, [isAuthenticated, user?.id, isConnecting]);
  
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    
    setIsConnected(false);
    setIsConnecting(false);
    setConnectionError(null);
  }, []);
  
  const reconnect = useCallback(() => {
    disconnect();
    
    // Delay reconnection to avoid rapid reconnection attempts
    reconnectTimeoutRef.current = setTimeout(() => {
      connect();
    }, 1000);
  }, [disconnect, connect]);
  
  // ========================================================================
  // EVENT HANDLERS
  // ========================================================================
  
  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    if (socketRef.current) {
      socketRef.current.on(event, handler);
    }
  }, []);
  
  const off = useCallback((event: string, handler?: (...args: any[]) => void) => {
    if (socketRef.current) {
      if (handler) {
        socketRef.current.off(event, handler);
      } else {
        socketRef.current.off(event);
      }
    }
  }, []);
  
  const emit = useCallback((event: string, ...args: any[]) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, ...args);
    } else {
      console.warn('Socket not connected, cannot emit event:', event);
    }
  }, []);
  
  // ========================================================================
  // ROOM MANAGEMENT
  // ========================================================================
  
  const joinRoom = useCallback((room: string) => {
    emit('join:room', room);
  }, [emit]);
  
  const leaveRoom = useCallback((room: string) => {
    emit('leave:room', room);
  }, [emit]);
  
  // ========================================================================
  // UTILITY FUNCTIONS
  // ========================================================================
  
  const getConnectionStats = useCallback((): SocketStats => {
    return { ...stats };
  }, [stats]);
  
  // ========================================================================
  // EFFECTS
  // ========================================================================
  
  // Connect/disconnect based on authentication
  useEffect(() => {
    if (isAuthenticated) {
      connect();
    } else {
      disconnect();
    }
    
    return () => {
      disconnect();
    };
  }, [isAuthenticated, connect, disconnect]);
  
  // Set up global event listeners for real-time notifications
  useEffect(() => {
    if (!socketRef.current) return;
    
    const socket = socketRef.current;
    
    // System notifications
    const handleSystemNotification = (notification: any) => {
      toast(notification.message, {
        icon: notification.type === 'error' ? '❌' : notification.type === 'warning' ? '⚠️' : 'ℹ️',
        duration: notification.duration || 4000,
      });
      
      if (soundEnabled && notification.sound) {
        // Play notification sound
        const audio = new Audio('/sounds/notification.mp3');
        audio.play().catch(() => {
          // Ignore audio play errors
        });
      }
    };
    
    // Appointment reminders
    const handleAppointmentReminder = (appointment: any) => {
      toast(`Upcoming appointment: ${appointment.patientName}`, {
        icon: '📅',
        duration: 6000,
      });
      
      if (soundEnabled) {
        const audio = new Audio('/sounds/reminder.mp3');
        audio.play().catch(() => {});
      }
    };
    
    // Lab results
    const handleLabResult = (result: any) => {
      toast(`New lab result available for ${result.patientName}`, {
        icon: '🧪',
        duration: 5000,
      });
    };
    
    // Register event listeners
    socket.on('system:notification', handleSystemNotification);
    socket.on('appointment:reminder', handleAppointmentReminder);
    socket.on('lab_result:available', handleLabResult);
    
    return () => {
      socket.off('system:notification', handleSystemNotification);
      socket.off('appointment:reminder', handleAppointmentReminder);
      socket.off('lab_result:available', handleLabResult);
    };
  }, [soundEnabled]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);
  
  // ========================================================================
  // CONTEXT VALUE
  // ========================================================================
  
  const contextValue: SocketContextValue = useMemo(
    () => ({
      socket: socketRef.current,
      isConnected,
      isConnecting,
      connectionError,
      connect,
      disconnect,
      reconnect,
      on,
      off,
      emit,
      joinRoom,
      leaveRoom,
      getConnectionStats,
    }),
    [
      isConnected,
      isConnecting,
      connectionError,
      connect,
      disconnect,
      reconnect,
      on,
      off,
      emit,
      joinRoom,
      leaveRoom,
      getConnectionStats,
    ]
  );
  
  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
};

// ============================================================================
// CUSTOM HOOKS FOR SPECIFIC SOCKET EVENTS
// ============================================================================

// Hook for listening to specific events
export const useSocketEvent = <T = any>(
  event: string,
  handler: (data: T) => void,
  deps: React.DependencyList = []
) => {
  const { on, off } = useSocket();
  
  useEffect(() => {
    on(event, handler);
    
    return () => {
      off(event, handler);
    };
  }, [event, handler, on, off, ...deps]);
};

// Hook for emitting events
export const useSocketEmit = () => {
  const { emit } = useSocket();
  return emit;
};

// Hook for room management
export const useSocketRoom = (room: string) => {
  const { joinRoom, leaveRoom } = useSocket();
  
  useEffect(() => {
    if (room) {
      joinRoom(room);
      
      return () => {
        leaveRoom(room);
      };
    }
  }, [room, joinRoom, leaveRoom]);
};

// ============================================================================
// EXPORTS
// ============================================================================

export default SocketContext;