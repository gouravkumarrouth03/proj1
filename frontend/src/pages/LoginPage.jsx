import React, { useState } from 'react';
import { useAuth, ROLE_CONFIG } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Shield,
  User,
  ArrowRight,
  UserPlus,
  LogIn,
  Sun,
  Moon,
  Globe,
  Eye,
  EyeOff,
  Lock,
  CheckCircle2,
  Building2,
  Sparkles,
  KeyRound
} from 'lucide-react';
import './LoginPage.css';

const TRANSLATIONS = {
  en: {
    langCode: 'en',
    langName: 'English',
    otherLangName: 'हिन्दी',
    govTitle: 'Government of India',
    ministry: 'Ministry of Statistics & Programme Implementation',
    division: 'Infrastructure & Project Monitoring Division (IPMD)',
    systemHeading: 'National Project Monitoring & ML Risk Intelligence System',
    systemSub: 'Real-time predictive intelligence for central sector infrastructure projects (₹150 Cr and above).',
    mandateHeader: 'Mandate & Compliance',
    mandates: [
      'Comprehensive Monitoring of Central Sector Projects',
      'Real-time Machine Learning Cost & Milestone Delay Forecasting',
      'Inter-Ministerial Project Steering Committee Coordination',
      'Secured via National Informatics Centre (NIC) Gateway'
    ],
    badges: ['PM GatiShakti NMP', 'Digital India', 'GIGW 3.0 Compliant'],
    tabSignIn: 'Sign In',
    tabRegister: 'Register Account',
    headerSignIn: 'Access Project Portal',
    headerRegister: 'Create Official Account',
    subSignIn: 'Select role and credentials to access real-time ML risk intelligence',
    subRegister: 'New administrative and operational accounts are recorded in SQLite DB',
    quickFillTitle: 'Admin-only default access:',
    adminLabel: 'Super Admin',
    adminDesc: 'Full rights to create, delete projects and manage users',
    userLabel: 'Operations Officer',
    userDesc: 'View project analytics and submit new project forecasts',
    nameLabel: 'Full Official Name',
    namePlaceholder: 'e.g. Administrator or Officer Name',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Enter security password',
    defaultHint: 'Admin default: admin',
    submitSignIn: 'Sign In to Dashboard',
    submitRegister: 'Register Account & Enter',
    processing: 'Authenticating credentials...',
    errorEmpty: 'Please enter both full name and password.',
    securityBadge: 'NIC National Government Cloud · Encrypted Session (AES-256)'
  },
  hi: {
    langCode: 'hi',
    langName: 'हिन्दी',
    otherLangName: 'English',
    govTitle: 'भारत सरकार',
    ministry: 'सांख्यिकी और कार्यक्रम कार्यान्वयन मंत्रालय',
    division: 'अवसंरचना एवं परियोजना निगरानी प्रभाग (IPMD)',
    systemHeading: 'राष्ट्रीय परियोजना निगरानी एवं एआई जोखिम विश्लेषण पोर्टल',
    systemSub: 'केंद्रीय क्षेत्र की अवसंरचना परियोजनाओं (₹150 करोड़ व अधिक) के लिए वास्तविक समय विश्लेषिकी।',
    mandateHeader: 'उद्देश्य एवं सांविधिक अनुपालन',
    mandates: [
      'केंद्रीय क्षेत्र की सभी अवसंरचना परियोजनाओं की सघन निगरानी',
      'मशीन लर्निंग (XGBoost) द्वारा समय और लागत में वृद्धि का सटीक पूर्वानुमान',
      'मंत्रालयीय संचालन समिति के लिए समयबद्ध प्रगति विश्लेषण',
      'राष्ट्रीय सूचना विज्ञान केंद्र (NIC) गेटवे द्वारा पूर्णतः सुरक्षित'
    ],
    badges: ['पीएम गतिशक्ति पोर्टल', 'डिजिटल इंडिया', 'जीआईजीडब्ल्यू 3.0 अनुरूप'],
    tabSignIn: 'लॉग इन करें',
    tabRegister: 'पंजीकरण करें',
    headerSignIn: 'पोर्टल में लॉग इन करें',
    headerRegister: 'नया आधिकारिक खाता बनाएं',
    subSignIn: 'परियोजना विश्लेषिकी देखने के लिए भूमिका और क्रेडेंशियल चुनें',
    subRegister: 'नए प्रशासनिक खाते सीधे सिस्टम डेटाबेस में सुरक्षित रूप से दर्ज होते हैं',
    quickFillTitle: 'केवल एडमिन डिफ़ॉल्ट प्रवेश:',
    adminLabel: 'मुख्य प्रशासक',
    adminDesc: 'परियोजनाओं को जोड़ने, हटाने व उपयोगकर्ता प्रबंधन का पूर्ण अधिकार',
    userLabel: 'संचालन अधिकारी',
    userDesc: 'परियोजना विश्लेषिकी देखने व पूर्वानुमान दर्ज करने का अधिकार',
    nameLabel: 'पूरा आधिकारिक नाम',
    namePlaceholder: 'उदा. प्रशासक या अधिकारी का नाम',
    passwordLabel: 'पासवर्ड',
    passwordPlaceholder: 'पासवर्ड दर्ज करें',
    defaultHint: 'एडमिन डिफ़ॉल्ट: admin',
    submitSignIn: 'डैशबोर्ड में प्रवेश करें',
    submitRegister: 'खाता बनाएं और प्रवेश करें',
    processing: 'सत्यापन किया जा रहा है...',
    errorEmpty: 'कृपया अपना पूरा नाम और पासवर्ड दोनों दर्ज करें।',
    securityBadge: 'एनआईसी राष्ट्रीय सरकारी क्लाउड · एन्क्रिप्टेड सत्र (AES-256)'
  }
};

const DEMO_USERS = {
  admin: 'Administrator',
};

export default function LoginPage() {
  const { login, register } = useAuth();
  const { theme, toggleTheme, language, setLang } = useTheme();

  const t = TRANSLATIONS[language] || TRANSLATIONS.en;

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [selectedRole, setSelectedRole] = useState('admin');
  const [name, setName] = useState('Administrator');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !password) {
      setError(t.errorEmpty);
      return;
    }

    setLoading(true);
    setError('');
    try {
      if (mode === 'register') {
        await register(selectedRole, name.trim(), password);
      } else {
        await login(selectedRole, name.trim(), password);
      }
    } catch (err) {
      setError(err.message || 'Authentication error.');
    } finally {
      setLoading(false);
    }
  };

  const handleRoleSelect = (roleKey) => {
    setSelectedRole(roleKey);
    if (mode === 'login') {
      setName(roleKey === 'admin' ? (DEMO_USERS[roleKey] || '') : '');
      setPassword('');
    }
    setError('');
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    setError('');
    if (newMode === 'register') {
      setName('');
      setPassword('');
    } else {
      setName(selectedRole === 'admin' ? (DEMO_USERS[selectedRole] || '') : '');
      setPassword('');
    }
  };

  const toggleLanguage = () => {
    setLang(language === 'en' ? 'hi' : 'en');
  };

  return (
    <div className="login-root">
      {/* Top Controls Bar */}
      <div className="login-top-bar">
        <div className="top-gov-identity">
          <span className="top-emblem-icon">🏛️</span>
          <span className="top-gov-text">{t.govTitle}</span>
        </div>

        <div className="top-actions">
          <button
            type="button"
            className="top-action-btn lang-toggle-btn"
            onClick={toggleLanguage}
            title={language === 'en' ? 'Switch to Hindi' : 'Switch to English'}
          >
            <Globe size={15} />
            <span className="lang-text">{t.otherLangName}</span>
          </button>

          <button
            type="button"
            className="top-action-btn theme-toggle-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? <Sun size={16} className="sun-icon" /> : <Moon size={16} className="moon-icon" />}
            <span className="theme-text">{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </div>

      <div className="login-wrapper">
        {/* Left Showcase Banner */}
        <div className="login-showcase">
          <div className="showcase-tricolor"></div>
          <div className="showcase-ambient-glow"></div>

          <div className="showcase-header">
            <div className="national-crest">
              <span className="crest-symbol">🏛️</span>
            </div>
            <div className="showcase-title-block">
              <span className="authority-tag">{t.govTitle}</span>
              <h1 className="portal-brand-name">MoSPI <span className="highlight-text">IPMD</span></h1>
              <p className="ministry-title">{t.ministry}</p>
              <p className="division-title">{t.division}</p>
            </div>
          </div>

          <div className="showcase-card mandate-card">
            <div className="mandate-card-title">
              <Sparkles size={16} color="#fbbf24" />
              <span>{t.mandateHeader}</span>
            </div>
            <ul className="mandate-list">
              {t.mandates.map((item, idx) => (
                <li key={idx}>
                  <CheckCircle2 size={15} className="mandate-check-icon" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="showcase-badges-row">
            {t.badges.map((b, i) => (
              <span key={i} className="portal-initiative-chip">{b}</span>
            ))}
          </div>

          <div className="showcase-footer">
            <Lock size={13} color="#4ade80" />
            <span>{t.securityBadge}</span>
          </div>
        </div>

        {/* Right Authentication Form Panel */}
        <div className="login-auth-panel">
          <div className="auth-card">
            {/* Mode Switcher Tabs */}
            <div className="auth-tab-pill">
              <button
                type="button"
                className={`tab-switch-btn ${mode === 'login' ? 'active' : ''}`}
                onClick={() => switchMode('login')}
              >
                <LogIn size={15} />
                <span>{t.tabSignIn}</span>
              </button>
              <button
                type="button"
                className={`tab-switch-btn ${mode === 'register' ? 'active' : ''}`}
                onClick={() => switchMode('register')}
              >
                <UserPlus size={15} />
                <span>{t.tabRegister}</span>
              </button>
            </div>

            <div className="auth-header">
              <h2 className="auth-title">{mode === 'login' ? t.headerSignIn : t.headerRegister}</h2>
              <p className="auth-subtitle">{mode === 'login' ? t.subSignIn : t.subRegister}</p>
            </div>

            {/* Role Selectors */}
            <div className="role-selector-grid">
              <div
                className={`role-option-card ${selectedRole === 'admin' ? 'active' : ''}`}
                onClick={() => handleRoleSelect('admin')}
              >
                <div className="role-icon-box admin-icon-box">
                  <Shield size={18} />
                </div>
                <div className="role-text-box">
                  <span className="role-heading">{t.adminLabel}</span>
                  <span className="role-info">{t.adminDesc}</span>
                </div>
                {selectedRole === 'admin' && <div className="role-active-indicator">✓</div>}
              </div>

              <div
                className={`role-option-card ${selectedRole === 'inspector' ? 'active' : ''}`}
                style={selectedRole === 'inspector' ? { borderColor: '#fbbf24', background: '#fffbeb' } : {}}
                onClick={() => handleRoleSelect('inspector')}
              >
                <div className="role-icon-box" style={{ background: '#fef3c7', color: '#92400e' }}>
                  <KeyRound size={18} />
                </div>
                <div className="role-text-box">
                  <span className="role-heading" style={selectedRole === 'inspector' ? { color: '#92400e' } : {}}>
                    {language === 'hi' ? 'निरीक्षण अधिकारी' : 'Inspector Officer'}
                  </span>
                  <span className="role-info">
                    {language === 'hi' ? 'असाइन परियोजनाओं की स्थिति अपडेट करें' : 'Update status of assigned projects & file inspection reports'}
                  </span>
                </div>
                {selectedRole === 'inspector' && <div className="role-active-indicator" style={{ background: '#92400e' }}>✓</div>}
              </div>

              <div
                className={`role-option-card ${selectedRole === 'user' ? 'active' : ''}`}
                style={selectedRole === 'user' ? { borderColor: '#86efac', background: '#f0fdf4' } : {}}
                onClick={() => handleRoleSelect('user')}
              >
                <div className="role-icon-box user-icon-box" style={selectedRole === 'user' ? { background: '#dcfce7', color: '#15803d' } : {}}>
                  <User size={18} />
                </div>
                <div className="role-text-box">
                  <span className="role-heading" style={selectedRole === 'user' ? { color: '#15803d' } : {}}>{t.userLabel}</span>
                  <span className="role-info">{t.userDesc}</span>
                </div>
                {selectedRole === 'user' && <div className="role-active-indicator" style={{ background: '#15803d' }}>✓</div>}
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="auth-form">
              <div className="auth-field-group">
                <label className="auth-field-label">{t.fullNameLabel}</label>
                <div className="auth-input-container">
                  <User size={17} className="input-prefix-icon" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t.fullNamePlaceholder}
                    className="auth-input"
                    required
                  />
                </div>
              </div>

              <div className="auth-field-group">
                <div className="auth-label-row">
                  <label className="auth-field-label">{t.passwordLabel}</label>
                </div>
                <div className="auth-input-container">
                  <Lock size={17} className="input-prefix-icon" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError('');
                    }}
                    placeholder={t.passwordPlaceholder}
                    className="auth-input"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowPassword(v => !v)}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="auth-error-banner">
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="auth-submit-btn"
                disabled={loading}
              >
                <span>{loading ? t.processing : (mode === 'register' ? t.submitRegister : t.submitSignIn)}</span>
                <ArrowRight size={17} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
