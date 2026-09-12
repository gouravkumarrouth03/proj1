import React, { useEffect, useState } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProjectsPage from './pages/ProjectsPage';
import AddProjectPage from './pages/AddProjectPage';
import MLPredictionsPage from './pages/MLPredictionsPage';
import UserManagementPage from './pages/UserManagementPage';
import DeletedProjectBackupsPage from './pages/DeletedProjectBackupsPage';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import './App.css';

function MainApp() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (user?.role === 'user') {
      setActiveTab('projects');
    } else if (user) {
      setActiveTab('dashboard');
    }
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;

    window.history.pushState({ authenticatedPortal: true }, '', window.location.href);
    const handleBackNavigation = () => {
      logout();
    };

    window.addEventListener('popstate', handleBackNavigation);
    return () => window.removeEventListener('popstate', handleBackNavigation);
  }, [user, logout]);

  useEffect(() => {
    const openProjectFromNotification = () => {
      setActiveTab('projects');
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('reopen-project-dossier')), 0);
    };
    window.addEventListener('open-project-dossier', openProjectFromNotification);
    return () => window.removeEventListener('open-project-dossier', openProjectFromNotification);
  }, []);

  if (!user) {
    return <LoginPage />;
  }

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  const renderActivePage = () => {
    if (user.role === 'user' && activeTab !== 'projects') {
      return <ProjectsPage key={refreshKey} />;
    }

    switch (activeTab) {
      case 'dashboard':
        return <DashboardPage key={refreshKey} />;
      case 'projects':
        return <ProjectsPage key={refreshKey} />;
      case 'add-project':
        return <AddProjectPage key={refreshKey} />;
      case 'ml-predictions':
        return <MLPredictionsPage key={refreshKey} />;
      case 'users':
        return <UserManagementPage key={refreshKey} />;
      case 'deleted-backups':
        return user.role === 'admin' ? <DeletedProjectBackupsPage key={refreshKey} /> : <ProjectsPage key={refreshKey} />;
      default:
        return <DashboardPage key={refreshKey} />;
    }
  };

  return (
    <div className="app-layout">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="main-content">
        <Header onRefresh={handleRefresh} loading={false} />
        <main className="main-page-wrapper">
          {renderActivePage()}
        </main>

        {/* Official Indian Government Footer */}
        <footer className="gov-footer">
          <div className="gov-footer-tricolor"></div>
          <div className="gov-footer-content">
            <div className="gov-footer-top">
              <div className="gov-footer-branding">
                <div className="gov-footer-emblem">🏛️</div>
                <div>
                  <h4>LOGIC CORE Infrastructure Intelligence</h4>
                  <p>Infrastructure Monitoring &amp; Intelligence Platform</p>
                </div>
              </div>
              <div className="gov-footer-links">
                <a href="#" onClick={event => event.preventDefault()}>LOGIC CORE Portal</a>
                <span>•</span>
                <a href="https://data.gov.in" target="_blank" rel="noreferrer">Open Data (data.gov.in)</a>
                <span>•</span>
                <a href="https://digitalindia.gov.in" target="_blank" rel="noreferrer">Digital India</a>
                <span>•</span>
                <a href="https://nic.in" target="_blank" rel="noreferrer">National Informatics Centre</a>
              </div>
            </div>

            <div className="gov-footer-bottom">
              <p>
                Website Content Managed by LOGIC CORE Infrastructure Intelligence.
              </p>
              <p className="gov-footer-sub">
                Designed, Developed & Hosted by <strong>National Informatics Centre (NIC)</strong> · Last Updated: 11 September 2026 · Compliant with GIGW 3.0
              </p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </ThemeProvider>
  );
}
