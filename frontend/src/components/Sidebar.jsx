import React from 'react';
import {
  LayoutDashboard,
  Database,
  PlusCircle,
  Brain,
  Users,
  ArchiveRestore,
  LogOut,
  Shield,
  ClipboardList,
  Lock,
  Eye
} from 'lucide-react';
import { useAuth, ROLE_CONFIG } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import './Sidebar.css';

const NAV_ITEMS_ALL = {
  en: [
    { id: 'dashboard', label: 'Executive Dashboard', icon: LayoutDashboard },
    { id: 'projects', label: 'Project Portfolio', icon: Database },
    { id: 'add-project', label: 'Add Project Entry', icon: PlusCircle },
    { id: 'ml-predictions', label: 'ML Risk Analytics', icon: Brain },
    { id: 'users', label: 'User Registry', icon: Users },
    { id: 'deleted-backups', label: 'Deleted Project Backups', icon: ArchiveRestore },
  ],
  hi: [
    { id: 'dashboard', label: 'कार्यकारी डैशबोर्ड', icon: LayoutDashboard },
    { id: 'projects', label: 'परियोजना पोर्टफोलियो', icon: Database },
    { id: 'add-project', label: 'नई परियोजना प्रविष्टि', icon: PlusCircle },
    { id: 'ml-predictions', label: 'जोखिम विश्लेषण', icon: Brain },
    { id: 'users', label: 'प्रयोक्ता रजिस्ट्री', icon: Users },
    { id: 'deleted-backups', label: 'हटाए गए प्रोजेक्ट बैकअप', icon: ArchiveRestore },
  ],
};

const NAV_LABELS = {
  en: {
    govtBadge: 'Government of India',
    divisionBadge: 'Infrastructure Monitoring',
    sectionHeader: 'MONITORING MODULES',
    secureBadge: 'NIC Secure Gateway · SSL/TLS',
    officerFallback: 'Authorized Officer',
    signoutTitle: 'Sign out from Government Portal',
    clearances: {
      admin: 'Level-1 Security Clearance',
      inspector: 'Level-2 Field Officer Access',
      user: 'Public Citizen Access',
    },
    roleTitles: {
      admin: 'Super Admin',
      inspector: 'Inspector Officer',
      user: 'Citizen / Public',
    },
  },
  hi: {
    govtBadge: 'भारत सरकार',
    divisionBadge: 'अवसंरचना निगरानी प्रभाग',
    sectionHeader: 'निगरानी मॉड्यूल',
    secureBadge: 'एनआईसी सुरक्षित गेटवे · एसएसएल',
    officerFallback: 'आधिकारिक अधिकारी',
    signoutTitle: 'सरकारी पोर्टल से साइन आउट करें',
    clearances: {
      admin: 'स्तर-1 सुरक्षा क्लीयरेंस',
      inspector: 'स्तर-2 क्षेत्र अधिकारी पहुँच',
      user: 'नागरिक सार्वजनिक पहुँच',
    },
    roleTitles: {
      admin: 'मुख्य प्रशासक',
      inspector: 'निरीक्षण अधिकारी',
      user: 'नागरिक / सार्वजनिक',
    },
  },
};

function getRoleIcon(role) {
  if (role === 'admin') return Shield;
  if (role === 'inspector') return ClipboardList;
  return Eye;
}

export default function Sidebar({ activeTab, setActiveTab }) {
  const { user, logout } = useAuth();
  const { language } = useTheme();
  const role = user?.role || 'user';
  const roleCfg = ROLE_CONFIG[role] || ROLE_CONFIG.user;

  const t = NAV_LABELS[language] || NAV_LABELS.en;
  const allItems = NAV_ITEMS_ALL[language] || NAV_ITEMS_ALL.en;

  const RoleIcon = getRoleIcon(role);
  const isGovernmentViewer = role === 'user' && ['Ministry of Central Govt', 'Ministry of State Govt'].includes(user?.affiliation);
  const roleTitle = isGovernmentViewer ? 'Government Viewer' : (t.roleTitles[role] || role);
  const roleClearance = isGovernmentViewer ? `${user.affiliation} · Read-only Access` : (t.clearances[role] || '');

  const allowedNav = roleCfg.nav || ['dashboard', 'projects'];
  const visibleItems = allItems.filter(item => allowedNav.includes(item.id));

  return (
    <aside className="sidebar">
      <div className="tricolor-strip"></div>

      <div className="sidebar-header">
        <div className="logo" onClick={() => setActiveTab(role === 'user' ? 'projects' : 'dashboard')} style={{ cursor: 'pointer' }}>
          <div className="emblem-box">
            <img className="logic-core-symbol" src="/logic-core-symbol.svg" alt="Logic Core" />
          </div>
          <div className="logo-text">
            <span className="gov-authority-text">{t.govtBadge}</span>
            <h2>LOGIC <span className="text-gradient">CORE</span></h2>
            <span className="gov-sub">Infrastructure Intelligence</span>
          </div>
        </div>
      </div>

      <div className="role-pill-card" style={{ background: roleCfg.bg, borderColor: roleCfg.border }}>
        <div className="role-pill-icon" style={{ color: roleCfg.color }}>
          <RoleIcon size={16} />
        </div>
        <div className="role-pill-details">
          <span className="role-pill-title" style={{ color: roleCfg.color }}>{roleTitle}</span>
          <span className="role-pill-desc">{roleClearance}</span>
        </div>
      </div>

      {role === 'user' && !isGovernmentViewer && (
        <div style={{ margin: '0 12px 10px', padding: '8px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', fontSize: '0.7rem', color: '#15803d', display: 'flex', alignItems: 'flex-start', gap: '6px', lineHeight: 1.4 }}>
          <Eye size={13} style={{ marginTop: '1px', flexShrink: 0 }} />
          <span>Public Transparency Portal – Read-only access to government infrastructure data</span>
        </div>
      )}

      {isGovernmentViewer && (
        <div style={{ margin: '0 12px 10px', padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', fontSize: '0.7rem', color: '#92400e', display: 'flex', alignItems: 'flex-start', gap: '6px', lineHeight: 1.4 }}>
          <Eye size={13} style={{ marginTop: '1px', flexShrink: 0 }} />
          <span>{user.affiliation} Viewer – Read-only until Admin access is approved</span>
        </div>
      )}

      {role === 'inspector' && (
        <div style={{ margin: '0 12px 10px', padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', fontSize: '0.7rem', color: '#92400e', display: 'flex', alignItems: 'flex-start', gap: '6px', lineHeight: 1.4 }}>
          <ClipboardList size={13} style={{ marginTop: '1px', flexShrink: 0 }} />
          <span>You can update status & file inspection reports on your assigned projects</span>
        </div>
      )}

      <nav className="sidebar-nav">
        <div className="nav-group-label">{t.sectionHeader}</div>
        <ul>
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`nav-link ${isActive ? 'active' : ''}`}
                >
                  <Icon size={17} />
                  <span className="nav-main-label">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <div className="nic-badge-bar">
          <Lock size={12} color="#15803d" />
          <span>{t.secureBadge}</span>
        </div>
        <div className="user-profile">
          <div className="avatar" style={{ background: roleCfg.bg, color: roleCfg.color, borderColor: roleCfg.border }}>
            {user?.name ? user.name.charAt(0).toUpperCase() : 'O'}
          </div>
          <div className="user-info">
            <span className="user-name" title={user?.name}>{user?.name || t.officerFallback}</span>
            <span className="user-role">{roleTitle}</span>
          </div>
          <button
            className="btn-logout"
            onClick={logout}
            title={t.signoutTitle}
            type="button"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}

