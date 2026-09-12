import React from 'react';
import { Brain, Cpu, Zap } from 'lucide-react';
import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from 'recharts';
import './AIPredictionWidget.css';

function GaugeChart({ value, color }) {
  const data = [{ value, fill: color }];
  return (
    <ResponsiveContainer width={120} height={120}>
      <RadialBarChart
        innerRadius="65%"
        outerRadius="95%"
        data={data}
        startAngle={220}
        endAngle={-40}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
        <RadialBar
          background={{ fill: 'rgba(255,255,255,0.06)' }}
          dataKey="value"
          cornerRadius={6}
          angleAxisId={0}
        />
      </RadialBarChart>
    </ResponsiveContainer>
  );
}

export default function AIPredictionWidget({ projects }) {
  const avgRisk = projects.length
    ? (projects.reduce((s, p) => s + p.risk_score, 0) / projects.length).toFixed(1)
    : 0;
  const avgCostProb = projects.length
    ? (projects.reduce((s, p) => s + p.cost_overrun_prob, 0) / projects.length * 100).toFixed(1)
    : 0;
  const avgDelayProb = projects.length
    ? (projects.reduce((s, p) => s + p.time_delay_prob, 0) / projects.length * 100).toFixed(1)
    : 0;

  const riskColor = avgRisk > 70 ? '#ef4444' : avgRisk > 45 ? '#f59e0b' : '#10b981';

  return (
    <div className="ai-widget glass-panel animate-fade-in" style={{ animationDelay: '100ms' }}>
      <div className="ai-widget-header">
        <div className="ai-badge">
          <Brain size={14} />
          <span>LOGIC CORE ML Engine</span>
        </div>
        <h3>Portfolio Risk Snapshot</h3>
        <p className="panel-subtitle">Aggregate ML predictions across monitored projects</p>
      </div>

      <div className="gauge-center">
        <div className="gauge-wrapper">
          <GaugeChart value={parseFloat(avgRisk)} color={riskColor} />
          <div className="gauge-label">
            <span className="gauge-value" style={{ color: riskColor }}>{avgRisk}</span>
            <span className="gauge-text">Risk Index</span>
          </div>
        </div>
      </div>

      <div className="prediction-metrics">
        <div className="metric-row">
          <div className="metric-icon" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
            <Zap size={14} />
          </div>
          <div className="metric-info">
            <span className="metric-label">Cost Overrun Probability</span>
            <div className="metric-bar-wrapper">
              <div className="metric-bar-bg">
                <div className="metric-bar-fill" style={{ width: `${avgCostProb}%`, background: '#ef4444' }}></div>
              </div>
              <span className="metric-pct">{avgCostProb}%</span>
            </div>
          </div>
        </div>
        <div className="metric-row">
          <div className="metric-icon" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
            <Cpu size={14} />
          </div>
          <div className="metric-info">
            <span className="metric-label">Schedule Delay Probability</span>
            <div className="metric-bar-wrapper">
              <div className="metric-bar-bg">
                <div className="metric-bar-fill" style={{ width: `${avgDelayProb}%`, background: '#f59e0b' }}></div>
              </div>
              <span className="metric-pct">{avgDelayProb}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="model-info">
        <span className="model-tag"><Cpu size={12} /> XGBoost Ensemble Pipeline</span>
        <span className="model-accuracy">LOGIC CORE Validated</span>
      </div>
    </div>
  );
}
