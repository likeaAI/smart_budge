"""API 통합 테스트 스크립트"""
import urllib.request
import json

BASE = "http://localhost:5000"

def api(method, path, data=None):
    if data:
        body = json.dumps(data).encode()
        req = urllib.request.Request(f"{BASE}{path}", data=body,
                                     headers={"Content-Type": "application/json"},
                                     method=method)
    else:
        req = urllib.request.Request(f"{BASE}{path}", method=method)
    resp = urllib.request.urlopen(req)
    return resp.status, json.loads(resp.read())

def page(path):
    resp = urllib.request.urlopen(f"{BASE}{path}")
    return resp.status, len(resp.read())

# 1. 거래 추가
status, body = api("POST", "/api/transactions", {
    "date": "2026-08-21", "type": "지출", "amount": 15000,
    "category": "식비", "description": "점심식사"
})
print(f"1. Add transaction: {status} id={body.get('id')}")

# 2. 수입 추가
status, body = api("POST", "/api/transactions", {
    "date": "2026-08-21", "type": "수입", "amount": 3000000,
    "category": "저축", "description": "8월 월급"
})
print(f"2. Add income: {status} id={body.get('id')}")

# 3. 여러 지출 추가
items = [
    ("2026-08-20", "지출", 5500, "카페", "스타벅스"),
    ("2026-08-19", "지출", 35000, "쇼핑", "올리브영"),
    ("2026-08-18", "지출", 4500, "교통", "택시"),
    ("2026-08-17", "지출", 25000, "식비", "저녁회식"),
    ("2026-08-16", "지출", 12000, "기타", "배달의민족"),
    ("2026-08-15", "지출", 6000, "카페", "이디야"),
    ("2026-08-14", "지출", 50000, "쇼핑", "쿠팡"),
    ("2026-08-13", "지출", 3000, "식비", "김밥"),
]
for d, t, a, c, desc in items:
    api("POST", "/api/transactions", {
        "date": d, "type": t, "amount": a, "category": c, "description": desc
    })
print(f"3. Bulk add: {len(items)} items OK")

# 4. 월간 요약
status, summary = api("GET", "/api/summary/monthly?month=2026-08")
print(f"4. Monthly summary: expense={summary['total_expense']}, income={summary['total_income']}, balance={summary['balance']}")

# 5. 카테고리별
status, cats = api("GET", "/api/summary/category?month=2026-08")
for c in cats:
    print(f"   {c['category']}: {c['total']} ({c['count']})")

# 6. 일별
status, daily = api("GET", "/api/summary/daily?month=2026-08")
print(f"6. Daily summary: {len(daily)} days")

# 7. 예산 설정
status, _ = api("POST", "/api/budgets", {
    "month": "2026-08", "category": "전체", "budget_amount": 2000000
})
api("POST", "/api/budgets", {
    "month": "2026-08", "category": "식비", "budget_amount": 300000
})
api("POST", "/api/budgets", {
    "month": "2026-08", "category": "카페", "budget_amount": 50000
})
print(f"7. Budget set: {status}")

# 8. 조언
status, advice = api("GET", "/api/advice?month=2026-08")
print(f"8. Advice: {len(advice)} items")
for a in advice[:3]:
    print(f"   [{a['type']}] {a['title']}")

# 9. 거래 수정
status, _ = api("PUT", "/api/transactions/1", {
    "amount": 18000, "description": "점심식사 (수정)"
})
print(f"9. Update: {status}")

# 10. 페이지 렌더링
for path in ["/", "/add", "/history", "/goals", "/advice"]:
    s, length = page(path)
    print(f"10. Page {path}: {s} ({length} bytes)")

# 11. 거래 삭제
status, _ = api("DELETE", "/api/transactions/10")
print(f"11. Delete: {status}")

print("\n=== All tests passed! ===")
