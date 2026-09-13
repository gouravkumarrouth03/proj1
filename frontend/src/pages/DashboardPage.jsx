import React, { useState, useEffect } from 'react';
import { IndianRupee, FolderKanban, ShieldAlert, TrendingUp, RefreshCw, AlertTriangle, X } from 'lucide-react';
import StatCard from '../components/StatCard';
import RiskAlerts from '../components/RiskAlerts';
import ProjectTable from '../components/ProjectTable';
import AIPredictionWidget from '../components/AIPredictionWidget';
import { API_BASE, authHeaders, requestAdminAccess, fetchNotifications, fetchAdminAccessStatus } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './DashboardPage.css';

export default function DashboardPage() {
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [projects, setProjects] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [accessStatus, setAccessStatus] = useState(null);
  const [requestState, setRequestState] = useState('none');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [oRes, pRes, aRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/analytics/overview`, { headers: authHeaders(user) }),
          fetch(`${API_BASE}/api/v1/projects?limit=10`, { headers: authHeaders(user) }),
          fetch(`${API_BASE}/api/v1/predictions/alerts`, { headers: authHeaders(user) }),
        ]);
        setOverview(await oRes.json());
        setProjects(await pRes.json());
        setAlerts(await aRes.json());
      } catch (e) {
        console.error('API error', e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]);

  useEffect(() => {
    if (!user || !isMinistryUser(user)) return;
    let active = true;

    Promise.all([
      fetchNotifications(user),
      fetchAdminAccessStatus(user),
    ])
      .then(([items, statusRes]) => {
        if (!active) return;
        const latestAccessNotice = [...items]
          .filter(item => item.alert_type === 'ACCESS_REQUEST')
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
        setAccessStatus(latestAccessNotice || null);
        setRequestState(statusRes.status || 'none');
      })
      .catch(() => {
        if (active) {
          setAccessStatus(null);
          setRequestState('none');
        }
      });

    return () => { active = false; };
  }, [user]);

  const formatCrore = (val) => {
    if (val === null || val === undefined || isNaN(val)) return '—';
    if (val >= 100000) {
      return `₹${(val / 100000).toFixed(2)} Lakh Cr`;
    }
    return `₹${parseFloat(val).toLocaleString('en-IN', { maximumFractionDigits: 1 })} Cr`;
  };

  const origCost = overview?.total_original_cost || 0;
  const revCost = overview?.total_revised_cost || 0;
  const overrunPct = origCost > 0 && revCost > origCost
    ? (((revCost - origCost) / origCost) * 100).toFixed(1)
    : '0.0';

  const isMinistry = user?.affiliation === 'Ministry of Central Govt' || user?.affiliation === 'Ministry of State Govt';
  const isMinistryUser = (currentUser) =>
    currentUser?.affiliation === 'Ministry of Central Govt' || currentUser?.affiliation === 'Ministry of State Govt';

  useEffect(() => {
    if (accessStatus && accessStatus.message && accessStatus.message.toLowerCase().includes('rejected')) {
      window.alert('Access denied: Your admin access request was rejected.');
    }
  }, [accessStatus]);

  const handleRequestAccess = async () => {
    try {
      await requestAdminAccess(user);
      setRequestState('pending');
      alert('Admin access request submitted successfully.');
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="page-container">
      {accessStatus && accessStatus.message && accessStatus.message.toLowerCase().includes('rejected') && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '10px',
          color: '#991b1b',
          padding: '12px 14px',
          marginBottom: '18px',
          fontSize: '0.88rem',
          fontWeight: 600,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={16} />
            <span>{accessStatus.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setAccessStatus(null)}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#991b1b',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
            aria-label="Dismiss access status"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h2 className="page-title">Executive Infrastructure Dashboard</h2>
            <span className="gov-section-badge">LOGIC CORE</span>
          </div>
          <p className="page-subtitle">
            Centralized monitoring of Central Sector Infrastructure Projects (₹150 Crore & above)
          </p>
        </div>
        <div className="page-date-badge">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
            <div>
              <span>Official Data Cycle:</span>
              <strong>{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
            </div>
            {user?.role !== 'admin' && isMinistry && (
              <button 
                onClick={handleRequestAccess}
                disabled={requestState === 'pending'}
                style={{ padding: '6px 12px', background: requestState === 'pending' ? '#cbd5e1' : requestState === 'rejected' ? '#b91c1c' : '#0a3871', color: requestState === 'pending' ? '#475569' : 'white', border: 'none', borderRadius: '4px', cursor: requestState === 'pending' ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}
              >
                {requestState === 'pending' ? 'Approval Pending' : requestState === 'rejected' ? 'Admin Request Rejected' : 'Request Admin Access'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="stat-cards-grid">
        <StatCard
          title="Monitored Projects"
          value={overview?.total_projects ?? 0}
          subtitle="Registered in Central Database"
          icon={FolderKanban}
          color="#0a3871"
          delay={0}
        />
        <StatCard
          title="Total Revised Sanction"
          value={formatCrore(overview?.total_revised_cost)}
          subtitle={`Original Sanction: ${formatCrore(overview?.total_original_cost)}`}
          icon={IndianRupee}
          trend={parseFloat(overrunPct) > 0 ? parseFloat(overrunPct) : undefined}
          trendLabel="cost escalation"
          color="#b45309"
          delay={100}
        />
        <StatCard
          title="Cumulative Expenditure"
          value={formatCrore(overview?.total_expenditure)}
          subtitle={origCost > 0 ? `${((overview.total_expenditure / (revCost || origCost)) * 100).toFixed(1)}% of revised cost spent` : 'Financial progress'}
          icon={TrendingUp}
          color="#138808"
          delay={200}
        />
        <StatCard
          title="High Risk Projects"
          value={overview?.high_risk_projects ?? 0}
          subtitle={`${overview?.critical_alerts ?? 0} projects flagged by ML model`}
          icon={ShieldAlert}
          color="#c53030"
          delay={300}
        />
      </div>

      <div className="middle-grid">
        <AIPredictionWidget projects={projects} />
        <RiskAlerts alerts={alerts} loading={loading} />
      </div>

      <ProjectTable projects={projects} loading={loading} />
    </div>
  );
}

