import React, { useState, useEffect, useCallback } from 'react';
import { Search, Filter, Download, Eye, Trash2, Database, ClipboardList, UserPlus, X, CheckCircle, AlertCircle, MapPin, Brain, Zap, TrendingUp, Clock, ShieldAlert, MessageSquare, ImagePlus, Send, History } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { API_BASE, authHeaders, deleteProject, updateProjectStatus, assignProjectInspector, fetchInspectors, repredictProject, repredictAssignedProjects, fetchProjectComments, addProjectComment, requestAdminAccess, fetchProjectHistory, fetchAdminAccessStatus } from '../services/api';
import { useAuth, ROLE_CONFIG } from '../context/AuthContext';
import AdminAccessRequestModal from '../components/AdminAccessRequestModal';
import './ProjectsPage.css';

const INDIAN_STATES = [
  'All',
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh',
  'Andaman & Nicobar Islands', 'Dadra & Nagar Haveli',
  'Multi-State', 'PAN India',
];

const SECTORS = [
  'All',
  'Transport & Logistics', 'Energy', 'Water & Sanitation', 'Communication',
  'Social Infrastructure', 'Coal', 'Steel', 'Mining', 'Urban Development',
];

const statusBadge = {
  'Ongoing': 'badge-success',
  'On Schedule': 'badge-success',
  'Delayed': 'badge-danger',
  'At Risk': 'badge-warning',
  'Completed': 'badge-completed',
};

function RiskBar({ score }) {
  const color = score > 75 ? '#dc2626' : score > 50 ? '#d97706' : '#16a34a';
  return (
    <div className="risk-bar-wrapper">
      <div className="risk-bar-bg">
        <div className="risk-bar-fill" style={{ width: `${score}%`, background: color }}></div>
      </div>
      <span style={{ color, fontWeight: 700, fontSize: '0.8rem', width: 28 }}>{score}</span>
    </div>
  );
}

// ── ML Prediction Result Panel ─────────────────────────────────────────────────
export function MLResultPanel({ result, onClose }) {
  const riskColor = result.risk_score > 75 ? '#dc2626' : result.risk_score > 50 ? '#d97706' : '#16a34a';
  const riskBg = result.risk_score > 75 ? '#fef2f2' : result.risk_score > 50 ? '#fffbeb' : '#f0fdf4';
  return (
    <div className="ml-result-panel">
      <div className="ml-result-header">
        <span className="ml-result-title"><Brain size={15} /> ML Prediction Results</span>
        <span className="ml-source-badge">{result.model_source === 'ml_mayank_only' ? '⚡ ML Risk Engine' : result.model_source === 'xgboost_pkl' ? '⚡ XGBoost Pipeline' : result.model_source === 'partial_xgboost' ? '⚡ Partial XGBoost' : '📐 Formula Fallback'}</span>
      </div>
      <div className="ml-result-kpis">
        <div className="ml-result-kpi" style={{ background: riskBg, border: `1px solid ${riskColor}22` }}>
          <ShieldAlert size={16} color={riskColor} />
          <div className="ml-result-kpi-val" style={{ color: riskColor }}>{result.risk_score}</div>
          <div className="ml-result-kpi-lbl">Risk Score</div>
          <div className="ml-result-risk-badge" style={{ background: riskColor, color: '#fff' }}>{result.risk_level}</div>
        </div>
        <div className="ml-result-kpi" style={{ background: '#fef2f2', border: '1px solid #dc262622' }}>
          <TrendingUp size={16} color="#dc2626" />
          <div className="ml-result-kpi-val" style={{ color: '#dc2626' }}>{(result.cost_overrun_prob * 100).toFixed(0)}%</div>
          <div className="ml-result-kpi-lbl">Cost Overrun Prob.</div>
          {result.predicted_cost_overrun_cr > 0 && <div className="ml-result-kpi-sub">+₹{result.predicted_cost_overrun_cr.toLocaleString('en-IN')} Cr</div>}
        </div>
        <div className="ml-result-kpi" style={{ background: '#fffbeb', border: '1px solid #d9770622' }}>
          <Clock size={16} color="#d97706" />
          <div className="ml-result-kpi-val" style={{ color: '#d97706' }}>{(result.time_delay_prob * 100).toFixed(0)}%</div>
          <div className="ml-result-kpi-lbl">Delay Probability</div>
          {result.predicted_delay_months > 0 && <div className="ml-result-kpi-sub">~{result.predicted_delay_months}m delay</div>}
        </div>
      </div>
      {result.top_risk_factors?.length > 0 && (
        <div className="ml-result-factors">
          <div className="ml-result-factors-title">Top Risk Factors</div>
          {result.top_risk_factors.map((f, i) => (
            <div key={i} className="ml-result-factor-item"><AlertCircle size={12} color="#d97706" /> {f}</div>
          ))}
        </div>
      )}
      {result.recommended_action && (
        <div className="ml-result-recommendation">
          <CheckCircle size={13} color="#16a34a" style={{ flexShrink: 0 }} />
          <span>{result.recommended_action}</span>
        </div>
      )}
    </div>
  );
}

// ── Update Status Modal (Inspector / Admin) ────────────────────────────────────
export function UpdateStatusModal({ project, user, onClose, onSave }) {
  const [form, setForm] = useState({
    status: project.status || 'Ongoing',
    project_status: project.project_status || 'Ongoing',
    physical_progress: project.physical_progress ?? '',
    revised_completion_date: project.revised_completion_date || '',
    inspection_notes: project.inspection_notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [mlLoading, setMlLoading] = useState(false);
  const [mlResult, setMlResult] = useState(null);
  const [mlErr, setMlErr] = useState('');
  const [runMlPrediction, setRunMlPrediction] = useState(true);

  const handleRunMLPrediction = async () => {
    setMlLoading(true); setMlErr(''); setMlResult(null);
    try {
      const overrides = {};
      if (form.physical_progress !== '') overrides.physical_progress = parseFloat(form.physical_progress);
      if (form.revised_completion_date) overrides.revised_completion_date = form.revised_completion_date;
      const result = await repredictProject(project.id, overrides, user);
      setMlResult(result);
    } catch (e) {
      setMlErr(e.message);
    } finally {
      setMlLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true); setErr('');
    try {
      const updated = await updateProjectStatus(project.id, {
        status: form.status,
        project_status: form.project_status,
        physical_progress: parseFloat(form.physical_progress) || undefined,
        revised_completion_date: form.revised_completion_date || undefined,
        inspection_notes: form.inspection_notes || undefined,
        run_ml_prediction: runMlPrediction,
      }, user);
      onSave(updated);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box--ml" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title"><ClipboardList size={17} /> Update Inspection Report</div>
            <div className="modal-sub">{project.id} · {project.name}</div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        {user?.role === 'inspector' && (
          <div className="inspector-modal-badge">
            <ClipboardList size={13} />
            <span>Inspector Field Verification · Automatic XGBoost ML update enabled on submit</span>
          </div>
        )}
        <div className="modal-body">
          <div className="modal-row">
            <label>Operational Status</label>
            <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
              <option>Ongoing</option>
              <option>Delayed</option>
              <option>At Risk</option>
              <option>Completed</option>
            </select>
          </div>
          <div className="modal-row">
            <label>Project Status</label>
            <select value={form.project_status} onChange={e => setForm(p => ({ ...p, project_status: e.target.value }))}>
              <option>Ongoing</option>
              <option>Completed</option>
              <option>Mega Delayed</option>
              <option>Shelved</option>
              <option>Yet to Commence</option>
            </select>
          </div>
          <div className="modal-row">
            <label>Physical Progress (%)</label>
            <input type="number" min="0" max="100" value={form.physical_progress}
              onChange={e => setForm(p => ({ ...p, physical_progress: e.target.value }))} placeholder="e.g. 65" />
          </div>
          <div className="modal-row">
            <label>Revised Completion Date</label>
            <input type="date" value={form.revised_completion_date}
              onChange={e => setForm(p => ({ ...p, revised_completion_date: e.target.value }))} />
          </div>
          <div className="modal-row">
            <label>Inspection Notes / Field Remarks</label>
            <textarea rows={3} value={form.inspection_notes}
              onChange={e => setForm(p => ({ ...p, inspection_notes: e.target.value }))}
              placeholder="Enter official field inspection remarks, site observations, issues encountered..." />
          </div>

          {/* ── ML Prediction Section ── */}
          <div className="ml-predict-section">
            <div className="ml-predict-header">
              <Brain size={15} />
              <span>Run ML Prediction on Revised Data</span>
              <span className="ml-predict-hint">Uses XGBoost models with your updated progress &amp; dates</span>
            </div>
            <button
              type="button"
              className="ml-predict-btn"
              onClick={handleRunMLPrediction}
              disabled={mlLoading}
            >
              {mlLoading
                ? <><span className="ml-spinner" />Running XGBoost Pipeline...</>
                : <><Zap size={14} /> Run ML Prediction</>}
            </button>
            {mlErr && <div className="modal-error" style={{ marginTop: 8 }}><AlertCircle size={13} /> {mlErr}</div>}
            {mlResult && <MLResultPanel result={mlResult} />}
          </div>

          <label className="ml-save-toggle">
            <input
              type="checkbox"
              checked={runMlPrediction}
              onChange={e => setRunMlPrediction(e.target.checked)}
            />
            <span>
              <strong>Run ML prediction again when saving</strong>
              <small>Recalculate the project risk score using the updated progress and completion date.</small>
            </span>
          </label>

          {err && <div className="modal-error"><AlertCircle size={14} /> {err}</div>}
        </div>
        <div className="modal-footer">
          <button className="modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="modal-btn-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : <><CheckCircle size={14} /> Submit Inspection Report</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectHistoryModal({ project, user, onClose }) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadHistory = async () => {
    setLoading(true);
    setError('');
    try {
      setHistory(await fetchProjectHistory(project.id, user, fromDate, toDate));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadHistory(); }, [project.id]);

  const formatHistoryTimestamp = (value) => {
    if (!value) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
      });
    }
    const utcValue = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
    return new Date(utcValue).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true, timeZone: 'Asia/Kolkata',
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box--ml" onClick={event => event.stopPropagation()} style={{ maxWidth: '980px' }}>
        <div className="modal-header">
          <div>
            <div className="modal-title"><History size={17} /> Project Update History</div>
            <div className="modal-sub">{project.id} · {project.name}</div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: '10px', alignItems: 'end', flexWrap: 'wrap', marginBottom: '16px' }}>
            <label className="modal-row" style={{ margin: 0 }}><span>From date</span><input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} /></label>
            <label className="modal-row" style={{ margin: 0 }}><span>To date</span><input type="date" value={toDate} onChange={event => setToDate(event.target.value)} /></label>
            <button type="button" className="modal-btn-save" onClick={loadHistory}>Apply Filter</button>
          </div>
          {error && <div className="modal-error"><AlertCircle size={14} /> {error}</div>}
          {loading ? <div className="empty-state">Loading project history...</div> : history.length === 0 ? <div className="empty-state">No history entries match the selected dates.</div> : (
            <div style={{ display: 'grid', gap: '12px' }}>
              {history.map(entry => (
                <article key={entry.id} style={{ border: '1px solid #dbe4ee', borderLeft: '4px solid #1d4ed8', borderRadius: '6px', padding: '12px', background: '#f8fafc' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    <strong style={{ color: '#1e3a8a' }}>{entry.event_type.replaceAll('_', ' ')}</strong>
                    <span style={{ color: '#64748b', fontSize: '0.78rem' }}>{formatHistoryTimestamp(entry.recorded_at)} IST</span>
                  </div>
                  <div style={{ color: '#475569', fontSize: '0.78rem', marginBottom: '8px' }}>
                    By {entry.actor_name} ({entry.actor_role}) · Changed: {entry.changed_fields.join(', ')}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '6px 12px', fontSize: '0.76rem' }}>
                    {Object.entries(entry.snapshot).map(([key, value]) => (
                      <div key={key}><span style={{ color: '#64748b' }}>{key}: </span><strong style={{ color: '#1e293b', wordBreak: 'break-word' }}>{value === null || value === '' ? '—' : String(value)}</strong></div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer"><button className="modal-btn-cancel" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

// ── Assign Inspector Modal (Admin only) ────────────────────────────────────────
function AssignInspectorModal({ project, user, onClose, onSave }) {
  const [inspectors, setInspectors] = useState([]);
  const [selected, setSelected] = useState(project.assigned_inspector || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const loadInspectors = () => fetchInspectors(user).then(setInspectors).catch(() => {});
    loadInspectors();
    const timer = window.setInterval(loadInspectors, 30_000);
    return () => window.clearInterval(timer);
  }, [user]);

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true); setErr('');
    try {
      const insp = inspectors.find(i => i.name === selected);
      const updated = await assignProjectInspector(project.id, selected, insp?.id, user);
      onSave(updated);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title"><UserPlus size={17} /> Assign Inspector Officer</div>
            <div className="modal-sub">{project.id} · {project.name}</div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="modal-row">
            <label>Select Inspector Officer In-Charge</label>
            <select value={selected} onChange={e => setSelected(e.target.value)}>
              <option value="">-- Select Online Inspector --</option>
              {inspectors.map(i => <option key={i.id} value={i.name}>{i.name}</option>)}
            </select>
            {!inspectors.length && <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: 6 }}>No Inspector Officers are currently logged in.</div>}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 6 }}>
            Currently assigned: <strong>{project.assigned_inspector || 'None'}</strong>
          </div>
          {err && <div className="modal-error"><AlertCircle size={14} /> {err}</div>}
        </div>
        <div className="modal-footer">
          <button className="modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="modal-btn-save" onClick={handleSave} disabled={saving || !selected}>
            {saving ? 'Assigning...' : <><CheckCircle size={14} /> Assign Inspector</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── View Dossier Modal (Citizen) ───────────────────────────────────────────────
function DossierModal({ project, user, onClose }) {
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [commentImage, setCommentImage] = useState(null);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState('');

  useEffect(() => {
    let active = true;
    setCommentsLoading(true);
    fetchProjectComments(project.id)
      .then(data => { if (active) setComments(data); })
      .catch(() => { if (active) setComments([]); })
      .finally(() => { if (active) setCommentsLoading(false); });
    return () => { active = false; };
  }, [project.id]);

  const handleCommentSubmit = async event => {
    event.preventDefault();
    if (!commentText.trim() || !commentImage) {
      setCommentError('Comment text and an image are both required.');
      return;
    }
    setCommentSubmitting(true);
    setCommentError('');
    try {
      const created = await addProjectComment(project.id, commentText.trim(), commentImage, user);
      setComments(previous => [created, ...previous]);
      setCommentText('');
      setCommentImage(null);
      event.target.reset();
    } catch (error) {
      setCommentError(error.message);
    } finally {
      setCommentSubmitting(false);
    }
  };

  const originalCost = Number(project.original_cost) || 0;
  const revisedCost = Number(project.revised_cost) || originalCost || 0;
  const expenditure = Number(project.expenditure) || 0;
  const physicalProgress = Math.min(100, Math.max(0, Number(project.physical_progress) || 0));
  const riskScore = Math.min(100, Math.max(0, Number(project.risk_score) || 0));
  const spentShare = revisedCost ? Math.min(100, Math.max(0, (expenditure / revisedCost) * 100)) : 0;

  const costChartData = [
    { name: 'Original', value: originalCost },
    { name: 'Revised', value: revisedCost },
    { name: 'Spent', value: expenditure },
  ];

  const progressChartData = [
    { name: 'Progress', value: physicalProgress },
    { name: 'Risk', value: riskScore },
  ];

  const utilizationData = [
    { name: 'Utilized', value: spentShare },
    { name: 'Balance', value: Math.max(0, 100 - spentShare) },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box--wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title"><Eye size={17} /> Project Dossier</div>
            <div className="modal-sub">{project.id} · LOGIC CORE Infrastructure Intelligence</div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="dossier-grid">
            <div className="dossier-row"><span>Project Name</span><strong>{project.name}</strong></div>
            <div className="dossier-row"><span>Sector</span><strong>{project.sector}</strong></div>
            <div className="dossier-row"><span>Ministry</span><strong>{project.ministry}</strong></div>
            <div className="dossier-row"><span>Agency</span><strong>{project.agency}</strong></div>
            <div className="dossier-row"><span>Location / State</span><strong>{project.location || 'India'}</strong></div>
            <div className="dossier-row"><span>Original Cost</span><strong>₹{project.original_cost?.toLocaleString('en-IN')} Cr</strong></div>
            <div className="dossier-row"><span>Revised Cost</span><strong>₹{project.revised_cost?.toLocaleString('en-IN')} Cr</strong></div>
            <div className="dossier-row"><span>Expenditure</span><strong>₹{project.expenditure?.toLocaleString('en-IN')} Cr</strong></div>
            <div className="dossier-row"><span>Physical Progress</span><strong>{project.physical_progress ?? 0}%</strong></div>
            <div className="dossier-row"><span>Operational Status</span><strong>{project.status}</strong></div>
            <div className="dossier-row"><span>Project Status</span><strong>{project.project_status || 'Ongoing'}</strong></div>
            <div className="dossier-row"><span>Start Date</span><strong>{project.start_date || '—'}</strong></div>
            <div className="dossier-row"><span>Expected End Date</span><strong>{project.expected_end_date || '—'}</strong></div>
            <div className="dossier-row"><span>Revised Completion</span><strong>{project.revised_completion_date || '—'}</strong></div>
            <div className="dossier-row"><span>Inspector In-Charge</span><strong>{project.assigned_inspector || 'Not Assigned'}</strong></div>
            <div className="dossier-row"><span>AI Risk Score</span><strong style={{ color: project.risk_score > 75 ? '#dc2626' : project.risk_score > 50 ? '#d97706' : '#16a34a' }}>{project.risk_score}</strong></div>
            {project.inspection_notes && (
              <div className="dossier-row dossier-row--full"><span>Inspection Notes</span><strong>{project.inspection_notes}</strong></div>
            )}
            {project.description && (
              <div className="dossier-row dossier-row--full"><span>Description</span><strong>{project.description}</strong></div>
            )}
          </div>

          <section className="dossier-analytics">
            <div className="dossier-analytics-header">
              <TrendingUp size={16} />
              <span>Project Portfolio Analytics</span>
            </div>

            <div className="dossier-analytics-grid">
              <div className="dossier-chart-card">
                <h4>Cost Snapshot</h4>
                <div className="dossier-chart-box">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={costChartData} margin={{ top: 10, right: 10, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
                      <Tooltip formatter={value => [`₹${Number(value).toLocaleString('en-IN')} Cr`, 'Cost']} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                        {costChartData.map((entry, index) => (
                          <Cell key={`${entry.name}-${index}`} fill={index === 2 ? '#2563eb' : index === 1 ? '#7c3aed' : '#10b981'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="dossier-chart-card">
                <h4>Progress vs Risk</h4>
                <div className="dossier-chart-box">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={progressChartData} margin={{ top: 10, right: 10, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#6b7280' }} />
                      <Tooltip formatter={value => [`${value}%`, 'Score']} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                        {progressChartData.map((entry, index) => (
                          <Cell key={`${entry.name}-${index}`} fill={index === 1 ? '#f59e0b' : '#16a34a'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="dossier-chart-card dossier-chart-card--wide">
                <h4>Cost Utilization</h4>
                <div className="dossier-chart-box dossier-chart-box--pie">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={utilizationData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={52}
                        outerRadius={74}
                        paddingAngle={3}
                        startAngle={90}
                        endAngle={-270}
                      >
                        {[0, 1].map((index) => (
                          <Cell key={index} fill={index === 0 ? '#2563eb' : '#dbeafe'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={value => [`${Number(value).toFixed(1)}%`, 'Share']} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="dossier-pie-center">
                    <strong>{Math.round(spentShare)}%</strong>
                    <span>Utilized</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="project-comments-section">
            <div className="project-comments-heading">
              <div><MessageSquare size={16} /> Public Comments</div>
              <span>Anonymous feedback for this project</span>
            </div>
            {user?.role === 'user' && (
              <form className="project-comment-form" onSubmit={handleCommentSubmit}>
                <textarea
                  value={commentText}
                  onChange={event => setCommentText(event.target.value)}
                  placeholder="Share an observation about this project..."
                  rows={3}
                  required
                />
                <div className="comment-form-row">
                  <label className="comment-image-picker">
                    <ImagePlus size={15} />
                    <span>{commentImage ? commentImage.name : 'Attach image (required)'}</span>
                    <input type="file" accept="image/*" onChange={event => setCommentImage(event.target.files?.[0] || null)} required />
                  </label>
                  <button type="submit" className="comment-submit-btn" disabled={commentSubmitting}>
                    {commentSubmitting ? 'Posting...' : <><Send size={14} /> Post Anonymously</>}
                  </button>
                </div>
                {commentError && <div className="modal-error"><AlertCircle size={13} /> {commentError}</div>}
              </form>
            )}
            <div className="project-comments-list">
              {commentsLoading ? <div className="comments-empty">Loading comments...</div> : comments.length === 0 ? <div className="comments-empty">No comments yet.</div> : comments.map(item => (
                <article key={item.id} className="project-comment-item">
                  <img src={`${API_BASE}${item.image_url}`} alt="Anonymous project evidence" />
                  <div>
                    <div className="comment-meta">Anonymous Citizen · {new Date(item.created_at).toLocaleString('en-IN')}</div>
                    <p>{item.comment}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
        <div className="modal-footer">
          <button className="modal-btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const { user } = useAuth();
  const role = user?.role || 'user';
  const roleCfg = ROLE_CONFIG[role] || ROLE_CONFIG.user;
  const isGovernmentViewer = role === 'user' && ['Ministry of Central Govt', 'Ministry of State Govt'].includes(user?.affiliation);

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterState, setFilterState] = useState('All');
  const [filterSector, setFilterSector] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [myProjectsOnly, setMyProjectsOnly] = useState(false);

  const [updateModal, setUpdateModal] = useState(null); // project obj
  const [historyModal, setHistoryModal] = useState(null); // project obj
  const [assignModal, setAssignModal] = useState(null); // project obj
  const [dossierModal, setDossierModal] = useState(null); // project obj
  const [repredictingAll, setRepredictingAll] = useState(false);
  const [inspectorToast, setInspectorToast] = useState('');
  const [accessRequestState, setAccessRequestState] = useState('none');
  const [showAccessRequestModal, setShowAccessRequestModal] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);

  useEffect(() => {
    if (!user || user.role !== 'user') return;
    fetchAdminAccessStatus(user)
      .then(data => setAccessRequestState(data.status || 'none'))
      .catch(() => setAccessRequestState('none'));
  }, [user]);

  const canRequestAdmin = role === 'user' && ['Ministry of Central Govt', 'Ministry of State Govt'].includes(user?.affiliation);
  const showPendingAccessState = canRequestAdmin && accessRequestState === 'pending';
  const showRejectedAccessState = canRequestAdmin && accessRequestState === 'rejected';

  useEffect(() => {
    if (showRejectedAccessState) {
      window.alert('Access denied: Your admin access request was rejected.');
    }
  }, [showRejectedAccessState]);

  const handleRequestAccess = async () => {
    setRequestSubmitting(true);
    try {
      await requestAdminAccess(user);
      setAccessRequestState('pending');
      setShowAccessRequestModal(false);
      setInspectorToast('Admin access request submitted for review.');
    } catch (err) {
      setInspectorToast(err.message || 'Could not submit admin access request.');
    } finally {
      setRequestSubmitting(false);
    }
  };

  const handleRepredictAssigned = async () => {
    setRepredictingAll(true);
    setInspectorToast('');
    try {
      const res = await repredictAssignedProjects(user);
      setInspectorToast(`⚡ ${res.message}`);
      loadProjects();
      setTimeout(() => setInspectorToast(''), 6000);
    } catch (err) {
      setInspectorToast(`❌ ${err.message}`);
      setTimeout(() => setInspectorToast(''), 6000);
    } finally {
      setRepredictingAll(false);
    }
  };

  const loadProjects = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '200' });
    if (filterState !== 'All') params.set('state', filterState);
    if (filterSector !== 'All') params.set('sector', filterSector);
    fetch(`${API_BASE}/api/v1/projects?${params.toString()}`, { headers: authHeaders(user) })
      .then(r => r.json())
      .then(d => { setProjects(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filterState, filterSector, myProjectsOnly, role, user]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  useEffect(() => {
    const openProject = event => {
      const project = projects.find(item => item.id === event.detail);
      if (project) setDossierModal(project);
    };
    window.addEventListener('open-project-dossier', openProject);
    return () => window.removeEventListener('open-project-dossier', openProject);
  }, [projects]);

  useEffect(() => {
    const reopen = () => {
      const projectId = window.sessionStorage.getItem('mospi.notificationProjectId');
      const project = projects.find(item => item.id === projectId);
      if (project) setDossierModal(project);
    };
    window.addEventListener('reopen-project-dossier', reopen);
    return () => window.removeEventListener('reopen-project-dossier', reopen);
  }, [projects]);

  const handleDelete = async (p) => {
    if (!window.confirm(`Delete project '${p.name}' (${p.id}) from the central database?`)) return;
    try {
      await deleteProject(p.id, user);
      setProjects(prev => prev.filter(item => item.id !== p.id));
    } catch (err) {
      alert(err.message || 'Failed to delete project');
    }
  };

  const handleExportCSV = () => {
    if (!filtered.length) { alert('No projects to export.'); return; }
    const headers = ['Project ID', 'Name', 'Sector', 'Ministry', 'State', 'Original Cost (Cr)', 'Revised Cost (Cr)', 'Expenditure (Cr)', 'Cost Overrun %', 'Physical Progress %', 'Status', 'Risk Score', 'Inspector In-Charge'];
    const rows = filtered.map(p => {
      const overrun = (((p.revised_cost - p.original_cost) / p.original_cost) * 100).toFixed(1);
      return [`"${p.id}"`, `"${(p.name||'').replace(/"/g, '""')}"`, `"${p.sector||''}"`, `"${p.ministry||''}"`, `"${p.location||''}"`, p.original_cost, p.revised_cost, p.expenditure, overrun, p.physical_progress||0, `"${p.status||''}"`, p.risk_score, `"${p.assigned_inspector||''}"`].join(',');
    });
    const csv = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const a = document.createElement('a');
    a.href = encodeURI(csv);
    a.download = `LOGIC_CORE_Projects_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const filtered = projects.filter(p => {
    const s = search.toLowerCase();
    const matchSearch = p.name.toLowerCase().includes(s) || p.id.toLowerCase().includes(s) || (p.location||'').toLowerCase().includes(s);
    const matchStatus = filterStatus === 'All' || p.status === filterStatus;
    if (role === 'inspector' && myProjectsOnly) {
      const isAssigned = p.assigned_officer_id === user?.id ||
        p.assigned_inspector_id === user?.id ||
        (p.assigned_inspector || '').toLowerCase() === (user?.name || '').toLowerCase() ||
        !p.assigned_inspector ||
        (p.assigned_inspector || '').toLowerCase() === 'unassigned' ||
        (p.assigned_inspector || '').toLowerCase() === 'none';
      if (!isAssigned) return false;
    }
    return matchSearch && matchStatus;
  });

  return (
    <div className="page-container">
      {/* Viewer access banner */}
      {role === 'user' && !isGovernmentViewer && (
        <div className="citizen-banner">
          <Eye size={16} />
          <span>
            <strong>Public Citizen Portal</strong> — You have read-only access to monitor Government of India infrastructure projects.
            No edit or deletion rights. Data sourced from LOGIC CORE Infrastructure Intelligence.
          </span>
        </div>
      )}

      {canRequestAdmin && (
        <div className="citizen-banner" style={{ background: showRejectedAccessState ? '#fef2f2' : '#fffbeb', borderColor: showRejectedAccessState ? '#fecaca' : '#fde68a', color: showRejectedAccessState ? '#991b1b' : '#92400e', justifyContent: 'space-between' }}>
          <span>
            <strong>{showRejectedAccessState ? 'Admin request rejected' : 'Government Viewer'}</strong>
            {showRejectedAccessState
              ? ' — Your last admin access request was rejected. Please review the notification and re-submit if needed.'
              : showPendingAccessState
                ? ' — Your admin access request is currently pending approval.'
                : ' — request Admin approval to manage project records.'}
          </span>
          <button
            type="button"
            onClick={() => setShowAccessRequestModal(true)}
            disabled={showPendingAccessState}
            style={{
              padding: '7px 12px',
              border: '1px solid #b45309',
              borderRadius: '4px',
              background: showPendingAccessState ? '#fef3c7' : showRejectedAccessState ? '#b91c1c' : '#b45309',
              color: showPendingAccessState ? '#92400e' : '#fff',
              cursor: showPendingAccessState ? 'default' : 'pointer',
              fontWeight: 700,
            }}
          >
            {showPendingAccessState ? 'Approval Pending' : showRejectedAccessState ? 'Admin Request Rejected' : 'Request Admin Access'}
          </button>
        </div>
      )}

      {showAccessRequestModal && (
        <AdminAccessRequestModal
          affiliation={user.affiliation}
          submitting={requestSubmitting}
          onConfirm={handleRequestAccess}
          onClose={() => !requestSubmitting && setShowAccessRequestModal(false)}
        />
      )}

      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 className="page-title">
              {role === 'inspector' ? 'Project Portfolio (Inspector View)' : 'Central Project Portfolio'}
            </h2>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 10px', borderRadius: '4px', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', fontSize: '0.75rem', fontWeight: 700 }}>
              <Database size={13} /> {projects.length} Entries
            </span>
          </div>
          <p className="page-subtitle">Showing {filtered.length} of {projects.length} projects registered under LOGIC CORE monitoring</p>
        </div>
        <button className="btn-export" onClick={handleExportCSV} type="button">
          <Download size={15} /> Export Official CSV
        </button>
      </div>

      {/* Inspector: My Projects & ML Re-predict controls */}
      {role === 'inspector' && (
        <div className="inspector-toggle-row">
          <button
            type="button"
            className={`inspector-toggle-btn ${myProjectsOnly ? 'active' : ''}`}
            onClick={() => setMyProjectsOnly(v => !v)}
          >
            <ClipboardList size={14} />
            {myProjectsOnly ? 'Showing: My Assigned Projects' : 'Show Only My Assigned Projects'}
          </button>

          <button
            type="button"
            className="inspector-ml-btn"
            onClick={handleRepredictAssigned}
            disabled={repredictingAll}
            title="Run XGBoost ML prediction pipeline across all assigned projects to update risk scores and overrun/delay probabilities"
          >
            {repredictingAll ? (
              <><span className="ml-spinner" /> Updating ML Predictions...</>
            ) : (
              <><Zap size={14} /> Update ML Predictions for Assigned Projects</>
            )}
          </button>

          {inspectorToast && (
            <div className="inspector-toast animate-fade-in">
              {inspectorToast}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="filter-bar glass-panel">
        <div className="search-input-wrap">
          <Search size={15} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search project name, ID, or state..." />
        </div>

        {/* State filter – for all roles */}
        <div className="filter-group">
          <MapPin size={14} />
          <select value={filterState} onChange={e => { setFilterState(e.target.value); }}>
            {INDIAN_STATES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        {/* Sector filter – for all roles */}
        <div className="filter-group">
          <Filter size={14} />
          <select value={filterSector} onChange={e => { setFilterSector(e.target.value); }}>
            {SECTORS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div className="filter-group">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            {['All', 'Ongoing', 'Delayed', 'At Risk', 'Completed', 'On Schedule'].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div className="filter-counts">
          <span className="fc high">● {projects.filter(p => p.risk_score > 75).length} High Risk</span>
          <span className="fc med">● {projects.filter(p => p.risk_score > 50 && p.risk_score <= 75).length} Medium</span>
          <span className="fc low">● {projects.filter(p => p.risk_score <= 50).length} Low</span>
        </div>
      </div>

      {/* Table */}
      <div className="glass-panel table-wrap">
        <table className="projects-table">
          <thead>
            <tr>
              <th>Project ID</th>
              <th>Project Name</th>
              <th>Sector & State</th>
              <th>Original Cost (₹ Cr)</th>
              <th>Revised Cost (₹ Cr)</th>
              <th>Expenditure (₹ Cr)</th>
              <th>Cost Overrun %</th>
              <th>Status</th>
              <th>AI Risk Score</th>
              <th>Inspector In-Charge</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}><td colSpan={11}><div className="row-skel"></div></td></tr>
              ))
              : filtered.map((p) => {
                const overrun = (((p.revised_cost - p.original_cost) / p.original_cost) * 100).toFixed(1);
                return (
                  <tr key={p.id} className="trow">
                    <td><span className="proj-id">{p.id}</span></td>
                    <td className="proj-name">
                      <div>{p.name}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{p.agency ? `${p.agency} · ` : ''}{p.ministry}</div>
                    </td>
                    <td>
                      <span className="sector-chip">{p.sector}</span>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>📍 {p.location || 'India'}</div>
                    </td>
                    <td>₹{p.original_cost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td>₹{p.revised_cost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td>₹{p.expenditure.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td className={parseFloat(overrun) > 20 ? 'overrun-high' : 'overrun-ok'}>+{overrun}%</td>
                    <td>
                      <span className={`badge ${statusBadge[p.status] || 'badge-warning'}`}>{p.status}</span>
                      <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: '2px' }}>{p.project_status}</div>
                    </td>
                    <td><RiskBar score={p.risk_score} /></td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1e40af' }}>
                          👮 {p.assigned_inspector || 'Unassigned'}
                        </span>
                        {p.last_inspected_at && (
                          <span style={{ fontSize: '0.66rem', color: '#9ca3af' }}>
                            Last: {new Date(p.last_inspected_at).toLocaleDateString('en-IN')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                        {/* View Dossier – all roles */}
                        <button type="button" onClick={() => setDossierModal(p)} className="action-btn action-btn--view" title="View full project dossier">
                          <Eye size={12} /> View
                        </button>

                        {/* Update Status – inspector & admin */}
                        {roleCfg.canUpdateStatus && (
                          <button type="button" onClick={() => setUpdateModal(p)} className="action-btn action-btn--update" title="Update project status & inspection report">
                            <ClipboardList size={12} /> Update
                          </button>
                        )}

                        {roleCfg.canUpdateStatus && (
                          <button type="button" onClick={() => setHistoryModal(p)} className="action-btn action-btn--view" title="View complete project update history">
                            <History size={12} /> History
                          </button>
                        )}

                        {/* Assign Inspector – admin only */}
                        {roleCfg.canAssignInspector && (
                          <button type="button" onClick={() => setAssignModal(p)} className="action-btn action-btn--assign" title="Assign Inspector Officer">
                            <UserPlus size={12} /> Assign
                          </button>
                        )}

                        {/* Delete – admin only */}
                        {roleCfg.canDeleteProject && (
                          <button type="button" onClick={() => handleDelete(p)} className="action-btn action-btn--delete" title="Delete project from SQLite database">
                            <Trash2 size={12} /> Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            }
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <div className="empty-table">
            {role === 'inspector' && projects.length === 0
              ? 'No projects assigned'
              : 'No projects match the selected criteria.'}
          </div>
        )}
      </div>

      {/* Modals */}
      {updateModal && (
        <UpdateStatusModal
          project={updateModal}
          user={user}
          onClose={() => setUpdateModal(null)}
          onSave={updated => {
            setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
            setUpdateModal(null);
          }}
        />
      )}

      {historyModal && (
        <ProjectHistoryModal
          project={historyModal}
          user={user}
          onClose={() => setHistoryModal(null)}
        />
      )}
      {assignModal && (
        <AssignInspectorModal
          project={assignModal}
          user={user}
          onClose={() => setAssignModal(null)}
          onSave={updated => {
            setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
            setAssignModal(null);
          }}
        />
      )}
      {dossierModal && (
        <DossierModal project={dossierModal} user={user} onClose={() => setDossierModal(null)} />
      )}
    </div>
  );
}