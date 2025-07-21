import { api } from './api';
import { UserRole } from '../types';

export interface DashboardStats {
  totalPatients: number;
  totalAppointments: number;
  totalRevenue: number;
  pendingTasks: number;
  appointmentsToday: number;
  newPatients: number;
  completedAppointments: number;
  cancelledAppointments: number;
  activeProviders?: number;
  systemAlerts?: number;
  monthlyGrowth?: number;
  patientSatisfaction?: number;
}

export interface ChartData {
  appointments: Array<{ name: string; value: number; date?: string }>;
  revenue: Array<{ name: string; value: number; date?: string }>;
  patientTypes: Array<{ name: string; value: number; color: string }>;
  departmentStats?: Array<{ name: string; value: number }>;
  providerPerformance?: Array<{ name: string; appointments: number; revenue: number }>;
}

export interface RecentActivity {
  id: string;
  type: 'appointment' | 'patient' | 'billing' | 'alert' | 'system' | 'message';
  message: string;
  time: string;
  userId?: string;
  userName?: string;
  metadata?: Record<string, any>;
}

export interface UpcomingAppointment {
  id: string;
  patientId: string;
  patientName: string;
  providerId: string;
  providerName: string;
  time: string;
  date: string;
  type: string;
  status: 'confirmed' | 'pending' | 'cancelled' | 'completed';
  duration: number;
  notes?: string;
}

export interface SystemHealth {
  serverStatus: 'healthy' | 'warning' | 'critical';
  databaseStatus: 'healthy' | 'warning' | 'critical';
  apiResponseTime: number;
  activeUsers: number;
  systemLoad: number;
  lastBackup: string;
  uptime: string;
}

class DashboardService {
  async getStats(role: UserRole): Promise<DashboardStats> {
    try {
      const response = await api.get(`/dashboard/stats?role=${role}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      // Return mock data for development
      return this.getMockStats(role);
    }
  }

  async getChartData(timeRange: string): Promise<ChartData> {
    try {
      const response = await api.get(`/dashboard/charts?range=${timeRange}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching chart data:', error);
      // Return mock data for development
      return this.getMockChartData(timeRange);
    }
  }

  async getRecentActivity(userId: string, limit: number = 10): Promise<RecentActivity[]> {
    try {
      const response = await api.get(`/dashboard/activity?userId=${userId}&limit=${limit}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching recent activity:', error);
      // Return mock data for development
      return this.getMockRecentActivity();
    }
  }

  async getUpcomingAppointments(userId: string, limit: number = 5): Promise<UpcomingAppointment[]> {
    try {
      const response = await api.get(`/dashboard/appointments/upcoming?userId=${userId}&limit=${limit}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching upcoming appointments:', error);
      // Return mock data for development
      return this.getMockUpcomingAppointments();
    }
  }

  async getSystemHealth(): Promise<SystemHealth> {
    try {
      const response = await api.get('/dashboard/system/health');
      return response.data;
    } catch (error) {
      console.error('Error fetching system health:', error);
      // Return mock data for development
      return this.getMockSystemHealth();
    }
  }

  async getPatientOverview(patientId: string) {
    try {
      const response = await api.get(`/dashboard/patient/${patientId}/overview`);
      return response.data;
    } catch (error) {
      console.error('Error fetching patient overview:', error);
      throw error;
    }
  }

  async getProviderSchedule(providerId: string, date: string) {
    try {
      const response = await api.get(`/dashboard/provider/${providerId}/schedule?date=${date}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching provider schedule:', error);
      throw error;
    }
  }

  async getFinancialSummary(timeRange: string) {
    try {
      const response = await api.get(`/dashboard/financial/summary?range=${timeRange}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching financial summary:', error);
      throw error;
    }
  }

  // Mock data methods for development
  private getMockStats(role: UserRole): DashboardStats {
    const baseStats = {
      totalPatients: 1247,
      totalAppointments: 89,
      totalRevenue: 45670,
      pendingTasks: 12,
      appointmentsToday: 8,
      newPatients: 23,
      completedAppointments: 156,
      cancelledAppointments: 7,
    };

    switch (role) {
      case 'SUPER_ADMIN':
        return {
          ...baseStats,
          activeProviders: 45,
          systemAlerts: 3,
          monthlyGrowth: 12.5,
          patientSatisfaction: 94.2,
        };
      case 'ADMIN':
        return {
          ...baseStats,
          activeProviders: 45,
          systemAlerts: 3,
          monthlyGrowth: 12.5,
        };
      case 'PROVIDER':
        return {
          ...baseStats,
          totalPatients: 156,
          appointmentsToday: 8,
          pendingTasks: 5,
        };
      case 'PATIENT':
        return {
          totalPatients: 0,
          totalAppointments: 12,
          totalRevenue: 0,
          pendingTasks: 2,
          appointmentsToday: 1,
          newPatients: 0,
          completedAppointments: 8,
          cancelledAppointments: 1,
        };
      default:
        return baseStats;
    }
  }

  private getMockChartData(timeRange: string): ChartData {
    const generateData = (days: number) => {
      const data = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        data.push({
          name: date.toLocaleDateString('en-US', { weekday: 'short' }),
          value: Math.floor(Math.random() * 20) + 5,
          date: date.toISOString(),
        });
      }
      return data;
    };

    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;

    return {
      appointments: generateData(days),
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
      departmentStats: [
        { name: 'Cardiology', value: 45 },
        { name: 'Pediatrics', value: 38 },
        { name: 'Orthopedics', value: 32 },
        { name: 'Dermatology', value: 28 },
      ],
      providerPerformance: [
        { name: 'Dr. Smith', appointments: 156, revenue: 23400 },
        { name: 'Dr. Johnson', appointments: 142, revenue: 21300 },
        { name: 'Dr. Williams', appointments: 138, revenue: 20700 },
        { name: 'Dr. Brown', appointments: 134, revenue: 20100 },
      ],
    };
  }

  private getMockRecentActivity(): RecentActivity[] {
    return [
      {
        id: '1',
        type: 'appointment',
        message: 'New appointment scheduled with Dr. Smith',
        time: '2 minutes ago',
        userId: 'user1',
        userName: 'Sarah Johnson',
      },
      {
        id: '2',
        type: 'patient',
        message: 'Patient John Doe updated medical history',
        time: '15 minutes ago',
        userId: 'user2',
        userName: 'John Doe',
      },
      {
        id: '3',
        type: 'billing',
        message: 'Payment received for Invoice #1234',
        time: '1 hour ago',
        userId: 'user3',
        userName: 'Michael Brown',
      },
      {
        id: '4',
        type: 'alert',
        message: 'Lab results ready for review',
        time: '2 hours ago',
        userId: 'user4',
        userName: 'Dr. Williams',
      },
      {
        id: '5',
        type: 'system',
        message: 'System backup completed successfully',
        time: '3 hours ago',
      },
    ];
  }

  private getMockUpcomingAppointments(): UpcomingAppointment[] {
    return [
      {
        id: '1',
        patientId: 'patient1',
        patientName: 'Sarah Johnson',
        providerId: 'provider1',
        providerName: 'Dr. Smith',
        time: '10:00 AM',
        date: new Date().toISOString(),
        type: 'Consultation',
        status: 'confirmed',
        duration: 30,
      },
      {
        id: '2',
        patientId: 'patient2',
        patientName: 'Michael Brown',
        providerId: 'provider1',
        providerName: 'Dr. Smith',
        time: '11:30 AM',
        date: new Date().toISOString(),
        type: 'Follow-up',
        status: 'pending',
        duration: 15,
      },
      {
        id: '3',
        patientId: 'patient3',
        patientName: 'Emily Davis',
        providerId: 'provider1',
        providerName: 'Dr. Smith',
        time: '2:00 PM',
        date: new Date().toISOString(),
        type: 'Check-up',
        status: 'confirmed',
        duration: 30,
      },
    ];
  }

  private getMockSystemHealth(): SystemHealth {
    return {
      serverStatus: 'healthy',
      databaseStatus: 'healthy',
      apiResponseTime: 145,
      activeUsers: 234,
      systemLoad: 67,
      lastBackup: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      uptime: '15 days, 4 hours',
    };
  }
}

export const dashboardService = new DashboardService();