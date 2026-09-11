import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { loginUser, registerUser, sendAuthHeartbeat } from '../services/api';

const AuthContext = createContext(null);

export const ROLES = {
  ADMIN: 'admin',
  INSPECTOR: 'inspector',
  USER: 'user',
};

export const ROLE_CONFIG = {
  admin: {
    label: 'Super Admin',
    color: '#1d4ed8',
    bg: '#eff6ff',
    border: '#bfdbfe',
    description: 'Full rights: add, delete projects & manage users',
    nav: ['dashboard', 'projects', 'add-project', 'ml-predictions', 'users'],
    canAddProject: true,
    canDeleteProject: true,
    canAssignInspector: true,
    canUpdateStatus: true,
    canManageUsers: true,
    readOnly: false,
  },
  inspector: {
    label: 'Inspector Officer',
    color: '#b45309',
    bg: '#fffbeb',
    border: '#fde68a',
    description: 'In-charge of assigned projects; can update status & inspections',
    nav: ['dashboard', 'projects', 'ml-predictions'],
    canAddProject: false,
    canDeleteProject: false,
    canAssignInspector: false,
    canUpdateStatus: true,
    canManageUsers: false,
    readOnly: false,
  },
  user: {
    label: 'Citizen / Public',
    color: '#15803d',
    bg: '#f0fdf4',
    border: '#bbf7d0',
    description: 'Read-only access to all government project data',
    nav: ['dashboard', 'projects'],
    canAddProject: false,
    canDeleteProject: false,
    canAssignInspector: false,
    canUpdateStatus: false,
    canManageUsers: false,
    readOnly: true,
  },
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem('mospi.authenticatedUser'));
    } catch {
      return null;
    }
  });

  const login = async (role, name, password) => {
    const authenticatedUser = await loginUser({ role, name, password });
    setUser(authenticatedUser);
    window.localStorage.setItem('mospi.authenticatedUser', JSON.stringify(authenticatedUser));
    return authenticatedUser;
  };

  const register = async (role, name, password) => {
    const newUser = await registerUser({ role, name, password });
    setUser(newUser);
    window.localStorage.setItem('mospi.authenticatedUser', JSON.stringify(newUser));
    return newUser;
  };

  const logout = useCallback(() => {
    setUser(null);
    window.localStorage.removeItem('mospi.authenticatedUser');
  }, []);

  useEffect(() => {
    if (!user || user.role !== 'inspector') return undefined;
    const heartbeat = () => sendAuthHeartbeat(user).catch(() => {});
    heartbeat();
    const timer = window.setInterval(heartbeat, 60_000);
    return () => window.clearInterval(timer);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
