/**
 * 💰 스마트 머니 허브 - Google Apps Script Backend (수동 입력 행 & 날짜 완벽 지원)
 */

function doGet(e) {
  initSheets();
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
  
  if (action) {
    return ContentService.createTextOutput(JSON.stringify(getAllData(e.parameter.month)))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  var template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle('스마트 머니 허브')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    var data = {};
    if (e.postData && e.postData.contents) {
      try { data = JSON.parse(e.postData.contents); } catch(err) { data = { text: e.postData.contents }; }
    } else if (e.parameter) { data = e.parameter; }
    
    var action = data.action || (e.parameter ? e.parameter.action : '');
    if (!action && (data.text || data.sms || data.message || data.body)) action = 'parseSmsWebhook';
    var result = handleApiPost(action, data);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function handleApiPost(action, data) {
  initSheets();
  if (action === 'getAllData') return getAllData(data.month);
  if (action === 'parseSmsWebhook') return parseSmsAndSave(data.text, data);
  if (action === 'addTransaction') return addTransaction(data);
  if (action === 'reconcileCard') return reconcileCard(data);
  if (action === 'saveGoal') return saveGoal(data);
  if (action === 'saveAsset') return saveAsset(data);
  if (action === 'saveInvestment') return saveInvestment(data);
  return { success: false, error: 'Unknown action: ' + action };
}

function formatGASDate(val) {
  if (!val) return Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'GMT+9', 'yyyy-MM-dd');
  }
  var s = String(val).trim();
  var m = s.match(/(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/);
  if (m) {
    var y = m[1];
    var mm = m[2].length === 1 ? '0' + m[2] : m[2];
    var dd = m[3].length === 1 ? '0' + m[3] : m[3];
    return y + '-' + mm + '-' + dd;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return s;
}

function getAllData(month) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  initSheets();
  if (!month) month = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM');
  
  var txSheet = ss.getSheetByName('가계부_내역');
  var txData = txSheet.getDataRange().getValues();
  var allTransactions = [];
  var transactions = [];
  var totalExpense = 0, totalIncome = 0;
  var byCategory = {}, byConsumptionType = { '필수': 0, '선택': 0, '낭비': 0 }, bySatisfaction = { '만족': 0, '보통': 0, '후회': 0 };
  var cardSpentMap = {};
  
  for (var i = 1; i < txData.length; i++) {
    var row = txData[i];
    // ID가 없어도 날짜나 금액 또는 내용이 있으면 유효한 데이터로 인식!
    if (!row[0] && !row[1] && !row[3] && !row[5]) continue;
    
    var id = row[0] || (i + '_' + new Date().getTime());
    var txDate = formatGASDate(row[1]);
    var txMonth = txDate.substring(0, 7);
    var billingMonth = row[10] ? formatGASDate(row[10]).substring(0, 7) : txMonth;
    var type = String(row[2] || '지출').trim();
    if (!type || type === '') type = '지출';
    var amount = Number(String(row[3]).replace(/[^0-9.-]/g, '')) || 0;
    var cat = String(row[4] || '기타').trim();
    var desc = String(row[5] || '').trim();
    var cType = String(row[6] || '선택').trim();
    var sat = String(row[7] || '보통').trim();
    var payMethod = String(row[8] || '신용카드').trim();
    var cardName = String(row[9] || '').trim();
    var isReconciled = Number(row[11]) || 0;
    
    var item = {
      id: id,
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
      is_reconciled: isReconciled
    };
    
    allTransactions.unshift(item);
    
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
      if (!cardSpentMap[billingMonth][cKey]) cardSpentMap[billingMonth][cKey] = { total: 0, count: 0, reconciled: 0 };
      cardSpentMap[billingMonth][cKey].total += amount;
      cardSpentMap[billingMonth][cKey].count += 1;
      if (isReconciled === 1) cardSpentMap[billingMonth][cKey].reconciled += 1;
    }
  }
  
  // 이번 달 내역이 없으면 전체 최신 내역을 보여줌
  var displayTransactions = transactions.length > 0 ? transactions : allTransactions.slice(0, 20);
  
  // 2. 카드값 대조 조회
  var cardSheet = ss.getSheetByName('카드값_대조');
  var cardData = cardSheet.getDataRange().getValues();
  var cardStatements = {};
  for (var k = 1; k < cardData.length; k++) {
    var crow = cardData[k];
    if (formatGASDate(crow[0]).substring(0, 7) === month) {
      cardStatements[String(crow[1])] = { billed: Number(crow[2]) || 0, recorded: Number(crow[3]) || 0, diff: Number(crow[4]) || 0, status: String(crow[5] || '') };
    }
  }
  
  var cardsSummary = [];
  var curMonthCards = cardSpentMap[month] || {};
  for (var cName in curMonthCards) {
    var info = curMonthCards[cName];
    var stmt = cardStatements[cName] || {};
    var billed = stmt.billed || 0;
    var diff = billed > 0 ? (billed - info.total) : 0;
    cardsSummary.push({ card_name: cName, spent_amount: info.total, billed_amount: billed, difference: diff, status: stmt.status || (info.count === info.reconciled && info.count > 0 ? '대조완료' : '미대조'), count: info.count });
  }
  
  // 3. 자산 & 주식 조회
  var assetSheet = ss.getSheetByName('자산_원금');
  var assetData = assetSheet.getDataRange().getValues();
  var assetsList = [], totalAssets = 0, totalDebt = 0;
  for (var a = 1; a < assetData.length; a++) {
    var aRow = assetData[a];
    if (!aRow[0] && !aRow[1]) continue;
    var aAmt = Number(String(aRow[3]).replace(/[^0-9.-]/g, '')) || 0;
    var aType = String(aRow[2] || '현금/예적금');
    if (aType === '부채/대출') totalDebt += aAmt; else totalAssets += aAmt;
    assetsList.push({ id: aRow[0] || a, name: String(aRow[1]), asset_type: aType, amount: aAmt });
  }
  
  var invSheet = ss.getSheetByName('주식_투자');
  var invData = invSheet.getDataRange().getValues();
  var investmentsList = [], invTotalCost = 0, invTotalEval = 0;
  for (var v = 1; v < invData.length; v++) {
    var vRow = invData[v];
    if (!vRow[0] && !vRow[1]) continue;
    var shares = Number(vRow[3]) || 0, avgP = Number(vRow[4]) || 0, curP = Number(vRow[5]) || avgP;
    var tCost = Math.round(shares * avgP), tEval = Math.round(shares * curP);
    invTotalCost += tCost; invTotalEval += tEval;
    investmentsList.push({ id: vRow[0] || v, name: String(vRow[1]), shares: shares, total_eval: tEval, profit: tEval - tCost, profit_rate: tCost > 0 ? ((tEval - tCost)/tCost*100).toFixed(2) : 0 });
  }
  
  var grandAssets = totalAssets + invTotalEval;
  var netWorth = grandAssets - totalDebt;
  
  // 4. 장기 목표 조회
  var goalSheet = ss.getSheetByName('장기_목표');
  var goalData = goalSheet ? goalSheet.getDataRange().getValues() : [];
  var goalsList = [];
  var now = new Date();
  for (var g = 1; g < goalData.length; g++) {
    var gRow = goalData[g];
    if (!gRow[0] && !gRow[1]) continue;
    var gTarget = Number(gRow[3]) || 100000000;
    var gCurrent = Number(gRow[4]) || 0;
    if (gCurrent === 0 && netWorth > 0) gCurrent = Math.min(gTarget, netWorth);
    var gDateStr = formatGASDate(gRow[5]);
    var diffTime = new Date(gDateStr).getTime() - now.getTime();
    var dDay = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    var monthsRemaining = Math.max(1, Math.ceil(dDay / 30));
    var remainingAmt = Math.max(0, gTarget - gCurrent);
    goalsList.push({ id: gRow[0] || g, name: String(gRow[1]), category: String(gRow[2] || '시드'), target_amount: gTarget, current_amount: gCurrent, target_date: gDateStr, d_day: dDay, remaining_amount: remainingAmt, monthly_required: Math.round(remainingAmt / monthsRemaining), progress_rate: gTarget > 0 ? Math.min(100, Math.round(gCurrent/gTarget*100)) : 0, icon: String(gRow[6] || '🌱') });
  }
  
  var wealthLevel = 1, levelTitle = "새싹 저축가 (LV.1)", nextTarget = 10000000;
  if (netWorth >= 1000000000) { wealthLevel = 10; levelTitle = "경제적 자유 마스터 (LV.10)"; nextTarget = 2000000000; }
  else if (netWorth >= 100000000) { wealthLevel = 5; levelTitle = "1억 시드머니 달성가 (LV.5)"; nextTarget = 300000000; }
  else if (netWorth >= 30000000) { wealthLevel = 3; levelTitle = "종잣돈 빌더 (LV.3)"; nextTarget = 50000000; }
  else if (netWorth >= 10000000) { wealthLevel = 2; levelTitle = "1천만원 시드 개척자 (LV.2)"; nextTarget = 30000000; }
  
  return {
    month: month,
    summary: { total_expense: totalExpense, total_income: totalIncome, balance: totalIncome - totalExpense, by_category: byCategory, by_consumption_type: byConsumptionType, mindful_score: totalExpense > 0 ? Math.max(0, 100 - Math.round(((byConsumptionType['낭비'] || 0) + (bySatisfaction['후회'] || 0)) / totalExpense * 100)) : 100 },
    transactions: displayTransactions,
    cards_summary: cardsSummary,
    net_worth: { net_worth: netWorth, total_assets: grandAssets, total_debt: totalDebt, assets_list: assetsList, investments_list: investmentsList, inv_total_eval: invTotalEval },
    goals: goalsList,
    level: { level: wealthLevel, title: levelTitle, next_target: nextTarget, progress_to_next: Math.min(100, Math.round(netWorth/nextTarget*100)) }
  };
}

function initSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName('가계부_내역')) {
    var s = ss.insertSheet('가계부_내역');
    s.appendRow(['ID', '날짜', '유형', '금액', '카테고리', '내용/사용처', '소비성격', '만족도', '결제수단', '카드명', '청구월', '대조완료', '할부', '등록일시']);
    s.getRange(1, 1, 1, 14).setBackground('#2563EB').setFontColor('#FFFFFF').setFontWeight('bold');
  }
  if (!ss.getSheetByName('카드값_대조')) {
    var s2 = ss.insertSheet('카드값_대조');
    s2.appendRow(['청구월', '카드명', '실제청구액', '기록합계', '차액', '상태', '메모', '갱신일시']);
    s2.getRange(1, 1, 1, 8).setBackground('#0284C7').setFontColor('#FFFFFF').setFontWeight('bold');
  }
  if (!ss.getSheetByName('자산_원금')) {
    var s3 = ss.insertSheet('자산_원금');
    s3.appendRow(['ID', '자산명', '자산종류', '현재금액', '원금(시드)', '메모', '갱신일시']);
    s3.getRange(1, 1, 1, 7).setBackground('#10B981').setFontColor('#FFFFFF').setFontWeight('bold');
    s3.appendRow([1, '비상금 통장', '현금/예적금', 3000000, 3000000, '생활비 비상금', new Date().toISOString()]);
  }
  if (!ss.getSheetByName('주식_투자')) {
    var s4 = ss.insertSheet('주식_투자');
    s4.appendRow(['ID', '종목명', '시장', '보유수량', '평균매수가', '현재가', '배당률(%)', '목표가', '메모', '갱신일시']);
    s4.getRange(1, 1, 1, 10).setBackground('#8B5CF6').setFontColor('#FFFFFF').setFontWeight('bold');
  }
  if (!ss.getSheetByName('장기_목표')) {
    var s5 = ss.insertSheet('장기_목표');
    s5.appendRow(['ID', '목표명', '카테고리', '목표금액', '현재모은금액', '목표기한', '아이콘', '메모', '갱신일시']);
    s5.getRange(1, 1, 1, 9).setBackground('#F59E0B').setFontColor('#FFFFFF').setFontWeight('bold');
    s5.appendRow([101, '1억 시드머니 모으기', '시드머니', 100000000, 3000000, '2028-12-31', '🌱', '투자의 기초 시드머니', new Date().toISOString()]);
    s5.appendRow([102, '내 집 마련 / 청약 자금', '부동산/주거', 300000000, 0, '2031-12-31', '🏠', '안정적인 주거 환경', new Date().toISOString()]);
    s5.appendRow([103, '경제적 자유 (파이어족)', '은퇴/자유', 1000000000, 0, '2036-12-31', '🏖️', '배당과 금융소득 은퇴', new Date().toISOString()]);
  }
}

function addTransaction(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('가계부_내역');
  var id = new Date().getTime();
  var dateStr = data.date || Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  sheet.appendRow([id, dateStr, data.type || '지출', Number(data.amount) || 0, data.category || '기타', data.description || '', data.consumption_type || '선택', data.satisfaction || '보통', data.payment_method || '신용카드', data.card_name || '', data.billing_month || dateStr.substring(0, 7), 0, 1, new Date().toISOString()]);
  return { success: true, id: id };
}

function saveGoal(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('장기_목표');
  var id = data.id || new Date().getTime();
  sheet.appendRow([id, data.name || '새 목표', data.category || '인생목표', Number(data.target_amount) || 100000000, 0, data.target_date || '2030-12-31', data.icon || '🌱', data.memo || '', new Date().toISOString()]);
  return { success: true };
}

function reconcileCard(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('카드값_대조');
  sheet.appendRow([data.billing_month, data.card_name, Number(data.billed_amount) || 0, 0, 0, '대조완료', '', new Date().toISOString()]);
  return { success: true };
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
