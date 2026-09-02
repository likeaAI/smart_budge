"""
SQLite 데이터베이스 모델 모듈 - 가계부 + 카드값 대조/정산 + 자산/원금 + 주식/투자 올인원
"""

import sqlite3
import os
from datetime import date, datetime, timedelta
from contextlib import contextmanager

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "budget.db")

# 가계부 카테고리 목록
CATEGORIES = [
    {"name": "식비", "emoji": "🍚", "color": "#FF6B6B", "default_type": "필수"},
    {"name": "카페", "emoji": "☕", "color": "#C4A35A", "default_type": "선택"},
    {"name": "교통", "emoji": "🚗", "color": "#4ECDC4", "default_type": "필수"},
    {"name": "쇼핑", "emoji": "🛒", "color": "#FF8E53", "default_type": "선택"},
    {"name": "생활", "emoji": "🏠", "color": "#45B7D1", "default_type": "필수"},
    {"name": "문화", "emoji": "🎬", "color": "#96CEB4", "default_type": "선택"},
    {"name": "구독", "emoji": "📺", "color": "#9B59B6", "default_type": "선택"},
    {"name": "저축", "emoji": "💰", "color": "#2ECC71", "default_type": "필수"},
    {"name": "투자", "emoji": "📈", "color": "#3B82F6", "default_type": "선택"},
    {"name": "급여/수입", "emoji": "💵", "color": "#10B981", "default_type": "필수"},
    {"name": "기타", "emoji": "📝", "color": "#95A5A6", "default_type": "선택"},
]

CATEGORY_MAP = {c["name"]: c for c in CATEGORIES}

# 결제 수단 목록
PAYMENT_METHODS = [
    {"key": "신용카드", "emoji": "💳", "desc": "후불 청구 / 카드값 대조 필요"},
    {"key": "체크카드", "emoji": "💳", "desc": "계좌 즉시 출금"},
    {"key": "현금/계좌", "emoji": "💵", "desc": "현금 또는 계좌이체"},
    {"key": "간편결제/기타", "emoji": "📱", "desc": "페이/상품권 등"},
]

# 기본 카드사 목록
DEFAULT_CARDS = [
    {"name": "현대카드", "company": "현대", "color": "#000000", "emoji": "💳"},
    {"name": "신한카드", "company": "신한", "color": "#0046FF", "emoji": "💳"},
    {"name": "삼성카드", "company": "삼성", "color": "#0C4DA2", "emoji": "💳"},
    {"name": "KB국민카드", "company": "KB국민", "color": "#6B4F35", "emoji": "💳"},
    {"name": "롯데카드", "company": "롯데", "color": "#ED1C24", "emoji": "💳"},
    {"name": "하나카드", "company": "하나", "color": "#008485", "emoji": "💳"},
    {"name": "우리카드", "company": "우리", "color": "#007BC3", "emoji": "💳"},
    {"name": "NH농협카드", "company": "NH농협", "color": "#00A0E9", "emoji": "💳"},
    {"name": "BC/기타카드", "company": "기타", "color": "#E52528", "emoji": "💳"},
]

# 소비 성격 정의
CONSUMPTION_TYPES = [
    {"key": "필수", "label": "필수 소비", "emoji": "🟢", "desc": "식료품, 주거, 공과금, 기본 교통 등 삶에 꼭 필요한 지출", "color": "#10B981"},
    {"key": "선택", "label": "선택 소비", "emoji": "🟡", "desc": "외식, 카페, 취미, 쇼핑 등 삶의 활력을 위한 지출", "color": "#F59E0B"},
    {"key": "낭비", "label": "낭비/충동", "emoji": "🔴", "desc": "충동구매, 홧김비용, 불필요했던 후회되는 지출", "color": "#EF4444"},
]

# 소비 만족도 정의
SATISFACTION_LEVELS = [
    {"key": "만족", "label": "가치 있음", "emoji": "😊", "desc": "돈이 아깝지 않고 정말 만족스러움"},
    {"key": "보통", "label": "무난함", "emoji": "😐", "desc": "일상적이고 당연한 지출"},
    {"key": "후회", "label": "후회됨", "emoji": "😞", "desc": "안 썼어도 됐을 것 같아 아쉬움"},
]

# 자산 종류 정의
ASSET_TYPES = [
    {"key": "현금/예적금", "emoji": "🏦", "color": "#10B981", "desc": "입출금통장, 정기예금, 적금, CMA, 비상금"},
    {"key": "국내주식", "emoji": "🇰🇷", "color": "#3B82F6", "desc": "코스피, 코스닥, 국내 상장 ETF"},
    {"key": "해외주식", "emoji": "🇺🇸", "color": "#8B5CF6", "desc": "미국주식, 해외 상장 ETF, 배당주"},
    {"key": "암호화폐", "emoji": "🪙", "color": "#F59E0B", "desc": "비트코인, 이더리움 등 가상자산"},
    {"key": "부동산/실물", "emoji": "🏢", "color": "#06B6D4", "desc": "주택, 전월세 보증금, 금, 실물자산"},
    {"key": "기타자산", "emoji": "💼", "color": "#6B7280", "desc": "퇴직연금, 개인연금(IRP), 대여금 등"},
    {"key": "부채/대출", "emoji": "💳", "color": "#EF4444", "desc": "신용대출, 주택담보대출, 마이너스통장, 할부금"},
]

ASSET_TYPE_MAP = {a["key"]: a for a in ASSET_TYPES}


@contextmanager
def get_db():
    """데이터베이스 연결 컨텍스트 매니저 (락 방지 및 타임아웃 30초 설정)"""
    conn = sqlite3.connect(DB_PATH, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """데이터베이스 테이블 초기화 및 마이그레이션"""
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('지출', '수입')),
                amount INTEGER NOT NULL CHECK(amount > 0),
                category TEXT NOT NULL,
                description TEXT DEFAULT '',
                consumption_type TEXT DEFAULT '선택',
                satisfaction TEXT DEFAULT '보통',
                payment_method TEXT DEFAULT '신용카드',
                card_name TEXT DEFAULT '',
                billing_month TEXT DEFAULT '',
                is_reconciled INTEGER DEFAULT 0,
                installment INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE TABLE IF NOT EXISTS budgets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                month TEXT NOT NULL,
                category TEXT NOT NULL,
                budget_amount INTEGER NOT NULL CHECK(budget_amount > 0),
                UNIQUE(month, category)
            );

            -- 💳 카드 청구서 대조 & 검증 기록 테이블
            CREATE TABLE IF NOT EXISTS card_statements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                billing_month TEXT NOT NULL,
                card_name TEXT NOT NULL,
                billed_amount INTEGER NOT NULL,
                recorded_amount INTEGER NOT NULL DEFAULT 0,
                difference INTEGER NOT NULL DEFAULT 0,
                status TEXT DEFAULT '대조중',
                memo TEXT DEFAULT '',
                updated_at TEXT DEFAULT (datetime('now', 'localtime')),
                UNIQUE(billing_month, card_name)
            );

            -- 🏦 자산 계좌 / 보유 자산 테이블 (원래 있던 돈, 예적금, 부동산 등)
            CREATE TABLE IF NOT EXISTS assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                asset_type TEXT NOT NULL,
                amount INTEGER NOT NULL,
                initial_amount INTEGER NOT NULL DEFAULT 0,
                memo TEXT DEFAULT '',
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            -- 📈 주식 & 투자 포트폴리오 종목 테이블
            CREATE TABLE IF NOT EXISTS investments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                code TEXT DEFAULT '',
                market TEXT NOT NULL DEFAULT '국내주식',
                shares REAL NOT NULL CHECK(shares >= 0),
                avg_price REAL NOT NULL CHECK(avg_price >= 0),
                current_price REAL NOT NULL CHECK(current_price >= 0),
                dividend_rate REAL DEFAULT 0,
                target_price REAL DEFAULT 0,
                memo TEXT DEFAULT '',
                updated_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            -- 📝 주식 매매 & 배당 거래 일지
            CREATE TABLE IF NOT EXISTS investment_txs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                stock_name TEXT NOT NULL,
                tx_type TEXT NOT NULL CHECK(tx_type IN ('매수', '매도', '배당금', '입금', '출금')),
                price REAL NOT NULL DEFAULT 0,
                shares REAL NOT NULL DEFAULT 0,
                amount INTEGER NOT NULL,
                fee INTEGER DEFAULT 0,
                memo TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
            CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
            CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
            CREATE INDEX IF NOT EXISTS idx_transactions_card ON transactions(card_name);
            CREATE INDEX IF NOT EXISTS idx_transactions_billing ON transactions(billing_month);
            CREATE INDEX IF NOT EXISTS idx_budgets_month ON budgets(month);
            CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);
            CREATE INDEX IF NOT EXISTS idx_investments_name ON investments(name);
        """)

        # 기존 DB 테이블 컬럼 마이그레이션
        cols = [c[1] for c in conn.execute("PRAGMA table_info(transactions)").fetchall()]
        if "consumption_type" not in cols:
            conn.execute("ALTER TABLE transactions ADD COLUMN consumption_type TEXT DEFAULT '선택'")
        if "satisfaction" not in cols:
            conn.execute("ALTER TABLE transactions ADD COLUMN satisfaction TEXT DEFAULT '보통'")
        if "payment_method" not in cols:
            conn.execute("ALTER TABLE transactions ADD COLUMN payment_method TEXT DEFAULT '신용카드'")
        if "card_name" not in cols:
            conn.execute("ALTER TABLE transactions ADD COLUMN card_name TEXT DEFAULT ''")
        if "billing_month" not in cols:
            conn.execute("ALTER TABLE transactions ADD COLUMN billing_month TEXT DEFAULT ''")
        if "is_reconciled" not in cols:
            conn.execute("ALTER TABLE transactions ADD COLUMN is_reconciled INTEGER DEFAULT 0")
        if "installment" not in cols:
            conn.execute("ALTER TABLE transactions ADD COLUMN installment INTEGER DEFAULT 1")

        # 기존에 billing_month가 비어있는 거래들에 기본값(date의 YYYY-MM) 채우기
        conn.execute("UPDATE transactions SET billing_month = strftime('%Y-%m', date) WHERE billing_month IS NULL OR billing_month = ''")


# ============================================================
# 가계부 거래 내역 CRUD (결제수단 & 카드 대조 필드 포함)
# ============================================================

def add_transaction(tx_date: str, tx_type: str, amount: int,
                    category: str, description: str = "",
                    consumption_type: str = "선택",
                    satisfaction: str = "보통",
                    payment_method: str = "신용카드",
                    card_name: str = "",
                    billing_month: str = "",
                    installment: int = 1) -> int:
    """거래 내역 추가"""
    tx_date = str(tx_date).strip() or date.today().isoformat()
    tx_type = "수입" if str(tx_type).strip() == "수입" else "지출"
    amount = max(1, abs(int(amount)))
    category = str(category).strip() or "기타"
    description = str(description or "").strip()
    consumption_type = str(consumption_type).strip() if consumption_type in ["필수", "선택", "낭비"] else "선택"
    satisfaction = str(satisfaction).strip() if satisfaction in ["만족", "보통", "후회"] else "보통"
    payment_method = str(payment_method).strip() or ("신용카드" if tx_type == "지출" else "현금/계좌")
    card_name = str(card_name or "").strip()
    billing_month = str(billing_month).strip() or tx_date[:7]
    installment = max(1, int(installment or 1))

    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO transactions (date, type, amount, category, description, consumption_type, satisfaction, "
            "payment_method, card_name, billing_month, installment, is_reconciled) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
            (tx_date, tx_type, amount, category, description, consumption_type, satisfaction,
             payment_method, card_name, billing_month, installment),
        )
        return cursor.lastrowid


def update_transaction(tx_id: int, tx_date: str, tx_type: str,
                       amount: int, category: str, description: str = "",
                       consumption_type: str = "선택",
                       satisfaction: str = "보통",
                       payment_method: str = "신용카드",
                       card_name: str = "",
                       billing_month: str = "",
                       installment: int = 1,
                       is_reconciled: int = None):
    """거래 내역 수정"""
    tx_id = int(tx_id)
    tx_date = str(tx_date).strip() or date.today().isoformat()
    tx_type = "수입" if str(tx_type).strip() == "수입" else "지출"
    amount = max(1, abs(int(amount)))
    category = str(category).strip() or "기타"
    description = str(description or "").strip()
    consumption_type = str(consumption_type).strip() if consumption_type in ["필수", "선택", "낭비"] else "선택"
    satisfaction = str(satisfaction).strip() if satisfaction in ["만족", "보통", "후회"] else "보통"
    payment_method = str(payment_method).strip() or ("신용카드" if tx_type == "지출" else "현금/계좌")
    card_name = str(card_name or "").strip()
    billing_month = str(billing_month).strip() or tx_date[:7]
    installment = max(1, int(installment or 1))

    with get_db() as conn:
        if is_reconciled is not None:
            conn.execute(
                "UPDATE transactions SET date=?, type=?, amount=?, category=?, description=?, "
                "consumption_type=?, satisfaction=?, payment_method=?, card_name=?, billing_month=?, "
                "installment=?, is_reconciled=? WHERE id=?",
                (tx_date, tx_type, amount, category, description, consumption_type, satisfaction,
                 payment_method, card_name, billing_month, installment, int(is_reconciled), tx_id),
            )
        else:
            conn.execute(
                "UPDATE transactions SET date=?, type=?, amount=?, category=?, description=?, "
                "consumption_type=?, satisfaction=?, payment_method=?, card_name=?, billing_month=?, "
                "installment=? WHERE id=?",
                (tx_date, tx_type, amount, category, description, consumption_type, satisfaction,
                 payment_method, card_name, billing_month, installment, tx_id),
            )


def delete_transaction(tx_id: int):
    """거래 내역 삭제"""
    with get_db() as conn:
        conn.execute("DELETE FROM transactions WHERE id=?", (int(tx_id),))


def get_transaction(tx_id: int) -> dict | None:
    """단건 거래 내역 조회"""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM transactions WHERE id=?", (int(tx_id),)
        ).fetchone()
        return dict(row) if row else None


def get_transactions(month: str = None, category: str = None,
                     tx_type: str = None, consumption_type: str = None,
                     satisfaction: str = None, payment_method: str = None,
                     card_name: str = None, billing_month: str = None,
                     is_reconciled: int = None, limit: int = None) -> list[dict]:
    """거래 내역 조회 (다양한 필터 지원)"""
    query = "SELECT * FROM transactions WHERE 1=1"
    params = []

    if month:
        query += " AND strftime('%Y-%m', date) = ?"
        params.append(month)
    if billing_month:
        query += " AND billing_month = ?"
        params.append(billing_month)
    if category:
        query += " AND category = ?"
        params.append(category)
    if tx_type:
        query += " AND type = ?"
        params.append(tx_type)
    if consumption_type:
        query += " AND consumption_type = ?"
        params.append(consumption_type)
    if satisfaction:
        query += " AND satisfaction = ?"
        params.append(satisfaction)
    if payment_method:
        query += " AND payment_method = ?"
        params.append(payment_method)
    if card_name:
        query += " AND card_name = ?"
        params.append(card_name)
    if is_reconciled is not None:
        query += " AND is_reconciled = ?"
        params.append(int(is_reconciled))

    query += " ORDER BY date DESC, id DESC"

    if limit:
        query += " LIMIT ?"
        params.append(int(limit))

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]


def get_monthly_summary(month: str = None) -> dict:
    """월간 요약 데이터 (결제수단별 집계 포함)"""
    if not month:
        month = date.today().strftime("%Y-%m")

    with get_db() as conn:
        row = conn.execute("""
            SELECT
                COALESCE(SUM(CASE WHEN type='지출' THEN amount END), 0) as total_expense,
                COALESCE(SUM(CASE WHEN type='수입' THEN amount END), 0) as total_income,
                COUNT(*) as count
            FROM transactions
            WHERE strftime('%Y-%m', date) = ?
        """, (month,)).fetchone()

        total_expense = int(row["total_expense"] or 0)
        total_income = int(row["total_income"] or 0)

        # 카테고리별 지출
        cat_rows = conn.execute("""
            SELECT category, SUM(amount) as total, COUNT(*) as count
            FROM transactions
            WHERE strftime('%Y-%m', date) = ? AND type = '지출'
            GROUP BY category
            ORDER BY total DESC
        """, (month,)).fetchall()

        # 결제수단별 지출 (신용카드 vs 체크카드 vs 현금)
        pay_rows = conn.execute("""
            SELECT COALESCE(payment_method, '신용카드') as p_method, SUM(amount) as total, COUNT(*) as count
            FROM transactions
            WHERE strftime('%Y-%m', date) = ? AND type = '지출'
            GROUP BY p_method
        """, (month,)).fetchall()
        by_payment_method = {r["p_method"]: {"total": int(r["total"]), "count": int(r["count"])} for r in pay_rows}

        # 소비 성격별
        type_rows = conn.execute("""
            SELECT
                COALESCE(consumption_type, '선택') as c_type,
                SUM(amount) as total,
                COUNT(*) as count
            FROM transactions
            WHERE strftime('%Y-%m', date) = ? AND type = '지출'
            GROUP BY c_type
        """, (month,)).fetchall()
        by_consumption_type = {r["c_type"]: {"total": int(r["total"]), "count": int(r["count"])} for r in type_rows}

        # 소비 만족도별
        sat_rows = conn.execute("""
            SELECT
                COALESCE(satisfaction, '보통') as sat,
                SUM(amount) as total,
                COUNT(*) as count
            FROM transactions
            WHERE strftime('%Y-%m', date) = ? AND type = '지출'
            GROUP BY sat
        """, (month,)).fetchall()
        by_satisfaction = {r["sat"]: {"total": int(r["total"]), "count": int(r["count"])} for r in sat_rows}

        regret_total = by_satisfaction.get("후회", {}).get("total", 0)
        waste_total = by_consumption_type.get("낭비", {}).get("total", 0)
        card_expense = by_payment_method.get("신용카드", {}).get("total", 0)

        return {
            "month": month,
            "total_expense": total_expense,
            "total_income": total_income,
            "balance": total_income - total_expense,
            "count": int(row["count"] or 0),
            "by_category": [{"category": r["category"], "total": int(r["total"]), "count": int(r["count"])} for r in cat_rows],
            "by_payment_method": by_payment_method,
            "by_consumption_type": by_consumption_type,
            "by_satisfaction": by_satisfaction,
            "card_expense": card_expense,
            "regret_total": regret_total,
            "waste_total": waste_total,
            "mindful_score": max(0, 100 - round((waste_total + regret_total) / total_expense * 100)) if total_expense > 0 else 100,
        }


def get_daily_summary(month: str = None) -> list[dict]:
    """일별 지출 합계"""
    if not month:
        month = date.today().strftime("%Y-%m")

    with get_db() as conn:
        rows = conn.execute("""
            SELECT date, SUM(amount) as total
            FROM transactions
            WHERE strftime('%Y-%m', date) = ? AND type = '지출'
            GROUP BY date
            ORDER BY date
        """, (month,)).fetchall()
        return [{"date": r["date"], "total": int(r["total"])} for r in rows]


def get_category_trend(months: int = 3) -> list[dict]:
    """최근 N개월 카테고리별 추이"""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT strftime('%Y-%m', date) as month, category, SUM(amount) as total
            FROM transactions
            WHERE type = '지출'
              AND date >= date('now', ? || ' months')
            GROUP BY month, category
            ORDER BY month, total DESC
        """, (f"-{months}",)).fetchall()
        return [dict(r) for r in rows]


def get_weekday_pattern(month: str = None) -> dict:
    """요일별 평균 지출 패턴"""
    if not month:
        month = date.today().strftime("%Y-%m")

    with get_db() as conn:
        rows = conn.execute("""
            SELECT
                CASE CAST(strftime('%w', date) AS INTEGER)
                    WHEN 0 THEN '일' WHEN 1 THEN '월' WHEN 2 THEN '화'
                    WHEN 3 THEN '수' WHEN 4 THEN '목' WHEN 5 THEN '금'
                    WHEN 6 THEN '토'
                END as weekday,
                CAST(strftime('%w', date) AS INTEGER) as day_num,
                AVG(daily_total) as avg_amount
            FROM (
                SELECT date, SUM(amount) as daily_total
                FROM transactions
                WHERE strftime('%Y-%m', date) = ? AND type = '지출'
                GROUP BY date
            )
            GROUP BY day_num
            ORDER BY day_num
        """, (month,)).fetchall()
        return {r["weekday"]: int(r["avg_amount"]) for r in rows}


def get_recent_expenses(days: int = 7) -> dict:
    """최근 N일간 지출 합계"""
    start_date = (date.today() - timedelta(days=days)).isoformat()
    with get_db() as conn:
        row = conn.execute("""
            SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
            FROM transactions
            WHERE date >= ? AND type = '지출'
        """, (start_date,)).fetchone()
        return {"total": int(row["total"] or 0), "count": int(row["count"] or 0), "days": days}


# ============================================================
# 💳 신용카드 청구 대조 & 카드값 검증 (Card Reconciliation)
# ============================================================

def get_card_reconciliation_summary(billing_month: str = None) -> dict:
    """
    특정 청구월의 카드별 청구 예정 총액, 대조 완료율, 실제 청구서와의 차액 분석
    """
    if not billing_month:
        billing_month = date.today().strftime("%Y-%m")

    with get_db() as conn:
        # 1. 가계부에 기록된 신용카드 사용 내역 집계 (청구월 기준)
        rows = conn.execute("""
            SELECT
                COALESCE(card_name, '기타카드') as card,
                COUNT(*) as count,
                SUM(amount) as total_amount,
                SUM(CASE WHEN is_reconciled = 1 THEN amount ELSE 0 END) as reconciled_amount,
                SUM(CASE WHEN is_reconciled = 1 THEN 1 ELSE 0 END) as reconciled_count
            FROM transactions
            WHERE type = '지출'
              AND (payment_method = '신용카드' OR card_name != '')
              AND billing_month = ?
            GROUP BY card
            ORDER BY total_amount DESC
        """, (billing_month,)).fetchall()

        # 2. 카드사 청구서 등록 내역 조회
        stmt_rows = conn.execute("""
            SELECT * FROM card_statements WHERE billing_month = ?
        """, (billing_month,)).fetchall()
        stmt_map = {r["card_name"]: dict(r) for r in stmt_rows}

        cards_summary = []
        total_card_spent = 0
        total_billed_amount = 0
        total_reconciled_spent = 0

        for r in rows:
            card = r["card"]
            spent = int(r["total_amount"] or 0)
            rec_spent = int(r["reconciled_amount"] or 0)
            count = int(r["count"] or 0)
            rec_count = int(r["reconciled_count"] or 0)

            total_card_spent += spent
            total_reconciled_spent += rec_spent

            stmt = stmt_map.get(card)
            billed = int(stmt["billed_amount"]) if stmt else 0
            diff = (billed - spent) if stmt else 0
            status = stmt["status"] if stmt else ("대조완료" if (count > 0 and count == rec_count) else "미대조")

            if stmt:
                total_billed_amount += billed

            cards_summary.append({
                "card_name": card,
                "spent_amount": spent,
                "billed_amount": billed,
                "difference": diff,
                "status": status,
                "count": count,
                "reconciled_count": rec_count,
                "progress_pct": round(rec_spent / spent * 100, 1) if spent > 0 else 0,
                "statement_id": stmt["id"] if stmt else None,
                "memo": stmt["memo"] if stmt else "",
            })

        return {
            "billing_month": billing_month,
            "cards": cards_summary,
            "total_card_spent": total_card_spent,
            "total_billed_amount": total_billed_amount,
            "total_reconciled_spent": total_reconciled_spent,
            "overall_progress_pct": round(total_reconciled_spent / total_card_spent * 100, 1) if total_card_spent > 0 else 0,
        }


def reconcile_card_statement(billing_month: str, card_name: str, billed_amount: int, memo: str = "") -> dict:
    """
    실제 카드사에서 나온 청구서 금액을 등록하고 기록과 대조합니다.
    """
    billing_month = str(billing_month).strip()
    card_name = str(card_name).strip()
    billed_amount = max(0, int(billed_amount))
    memo = str(memo or "").strip()

    with get_db() as conn:
        # 현재 기록된 가계부 합계 계산
        row = conn.execute("""
            SELECT COALESCE(SUM(amount), 0) as recorded_total
            FROM transactions
            WHERE type = '지출'
              AND (payment_method = '신용카드' OR card_name != '')
              AND billing_month = ?
              AND (card_name = ? OR (? = '기타카드' AND (card_name IS NULL OR card_name = '')))
        """, (billing_month, card_name, card_name)).fetchone()

        recorded_amount = int(row["recorded_total"] or 0)
        diff = billed_amount - recorded_amount

        if diff == 0:
            status = "일치"
        elif diff > 0:
            status = "청구액 초과 (누락 지출 가능성)"
        else:
            status = "기록 초과 (결제일 차이 가능성)"

        conn.execute("""
            INSERT INTO card_statements (billing_month, card_name, billed_amount, recorded_amount, difference, status, memo, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            ON CONFLICT(billing_month, card_name) DO UPDATE SET
                billed_amount = ?,
                recorded_amount = ?,
                difference = ?,
                status = ?,
                memo = ?,
                updated_at = datetime('now', 'localtime')
        """, (billing_month, card_name, billed_amount, recorded_amount, diff, status, memo,
              billed_amount, recorded_amount, diff, status, memo))

        return {
            "billing_month": billing_month,
            "card_name": card_name,
            "billed_amount": billed_amount,
            "recorded_amount": recorded_amount,
            "difference": diff,
            "status": status,
        }


def toggle_transaction_reconciled(tx_id: int, is_reconciled: int = None) -> int:
    """거래 내역 대조 완료(체크) 상태 토글"""
    with get_db() as conn:
        if is_reconciled is None:
            conn.execute("UPDATE transactions SET is_reconciled = (CASE WHEN is_reconciled = 1 THEN 0 ELSE 1 END) WHERE id = ?", (int(tx_id),))
        else:
            conn.execute("UPDATE transactions SET is_reconciled = ? WHERE id = ?", (int(is_reconciled), int(tx_id)))

        res = conn.execute("SELECT is_reconciled FROM transactions WHERE id = ?", (int(tx_id),)).fetchone()
        return res["is_reconciled"] if res else 0


def batch_reconcile_card_transactions(billing_month: str, card_name: str, reconcile_all: bool = True):
    """특정 카드 특정 청구월의 모든 거래를 일괄 대조 완료 처리"""
    with get_db() as conn:
        val = 1 if reconcile_all else 0
        conn.execute("""
            UPDATE transactions
            SET is_reconciled = ?
            WHERE type = '지출'
              AND billing_month = ?
              AND (card_name = ? OR (? = '' AND card_name IS NULL))
        """, (val, str(billing_month), str(card_name), str(card_name)))


# ============================================================
# 예산 관리
# ============================================================

def set_budget(month: str, category: str, budget_amount: int):
    """예산 설정"""
    month = str(month).strip()
    category = str(category).strip()
    budget_amount = max(1, abs(int(budget_amount)))

    with get_db() as conn:
        conn.execute("""
            INSERT INTO budgets (month, category, budget_amount)
            VALUES (?, ?, ?)
            ON CONFLICT(month, category) DO UPDATE SET budget_amount = ?
        """, (month, category, budget_amount, budget_amount))


def get_budgets(month: str = None) -> list[dict]:
    """예산 목록 조회"""
    if not month:
        month = date.today().strftime("%Y-%m")

    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM budgets WHERE month = ? ORDER BY category",
            (month,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_budget_status(month: str = None) -> list[dict]:
    """예산 대비 실제 지출 현황"""
    if not month:
        month = date.today().strftime("%Y-%m")

    budgets = get_budgets(month)
    if not budgets:
        return []

    summary = get_monthly_summary(month)
    spent_map = {c["category"]: c["total"] for c in summary["by_category"]}

    result = []
    for b in budgets:
        cat = b["category"]
        budget_amt = int(b["budget_amount"])

        if cat == "전체":
            spent = summary["total_expense"]
        else:
            spent = spent_map.get(cat, 0)

        remaining = budget_amt - spent
        percent = round(spent / budget_amt * 100, 1) if budget_amt > 0 else 0

        result.append({
            "category": cat,
            "budget": budget_amt,
            "spent": spent,
            "remaining": remaining,
            "percent": percent,
        })

    return result


def delete_budget(month: str, category: str):
    """예산 삭제"""
    with get_db() as conn:
        conn.execute(
            "DELETE FROM budgets WHERE month = ? AND category = ?",
            (str(month).strip(), str(category).strip()),
        )


# ============================================================
# 🏦 자산 포트폴리오 (원래 가진 돈, 예적금, 부동산 등)
# ============================================================

def add_asset(name: str, asset_type: str, amount: int,
              initial_amount: int = 0, memo: str = "") -> int:
    """자산 항목 추가"""
    name = str(name).strip()
    asset_type = str(asset_type).strip() or "현금/예적금"
    amount = int(amount)
    initial_amount = int(initial_amount) if initial_amount else amount
    memo = str(memo or "").strip()

    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO assets (name, asset_type, amount, initial_amount, memo, updated_at) "
            "VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))",
            (name, asset_type, amount, initial_amount, memo),
        )
        return cursor.lastrowid


def update_asset(asset_id: int, name: str, asset_type: str,
                 amount: int, initial_amount: int, memo: str = ""):
    """자산 항목 수정"""
    with get_db() as conn:
        conn.execute(
            "UPDATE assets SET name=?, asset_type=?, amount=?, initial_amount=?, memo=?, updated_at=datetime('now', 'localtime') "
            "WHERE id=?",
            (str(name).strip(), str(asset_type).strip(), int(amount), int(initial_amount), str(memo or "").strip(), int(asset_id)),
        )


def delete_asset(asset_id: int):
    """자산 항목 삭제"""
    with get_db() as conn:
        conn.execute("DELETE FROM assets WHERE id=?", (int(asset_id),))


def get_assets() -> list[dict]:
    """전체 자산 목록 조회"""
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM assets ORDER BY asset_type, amount DESC").fetchall()
        return [dict(r) for r in rows]


# ============================================================
# 📈 주식 & 투자 포트폴리오 (종목, 수량, 평단가, 손익)
# ============================================================

def add_investment(name: str, market: str, shares: float,
                   avg_price: float, current_price: float,
                   code: str = "", dividend_rate: float = 0,
                   target_price: float = 0, memo: str = "") -> int:
    """주식/투자 종목 추가"""
    name = str(name).strip()
    market = str(market).strip() or "국내주식"
    shares = float(shares)
    avg_price = float(avg_price)
    current_price = float(current_price) if current_price > 0 else avg_price
    code = str(code or "").strip()
    dividend_rate = float(dividend_rate or 0)
    target_price = float(target_price or 0)
    memo = str(memo or "").strip()

    with get_db() as conn:
        cursor = conn.execute("""
            INSERT INTO investments (name, code, market, shares, avg_price, current_price, dividend_rate, target_price, memo, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        """, (name, code, market, shares, avg_price, current_price, dividend_rate, target_price, memo))
        return cursor.lastrowid


def update_investment(inv_id: int, name: str, market: str, shares: float,
                      avg_price: float, current_price: float,
                      code: str = "", dividend_rate: float = 0,
                      target_price: float = 0, memo: str = ""):
    """주식/투자 종목 수정"""
    with get_db() as conn:
        conn.execute("""
            UPDATE investments
            SET name=?, code=?, market=?, shares=?, avg_price=?, current_price=?, dividend_rate=?, target_price=?, memo=?, updated_at=datetime('now', 'localtime')
            WHERE id=?
        """, (str(name).strip(), str(code or "").strip(), str(market).strip(), float(shares), float(avg_price), float(current_price), float(dividend_rate or 0), float(target_price or 0), str(memo or "").strip(), int(inv_id)))


def delete_investment(inv_id: int):
    """주식/투자 종목 삭제"""
    with get_db() as conn:
        conn.execute("DELETE FROM investments WHERE id=?", (int(inv_id),))


def get_investments() -> list[dict]:
    """보유 주식/투자 종목 목록 및 실시간 수익률 계산"""
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM investments ORDER BY market, (shares * current_price) DESC").fetchall()
        result = []
        for r in rows:
            d = dict(r)
            shares = float(d["shares"])
            avg_price = float(d["avg_price"])
            cur_price = float(d["current_price"])

            total_cost = int(shares * avg_price)
            total_eval = int(shares * cur_price)
            profit = total_eval - total_cost
            profit_rate = round((profit / total_cost * 100), 2) if total_cost > 0 else 0

            d["total_cost"] = total_cost
            d["total_eval"] = total_eval
            d["profit"] = profit
            d["profit_rate"] = profit_rate
            result.append(d)
        return result


def add_investment_tx(tx_date: str, stock_name: str, tx_type: str,
                      price: float, shares: float, amount: int,
                      fee: int = 0, memo: str = "") -> int:
    """매매/배당 거래 기록 추가"""
    with get_db() as conn:
        cursor = conn.execute("""
            INSERT INTO investment_txs (date, stock_name, tx_type, price, shares, amount, fee, memo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (str(tx_date), str(stock_name), str(tx_type), float(price), float(shares), int(amount), int(fee), str(memo or "")))
        return cursor.lastrowid


def get_investment_txs(limit: int = 20) -> list[dict]:
    """투자 거래 일지 조회"""
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM investment_txs ORDER BY date DESC, id DESC LIMIT ?", (int(limit),)).fetchall()
        return [dict(r) for r in rows]


# ============================================================
# 🌐 통합 순자산(Net Worth) & 머니 허브 집계
# ============================================================

def get_net_worth_summary() -> dict:
    """통합 순자산, 자산 구성비, 주식 평가손익 전체 집계"""
    assets = get_assets()
    investments = get_investments()

    # 1. 자산별 합산
    total_asset_amount = 0
    total_debt_amount = 0
    by_type = {}

    for a in assets:
        t = a["asset_type"]
        amt = int(a["amount"])
        if t == "부채/대출":
            total_debt_amount += amt
        else:
            total_asset_amount += amt

        if t not in by_type:
            by_type[t] = {"total": 0, "count": 0, "color": ASSET_TYPE_MAP.get(t, {}).get("color", "#6B7280"), "emoji": ASSET_TYPE_MAP.get(t, {}).get("emoji", "💼")}
        by_type[t]["total"] += amt
        by_type[t]["count"] += 1

    # 2. 주식/투자 종목 평가액 합산
    inv_total_eval = sum(i["total_eval"] for i in investments)
    inv_total_cost = sum(i["total_cost"] for i in investments)
    inv_total_profit = inv_total_eval - inv_total_cost
    inv_total_profit_rate = round(inv_total_profit / inv_total_cost * 100, 2) if inv_total_cost > 0 else 0

    grand_total_assets = total_asset_amount + inv_total_eval
    net_worth = grand_total_assets - total_debt_amount

    return {
        "net_worth": net_worth,
        "total_assets": grand_total_assets,
        "total_debt": total_debt_amount,
        "assets_list": assets,
        "investments_list": investments,
        "by_asset_type": by_type,
        "inv_total_eval": inv_total_eval,
        "inv_total_cost": inv_total_cost,
        "inv_total_profit": inv_total_profit,
        "inv_total_profit_rate": inv_total_profit_rate,
    }
