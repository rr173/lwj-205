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

  const getScopeLabel = (scope) => {
    if (!scope) return null;
    if (scope === 'global') return { text: '全局规则', bg: '#dbeafe', color: '#1e40af' };
    return { text: '数据源规则', bg: '#fce7f3', color: '#9d174d' };
  };

  return (
    <div ref={containerRef} style={{ maxHeight: 360, overflowY: 'auto', padding: 4 }}>
      {alerts.length === 0 && <div style={{ color: COLORS.gray, textAlign: 'center', padding: 32 }}>暂无告警</div>}
      {alerts.map((alert, idx) => {
        const style = getSeverityStyle(alert.severity);
        const scopeInfo = getScopeLabel(alert.triggeredRuleScope);
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
                {scopeInfo && (
                  <span style={{ background: scopeInfo.bg, color: scopeInfo.color, borderRadius: 4, padding: '1px 8px', fontSize: 11 }}>{scopeInfo.text}</span>
                )}
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

function MonitoringDashboard() {
  return (
    <>
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
    </>
  );
}

function AlertRulesPage() {
  const [rules, setRules] = useState([]);
  const [dataSources, setDataSources] = useState([]);
  const [history, setHistory] = useState({ total: 0, data: [] });
  const [historyPage, setHistoryPage] = useState(0);
  const [editingRule, setEditingRule] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showCreateDS, setShowCreateDS] = useState(false);
  const [createForm, setCreateForm] = useState({ ruleKey: '', dataSourceId: '', parameters: {} });
  const [showHistory, setShowHistory] = useState(false);
  const [notification, setNotification] = useState(null);

  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/alert-rules`);
      const data = await res.json();
      setRules(data);
    } catch (e) {
      console.error('获取告警规则失败:', e);
    }
  }, []);

  const fetchDataSources = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/data-sources`);
      const data = await res.json();
      setDataSources(data.data || data);
    } catch (e) {
      console.error('获取数据源失败:', e);
    }
  }, []);

  const fetchHistory = useCallback(async (page = 0) => {
    try {
      const res = await fetch(`${API_BASE}/api/alert-rules-history?limit=20&offset=${page * 20}`);
      const data = await res.json();
      setHistory(data);
    } catch (e) {
      console.error('获取规则历史失败:', e);
    }
  }, []);

  useEffect(() => {
    fetchRules();
    fetchDataSources();
    fetchHistory(0);
  }, [fetchRules, fetchDataSources, fetchHistory]);

  const handleToggle = async (ruleId) => {
    try {
      await fetch(`${API_BASE}/api/alert-rules/${ruleId}/toggle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator: 'admin' })
      });
      showNotification('规则开关已切换');
      fetchRules();
      fetchHistory(historyPage);
    } catch (e) {
      showNotification('操作失败: ' + e.message, 'error');
    }
  };

  const handleSave = async () => {
    try {
      const body = {
        parameters: editForm.parameters,
        name: editForm.name,
        operator: 'admin'
      };
      await fetch(`${API_BASE}/api/alert-rules/${editingRule}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      showNotification('规则已更新');
      setEditingRule(null);
      setEditForm({});
      fetchRules();
      fetchHistory(historyPage);
    } catch (e) {
      showNotification('保存失败: ' + e.message, 'error');
    }
  };

  const handleCreateDSOverride = async () => {
    try {
      if (!createForm.ruleKey || !createForm.dataSourceId) {
        showNotification('请选择规则类型和数据源', 'error');
        return;
      }
      const baseRule = rules.find(r => r.ruleKey === createForm.ruleKey && r.scope === 'global');
      await fetch(`${API_BASE}/api/alert-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: (baseRule?.name || createForm.ruleKey) + ' (数据源覆盖)',
          ruleKey: createForm.ruleKey,
          scope: 'datasource',
          dataSourceId: createForm.dataSourceId,
          parameters: { ...baseRule?.parameters, ...createForm.parameters },
          operator: 'admin'
        })
      });
      showNotification('数据源覆盖规则已创建');
      setShowCreateDS(false);
      setCreateForm({ ruleKey: '', dataSourceId: '', parameters: {} });
      fetchRules();
      fetchHistory(historyPage);
    } catch (e) {
      showNotification('创建失败: ' + e.message, 'error');
    }
  };

  const handleDelete = async (ruleId) => {
    if (!window.confirm('确定要删除此规则吗？')) return;
    try {
      await fetch(`${API_BASE}/api/alert-rules/${ruleId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator: 'admin' })
      });
      showNotification('规则已删除');
      fetchRules();
      fetchHistory(historyPage);
    } catch (e) {
      showNotification('删除失败: ' + e.message, 'error');
    }
  };

  const startEdit = (rule) => {
    setEditingRule(rule.id);
    setEditForm({ name: rule.name, parameters: { ...rule.parameters } });
  };

  const globalRules = rules.filter(r => r.scope === 'global');
  const dsRules = rules.filter(r => r.scope === 'datasource');

  const ruleKeyLabels = {
    volume_spike_multiplier: '导入突增倍数',
    volume_spike_cooldown: '突增冷却时间',
    discrepancy_ratio_unilateral: '单边挂账阈值',
    discrepancy_ratio_amount_mismatch: '金额不符阈值',
    discrepancy_ratio_time_offset: '时间偏移阈值'
  };

  const uniqueRuleKeys = [...new Set(rules.filter(r => r.scope === 'global').map(r => r.ruleKey))];

  const renderParamInput = (paramKey, paramValue, onChange) => {
    if (paramKey === 'multiplier') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min="1"
            max="100"
            step="0.5"
            value={paramValue}
            onChange={e => onChange(parseFloat(e.target.value) || 1)}
            style={{ width: 80, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          />
          <span style={{ fontSize: 12, color: COLORS.gray }}>倍</span>
        </div>
      );
    }
    if (paramKey === 'cooldownMinutes') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min="1"
            max="1440"
            step="1"
            value={paramValue}
            onChange={e => onChange(parseInt(e.target.value) || 1)}
            style={{ width: 80, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          />
          <span style={{ fontSize: 12, color: COLORS.gray }}>分钟</span>
        </div>
      );
    }
    if (paramKey === 'threshold') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min="0.01"
            max="1"
            step="0.01"
            value={paramValue}
            onChange={e => onChange(parseFloat(e.target.value) || 0.01)}
            style={{ width: 80, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          />
          <span style={{ fontSize: 12, color: COLORS.gray }}>{paramValue >= 1 ? '' : `(${(paramValue * 100).toFixed(0)}%)`}</span>
        </div>
      );
    }
    return (
      <input
        type="text"
        value={paramValue}
        onChange={e => onChange(e.target.value)}
        style={{ width: 120, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
      />
    );
  };

  return (
    <div>
      {notification && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 1000,
          background: notification.type === 'error' ? '#fef2f2' : '#ecfdf5',
          border: `1px solid ${notification.type === 'error' ? '#ef4444' : '#10b981'}`,
          color: notification.type === 'error' ? '#991b1b' : '#065f46',
          padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          animation: 'slideIn 0.3s ease'
        }}>
          {notification.msg}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#374151', margin: 0 }}>全局告警规则</h2>
          <p style={{ fontSize: 12, color: COLORS.gray, margin: '4px 0 0' }}>修改后立即生效，无需重启服务</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              padding: '6px 14px', borderRadius: 8, border: '1px solid #d1d5db',
              background: showHistory ? '#f3f4f6' : '#fff', fontSize: 12, cursor: 'pointer',
              color: '#374151'
            }}
          >
            {showHistory ? '隐藏' : '查看'}变更历史
          </button>
          <button
            onClick={() => setShowCreateDS(true)}
            style={{
              padding: '6px 14px', borderRadius: 8, border: 'none',
              background: COLORS.primary, color: '#fff', fontSize: 12, cursor: 'pointer',
              fontWeight: 500
            }}
          >
            + 添加数据源覆盖规则
          </button>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280', fontWeight: 500, fontSize: 12 }}>规则名称</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: '#6b7280', fontWeight: 500, fontSize: 12 }}>参数</th>
              <th style={{ padding: '10px 16px', textAlign: 'center', color: '#6b7280', fontWeight: 500, fontSize: 12 }}>状态</th>
              <th style={{ padding: '10px 16px', textAlign: 'center', color: '#6b7280', fontWeight: 500, fontSize: 12 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {globalRules.map(rule => (
              <tr key={rule.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ fontWeight: 500, color: '#111827' }}>{rule.name}</div>
                  <div style={{ fontSize: 11, color: COLORS.gray, marginTop: 2 }}>{rule.description}</div>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {editingRule === rule.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {Object.entries(editForm.parameters).map(([key, val]) => (
                        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, color: '#6b7280', minWidth: 80 }}>{key}:</span>
                          {renderParamInput(key, val, (newVal) => {
                            setEditForm(prev => ({
                              ...prev,
                              parameters: { ...prev.parameters, [key]: newVal }
                            }));
                          })}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {Object.entries(rule.parameters).map(([key, val]) => (
                        <div key={key} style={{ fontSize: 12 }}>
                          <span style={{ color: '#6b7280' }}>{key}:</span>{' '}
                          <span style={{ fontWeight: 600, color: COLORS.primary }}>
                            {key === 'threshold' ? `${(val * 100).toFixed(0)}% (${val})` : val}
                          </span>
                          {key === 'multiplier' && <span style={{ color: COLORS.gray }}> 倍</span>}
                          {key === 'cooldownMinutes' && <span style={{ color: COLORS.gray }}> 分钟</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                  <button
                    onClick={() => handleToggle(rule.id)}
                    style={{
                      padding: '3px 12px', borderRadius: 12, fontSize: 11, cursor: 'pointer', border: 'none',
                      background: rule.enabled ? '#d1fae5' : '#fee2e2',
                      color: rule.enabled ? '#065f46' : '#991b1b',
                      fontWeight: 500
                    }}
                  >
                    {rule.enabled ? '✓ 启用' : '✗ 停用'}
                  </button>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                  {editingRule === rule.id ? (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <button onClick={handleSave} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: COLORS.primary, color: '#fff', fontSize: 12, cursor: 'pointer' }}>保存</button>
                      <button onClick={() => { setEditingRule(null); setEditForm({}); }} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 12, cursor: 'pointer' }}>取消</button>
                    </div>
                  ) : (
                    <button onClick={() => startEdit(rule)} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151' }}>编辑</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dsRules.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#374151', margin: '0 0 8px' }}>数据源专属规则</h2>
          <p style={{ fontSize: 12, color: COLORS.gray, margin: '0 0 12px' }}>数据源专属规则优先于全局规则生效</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            {dsRules.map(rule => (
              <div key={rule.id} style={{
                background: '#fff',
                border: `1px solid ${rule.enabled ? '#c4b5fd' : '#e5e7eb'}`,
                borderRadius: 10,
                padding: 16,
                minWidth: 280,
                maxWidth: 360,
                flex: '1 1 280px',
                opacity: rule.enabled ? 1 : 0.6
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>{rule.name}</div>
                    <div style={{ fontSize: 11, color: COLORS.purple, marginTop: 2 }}>
                      🏷️ {rule.dataSourceName || '未知数据源'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      onClick={() => handleToggle(rule.id)}
                      style={{
                        padding: '2px 10px', borderRadius: 12, fontSize: 10, cursor: 'pointer', border: 'none',
                        background: rule.enabled ? '#d1fae5' : '#fee2e2',
                        color: rule.enabled ? '#065f46' : '#991b1b',
                        fontWeight: 500
                      }}
                    >
                      {rule.enabled ? '✓ 启用' : '✗ 停用'}
                    </button>
                    <button onClick={() => handleDelete(rule.id)} style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', fontSize: 10, cursor: 'pointer', color: COLORS.red }}>删除</button>
                  </div>
                </div>
                {editingRule === rule.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {Object.entries(editForm.parameters).map(([key, val]) => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, color: '#6b7280', minWidth: 80 }}>{key}:</span>
                        {renderParamInput(key, val, (newVal) => {
                          setEditForm(prev => ({
                            ...prev,
                            parameters: { ...prev.parameters, [key]: newVal }
                          }));
                        })}
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <button onClick={handleSave} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: COLORS.primary, color: '#fff', fontSize: 12, cursor: 'pointer' }}>保存</button>
                      <button onClick={() => { setEditingRule(null); setEditForm({}); }} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 12, cursor: 'pointer' }}>取消</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {Object.entries(rule.parameters).map(([key, val]) => (
                      <div key={key} style={{ fontSize: 12 }}>
                        <span style={{ color: '#6b7280' }}>{key}:</span>{' '}
                        <span style={{ fontWeight: 600, color: COLORS.purple }}>
                          {key === 'threshold' ? `${(val * 100).toFixed(0)}% (${val})` : val}
                        </span>
                        {key === 'multiplier' && <span style={{ color: COLORS.gray }}> 倍</span>}
                        {key === 'cooldownMinutes' && <span style={{ color: COLORS.gray }}> 分钟</span>}
                      </div>
                    ))}
                    <button onClick={() => startEdit(rule)} style={{ marginTop: 6, padding: '2px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 11, cursor: 'pointer', color: '#374151', alignSelf: 'flex-start' }}>编辑</button>
                  </div>
                )}
                <div style={{ fontSize: 11, color: COLORS.gray, marginTop: 8 }}>
                  规则类型: {ruleKeyLabels[rule.ruleKey] || rule.ruleKey}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {showCreateDS && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100
        }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 420, maxHeight: '80vh', overflow: 'auto' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15 }}>添加数据源覆盖规则</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>规则类型</label>
              <select
                value={createForm.ruleKey}
                onChange={e => {
                  const key = e.target.value;
                  const baseRule = rules.find(r => r.ruleKey === key && r.scope === 'global');
                  setCreateForm(prev => ({
                    ...prev,
                    ruleKey: key,
                    parameters: baseRule ? { ...baseRule.parameters } : {}
                  }));
                }}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
              >
                <option value="">请选择规则类型</option>
                {uniqueRuleKeys.map(key => (
                  <option key={key} value={key}>{ruleKeyLabels[key] || key}</option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>数据源</label>
              <select
                value={createForm.dataSourceId}
                onChange={e => setCreateForm(prev => ({ ...prev, dataSourceId: e.target.value }))}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
              >
                <option value="">请选择数据源</option>
                {dataSources.map(ds => (
                  <option key={ds.id} value={ds.id}>{ds.name}</option>
                ))}
              </select>
            </div>
            {createForm.ruleKey && Object.keys(createForm.parameters).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>参数覆盖</label>
                {Object.entries(createForm.parameters).map(([key, val]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: '#6b7280', minWidth: 80 }}>{key}:</span>
                    {renderParamInput(key, val, (newVal) => {
                      setCreateForm(prev => ({
                        ...prev,
                        parameters: { ...prev.parameters, [key]: newVal }
                      }));
                    })}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowCreateDS(false); setCreateForm({ ruleKey: '', dataSourceId: '', parameters: {} }); }} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer' }}>取消</button>
              <button onClick={handleCreateDSOverride} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: COLORS.primary, color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>创建</button>
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div style={{
          background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 20, marginBottom: 20
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#374151' }}>📋 规则变更历史</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {historyPage > 0 && (
                <button onClick={() => { setHistoryPage(historyPage - 1); fetchHistory(historyPage - 1); }} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 12, cursor: 'pointer' }}>上一页</button>
              )}
              {history.data.length >= 20 && (
                <button onClick={() => { setHistoryPage(historyPage + 1); fetchHistory(historyPage + 1); }} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 12, cursor: 'pointer' }}>下一页</button>
              )}
            </div>
          </div>
          {history.data.length === 0 ? (
            <div style={{ color: COLORS.gray, textAlign: 'center', padding: 24, fontSize: 13 }}>暂无变更历史</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 500 }}>时间</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 500 }}>操作人</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 500 }}>变更字段</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 500 }}>旧值</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 500 }}>新值</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((h, idx) => (
                  <tr key={h.id || idx} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 12px', color: COLORS.gray, whiteSpace: 'nowrap' }}>{formatDateTime(h.createdAt)}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '1px 8px', borderRadius: 4, fontSize: 11 }}>{h.operator || 'system'}</span>
                    </td>
                    <td style={{ padding: '8px 12px', fontWeight: 500, color: '#111827' }}>{h.field}</td>
                    <td style={{ padding: '8px 12px', color: COLORS.red, fontFamily: 'monospace' }}>{h.oldValue || '-'}</td>
                    <td style={{ padding: '8px 12px', color: COLORS.green, fontFamily: 'monospace' }}>{h.newValue || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('monitoring');

  const tabs = [
    { key: 'monitoring', label: '📊 实时监控', desc: '导入趋势 / 告警流 / 批次健康度' },
    { key: 'rules', label: '⚙️ 告警规则', desc: '配置告警阈值 / 数据源覆盖 / 变更历史' }
  ];

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

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '2px solid #e5e7eb', paddingBottom: 0 }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? COLORS.primary : COLORS.gray,
              borderBottom: activeTab === tab.key ? `3px solid ${COLORS.primary}` : '3px solid transparent',
              transition: 'all 0.2s ease',
              marginBottom: -2
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'monitoring' && <MonitoringDashboard />}
      {activeTab === 'rules' && <AlertRulesPage />}
    </div>
  );
}

export default App;
