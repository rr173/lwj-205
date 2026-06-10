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

const PASS = '\x1b[32m✓ PASS\x1b[0m';
const FAIL = '\x1b[31m✗ FAIL\x1b[0m';
const cases = [];
function assert(name, cond, detail = '') {
  cases.push({ name, pass: cond, detail });
  console.log(`${cond ? PASS : FAIL} ${name}${detail ? ' - ' + detail : ''}`);
}

async function main() {
  console.log('\n========== 归档功能Bug修复专项验证 ==========\n');

  // ---------- 问题1：pending批次不能归档 ----------
  console.log('【问题1验证】pending状态批次能否被归档（应不能）');
  const { body: batches } = await request('GET', '/api/batches?status=pending');
  const pendingBatch = batches.data ? batches.data[0] : null;
  if (pendingBatch) {
    console.log(`   找到pending批次: ${pendingBatch.batchNo} (status=${pendingBatch.status})`);
    const r = await request('POST', `/api/archive/batches/${pendingBatch.id}`);
    const shouldFail = r.status === 400 && /不能归档|状态/.test(r.body.error || '');
    assert('pending批次被拒绝归档', shouldFail, `status=${r.status}, error=${r.body.error}`);
  } else {
    assert('pending批次存在', false, '无pending批次可测试');
  }

  // ---------- 问题3：配置校验 retentionDays=0 应被拒绝 ----------
  console.log('\n【问题3验证】retentionDays=0能否保存（应不能）');
  const { body: configs } = await request('GET', '/api/archive/configs');
  const cfgId = configs.data[0].id;
  const r0 = await request('PUT', `/api/archive/configs/${cfgId}`, { retentionDays: 0 });
  const ok3a = r0.status === 400 || (r0.body.error && /最少|最小/.test(r0.body.error));
  assert('retentionDays=0被拒绝', ok3a, `status=${r0.status}, error=${r0.body.error}`);

  const r1 = await request('PUT', `/api/archive/configs/${cfgId}`, { retentionDays: -5 });
  const ok3b = r1.status === 400 || (r1.body.error && /最少|负数|最小/.test(r1.body.error));
  assert('retentionDays=-5被拒绝', ok3b, `status=${r1.status}, error=${r1.body.error}`);

  const r2 = await request('PUT', `/api/archive/configs/${cfgId}`, { dailyRunHour: 25 });
  const ok3c = r2.status === 400 || (r2.body.error && /0-23|执行时间/.test(r2.body.error));
  assert('dailyRunHour=25被拒绝', ok3c, `status=${r2.status}, error=${r2.body.error}`);

  const rGood = await request('PUT', `/api/archive/configs/${cfgId}`, { retentionDays: 7, dailyRunHour: 3 });
  const ok3d = rGood.status === 200;
  assert('retentionDays=7,dailyRunHour=3保存成功', ok3d, `status=${rGood.status} ${rGood.body.error || ''}`);

  // ---------- 问题2：并发归档/回迁 数据重复 ----------
  console.log('\n【问题2验证】并发归档和回迁能否都返回成功（应只有一个成功，另一个被锁/状态拒绝）');
  const { body: archBatches } = await request('GET', '/api/archive/batches?limit=1');
  const testBatch = archBatches.data[0];
  console.log(`   测试批次: ${testBatch.batchNo} (isArchived=${testBatch.isArchived}, id=${testBatch.id.slice(0,8)}...)`);

  const p1 = request('POST', `/api/archive/batches/${testBatch.id}/restore`);
  const p2 = request('POST', `/api/archive/batches/${testBatch.id}`);
  const [resRestore, resArchive] = await Promise.all([p1, p2]);

  console.log(`   回迁: status=${resRestore.status}, success=${resRestore.status===200}, error=${resRestore.body.error || ''}`);
  console.log(`   归档: status=${resArchive.status}, success=${resArchive.status===200}, error=${resArchive.body.error || ''}`);

  // 理论上：同一批次已归档，所以restore应该成功，archive应该提示"已归档无需重复"
  // 或者，并发冲突时，第二个请求会被锁或状态检查拒绝
  const successCount = [resRestore, resArchive].filter(r => r.status === 200).length;
  // 无论如何，数据最终必须在一边，不能两边都有
  await new Promise(r => setTimeout(r, 500));
  const afterMain = await request('GET', `/api/transactions?batchId=${testBatch.id}`);
  const afterArchive = await request('GET', `/api/archive/transactions?batchId=${testBatch.id}`);
  const mainCount = afterMain.body.total || 0;
  const archCount = afterArchive.body.total || 0;
  console.log(`   并发操作后：主表=${mainCount}条，归档表=${archCount}条`);

  const batchDetail = await request('GET', `/api/batches/${testBatch.id}`);
  const finalArchived = batchDetail.body.isArchived;

  // 关键断言：同一笔数据不能同时存在两边
  // 要么都在主表要么都在归档表
  const noDup = (mainCount === 0 && archCount > 0) || (mainCount > 0 && archCount === 0) || (mainCount === 0 && archCount === 0);
  assert('无数据重复（同批不同时存在主表和归档表）', noDup, `main=${mainCount}, archive=${archCount}, isArchived=${finalArchived}`);

  // 断言：最多只能有一个请求业务成功
  const okAtMostOne = successCount <= 1;
  assert('并发请求最多只能有一个成功', okAtMostOne, `两个都成功? successCount=${successCount}`);

  // 断言：最终状态一致
  const okConsistent = (finalArchived === true && archCount > 0 && mainCount === 0) ||
                       (finalArchived === false && mainCount > 0 && archCount === 0);
  assert('批次标记与数据实际位置一致', okConsistent, `isArchived=${finalArchived}, main=${mainCount}, archive=${archCount}`);

  // ---------- 汇总 ----------
  const passCount = cases.filter(c => c.pass).length;
  console.log(`\n========== 结果: ${passCount}/${cases.length} 用例通过 ==========\n`);
  if (passCount < cases.length) {
    console.log('失败用例详情:');
    cases.filter(c => !c.pass).forEach(c => console.log(`  - ${c.name}: ${c.detail}`));
    process.exit(1);
  }
  console.log('所有Bug已修复!');
}

main().catch(err => { console.error(err); process.exit(1); });
