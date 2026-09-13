import React, { useState, useEffect, useCallback } from 'react';
import { Brain, TrendingUp, Clock, ShieldAlert, Zap, ClipboardList, CheckCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { API_BASE, authHeaders, refreshMlModel, repredictAssignedProjects } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { UpdateStatusModal } from './ProjectsPage';
import './MLPredictionsPage.css';

function RiskGauge({ score }) {
  const color = score > 75 ? '#dc2626' : score > 50 ? '#d97706' : '#16a34a';
  const label = score > 75 ? 'HIGH' : score > 50 ? 'MEDIUM' : 'LOW';
  return (
    <div className="gauge-pill" style={{ background: color + '12', border: `1px solid ${color}30`, color }}>
      <span className="gauge-num">{score}</span>
      <span className="gauge-lbl">{label}</span>
    </div>
  );
}

export default function MLPredictionsPage() {
  const { user } = useAuth();
  const role = user?.role || 'user';

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState('');
  const [myAssignedOnly, setMyAssignedOnly] = useState(false);
  const [updateProject, setUpdateProject] = useState(null);

  const loadProjects = useCallback(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/v1/projects?limit=50`, { headers: authHeaders(user) })
      .then(r => r.json())
      .then(d => { setProjects(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleRunBatchML = async () => {
    setRefreshing(true);
    setToast('');
    try {
      if (role === 'inspector') {
        const res = await repredictAssignedProjects(user);
        setToast(`⚡ ${res.message}`);
      } else {
        const res = await refreshMlModel(user);
        setToast(`⚡ ${res.message}`);
      }
      loadProjects();
      setTimeout(() => setToast(''), 6000);
    } catch (err) {
      setToast(`❌ ${err.message}`);
      setTimeout(() => setToast(''), 6000);
    } finally {
      setRefreshing(false);
    }
  };

  const displayedProjects = projects.filter(p => {
    if (role === 'inspector' && myAssignedOnly) {
      const isAssigned = p.assigned_officer_id === user?.id ||
        p.assigned_inspector_id === user?.id ||
        (p.assigned_inspector || '').toLowerCase() === (user?.name || '').toLowerCase() ||
        !p.assigned_inspector ||
        (p.assigned_inspector || '').toLowerCase() === 'unassigned' ||
        (p.assigned_inspector || '').toLowerCase() === 'none';
      if (!isAssigned) return false;
    }
    return true;
  });

  const sectorRisk = Object.entries(
    displayedProjects.reduce((acc, p) => {
      if (!acc[p.sector]) acc[p.sector] = { total: 0, count: 0 };
      acc[p.sector].total += p.risk_score;
      acc[p.sector].count += 1;
      return acc;
    }, {})
  ).map(([sector, { total, count }]) => ({ sector: sector.split(' ')[0], avgRisk: Math.round(total / count) }))
    .sort((a, b) => b.avgRisk - a.avgRisk);

  const avgRisk = displayedProjects.length ? (displayedProjects.reduce((s, p) => s + p.risk_score, 0) / displayedProjects.length).toFixed(1) : 0;
  const avgCost = displayedProjects.length ? (displayedProjects.reduce((s, p) => s + p.cost_overrun_prob, 0) / displayedProjects.length * 100).toFixed(1) : 0;
  const avgDelay = displayedProjects.length ? (displayedProjects.reduce((s, p) => s + p.time_delay_prob, 0) / displayedProjects.length * 100).toFixed(1) : 0;
  const highRisk = displayedProjects.filter(p => p.risk_score > 75).length;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 className="page-title">
              {role === 'inspector' ? 'ML Risk Analytics (Inspector Portal)' : 'ML Risk & Delay Analytics'}
            </h2>
            <span style={{
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              color: '#1d4ed8',
              fontSize: '0.72rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '4px',
              textTransform: 'uppercase'
            }}>
              ML-MAYANK Risk Engine
            </span>
          </div>
          <p className="page-subtitle">
            {role === 'inspector'
              ? 'Real-time ML-MAYANK risk predictions on inspector-assigned project parameters and revised field milestone data'
              : 'ML-MAYANK risk scores with legacy cost overrun forecasts and delay estimations across monitored projects'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div className="model-badge-row">
            <span className="model-tag-chip"><Zap size={13} /> XGBoost Cost Model</span>
            <span className="model-tag-chip"><Brain size={13} /> XGBoost Delay Model</span>
            <span className="accuracy-chip">Live Pipeline Active</span>
          </div>

          {['admin', 'inspector'].includes(role) && (
            <button
              type="button"
              className="ml-header-btn"
              onClick={handleRunBatchML}
              disabled={refreshing}
              title="Re-run XGBoost ML pipeline to update risk and overrun metrics"
            >
              {refreshing ? (
                <><span className="ml-spinner" /> Running ML Pipeline...</>
              ) : (
                <><Zap size={14} /> {role === 'inspector' ? 'Update ML on Assigned Projects' : 'Re-run ML on All Projects'}</>
              )}
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div className="ml-toast animate-fade-in">
          {toast}
        </div>
      )}

      {/* Summary KPIs */}
      <div className="ml-kpi-row">
        {[
          { label: 'Portfolio Risk Score', value: avgRisk, icon: ShieldAlert, color: '#dc2626', bg: '#fef2f2' },
          { label: 'Avg Cost Overrun Prob.', value: `${avgCost}%`, icon: TrendingUp, color: '#7c3aed', bg: '#f3f0ff' },
          { label: 'Avg Delay Probability', value: `${avgDelay}%`, icon: Clock, color: '#d97706', bg: '#fffbeb' },
          { label: 'High Risk Projects', value: highRisk, icon: Brain, color: '#2563eb', bg: '#eff6ff' },
        ].map((k, i) => (
          <div key={i} className="ml-kpi glass-panel">
            <div className="ml-kpi-icon" style={{ background: k.bg, color: k.color }}><k.icon size={18} /></div>
            <div>
              <div className="ml-kpi-val" style={{ color: k.color }}>{k.value}</div>
              <div className="ml-kpi-lbl">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="ml-grid">
        {/* Sector Chart */}
        <div className="glass-panel chart-panel">
          <h3 className="panel-h">Avg Risk Score by Sector</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sectorRisk} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="sector" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#6b7280' }} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                formatter={v => [v, 'Avg Risk']}
              />
              <Bar dataKey="avgRisk" radius={[4, 4, 0, 0]}>
                {sectorRisk.map((entry, i) => (
                  <Cell key={i} fill={entry.avgRisk > 70 ? '#dc2626' : entry.avgRisk > 50 ? '#d97706' : '#16a34a'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Distribution */}
        <div className="glass-panel dist-panel">
          <h3 className="panel-h">Risk Distribution</h3>
          <div className="dist-list">
            {[
              { label: 'High Risk (>75)', count: displayedProjects.filter(p => p.risk_score > 75).length, color: '#dc2626', bg: '#fef2f2' },
              { label: 'Medium Risk (50–75)', count: displayedProjects.filter(p => p.risk_score > 50 && p.risk_score <= 75).length, color: '#d97706', bg: '#fffbeb' },
              { label: 'Low Risk (<50)', count: displayedProjects.filter(p => p.risk_score <= 50).length, color: '#16a34a', bg: '#f0fdf4' },
            ].map(d => (
              <div key={d.label} className="dist-item" style={{ background: d.bg }}>
                <div className="dist-label" style={{ color: d.color }}>{d.label}</div>
                <div className="dist-count" style={{ color: d.color }}>{d.count}</div>
                <div className="dist-bar-bg">
                  <div className="dist-bar-fill" style={{ width: `${displayedProjects.length ? (d.count / displayedProjects.length) * 100 : 0}%`, background: d.color }}></div>
                </div>
                <div className="dist-pct" style={{ color: d.color }}>
                  {displayedProjects.length ? Math.round((d.count / displayedProjects.length) * 100) : 0}%
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Predictions Table */}
      <div className="glass-panel table-wrap">
        <div className="panel-h-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h3 className="panel-h">Project-level ML Predictions</h3>
            <span className="pred-note">Updated via XGBoost inference pipeline on latest field inspection metrics</span>
          </div>

          {role === 'inspector' && (
            <button
              type="button"
              className={`inspector-toggle-btn ${myAssignedOnly ? 'active' : ''}`}
              onClick={() => setMyAssignedOnly(v => !v)}
              style={{ padding: '5px 12px', fontSize: '0.76rem' }}
            >
              <ClipboardList size={13} />
              {myAssignedOnly ? 'Showing: My Assigned Projects' : 'Filter: My Assigned Projects'}
            </button>
          )}
        </div>

        <table className="pred-table">
          <thead>
            <tr>
              <th>Project ID</th>
              <th>Project Name</th>
              <th>Sector</th>
              <th>AI Risk Score</th>
              <th>Cost Overrun Prob.</th>
              <th>Delay Prob.</th>
              <th>Status</th>
              <th>Alert Level</th>
              {['admin', 'inspector'].includes(role) && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={9}><div className="row-skel"></div></td></tr>
                ))
              : displayedProjects.sort((a, b) => b.risk_score - a.risk_score).map(p => {
                const alertLevel = p.risk_score > 75 ? 'Critical' : p.risk_score > 50 ? 'Watch' : 'Normal';
                const alertClass = alertLevel === 'Critical' ? 'badge-danger' : alertLevel === 'Watch' ? 'badge-warning' : 'badge-success';
                return (
                  <tr key={p.id} className="trow">
                    <td><span className="proj-id">{p.id}</span></td>
                    <td className="proj-name">{p.name}</td>
                    <td><span className="sector-chip">{p.sector.split(' ')[0]}</span></td>
                    <td><RiskGauge score={p.risk_score} /></td>
                    <td>
                      <div className="prob-bar-wrap">
                        <div className="prob-bar-bg"><div style={{ width: `${p.cost_overrun_prob * 100}%`, background: '#dc2626', height: '100%', borderRadius: 3 }}></div></div>
                        <span style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.8rem' }}>{(p.cost_overrun_prob * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td>
                      <div className="prob-bar-wrap">
                        <div className="prob-bar-bg"><div style={{ width: `${p.time_delay_prob * 100}%`, background: '#d97706', height: '100%', borderRadius: 3 }}></div></div>
                        <span style={{ color: '#d97706', fontWeight: 700, fontSize: '0.8rem' }}>{(p.time_delay_prob * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td><span className={`badge ${p.status === 'Ongoing' || p.status === 'On Schedule' ? 'badge-success' : p.status === 'Delayed' ? 'badge-danger' : 'badge-warning'}`}>{p.status}</span></td>
                    <td><span className={`badge ${alertClass}`}>{alertLevel}</span></td>
                    {['admin', 'inspector'].includes(role) && (
                      <td>
                        <button
                          type="button"
                          className="pred-update-btn"
                          onClick={() => setUpdateProject(p)}
                          title="Update project parameters and run ML prediction on revised data"
                        >
                          <Zap size={12} /> Update ML
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            }
          </tbody>
        </table>
      </div>

      {/* Update & ML Re-predict Modal */}
      {updateProject && (
        <UpdateStatusModal
          project={updateProject}
          user={user}
          onClose={() => setUpdateProject(null)}
          onSave={(updated) => {
            setProjects(prev => prev.map(item => item.id === updated.id ? { ...item, ...updated } : item));
            setUpdateProject(null);
            loadProjects();
          }}
        />
      )}
    </div>
  );
}
