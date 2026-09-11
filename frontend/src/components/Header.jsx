import React, { useState, useEffect } from 'react';
import { RefreshCw, Globe, Clock, Sun, Moon, Bell, X } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { fetchNotifications, markNotificationRead } from '../services/api';
import './Header.css';

const HEADER_TEXT = {
  en: {
    govt: 'Government of India',
    ministryTag: 'Ministry of Statistics & Programme Implementation (MoSPI)',
    divisionSubtitle: 'Infrastructure & Project Monitoring Division (IPMD)',
    portalTitle: 'National Infrastructure Monitoring & ML Risk Assessment Portal',
    langToggleLabel: 'हिन्दी',
    refreshBtn: 'Refresh',
    themeLight: 'Light',
    themeDark: 'Dark',
  },
  hi: {
    govt: 'भारत सरकार',
    ministryTag: 'सांख्यिकी और कार्यक्रम कार्यान्वयन मंत्रालय (MoSPI)',
    divisionSubtitle: 'अवसंरचना एवं परियोजना निगरानी प्रभाग (IPMD)',
    portalTitle: 'राष्ट्रीय अवसंरचना निगरानी एवं एआई जोखिम विश्लेषण पोर्टल',
    langToggleLabel: 'English',
    refreshBtn: 'ताज़ा करें',
    themeLight: 'लाइट',
    themeDark: 'डार्क',
  }
};

export default function Header({ onRefresh, loading }) {
  const { user } = useAuth();
  const { theme, toggleTheme, language, setLang } = useTheme();
  const [time, setTime] = useState(new Date());
  const [fontSize, setFontSize] = useState('normal'); // 'small' | 'normal' | 'large'
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const t = HEADER_TEXT[language] || HEADER_TEXT.en;

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user || user.role === 'user') return undefined;
    let active = true;
    const loadNotifications = () => fetchNotifications(user).then(items => {
      if (active) setNotifications(items);
    }).catch(() => {});
    loadNotifications();
    const timer = setInterval(loadNotifications, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [user]);

  const unreadCount = notifications.filter(item => !item.read_at).length;

  const handleNotificationClick = async (notification) => {
    if (!notification.read_at) {
      await markNotificationRead(notification.id, user).catch(() => {});
      setNotifications(prev => prev.map(item => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
    }
    window.sessionStorage.setItem('mospi.notificationProjectId', notification.project_id);
    window.dispatchEvent(new CustomEvent('open-project-dossier', { detail: notification.project_id }));
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
              <span style={{ fontSize: '20px' }}>🏛️</span>
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
          {user && user.role !== 'user' && (
            <div className="notification-wrap">
              <button className="notification-btn" type="button" onClick={() => setShowNotifications(value => !value)} title="Notifications">
                <Bell size={16} />
                {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </button>
              {showNotifications && (
                <div className="notification-panel">
                  <div className="notification-panel-header"><strong>Notifications</strong><button type="button" onClick={() => setShowNotifications(false)}><X size={14} /></button></div>
                  {notifications.length === 0 && <div className="notification-empty">No notifications</div>}
                  {notifications.map(notification => (
                    <button key={notification.id} type="button" className={`notification-item ${notification.read_at ? 'read' : 'unread'}`} onClick={() => handleNotificationClick(notification)}>
                      <span>{notification.message}</span>
                      <small>{notification.project_name} · {new Date(notification.created_at).toLocaleString('en-IN')}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}


