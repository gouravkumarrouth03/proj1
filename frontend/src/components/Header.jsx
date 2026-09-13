import React, { useState, useEffect } from 'react';
import { RefreshCw, Globe, Clock, Sun, Moon, Bell, X, KeyRound, Lock } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { fetchNotifications, markNotificationRead, changePassword, fetchAccessRequests, approveAccessRequest, rejectAccessRequest } from '../services/api';
import './Header.css';

const HEADER_TEXT = {
  en: {
    govt: 'Government of India',
    ministryTag: 'LOGIC CORE Infrastructure Intelligence',
    divisionSubtitle: 'Infrastructure Intelligence Platform',
    portalTitle: 'Infrastructure Monitoring & ML Risk Assessment',
    langToggleLabel: 'हिन्दी',
    refreshBtn: 'Refresh',
    themeLight: 'Light',
    themeDark: 'Dark',
  },
  hi: {
    govt: 'भारत सरकार',
    ministryTag: 'लॉजिक कोर अवसंरचना इंटेलिजेंस',
    divisionSubtitle: 'अवसंरचना इंटेलिजेंस प्लेटफॉर्म',
    portalTitle: 'अवसंरचना निगरानी एवं एआई जोखिम विश्लेषण',
    langToggleLabel: 'English',
    refreshBtn: 'ताज़ा करें',
    themeLight: 'लाइट',
    themeDark: 'डार्क',
  }
};

export default function Header({ onRefresh, loading }) {
  const { user, updateUser } = useAuth();
  const { theme, toggleTheme, language, setLang } = useTheme();
  const [time, setTime] = useState(new Date());
  const [fontSize, setFontSize] = useState('normal'); // 'small' | 'normal' | 'large'
  const [notifications, setNotifications] = useState([]);
  const [accessRequests, setAccessRequests] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(Boolean(user?.must_change_password));
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  const t = HEADER_TEXT[language] || HEADER_TEXT.en;

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    const loadNotifications = () => fetchNotifications(user).then(items => {
      if (active) setNotifications(items);
    }).catch(() => {});
    const loadAccessRequests = () => {
      if (user.role !== 'admin') return;
      fetchAccessRequests(user).then(items => {
        if (active) setAccessRequests(items.filter(item => item.status === 'pending'));
      }).catch(() => {});
    };
    loadNotifications();
    loadAccessRequests();
    const timer = setInterval(loadNotifications, 5000);
    const requestTimer = setInterval(loadAccessRequests, 30000);
    return () => { active = false; clearInterval(timer); clearInterval(requestTimer); };
  }, [user]);

  useEffect(() => {
    if (!user || !showNotifications) return undefined;
    fetchNotifications(user)
      .then(items => setNotifications(items))
      .catch(() => {});
    return undefined;
  }, [user, showNotifications]);

  useEffect(() => {
    if (user?.must_change_password) setShowPasswordDialog(true);
  }, [user]);

  const handlePasswordChange = async (event) => {
    event.preventDefault();
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setPasswordSaving(true);
    setPasswordError('');
    try {
      const updated = await changePassword(passwordForm, user);
      updateUser(updated);
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
      setShowPasswordDialog(false);
    } catch (error) {
      setPasswordError(error.message);
    } finally {
      setPasswordSaving(false);
    }
  };

  const unreadCount = notifications.filter(item => !item.read_at).length + (user?.role === 'admin' ? accessRequests.length : 0);

  const resolveAccessRequest = async (requestId, action) => {
    try {
      if (action === 'approve') await approveAccessRequest(requestId, user);
      else await rejectAccessRequest(requestId, user);
      setAccessRequests(prev => prev.filter(item => item.id !== requestId));
    } catch (error) {
      window.alert(error.message || 'Could not resolve access request.');
    }
  };

  const handleNotificationClick = async (notification) => {
    if (!notification.read_at) {
      await markNotificationRead(notification.id, user).catch(() => {});
      setNotifications(prev => prev.map(item => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
    }
    if (notification.project_id) {
      window.sessionStorage.setItem('mospi.notificationProjectId', notification.project_id);
      window.dispatchEvent(new CustomEvent('open-project-dossier', { detail: notification.project_id }));
    }
    setShowNotifications(false);
  };

  const changeFontSize = (size) => {
    setFontSize(size);
    if (size === 'small') document.documentElement.style.fontSize = '14px';
    else if (size === 'normal') document.documentElement.style.fontSize = '16px';
    else if (size === 'large') document.documentElement.style.fontSize = '18px';
  };

  const toggleLanguage = () => {
    setLang(language === 'en' ? 'hi' : 'en');
  };

  return (
    <header className="gov-header-wrapper">
      {/* Top Gov. of India Utility Bar */}
      <div className="gov-top-bar">
        <div className="gov-top-left">
          <span className="gov-flag-text">🏛️ {t.govt}</span>
          <span className="gov-sep">|</span>
          <span className="gov-ministry-tag">{t.ministryTag}</span>
        </div>

        <div className="gov-top-right">
          <div className="accessibility-tools">
            <button
              type="button"
              className={`font-btn ${fontSize === 'small' ? 'active' : ''}`}
              onClick={() => changeFontSize('small')}
              title="Decrease text size"
            >
              A-
            </button>
            <button
              type="button"
              className={`font-btn ${fontSize === 'normal' ? 'active' : ''}`}
              onClick={() => changeFontSize('normal')}
              title="Standard text size"
            >
              A
            </button>
            <button
              type="button"
              className={`font-btn ${fontSize === 'large' ? 'active' : ''}`}
              onClick={() => changeFontSize('large')}
              title="Increase text size"
            >
              A+
            </button>
          </div>

          <span className="gov-sep">|</span>

          {/* Theme Toggle (Dark / Light) */}
          <button
            type="button"
            className="theme-switch-header-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? <Sun size={13} className="header-sun-icon" /> : <Moon size={13} className="header-moon-icon" />}
            <span>{theme === 'dark' ? t.themeLight : t.themeDark}</span>
          </button>

          <span className="gov-sep">|</span>

          {/* Language Switch */}
          <button
            type="button"
            className="lang-switch-btn"
            onClick={toggleLanguage}
            title="Toggle Language"
          >
            <Globe size={13} />
            <span>{t.langToggleLabel}</span>
          </button>

          <span className="gov-sep">|</span>

          <div className="gov-time-badge">
            <Clock size={12} />
            <span>{time.toLocaleTimeString('en-IN', { hour12: true })} IST</span>
          </div>
        </div>
      </div>

      {/* Main Official Header Bar */}
      <div className="dashboard-header">
        <div className="header-left">
          <div className="emblem-group">
            <div className="emblem-crest">
              <img className="logic-core-symbol" src="/logic-core-symbol.svg" alt="Logic Core" />
            </div>
            <div className="header-titles">
              <p className="header-subtitle">
                {t.divisionSubtitle}
              </p>
              <h1 className="header-title">
                {t.portalTitle}
              </h1>
            </div>
          </div>
        </div>

        <div className="header-right">
          <div className="gov-brand-pills">
            <span className="gov-brand-pill gati">PM GatiShakti</span>
            <span className="gov-brand-pill digital">Digital India</span>
          </div>
          <button
            className={`refresh-btn ${loading ? 'spinning' : ''}`}
            onClick={onRefresh}
            title="Refresh Live National Database"
            type="button"
          >
            <RefreshCw size={15} />
            <span className="refresh-text">{t.refreshBtn}</span>
          </button>
          {user && (
            <div className="notification-wrap">
              <button className="notification-btn" type="button" onClick={() => setShowNotifications(value => !value)} title="Notifications">
                <Bell size={16} />
                {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </button>
              {showNotifications && (
                <div className="notification-panel">
                  <div className="notification-panel-header"><strong>Notifications</strong><button type="button" onClick={() => setShowNotifications(false)}><X size={14} /></button></div>
                  {user.role === 'admin' && accessRequests.length > 0 && (
                    <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', background: '#fffbeb' }}>
                      <strong style={{ display: 'block', color: '#92400e', fontSize: '0.8rem', marginBottom: '8px' }}>Admin Access Requests</strong>
                      {accessRequests.map(request => (
                        <div key={request.id} style={{ padding: '8px 0', borderTop: '1px solid #fde68a' }}>
                          <div style={{ color: '#334155', fontSize: '0.78rem', lineHeight: 1.35 }}>
                            <strong>{request.user_name}</strong> requested Admin access
                            <small style={{ display: 'block', color: '#92400e' }}>{request.affiliation}</small>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', marginTop: '7px' }}>
                            <button type="button" onClick={() => resolveAccessRequest(request.id, 'approve')} style={{ border: 0, borderRadius: '4px', padding: '4px 8px', background: '#15803d', color: '#fff', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700 }}>Approve</button>
                            <button type="button" onClick={() => resolveAccessRequest(request.id, 'reject')} style={{ border: 0, borderRadius: '4px', padding: '4px 8px', background: '#b91c1c', color: '#fff', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700 }}>Reject</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {notifications.length === 0 && (user.role !== 'admin' || accessRequests.length === 0) && <div className="notification-empty">No notifications</div>}
                  {notifications.map(notification => (
                    <button key={notification.id} type="button" className={`notification-item ${notification.read_at ? 'read' : 'unread'}`} onClick={() => handleNotificationClick(notification)}>
                      <span>{notification.message}</span>
                      <small>{notification.project_name || 'Portal update'} · {new Date(notification.created_at).toLocaleString('en-IN')}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {user && (
            <button className="password-header-btn" type="button" onClick={() => setShowPasswordDialog(true)} title="Change password">
              <KeyRound size={15} />
              <span>Password</span>
            </button>
          )}
        </div>
      </div>
      {showPasswordDialog && user && (
        <div className="password-modal-overlay">
          <div className="password-modal" role="dialog" aria-modal="true">
            <div className="password-modal-title"><Lock size={18} /> <strong>{user.must_change_password ? 'Set your new password' : 'Change password'}</strong></div>
            <p>{user.must_change_password ? 'Your temporary officer credentials must be replaced before continuing.' : 'Use a strong password with at least 8 characters.'}</p>
            <form onSubmit={handlePasswordChange}>
              <label>Current password<input type="password" required value={passwordForm.current_password} onChange={e => setPasswordForm(prev => ({ ...prev, current_password: e.target.value }))} /></label>
              <label>New password<input type="password" required minLength={8} value={passwordForm.new_password} onChange={e => setPasswordForm(prev => ({ ...prev, new_password: e.target.value }))} /></label>
              <label>Confirm new password<input type="password" required minLength={8} value={passwordForm.confirm_password} onChange={e => setPasswordForm(prev => ({ ...prev, confirm_password: e.target.value }))} /></label>
              {passwordError && <div className="password-error">{passwordError}</div>}
              <div className="password-modal-actions">
                {!user.must_change_password && <button type="button" className="btn-secondary" onClick={() => setShowPasswordDialog(false)}>Cancel</button>}
                <button type="submit" className="btn-primary" disabled={passwordSaving}>{passwordSaving ? 'Saving...' : 'Update password'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
}


