import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const API_BASE = '';
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTOCOL}//${window.location.host}/ws`;

const COLORS = {
  primary: '#3b82f6',
  green: '#10b981',
  yellow: '#f59e0b',
  red: '#ef4444',
  purple: '#8b5cf6',
  gray: '#6b7280'
};

const DS_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function ImportTrendChart() {
  const [trendData, setTrendData] = useState([]);

  const fetchTrend = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/monitoring/import-trend?minutes=60`);
      const data = await res.json();
      setTrendData(data);
    } catch (e) {
      console.error('获取导入趋势失败:', e);
    }
  }, []);

  useEffect(() => {
    fetchTrend();
    const interval = setInterval(fetchTrend, 30000);
    return () => clearInterval(interval);
  }, [fetchTrend]);

  if (!trendData.length) {
    return <div style={{ color: COLORS.gray, padding: 40, textAlign: 'center' }}>暂无导入趋势数据</div>;
  }

  const labels = trendData[0]?.dataPoints.map(p => formatTime(p.time)) || [];

  const datasets = trendData.map((ds, i) => ({
    label: ds.dataSourceName,
    data: ds.dataPoints.map(p => p.count),
    borderColor: DS_COLORS[i % DS_COLORS.length],
    backgroundColor: DS_COLORS[i % DS_COLORS.length] + '20',
    fill: true,
    tension: 0.3,
    pointRadius: 2,
    borderWidth: 2
  }));

  const chartData = { labels, datasets };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, padding: 16 } },
      title: { display: false }
    },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: '#f3f4f6' }, title: { display: true, text: '导入量' } }
    },
    interaction: { mode: 'index', intersect: false }
  };

  return (
    <div style={{ height: 280, padding: 8 }}>
      <Line data={chartData} options={options} />
    </div>
  );
}

function AlertStream() {
  const [alerts, setAlerts] = useState([]);
  const wsRef = useRef(null);
  const containerRef = useRef(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/alerts?limit=50`);
      const data = await res.json();
      setAlerts(data.data || []);
    } catch (e) {
      console.error('获取告警列表失败:', e);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();

    const connectWs = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'alert') {
            setAlerts(prev => [msg.data, ...prev]);
          }
        } catch (e) {
          console.error('解析WS消息失败:', e);
        }
      };
      ws.onclose = () => {
        setTimeout(connectWs, 3000);
      };
      ws.onerror = () => {
        ws.close();
      };
    };
    connectWs();

    const interval = setInterval(fetchAlerts, 60000);
    return () => {
      clearInterval(interval);
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchAlerts]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [alerts]);

  const getSeverityStyle = (severity) => {
    if (severity === 'critical') return { bg: '#fef2f2', border: '#ef4444', icon: '🔴', label: '严重' };
    return { bg: '#fffbeb', border: '#f59e0b', icon: '🟡', label: '警告' };
  };

  const getTypeLabel = (type) => {
    const map = { volume_spike: '导入突增', discrepancy_ratio: '差异超限', reconciliation_failed: '对账失败' };
    return map[type] || type;
  };

  return (
    <div ref={containerRef} style={{ maxHeight: 360, overflowY: 'auto', padding: 4 }}>
      {alerts.length === 0 && <div style={{ color: COLORS.gray, textAlign: 'center', padding: 32 }}>暂无告警</div>}
      {alerts.map((alert, idx) => {
        const style = getSeverityStyle(alert.severity);
        return (
          <div key={alert.id || idx} style={{
            background: style.bg,
            borderLeft: `4px solid ${style.border}`,
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 8,
            animation: idx === 0 ? 'slideIn 0.3s ease' : 'none'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span>
                <span style={{ marginRight: 6 }}>{style.icon}</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{alert.title}</span>
              </span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ background: style.border, color: '#fff', borderRadius: 4, padding: '1px 8px', fontSize: 11 }}>{style.label}</span>
                <span style={{ background: '#e0e7ff', color: '#3730a3', borderRadius: 4, padding: '1px 8px', fontSize: 11 }}>{getTypeLabel(alert.type)}</span>
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{alert.message}</div>
            <div style={{ fontSize: 11, color: COLORS.gray, marginTop: 4 }}>{formatDateTime(alert.createdAt)}</div>
          </div>
        );
      })}
    </div>
  );
}

function HealthCard({ batch }) {
  const healthColors = {
    green: { bg: '#ecfdf5', border: '#10b981', label: '健康', icon: '✅' },
    yellow: { bg: '#fffbeb', border: '#f59e0b', label: '注意', icon: '⚠️' },
    red: { bg: '#fef2f2', border: '#ef4444', label: '异常', icon: '❌' }
  };

  const h = healthColors[batch.health] || healthColors.green;
  const base = batch.uniqueTransactionCount || batch.totalRecords || 1;
  const matchRate = ((batch.matchedCount / base) * 100).toFixed(1);
  const discRate = ((batch.discrepancyCount / base) * 100).toFixed(1);

  const typeLabels = {
    unilateral: '单边挂账',
    amount_mismatch: '金额不符',
    time_offset: '时间偏移'
  };

  return (
    <div style={{
      background: h.bg,
      border: `1px solid ${h.border}40`,
      borderRadius: 10,
      padding: 16,
      minWidth: 260,
      flex: '1 1 260px',
      maxWidth: 360
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{batch.batchNo}</span>
        <span style={{ background: h.border, color: '#fff', borderRadius: 6, padding: '2px 10px', fontSize: 12 }}>
          {h.icon} {h.label}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12, color: '#4b5563' }}>
        <div>总记录: <b>{batch.totalRecords}</b></div>
        <div>匹配: <b style={{ color: COLORS.green }}>{batch.matchedCount}</b></div>
        <div>差异: <b style={{ color: batch.health === 'red' ? COLORS.red : COLORS.yellow }}>{batch.discrepancyCount}</b></div>
        <div>匹配率: <b>{matchRate}%</b></div>
      </div>
      {batch.discrepancyCount > 0 && (
        <div style={{ marginTop: 8, fontSize: 11 }}>
          {Object.entries(batch.discrepancyByType || {}).map(([type, count]) => {
            const ratio = batch.discrepancyRatios?.[type];
            const ratioPercent = ratio != null ? (ratio * 100).toFixed(1) : '0.0';
            const ratioColor = ratio > 0.15 ? COLORS.red : ratio > 0.10 ? COLORS.yellow : COLORS.green;
            return (
              <div key={type} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid #e5e7eb' }}>
                <span>{typeLabels[type] || type}: {count}条</span>
                <span style={{ color: ratioColor, fontWeight: 600 }}>{ratioPercent}%</span>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ fontSize: 11, color: COLORS.gray, marginTop: 6 }}>
        完成: {formatDateTime(batch.endTime)}
      </div>
    </div>
  );
}

function BatchHealthOverview() {
  const [batches, setBatches] = useState([]);

  const fetchBatches = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/monitoring/batch-health`);
      const data = await res.json();
      setBatches(data);
    } catch (e) {
      console.error('获取批次健康度失败:', e);
    }
  }, []);

  useEffect(() => {
    fetchBatches();
    const interval = setInterval(fetchBatches, 30000);
    return () => clearInterval(interval);
  }, [fetchBatches]);

  if (batches.length === 0) {
    return <div style={{ color: COLORS.gray, textAlign: 'center', padding: 32 }}>暂无已完成的对账批次</div>;
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {batches.map(b => <HealthCard key={b.batchId} batch={b} />)}
    </div>
  );
}

function App() {
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>
          📊 对账实时监控面板
        </h1>
        <p style={{ color: COLORS.gray, fontSize: 13, margin: '4px 0 0' }}>
          实时监控数据导入、对账差异与告警事件
        </p>
      </div>

      <div style={{
        background: '#fff',
        borderRadius: 12,
        border: '1px solid #e5e7eb',
        padding: 20,
        marginBottom: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: '#374151', margin: '0 0 12px' }}>
          📈 数据源导入量趋势 <span style={{ fontWeight: 400, fontSize: 12, color: COLORS.gray }}>(最近1小时 / 5分钟粒度)</span>
        </h2>
        <ImportTrendChart />
      </div>

      <div style={{
        background: '#fff',
        borderRadius: 12,
        border: '1px solid #e5e7eb',
        padding: 20,
        marginBottom: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: '#374151', margin: '0 0 12px' }}>
          🔔 告警流 <span style={{ fontWeight: 400, fontSize: 12, color: COLORS.gray }}>(WebSocket实时推送)</span>
        </h2>
        <AlertStream />
      </div>

      <div style={{
        background: '#fff',
        borderRadius: 12,
        border: '1px solid #e5e7eb',
        padding: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: '#374151', margin: '0 0 12px' }}>
          💊 批次对账健康度 <span style={{ fontWeight: 400, fontSize: 12, color: COLORS.gray }}>
            <span style={{ color: COLORS.green }}>● 健康</span>&nbsp;
            <span style={{ color: COLORS.yellow }}>● 注意</span>&nbsp;
            <span style={{ color: COLORS.red }}>● 异常</span>
          </span>
        </h2>
        <BatchHealthOverview />
      </div>
    </div>
  );
}

export default App;
