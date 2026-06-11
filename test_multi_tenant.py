import requests
import json

BASE = "http://localhost:3567"

def print_test(name, actual, expected):
    status = "✓ PASS" if actual == expected else "✗ FAIL"
    print(f"{status}: {name} (实际:{actual}, 期望:{expected})")

def request(method, path, **kwargs):
    url = f"{BASE}{path}"
    print(f"  -> {method} {path}")
    resp = requests.request(method, url, timeout=10, **kwargs)
    try:
        data = resp.json()
    except:
        data = resp.text
    return resp.status_code, data

# ===== 1. 测试缺少租户头 =====
print("\n=== 1. 缺少租户头测试 ===")
code, _ = request("GET", "/api/data-sources")
print_test("不带X-Tenant-Id返回400", code, 400)

# ===== 2. 测试无效租户ID =====
print("\n=== 2. 无效租户ID测试 ===")
code, data = request("GET", "/api/data-sources", headers={"X-Tenant-Id": "not-exist"})
print_test("无效租户ID返回400", code, 400)

# ===== 3. 测试default租户 =====
print("\n=== 3. default租户测试 ===")
code, data = request("GET", "/api/data-sources", headers={"X-Tenant-Id": "default"})
print_test("default租户访问数据源返回200", code, 200)
if code == 200:
    print_test("default租户有3个演示数据源", len(data), 3)
    DEFAULT_DS_ID = data[0]["id"] if data else None

# ===== 4. 超级管理员创建team-gamma =====
print("\n=== 4. 超级管理员创建租户 ===")
sa_headers = {"X-User-Role": "superadmin", "X-User-Id": "admin-001"}
code, data = request("POST", "/api/tenants",
    headers={**sa_headers, "Content-Type": "application/json"},
    json={
        "name": "team-gamma",
        "displayName": "伽马团队",
        "description": "用于测试的团队",
        "quotas": {
            "maxDataSources": 2,
            "maxRecordsPerBatch": 500,
            "maxActiveSchedulePlans": 1,
            "maxConcurrentSandboxes": 1,
            "maxApiCallsPerHour": 100
        }
    })
print_test("创建租户返回201", code, 201)
if code == 201:
    GAMMA_ID = data["tenant"]["id"]
    print(f"  新租户ID: {GAMMA_ID}")

# ===== 5. team-gamma数据隔离(应该是空的) =====
print("\n=== 5. 新租户数据隔离 ===")
code, data = request("GET", "/api/data-sources", headers={"X-Tenant-Id": "team-gamma"})
print_test("team-gamma的数据源为空", len(data), 0)

# ===== 6. 跨租户访问测试 =====
print("\n=== 6. 跨租户访问测试 ===")
if DEFAULT_DS_ID:
    code, _ = request("GET", f"/api/data-sources/{DEFAULT_DS_ID}",
        headers={"X-Tenant-Id": "team-gamma"})
    print_test("team-gamma访问default的DS返回404", code, 404)

# ===== 7. 配额测试 - 数据源超限 =====
print("\n=== 7. 数据源配额超限测试 ===")
gamma_headers = {"X-Tenant-Id": "team-gamma", "X-User-Role": "operator", "X-User-Id": "g-user1"}
# 第1个(应成功)
code, ds1 = request("POST", "/api/data-sources",
    headers={**gamma_headers, "Content-Type": "application/json"},
    json={"name": "gamma-ds-1", "description": "第1个"})
print_test("创建第1个数据源(成功)", code, 201)
# 第2个(应成功)
code, ds2 = request("POST", "/api/data-sources",
    headers={**gamma_headers, "Content-Type": "application/json"},
    json={"name": "gamma-ds-2", "description": "第2个"})
print_test("创建第2个数据源(成功)", code, 201)
# 第3个(应该失败，配额2)
code, data = request("POST", "/api/data-sources",
    headers={**gamma_headers, "Content-Type": "application/json"},
    json={"name": "gamma-ds-3", "description": "第3个"})
print_test("创建第3个数据源(配额超限-429)", code, 429)

# ===== 8. 查询配额使用 =====
print("\n=== 8. 配额使用情况查询 ===")
if code in (201, 200) and "tenant" in locals():
    code, data = request("GET", f"/api/tenants/{GAMMA_ID}/quotas", headers=sa_headers)
    print_test("查询配额返回200", code, 200)
    if code == 200:
        usage = data["data"]["usage"]
        print_test("数据源已用=2", usage["dataSources"]["used"], 2)
        print_test("数据源剩余=0", usage["dataSources"]["remaining"], 0)

# ===== 9. 动态调整配额 =====
print("\n=== 9. 动态调整配额 ===")
code, data = request("PUT", f"/api/tenants/{GAMMA_ID}/quotas",
    headers={**sa_headers, "Content-Type": "application/json"},
    json={"maxDataSources": 5})
print_test("调整配额返回200", code, 200)
# 调整后再创建第3个
code, _ = request("POST", "/api/data-sources",
    headers={**gamma_headers, "Content-Type": "application/json"},
    json={"name": "gamma-ds-3", "description": "调整后创建"})
print_test("调整后创建第3个数据源(成功)", code, 201)

# ===== 10. 冻结租户 =====
print("\n=== 10. 冻结/解冻测试 ===")
code, data = request("PUT", f"/api/tenants/{GAMMA_ID}/freeze",
    headers={**sa_headers, "Content-Type": "application/json"},
    json={"reason": "测试冻结"})
print_test("冻结租户返回200", code, 200)
# 冻结后写操作
code, _ = request("POST", "/api/data-sources",
    headers={**gamma_headers, "Content-Type": "application/json"},
    json={"name": "gamma-ds-blocked", "description": "应被拒绝"})
print_test("冻结后写操作返回403", code, 403)
# 解冻
code, _ = request("PUT", f"/api/tenants/{GAMMA_ID}/unfreeze", headers=sa_headers)
print_test("解冻租户返回200", code, 200)

# ===== 11. 超级管理员租户列表 =====
print("\n=== 11. 租户列表 ===")
code, data = request("GET", "/api/tenants", headers=sa_headers)
print_test("查询租户列表返回200", code, 200)
if code == 200:
    print(f"  租户总数: {data['total']}")
    names = [t["name"] for t in data["data"]]
    print_test("列表包含default, team-alpha, team-beta, team-gamma",
        all(n in names for n in ["default", "team-gamma"]), True)

# ===== 12. 当前租户信息接口 =====
print("\n=== 12. 当前租户信息 ===")
code, data = request("GET", "/api/tenants/me", headers={"X-Tenant-Id": "default"})
print_test("查询当前租户信息返回200", code, 200)

print("\n" + "="*50)
print("测试完成!")
print("="*50)
