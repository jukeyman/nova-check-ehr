import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  CalendarDaysIcon,
  DocumentTextIcon,
  HeartIcon,
  ClockIcon,
  UserIcon,
  PhoneIcon,
  EnvelopeIcon,
  MapPinIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  BellIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../../contexts/AuthContext';
import { patientService } from '../../services/patientService';
import { appointmentService } from '../../services/appointmentService';
import { medicalRecordService } from '../../services/medicalRecordService';
import { notificationService } from '../../services/notificationService';

interface PatientStats {
  upcomingAppointments: number;
  totalRecords: number;
  unreadNotifications: number;
  lastVisit: string;
}

interface UpcomingAppointment {
  id: string;
  date: string;
  time: string;
  provider: string;
  type: string;
  location: string;
  status: 'confirmed' | 'pending' | 'cancelled';
}

interface RecentRecord {
  id: string;
  date: string;
  type: string;
  provider: string;
  summary: string;
  status: 'completed' | 'pending' | 'draft';
}

interface HealthMetric {
  id: string;
  name: string;
  value: string;
  unit: string;
  status: 'normal' | 'warning' | 'critical';
  lastUpdated: string;
  trend: 'up' | 'down' | 'stable';
}

const PatientDashboard: React.FC = () => {
  const { user } = useAuth();
  const [selectedTimeframe, setSelectedTimeframe] = useState('week');

  // Fetch patient dashboard data
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['patient-stats', user?.id],
    queryFn: () => patientService.getPatientStats(user?.id || ''),
    enabled: !!user?.id,
  });

  const { data: appointments, isLoading: appointmentsLoading } = useQuery({
    queryKey: ['patient-appointments', user?.id],
    queryFn: () => appointmentService.getPatientAppointments(user?.id || ''),
    enabled: !!user?.id,
  });

  const { data: recentRecords, isLoading: recordsLoading } = useQuery({
    queryKey: ['patient-recent-records', user?.id],
    queryFn: () => medicalRecordService.getPatientRecentRecords(user?.id || ''),
    enabled: !!user?.id,
  });

  const { data: healthMetrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['patient-health-metrics', user?.id],
    queryFn: () => patientService.getHealthMetrics(user?.id || ''),
    enabled: !!user?.id,
  });

  const { data: notifications, isLoading: notificationsLoading } = useQuery({
    queryKey: ['patient-notifications', user?.id],
    queryFn: () => notificationService.getNotifications({ userId: user?.id, limit: 5 }),
    enabled: !!user?.id,
  });

  // Mock data for development
  const mockStats: PatientStats = {
    upcomingAppointments: 3,
    totalRecords: 24,
    unreadNotifications: 2,
    lastVisit: '2024-01-15',
  };

  const mockAppointments: UpcomingAppointment[] = [
    {
      id: '1',
      date: '2024-01-25',
      time: '10:00 AM',
      provider: 'Dr. Sarah Johnson',
      type: 'Annual Checkup',
      location: 'Main Clinic - Room 205',
      status: 'confirmed',
    },
    {
      id: '2',
      date: '2024-02-02',
      time: '2:30 PM',
      provider: 'Dr. Michael Chen',
      type: 'Follow-up',
      location: 'Cardiology Wing - Room 301',
      status: 'pending',
    },
    {
      id: '3',
      date: '2024-02-10',
      time: '9:15 AM',
      provider: 'Dr. Emily Rodriguez',
      type: 'Lab Results Review',
      location: 'Main Clinic - Room 102',
      status: 'confirmed',
    },
  ];

  const mockRecentRecords: RecentRecord[] = [
    {
      id: '1',
      date: '2024-01-15',
      type: 'Lab Results',
      provider: 'Dr. Sarah Johnson',
      summary: 'Complete blood count and metabolic panel - All values within normal range',
      status: 'completed',
    },
    {
      id: '2',
      date: '2024-01-10',
      type: 'Consultation',
      provider: 'Dr. Michael Chen',
      summary: 'Routine cardiology consultation - Blood pressure monitoring recommended',
      status: 'completed',
    },
    {
      id: '3',
      date: '2024-01-05',
      type: 'Prescription',
      provider: 'Dr. Emily Rodriguez',
      summary: 'Updated medication dosage for hypertension management',
      status: 'completed',
    },
  ];

  const mockHealthMetrics: HealthMetric[] = [
    {
      id: '1',
      name: 'Blood Pressure',
      value: '120/80',
      unit: 'mmHg',
      status: 'normal',
      lastUpdated: '2024-01-15',
      trend: 'stable',
    },
    {
      id: '2',
      name: 'Heart Rate',
      value: '72',
      unit: 'bpm',
      status: 'normal',
      lastUpdated: '2024-01-15',
      trend: 'down',
    },
    {
      id: '3',
      name: 'Weight',
      value: '165',
      unit: 'lbs',
      status: 'normal',
      lastUpdated: '2024-01-12',
      trend: 'stable',
    },
    {
      id: '4',
      name: 'Cholesterol',
      value: '195',
      unit: 'mg/dL',
      status: 'warning',
      lastUpdated: '2024-01-10',
      trend: 'up',
    },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'normal':
        return 'text-green-600 bg-green-100';
      case 'warning':
        return 'text-yellow-600 bg-yellow-100';
      case 'critical':
        return 'text-red-600 bg-red-100';
      case 'confirmed':
        return 'text-green-600 bg-green-100';
      case 'pending':
        return 'text-yellow-600 bg-yellow-100';
      case 'cancelled':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up':
        return '↗️';
      case 'down':
        return '↘️';
      case 'stable':
        return '→';
      default:
        return '→';
    }
  };

  const currentStats = stats || mockStats;
  const currentAppointments = appointments || mockAppointments;
  const currentRecords = recentRecords || mockRecentRecords;
  const currentMetrics = healthMetrics || mockHealthMetrics;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Welcome back, {user?.firstName || 'Patient'}!
              </h1>
              <p className="text-gray-600 mt-1">
                Here's an overview of your health information
              </p>
            </div>
            <div className="flex items-center space-x-4">
              <button className="relative p-2 text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg">
                <BellIcon className="h-6 w-6" />
                {currentStats.unreadNotifications > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 w-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                    {currentStats.unreadNotifications}
                  </span>
                )}
              </button>
              <button className="p-2 text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg">
                <ChatBubbleLeftRightIcon className="h-6 w-6" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-lg shadow-sm p-6 border border-gray-200"
          >
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <CalendarDaysIcon className="h-8 w-8 text-blue-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Upcoming Appointments</p>
                <p className="text-2xl font-bold text-gray-900">{currentStats.upcomingAppointments}</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-lg shadow-sm p-6 border border-gray-200"
          >
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <DocumentTextIcon className="h-8 w-8 text-green-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Medical Records</p>
                <p className="text-2xl font-bold text-gray-900">{currentStats.totalRecords}</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-lg shadow-sm p-6 border border-gray-200"
          >
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <HeartIcon className="h-8 w-8 text-red-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Health Metrics</p>
                <p className="text-2xl font-bold text-gray-900">{currentMetrics.length}</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white rounded-lg shadow-sm p-6 border border-gray-200"
          >
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <ClockIcon className="h-8 w-8 text-purple-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Last Visit</p>
                <p className="text-lg font-bold text-gray-900">
                  {new Date(currentStats.lastVisit).toLocaleDateString()}
                </p>
              </div>
            </div>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Upcoming Appointments */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white rounded-lg shadow-sm border border-gray-200"
          >
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Upcoming Appointments</h3>
                <button className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                  View All
                </button>
              </div>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {currentAppointments.slice(0, 3).map((appointment) => (
                  <div key={appointment.id} className="flex items-start space-x-4 p-4 bg-gray-50 rounded-lg">
                    <div className="flex-shrink-0">
                      <CalendarDaysIcon className="h-6 w-6 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-900">{appointment.type}</p>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          getStatusColor(appointment.status)
                        }`}>
                          {appointment.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">{appointment.provider}</p>
                      <p className="text-sm text-gray-500">
                        {new Date(appointment.date).toLocaleDateString()} at {appointment.time}
                      </p>
                      <p className="text-sm text-gray-500">{appointment.location}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Health Metrics */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 }}
            className="bg-white rounded-lg shadow-sm border border-gray-200"
          >
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Health Metrics</h3>
                <button className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                  View Details
                </button>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {currentMetrics.map((metric) => (
                  <div key={metric.id} className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-gray-900">{metric.name}</p>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        getStatusColor(metric.status)
                      }`}>
                        {metric.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-lg font-bold text-gray-900">
                        {metric.value} {metric.unit}
                      </p>
                      <span className="text-sm text-gray-500">
                        {getTrendIcon(metric.trend)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Updated {new Date(metric.lastUpdated).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        {/* Recent Medical Records */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mt-8 bg-white rounded-lg shadow-sm border border-gray-200"
        >
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Recent Medical Records</h3>
              <button className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                View All Records
              </button>
            </div>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {currentRecords.map((record) => (
                <div key={record.id} className="flex items-start space-x-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                  <div className="flex-shrink-0">
                    <DocumentTextIcon className="h-6 w-6 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900">{record.type}</p>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        getStatusColor(record.status)
                      }`}>
                        {record.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{record.provider}</p>
                    <p className="text-sm text-gray-500 mt-1">{record.summary}</p>
                    <p className="text-xs text-gray-500 mt-2">
                      {new Date(record.date).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default PatientDashboard;