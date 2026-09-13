import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { loginUser, registerUser, sendAuthHeartbeat, fetchCurrentUser } from '../services/api';

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
    nav: ['dashboard', 'projects', 'add-project', 'ml-predictions', 'users', 'deleted-backups'],
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
    nav: ['projects'],
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

  const login = async (role, name, password, affiliation = 'Public') => {
    const authenticatedUser = await loginUser({ role, name, password, affiliation });
    setUser(authenticatedUser);
    window.localStorage.setItem('mospi.authenticatedUser', JSON.stringify(authenticatedUser));
    return authenticatedUser;
  };

  const register = async (role, name, password, affiliation = 'Public') => {
    const newUser = await registerUser({ role, name, password, affiliation });
    if (newUser.pending_approval) return newUser;
    setUser(newUser);
    window.localStorage.setItem('mospi.authenticatedUser', JSON.stringify(newUser));
    return newUser;
  };

  const logout = useCallback(() => {
    setUser(null);
    window.localStorage.removeItem('mospi.authenticatedUser');
  }, []);

  const updateUser = (updatedUser) => {
    setUser(updatedUser);
    window.localStorage.setItem('mospi.authenticatedUser', JSON.stringify(updatedUser));
  };

  useEffect(() => {
    if (!user) return undefined;
    const refreshSession = () => {
      fetchCurrentUser(user)
        .then(refreshedUser => {
          if (JSON.stringify(refreshedUser) !== JSON.stringify(user)) {
            setUser(refreshedUser);
            window.localStorage.setItem('mospi.authenticatedUser', JSON.stringify(refreshedUser));
          }
          if (refreshedUser.role === 'inspector') sendAuthHeartbeat(refreshedUser).catch(() => {});
        })
        .catch(() => {});
    };
    refreshSession();
    const timer = window.setInterval(refreshSession, 30_000);
    return () => window.clearInterval(timer);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
