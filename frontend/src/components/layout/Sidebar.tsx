import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  HomeIcon,
  UserGroupIcon,
  CalendarDaysIcon,
  DocumentTextIcon,
  FolderIcon,
  ChatBubbleLeftRightIcon,
  CreditCardIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  HeartIcon,
  XMarkIcon,
  UserIcon,
  ClipboardDocumentListIcon,
  BeakerIcon,
  TruckIcon,
} from '@heroicons/react/24/outline';
import { useAuthStore } from '../../stores/authStore';

interface SidebarProps {
  onClose?: () => void;
}

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: string[];
  badge?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ onClose }) => {
  const location = useLocation();
  const { user } = useAuthStore();

  const navigation: NavItem[] = [
    {
      name: 'Dashboard',
      href: '/dashboard',
      icon: HomeIcon,
      roles: ['PATIENT', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN'],
    },
    {
      name: 'Patients',
      href: '/patients',
      icon: UserGroupIcon,
      roles: ['PROVIDER', 'ADMIN', 'SUPER_ADMIN'],
    },
    {
      name: 'My Profile',
      href: '/profile',
      icon: UserIcon,
      roles: ['PATIENT'],
    },
    {
      name: 'Appointments',
      href: '/appointments',
      icon: CalendarDaysIcon,
      roles: ['PATIENT', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN'],
    },
    {
      name: 'Medical Records',
      href: '/medical-records',
      icon: DocumentTextIcon,
      roles: ['PATIENT', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN'],
    },
    {
      name: 'Lab Results',
      href: '/lab-results',
      icon: BeakerIcon,
      roles: ['PATIENT', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN'],
    },
    {
      name: 'Prescriptions',
      href: '/prescriptions',
      icon: ClipboardDocumentListIcon,
      roles: ['PATIENT', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN'],
    },
    {
      name: 'Files & Documents',
      href: '/files',
      icon: FolderIcon,
      roles: ['PATIENT', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN'],
    },
    {
      name: 'Messages',
      href: '/messages',
      icon: ChatBubbleLeftRightIcon,
      roles: ['PATIENT', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN'],
    },
    {
      name: 'Billing',
      href: '/billing',
      icon: CreditCardIcon,
      roles: ['PATIENT', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN'],
    },
    {
      name: 'Inventory',
      href: '/inventory',
      icon: TruckIcon,
      roles: ['PROVIDER', 'ADMIN', 'SUPER_ADMIN'],
    },
    {
      name: 'Analytics',
      href: '/analytics',
      icon: ChartBarIcon,
      roles: ['PROVIDER', 'ADMIN', 'SUPER_ADMIN'],
    },
    {
      name: 'Settings',
      href: '/settings',
      icon: Cog6ToothIcon,
      roles: ['PATIENT', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN'],
    },
  ];

  const filteredNavigation = navigation.filter(item => 
    user?.role && item.roles.includes(user.role)
  );

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return location.pathname === '/' || location.pathname === '/dashboard';
    }
    return location.pathname.startsWith(href);
  };

  return (
    <div className="flex h-full flex-col bg-white shadow-xl">
      {/* Header */}
      <div className="flex h-16 items-center justify-between px-6 border-b border-gray-200">
        <Link to="/dashboard" className="flex items-center space-x-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
            <HeartIcon className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Nova Check</h1>
            <p className="text-xs text-gray-600">EHR System</p>
          </div>
        </Link>
        
        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden rounded-md p-2 text-gray-600 hover:bg-gray-100"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-4 py-6">
        <div className="space-y-1">
          {filteredNavigation.map((item, index) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            
            return (
              <motion.div
                key={item.name}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05, duration: 0.3 }}
              >
                <Link
                  to={item.href}
                  onClick={onClose}
                  className={`group flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-700'
                      : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <Icon
                    className={`mr-3 h-5 w-5 flex-shrink-0 ${
                      active ? 'text-blue-500' : 'text-gray-400 group-hover:text-gray-500'
                    }`}
                  />
                  <span className="flex-1">{item.name}</span>
                  {item.badge && (
                    <span className="ml-3 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                      {item.badge}
                    </span>
                  )}
                </Link>
              </motion.div>
            );
          })}
        </div>
      </nav>

      {/* User Info */}
      <div className="border-t border-gray-200 p-4">
        <div className="flex items-center space-x-3">
          {user?.profilePicture ? (
            <img
              src={user.profilePicture}
              alt={user.firstName}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-medium text-white">
              {user ? `${user.firstName[0]}${user.lastName[0]}` : 'U'}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {user ? `${user.firstName} ${user.lastName}` : 'User'}
            </p>
            <p className="text-xs text-gray-600 truncate">
              {user?.role?.replace('_', ' ')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;