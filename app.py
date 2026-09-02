"""
Flask 웹 가계부 + 카드값 대조/검증 + 자산/원금 + 주식/투자 올인원 서버
"""

from datetime import date
import re
from flask import Flask, render_template, request, jsonify, redirect, url_for

from models import (
    init_db,
    add_transaction,
    update_transaction,
    delete_transaction,
    get_transaction,
    get_transactions,
    get_monthly_summary,
    get_daily_summary,
    get_budget_status,
    set_budget,
    get_budgets,
    delete_budget,
    add_asset,
    update_asset,
    delete_asset,
    get_assets,
    add_investment,
    update_investment,
    delete_investment,
    get_investments,
    add_investment_tx,
    get_investment_txs,
    get_net_worth_summary,
    get_card_reconciliation_summary,
    reconcile_card_statement,
    toggle_transaction_reconciled,
    batch_reconcile_card_transactions,
    CATEGORIES,
    CATEGORY_MAP,
    CONSUMPTION_TYPES,
    SATISFACTION_LEVELS,
    ASSET_TYPES,
    ASSET_TYPE_MAP,
    PAYMENT_METHODS,
    DEFAULT_CARDS,
)
from advisor import generate_advice

app = Flask(__name__)
app.secret_key = "smart-budget-secret-key-for-sessions"


# ============================================================
# 템플릿 필터
# ============================================================

@app.template_filter("format_number")
def format_number(value):
    """숫자를 천 단위 쉼표 형식으로 포맷"""
    try:
        if value is None or value == "":
            return "0"
        return f"{int(float(str(value).replace(',', ''))):,}"
    except (ValueError, TypeError):
        return str(value)


@app.template_filter("format_sign")
def format_sign(value):
    """부호 포함 숫자 포맷"""
    try:
        if value is None or value == "":
            return "0"
        v = int(float(str(value).replace(',', '')))
        if v > 0:
            return f"+{v:,}"
        return f"{v:,}"
    except (ValueError, TypeError):
        return str(value)


@app.template_filter("format_float")
def format_float(value):
    try:
        return f"{float(value):,.2f}"
    except (ValueError, TypeError):
        return str(value)


# ============================================================
# 페이지 라우트
# ============================================================

@app.route("/")
@app.route("/dashboard")
def dashboard():
    """종합 대시보드 (가계부 + 카드값 + 순자산 + 주식 요약 + AI 브리핑)"""
    month = request.args.get("month", date.today().strftime("%Y-%m"))
    if not re.match(r"^\d{4}-\d{2}$", month):
        month = date.today().strftime("%Y-%m")

    summary = get_monthly_summary(month)
    budget_status = get_budget_status(month)
    recent = get_transactions(month=month, limit=5)
    advice = generate_advice(month)
    net_worth_info = get_net_worth_summary()
    card_info = get_card_reconciliation_summary(month)

    return render_template(
        "dashboard.html",
        page="dashboard",
        month=month,
        summary=summary,
        budget_status=budget_status,
        recent=recent,
        advice=advice[:3],
        net_worth_info=net_worth_info,
        card_info=card_info,
        categories=CATEGORIES,
        category_map=CATEGORY_MAP,
        consumption_types=CONSUMPTION_TYPES,
        satisfaction_levels=SATISFACTION_LEVELS,
    )


@app.route("/add", methods=["GET", "POST"])
def add_page():
    """지출/수입 직접 입력 및 자각 페이지 (카드/결제수단 선택 포함)"""
    if request.method == "POST":
        tx_date = request.form.get("date", "").strip() or date.today().isoformat()
        tx_type = request.form.get("type", "지출").strip()
        amount_raw = request.form.get("amount", "0").replace(",", "").strip()
        category = request.form.get("category", "식비").strip() or "식비"
        description = request.form.get("description", "").strip()
        consumption_type = request.form.get("consumption_type", "선택").strip()
        satisfaction = request.form.get("satisfaction", "보통").strip()
        payment_method = request.form.get("payment_method", "신용카드").strip()
        card_name = request.form.get("card_name", "").strip()
        billing_month = request.form.get("billing_month", tx_date[:7]).strip() or tx_date[:7]
        installment = int(request.form.get("installment", 1) or 1)

        try:
            amount = int(float(amount_raw))
            if amount > 0:
                add_transaction(
                    tx_date=tx_date,
                    tx_type=tx_type,
                    amount=amount,
                    category=category,
                    description=description,
                    consumption_type=consumption_type,
                    satisfaction=satisfaction,
                    payment_method=payment_method,
                    card_name=card_name,
                    billing_month=billing_month,
                    installment=installment,
                )
                return redirect(url_for("dashboard", month=tx_date[:7]))
        except Exception as e:
            app.logger.error(f"Error in direct form POST add: {e}")

    return render_template(
        "add.html",
        page="add",
        categories=CATEGORIES,
        consumption_types=CONSUMPTION_TYPES,
        satisfaction_levels=SATISFACTION_LEVELS,
        payment_methods=PAYMENT_METHODS,
        default_cards=DEFAULT_CARDS,
        today=date.today().isoformat(),
    )


@app.route("/cards")
def cards_page():
    """💳 신용카드 청구 대조 & 카드값 검증 센터"""
    month = request.args.get("month", date.today().strftime("%Y-%m"))
    if not re.match(r"^\d{4}-\d{2}$", month):
        month = date.today().strftime("%Y-%m")

    card_filter = request.args.get("card", "").strip()

    # 특정 청구월의 카드 요약
    card_info = get_card_reconciliation_summary(month)

    # 해당 청구월의 카드 거래 내역
    card_transactions = get_transactions(
        billing_month=month,
        tx_type="지출",
        card_name=card_filter if card_filter and card_filter != "all" else None,
    )

    return render_template(
        "cards.html",
        page="cards",
        month=month,
        card_filter=card_filter,
        card_info=card_info,
        card_transactions=card_transactions,
        default_cards=DEFAULT_CARDS,
    )


@app.route("/history")
def history_page():
    """내역 관리 페이지 (카드/결제수단/대조 필터 지원)"""
    month = request.args.get("month", date.today().strftime("%Y-%m"))
    if not re.match(r"^\d{4}-\d{2}$", month):
        month = date.today().strftime("%Y-%m")

    category = request.args.get("category", "").strip()
    tx_type = request.args.get("type", "").strip()
    c_type = request.args.get("consumption_type", "").strip()
    sat = request.args.get("satisfaction", "").strip()
    payment_method = request.args.get("payment_method", "").strip()
    card_name = request.args.get("card_name", "").strip()
    reconciled_str = request.args.get("is_reconciled", "").strip()
    is_reconciled = int(reconciled_str) if reconciled_str in ["0", "1"] else None

    transactions = get_transactions(
        month=month,
        category=category if category and category != "all" else None,
        tx_type=tx_type if tx_type and tx_type != "all" else None,
        consumption_type=c_type if c_type and c_type != "all" else None,
        satisfaction=sat if sat and sat != "all" else None,
        payment_method=payment_method if payment_method and payment_method != "all" else None,
        card_name=card_name if card_name and card_name != "all" else None,
        is_reconciled=is_reconciled,
    )

    summary = get_monthly_summary(month)

    return render_template(
        "history.html",
        page="history",
        month=month,
        category_filter=category,
        type_filter=tx_type,
        consumption_type_filter=c_type,
        satisfaction_filter=sat,
        payment_method_filter=payment_method,
        card_name_filter=card_name,
        reconciled_filter=reconciled_str,
        transactions=transactions,
        summary=summary,
        categories=CATEGORIES,
        category_map=CATEGORY_MAP,
        consumption_types=CONSUMPTION_TYPES,
        satisfaction_levels=SATISFACTION_LEVELS,
        payment_methods=PAYMENT_METHODS,
        default_cards=DEFAULT_CARDS,
    )


@app.route("/goals")
def goals_page():
    """예산 목표 페이지"""
    month = request.args.get("month", date.today().strftime("%Y-%m"))
    if not re.match(r"^\d{4}-\d{2}$", month):
        month = date.today().strftime("%Y-%m")

    budget_status = get_budget_status(month)
    budgets = get_budgets(month)

    return render_template(
        "goals.html",
        page="goals",
        month=month,
        budget_status=budget_status,
        budgets=budgets,
        categories=CATEGORIES,
        category_map=CATEGORY_MAP,
    )


@app.route("/assets")
def assets_page():
    """자산 및 순자산 관리 페이지"""
    net_worth_info = get_net_worth_summary()
    return render_template(
        "assets.html",
        page="assets",
        net_worth_info=net_worth_info,
        asset_types=ASSET_TYPES,
        asset_type_map=ASSET_TYPE_MAP,
    )


@app.route("/investments")
def investments_page():
    """주식 & 투자 포트폴리오 및 매매일지 페이지"""
    investments = get_investments()
    txs = get_investment_txs(limit=30)
    net_worth_info = get_net_worth_summary()

    return render_template(
        "investments.html",
        page="investments",
        investments=investments,
        txs=txs,
        net_worth_info=net_worth_info,
        today=date.today().isoformat(),
    )


@app.route("/advice")
def advice_page():
    """AI 자산 & 소비 종합 리포트 페이지"""
    month = request.args.get("month", date.today().strftime("%Y-%m"))
    if not re.match(r"^\d{4}-\d{2}$", month):
        month = date.today().strftime("%Y-%m")

    advice = generate_advice(month)
    summary = get_monthly_summary(month)
    net_worth_info = get_net_worth_summary()
    card_info = get_card_reconciliation_summary(month)

    return render_template(
        "advice.html",
        page="advice",
        month=month,
        advice=advice,
        summary=summary,
        net_worth_info=net_worth_info,
        card_info=card_info,
        categories=CATEGORIES,
        category_map=CATEGORY_MAP,
        consumption_types=CONSUMPTION_TYPES,
        satisfaction_levels=SATISFACTION_LEVELS,
    )


# ============================================================
# REST API
# ============================================================

def _extract_request_data():
    if request.is_json:
        return request.get_json(silent=True) or {}
    if request.form:
        return request.form.to_dict()
    data = request.get_json(silent=True)
    return data if data else {}


# --- 가계부 API ---
@app.route("/api/transactions", methods=["POST"])
def api_add_transaction():
    data = _extract_request_data()
    if not data:
        return jsonify({"error": "요청 데이터가 없습니다"}), 400

    tx_date = str(data.get("date", "")).strip() or date.today().isoformat()
    tx_type = str(data.get("type", "지출")).strip()
    category = str(data.get("category", "식비")).strip() or "식비"
    description = str(data.get("description", "")).strip()
    consumption_type = str(data.get("consumption_type", "선택")).strip()
    satisfaction = str(data.get("satisfaction", "보통")).strip()
    payment_method = str(data.get("payment_method", "신용카드")).strip()
    card_name = str(data.get("card_name", "")).strip()
    billing_month = str(data.get("billing_month", tx_date[:7])).strip() or tx_date[:7]
    installment = int(data.get("installment", 1) or 1)
    raw_amount = str(data.get("amount", "")).replace(",", "").strip()

    if not raw_amount:
        return jsonify({"error": "금액을 입력해주세요"}), 400

    try:
        amount = int(float(raw_amount))
        if amount <= 0:
            return jsonify({"error": "금액은 0보다 커야 합니다"}), 400
    except ValueError:
        return jsonify({"error": "올바른 금액 숫자를 입력해주세요"}), 400

    try:
        tx_id = add_transaction(
            tx_date=tx_date,
            tx_type=tx_type,
            amount=amount,
            category=category,
            description=description,
            consumption_type=consumption_type,
            satisfaction=satisfaction,
            payment_method=payment_method,
            card_name=card_name,
            billing_month=billing_month,
            installment=installment,
        )
        return jsonify({"success": True, "id": tx_id}), 201
    except Exception as e:
        app.logger.error(f"Error adding transaction: {e}")
        return jsonify({"error": f"저장 중 오류가 발생했습니다: {str(e)}"}), 500


@app.route("/api/transactions/<int:tx_id>", methods=["PUT", "POST"])
def api_update_transaction(tx_id):
    data = _extract_request_data()
    if not data:
        return jsonify({"error": "요청 데이터가 없습니다"}), 400

    existing = get_transaction(tx_id)
    if not existing:
        return jsonify({"error": "해당 내역을 찾을 수 없습니다"}), 404

    tx_date = str(data.get("date", existing["date"])).strip()
    tx_type = str(data.get("type", existing["type"])).strip()
    category = str(data.get("category", existing["category"])).strip()
    description = str(data.get("description", existing["description"])).strip()
    consumption_type = str(data.get("consumption_type", existing.get("consumption_type", "선택"))).strip()
    satisfaction = str(data.get("satisfaction", existing.get("satisfaction", "보통"))).strip()
    payment_method = str(data.get("payment_method", existing.get("payment_method", "신용카드"))).strip()
    card_name = str(data.get("card_name", existing.get("card_name", ""))).strip()
    billing_month = str(data.get("billing_month", existing.get("billing_month", tx_date[:7]))).strip()
    installment = int(data.get("installment", existing.get("installment", 1)) or 1)
    is_reconciled = data.get("is_reconciled", existing.get("is_reconciled", 0))
    raw_amount = str(data.get("amount", existing["amount"])).replace(",", "").strip()

    try:
        amount = int(float(raw_amount))
        if amount <= 0:
            return jsonify({"error": "금액은 0보다 커야 합니다"}), 400
    except ValueError:
        return jsonify({"error": "올바른 금액 숫자를 입력해주세요"}), 400

    try:
        update_transaction(
            tx_id=tx_id,
            tx_date=tx_date,
            tx_type=tx_type,
            amount=amount,
            category=category,
            description=description,
            consumption_type=consumption_type,
            satisfaction=satisfaction,
            payment_method=payment_method,
            card_name=card_name,
            billing_month=billing_month,
            installment=installment,
            is_reconciled=is_reconciled,
        )
        return jsonify({"success": True})
    except Exception as e:
        app.logger.error(f"Error updating transaction {tx_id}: {e}")
        return jsonify({"error": f"수정 중 오류가 발생했습니다: {str(e)}"}), 500


@app.route("/api/transactions/<int:tx_id>", methods=["DELETE"])
def api_delete_transaction(tx_id):
    existing = get_transaction(tx_id)
    if not existing:
        return jsonify({"error": "해당 내역을 찾을 수 없습니다"}), 404

    try:
        delete_transaction(tx_id)
        return jsonify({"success": True})
    except Exception as e:
        app.logger.error(f"Error deleting transaction {tx_id}: {e}")
        return jsonify({"error": f"삭제 중 오류가 발생했습니다: {str(e)}"}), 500


@app.route("/api/transactions/<int:tx_id>/toggle_reconcile", methods=["POST"])
def api_toggle_transaction_reconcile(tx_id):
    """개별 거래 대조 상태 토글"""
    new_state = toggle_transaction_reconciled(tx_id)
    return jsonify({"success": True, "is_reconciled": new_state})


# --- 💳 신용카드 청구서 대조 & 검증 API ---
@app.route("/api/cards/reconcile", methods=["POST"])
def api_card_reconcile():
    data = _extract_request_data()
    billing_month = str(data.get("billing_month", date.today().strftime("%Y-%m"))).strip()
    card_name = str(data.get("card_name", "")).strip()
    raw_billed = str(data.get("billed_amount", "0")).replace(",", "").strip()
    memo = str(data.get("memo", "")).strip()

    if not card_name:
        return jsonify({"error": "카드명을 선택해주세요"}), 400

    try:
        billed_amount = int(float(raw_billed))
        result = reconcile_card_statement(billing_month, card_name, billed_amount, memo)
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cards/batch_reconcile", methods=["POST"])
def api_card_batch_reconcile():
    data = _extract_request_data()
    billing_month = str(data.get("billing_month", date.today().strftime("%Y-%m"))).strip()
    card_name = str(data.get("card_name", "")).strip()
    reconcile_all = bool(data.get("reconcile_all", True))

    batch_reconcile_card_transactions(billing_month, card_name, reconcile_all)
    return jsonify({"success": True})


@app.route("/api/cards/summary")
def api_card_summary():
    month = request.args.get("month", date.today().strftime("%Y-%m"))
    return jsonify(get_card_reconciliation_summary(month))


# --- 자산(Assets) API ---
@app.route("/api/assets", methods=["GET", "POST"])
def api_assets():
    if request.method == "POST":
        data = _extract_request_data()
        name = str(data.get("name", "")).strip()
        asset_type = str(data.get("asset_type", "현금/예적금")).strip()
        raw_amt = str(data.get("amount", "0")).replace(",", "").strip()
        raw_init = str(data.get("initial_amount", raw_amt)).replace(",", "").strip()
        memo = str(data.get("memo", "")).strip()

        if not name:
            return jsonify({"error": "자산 이름을 입력해주세요"}), 400

        try:
            amt = int(float(raw_amt))
            init_amt = int(float(raw_init)) if raw_init else amt
            asset_id = add_asset(name, asset_type, amt, init_amt, memo)
            return jsonify({"success": True, "id": asset_id}), 201
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return jsonify(get_assets())


@app.route("/api/assets/<int:asset_id>", methods=["PUT", "POST", "DELETE"])
def api_asset_detail(asset_id):
    if request.method == "DELETE":
        delete_asset(asset_id)
        return jsonify({"success": True})

    data = _extract_request_data()
    name = str(data.get("name", "")).strip()
    asset_type = str(data.get("asset_type", "현금/예적금")).strip()
    amt = int(float(str(data.get("amount", "0")).replace(",", "")))
    init_amt = int(float(str(data.get("initial_amount", amt)).replace(",", "")))
    memo = str(data.get("memo", "")).strip()

    update_asset(asset_id, name, asset_type, amt, init_amt, memo)
    return jsonify({"success": True})


# --- 주식 & 투자(Investments) API ---
@app.route("/api/investments", methods=["GET", "POST"])
def api_investments():
    if request.method == "POST":
        data = _extract_request_data()
        name = str(data.get("name", "")).strip()
        code = str(data.get("code", "")).strip()
        market = str(data.get("market", "국내주식")).strip()
        shares = float(str(data.get("shares", "0")).replace(",", ""))
        avg_price = float(str(data.get("avg_price", "0")).replace(",", ""))
        current_price = float(str(data.get("current_price", avg_price)).replace(",", ""))
        dividend_rate = float(str(data.get("dividend_rate", "0")).replace(",", ""))
        target_price = float(str(data.get("target_price", "0")).replace(",", ""))
        memo = str(data.get("memo", "")).strip()

        if not name:
            return jsonify({"error": "종목명을 입력해주세요"}), 400

        try:
            inv_id = add_investment(name, market, shares, avg_price, current_price, code, dividend_rate, target_price, memo)
            return jsonify({"success": True, "id": inv_id}), 201
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return jsonify(get_investments())


@app.route("/api/investments/<int:inv_id>", methods=["PUT", "POST", "DELETE"])
def api_investment_detail(inv_id):
    if request.method == "DELETE":
        delete_investment(inv_id)
        return jsonify({"success": True})

    data = _extract_request_data()
    name = str(data.get("name", "")).strip()
    code = str(data.get("code", "")).strip()
    market = str(data.get("market", "국내주식")).strip()
    shares = float(str(data.get("shares", "0")).replace(",", ""))
    avg_price = float(str(data.get("avg_price", "0")).replace(",", ""))
    current_price = float(str(data.get("current_price", avg_price)).replace(",", ""))
    dividend_rate = float(str(data.get("dividend_rate", "0")).replace(",", ""))
    target_price = float(str(data.get("target_price", "0")).replace(",", ""))
    memo = str(data.get("memo", "")).strip()

    update_investment(inv_id, name, market, shares, avg_price, current_price, code, dividend_rate, target_price, memo)
    return jsonify({"success": True})


@app.route("/api/investments/txs", methods=["GET", "POST"])
def api_investment_txs():
    if request.method == "POST":
        data = _extract_request_data()
        tx_date = str(data.get("date", date.today().isoformat()))
        stock_name = str(data.get("stock_name", "")).strip()
        tx_type = str(data.get("tx_type", "매수")).strip()
        price = float(str(data.get("price", "0")).replace(",", ""))
        shares = float(str(data.get("shares", "0")).replace(",", ""))
        amount = int(float(str(data.get("amount", int(price * shares))).replace(",", "")))
        fee = int(float(str(data.get("fee", "0")).replace(",", "")))
        memo = str(data.get("memo", "")).strip()

        tx_id = add_investment_tx(tx_date, stock_name, tx_type, price, shares, amount, fee, memo)
        return jsonify({"success": True, "id": tx_id}), 201

    return jsonify(get_investment_txs())


@app.route("/api/summary/monthly")
def api_monthly_summary():
    month = request.args.get("month", date.today().strftime("%Y-%m"))
    return jsonify(get_monthly_summary(month))


@app.route("/api/summary/category")
def api_category_summary():
    month = request.args.get("month", date.today().strftime("%Y-%m"))
    summary = get_monthly_summary(month)
    return jsonify(summary["by_category"])


@app.route("/api/summary/daily")
def api_daily_summary():
    month = request.args.get("month", date.today().strftime("%Y-%m"))
    return jsonify(get_daily_summary(month))


@app.route("/api/budgets", methods=["POST"])
def api_set_budget():
    data = _extract_request_data()
    month = str(data.get("month", "")).strip() or date.today().strftime("%Y-%m")
    category = str(data.get("category", "전체")).strip() or "전체"
    raw_amount = str(data.get("budget_amount", data.get("amount", ""))).replace(",", "").strip()

    try:
        budget_amount = int(float(raw_amount))
        set_budget(month, category, budget_amount)
        return jsonify({"success": True}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/budgets/<path:month>/<path:category>", methods=["DELETE"])
def api_delete_budget(month, category):
    try:
        delete_budget(month, category)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/advice")
def api_advice():
    month = request.args.get("month", date.today().strftime("%Y-%m"))
    return jsonify(generate_advice(month))


# ============================================================
# 메인 실행
# ============================================================

if __name__ == "__main__":
    init_db()
    print(">>> 올인원 가계부 & 카드값 대조 허브 서버 시작: http://localhost:5000")
    app.run(debug=True, host="0.0.0.0", port=5000)
