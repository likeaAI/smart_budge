/**
 * 💰 스마트 머니 허브 - Google Apps Script Backend (단일 doPost Web/Telegram 통합 라우팅)
 */

// ⚙️ 텔레그램 봇 및 Gemini AI 설정 (스크립트 속성 또는 기본값)
function getTelegramToken() {
  return PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || '';
}

function getGeminiApiKey() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
}

function doGet(e) {
  initSheets();
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
  
  // 🔗 텔레그램 웹훅 1클릭 등록 편의 기능: ?action=setTelegramWebhook&token=YOUR_BOT_TOKEN
  if (action === 'setTelegramWebhook') {
    var token = (e && e.parameter && e.parameter.token) ? e.parameter.token : getTelegramToken();
    var webAppUrl = (e && e.parameter && e.parameter.url) ? e.parameter.url : ScriptApp.getService().getUrl();
    if (!token) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: '봇 토큰(token) 파라미터가 필요합니다.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    PropertiesService.getScriptProperties().setProperty('TELEGRAM_BOT_TOKEN', token);
    var res = setTelegramWebhook(token, webAppUrl);
    return ContentService.createTextOutput(JSON.stringify({ success: true, result: res, webhookUrl: webAppUrl }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // 🤖 텔레그램 웹훅 해제 기능: ?action=deleteTelegramWebhook
  if (action === 'deleteTelegramWebhook') {
    var token = (e && e.parameter && e.parameter.token) ? e.parameter.token : getTelegramToken();
    var res = deleteTelegramWebhook(token);
    return ContentService.createTextOutput(JSON.stringify({ success: true, result: res }))
      .setMimeType(ContentService.MimeType.JSON);
  }

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
    
    // 1️⃣ 텔레그램 웹훅 요청 판별 (message 또는 callback_query 수신 시)
    if (data.message || data.callback_query) {
      return handleTelegramUpdate(data);
    }

    // 2️⃣ 웹 UI(기존 프론트엔드) API 요청 판별 (action 수신 시)
    var action = data.action || (e.parameter ? e.parameter.action : '');
    if (!action && (data.text || data.sms || data.body)) action = 'parseSmsWebhook';
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
  if (action === 'deleteAsset') return deleteAsset(data);
  if (action === 'clearAssets') return clearAssets();
  if (action === 'saveInvestment') return saveInvestment(data);
  if (action === 'deleteInvestment') return deleteInvestment(data);
  if (action === 'clearInvestments') return clearInvestments();
  if (action === 'saveRecurring') return saveRecurring(data);
  if (action === 'deleteRecurring') return deleteRecurring(data);
  if (action === 'clearRecurring') return clearRecurring();
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
    level: { level: wealthLevel, title: levelTitle, next_target: nextTarget, progress_to_next: Math.min(100, Math.round(netWorth/nextTarget*100)) },
    recurring_plans: getRecurringPlansList()
  };
}

function getRecurringPlansList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('정기_일정');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var list = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0] && !r[3]) continue;
    list.push({
      id: String(r[0] || ('rec_' + i)),
      day: Number(r[1]) || 1,
      type: String(r[2] || '지출'),
      name: String(r[3] || ''),
      amount: Number(r[4]) || 0,
      category: String(r[5] || '기타'),
      pay_method: String(r[6] || '현금/계좌')
    });
  }
  return list;
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
    s3.appendRow([1, '비상금 통장', '현금/예적금', 30000000, 30000000, '생활비 비상금', new Date().toISOString()]);
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
  if (!ss.getSheetByName('정기_일정')) {
    var s6 = ss.insertSheet('정기_일정');
    s6.appendRow(['ID', '지정일', '유형', '항목명', '금액', '카테고리', '결제수단', '갱신일시']);
    s6.getRange(1, 1, 1, 8).setBackground('#6366F1').setFontColor('#FFFFFF').setFontWeight('bold');
    s6.appendRow(['rec_salary', 10, '수입', '정기 월급여', 3500000, '급여/월급', '현금/계좌', new Date().toISOString()]);
    s6.appendRow(['rec_rent', 25, '지출', '아파트 관리비/공과금', 250000, '생활', '현대카드', new Date().toISOString()]);
    s6.appendRow(['rec_sub', 14, '지출', '넷플릭스/유튜브 프리미엄', 17000, '구독', '신한카드', new Date().toISOString()]);
  }
}

function addTransaction(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('가계부_내역');
  var id = new Date().getTime();
  var dateStr = data.date || Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  var timeStr = (data.time || '').trim();
  var fullDateStr = (timeStr && dateStr.indexOf(' ') < 0) ? (dateStr + ' ' + timeStr) : dateStr;
  sheet.appendRow([id, fullDateStr, data.type || '지출', Number(data.amount) || 0, data.category || '기타', data.description || '', data.consumption_type || '선택', data.satisfaction || '보통', data.payment_method || '신용카드', data.card_name || '', data.billing_month || dateStr.substring(0, 7), 0, 1, new Date().toISOString()]);
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

// 🏦 자산 관리
function saveAsset(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('자산_원금');
  if (!sheet) return { success: false };
  var values = sheet.getDataRange().getValues();
  var id = String(data.id || ('asset_' + new Date().getTime()));
  var updated = false;

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === id || String(values[i][1]) === String(data.name)) {
      sheet.getRange(i + 1, 1, 1, 7).setValues([[id, data.name, data.category || '현금/예적금', Number(data.amount) || 0, Number(data.amount) || 0, data.memo || '', new Date().toISOString()]]);
      updated = true;
      break;
    }
  }
  if (!updated) {
    sheet.appendRow([id, data.name, data.category || '현금/예적금', Number(data.amount) || 0, Number(data.amount) || 0, data.memo || '', new Date().toISOString()]);
  }
  return { success: true, id: id };
}

function deleteAsset(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('자산_원금');
  if (!sheet) return { success: false };
  var values = sheet.getDataRange().getValues();
  var targetId = String(data.id);
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === targetId || String(values[i][1]) === String(data.name)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Not found' };
}

function clearAssets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('자산_원금');
  if (!sheet) return { success: false };
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  return { success: true };
}

// 📈 주식 / 투자 관리
function saveInvestment(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('주식_투자');
  if (!sheet) return { success: false };
  var values = sheet.getDataRange().getValues();
  var id = String(data.id || ('inv_' + new Date().getTime()));
  var updated = false;

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === id || String(values[i][1]) === String(data.name)) {
      sheet.getRange(i + 1, 1, 1, 10).setValues([[id, data.name, data.market || '국내주식', Number(data.shares) || 0, Number(data.avg_buy_price) || 0, Number(data.current_price) || 0, Number(data.div_yield) || 0, Number(data.target_price) || 0, data.memo || '', new Date().toISOString()]]);
      updated = true;
      break;
    }
  }
  if (!updated) {
    sheet.appendRow([id, data.name, data.market || '국내주식', Number(data.shares) || 0, Number(data.avg_buy_price) || 0, Number(data.current_price) || 0, Number(data.div_yield) || 0, Number(data.target_price) || 0, data.memo || '', new Date().toISOString()]);
  }
  return { success: true, id: id };
}

function deleteInvestment(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('주식_투자');
  if (!sheet) return { success: false };
  var values = sheet.getDataRange().getValues();
  var targetId = String(data.id);
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === targetId || String(values[i][1]) === String(data.name)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Not found' };
}

function clearInvestments() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('주식_투자');
  if (!sheet) return { success: false };
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  return { success: true };
}

// 🗓️ 정기 일정 관리
function saveRecurring(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('정기_일정');
  if (!sheet) return { success: false };
  var values = sheet.getDataRange().getValues();
  var id = String(data.id || ('rec_' + new Date().getTime()));
  var updated = false;

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === id || String(values[i][3]) === String(data.name)) {
      sheet.getRange(i + 1, 1, 1, 8).setValues([[id, Number(data.day) || 1, data.type || '지출', data.name, Number(data.amount) || 0, data.category || '기타', data.pay_method || '현금/계좌', new Date().toISOString()]]);
      updated = true;
      break;
    }
  }
  if (!updated) {
    sheet.appendRow([id, Number(data.day) || 1, data.type || '지출', data.name, Number(data.amount) || 0, data.category || '기타', data.pay_method || '현금/계좌', new Date().toISOString()]);
  }
  return { success: true, id: id };
}

function deleteRecurring(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('정기_일정');
  if (!sheet) return { success: false };
  var values = sheet.getDataRange().getValues();
  var targetId = String(data.id);
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === targetId || String(values[i][3]) === String(data.name)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Not found' };
}

function clearRecurring() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('정기_일정');
  if (!sheet) return { success: false };
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  return { success: true };
}

// ============================================================================
// 🤖 텔레그램 봇 & AI 금융 비서 브리핑 통합 엔진
// ============================================================================

/**
 * 텔레그램 웹훅 업데이트 메인 라우터
 */
function handleTelegramUpdate(data) {
  try {
    if (data.message) {
      var msg = data.message;
      var chatId = msg.chat.id;
      var text = (msg.text || '').trim();

      if (!text) {
        return ContentService.createTextOutput("OK");
      }

      // 1. 슬래시 명령어 또는 바로가기 키보드 텍스트 처리
      if (text.indexOf('/') === 0 || text === '📊 금융 브리핑' || text === '🗓️ 정기일정' || text === '🏦 자산 현황' || text === '💸 지출 입력') {
        handleTelegramCommand(chatId, text, msg);
      } else {
        // 2. 비정형 자연어 및 결제 SMS (Gemini AI 파싱 + 되묻기 인터랙션)
        handleTelegramNaturalText(chatId, text, msg);
      }
    } else if (data.callback_query) {
      // 3. 인라인 버튼 클릭 (되묻기 확인 / 카테고리 변경 / 삭제 등)
      handleTelegramCallback(data.callback_query);
    }
  } catch (err) {
    Logger.log("Telegram update error: " + err.toString());
  }
  return ContentService.createTextOutput("OK");
}

/**
 * 텔레그램 CMD 명령어 처리기
 */
function handleTelegramCommand(chatId, text, msg) {
  var parts = text.split(/\s+/);
  var cmd = parts[0].toLowerCase();

  // 바로가기 키보드 매핑
  if (text === '📊 금융 브리핑') cmd = '/브리핑';
  if (text === '💸 지출 입력') {
    sendTelegramMessage(chatId, "💸 <b>지출 입력 안내</b>\n\n명령어 예시:\n<code>/지출 15000 점심식사 식비 카드</code>\n\n또는 자연어로 편하게 말씀해주세요!\n예: <i>오늘 점심 순대국 9000원 카드로 결제</i>");
    return;
  }
  if (text === '🗓️ 정기일정') {
    sendTelegramRecurringPlans(chatId);
    return;
  }
  if (text === '🏦 자산 현황') {
    sendTelegramAssets(chatId);
    return;
  }

  // /start, /help, /도움말
  if (cmd === '/start' || cmd === '/help' || cmd === '/도움말') {
    var helpText = "👑 <b>스마트 머니 허브 - 텔레그램 AI 금융 비서</b>\n\n"
      + "가계부 웹 대시보드와 실시간 양방향으로 연동되는 개인 금융 비서입니다.\n\n"
      + "🌟 <b>기본 사용법 (자연어 & 결제문자 자동인식):</b>\n"
      + "명령어를 굳이 외우실 필요 없습니다! 그냥 평소 말하듯 편하게 보내시면 AI가 지출/수입/자산을 스스로 알아듣고 되물어봅니다.\n\n"
      + "• <i>\"오늘 점심 12000원 신한카드로 먹음\"</i> ➡️ 💸 <b>지출 자동인식</b>\n"
      + "• <i>\"월급 350만 들어옴\"</i> ➡️ 💰 <b>수입 자동인식</b>\n"
      + "• <i>\"청약통장에 10만원 넣음\"</i> ➡️ 🏦 <b>자산 자동인식</b>\n"
      + "• <i>\"오늘 얼마 썼지?\"</i> 또는 <i>\"이번달 현황\"</i> ➡️ 📊 <b>실시간 브리핑</b>\n"
      + "• 카드사 결제 문자 전체 복사 붙여넣기 ➡️ ⚡ <b>즉시 자동 파싱</b>\n\n"
      + "⌨️ <b>수동 강제 지정 (CMD 명령어):</b>\n"
      + "<i>(※ AI가 헷갈릴 것 같을 때 정확하게 강제로 지정하는 명령어입니다)</i>\n"
      + "• <code>/지출 [금액] [내용] [카테고리] [수단]</code>\n"
      + "  예: <code>/지출 15000 점심식사 식비 신한카드</code>\n"
      + "• <code>/수입 [금액] [내용]</code>\n"
      + "  예: <code>/수입 3500000 9월급여</code>\n"
      + "• <code>/자산 [금액] [자산명] [카테고리]</code>\n"
      + "  예: <code>/자산 50000000 청약예금</code>\n"
      + "• <code>/브리핑</code> : 일일/월간 금융 종합 리포트\n"
      + "• <code>/최근</code> : 최근 기록 5건 확인 및 삭제";

    var replyKeyboard = {
      keyboard: [
        [{ text: "📊 금융 브리핑" }, { text: "💸 지출 입력" }],
        [{ text: "🗓️ 정기일정" }, { text: "🏦 자산 현황" }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };

    sendTelegramMessage(chatId, helpText, replyKeyboard);
    return;
  }

  // /지출, /ㅈ
  if (cmd === '/지출' || cmd === '/ㅈ') {
    if (parts.length < 3) {
      sendTelegramMessage(chatId, "⚠️ <b>입력 형식 안내:</b>\n<code>/지출 [금액] [내용] [카테고리(선택)] [결제수단(선택)]</code>\n예: <code>/지출 15000 점심식사 식비 신한카드</code>");
      return;
    }
    var amount = parseInt(parts[1].replace(/[^0-9]/g, ''), 10);
    var desc = parts[2];
    var cat = parts[3] || guessCategoryFromText(desc);
    var method = parts[4] || '신용카드';

    var candidate = {
      type: '지출',
      amount: amount,
      description: desc,
      category: cat,
      payment_method: method.indexOf('카드') >= 0 ? '신용카드' : '현금',
      card_name: method.indexOf('카드') >= 0 ? method : '',
      date: Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd')
    };

    sendInteractiveConfirm(chatId, candidate);
    return;
  }

  // /수입, /ㅅ
  if (cmd === '/수입' || cmd === '/ㅅ') {
    if (parts.length < 3) {
      sendTelegramMessage(chatId, "⚠️ <b>입력 형식 안내:</b>\n<code>/수입 [금액] [내용]</code>\n예: <code>/수입 3500000 9월급여</code>");
      return;
    }
    var amount = parseInt(parts[1].replace(/[^0-9]/g, ''), 10);
    var desc = parts[2];

    var candidate = {
      type: '수입',
      amount: amount,
      description: desc,
      category: '급여/월급',
      payment_method: '현금',
      card_name: '',
      date: Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd')
    };

    sendInteractiveConfirm(chatId, candidate);
    return;
  }

  // /자산
  if (cmd === '/자산') {
    if (parts.length < 3) {
      sendTelegramMessage(chatId, "⚠️ <b>입력 형식 안내:</b>\n<code>/자산 [금액] [자산명] [카테고리(선택)]</code>\n예: <code>/자산 50000000 청약예금 현금/예적금</code>");
      return;
    }
    var amount = parseInt(parts[1].replace(/[^0-9]/g, ''), 10);
    var name = parts[2];
    var cat = parts[3] || '현금/예적금';
    var res = saveAsset({ name: name, category: cat, amount: amount });
    if (res.success) {
      sendTelegramMessage(chatId, "✅ <b>자산 등록 완료!</b>\n\n• 자산명: " + name + "\n• 금액: " + amount.toLocaleString() + "원 (" + cat + ")\n\n웹 대시보드 순자산에 실시간 반영되었습니다.");
    } else {
      sendTelegramMessage(chatId, "❌ 자산 등록에 실패했습니다.");
    }
    return;
  }

  // /브리핑, /요약, /현황
  if (cmd === '/브리핑' || cmd === '/요약' || cmd === '/현황') {
    sendTelegramBriefing(chatId);
    return;
  }

  // /최근
  if (cmd === '/최근') {
    sendTelegramRecentTransactions(chatId);
    return;
  }

  // 알 수 없는 명령어
  sendTelegramMessage(chatId, "❓ 알 수 없는 명령어입니다. <code>/도움말</code> 을 입력하여 명령어 목록을 확인하세요.");
}

/**
 * 비정형 자연어 및 결제 SMS 처리 (Gemini AI 파싱 + 되묻기 인터랙션)
 */
function handleTelegramNaturalText(chatId, text, msg) {
  sendTelegramMessage(chatId, "🤖 <i>내용 분석 중입니다...</i>");

  // Gemini AI 또는 룰 기반 파싱 실행
  var candidate = askGeminiFinance(text);

  // 1. 브리핑 요청 질문인 경우 (예: "오늘 얼마 썼지?", "이번달 현황", "브리핑해줘")
  if (candidate && candidate.action_type === 'briefing') {
    sendTelegramBriefing(chatId);
    return;
  }

  // 2. 자산 등록인 경우 (예: "청약통장에 10만원 넣음", "적금 50만원 추가")
  if (candidate && candidate.action_type === 'asset' && candidate.amount > 0) {
    sendInteractiveAssetConfirm(chatId, candidate);
    return;
  }

  // 3. 지출/수입 등록인 경우
  if (!candidate || !candidate.amount || candidate.amount <= 0) {
    sendTelegramMessage(chatId, "⚠️ 금액이나 지출/수입 내역을 명확하게 파악하지 못했습니다.\n\n"
      + "💡 <b>자연어 입력 예시:</b>\n"
      + "• <i>\"점심 12000원 신한카드로 먹음\"</i>\n"
      + "• <i>\"월급 350만 들어옴\"</i>\n"
      + "• <i>\"청약통장에 10만원 넣음\"</i>\n\n"
      + "<i>(※ AI가 헷갈릴 때는 <code>/지출 12000 점심</code> 또는 <code>/수입 3500000 월급</code> 명령어로 강제 지정할 수도 있습니다.)</i>");
    return;
  }

  sendInteractiveConfirm(chatId, candidate);
}

/**
 * 자산 등록 대화형 되묻기 전송
 */
function sendInteractiveAssetConfirm(chatId, candidate) {
  var cache = CacheService.getScriptCache();
  var cacheKey = "tg_asset_" + chatId + "_" + new Date().getTime();
  cache.put(cacheKey, JSON.stringify(candidate), 600);

  var msgText = "🤖 <b>자산 반영 내용을 확인해주세요:</b>\n\n"
    + "• <b>구분:</b> 🏦 보유 자산 반영\n"
    + "• <b>자산명:</b> " + candidate.description + "\n"
    + "• <b>금액:</b> <b>" + Number(candidate.amount).toLocaleString() + "원</b>\n"
    + "• <b>분류:</b> " + (candidate.category || '현금/예적금') + "\n\n"
    + "위 자산을 가계부 순자산에 등록할까요?";

  var inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "💾 네, 자산에 반영할게요", callback_data: "CONFIRM_ASSET:" + cacheKey },
        { text: "❌ 취소", callback_data: "CANCEL:" + cacheKey }
      ]
    ]
  };

  sendTelegramMessage(chatId, msgText, inlineKeyboard);
}

/**
 * 대화형 되묻기 (Inline Keyboard Confirm) 전송
 */
function sendInteractiveConfirm(chatId, candidate) {
  var cache = CacheService.getScriptCache();
  var cacheKey = "tg_tx_" + chatId + "_" + new Date().getTime();
  cache.put(cacheKey, JSON.stringify(candidate), 600); // 10분간 유효

  var typeEmoji = candidate.type === '수입' ? '💰' : '💸';
  var dateStr = candidate.date || Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  var dateDisplay = candidate.time ? (dateStr + " (" + candidate.time + ")") : dateStr;

  var msgText = "🤖 <b>입력 내용을 확인해주세요:</b>\n\n"
    + "• <b>구분:</b> " + typeEmoji + " " + candidate.type + "\n"
    + "• <b>금액:</b> <b>" + Number(candidate.amount).toLocaleString() + "원</b>\n"
    + "• <b>내용:</b> " + candidate.description + "\n"
    + "• <b>분류:</b> " + candidate.category + "\n"
    + "• <b>수단:</b> " + candidate.payment_method + (candidate.card_name ? " (" + candidate.card_name + ")" : "") + "\n"
    + "• <b>일자:</b> " + dateDisplay + "\n\n"
    + "위 내용으로 가계부에 저장할까요?";

  var inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "💾 네, 기록할게요", callback_data: "CONFIRM:" + cacheKey },
        { text: "❌ 취소", callback_data: "CANCEL:" + cacheKey }
      ],
      [
        { text: "🍚 식비", callback_data: "CAT:식비:" + cacheKey },
        { text: "☕ 카페", callback_data: "CAT:카페:" + cacheKey },
        { text: "🚗 교통", callback_data: "CAT:교통:" + cacheKey },
        { text: "🛒 쇼핑", callback_data: "CAT:쇼핑:" + cacheKey }
      ],
      [
        { text: "🏠 생활", callback_data: "CAT:생활:" + cacheKey },
        { text: "🎬 문화", callback_data: "CAT:문화:" + cacheKey },
        { text: "📺 구독", callback_data: "CAT:구독:" + cacheKey },
        { text: "📝 기타", callback_data: "CAT:기타:" + cacheKey }
      ]
    ]
  };

  sendTelegramMessage(chatId, msgText, inlineKeyboard);
}

/**
 * 인라인 키보드 콜백 쿼리 처리
 */
function handleTelegramCallback(query) {
  var queryId = query.id;
  var chatId = query.message.chat.id;
  var messageId = query.message.message_id;
  var cbData = query.data;

  answerCallbackQuery(queryId);

  var cache = CacheService.getScriptCache();

  // 1. 거래 기록 확정 (CONFIRM)
  if (cbData.indexOf('CONFIRM:') === 0) {
    var key = cbData.substring('CONFIRM:'.length);
    var raw = cache.get(key);
    if (!raw) {
      editTelegramMessage(chatId, messageId, "⚠️ 확인 시간이 만료되었습니다. 다시 입력해주세요.");
      return;
    }
    var txData = JSON.parse(raw);
    cache.remove(key);

    // 공통 DB 쓰기 함수 호출
    var res = addTransaction(txData);

    if (res.success) {
      var summary = getAllData().summary || {};
      var doneText = "✅ <b>가계부 기록 완료!</b> 쾅! 🌟\n\n"
        + "• <b>" + txData.description + "</b>: " + Number(txData.amount).toLocaleString() + "원\n"
        + "• <b>분류:</b> " + txData.category + " (" + txData.payment_method + ")\n\n"
        + "📊 <b>이번 달 총 지출:</b> " + Number(summary.total_expense || 0).toLocaleString() + "원\n"
        + "💰 <b>이번 달 잔액:</b> " + Number(summary.balance || 0).toLocaleString() + "원";

      editTelegramMessage(chatId, messageId, doneText);
    } else {
      editTelegramMessage(chatId, messageId, "❌ 시트 저장 중 오류가 발생했습니다: " + (res.error || ''));
    }
    return;
  }

  // 2. 자산 기록 확정 (CONFIRM_ASSET)
  if (cbData.indexOf('CONFIRM_ASSET:') === 0) {
    var key = cbData.substring('CONFIRM_ASSET:'.length);
    var raw = cache.get(key);
    if (!raw) {
      editTelegramMessage(chatId, messageId, "⚠️ 확인 시간이 만료되었습니다. 다시 입력해주세요.");
      return;
    }
    var assetData = JSON.parse(raw);
    cache.remove(key);

    var res = saveAsset({ name: assetData.description, amount: assetData.amount, category: assetData.category || '현금/예적금' });
    if (res.success) {
      var nw = getAllData().net_worth || {};
      var doneText = "✅ <b>자산 등록 완료!</b> 🏦\n\n"
        + "• <b>" + assetData.description + "</b>: " + Number(assetData.amount).toLocaleString() + "원\n"
        + "• <b>분류:</b> " + (assetData.category || '현금/예적금') + "\n\n"
        + "💎 <b>총 순자산:</b> " + Number(nw.net_worth || 0).toLocaleString() + "원\n"
        + "웹 대시보드 순자산에 실시간 반영되었습니다.";
      editTelegramMessage(chatId, messageId, doneText);
    } else {
      editTelegramMessage(chatId, messageId, "❌ 자산 등록에 실패했습니다: " + (res.error || ''));
    }
    return;
  }

  // 2. 취소 (CANCEL)
  if (cbData.indexOf('CANCEL:') === 0) {
    var key = cbData.substring('CANCEL:'.length);
    cache.remove(key);
    editTelegramMessage(chatId, messageId, "❌ 입력이 취소되었습니다.");
    return;
  }

  // 3. 카테고리 변경 (CAT:카테고리:키)
  if (cbData.indexOf('CAT:') === 0) {
    var parts = cbData.split(':');
    var newCat = parts[1];
    var key = parts[2];
    var raw = cache.get(key);
    if (!raw) {
      editTelegramMessage(chatId, messageId, "⚠️ 시간이 만료되었습니다. 다시 입력해주세요.");
      return;
    }
    var candidate = JSON.parse(raw);
    candidate.category = newCat;
    cache.put(key, JSON.stringify(candidate), 600);

    // 메시지 갱신
    var typeEmoji = candidate.type === '수입' ? '💰' : '💸';
    var msgText = "🤖 <b>카테고리가 [" + newCat + "] (으)로 변경되었습니다:</b>\n\n"
      + "• <b>구분:</b> " + typeEmoji + " " + candidate.type + "\n"
      + "• <b>금액:</b> <b>" + Number(candidate.amount).toLocaleString() + "원</b>\n"
      + "• <b>내용:</b> " + candidate.description + "\n"
      + "• <b>분류:</b> <b>" + candidate.category + "</b> ✏️\n"
      + "• <b>수단:</b> " + candidate.payment_method + "\n\n"
      + "위 내용으로 가계부에 저장할까요?";

    var inlineKeyboard = {
      inline_keyboard: [
        [
          { text: "💾 네, 기록할게요", callback_data: "CONFIRM:" + key },
          { text: "❌ 취소", callback_data: "CANCEL:" + key }
        ],
        [
          { text: "🍚 식비", callback_data: "CAT:식비:" + key },
          { text: "☕ 카페", callback_data: "CAT:카페:" + key },
          { text: "🚗 교통", callback_data: "CAT:교통:" + key },
          { text: "🛒 쇼핑", callback_data: "CAT:쇼핑:" + key }
        ],
        [
          { text: "🏠 생활", callback_data: "CAT:생활:" + key },
          { text: "🎬 문화", callback_data: "CAT:문화:" + key },
          { text: "📺 구독", callback_data: "CAT:구독:" + key },
          { text: "📝 기타", callback_data: "CAT:기타:" + key }
        ]
      ]
    };

    editTelegramMessage(chatId, messageId, msgText, inlineKeyboard);
    return;
  }

  // 4. 최근 내역 삭제 (DEL_ROW:행번호)
  if (cbData.indexOf('DEL_ROW:') === 0) {
    var rowIdx = parseInt(cbData.substring('DEL_ROW:'.length), 10);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('가계부_내역');
    if (sheet && rowIdx > 1 && rowIdx <= sheet.getLastRow()) {
      sheet.deleteRow(rowIdx);
      editTelegramMessage(chatId, messageId, "🗑️ 해당 내역이 성공적으로 삭제되었습니다.");
    } else {
      editTelegramMessage(chatId, messageId, "⚠️ 이미 삭제되었거나 찾을 수 없는 행입니다.");
    }
    return;
  }
}

/**
 * 📊 실시간 AI 금융 브리핑 생성 및 전송
 */
function sendTelegramBriefing(chatId) {
  var data = getAllData();
  var nw = data.net_worth || {};
  var sum = data.summary || {};
  var lvl = data.level || {};
  var txs = data.transactions || [];
  var plans = data.recurring_plans || [];

  var curMonthStr = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy년 M월');
  var todayStr = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy년 M월 d일');

  // 카테고리별 당월 소비 계산
  var curMonthPrefix = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM');
  var catTotals = {};
  txs.filter(function(t) { return String(t.date).indexOf(curMonthPrefix) === 0 && t.type === '지출'; })
     .forEach(function(t) {
       catTotals[t.category] = (catTotals[t.category] || 0) + (Number(t.amount) || 0);
     });

  var topCat = '없음';
  var topCatAmt = 0;
  for (var k in catTotals) {
    if (catTotals[k] > topCatAmt) {
      topCatAmt = catTotals[k];
      topCat = k;
    }
  }

  // 다가오는 7일 이내 정기일정
  var curDay = new Date().getDate();
  var upcoming = plans.filter(function(p) {
    var diff = Number(p.day) - curDay;
    return diff >= 0 && diff <= 7;
  });

  // AI 금융 코멘트 요청 (Gemini Flash)
  var aiInsight = askGeminiBriefingComment({
    net_worth: nw.net_worth || 0,
    month_exp: sum.total_expense || 0,
    month_inc: sum.total_income || 0,
    balance: sum.balance || 0,
    top_cat: topCat,
    top_cat_amt: topCatAmt
  });

  var briefingText = "👑 <b>[스마트 머니 허브 - 오늘의 금융 브리핑]</b>\n"
    + "📅 " + todayStr + " 기준\n\n"
    + "💰 <b>1. 나의 자산 & 목표 현황</b>\n"
    + "• 총 순자산: <b>" + Number(nw.net_worth || 0).toLocaleString() + "원</b>\n"
    + "• 현재 레벨: " + (lvl.title || '재정 입문자') + " (진행률 " + (lvl.progress_to_next || 0) + "%)\n"
    + "• 다음 목표: " + (lvl.next_target ? (lvl.next_target >= 100000000 ? (lvl.next_target/100000000).toFixed(1)+'억원' : (lvl.next_target/10000)+'만원') : '') + "\n\n"
    + "💸 <b>2. " + curMonthStr + " 수입/지출 페이스</b>\n"
    + "• 당월 수입: <b>+" + Number(sum.total_income || 0).toLocaleString() + "원</b>\n"
    + "• 당월 지출: <b>-" + Number(sum.total_expense || 0).toLocaleString() + "원</b>\n"
    + "• 현재 잔액: <b>" + (Number(sum.balance) >= 0 ? '+' : '') + Number(sum.balance || 0).toLocaleString() + "원</b>\n"
    + "• 지출 1위: " + topCat + " (" + topCatAmt.toLocaleString() + "원)\n\n"
    + "🗓️ <b>3. 다가오는 정기 일정 (7일 이내)</b>\n";

  if (upcoming.length === 0) {
    briefingText += "• 7일 이내 예정된 고정 지출/수입이 없습니다.\n\n";
  } else {
    upcoming.forEach(function(p) {
      briefingText += "• 매월 " + p.day + "일: " + (p.type === '수입' ? '💵' : '💳') + " " + p.name + " (" + Number(p.amount).toLocaleString() + "원)\n";
    });
    briefingText += "\n";
  }

  briefingText += "💡 <b>4. AI 금융 비서 코멘트</b>\n"
    + "<i>\"" + aiInsight + "\"</i>";

  var webAppUrl = ScriptApp.getService().getUrl();
  var inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "📊 웹 대시보드 바로가기", url: webAppUrl }
      ]
    ]
  };

  sendTelegramMessage(chatId, briefingText, inlineKeyboard);
}

/**
 * 텔레그램으로 최근 5건 거래내역 전송 (삭제 버튼 포함)
 */
function sendTelegramRecentTransactions(chatId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('가계부_내역');
  if (!sheet) return;
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    sendTelegramMessage(chatId, "최근 기록된 거래 내역이 없습니다.");
    return;
  }

  var recentText = "📋 <b>최근 기록된 내역 (최신 5건):</b>\n\n";
  var buttons = [];

  var startIdx = Math.max(1, values.length - 5);
  for (var i = values.length - 1; i >= startIdx; i--) {
    var row = values[i];
    var rowNum = i + 1;
    var d = formatGASDate(row[0]);
    var cat = row[1];
    var desc = row[2];
    var amt = Number(row[3]) || 0;
    var type = row[4];
    recentText += "• " + d.substring(5) + " [" + cat + "] " + desc + " : <b>" + (type === '수입' ? '+' : '') + amt.toLocaleString() + "원</b>\n";
    buttons.push([{ text: "🗑️ 삭제: " + desc + " (" + amt.toLocaleString() + "원)", callback_data: "DEL_ROW:" + rowNum }]);
  }

  sendTelegramMessage(chatId, recentText, { inline_keyboard: buttons });
}

/**
 * 텔레그램으로 보유 자산 목록 전송
 */
function sendTelegramAssets(chatId) {
  var data = getAllData();
  var nw = data.net_worth || {};
  var assets = nw.assets_list || [];
  var invs = nw.investments_list || [];

  var msg = "🏦 <b>나의 보유 자산 현황</b>\n\n"
    + "• <b>총 순자산:</b> " + Number(nw.net_worth || 0).toLocaleString() + "원\n"
    + "• <b>현금/예적금:</b> " + Number(nw.total_assets - nw.inv_total_eval).toLocaleString() + "원\n"
    + "• <b>주식 평가액:</b> " + Number(nw.inv_total_eval || 0).toLocaleString() + "원\n\n"
    + "<b>[예적금/자산 상세]</b>\n";

  if (assets.length === 0) {
    msg += "등록된 자산이 없습니다.\n";
  } else {
    assets.forEach(function(a) {
      msg += "• " + a.name + " (" + a.category + "): " + Number(a.amount).toLocaleString() + "원\n";
    });
  }

  if (invs.length > 0) {
    msg += "\n<b>[주식/투자 상세]</b>\n";
    invs.forEach(function(iv) {
      var evalAmt = (Number(iv.shares) || 0) * (Number(iv.current_price) || 0);
      msg += "• " + iv.name + " (" + iv.shares + "주): " + evalAmt.toLocaleString() + "원\n";
    });
  }

  sendTelegramMessage(chatId, msg);
}

/**
 * 텔레그램으로 정기 일정 목록 전송
 */
function sendTelegramRecurringPlans(chatId) {
  var plans = getRecurringPlansList();
  var msg = "🗓️ <b>매월 정기 입출금 일정 목록</b>\n\n";
  if (plans.length === 0) {
    msg += "등록된 정기 일정이 없습니다.\n";
  } else {
    plans.sort(function(a, b) { return Number(a.day) - Number(b.day); }).forEach(function(p) {
      msg += "• <b>매월 " + p.day + "일:</b> [" + p.type + "] " + p.name + " (" + Number(p.amount).toLocaleString() + "원 / " + p.pay_method + ")\n";
    });
  }
  sendTelegramMessage(chatId, msg);
}

// ============================================================================
// 🧠 Gemini Flash AI 자연어 파싱 & 브리핑 코멘트 엔진
// ============================================================================

/**
 * Gemini Flash 모델을 호출하여 지출/수입 정보 추출
 */
/**
 * Gemini Flash 모델을 호출하여 지출/수입/자산/브리핑 정보 정밀 추출
 */
function askGeminiFinance(userText) {
  var apiKey = getGeminiApiKey();

  // API 키가 없으면 정규식 룰 기반 파서로 안전하게 대체
  if (!apiKey) {
    return fallbackRegexParser(userText);
  }

  var prompt = "당신은 한국어 금융/가계부 AI 비서입니다. 사용자의 일상 대화, 결제 SMS, 질문을 분석하여 오직 순수 JSON으로만 응답하세요.\n\n"
    + "사용자 메시지: \"" + userText + "\"\n\n"
    + "분석 지침:\n"
    + "1. action_type 판별: 'transaction' | 'asset' | 'briefing'\n"
    + "2. type 판별: '지출' 또는 '수입'\n"
    + "3. amount (금액): 350만 -> 3500000, 5만 -> 50000, 1억 -> 100000000 등 정확한 정수 숫자 변환\n"
    + "4. description (내용): 지출/수입 대상 명칭 (예: '점심 식사', '스타벅스 아메리카노', '9월 월급', '쿠팡 생수')\n"
    + "5. category: ['식비', '카페', '교통', '쇼핑', '생활', '문화', '구독', '저축', '급여/월급', '기타'] 중 1개 선택\n"
    + "6. payment_method: '신용카드' 또는 '현금'\n"
    + "7. card_name: 카드사명이 언급된 경우 (예: '신한카드', '국민카드' 등), 없으면 빈문자열\n"
    + "8. time: 텍스트에 명시적인 결제/입금 시간(예: '14:35', '오후 2시', '밤 11시', '09/03 18:20')이 있을 때만 'HH:mm' 형태로 추출하고, 시간 언급이 없으면 빈문자열(\"\")로 두세요. 절대로 사용자에게 시간을 되묻지 마세요.\n\n"
    + "응답 JSON 형식:\n"
    + "{\n"
    + "  \"action_type\": \"transaction\" 또는 \"asset\" 또는 \"briefing\",\n"
    + "  \"type\": \"지출\" 또는 \"수입\",\n"
    + "  \"amount\": 15000,\n"
    + "  \"description\": \"점심 식사\",\n"
    + "  \"category\": \"식비\",\n"
    + "  \"payment_method\": \"신용카드\",\n"
    + "  \"card_name\": \"신한카드\",\n"
    + "  \"time\": \"14:35\" (없으면 \"\")\n"
    + "}";

  try {
    var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;
    var payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    };
    var options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var res = UrlFetchApp.fetch(url, options);
    if (res.getResponseCode() === 200) {
      var json = JSON.parse(res.getContentText());
      var rawResult = json.candidates[0].content.parts[0].text;
      var parsed = JSON.parse(rawResult);
      parsed.date = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
      return parsed;
    }
  } catch (e) {
    Logger.log("Gemini API error: " + e.toString());
  }

  return fallbackRegexParser(userText);
}

/**
 * 룰 기반 정규식 폴백 파서 (한국어 단위 및 수입/지출/자산 정밀 분리)
 */
function fallbackRegexParser(text) {
  var t = text.trim();

  // 1. 브리핑 의도 확인
  if (t.match(/브리핑|현황|요약|결산|얼마 썼|얼마 남|잔액|남았어/i)) {
    return { action_type: 'briefing' };
  }

  // 2. 한국어 금액 파싱 (350만, 50만원, 1억, 15000 등)
  var amount = 0;
  var manMatch = t.match(/([0-9.]+)\s*(만|만원)/);
  var ukMatch = t.match(/([0-9.]+)\s*(억|억원)/);
  var numMatch = t.match(/([0-9,]+)\s*(원|KRW|₩)?/);

  if (ukMatch) {
    amount = Math.round(parseFloat(ukMatch[1]) * 100000000);
  } else if (manMatch) {
    amount = Math.round(parseFloat(manMatch[1]) * 10000);
  } else if (numMatch) {
    amount = parseInt(numMatch[1].replace(/,/g, ''), 10) || 0;
  }

  // 3. 자산 증감 의도 확인
  var isAsset = t.match(/청약|적금|예금|정기예금|주식|코인|통장 넣|통장에/);
  var actionType = isAsset ? 'asset' : 'transaction';

  // 4. 수입 vs 지출 판별
  var isIncome = t.match(/급여|월급|입금|수입|들어옴|환급|정산|용돈|알바|보너스|수당|벌었|송금받/);
  var type = isIncome ? '수입' : '지출';

  // 5. 시간 추출 (텍스트에 명백한 시간이 있을 때만 추출)
  var time = '';
  var tMatch1 = t.match(/\b([01]?[0-9]|2[0-3]):([0-5][0-9])\b/);
  if (tMatch1) {
    var hh = tMatch1[1].length === 1 ? '0' + tMatch1[1] : tMatch1[1];
    time = hh + ':' + tMatch1[2];
  } else {
    var tMatch2 = t.match(/(오전|오후|밤|새벽|저녁|아침)?\s*(\d{1,2})시\s*(\d{1,2})?분?/);
    if (tMatch2) {
      var ampm = tMatch2[1] || '';
      var hour = parseInt(tMatch2[2], 10);
      var min = tMatch2[3] ? parseInt(tMatch2[3], 10) : 0;
      if ((ampm === '오후' || ampm === '밤' || ampm === '저녁') && hour < 12) hour += 12;
      if ((ampm === '오전' || ampm === '새벽') && hour === 12) hour = 0;
      var hStr = hour < 10 ? '0' + hour : String(hour);
      var mStr = min < 10 ? '0' + min : String(min);
      time = hStr + ':' + mStr;
    }
  }

  var cat = isIncome ? '급여/월급' : guessCategoryFromText(t);
  var method = (t.indexOf('카드') >= 0 || t.indexOf('체크') >= 0 || t.indexOf('신용') >= 0 || t.indexOf('승인') >= 0) ? '신용카드' : '현금';
  var cardName = '';
  var cards = ['신한', '국민', '현대', '삼성', '우리', '하나', '농협', '롯데', '카카오'];
  cards.forEach(function(c) { if (t.indexOf(c) >= 0) cardName = c + '카드'; });

  var desc = t.replace(/([0-9,.]+)\s*(억|억원|만|만원|원|KRW|₩)?/g, '')
              .replace(/(카드|현금|결제|지출|수입|입금|들어옴|먹음|마심|샀음|했음|보냄)/g, '')
              .trim();
  if (!desc) desc = isAsset ? '보유 자산' : cat;

  return {
    action_type: actionType,
    type: type,
    amount: amount,
    description: desc,
    category: cat,
    payment_method: method,
    card_name: cardName,
    time: time,
    date: Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd')
  };
}

/**
 * 키워드 기반 카테고리 자동 유추
 */
function guessCategoryFromText(text) {
  var t = text.toLowerCase();
  if (t.match(/커피|카페|스타벅스|메가|이디야|투썸|아메리카노|라떼|베이커리|디저트/)) return '카페';
  if (t.match(/식당|밥|점심|저녁|식사|순대국|김치찌개|고기|치킨|피자|배달|맥도날드|버거/)) return '식비';
  if (t.match(/택시|지하철|버스|주유|교통|톨게이트|하이패스|코레일|ktx|주차/)) return '교통';
  if (t.match(/쿠팡|마트|이마트|쇼핑|백화점|다이소|옷|패션|신발|올리브영/)) return '쇼핑';
  if (t.match(/관리비|전기세|가스|수도|공과금|아파트|월세|세탁/)) return '생활';
  if (t.match(/영화|cgv|메가박스|공연|전시|도서|책|노래방|헬스/)) return '문화';
  if (t.match(/넷플릭스|유튜브|쿠팡와우|디즈니|스포티파이|구독|멤버십/)) return '구독';
  if (t.match(/적금|예금|청약|저축|투자|주식/)) return '저축';
  if (t.match(/월급|급여|상여|알바|용돈|수당/)) return '급여/월급';
  return '기타';
}

/**
 * Gemini Flash를 통한 AI 금융 브리핑 코멘트 생성
 */
function askGeminiBriefingComment(summary) {
  var apiKey = getGeminiApiKey();
  if (!apiKey) {
    return "💡 계획적인 소비 습관이 순자산 1억 달성의 가장 빠른 지름길입니다. 오늘도 가치 있는 하루 되세요!";
  }

  var prompt = "다음은 사용자의 실시간 재정 현황 요약입니다:\n"
    + "- 총 순자산: " + summary.net_worth + "원\n"
    + "- 당월 수입: " + summary.month_inc + "원\n"
    + "- 당월 지출: " + summary.month_exp + "원\n"
    + "- 당월 잔액: " + summary.balance + "원\n"
    + "- 최다 지출 카테고리: " + summary.top_cat + " (" + summary.top_cat_amt + "원)\n\n"
    + "위 재정 상태를 분석하여 친절하고 통찰력 있는 금융 비서 톤으로 딱 1~2문장의 따뜻하고 격려하는 조언/코멘트를 작성하세요. 마크다운 기호 없이 한국어 문장만 출력하세요.";

  try {
    var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;
    var payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 120 }
    };
    var options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    var res = UrlFetchApp.fetch(url, options);
    if (res.getResponseCode() === 200) {
      var json = JSON.parse(res.getContentText());
      return json.candidates[0].content.parts[0].text.trim();
    }
  } catch (e) {
    Logger.log("Gemini briefing error: " + e.toString());
  }

  return "💡 계획적인 소비 습관이 순자산 1억 달성의 가장 빠른 지름길입니다. 오늘도 가치 있는 하루 되세요!";
}

// ============================================================================
// 📡 텔레그램 HTTP API 송수신 유틸리티
// ============================================================================

function sendTelegramMessage(chatId, text, replyMarkup) {
  var token = getTelegramToken();
  if (!token) return;
  var url = "https://api.telegram.org/bot" + token + "/sendMessage";
  var payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);

  try {
    UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log("sendTelegramMessage error: " + e.toString());
  }
}

function editTelegramMessage(chatId, messageId, text, replyMarkup) {
  var token = getTelegramToken();
  if (!token) return;
  var url = "https://api.telegram.org/bot" + token + "/editMessageText";
  var payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = JSON.stringify(replyMarkup);

  try {
    UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log("editTelegramMessage error: " + e.toString());
  }
}

function answerCallbackQuery(callbackQueryId, text) {
  var token = getTelegramToken();
  if (!token) return;
  var url = "https://api.telegram.org/bot" + token + "/answerCallbackQuery";
  var payload = { callback_query_id: callbackQueryId };
  if (text) payload.text = text;

  try {
    UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log("answerCallbackQuery error: " + e.toString());
  }
}

function setTelegramWebhook(token, webAppUrl) {
  var url = "https://api.telegram.org/bot" + token + "/setWebhook?url=" + encodeURIComponent(webAppUrl);
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  return res.getContentText();
}

function deleteTelegramWebhook(token) {
  var url = "https://api.telegram.org/bot" + token + "/deleteWebhook";
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  return res.getContentText();
}

