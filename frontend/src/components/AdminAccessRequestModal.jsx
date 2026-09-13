import React from 'react';
import { ShieldCheck, X } from 'lucide-react';

export default function AdminAccessRequestModal({ affiliation, submitting, onConfirm, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="admin-access-title">
        <div className="modal-header">
          <div>
            <div className="modal-title" id="admin-access-title"><ShieldCheck size={17} /> Request Admin Access</div>
            <div className="modal-sub">Government viewer access request</div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close access request dialog"><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, color: '#334155', lineHeight: 1.6 }}>
            Submit an admin access request for your <strong>{affiliation}</strong> account?
          </p>
          <p style={{ margin: '10px 0 0', color: '#64748b', fontSize: '0.86rem', lineHeight: 1.5 }}>
            An administrator must review and approve this request before project management actions are enabled.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="modal-btn-cancel" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="button" className="modal-btn-save" onClick={onConfirm} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Confirm Request'}
          </button>
        </div>
      </div>
    </div>
  );
}