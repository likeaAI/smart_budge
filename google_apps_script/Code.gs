/**
 * 💰 스마트 머니 허브 - 구글 앱스크립트 (Google Apps Script Backend)
 * 구글 시트를 DB로 활용하는 가계부 + 카드값 대조 + 순자산/주식 + 장기 인생 목표 로드맵 API
 */

// ==========================================
// 1. 웹 앱 진입점 (doGet / doPost)
// ==========================================

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
  
  if (action) {
    return handleApiGet(e);
  }
  
  initSheets();
  return ContentService.createTextOutput(JSON.stringify({
    status: "running",
    message: "스마트 머니 허브 API 서버 정상 작동 중",
    data: getAllData(Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM'))
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var data = {};
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (jsonErr) {
        data = { text: e.postData.contents };
      }
    } else if (e.parameter) {
      data = e.parameter;
    }
    
    var action = data.action || (e.parameter ? e.parameter.action : '');
    if (!action && (data.text || data.sms || data.message || data.body)) {
      action = 'parseSmsWebhook';
    }
    
    var result = handleApiPost(action, data);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// 2. API 라우터 (GET / POST)
// ==========================================

function handleApiGet(e) {
  initSheets();
  var action = e.parameter.action;
  var month = e.parameter.month || Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM');
  var result = {};
  
  if (action === 'getAllData' || action === 'loadGame') {
    result = getAllData(month);
  } else if (action === 'getSummary') {
    result = getAllData(month).summary;
  } else {
    result = { success: false, error: 'Unknown GET action: ' + action };
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleApiPost(action, data) {
  initSheets();
  
  if (action === 'getAllData') {
    var month = data.month || Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM');
    return getAllData(month);
  } else if (action === 'parseSmsWebhook' || action === 'webhook') {
    var rawText = data.text || data.sms || data.message || data.body || '';
    return parseSmsAndSave(rawText, data);
  } else if (action === 'addTransaction') {
    return addTransaction(data);
  } else if (action === 'deleteTransaction') {
    return deleteTransaction(data.id);
  } else if (action === 'toggleReconcile') {
    return toggleReconcile(data.id);
  } else if (action === 'reconcileCard') {
    return reconcileCard(data);
  } else if (action === 'saveAsset') {
    return saveAsset(data);
  } else if (action === 'deleteAsset') {
    return deleteAsset(data.id);
  } else if (action === 'saveInvestment') {
    return saveInvestment(data);
  } else if (action === 'deleteInvestment') {
    return deleteInvestment(data.id);
  } else if (action === 'saveGoal') {
    return saveGoal(data);
  } else if (action === 'deleteGoal') {
    return deleteGoal(data.id);
  }
  return { success: false, error: 'Unknown POST action: ' + action };
}

function formatGASDate(val) {
  if (!val) return Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'GMT+9', 'yyyy-MM-dd');
  }
  var s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.substring(0, 10);
  }
  return s;
}

// ==========================================
// 3. 📊 핵심: 전체 데이터 조회 (장기 목표 & 시뮬레이션 포함)
// ==========================================

function getAllData(month) {
  var ss = getSpreadsheet();
  initSheets();
  if (!month) month = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM');
  
  // 1. 거래 내역 조회
  var txSheet = ss.getSheetByName('가계부_내역');
  var txData = txSheet.getDataRange().getValues();
  var transactions = [];
  var totalExpense = 0;
  var totalIncome = 0;
  var byCategory = {};
  var byConsumptionType = { '필수': 0, '선택': 0, '낭비': 0 };
  var bySatisfaction = { '만족': 0, '보통': 0, '후회': 0 };
  var cardSpentMap = {};
  
  for (var i = 1; i < txData.length; i++) {
    var row = txData[i];
    if (!row[0]) continue;
    
    var txDate = formatGASDate(row[1]);
    var txMonth = txDate.substring(0, 7);
    var billingMonth = row[10] ? formatGASDate(row[10]).substring(0, 7) : txMonth;
    var type = String(row[2] || '지출');
    var amount = Number(row[3]) || 0;
    var cat = String(row[4] || '기타');
    var desc = String(row[5] || '');
    var cType = String(row[6] || '선택');
    var sat = String(row[7] || '보통');
    var payMethod = String(row[8] || '신용카드');
    var cardName = String(row[9] || '');
    var isReconciled = Number(row[11]) || 0;
    var installment = Number(row[12]) || 1;
    
    var item = {
      id: row[0],
      date: txDate,
      type: type,
      amount: amount,
      category: cat,
      description: desc,
      consumption_type: cType,
      satisfaction: sat,
      payment_method: payMethod,
      card_name: cardName,
      billing_month: billingMonth,
      is_reconciled: isReconciled,
      installment: installment
    };
    
    if (txMonth === month || month === 'all') {
      transactions.unshift(item);
      if (type === '지출') {
        totalExpense += amount;
        byCategory[cat] = (byCategory[cat] || 0) + amount;
        byConsumptionType[cType] = (byConsumptionType[cType] || 0) + amount;
        bySatisfaction[sat] = (bySatisfaction[sat] || 0) + amount;
      } else {
        totalIncome += amount;
      }
    }
    
    if (type === '지출' && (payMethod === '신용카드' || cardName !== '')) {
      var cKey = cardName || '기타카드';
      if (!cardSpentMap[billingMonth]) cardSpentMap[billingMonth] = {};
      if (!cardSpentMap[billingMonth][cKey]) {
        cardSpentMap[billingMonth][cKey] = { total: 0, count: 0, reconciled: 0 };
      }
      cardSpentMap[billingMonth][cKey].total += amount;
      cardSpentMap[billingMonth][cKey].count += 1;
      if (isReconciled === 1) cardSpentMap[billingMonth][cKey].reconciled += 1;
    }
  }
  
  // 2. 카드값 대조 조회
  var cardSheet = ss.getSheetByName('카드값_대조');
  var cardData = cardSheet.getDataRange().getValues();
  var cardStatements = {};
  for (var k = 1; k < cardData.length; k++) {
    var crow = cardData[k];
    var cMonth = formatGASDate(crow[0]).substring(0, 7);
    if (cMonth === month) {
      cardStatements[String(crow[1])] = {
        billed: Number(crow[2]) || 0,
        recorded: Number(crow[3]) || 0,
        diff: Number(crow[4]) || 0,
        status: String(crow[5] || ''),
        memo: String(crow[6] || '')
      };
    }
  }
  
  var cardsSummary = [];
  var curMonthCards = cardSpentMap[month] || {};
  for (var cName in curMonthCards) {
    var info = curMonthCards[cName];
    var stmt = cardStatements[cName] || {};
    var billed = stmt.billed || 0;
    var diff = billed > 0 ? (billed - info.total) : 0;
    var status = stmt.status || (info.count === info.reconciled && info.count > 0 ? '대조완료' : '미대조');
    
    cardsSummary.push({
      card_name: cName,
      spent_amount: info.total,
      billed_amount: billed,
      difference: diff,
      status: status,
      count: info.count,
      reconciled_count: info.reconciled,
      progress_pct: info.total > 0 ? Math.round(info.reconciled / info.count * 100) : 0
    });
  }
  
  // 3. 자산/원금 조회
  var assetSheet = ss.getSheetByName('자산_원금');
  var assetData = assetSheet.getDataRange().getValues();
  var assetsList = [];
  var totalAssets = 0;
  var totalDebt = 0;
  for (var a = 1; a < assetData.length; a++) {
    var aRow = assetData[a];
    if (!aRow[0]) continue;
    var aAmt = Number(aRow[3]) || 0;
    var aType = String(aRow[2] || '현금/예적금');
    if (aType === '부채/대출') totalDebt += aAmt;
    else totalAssets += aAmt;
    assetsList.push({ id: aRow[0], name: String(aRow[1]), asset_type: aType, amount: aAmt });
  }
  
  // 4. 주식/투자 조회
  var invSheet = ss.getSheetByName('주식_투자');
  var invData = invSheet.getDataRange().getValues();
  var investmentsList = [];
  var invTotalCost = 0;
  var invTotalEval = 0;
  for (var v = 1; v < invData.length; v++) {
    var vRow = invData[v];
    if (!vRow[0]) continue;
    var shares = Number(vRow[3]) || 0;
    var avgP = Number(vRow[4]) || 0;
    var curP = Number(vRow[5]) || avgP;
    var tCost = Math.round(shares * avgP);
    var tEval = Math.round(shares * curP);
    var profit = tEval - tCost;
    var pRate = tCost > 0 ? (profit / tCost * 100).toFixed(2) : 0;
    invTotalCost += tCost;
    invTotalEval += tEval;
    investmentsList.push({
      id: vRow[0], name: String(vRow[1]), shares: shares, total_eval: tEval, profit: profit, profit_rate: Number(pRate)
    });
  }
  
  var grandAssets = totalAssets + invTotalEval;
  var netWorth = grandAssets - totalDebt;
  
  // 5. 🎯 장기 목표(Goals) 및 달성률 계산
  var goalSheet = ss.getSheetByName('장기_목표');
  var goalData = goalSheet ? goalSheet.getDataRange().getValues() : [];
  var goalsList = [];
  var now = new Date();
  
  for (var g = 1; g < goalData.length; g++) {
    var gRow = goalData[g];
    if (!gRow[0]) continue;
    var gTarget = Number(gRow[3]) || 10000000;
    var gCurrent = Number(gRow[4]) || 0;
    // 만약 현재 모은 금액이 0이면 순자산 기반으로 자동 매핑 옵션
    if (gCurrent === 0 && netWorth > 0) gCurrent = Math.min(gTarget, netWorth);
    
    var gDateStr = formatGASDate(gRow[5]);
    var gTargetDate = new Date(gDateStr);
    var diffTime = gTargetDate.getTime() - now.getTime();
    var dDay = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    var monthsRemaining = Math.max(1, Math.ceil(dDay / 30));
    var remainingAmount = Math.max(0, gTarget - gCurrent);
    var monthlyRequired = Math.round(remainingAmount / monthsRemaining);
    var pRate = gTarget > 0 ? Math.min(100, Math.round((gCurrent / gTarget) * 100)) : 0;
    
    goalsList.push({
      id: gRow[0],
      name: String(gRow[1]),
      category: String(gRow[2] || '시드머니'),
      target_amount: gTarget,
      current_amount: gCurrent,
      target_date: gDateStr,
      d_day: dDay,
      remaining_amount: remainingAmount,
      monthly_required: monthlyRequired,
      progress_rate: pRate,
      icon: String(gRow[6] || '🎯'),
      memo: String(gRow[7] || '')
    });
  }
  
  // 6. 📈 10년/20년 복리 스노우볼 시뮬레이션 계산
  // 가정: 현재 순자산 + 월 저축액(기본 100만원 또는 월 잉여자금) + 연 복리수익률 7%
  var monthlySaveEst = Math.max(500000, totalIncome - totalExpense > 0 ? (totalIncome - totalExpense) : 1000000);
  var compoundRates = [0.05, 0.08, 0.10]; // 5%, 8%, 10%
  var projection = {
    current_net_worth: netWorth,
    monthly_save: monthlySaveEst,
    year_3: Math.round(calculateCompound(netWorth, monthlySaveEst, 0.07, 3)),
    year_5: Math.round(calculateCompound(netWorth, monthlySaveEst, 0.07, 5)),
    year_10: Math.round(calculateCompound(netWorth, monthlySaveEst, 0.07, 10)),
    year_20: Math.round(calculateCompound(netWorth, monthlySaveEst, 0.07, 20))
  };
  
  // 7. 👑 자산 퀘스트 레벨 (Gamer Level System)
  var wealthLevel = 1;
  var levelTitle = "새싹 저축가 (LV.1)";
  var nextLevelTarget = 10000000;
  if (netWorth >= 1000000000) { wealthLevel = 10; levelTitle = "경제적 자유 마스터 (LV.10)"; nextLevelTarget = 2000000000; }
  else if (netWorth >= 500000000) { wealthLevel = 8; levelTitle = "자산 포트폴리오 거장 (LV.8)"; nextLevelTarget = 1000000000; }
  else if (netWorth >= 300000000) { wealthLevel = 6; levelTitle = "탄탄한 자산가 (LV.6)"; nextLevelTarget = 500000000; }
  else if (netWorth >= 100000000) { wealthLevel = 5; levelTitle = "1억 시드머니 달성가 (LV.5)"; nextLevelTarget = 300000000; }
  else if (netWorth >= 50000000) { wealthLevel = 4; levelTitle = "스노우볼 가속자 (LV.4)"; nextLevelTarget = 100000000; }
  else if (netWorth >= 30000000) { wealthLevel = 3; levelTitle = "종잣돈 빌더 (LV.3)"; nextLevelTarget = 50000000; }
  else if (netWorth >= 10000000) { wealthLevel = 2; levelTitle = "1천만원 시드 개척자 (LV.2)"; nextLevelTarget = 30000000; }
  
  var mindfulScore = totalExpense > 0 ? Math.max(0, 100 - Math.round(((byConsumptionType['낭비'] || 0) + (bySatisfaction['후회'] || 0)) / totalExpense * 100)) : 100;
  
  return {
    month: month,
    summary: {
      total_expense: totalExpense,
      total_income: totalIncome,
      balance: totalIncome - totalExpense,
      by_category: byCategory,
      by_consumption_type: byConsumptionType,
      by_satisfaction: bySatisfaction,
      mindful_score: mindfulScore
    },
    transactions: transactions,
    cards_summary: cardsSummary,
    net_worth: {
      net_worth: netWorth,
      total_assets: grandAssets,
      total_debt: totalDebt,
      assets_list: assetsList,
      investments_list: investmentsList,
      inv_total_eval: invTotalEval
    },
    goals: goalsList,
    level: {
      level: wealthLevel,
      title: levelTitle,
      next_target: nextLevelTarget,
      progress_to_next: Math.min(100, Math.round((netWorth / nextLevelTarget) * 100))
    },
    projection: projection
  };
}

function calculateCompound(principal, monthlyPayment, annualRate, years) {
  var r = annualRate / 12;
  var n = years * 12;
  var futureValue = principal * Math.pow(1 + r, n);
  futureValue += monthlyPayment * ((Math.pow(1 + r, n) - 1) / r);
  return futureValue;
}

// ==========================================
// 4. 구글 시트 테이블 초기화
// ==========================================

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function initSheets() {
  var ss = getSpreadsheet();
  
  var txSheet = ss.getSheetByName('가계부_내역');
  if (!txSheet) {
    txSheet = ss.insertSheet('가계부_내역');
    txSheet.appendRow(['ID', '날짜', '유형', '금액', '카테고리', '내용/사용처', '소비성격', '만족도', '결제수단', '카드명', '청구월', '대조완료', '할부', '등록일시']);
    txSheet.getRange(1, 1, 1, 14).setBackground('#2563EB').setFontColor('#FFFFFF').setFontWeight('bold');
    txSheet.setFrozenRows(1);
  }
  
  var cardSheet = ss.getSheetByName('카드값_대조');
  if (!cardSheet) {
    cardSheet = ss.insertSheet('카드값_대조');
    cardSheet.appendRow(['청구월', '카드명', '실제청구액', '기록합계', '차액', '상태', '메모', '갱신일시']);
    cardSheet.getRange(1, 1, 1, 8).setBackground('#0284C7').setFontColor('#FFFFFF').setFontWeight('bold');
    cardSheet.setFrozenRows(1);
  }
  
  var assetSheet = ss.getSheetByName('자산_원금');
  if (!assetSheet) {
    assetSheet = ss.insertSheet('자산_원금');
    assetSheet.appendRow(['ID', '자산명', '자산종류', '현재금액', '원금(시드)', '메모', '갱신일시']);
    assetSheet.getRange(1, 1, 1, 7).setBackground('#10B981').setFontColor('#FFFFFF').setFontWeight('bold');
    assetSheet.setFrozenRows(1);
    assetSheet.appendRow([1, '비상금 통장', '현금/예적금', 3000000, 3000000, '생활비 비상금', new Date().toISOString()]);
  }
  
  var invSheet = ss.getSheetByName('주식_투자');
  if (!invSheet) {
    invSheet = ss.insertSheet('주식_투자');
    invSheet.appendRow(['ID', '종목명', '시장', '보유수량', '평균매수가', '현재가', '배당률(%)', '목표가', '메모', '갱신일시']);
    invSheet.getRange(1, 1, 1, 10).setBackground('#8B5CF6').setFontColor('#FFFFFF').setFontWeight('bold');
    invSheet.setFrozenRows(1);
  }
  
  // 🎯 5. 장기_목표 시트
  var goalSheet = ss.getSheetByName('장기_목표');
  if (!goalSheet) {
    goalSheet = ss.insertSheet('장기_목표');
    goalSheet.appendRow(['ID', '목표명', '카테고리', '목표금액', '현재모은금액', '목표기한', '아이콘', '메모', '갱신일시']);
    goalSheet.getRange(1, 1, 1, 9).setBackground('#F59E0B').setFontColor('#FFFFFF').setFontWeight('bold');
    goalSheet.setFrozenRows(1);
    
    // 기본 장기 인생 마일스톤 기본값 생성
    goalSheet.appendRow([101, '1억 시드머니 모으기', '시드머니', 100000000, 3000000, '2028-12-31', '🌱', '투자의 기초 시드머니', new Date().toISOString()]);
    goalSheet.appendRow([102, '내 집 마련 / 청약 자금', '부동산/주거', 300000000, 0, '2031-12-31', '🏠', '안정적인 주거 환경', new Date().toISOString()]);
    goalSheet.appendRow([103, '경제적 자유 (파이어족)', '은퇴/자유', 1000000000, 0, '2036-12-31', '🏖️', '배당과 금융소득으로 은퇴', new Date().toISOString()]);
  }
}

// ==========================================
// 5. 목표(Goal) CRUD 함수
// ==========================================

function saveGoal(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('장기_목표');
  var id = data.id || new Date().getTime();
  var name = data.name || '새 장기 목표';
  var cat = data.category || '시드머니';
  var targetAmt = Number(data.target_amount) || 10000000;
  var currentAmt = Number(data.current_amount) || 0;
  var targetDate = data.target_date || '2030-12-31';
  var icon = data.icon || '🎯';
  var memo = data.memo || '';
  
  if (data.id) {
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        sheet.getRange(i + 1, 2, 1, 8).setValues([[name, cat, targetAmt, currentAmt, targetDate, icon, memo, new Date().toISOString()]]);
        return { success: true };
      }
    }
  }
  sheet.appendRow([id, name, cat, targetAmt, currentAmt, targetDate, icon, memo, new Date().toISOString()]);
  return { success: true, id: id };
}

function deleteGoal(id) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('장기_목표');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1); return { success: true };
    }
  }
  return { success: false };
}

function addTransaction(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('가계부_내역');
  var id = new Date().getTime();
  var dateStr = data.date || Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  var billingMonth = data.billing_month || dateStr.substring(0, 7);
  sheet.appendRow([
    id, dateStr, data.type || '지출', Number(data.amount) || 0,
    data.category || '기타', data.description || '', data.consumption_type || '선택',
    data.satisfaction || '보통', data.payment_method || '신용카드', data.card_name || '',
    billingMonth, 0, Number(data.installment) || 1, new Date().toISOString()
  ]);
  return { success: true, id: id };
}

function deleteTransaction(id) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('가계부_내역');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1); return { success: true };
    }
  }
  return { success: false };
}

function toggleReconcile(id) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('가계부_내역');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      var current = Number(data[i][11]) || 0;
      var nextVal = current === 1 ? 0 : 1;
      sheet.getRange(i + 1, 12).setValue(nextVal);
      return { success: true, is_reconciled: nextVal };
    }
  }
  return { success: false };
}

function reconcileCard(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('카드값_대조');
  var bMonth = data.billing_month;
  var cardName = data.card_name;
  var billedAmount = Number(data.billed_amount) || 0;
  
  var txSheet = ss.getSheetByName('가계부_내역');
  var txData = txSheet.getDataRange().getValues();
  var recorded = 0;
  for (var i = 1; i < txData.length; i++) {
    if (txData[i][2] === '지출' && formatGASDate(txData[i][10]).substring(0,7) === bMonth && String(txData[i][9]) === cardName) {
      recorded += Number(txData[i][3]) || 0;
    }
  }
  var diff = billedAmount - recorded;
  var status = diff === 0 ? '일치' : (diff > 0 ? '청구액 초과(누락주의)' : '기록 초과');
  
  var cData = sheet.getDataRange().getValues();
  var foundRow = -1;
  for (var k = 1; k < cData.length; k++) {
    if (formatGASDate(cData[k][0]).substring(0,7) === bMonth && String(cData[k][1]) === cardName) {
      foundRow = k + 1; break;
    }
  }
  if (foundRow > 0) {
    sheet.getRange(foundRow, 3, 1, 6).setValues([[billedAmount, recorded, diff, status, '', new Date().toISOString()]]);
  } else {
    sheet.appendRow([bMonth, cardName, billedAmount, recorded, diff, status, '', new Date().toISOString()]);
  }
  return { success: true, result: { difference: diff, status: status } };
}

function saveAsset(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('자산_원금');
  var id = data.id || new Date().getTime();
  var name = data.name;
  var type = data.asset_type || '현금/예적금';
  var amt = Number(data.amount) || 0;
  var initAmt = Number(data.initial_amount) || amt;
  var memo = data.memo || '';
  
  if (data.id) {
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        sheet.getRange(i + 1, 2, 1, 6).setValues([[name, type, amt, initAmt, memo, new Date().toISOString()]]);
        return { success: true };
      }
    }
  }
  sheet.appendRow([id, name, type, amt, initAmt, memo, new Date().toISOString()]);
  return { success: true, id: id };
}

function deleteAsset(id) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('자산_원금');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1); return { success: true };
    }
  }
  return { success: false };
}

function saveInvestment(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('주식_투자');
  var id = data.id || new Date().getTime();
  var name = data.name;
  var market = data.market || '국내주식';
  var shares = Number(data.shares) || 0;
  var avgP = Number(data.avg_price) || 0;
  var curP = Number(data.current_price) || avgP;
  var divR = Number(data.dividend_rate) || 0;
  var targetP = Number(data.target_price) || 0;
  var memo = data.memo || '';
  
  if (data.id) {
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        sheet.getRange(i + 1, 2, 1, 9).setValues([[name, market, shares, avgP, curP, divR, targetP, memo, new Date().toISOString()]]);
        return { success: true };
      }
    }
  }
  sheet.appendRow([id, name, market, shares, avgP, curP, divR, targetP, memo, new Date().toISOString()]);
  return { success: true, id: id };
}

function deleteInvestment(id) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('주식_투자');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1); return { success: true };
    }
  }
  return { success: false };
}

function parseSmsAndSave(text, rawData) {
  if (!text) return { success: false, error: 'Empty text' };
  var amount = 0;
  var amtMatch = text.match(/([0-9,]+)\s*원/i) || text.match(/(?:KRW|₩)\s*([0-9,]+)/i) || text.match(/\b([0-9]{1,3}(?:,[0-9]{3})+)\b/);
  if (amtMatch) amount = parseInt(amtMatch[1].replace(/,/g, ''), 10);
  if (!amount && rawData.amount) amount = Number(rawData.amount);
  
  var cardName = '현대카드';
  if (text.indexOf('신한') >= 0) cardName = '신한카드';
  else if (text.indexOf('삼성') >= 0) cardName = '삼성카드';
  else if (text.indexOf('국민') >= 0 || text.indexOf('KB') >= 0) cardName = 'KB국민카드';
  else if (text.indexOf('롯데') >= 0) cardName = '롯데카드';
  else if (text.indexOf('우리') >= 0) cardName = '우리카드';
  else if (text.indexOf('하나') >= 0) cardName = '하나카드';
  else if (text.indexOf('농협') >= 0 || text.indexOf('NH') >= 0) cardName = 'NH농협카드';
  if (rawData.card_name) cardName = rawData.card_name;
  
  var category = '식비';
  var desc = '카드 결제';
  if (text.indexOf('스타벅스') >= 0 || text.indexOf('커피') >= 0 || text.indexOf('카페') >= 0) {
    category = '카페'; desc = '카페/음료';
  } else if (text.indexOf('식당') >= 0 || text.indexOf('배민') >= 0 || text.indexOf('배달의민족') >= 0) {
    category = '식비'; desc = '외식/식비';
  } else if (text.indexOf('주유') >= 0 || text.indexOf('택시') >= 0 || text.indexOf('교통') >= 0) {
    category = '교통'; desc = '교통비';
  } else if (text.indexOf('쿠팡') >= 0 || text.indexOf('마트') >= 0 || text.indexOf('쇼핑') >= 0) {
    category = '쇼핑'; desc = '쇼핑';
  }
  
  var today = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  var txData = {
    date: rawData.date || today,
    type: '지출',
    amount: amount || 10000,
    category: rawData.category || category,
    description: rawData.description || desc,
    consumption_type: (category === '식비' || category === '교통') ? '필수' : '선택',
    satisfaction: '보통',
    payment_method: '신용카드',
    card_name: cardName,
    billing_month: today.substring(0, 7),
    installment: 1
  };
  
  var saveRes = addTransaction(txData);
  return { success: true, message: '웹훅 파싱 완료', parsed: txData, id: saveRes.id };
}
