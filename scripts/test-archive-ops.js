const http = require('http');

const BASE = { hostname: 'localhost', port: 3001, headers: { 'Content-Type': 'application/json', 'X-User-Role': 'admin', 'X-User-Name': 'test_admin' } };

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = { ...BASE, path, method, headers: { ...BASE.headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } };
    const req = http.request(options, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }); }
        catch { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('\n========== 归档操作集成测试（管理员身份） ==========\n');

  console.log('1. 获取归档批次ID...');
  const { body: batches } = await request('GET', '/api/archive/batches?limit=1');
  const batchId = batches.data[0].id;
  const batchNo = batches.data[0].batchNo;
  console.log(`   测试批次: ${batchNo} (${batchId})`);

  console.log('\n2. 测试归档批次触发对账（应失败，提示已归档）...');
  const r1 = await request('POST', `/api/batches/${batchId}/reconcile`, {});
  console.log(`   状态码: ${r1.status}, 响应: ${JSON.stringify(r1.body)}`);

  console.log('\n3. 测试归档批次导入交易（应失败，提示已归档）...');
  const ds = await request('GET', '/api/data-sources');
  const dsId = ds.body.data ? ds.body.data[0].id : ds.body[0].id;
  const r2 = await request('POST', '/api/transactions/import', { dataSourceId: dsId, batchId, records: [{ transactionId: 'TEST-001', amount: 100, timestamp: '2024-01-01T00:00:00' }] });
  console.log(`   状态码: ${r2.status}, 响应: ${JSON.stringify(r2.body)}`);

  console.log('\n4. 测试回迁批次（应成功）...');
  const r3 = await request('POST', `/api/archive/batches/${batchId}/restore`);
  console.log(`   状态码: ${r3.status}`);
  if (r3.status === 200) {
    console.log(`   结果: message=${r3.body.message}`);
    console.log(`   stats: ${JSON.stringify(r3.body.stats)}`);
    console.log(`   batch.isArchived=${r3.body.batch.isArchived}`);
  } else {
    console.log(`   错误: ${JSON.stringify(r3.body)}`);
  }

  console.log('\n5. 验证回迁后主表有数据...');
  const r4 = await request('GET', `/api/transactions?batchId=${batchId}&limit=3`);
  console.log(`   主表交易数: ${r4.body.total}`);
  const r5 = await request('GET', `/api/archive/transactions?batchId=${batchId}`);
  console.log(`   归档表交易数: ${r5.body.total}`);

  console.log('\n6. 验证回迁后批次未归档标记...');
  const { body: batchDetail } = await request('GET', `/api/batches/${batchId}`);
  console.log(`   isArchived=${batchDetail.isArchived}, archivedAt=${batchDetail.archivedAt}`);
  if (batchDetail.archiveInfo) {
    console.log(`   archiveInfo存在? 是（不应有）`);
  } else {
    console.log(`   archiveInfo存在? 否（正确，因为已回迁）`);
  }

  console.log('\n7. 测试重新归档该批次（应成功）...');
  const r7 = await request('POST', `/api/archive/batches/${batchId}`);
  console.log(`   状态码: ${r7.status}`);
  if (r7.status === 200) {
    console.log(`   结果: ${r7.body.message}`);
    console.log(`   stats: ${JSON.stringify(r7.body.stats)}`);
  } else {
    console.log(`   错误: ${JSON.stringify(r7.body)}`);
  }

  console.log('\n8. 验证重新归档后的数据位置...');
  const r8 = await request('GET', `/api/transactions?batchId=${batchId}&limit=3`);
  console.log(`   主表交易数: ${r8.body.total} (应为0)`);
  const r9 = await request('GET', `/api/archive/transactions?batchId=${batchId}`);
  console.log(`   归档表交易数: ${r9.body.total} (应为>0)`);

  console.log('\n9. 测试审计日志中是否有归档/回迁记录...');
  const audit = await request('GET', '/api/audit-logs?limit=20');
  const actions = audit.body.data ? audit.body.data.map(l => `${l.action}:${l.targetType}`).slice(0, 10) : 'no data';
  console.log(`   最近操作记录: ${JSON.stringify(actions)}`);

  console.log('\n10. 测试告警事件中是否有归档完成事件...');
  const alerts = await request('GET', '/api/alerts?type=archive_complete&limit=5');
  const archivedAlerts = alerts.body.data ? alerts.body.data.length : 0;
  console.log(`   归档完成告警数: ${archivedAlerts}`);
  if (archivedAlerts > 0) {
    const last = alerts.body.data[alerts.body.data.length - 1];
    console.log(`   最新: ${last.title} - ${last.message.substring(0, 50)}...`);
  }

  console.log('\n========== 操作测试完成 ==========\n');
}

main().catch(console.error);
