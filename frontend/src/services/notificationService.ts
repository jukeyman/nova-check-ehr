import { api } from './api';

export interface Notification {
  id: string;
  userId: string;
  type: 'APPOINTMENT' | 'MESSAGE' | 'REMINDER' | 'ALERT' | 'SYSTEM' | 'BILLING' | 'LAB_RESULT' | 'PRESCRIPTION' | 'TASK' | 'EMERGENCY';
  title: string;
  message: string;
  data?: Record<string, any>;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'UNREAD' | 'READ' | 'ARCHIVED' | 'DELETED';
  isActionable: boolean;
  actionUrl?: string;
  actionLabel?: string;
  expiresAt?: string;
  createdAt: string;
  readAt?: string;
  archivedAt?: string;
  deletedAt?: string;
  sender?: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
    avatar?: string;
  };
  relatedEntity?: {
    type: 'PATIENT' | 'APPOINTMENT' | 'MESSAGE' | 'TASK' | 'BILLING';
    id: string;
    name: string;
  };
}

export interface NotificationFilters {
  type?: string;
  priority?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  isActionable?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface NotificationsResponse {
  notifications: Notification[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  unreadCount: number;
}

export interface CreateNotificationData {
  userId?: string;
  userIds?: string[];
  type: Notification['type'];
  title: string;
  message: string;
  data?: Record<string, any>;
  priority?: Notification['priority'];
  isActionable?: boolean;
  actionUrl?: string;
  actionLabel?: string;
  expiresAt?: string;
  relatedEntity?: Notification['relatedEntity'];
}

export interface NotificationSettings {
  id: string;
  userId: string;
  emailNotifications: {
    appointments: boolean;
    messages: boolean;
    reminders: boolean;
    alerts: boolean;
    labResults: boolean;
    prescriptions: boolean;
    billing: boolean;
    system: boolean;
  };
  pushNotifications: {
    appointments: boolean;
    messages: boolean;
    reminders: boolean;
    alerts: boolean;
    labResults: boolean;
    prescriptions: boolean;
    billing: boolean;
    system: boolean;
  };
  smsNotifications: {
    appointments: boolean;
    reminders: boolean;
    alerts: boolean;
    emergencies: boolean;
  };
  quietHours: {
    enabled: boolean;
    startTime: string;
    endTime: string;
    timezone: string;
  };
  frequency: {
    digest: 'IMMEDIATE' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'NEVER';
    reminders: 'IMMEDIATE' | 'DAILY' | 'WEEKLY' | 'NEVER';
  };
  updatedAt: string;
}

export interface NotificationStats {
  total: number;
  unread: number;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
  byStatus: Record<string, number>;
  recentActivity: Array<{
    date: string;
    count: number;
  }>;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  type: Notification['type'];
  title: string;
  message: string;
  isActive: boolean;
  variables: Array<{
    name: string;
    description: string;
    required: boolean;
    defaultValue?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

class NotificationService {
  private baseUrl = '/api/notifications';

  async getNotifications(filters: NotificationFilters = {}): Promise<NotificationsResponse> {
    const params = new URLSearchParams();
    
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, value.toString());
      }
    });

    const queryString = params.toString();
    const url = queryString ? `${this.baseUrl}?${queryString}` : this.baseUrl;
    
    const response = await api.get(url);
    return response.data;
  }

  async getNotificationById(notificationId: string): Promise<Notification> {
    const response = await api.get(`${this.baseUrl}/${notificationId}`);
    return response.data;
  }

  async createNotification(data: CreateNotificationData): Promise<Notification> {
    const response = await api.post(this.baseUrl, data);
    return response.data;
  }

  async markAsRead(notificationIds: string[]): Promise<void> {
    await api.patch(`${this.baseUrl}/mark-read`, {
      notificationIds,
    });
  }

  async markAsUnread(notificationIds: string[]): Promise<void> {
    await api.patch(`${this.baseUrl}/mark-unread`, {
      notificationIds,
    });
  }

  async markAllAsRead(): Promise<void> {
    await api.patch(`${this.baseUrl}/mark-all-read`);
  }

  async archiveNotifications(notificationIds: string[]): Promise<void> {
    await api.patch(`${this.baseUrl}/archive`, {
      notificationIds,
    });
  }

  async unarchiveNotifications(notificationIds: string[]): Promise<void> {
    await api.patch(`${this.baseUrl}/unarchive`, {
      notificationIds,
    });
  }

  async deleteNotifications(notificationIds: string[]): Promise<void> {
    await api.delete(`${this.baseUrl}/batch`, {
      data: { notificationIds },
    });
  }

  async deleteNotification(notificationId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${notificationId}`);
  }

  async getUnreadCount(): Promise<number> {
    const response = await api.get(`${this.baseUrl}/unread-count`);
    return response.data.count;
  }

  async getNotificationStats(filters?: {
    dateFrom?: string;
    dateTo?: string;
  }): Promise<NotificationStats> {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined) {
          params.append(key, value);
        }
      });
    }

    const queryString = params.toString();
    const url = queryString ? `${this.baseUrl}/stats?${queryString}` : `${this.baseUrl}/stats`;
    
    const response = await api.get(url);
    return response.data;
  }

  async searchNotifications(query: string, filters?: {
    type?: string;
    priority?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<Notification[]> {
    const params = new URLSearchParams();
    params.append('q', query);
    
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined) {
          params.append(key, value);
        }
      });
    }

    const response = await api.get(`${this.baseUrl}/search?${params.toString()}`);
    return response.data;
  }

  async getNotificationSettings(): Promise<NotificationSettings> {
    const response = await api.get(`${this.baseUrl}/settings`);
    return response.data;
  }

  async updateNotificationSettings(settings: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const response = await api.put(`${this.baseUrl}/settings`, settings);
    return response.data;
  }

  async testNotification(type: Notification['type'], channel: 'email' | 'push' | 'sms'): Promise<void> {
    await api.post(`${this.baseUrl}/test`, {
      type,
      channel,
    });
  }

  async getTemplates(): Promise<NotificationTemplate[]> {
    const response = await api.get(`${this.baseUrl}/templates`);
    return response.data;
  }

  async getTemplateById(templateId: string): Promise<NotificationTemplate> {
    const response = await api.get(`${this.baseUrl}/templates/${templateId}`);
    return response.data;
  }

  async createTemplate(data: Omit<NotificationTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<NotificationTemplate> {
    const response = await api.post(`${this.baseUrl}/templates`, data);
    return response.data;
  }

  async updateTemplate(templateId: string, data: Partial<NotificationTemplate>): Promise<NotificationTemplate> {
    const response = await api.put(`${this.baseUrl}/templates/${templateId}`, data);
    return response.data;
  }

  async deleteTemplate(templateId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/templates/${templateId}`);
  }

  async sendFromTemplate(templateId: string, data: {
    userIds: string[];
    variables: Record<string, string>;
    priority?: Notification['priority'];
    expiresAt?: string;
  }): Promise<Notification[]> {
    const response = await api.post(`${this.baseUrl}/templates/${templateId}/send`, data);
    return response.data;
  }

  async scheduleNotification(data: CreateNotificationData & {
    scheduledFor: string;
    timezone?: string;
  }): Promise<{
    id: string;
    scheduledFor: string;
    status: 'SCHEDULED' | 'SENT' | 'FAILED' | 'CANCELLED';
  }> {
    const response = await api.post(`${this.baseUrl}/schedule`, data);
    return response.data;
  }

  async getScheduledNotifications(): Promise<Array<{
    id: string;
    notification: CreateNotificationData;
    scheduledFor: string;
    status: 'SCHEDULED' | 'SENT' | 'FAILED' | 'CANCELLED';
    createdAt: string;
  }>> {
    const response = await api.get(`${this.baseUrl}/scheduled`);
    return response.data;
  }

  async cancelScheduledNotification(scheduleId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/scheduled/${scheduleId}`);
  }

  async getNotificationHistory(filters?: {
    userId?: string;
    type?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    notifications: Notification[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined) {
          params.append(key, value.toString());
        }
      });
    }

    const queryString = params.toString();
    const url = queryString ? `${this.baseUrl}/history?${queryString}` : `${this.baseUrl}/history`;
    
    const response = await api.get(url);
    return response.data;
  }

  async exportNotifications(filters: NotificationFilters, format: 'csv' | 'xlsx'): Promise<Blob> {
    const params = new URLSearchParams();
    params.append('format', format);
    
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, value.toString());
      }
    });

    const response = await api.get(`${this.baseUrl}/export?${params.toString()}`, {
      responseType: 'blob',
    });
    return response.data;
  }

  async subscribeToNotifications(subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  }): Promise<void> {
    await api.post(`${this.baseUrl}/subscribe`, subscription);
  }

  async unsubscribeFromNotifications(endpoint: string): Promise<void> {
    await api.post(`${this.baseUrl}/unsubscribe`, { endpoint });
  }

  async getSubscriptions(): Promise<Array<{
    id: string;
    endpoint: string;
    userAgent: string;
    createdAt: string;
    lastUsed: string;
  }>> {
    const response = await api.get(`${this.baseUrl}/subscriptions`);
    return response.data;
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/subscriptions/${subscriptionId}`);
  }

  async sendBulkNotification(data: {
    userIds?: string[];
    roles?: string[];
    departments?: string[];
    notification: CreateNotificationData;
    filters?: {
      facilityId?: string;
      isActive?: boolean;
    };
  }): Promise<{
    sent: number;
    failed: number;
    details: Array<{
      userId: string;
      status: 'sent' | 'failed';
      error?: string;
    }>;
  }> {
    const response = await api.post(`${this.baseUrl}/bulk`, data);
    return response.data;
  }

  async getDeliveryStatus(notificationId: string): Promise<{
    email?: {
      status: 'pending' | 'sent' | 'delivered' | 'failed' | 'bounced';
      sentAt?: string;
      deliveredAt?: string;
      error?: string;
    };
    push?: {
      status: 'pending' | 'sent' | 'delivered' | 'failed';
      sentAt?: string;
      deliveredAt?: string;
      error?: string;
    };
    sms?: {
      status: 'pending' | 'sent' | 'delivered' | 'failed';
      sentAt?: string;
      deliveredAt?: string;
      error?: string;
    };
  }> {
    const response = await api.get(`${this.baseUrl}/${notificationId}/delivery-status`);
    return response.data;
  }

  async retryFailedNotification(notificationId: string, channels?: ('email' | 'push' | 'sms')[]): Promise<void> {
    await api.post(`${this.baseUrl}/${notificationId}/retry`, {
      channels,
    });
  }

  async getUsers(): Promise<Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    department?: string;
  }>> {
    const response = await api.get('/api/users?fields=id,firstName,lastName,email,role,department');
    return response.data.users || [];
  }

  // Real-time notification handling
  private eventSource?: EventSource;
  private notificationCallbacks: Array<(notification: Notification) => void> = [];

  subscribeToRealTimeNotifications(callback: (notification: Notification) => void): () => void {
    this.notificationCallbacks.push(callback);

    if (!this.eventSource) {
      this.eventSource = new EventSource(`${this.baseUrl}/stream`);
      
      this.eventSource.onmessage = (event) => {
        try {
          const notification: Notification = JSON.parse(event.data);
          this.notificationCallbacks.forEach(cb => cb(notification));
        } catch (error) {
          console.error('Error parsing notification:', error);
        }
      };

      this.eventSource.onerror = (error) => {
        console.error('Notification stream error:', error);
      };
    }

    // Return unsubscribe function
    return () => {
      const index = this.notificationCallbacks.indexOf(callback);
      if (index > -1) {
        this.notificationCallbacks.splice(index, 1);
      }

      if (this.notificationCallbacks.length === 0 && this.eventSource) {
        this.eventSource.close();
        this.eventSource = undefined;
      }
    };
  }

  // Utility methods
  getNotificationTypeLabel(type: Notification['type']): string {
    const labels: Record<Notification['type'], string> = {
      APPOINTMENT: 'Appointment',
      MESSAGE: 'Message',
      REMINDER: 'Reminder',
      ALERT: 'Alert',
      SYSTEM: 'System',
      BILLING: 'Billing',
      LAB_RESULT: 'Lab Result',
      PRESCRIPTION: 'Prescription',
      TASK: 'Task',
      EMERGENCY: 'Emergency',
    };
    return labels[type] || type;
  }

  getNotificationTypeIcon(type: Notification['type']): string {
    const icons: Record<Notification['type'], string> = {
      APPOINTMENT: 'calendar',
      MESSAGE: 'chat',
      REMINDER: 'bell',
      ALERT: 'exclamation-triangle',
      SYSTEM: 'cog',
      BILLING: 'credit-card',
      LAB_RESULT: 'beaker',
      PRESCRIPTION: 'prescription-bottle',
      TASK: 'clipboard-list',
      EMERGENCY: 'exclamation-circle',
    };
    return icons[type] || 'bell';
  }

  getPriorityColor(priority: Notification['priority']): string {
    const colors: Record<Notification['priority'], string> = {
      LOW: 'gray',
      MEDIUM: 'blue',
      HIGH: 'orange',
      URGENT: 'red',
    };
    return colors[priority] || 'gray';
  }

  getStatusColor(status: Notification['status']): string {
    const colors: Record<Notification['status'], string> = {
      UNREAD: 'blue',
      READ: 'gray',
      ARCHIVED: 'yellow',
      DELETED: 'red',
    };
    return colors[status] || 'gray';
  }

  formatTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) {
      return 'Just now';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (diffInSeconds < 604800) {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days} day${days > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  isExpired(notification: Notification): boolean {
    if (!notification.expiresAt) return false;
    return new Date(notification.expiresAt) < new Date();
  }

  canPerformAction(notification: Notification): boolean {
    return notification.isActionable && !this.isExpired(notification) && 
           notification.status !== 'DELETED';
  }
}

export const notificationService = new NotificationService();
export default notificationService;