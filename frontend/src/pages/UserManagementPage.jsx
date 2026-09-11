import React, { useState, useEffect } from 'react';
import { Users, Shield, User, Database, Plus, Trash2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchUsers, createUser, deleteUser, fetchDatabaseStats } from '../services/api';
import './UserManagementPage.css';

export default function UserManagementPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [role, setRole] = useState('user');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [uList, dbStats] = await Promise.all([
        fetchUsers(user),
        fetchDatabaseStats(user),
      ]);
      setUsers(uList);
      setStats(dbStats);
    } catch (e) {
      console.error('Error loading user/db data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!name.trim() || !password) return;

    setSubmitting(true);
    setMessage(null);
    try {
      const created = await createUser({ name: name.trim(), role, password }, user);
      setMessage({ type: 'success', text: `Successfully registered ${created.role} '${created.name}' in database!` });
      setName('');
      setPassword('');
      await loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Could not create account.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (account) => {
    if (account.name === 'Administrator' && account.role === 'admin') {
      alert('Cannot delete default system Administrator account.');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete ${account.role} '${account.name}' from the database?`)) {
      return;
    }

    try {
      await deleteUser(account.id, user);
      setMessage({ type: 'success', text: `Deleted user '${account.name}' from database.` });
      await loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Could not delete user.' });
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">User & Admin Database</h2>
          <p className="page-subtitle">Manage registered users, administrators, and database records</p>
        </div>
        <button className="btn-refresh" onClick={loadData} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh DB Records
        </button>
      </div>

      {/* Database Connection Stats */}
      <div className="db-stats-grid">
        <div className="db-stat-card glass-panel">
          <div className="db-stat-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
            <Database size={20} />
          </div>
          <div>
            <div className="db-stat-val">{stats?.database_file || 'paimana.db'}</div>
            <div className="db-stat-lbl">SQLite Database Status: <span style={{ color: '#16a34a', fontWeight: 600 }}>Active</span></div>
          </div>
        </div>

        <div className="db-stat-card glass-panel">
          <div className="db-stat-icon" style={{ background: '#f5f3ff', color: '#7c3aed' }}>
            <Shield size={20} />
          </div>
          <div>
            <div className="db-stat-val">{stats?.total_admins ?? '—'}</div>
            <div className="db-stat-lbl">Admin Accounts in DB</div>
          </div>
        </div>

        <div className="db-stat-card glass-panel">
          <div className="db-stat-icon" style={{ background: '#fffbeb', color: '#b45309' }}>
            <Users size={20} />
          </div>
          <div>
            <div className="db-stat-val">{stats?.total_inspectors ?? '—'}</div>
            <div className="db-stat-lbl">Inspector Officers in DB</div>
          </div>
        </div>

        <div className="db-stat-card glass-panel">
          <div className="db-stat-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>
            <Users size={20} />
          </div>
          <div>
            <div className="db-stat-val">{stats?.total_regular_users ?? '—'}</div>
            <div className="db-stat-lbl">Citizen / Public Users</div>
          </div>
        </div>

        <div className="db-stat-card glass-panel">
          <div className="db-stat-icon" style={{ background: '#fffbeb', color: '#d97706' }}>
            <Database size={20} />
          </div>
          <div>
            <div className="db-stat-val">{stats?.total_projects ?? '—'}</div>
            <div className="db-stat-lbl">Projects Persisted in DB</div>
          </div>
        </div>
      </div>

      {/* Main Grid: Create Form + Users Table */}
      <div className="user-mgmt-grid">
        {/* Create User/Admin Card */}
        <div className="glass-panel create-user-card">
          <h3 className="panel-h" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} color="#2563eb" /> Add User or Administrator
          </h3>
          <p className="panel-sub">Store a new authorized account into the SQLite users table</p>

          <form onSubmit={handleCreateUser} className="create-user-form">
            <div className="form-group">
              <label>Account Role</label>
              <div className="role-radio-group">
                <label className={`role-radio-label ${role === 'admin' ? 'checked' : ''}`}>
                  <input
                    type="radio"
                    name="role"
                    value="admin"
                    checked={role === 'admin'}
                    onChange={() => setRole('admin')}
                  />
                  <Shield size={16} /> Administrator
                </label>
                <label className={`role-radio-label ${role === 'inspector' ? 'checked' : ''}`} style={role === 'inspector' ? { background: '#fffbeb', borderColor: '#fde68a', color: '#92400e' } : {}}>
                  <input
                    type="radio"
                    name="role"
                    value="inspector"
                    checked={role === 'inspector'}
                    onChange={() => setRole('inspector')}
                  />
                  <User size={16} /> Inspector Officer
                </label>
                <label className={`role-radio-label ${role === 'user' ? 'checked' : ''}`}>
                  <input
                    type="radio"
                    name="role"
                    value="user"
                    checked={role === 'user'}
                    onChange={() => setRole('user')}
                  />
                  <User size={16} /> Citizen / Public User
                </label>
              </div>
            </div>

            <div className="form-group">
              <label>Full Name</label>
              <input
                type="text"
                placeholder="e.g. Vikramaditya Rao"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                placeholder="Set password (min 4 chars)"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>

            {message && (
              <div className={`message-banner ${message.type}`}>
                {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                <span>{message.text}</span>
              </div>
            )}

            <button type="submit" className="btn-create-user" disabled={submitting}>
              {submitting ? 'Saving to Database...' : `Save ${role === 'admin' ? 'Admin' : role === 'inspector' ? 'Inspector' : 'User'} Account`}
            </button>
          </form>
        </div>

        {/* Users Table */}
        <div className="glass-panel user-table-card">
          <h3 className="panel-h" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Users & Administrators in SQLite Database</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 500, color: '#64748b' }}>{users.length} Records</span>
          </h3>

          <div className="table-responsive">
            <table className="user-db-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>User Details</th>
                  <th>Role</th>
                  <th>Created Date</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>Loading database records...</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>No users found in database.</td></tr>
                ) : (
                  users.map(u => (
                    <tr key={u.id}>
                      <td><span className="user-id-badge">#{u.id}</span></td>
                      <td>
                        <div className="user-name-cell">
                          <div className={`user-avatar ${u.role}`}>
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="user-full-name">{u.name}</div>
                            <div className="user-meta">
                              {u.role === 'admin' ? 'Full System Access' : u.role === 'inspector' ? 'Inspector Officer – Assigned Projects' : 'Citizen / Public Read Access'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`role-badge ${u.role}`}>
                          {u.role === 'admin' ? <Shield size={12} /> : <User size={12} />}
                          {u.role === 'inspector' ? 'INSPECTOR' : u.role.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.85rem', color: '#64748b' }}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Initial Seed'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {u.name === 'Administrator' && u.role === 'admin' ? (
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>Protected</span>
                        ) : (
                          <button
                            type="button"
                            className="btn-del-user"
                            onClick={() => handleDeleteUser(u)}
                            title="Delete user from database"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
