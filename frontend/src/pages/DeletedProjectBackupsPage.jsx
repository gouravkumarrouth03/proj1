import React, { useEffect, useState } from 'react';
import { ArchiveRestore, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchProjectBackups, restoreProjectBackup, permanentlyDeleteProjectBackup } from '../services/api';
import './UserManagementPage.css';

function formatIndianTime(value) {
  const utcValue = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  return `${new Date(utcValue).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`;
}

export default function DeletedProjectBackupsPage() {
  const { user } = useAuth();
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  const loadBackups = async () => {
    setLoading(true);
    try {
      setBackups(await fetchProjectBackups(user));
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBackups(); }, [user]);

  const handleRestore = async (backup) => {
    if (!window.confirm(`Restore project '${backup.project_name}'?`)) return;
    try {
      await restoreProjectBackup(backup.id, user);
      setMessage({ type: 'success', text: `Restored project '${backup.project_name}'.` });
      await loadBackups();
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const handlePurge = async (backup) => {
    if (!window.confirm(`Permanently delete the backup for '${backup.project_name}'? This cannot be undone.`)) return;
    try {
      await permanentlyDeleteProjectBackup(backup.id, user);
      setMessage({ type: 'success', text: `Permanently deleted backup '${backup.project_name}'.` });
      await loadBackups();
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title"><ArchiveRestore size={22} style={{ verticalAlign: 'middle', marginRight: '8px' }} /> Deleted Project Backups</h2>
          <p className="page-subtitle">Admin-only recovery archive. Deleted projects are retained for 30 days.</p>
        </div>
        <button className="btn-refresh" onClick={loadBackups} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh Backups
        </button>
      </div>

      {message && <div className={`message-banner ${message.type}`}>{message.text}</div>}

      <div className="glass-panel user-table-card">
        <h3 className="panel-h" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Recovery Archive</span>
          <span style={{ fontSize: '0.8rem', fontWeight: 500, color: '#64748b' }}>{backups.length} retained</span>
        </h3>
        <div className="table-responsive">
          <table className="user-db-table">
            <thead><tr><th>Project</th><th>Deleted By</th><th>Deleted At</th><th>Backup Expires</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px' }}>Loading backups...</td></tr> : backups.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>No deleted project backups.</td></tr> : backups.map(backup => (
                <tr key={backup.id}>
                  <td><strong>{backup.project_name}</strong><div className="user-meta">{backup.project_id}</div></td>
                  <td>{backup.deleted_by_name}</td>
                  <td>{formatIndianTime(backup.deleted_at)}</td>
                  <td>{formatIndianTime(backup.expires_at)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="btn-create-user" style={{ display: 'inline-flex', width: 'auto', marginRight: '8px', padding: '6px 10px' }} onClick={() => handleRestore(backup)}>Restore</button>
                    <button type="button" className="btn-del-user" onClick={() => handlePurge(backup)} title="Permanently delete backup"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
