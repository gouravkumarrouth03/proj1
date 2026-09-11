import React, { useState, useEffect, useCallback } from 'react';
import { Search, Filter, Download, Eye, Trash2, Database, ClipboardList, UserPlus, X, CheckCircle, AlertCircle, MapPin } from 'lucide-react';
import { API_BASE, authHeaders, deleteProject, updateProjectStatus, assignProjectInspector, fetchInspectors } from '../services/api';
import { useAuth, ROLE_CONFIG } from '../context/AuthContext';
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

// ── Update Status Modal (Inspector / Admin) ────────────────────────────────────
function UpdateStatusModal({ project, user, onClose, onSave }) {
  const [form, setForm] = useState({
    status: project.status || 'Ongoing',
    project_status: project.project_status || 'Ongoing',
    physical_progress: project.physical_progress ?? '',
    revised_completion_date: project.revised_completion_date || '',
    inspection_notes: project.inspection_notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = async () => {
    setSaving(true); setErr('');
    try {
      const updated = await updateProjectStatus(project.id, {
        status: form.status,
        project_status: form.project_status,
        physical_progress: parseFloat(form.physical_progress) || undefined,
        revised_completion_date: form.revised_completion_date || undefined,
        inspection_notes: form.inspection_notes || undefined,
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
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title"><ClipboardList size={17} /> Update Inspection Report</div>
            <div className="modal-sub">{project.id} · {project.name}</div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
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
function DossierModal({ project, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box--wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title"><Eye size={17} /> Project Dossier</div>
            <div className="modal-sub">{project.id} · Government of India, IPMD · MoSPI</div>
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

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterState, setFilterState] = useState('All');
  const [filterSector, setFilterSector] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [myProjectsOnly, setMyProjectsOnly] = useState(false);

  const [updateModal, setUpdateModal] = useState(null); // project obj
  const [assignModal, setAssignModal] = useState(null); // project obj
  const [dossierModal, setDossierModal] = useState(null); // project obj

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
    a.download = `MoSPI_Projects_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const filtered = projects.filter(p => {
    const s = search.toLowerCase();
    const matchSearch = p.name.toLowerCase().includes(s) || p.id.toLowerCase().includes(s) || (p.location||'').toLowerCase().includes(s);
    const matchStatus = filterStatus === 'All' || p.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div className="page-container">
      {/* Citizen banner */}
      {role === 'user' && (
        <div className="citizen-banner">
          <Eye size={16} />
          <span>
            <strong>Public Citizen Portal</strong> — You have read-only access to monitor Government of India infrastructure projects.
            No edit or deletion rights. Data sourced from IPMD, MoSPI.
          </span>
        </div>
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
          <p className="page-subtitle">Showing {filtered.length} of {projects.length} projects registered under IPMD monitoring</p>
        </div>
        <button className="btn-export" onClick={handleExportCSV} type="button">
          <Download size={15} /> Export Official CSV
        </button>
      </div>

      {/* Inspector: My Projects toggle */}
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
          <div className="empty-table">No projects match the selected criteria.</div>
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
        <DossierModal project={dossierModal} onClose={() => setDossierModal(null)} />
      )}
    </div>
  );
}