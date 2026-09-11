import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import './StatCard.css';

export default function StatCard({ title, value, subtitle, icon: Icon, trend, trendLabel, color, delay = 0 }) {
  const trendPositive = trend > 0;
  return (
    <div className="stat-card glass-panel animate-fade-in" style={{ animationDelay: `${delay}ms` }}>
      <div className="stat-card-header">
        <p className="stat-title">{title}</p>
        <div className="stat-icon-wrapper" style={{ background: `${color}20`, border: `1px solid ${color}40` }}>
          <Icon size={20} style={{ color }} />
        </div>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-footer">
        {subtitle && <p className="stat-subtitle">{subtitle}</p>}
        {trend !== undefined && (
          <div className={`stat-trend ${trendPositive ? 'trend-up' : 'trend-down'}`}>
            {trendPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span>{Math.abs(trend)}% {trendLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}
