"""
올인원 머니 허브 (가계부 + 카드값 대조/검증 + 자산/원금 + 주식 투자) 종합 테스트 스위트
"""
import unittest
import json
from app import app
from models import init_db, get_monthly_summary, get_net_worth_summary, get_card_reconciliation_summary

class AllInOneMoneyHubTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        app.config['TESTING'] = True
        cls.client = app.test_client()

    def test_pages_render(self):
        """모든 핵심 페이지(대시보드, 가계부, 카드대조, 자산, 주식, 조언) 렌더링 확인"""
        pages = [
            "/",
            "/dashboard",
            "/add",
            "/history",
            "/cards",
            "/assets",
            "/investments",
            "/goals",
            "/advice"
        ]
        for p in pages:
            res = self.client.get(p)
            self.assertEqual(res.status_code, 200, f"Page {p} failed")
            self.assertIn("스마트 머니 허브", res.get_data(as_text=True))

    def test_credit_card_reconciliation(self):
        """신용카드 결제 기록 후 카드 청구서 금액 대조 및 차액 분석 검증"""
        # 1. 현대카드로 2건 지출 입력 (35,000원 + 45,000원 = 80,000원)
        res1 = self.client.post("/api/transactions", json={
            "date": "2026-09-02",
            "type": "지출",
            "amount": 35000,
            "category": "식비",
            "description": "점심 외식",
            "payment_method": "신용카드",
            "card_name": "현대카드",
            "billing_month": "2026-09"
        })
        self.assertEqual(res1.status_code, 201)
        tx_id1 = res1.get_json()["id"]

        res2 = self.client.post("/api/transactions", json={
            "date": "2026-09-02",
            "type": "지출",
            "amount": 45000,
            "category": "쇼핑",
            "description": "생활용품 구매",
            "payment_method": "신용카드",
            "card_name": "현대카드",
            "billing_month": "2026-09"
        })
        self.assertEqual(res2.status_code, 201)

        # 2. 카드 요약 확인 (현대카드 기록 합계 80,000원 이상)
        summary = get_card_reconciliation_summary("2026-09")
        hd_card = next((c for c in summary["cards"] if c["card_name"] == "현대카드"), None)
        self.assertIsNotNone(hd_card)
        self.assertGreaterEqual(hd_card["spent_amount"], 80000)

        # 3. 실제 카드사 청구서 금액 등록 & 대조 (청구서: 80,000원 입력 ➔ 일치 여부 확인)
        rec_res = self.client.post("/api/cards/reconcile", json={
            "billing_month": "2026-09",
            "card_name": "현대카드",
            "billed_amount": hd_card["spent_amount"],
            "memo": "9월 청구서 확인"
        })
        self.assertEqual(rec_res.status_code, 200)
        rec_data = rec_res.get_json()["result"]
        self.assertEqual(rec_data["difference"], 0)
        self.assertEqual(rec_data["status"], "일치")

        # 4. 개별 거래 건 대조 완료 체크 토글
        toggle_res = self.client.post(f"/api/transactions/{tx_id1}/toggle_reconcile")
        self.assertEqual(toggle_res.status_code, 200)
        self.assertEqual(toggle_res.get_json()["is_reconciled"], 1)

    def test_asset_crud_and_net_worth(self):
        """기초 자산/원금/예적금 CRUD 및 순자산 계산 검증"""
        res = self.client.post("/api/assets", json={
            "name": "카카오뱅크 비상금통장",
            "asset_type": "현금/예적금",
            "amount": 5000000,
            "initial_amount": 3000000,
            "memo": "이자율 3.0%"
        })
        self.assertEqual(res.status_code, 201)

        res_list = self.client.get("/api/assets")
        self.assertEqual(res_list.status_code, 200)
        assets = res_list.get_json()
        self.assertTrue(any(a["name"] == "카카오뱅크 비상금통장" for a in assets))

        nw = get_net_worth_summary()
        self.assertGreaterEqual(nw["net_worth"], 5000000)

    def test_investment_portfolio_and_tx(self):
        """주식/투자 종목 등록, 평가손익 계산 및 매매일지 검증"""
        res = self.client.post("/api/investments", json={
            "name": "삼성전자",
            "code": "005930",
            "market": "국내주식",
            "shares": 100,
            "avg_price": 70000,
            "current_price": 77000,
            "dividend_rate": 2.5,
            "memo": "반도체 장기 적립"
        })
        self.assertEqual(res.status_code, 201)

        res_inv = self.client.get("/api/investments")
        self.assertEqual(res_inv.status_code, 200)
        invs = res_inv.get_json()
        samsung = next(i for i in invs if i["name"] == "삼성전자")
        self.assertEqual(samsung["total_cost"], 7000000)
        self.assertEqual(samsung["total_eval"], 7700000)
        self.assertEqual(samsung["profit"], 700000)
        self.assertEqual(samsung["profit_rate"], 10.0)

    def test_ai_wealth_advisor(self):
        """AI 자산 & 머니 분석 엔진 검증"""
        res = self.client.get("/api/advice?month=2026-09")
        self.assertEqual(res.status_code, 200)
        advice = res.get_json()
        self.assertIsInstance(advice, list)
        self.assertGreater(len(advice), 0)

if __name__ == "__main__":
    unittest.main()
