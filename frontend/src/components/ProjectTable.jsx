import React from 'react';
import './ProjectTable.css';

function RiskBar({ score }) {
  const color = score > 75 ? '#ef4444' : score > 50 ? '#f59e0b' : '#10b981';
  return (
    <div className="risk-bar-wrapper">
      <div className="risk-bar-bg">
        <div className="risk-bar-fill" style={{ width: `${score}%`, background: color }}></div>
      </div>
      <span className="risk-score-label" style={{ color }}>{score}</span>
    </div>
  );
}

const statusBadge = {
  'Ongoing': 'badge-success',
  'On Schedule': 'badge-success',
  'Delayed': 'badge-danger',
  'At Risk': 'badge-warning',
};

export default function ProjectTable({ projects, loading }) {
  if (loading) {
    return (
      <div className="project-table-panel glass-panel">
        <div className="panel-header">
          <h3>Project Risk Intelligence</h3>
        </div>
        <div className="table-skeleton">
          {[1,2,3,4,5].map(i => <div key={i} className="row-skeleton skeleton"></div>)}
        </div>
      </div>
    );
  }

  return (
    <div className="project-table-panel glass-panel animate-fade-in" style={{ animationDelay: '300ms' }}>
      <div className="panel-header">
        <div>
          <h3>High Priority Monitored Projects</h3>
          <p className="panel-subtitle">Ranked by LOGIC CORE ML Composite Risk Index (highest first)</p>
        </div>
      </div>
      <div className="table-container">
        <table className="project-table">
          <thead>
            <tr>
              <th>Project ID</th>
              <th>Name</th>
              <th>Sector</th>
              <th>Revised Cost (₹ Cr)</th>
              <th>Cost Overrun%</th>
              <th>Status</th>
              <th>AI Risk Score</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project, idx) => {
              const costOverrunPct = (((project.revised_cost - project.original_cost) / project.original_cost) * 100).toFixed(1);
              return (
                <tr key={project.id} className="table-row" style={{ animationDelay: `${idx * 50}ms` }}>
                  <td className="project-id">{project.id}</td>
                  <td className="project-name-cell">{project.name}</td>
                  <td><span className="sector-tag">{project.sector}</span></td>
                  <td className="cost-cell">₹{project.revised_cost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                  <td className={`overrun-cell ${parseFloat(costOverrunPct) > 20 ? 'high-overrun' : ''}`}>
                    +{costOverrunPct}%
                  </td>
                  <td><span className={`badge ${statusBadge[project.status] || 'badge-warning'}`}>{project.status}</span></td>
                  <td><RiskBar score={project.risk_score} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
