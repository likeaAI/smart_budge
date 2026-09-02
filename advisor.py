"""
절약, 카드값 대조, 자산(원금), 주식/투자 종합 AI 자산 분석 엔진 (AI Wealth & Money Advisor)
"""

from datetime import date, timedelta
from models import (
    get_monthly_summary,
    get_budget_status,
    get_recent_expenses,
    get_weekday_pattern,
    get_category_trend,
    get_daily_summary,
    get_net_worth_summary,
    get_investments,
    get_card_reconciliation_summary,
    CATEGORY_MAP,
)


def _days_left_in_month() -> int:
    today = date.today()
    if today.month == 12:
        next_month = date(today.year + 1, 1, 1)
    else:
        next_month = date(today.year, today.month + 1, 1)
    return max(1, (next_month - today).days)


def _prev_month(month_str: str) -> str:
    year, month = map(int, month_str.split("-"))
    if month == 1:
        return f"{year - 1:04d}-12"
    return f"{year:04d}-{month - 1:02d}"


def generate_advice(month: str = None) -> list[dict]:
    """
    가계부 지출/수입 + 신용카드 대조 + 보유 자산/원금 + 주식 포트폴리오를 총망라한 AI 머니 분석 리포트 생성
    """
    if not month:
        month = date.today().strftime("%Y-%m")

    advice_list = []

    summary = get_monthly_summary(month)
    prev_summary = get_monthly_summary(_prev_month(month))
    net_worth_info = get_net_worth_summary()
    card_info = get_card_reconciliation_summary(month)

    total_expense = summary["total_expense"]
    total_income = summary["total_income"]
    net_worth = net_worth_info["net_worth"]

    # ── 1. 💳 신용카드 청구액 & 카드값 대조 브리핑 ──
    card_spent = card_info.get("total_card_spent", 0)
    if card_spent > 0:
        cards = card_info.get("cards", [])
        discrepancies = [c for c in cards if c["billed_amount"] > 0 and c["difference"] != 0]
        reconciled_cards = [c for c in cards if c["billed_amount"] > 0 and c["difference"] == 0]

        if discrepancies:
            for d in discrepancies:
                diff = d["difference"]
                diff_label = f"+{diff:,}원 초과" if diff > 0 else f"{diff:,}원 미달"
                advice_list.append({
                    "type": "warning",
                    "emoji": "💳",
                    "title": f"[{d['card_name']}] 카드값 대조 차액 발생 ({diff_label})",
                    "message": (
                        f"실제 카드사 청구서({d['billed_amount']:,}원)와 내가 기록한 합계({d['spent_amount']:,}원) 사이에 "
                        f"{abs(diff):,}원의 차이가 있습니다. 후불 교통카드 요금, 자동이체, 할부 수수료 등의 누락 여부를 확인해보세요."
                    ),
                })
        elif reconciled_cards:
            advice_list.append({
                "type": "goal",
                "emoji": "✅",
                "title": f"카드 청구서 대조 완벽 일치!",
                "message": f"등록된 카드 청구서와 기록된 지출 내역이 100% 일치합니다. 꼼꼼한 지출 통제를 실천하고 계시네요!",
            })
        else:
            advice_list.append({
                "type": "insight",
                "emoji": "💳",
                "title": f"이번 달 신용카드 결제 예정액: {card_spent:,}원",
                "message": (
                    f"현재까지 기록된 신용카드 사용액은 총 {card_spent:,}원입니다. "
                    f"명세서가 도착하면 '카드값 대조' 메뉴에서 실제 청구금액과 맞는지 꼭 검증해보세요."
                ),
            })

    # ── 2. 🧠 AI 자산 & 순자산 브리핑 ──
    if net_worth > 0:
        inv_eval = net_worth_info["inv_total_eval"]
        inv_profit = net_worth_info["inv_total_profit"]
        inv_rate = net_worth_info["inv_total_profit_rate"]

        if inv_eval > 0:
            if inv_profit > 0:
                advice_list.append({
                    "type": "goal",
                    "emoji": "🚀",
                    "title": f"주식/투자 자산 +{inv_profit:,}원 (+{inv_rate}%) 수익 중!",
                    "message": (
                        f"보유 중인 투자 자산 총 평가액은 {inv_eval:,}원이며, "
                        f"현재 총 {inv_profit:,}원의 수익을 기록 중입니다. 자산이 열심히 일하고 있네요!"
                    ),
                })
            else:
                advice_list.append({
                    "type": "insight",
                    "emoji": "🛡️",
                    "title": f"투자 포트폴리오 관리 ({inv_rate}%)",
                    "message": (
                        f"투자 자산 평가액은 {inv_eval:,}원(원금 {net_worth_info['inv_total_cost']:,}원)입니다. "
                        f"단기 변동성에 흔들리지 않고 장기 적립식 원칙을 지켜보세요."
                    ),
                })

        # 현금 vs 투자 비중 진단
        total_assets = net_worth_info["total_assets"]
        if total_assets > 0:
            cash_amt = sum(a["amount"] for a in net_worth_info["assets_list"] if a["asset_type"] == "현금/예적금")
            cash_ratio = round(cash_amt / total_assets * 100)

            if cash_ratio < 10 and total_assets >= 10000000:
                advice_list.append({
                    "type": "warning",
                    "emoji": "⚠️",
                    "title": "비상금(현금성 자산) 비중이 낮습니다",
                    "message": f"현재 전체 자산 중 현금성 자산 비중이 {cash_ratio}%입니다. 카드 결제일 및 비상 시 주식을 강제 매도하지 않도록 3~6개월치 생활비는 비상금 통장에 확보해두세요.",
                })

    # ── 3. 💸 수입 대비 저축/투자율 (Savings Rate) ──
    if total_income > 0:
        savings = total_income - total_expense
        saving_rate = round(savings / total_income * 100)

        if saving_rate >= 50:
            advice_list.append({
                "type": "goal",
                "emoji": "🏆",
                "title": f"이번 달 저축/투자율 {saving_rate}% 달성!",
                "message": f"수입 {total_income:,}원 중 {savings:,}원을 잉여 자금으로 남겼습니다. 파이어족(경제적 자유) 기준인 50%를 훌륭히 달성 중입니다.",
            })
        elif saving_rate < 10 and total_income > 0:
            advice_list.append({
                "type": "warning",
                "emoji": "🚨",
                "title": f"저축/투자 여력이 {saving_rate}%로 낮습니다",
                "message": f"수입의 대부분이 지출되고 있습니다. 불필요한 '선택/낭비' 지출을 줄여 최소 수입의 20% 이상을 자산 형성으로 돌려보세요.",
            })

    # ── 4. 🛑 소비 자각 (필수 vs 선택 vs 낭비) ──
    by_type = summary.get("by_consumption_type", {})
    waste_amt = by_type.get("낭비", {}).get("total", 0)
    if waste_amt > 0:
        advice_list.append({
            "type": "warning",
            "emoji": "🛑",
            "title": f"낭비 지출 {waste_amt:,}원 자각",
            "message": f"스스로 낭비로 체크한 {waste_amt:,}원을 주식/ETF에 매달 적립했다면 10년 후 수천만 원의 자산이 됩니다.",
        })

    # 기본 조언 보충
    if len(advice_list) < 2:
        advice_list.append({
            "type": "tip",
            "emoji": "💡",
            "title": "카드값 검증 습관",
            "message": "카드로 쓴 돈은 나중에 청구서가 나올 때 내가 쓴 것과 맞는지 '카드값 대조' 메뉴에서 하나씩 대조해보면 줄줄 새는 돈을 완벽히 잡을 수 있습니다.",
        })

    return advice_list
