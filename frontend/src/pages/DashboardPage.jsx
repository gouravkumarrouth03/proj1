import React, { useState, useEffect } from 'react';
import { IndianRupee, FolderKanban, ShieldAlert, TrendingUp, RefreshCw, AlertTriangle } from 'lucide-react';
import StatCard from '../components/StatCard';
import RiskAlerts from '../components/RiskAlerts';
import ProjectTable from '../components/ProjectTable';
import AIPredictionWidget from '../components/AIPredictionWidget';
import { API_BASE, authHeaders } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './DashboardPage.css';

export default function DashboardPage() {
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [projects, setProjects] = useState([]);
  const [alerts, setAlerts] = useState([]);
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

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <h2 className="page-title">Executive Infrastructure Dashboard</h2>
            <span className="gov-section-badge">IPMD · MoSPI</span>
          </div>
          <p className="page-subtitle">
            Centralized monitoring of Central Sector Infrastructure Projects (₹150 Crore & above)
          </p>
        </div>
        <div className="page-date-badge">
          <span>Official Data Cycle:</span>
          <strong>{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
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

