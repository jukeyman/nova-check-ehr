import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  BellIcon,
  CheckIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  UserIcon,
  CalendarIcon,
  DocumentIcon,
  ChatBubbleLeftIcon,
  HeartIcon,
  CogIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  EllipsisVerticalIcon,
  TrashIcon,
  EyeIcon,
  ArchiveBoxIcon,
} from '@heroicons/react/24/outline';
import { format, parseISO, isToday, isYesterday, formatDistanceToNow } from 'date-fns';
import { notificationService } from '../../services/notificationService';
import { useAuth } from '../../contexts/AuthContext';

interface Notification {
  id: string;
  type: 'APPOINTMENT' | 'MESSAGE' | 'ALERT' | 'REMINDER' | 'SYSTEM' | 'BILLING' | 'MEDICAL';
  title: string;
  message: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'UNREAD' | 'READ' | 'ARCHIVED';
  actionUrl?: string;
  actionText?: string;
  metadata?: {
    appointmentId?: string;
    patientId?: string;
    providerId?: string;
    messageId?: string;
    amount?: number;
    dueDate?: string;
  };
  createdAt: string;
  readAt?: string;
  sender?: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
    avatar?: string;
  };
}

interface NotificationFilters {
  status: 'ALL' | 'UNREAD' | 'READ' | 'ARCHIVED';
  type: 'ALL' | 'APPOINTMENT' | 'MESSAGE' | 'ALERT' | 'REMINDER' | 'SYSTEM' | 'BILLING' | 'MEDICAL';
  priority: 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  dateRange: 'ALL' | 'TODAY' | 'WEEK' | 'MONTH';
}

const Notifications: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // State management
  const [filters, setFilters] = useState<NotificationFilters>({
    status: 'ALL',
    type: 'ALL',
    priority: 'ALL',
    dateRange: 'ALL',
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNotifications, setSelectedNotifications] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'compact'>('list');

  // Fetch notifications
  const { data: notificationsData, isLoading, error } = useQuery({
    queryKey: ['notifications', filters, searchTerm],
    queryFn: () => notificationService.getNotifications({
      ...filters,
      search: searchTerm,
    }),
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Mark as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: (notificationIds: string[]) =>
      notificationService.markAsRead(notificationIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Notifications marked as read');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to mark notifications as read');
    },
  });

  // Archive mutation
  const archiveMutation = useMutation({
    mutationFn: (notificationIds: string[]) =>
      notificationService.archiveNotifications(notificationIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Notifications archived');
      setSelectedNotifications(new Set());
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to archive notifications');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (notificationIds: string[]) =>
      notificationService.deleteNotifications(notificationIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Notifications deleted');
      setSelectedNotifications(new Set());
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete notifications');
    },
  });

  // Mock data for development
  const mockNotifications: Notification[] = [
    {
      id: '1',
      type: 'APPOINTMENT',
      title: 'Upcoming Appointment Reminder',
      message: 'You have an appointment with Dr. Sarah Johnson tomorrow at 2:00 PM',
      priority: 'HIGH',
      status: 'UNREAD',
      actionUrl: '/appointments/123',
      actionText: 'View Appointment',
      metadata: {
        appointmentId: '123',
        providerId: 'provider-1',
      },
      createdAt: '2024-01-15T10:00:00Z',
      sender: {
        id: 'system',
        firstName: 'Nova Check',
        lastName: 'System',
        role: 'SYSTEM',
      },
    },
    {
      id: '2',
      type: 'MESSAGE',
      title: 'New Message from Dr. Johnson',
      message: 'Your lab results are ready for review. Please schedule a follow-up appointment.',
      priority: 'MEDIUM',
      status: 'UNREAD',
      actionUrl: '/messages/456',
      actionText: 'Read Message',
      metadata: {
        messageId: '456',
        providerId: 'provider-1',
      },
      createdAt: '2024-01-15T08:30:00Z',
      sender: {
        id: 'provider-1',
        firstName: 'Dr. Sarah',
        lastName: 'Johnson',
        role: 'PROVIDER',
        avatar: '/avatars/dr-johnson.jpg',
      },
    },
    {
      id: '3',
      type: 'BILLING',
      title: 'Payment Due Reminder',
      message: 'Your payment of $150.00 for the consultation on Jan 10th is due in 3 days.',
      priority: 'HIGH',
      status: 'READ',
      actionUrl: '/billing/789',
      actionText: 'Pay Now',
      metadata: {
        amount: 150.00,
        dueDate: '2024-01-18T00:00:00Z',
      },
      createdAt: '2024-01-14T16:00:00Z',
      readAt: '2024-01-14T18:00:00Z',
      sender: {
        id: 'billing',
        firstName: 'Billing',
        lastName: 'Department',
        role: 'SYSTEM',
      },
    },
    {
      id: '4',
      type: 'MEDICAL',
      title: 'Prescription Refill Available',
      message: 'Your prescription for Lisinopril is ready for refill. Contact your pharmacy.',
      priority: 'MEDIUM',
      status: 'READ',
      actionUrl: '/prescriptions/101',
      actionText: 'View Prescription',
      metadata: {
        patientId: 'patient-1',
      },
      createdAt: '2024-01-13T12:00:00Z',
      readAt: '2024-01-13T14:00:00Z',
      sender: {
        id: 'pharmacy',
        firstName: 'Central',
        lastName: 'Pharmacy',
        role: 'SYSTEM',
      },
    },
    {
      id: '5',
      type: 'ALERT',
      title: 'Critical Lab Value Alert',
      message: 'Patient John Doe has a critical glucose level of 450 mg/dL. Immediate attention required.',
      priority: 'URGENT',
      status: 'UNREAD',
      actionUrl: '/patients/patient-1/labs',
      actionText: 'View Lab Results',
      metadata: {
        patientId: 'patient-1',
      },
      createdAt: '2024-01-15T11:45:00Z',
      sender: {
        id: 'lab',
        firstName: 'Lab',
        lastName: 'System',
        role: 'SYSTEM',
      },
    },
    {
      id: '6',
      type: 'SYSTEM',
      title: 'System Maintenance Scheduled',
      message: 'The system will be under maintenance on Jan 20th from 2:00 AM to 4:00 AM EST.',
      priority: 'LOW',
      status: 'ARCHIVED',
      createdAt: '2024-01-12T09:00:00Z',
      readAt: '2024-01-12T10:00:00Z',
      sender: {
        id: 'admin',
        firstName: 'System',
        lastName: 'Administrator',
        role: 'ADMIN',
      },
    },
  ];

  const notifications = notificationsData?.notifications || mockNotifications;
  const stats = notificationsData?.stats || {
    total: mockNotifications.length,
    unread: mockNotifications.filter(n => n.status === 'UNREAD').length,
    urgent: mockNotifications.filter(n => n.priority === 'URGENT').length,
  };

  const getNotificationIcon = (type: string, priority: string) => {
    const iconClass = `h-6 w-6 ${
      priority === 'URGENT'
        ? 'text-red-500'
        : priority === 'HIGH'
        ? 'text-orange-500'
        : priority === 'MEDIUM'
        ? 'text-yellow-500'
        : 'text-blue-500'
    }`;

    switch (type) {
      case 'APPOINTMENT':
        return <CalendarIcon className={iconClass} />;
      case 'MESSAGE':
        return <ChatBubbleLeftIcon className={iconClass} />;
      case 'ALERT':
        return <ExclamationTriangleIcon className={iconClass} />;
      case 'REMINDER':
        return <ClockIcon className={iconClass} />;
      case 'SYSTEM':
        return <CogIcon className={iconClass} />;
      case 'BILLING':
        return <DocumentIcon className={iconClass} />;
      case 'MEDICAL':
        return <HeartIcon className={iconClass} />;
      default:
        return <InformationCircleIcon className={iconClass} />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'URGENT':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'HIGH':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'MEDIUM':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'LOW':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatNotificationDate = (dateString: string) => {
    const date = parseISO(dateString);
    
    if (isToday(date)) {
      return `Today at ${format(date, 'h:mm a')}`;
    }
    
    if (isYesterday(date)) {
      return `Yesterday at ${format(date, 'h:mm a')}`;
    }
    
    return format(date, 'MMM dd, yyyy h:mm a');
  };

  const handleNotificationClick = (notification: Notification) => {
    // Mark as read if unread
    if (notification.status === 'UNREAD') {
      markAsReadMutation.mutate([notification.id]);
    }

    // Navigate to action URL if available
    if (notification.actionUrl) {
      window.location.href = notification.actionUrl;
    }
  };

  const handleSelectNotification = (notificationId: string) => {
    const newSelected = new Set(selectedNotifications);
    if (newSelected.has(notificationId)) {
      newSelected.delete(notificationId);
    } else {
      newSelected.add(notificationId);
    }
    setSelectedNotifications(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedNotifications.size === notifications.length) {
      setSelectedNotifications(new Set());
    } else {
      setSelectedNotifications(new Set(notifications.map(n => n.id)));
    }
  };

  const handleBulkMarkAsRead = () => {
    const unreadSelected = Array.from(selectedNotifications).filter(id => {
      const notification = notifications.find(n => n.id === id);
      return notification?.status === 'UNREAD';
    });
    
    if (unreadSelected.length > 0) {
      markAsReadMutation.mutate(unreadSelected);
    }
    setSelectedNotifications(new Set());
  };

  const handleBulkArchive = () => {
    if (selectedNotifications.size > 0) {
      archiveMutation.mutate(Array.from(selectedNotifications));
    }
  };

  const handleBulkDelete = () => {
    if (selectedNotifications.size > 0) {
      if (window.confirm(`Are you sure you want to delete ${selectedNotifications.size} notification(s)?`)) {
        deleteMutation.mutate(Array.from(selectedNotifications));
      }
    }
  };

  const filteredNotifications = notifications.filter(notification => {
    // Search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      if (
        !notification.title.toLowerCase().includes(searchLower) &&
        !notification.message.toLowerCase().includes(searchLower)
      ) {
        return false;
      }
    }

    // Status filter
    if (filters.status !== 'ALL' && notification.status !== filters.status) {
      return false;
    }

    // Type filter
    if (filters.type !== 'ALL' && notification.type !== filters.type) {
      return false;
    }

    // Priority filter
    if (filters.priority !== 'ALL' && notification.priority !== filters.priority) {
      return false;
    }

    // Date range filter
    if (filters.dateRange !== 'ALL') {
      const notificationDate = parseISO(notification.createdAt);
      const now = new Date();
      
      switch (filters.dateRange) {
        case 'TODAY':
          if (!isToday(notificationDate)) return false;
          break;
        case 'WEEK':
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (notificationDate < weekAgo) return false;
          break;
        case 'MONTH':
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          if (notificationDate < monthAgo) return false;
          break;
      }
    }

    return true;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <ExclamationTriangleIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Notifications</h2>
          <p className="text-gray-600">Please try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center space-x-3">
              <BellIcon className="h-8 w-8 text-blue-600" />
              <span>Notifications</span>
            </h1>
            <p className="text-gray-600 mt-1">
              Stay updated with important alerts and messages
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 ${
                showFilters
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <FunnelIcon className="h-5 w-5" />
              <span>Filters</span>
            </button>
            <button
              onClick={() => setViewMode(viewMode === 'list' ? 'compact' : 'list')}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {viewMode === 'list' ? 'Compact View' : 'List View'}
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Notifications</p>
              <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            </div>
            <BellIcon className="h-8 w-8 text-blue-500" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Unread</p>
              <p className="text-2xl font-bold text-orange-600">{stats.unread}</p>
            </div>
            <div className="bg-orange-100 rounded-full p-2">
              <ExclamationTriangleIcon className="h-6 w-6 text-orange-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Urgent</p>
              <p className="text-2xl font-bold text-red-600">{stats.urgent}</p>
            </div>
            <div className="bg-red-100 rounded-full p-2">
              <ExclamationTriangleIcon className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">All Status</option>
                  <option value="UNREAD">Unread</option>
                  <option value="READ">Read</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type
                </label>
                <select
                  value={filters.type}
                  onChange={(e) => setFilters({ ...filters, type: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">All Types</option>
                  <option value="APPOINTMENT">Appointments</option>
                  <option value="MESSAGE">Messages</option>
                  <option value="ALERT">Alerts</option>
                  <option value="REMINDER">Reminders</option>
                  <option value="SYSTEM">System</option>
                  <option value="BILLING">Billing</option>
                  <option value="MEDICAL">Medical</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Priority
                </label>
                <select
                  value={filters.priority}
                  onChange={(e) => setFilters({ ...filters, priority: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">All Priorities</option>
                  <option value="URGENT">Urgent</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date Range
                </label>
                <select
                  value={filters.dateRange}
                  onChange={(e) => setFilters({ ...filters, dateRange: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">All Time</option>
                  <option value="TODAY">Today</option>
                  <option value="WEEK">This Week</option>
                  <option value="MONTH">This Month</option>
                </select>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search and Bulk Actions */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search notifications..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Bulk Actions */}
          {selectedNotifications.size > 0 && (
            <div className="flex items-center space-x-3">
              <span className="text-sm text-gray-600">
                {selectedNotifications.size} selected
              </span>
              <button
                onClick={handleBulkMarkAsRead}
                className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition-colors flex items-center space-x-1"
              >
                <CheckIcon className="h-4 w-4" />
                <span>Mark Read</span>
              </button>
              <button
                onClick={handleBulkArchive}
                className="bg-gray-600 text-white px-3 py-1 rounded text-sm hover:bg-gray-700 transition-colors flex items-center space-x-1"
              >
                <ArchiveBoxIcon className="h-4 w-4" />
                <span>Archive</span>
              </button>
              <button
                onClick={handleBulkDelete}
                className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700 transition-colors flex items-center space-x-1"
              >
                <TrashIcon className="h-4 w-4" />
                <span>Delete</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Notifications List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {filteredNotifications.length === 0 ? (
          <div className="text-center py-12">
            <BellIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Notifications Found</h3>
            <p className="text-gray-600">Try adjusting your filters or search terms.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {/* Select All Header */}
            <div className="p-4 bg-gray-50 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={selectedNotifications.size === filteredNotifications.length}
                    onChange={handleSelectAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    {selectedNotifications.size === filteredNotifications.length
                      ? 'Deselect All'
                      : 'Select All'}
                  </span>
                </div>
                <span className="text-sm text-gray-500">
                  {filteredNotifications.length} notification(s)
                </span>
              </div>
            </div>

            {/* Notifications */}
            {filteredNotifications.map((notification) => (
              <motion.div
                key={notification.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                  notification.status === 'UNREAD' ? 'bg-blue-50' : ''
                } ${selectedNotifications.has(notification.id) ? 'bg-blue-100' : ''}`}
                onClick={() => handleNotificationClick(notification)}
              >
                <div className="flex items-start space-x-4">
                  {/* Selection Checkbox */}
                  <input
                    type="checkbox"
                    checked={selectedNotifications.has(notification.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleSelectNotification(notification.id);
                    }}
                    className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />

                  {/* Notification Icon */}
                  <div className="flex-shrink-0 mt-1">
                    {getNotificationIcon(notification.type, notification.priority)}
                  </div>

                  {/* Sender Avatar */}
                  {notification.sender?.avatar ? (
                    <img
                      src={notification.sender.avatar}
                      alt={`${notification.sender.firstName} ${notification.sender.lastName}`}
                      className="w-8 h-8 rounded-full flex-shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
                      <UserIcon className="h-4 w-4 text-gray-500" />
                    </div>
                  )}

                  {/* Notification Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <h3 className={`text-sm font-medium ${
                            notification.status === 'UNREAD' ? 'text-gray-900' : 'text-gray-700'
                          }`}>
                            {notification.title}
                          </h3>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                            getPriorityColor(notification.priority)
                          }`}>
                            {notification.priority}
                          </span>
                          {notification.status === 'UNREAD' && (
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                          )}
                        </div>
                        <p className={`text-sm ${
                          notification.status === 'UNREAD' ? 'text-gray-800' : 'text-gray-600'
                        } ${viewMode === 'compact' ? 'line-clamp-1' : 'line-clamp-2'}`}>
                          {notification.message}
                        </p>
                        <div className="flex items-center space-x-4 mt-2">
                          <span className="text-xs text-gray-500">
                            {formatNotificationDate(notification.createdAt)}
                          </span>
                          {notification.sender && (
                            <span className="text-xs text-gray-500">
                              from {notification.sender.firstName} {notification.sender.lastName}
                            </span>
                          )}
                          {notification.readAt && (
                            <span className="text-xs text-green-600 flex items-center space-x-1">
                              <CheckCircleIcon className="h-3 w-3" />
                              <span>Read</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center space-x-2 ml-4">
                        {notification.actionText && notification.actionUrl && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              window.location.href = notification.actionUrl!;
                            }}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium transition-colors"
                          >
                            {notification.actionText}
                          </button>
                        )}
                        <div className="relative group">
                          <button className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                            <EllipsisVerticalIcon className="h-4 w-4" />
                          </button>
                          <div className="absolute right-0 top-6 w-32 bg-white rounded-md shadow-lg border border-gray-200 py-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                            {notification.status === 'UNREAD' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markAsReadMutation.mutate([notification.id]);
                                }}
                                className="block w-full text-left px-3 py-1 text-xs text-gray-700 hover:bg-gray-100 transition-colors"
                              >
                                Mark as Read
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                archiveMutation.mutate([notification.id]);
                              }}
                              className="block w-full text-left px-3 py-1 text-xs text-gray-700 hover:bg-gray-100 transition-colors"
                            >
                              Archive
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm('Are you sure you want to delete this notification?')) {
                                  deleteMutation.mutate([notification.id]);
                                }
                              }}
                              className="block w-full text-left px-3 py-1 text-xs text-red-600 hover:bg-red-50 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Notifications;