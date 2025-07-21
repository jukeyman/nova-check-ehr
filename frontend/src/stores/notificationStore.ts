import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../services/api';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'APPOINTMENT' | 'MESSAGE' | 'SYSTEM';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  read: boolean;
  actionUrl?: string;
  actionLabel?: string;
  metadata?: Record<string, any>;
  userId: string;
  createdAt: string;
  readAt?: string;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  
  // Actions
  fetchNotifications: () => Promise<void>;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  addNotification: (notification: Notification) => void;
  updateNotification: (notificationId: string, updates: Partial<Notification>) => void;
  clearNotifications: () => void;
  
  // Real-time updates
  handleSocketNotification: (notification: Notification) => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [],
      unreadCount: 0,
      isLoading: false,

      fetchNotifications: async () => {
        try {
          set({ isLoading: true });
          const response = await api.get('/notifications');
          const notifications = response.data.notifications || [];
          const unreadCount = notifications.filter((n: Notification) => !n.read).length;
          
          set({
            notifications,
            unreadCount,
            isLoading: false,
          });
        } catch (error) {
          console.error('Failed to fetch notifications:', error);
          set({ isLoading: false });
        }
      },

      markAsRead: async (notificationId: string) => {
        try {
          await api.put(`/notifications/${notificationId}/read`);
          
          set((state) => {
            const notifications = state.notifications.map(notification =>
              notification.id === notificationId
                ? { ...notification, read: true, readAt: new Date().toISOString() }
                : notification
            );
            const unreadCount = notifications.filter(n => !n.read).length;
            
            return {
              notifications,
              unreadCount,
            };
          });
        } catch (error) {
          console.error('Failed to mark notification as read:', error);
        }
      },

      markAllAsRead: async () => {
        try {
          await api.put('/notifications/read-all');
          
          set((state) => ({
            notifications: state.notifications.map(notification => ({
              ...notification,
              read: true,
              readAt: new Date().toISOString(),
            })),
            unreadCount: 0,
          }));
        } catch (error) {
          console.error('Failed to mark all notifications as read:', error);
        }
      },

      deleteNotification: async (notificationId: string) => {
        try {
          await api.delete(`/notifications/${notificationId}`);
          
          set((state) => {
            const notifications = state.notifications.filter(n => n.id !== notificationId);
            const unreadCount = notifications.filter(n => !n.read).length;
            
            return {
              notifications,
              unreadCount,
            };
          });
        } catch (error) {
          console.error('Failed to delete notification:', error);
        }
      },

      addNotification: (notification: Notification) => {
        set((state) => {
          const notifications = [notification, ...state.notifications];
          const unreadCount = notifications.filter(n => !n.read).length;
          
          return {
            notifications,
            unreadCount,
          };
        });
      },

      updateNotification: (notificationId: string, updates: Partial<Notification>) => {
        set((state) => {
          const notifications = state.notifications.map(notification =>
            notification.id === notificationId
              ? { ...notification, ...updates }
              : notification
          );
          const unreadCount = notifications.filter(n => !n.read).length;
          
          return {
            notifications,
            unreadCount,
          };
        });
      },

      clearNotifications: () => {
        set({
          notifications: [],
          unreadCount: 0,
        });
      },

      handleSocketNotification: (notification: Notification) => {
        // Add new notification from socket
        get().addNotification(notification);
        
        // Show browser notification if permission granted
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(notification.title, {
            body: notification.message,
            icon: '/favicon.ico',
            tag: notification.id,
          });
        }
      },
    }),
    {
      name: 'notification-storage',
      partialize: (state) => ({
        notifications: state.notifications.slice(0, 50), // Keep only recent 50 notifications
        unreadCount: state.unreadCount,
      }),
    }
  )
);

// Request notification permission on app start
if (typeof window !== 'undefined' && 'Notification' in window) {
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}