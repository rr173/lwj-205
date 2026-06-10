#!/bin/bash
set -e

BASE_URL="http://localhost:3001/api"
echo "========== 归档功能集成测试 =========="

echo ""
echo "=== 1. 测试归档统计接口 ==="
curl -s "$BASE_URL/archive/stats" | python3 -m json.tool

echo ""
echo "=== 2. 测试归档批次列表（应该有3条预置数据）==="
curl -s "$BASE_URL/archive/batches?limit=10" | python3 -m json.tool

echo ""
echo "=== 3. 测试归档配置列表 ==="
curl -s "$BASE_URL/archive/configs" | python3 -m json.tool

echo ""
echo "=== 4. 测试普通批次列表（默认不包含归档）==="
curl -s "$BASE_URL/batches?limit=10" | python3 -m json.tool

echo ""
echo "=== 5. 测试普通批次列表（显式包含归档）==="
curl -s "$BASE_URL/batches?includeArchived=true&limit=20" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print(f'总数: {d[\"total\"]}')
archived = [b for b in d['data'] if b.get('isArchived')]
print(f'其中归档批次: {len(archived)}')
for b in d['data']:
    status = '[ARCHIVED]' if b.get('isArchived') else '[ACTIVE]  '
    print(f'  {status} {b[\"batchNo\"]} - {b[\"status\"]} - archivedAt={b.get(\"archivedAt\")}')"

echo ""
echo "=== 6. 按归档时间范围查询归档批次（7天内）==="
TODAY=$(date +%Y-%m-%d)
SEVEN_DAYS_AGO=$(date -v-7d +%Y-%m-%d 2>/dev/null || date -d "7 days ago" +%Y-%m-%d)
curl -s "$BASE_URL/archive/batches?startDate=$SEVEN_DAYS_AGO&endDate=$TODAY" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print(f'7天内归档的批次: {d[\"total\"]} 条')
for b in d['data']:
    print(f'  {b[\"batchNo\"]} - archivedAt={b[\"archivedAt\"]}')"

echo ""
echo "=== 7. 查询某个归档批次的归档交易记录（取第一个归档批次）==="
BATCH_ID=$(curl -s "$BASE_URL/archive/batches?limit=1" | python3 -c "import json,sys; print(json.load(sys.stdin)['data'][0]['id'])")
BATCH_NO=$(curl -s "$BASE_URL/archive/batches?limit=1" | python3 -c "import json,sys; print(json.load(sys.stdin)['data'][0]['batchNo'])")
echo "测试批次: $BATCH_NO ($BATCH_ID)"
curl -s "$BASE_URL/archive/transactions?batchId=$BATCH_ID&limit=5" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print(f'归档交易总数: {d[\"total\"]}，展示前5条:')
for t in d['data'][:5]:
    print(f'  {t[\"transactionId\"]} - amount={t[\"amount\"]} - ds={t[\"dataSourceId\"][:8]}...')"

echo ""
echo "=== 8. 查询归档差异记录 ==="
curl -s "$BASE_URL/archive/discrepancies?batchId=$BATCH_ID" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print(f'归档差异总数: {d[\"total\"]}')
for disc in d['data']:
    print(f'  {disc[\"type\"]} - {disc[\"status\"]} - txn={disc[\"transactionId\"]}')"

echo ""
echo "=== 9. 查询归档仲裁工单 ==="
curl -s "$BASE_URL/archive/tickets?batchId=$BATCH_ID" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print(f'归档工单总数: {d[\"total\"]}')
for t in d['data']:
    print(f'  status={t[\"status\"]} - resolutionType={t[\"resolutionType\"]}')"

echo ""
echo "=== 10. 测试批次详情（包含归档信息）==="
curl -s "$BASE_URL/batches/$BATCH_ID" | python3 -c "
import json,sys
b = json.load(sys.stdin)
print(f'批次: {b[\"batchNo\"]}')
print(f'isArchived: {b[\"isArchived\"]}')
print(f'archivedAt: {b[\"archivedAt\"]}')
if 'archiveInfo' in b:
    print(f'archiveInfo: {b[\"archiveInfo\"]}')"

echo ""
echo "=== 11. 测试归档批次不能触发对账 ==="
curl -s -X POST -H "Content-Type: application/json" -d '{}' "$BASE_URL/batches/$BATCH_ID/reconcile" | python3 -m json.tool

echo ""
echo "=== 12. 测试已归档批次不能导入交易 ==="
ALL_SOURCES=$(curl -s "$BASE_URL/data-sources" | python3 -c "import json,sys; ds=json.load(sys.stdin); print(ds[0]['id'] if isinstance(ds, list) else ds['data'][0]['id'])")
echo "测试数据源: $ALL_SOURCES"
curl -s -X POST -H "Content-Type: application/json" -d "{\"dataSourceId\":\"$ALL_SOURCES\",\"batchId\":\"$BATCH_ID\",\"records\":[{\"transactionId\":\"TEST-001\",\"amount\":100,\"timestamp\":\"2024-01-01T00:00:00\"}]}" "$BASE_URL/transactions/import" | python3 -m json.tool

echo ""
echo "========== 核心功能测试完成 =========="
echo "提示: 可继续手动测试以下接口:"
echo "  POST /api/archive/batches/$BATCH_ID/restore - 回迁批次"
echo "  POST /api/archive/run-now - 立即执行自动归档"
echo "  PUT /api/archive/configs/<configId> - 修改归档配置"
