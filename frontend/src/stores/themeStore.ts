import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// ============================================================================
// TYPES
// ============================================================================

export type Theme = 'light' | 'dark' | 'system';
export type ColorScheme = 'blue' | 'green' | 'purple' | 'orange' | 'red';
export type SidebarState = 'expanded' | 'collapsed' | 'hidden';
export type Density = 'comfortable' | 'compact' | 'spacious';
export type FontSize = 'small' | 'medium' | 'large';

export interface ThemePreferences {
  // Core Theme
  theme: Theme;
  colorScheme: ColorScheme;
  
  // Layout
  sidebarState: SidebarState;
  density: Density;
  fontSize: FontSize;
  
  // Accessibility
  reducedMotion: boolean;
  highContrast: boolean;
  
  // UI Preferences
  showAnimations: boolean;
  showTooltips: boolean;
  compactMode: boolean;
  
  // Medical UI Specific
  medicalColorCoding: boolean;
  urgencyIndicators: boolean;
  patientPhotoDisplay: boolean;
  
  // Dashboard
  dashboardLayout: 'grid' | 'list';
  defaultView: 'dashboard' | 'patients' | 'appointments';
  
  // Calendar
  calendarView: 'month' | 'week' | 'day';
  workingHours: {
    start: string;
    end: string;
  };
  
  // Notifications
  soundEnabled: boolean;
  desktopNotifications: boolean;
}

export interface ThemeState extends ThemePreferences {
  // Computed Properties
  isDark: boolean;
  effectiveTheme: 'light' | 'dark';
  
  // Actions
  setTheme: (theme: Theme) => void;
  setColorScheme: (colorScheme: ColorScheme) => void;
  setSidebarState: (state: SidebarState) => void;
  setDensity: (density: Density) => void;
  setFontSize: (fontSize: FontSize) => void;
  
  // Accessibility Actions
  toggleReducedMotion: () => void;
  toggleHighContrast: () => void;
  
  // UI Actions
  toggleAnimations: () => void;
  toggleTooltips: () => void;
  toggleCompactMode: () => void;
  
  // Medical UI Actions
  toggleMedicalColorCoding: () => void;
  toggleUrgencyIndicators: () => void;
  togglePatientPhotoDisplay: () => void;
  
  // Dashboard Actions
  setDashboardLayout: (layout: 'grid' | 'list') => void;
  setDefaultView: (view: 'dashboard' | 'patients' | 'appointments') => void;
  
  // Calendar Actions
  setCalendarView: (view: 'month' | 'week' | 'day') => void;
  setWorkingHours: (start: string, end: string) => void;
  
  // Notification Actions
  toggleSound: () => void;
  toggleDesktopNotifications: () => void;
  
  // Utility Actions
  resetToDefaults: () => void;
  importPreferences: (preferences: Partial<ThemePreferences>) => void;
  exportPreferences: () => ThemePreferences;
}

// ============================================================================
// DEFAULT PREFERENCES
// ============================================================================

const defaultPreferences: ThemePreferences = {
  // Core Theme
  theme: 'system',
  colorScheme: 'blue',
  
  // Layout
  sidebarState: 'expanded',
  density: 'comfortable',
  fontSize: 'medium',
  
  // Accessibility
  reducedMotion: false,
  highContrast: false,
  
  // UI Preferences
  showAnimations: true,
  showTooltips: true,
  compactMode: false,
  
  // Medical UI Specific
  medicalColorCoding: true,
  urgencyIndicators: true,
  patientPhotoDisplay: true,
  
  // Dashboard
  dashboardLayout: 'grid',
  defaultView: 'dashboard',
  
  // Calendar
  calendarView: 'week',
  workingHours: {
    start: '08:00',
    end: '18:00',
  },
  
  // Notifications
  soundEnabled: true,
  desktopNotifications: true,
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const getSystemTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') {
    return 'light';
  }
  
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const getEffectiveTheme = (theme: Theme): 'light' | 'dark' => {
  if (theme === 'system') {
    return getSystemTheme();
  }
  return theme;
};

const applyThemeToDocument = (theme: 'light' | 'dark', colorScheme: ColorScheme) => {
  if (typeof document === 'undefined') {
    return;
  }
  
  const root = document.documentElement;
  
  // Apply theme class
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  
  // Apply color scheme
  root.setAttribute('data-color-scheme', colorScheme);
  
  // Update meta theme-color for mobile browsers
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    const color = theme === 'dark' ? '#1f2937' : '#ffffff';
    metaThemeColor.setAttribute('content', color);
  }
};

const applyAccessibilityPreferences = (preferences: {
  reducedMotion: boolean;
  highContrast: boolean;
  fontSize: FontSize;
}) => {
  if (typeof document === 'undefined') {
    return;
  }
  
  const root = document.documentElement;
  
  // Reduced motion
  if (preferences.reducedMotion) {
    root.style.setProperty('--animation-duration', '0s');
    root.style.setProperty('--transition-duration', '0s');
  } else {
    root.style.removeProperty('--animation-duration');
    root.style.removeProperty('--transition-duration');
  }
  
  // High contrast
  root.classList.toggle('high-contrast', preferences.highContrast);
  
  // Font size
  const fontSizeMap = {
    small: '14px',
    medium: '16px',
    large: '18px',
  };
  root.style.setProperty('--base-font-size', fontSizeMap[preferences.fontSize]);
};

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useThemeStore = create<ThemeState>()()
  (persist(
    immer((set, get) => {
      const computeEffectiveTheme = () => {
        const { theme } = get();
        return getEffectiveTheme(theme);
      };
      
      const updateDocumentTheme = () => {
        const { colorScheme } = get();
        const effectiveTheme = computeEffectiveTheme();
        applyThemeToDocument(effectiveTheme, colorScheme);
      };
      
      const updateAccessibility = () => {
        const { reducedMotion, highContrast, fontSize } = get();
        applyAccessibilityPreferences({ reducedMotion, highContrast, fontSize });
      };
      
      return {
        // Initial State
        ...defaultPreferences,
        
        // Computed Properties
        get isDark() {
          return computeEffectiveTheme() === 'dark';
        },
        
        get effectiveTheme() {
          return computeEffectiveTheme();
        },
        
        // ====================================================================
        // CORE THEME ACTIONS
        // ====================================================================
        
        setTheme: (theme: Theme) => {
          set((state) => {
            state.theme = theme;
          });
          updateDocumentTheme();
        },
        
        setColorScheme: (colorScheme: ColorScheme) => {
          set((state) => {
            state.colorScheme = colorScheme;
          });
          updateDocumentTheme();
        },
        
        setSidebarState: (sidebarState: SidebarState) => {
          set((state) => {
            state.sidebarState = sidebarState;
          });
        },
        
        setDensity: (density: Density) => {
          set((state) => {
            state.density = density;
          });
          
          // Apply density to document
          if (typeof document !== 'undefined') {
            const root = document.documentElement;
            root.setAttribute('data-density', density);
          }
        },
        
        setFontSize: (fontSize: FontSize) => {
          set((state) => {
            state.fontSize = fontSize;
          });
          updateAccessibility();
        },
        
        // ====================================================================
        // ACCESSIBILITY ACTIONS
        // ====================================================================
        
        toggleReducedMotion: () => {
          set((state) => {
            state.reducedMotion = !state.reducedMotion;
          });
          updateAccessibility();
        },
        
        toggleHighContrast: () => {
          set((state) => {
            state.highContrast = !state.highContrast;
          });
          updateAccessibility();
        },
        
        // ====================================================================
        // UI ACTIONS
        // ====================================================================
        
        toggleAnimations: () => {
          set((state) => {
            state.showAnimations = !state.showAnimations;
          });
        },
        
        toggleTooltips: () => {
          set((state) => {
            state.showTooltips = !state.showTooltips;
          });
        },
        
        toggleCompactMode: () => {
          set((state) => {
            state.compactMode = !state.compactMode;
          });
        },
        
        // ====================================================================
        // MEDICAL UI ACTIONS
        // ====================================================================
        
        toggleMedicalColorCoding: () => {
          set((state) => {
            state.medicalColorCoding = !state.medicalColorCoding;
          });
        },
        
        toggleUrgencyIndicators: () => {
          set((state) => {
            state.urgencyIndicators = !state.urgencyIndicators;
          });
        },
        
        togglePatientPhotoDisplay: () => {
          set((state) => {
            state.patientPhotoDisplay = !state.patientPhotoDisplay;
          });
        },
        
        // ====================================================================
        // DASHBOARD ACTIONS
        // ====================================================================
        
        setDashboardLayout: (layout: 'grid' | 'list') => {
          set((state) => {
            state.dashboardLayout = layout;
          });
        },
        
        setDefaultView: (view: 'dashboard' | 'patients' | 'appointments') => {
          set((state) => {
            state.defaultView = view;
          });
        },
        
        // ====================================================================
        // CALENDAR ACTIONS
        // ====================================================================
        
        setCalendarView: (view: 'month' | 'week' | 'day') => {
          set((state) => {
            state.calendarView = view;
          });
        },
        
        setWorkingHours: (start: string, end: string) => {
          set((state) => {
            state.workingHours = { start, end };
          });
        },
        
        // ====================================================================
        // NOTIFICATION ACTIONS
        // ====================================================================
        
        toggleSound: () => {
          set((state) => {
            state.soundEnabled = !state.soundEnabled;
          });
        },
        
        toggleDesktopNotifications: () => {
          set((state) => {
            state.desktopNotifications = !state.desktopNotifications;
          });
          
          // Request permission if enabling
          if (get().desktopNotifications && 'Notification' in window) {
            Notification.requestPermission();
          }
        },
        
        // ====================================================================
        // UTILITY ACTIONS
        // ====================================================================
        
        resetToDefaults: () => {
          set((state) => {
            Object.assign(state, defaultPreferences);
          });
          updateDocumentTheme();
          updateAccessibility();
        },
        
        importPreferences: (preferences: Partial<ThemePreferences>) => {
          set((state) => {
            Object.assign(state, preferences);
          });
          updateDocumentTheme();
          updateAccessibility();
        },
        
        exportPreferences: () => {
          const state = get();
          const {
            // Remove computed properties and actions
            isDark,
            effectiveTheme,
            setTheme,
            setColorScheme,
            setSidebarState,
            setDensity,
            setFontSize,
            toggleReducedMotion,
            toggleHighContrast,
            toggleAnimations,
            toggleTooltips,
            toggleCompactMode,
            toggleMedicalColorCoding,
            toggleUrgencyIndicators,
            togglePatientPhotoDisplay,
            setDashboardLayout,
            setDefaultView,
            setCalendarView,
            setWorkingHours,
            toggleSound,
            toggleDesktopNotifications,
            resetToDefaults,
            importPreferences,
            exportPreferences,
            ...preferences
          } = state;
          
          return preferences as ThemePreferences;
        },
      };
    }),
    {
      name: 'nova-check-theme',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Apply theme and accessibility settings on rehydration
          const effectiveTheme = getEffectiveTheme(state.theme);
          applyThemeToDocument(effectiveTheme, state.colorScheme);
          applyAccessibilityPreferences({
            reducedMotion: state.reducedMotion,
            highContrast: state.highContrast,
            fontSize: state.fontSize,
          });
          
          // Apply density
          if (typeof document !== 'undefined') {
            const root = document.documentElement;
            root.setAttribute('data-density', state.density);
          }
        }
      },
    }
  ));

// ============================================================================
// SYSTEM THEME LISTENER
// ============================================================================

if (typeof window !== 'undefined') {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  
  const handleSystemThemeChange = () => {
    const { theme, colorScheme } = useThemeStore.getState();
    
    if (theme === 'system') {
      const effectiveTheme = getSystemTheme();
      applyThemeToDocument(effectiveTheme, colorScheme);
    }
  };
  
  mediaQuery.addEventListener('change', handleSystemThemeChange);
}

// ============================================================================
// PREFERS-REDUCED-MOTION LISTENER
// ============================================================================

if (typeof window !== 'undefined') {
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  
  const handleReducedMotionChange = () => {
    const { reducedMotion } = useThemeStore.getState();
    
    // Only auto-enable reduced motion, don't auto-disable it
    if (reducedMotionQuery.matches && !reducedMotion) {
      useThemeStore.getState().toggleReducedMotion();
    }
  };
  
  reducedMotionQuery.addEventListener('change', handleReducedMotionChange);
  
  // Check initial state
  if (reducedMotionQuery.matches) {
    setTimeout(() => {
      const { reducedMotion } = useThemeStore.getState();
      if (!reducedMotion) {
        useThemeStore.getState().toggleReducedMotion();
      }
    }, 0);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default useThemeStore;

// Export utility functions for external use
export { getSystemTheme, getEffectiveTheme };