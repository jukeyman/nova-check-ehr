import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  UserGroupIcon,
  CalendarDaysIcon,
  DocumentTextIcon,
  CurrencyDollarIcon,
  ChartBarIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { dashboardService } from '../services/dashboardService';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import { format, subDays } from 'date-fns';
import { Link } from 'react-router-dom';

interface DashboardStats {
  totalPatients: number;
  totalAppointments: number;
  totalRevenue: number;
  pendingTasks: number;
  appointmentsToday: number;
  newPatients: number;
  completedAppointments: number;
  cancelledAppointments: number;
}

interface ChartData {
  name: string;
  value: number;
  date?: string;
}

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState('7d');

  // Fetch dashboard data
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats', user?.role],
    queryFn: () => dashboardService.getStats(user?.role || 'PATIENT'),
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const { data: chartData, isLoading: chartLoading } = useQuery({
    queryKey: ['dashboard-charts', timeRange],
    queryFn: () => dashboardService.getChartData(timeRange),
    refetchInterval: 60000, // Refetch every minute
  });

  const { data: recentActivity, isLoading: activityLoading } = useQuery({
    queryKey: ['recent-activity', user?.id],
    queryFn: () => dashboardService.getRecentActivity(user?.id || ''),
    refetchInterval: 30000,
  });

  const { data: upcomingAppointments } = useQuery({
    queryKey: ['upcoming-appointments', user?.id],
    queryFn: () => dashboardService.getUpcomingAppointments(user?.id || ''),
    refetchInterval: 30000,
  });

  // Mock data for demonstration
  const mockStats: DashboardStats = {
    totalPatients: 1247,
    totalAppointments: 89,
    totalRevenue: 45670,
    pendingTasks: 12,
    appointmentsToday: 8,
    newPatients: 23,
    completedAppointments: 156,
    cancelledAppointments: 7,
  };

  const mockChartData = {
    appointments: [
      { name: 'Mon', value: 12 },
      { name: 'Tue', value: 19 },
      { name: 'Wed', value: 15 },
      { name: 'Thu', value: 22 },
      { name: 'Fri', value: 18 },
      { name: 'Sat', value: 8 },
      { name: 'Sun', value: 5 },
    ],
    revenue: [
      { name: 'Jan', value: 4000 },
      { name: 'Feb', value: 3000 },
      { name: 'Mar', value: 5000 },
      { name: 'Apr', value: 4500 },
      { name: 'May', value: 6000 },
      { name: 'Jun', value: 5500 },
    ],
    patientTypes: [
      { name: 'New Patients', value: 35, color: '#3B82F6' },
      { name: 'Follow-up', value: 45, color: '#10B981' },
      { name: 'Emergency', value: 20, color: '#F59E0B' },
    ],
  };

  const mockRecentActivity = [
    {
      id: '1',
      type: 'appointment',
      message: 'New appointment scheduled with Dr. Smith',
      time: '2 minutes ago',
      icon: CalendarDaysIcon,
      color: 'text-blue-600',
    },
    {
      id: '2',
      type: 'patient',
      message: 'Patient John Doe updated medical history',
      time: '15 minutes ago',
      icon: DocumentTextIcon,
      color: 'text-green-600',
    },
    {
      id: '3',
      type: 'billing',
      message: 'Payment received for Invoice #1234',
      time: '1 hour ago',
      icon: CurrencyDollarIcon,
      color: 'text-yellow-600',
    },
    {
      id: '4',
      type: 'alert',
      message: 'Lab results ready for review',
      time: '2 hours ago',
      icon: ExclamationTriangleIcon,
      color: 'text-red-600',
    },
  ];

  const mockUpcomingAppointments = [
    {
      id: '1',
      patientName: 'Sarah Johnson',
      time: '10:00 AM',
      type: 'Consultation',
      status: 'confirmed',
    },
    {
      id: '2',
      patientName: 'Michael Brown',
      time: '11:30 AM',
      type: 'Follow-up',
      status: 'pending',
    },
    {
      id: '3',
      patientName: 'Emily Davis',
      time: '2:00 PM',
      type: 'Check-up',
      status: 'confirmed',
    },
  ];

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const getStatCards = () => {
    const baseCards = [
      {
        title: 'Total Patients',
        value: mockStats.totalPatients.toLocaleString(),
        change: '+12%',
        changeType: 'increase' as const,
        icon: UserGroupIcon,
        color: 'bg-blue-500',
        link: '/patients',
      },
      {
        title: 'Appointments Today',
        value: mockStats.appointmentsToday.toString(),
        change: '+3',
        changeType: 'increase' as const,
        icon: CalendarDaysIcon,
        color: 'bg-green-500',
        link: '/appointments',
      },
      {
        title: 'Pending Tasks',
        value: mockStats.pendingTasks.toString(),
        change: '-2',
        changeType: 'decrease' as const,
        icon: ClockIcon,
        color: 'bg-yellow-500',
        link: '/tasks',
      },
    ];

    if (user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') {
      baseCards.push({
        title: 'Monthly Revenue',
        value: `$${mockStats.totalRevenue.toLocaleString()}`,
        change: '+8%',
        changeType: 'increase' as const,
        icon: CurrencyDollarIcon,
        color: 'bg-purple-500',
        link: '/billing',
      });
    }

    return baseCards;
  };

  const statCards = getStatCards();

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {getGreeting()}, {user?.firstName}!
            </h1>
            <p className="text-gray-600 mt-1">
              Here's what's happening with your practice today.
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card, index) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: index * 0.1 }}
          >
            <Link to={card.link} className="block">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">{card.title}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{card.value}</p>
                    <div className="flex items-center mt-2">
                      {card.changeType === 'increase' ? (
                        <ArrowUpIcon className="h-4 w-4 text-green-500 mr-1" />
                      ) : (
                        <ArrowDownIcon className="h-4 w-4 text-red-500 mr-1" />
                      )}
                      <span
                        className={`text-sm font-medium ${
                          card.changeType === 'increase' ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {card.change}
                      </span>
                      <span className="text-sm text-gray-500 ml-1">from last week</span>
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg ${card.color}`}>
                    <card.icon className="h-6 w-6 text-white" />
                  </div>
                </div>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Appointments Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Weekly Appointments</h3>
            <ChartBarIcon className="h-5 w-5 text-gray-400" />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mockChartData.appointments}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Revenue Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Revenue Trend</h3>
            <CurrencyDollarIcon className="h-5 w-5 text-gray-400" />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mockChartData.revenue}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(value) => [`$${value}`, 'Revenue']} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#10B981"
                  strokeWidth={3}
                  dot={{ fill: '#10B981', strokeWidth: 2, r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Recent Activity</h3>
            <Link
              to="/activity"
              className="text-sm text-blue-600 hover:text-blue-500 font-medium"
            >
              View all
            </Link>
          </div>
          <div className="space-y-4">
            {mockRecentActivity.map((activity) => (
              <div key={activity.id} className="flex items-start space-x-3">
                <div className={`p-2 rounded-lg bg-gray-100`}>
                  <activity.icon className={`h-4 w-4 ${activity.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900">{activity.message}</p>
                  <p className="text-xs text-gray-500 mt-1">{activity.time}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Upcoming Appointments */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.7 }}
          className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Today's Schedule</h3>
            <Link
              to="/appointments"
              className="text-sm text-blue-600 hover:text-blue-500 font-medium"
            >
              View all
            </Link>
          </div>
          <div className="space-y-3">
            {mockUpcomingAppointments.map((appointment) => (
              <div key={appointment.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {appointment.patientName}
                  </p>
                  <p className="text-xs text-gray-500">{appointment.type}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">{appointment.time}</p>
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      appointment.status === 'confirmed'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {appointment.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Patient Types Pie Chart */}
      {(user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'PROVIDER') && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Patient Distribution</h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={mockChartData.patientTypes}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {mockChartData.patientTypes.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [`${value}%`, 'Percentage']} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center space-x-6 mt-4">
            {mockChartData.patientTypes.map((type) => (
              <div key={type.name} className="flex items-center">
                <div
                  className="w-3 h-3 rounded-full mr-2"
                  style={{ backgroundColor: type.color }}
                />
                <span className="text-sm text-gray-600">{type.name}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default Dashboard;