import React, { useState } from 'react';
import { Users, Shield, HardHat, Eye, UserPlus, Trash2, CheckCircle } from 'lucide-react';
import { ROLE_CONFIG } from '../context/AuthContext';
import './UsersPage.css';

const roleIcons = { admin: Shield, project_lead: HardHat, inspector: Users, viewer: Eye };

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [showInvite, setShowInvite] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'viewer' });
  const [invited, setInvited] = useState(false);

  const handleInvite = e => {
    e.preventDefault();
    const added = { ...newUser, id: Date.now(), projects: 'TBD', status: 'Active', joined: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) };
    setUsers(prev => [...prev, added]);
    setInvited(true);
    setTimeout(() => { setShowInvite(false); setInvited(false); setNewUser({ name: '', email: '', role: 'viewer' }); }, 1500);
  };

  const handleRemove = id => setUsers(prev => prev.filter(u => u.id !== id));

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">User Management</h2>
          <p className="page-subtitle">Manage roles and access for {users.length} system users</p>
        </div>
        <button className="btn-primary" onClick={() => setShowInvite(true)}><UserPlus size={15} /> Invite User</button>
      </div>

      {/* Role summary */}
      <div className="role-summary-row">
        {Object.entries(ROLE_CONFIG).map(([key, cfg]) => {
          const count = users.filter(u => u.role === key).length;
          const Icon = roleIcons[key];
          return (
            <div key={key} className="role-summary-card glass-panel">
              <div className="rs-icon" style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}><Icon size={18} /></div>
              <div className="rs-count">{count}</div>
              <div className="rs-label">{cfg.label}s</div>
            </div>
          );
        })}
      </div>

      {/* Users table */}
      <div className="glass-panel table-wrap">
        <table className="users-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role</th>
              <th>Assigned Projects</th>
              <th>Joined</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const cfg = ROLE_CONFIG[u.role];
              const Icon = roleIcons[u.role];
              return (
                <tr key={u.id} className="trow">
                  <td>
                    <div className="user-cell">
                      <div className="user-avatar" style={{ background: cfg.bg, color: cfg.color }}>{u.name[0]}</div>
                      <span className="user-name-cell">{u.name}</span>
                    </div>
                  </td>
                  <td className="email-cell">{u.email}</td>
                  <td>
                    <span className="role-chip" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border }}>
                      <Icon size={11} /> {cfg.label}
                    </span>
                  </td>
                  <td className="proj-cell">{u.projects}</td>
                  <td className="date-cell">{u.joined}</td>
                  <td>
                    <span className={`badge ${u.status === 'Active' ? 'badge-success' : 'badge-warning'}`}>{u.status}</span>
                  </td>
                  <td>
                    <button className="remove-btn" onClick={() => handleRemove(u.id)} title="Remove user">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>Invite New User</h3>
            {invited
              ? <div className="invite-success"><CheckCircle size={32} color="#16a34a" /><p>User invited successfully!</p></div>
              : (
                <form onSubmit={handleInvite} className="invite-form">
                  <div className="form-group">
                    <label>Full Name</label>
                    <input required value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Arjun Nair" />
                  </div>
                  <div className="form-group">
                    <label>Email</label>
                    <input required type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} placeholder="user@example.com" />
                  </div>
                  <div className="form-group">
                    <label>Role</label>
                    <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}>
                      {Object.entries(ROLE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="btn-secondary" onClick={() => setShowInvite(false)}>Cancel</button>
                    <button type="submit" className="btn-primary"><UserPlus size={15} /> Send Invite</button>
                  </div>
                </form>
              )
            }
          </div>
        </div>
      )}
    </div>
  );
}
