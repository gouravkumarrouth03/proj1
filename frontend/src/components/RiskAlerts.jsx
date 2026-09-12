import React from 'react';
import { AlertTriangle, Clock, ChevronRight } from 'lucide-react';
import './RiskAlerts.css';

const severityConfig = {
  critical: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)', border: 'rgba(239, 68, 68, 0.25)', Icon: AlertTriangle },
  warning: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.25)', Icon: Clock },
};

export default function RiskAlerts({ alerts, loading }) {
  if (loading) {
    return (
      <div className="risk-alerts-panel glass-panel">
        <div className="panel-header">
          <h3>Early Warning Alerts</h3>
        </div>
        <div className="alerts-list">
          {[1,2,3].map(i => <div key={i} className="alert-skeleton skeleton"></div>)}
        </div>
      </div>
    );
  }

  return (
    <div className="risk-alerts-panel glass-panel animate-fade-in" style={{ animationDelay: '200ms' }}>
      <div className="panel-header">
        <div>
          <h3>Early Warning Risk Alerts</h3>
          <p className="panel-subtitle">Automated signals from LOGIC CORE ML inference</p>
        </div>
        <span className="badge badge-danger">{alerts.length} Active</span>
      </div>
      <div className="alerts-list">
        {alerts.length === 0 ? (
          <p className="empty-state">No critical early warning alerts active across monitored projects.</p>
        ) : (
          alerts.map((alert, idx) => {
            const config = severityConfig[alert.severity] || severityConfig.warning;
            const { Icon } = config;
            return (
              <div
                key={idx}
                className="alert-item"
                style={{ background: config.bg, borderColor: config.border }}
              >
                <div className="alert-icon" style={{ color: config.color }}>
                  <Icon size={18} />
                </div>
                <div className="alert-body">
                  <div className="alert-title-row">
                    <span className="alert-type" style={{ color: config.color }}>{alert.alert_type}</span>
                    <span className="alert-project-id">{alert.project_id}</span>
                  </div>
                  <p className="alert-project-name">{alert.project_name}</p>
                  <p className="alert-message">{alert.message}</p>
                </div>
                <ChevronRight size={16} className="alert-chevron" />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
