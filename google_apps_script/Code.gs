/**
 * 💰 스마트 머니 허브 - 구글 앱스크립트 (Google Apps Script Backend)
 * 구글 시트를 DB로 활용하는 서버리스 가계부 + 카드값 대조 + 자산 + 주식 + AI 분석 API
 */

// ==========================================
// 1. 웹 앱 진입점 (doGet / doPost)
// ==========================================

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
  
  // JSON API 요청 처리
  if (action) {
    return handleApiGet(e);
  }
  
  // 웹 앱 UI 서빙 (HTML)
  initSheets();
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
      data = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      data = e.parameter;
    }
    
    var action = data.action || (e.parameter ? e.parameter.action : '');
    var result = handleApiPost(action, data);
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// 2. 구글 시트 데이터베이스 초기화
// ==========================================

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function initSheets() {
  var ss = getSpreadsheet();
  
  // 1. 가계부_내역 시트
  var txSheet = ss.getSheetByName('가계부_내역');
  if (!txSheet) {
    txSheet = ss.insertSheet('가계부_내역');
    txSheet.appendRow(['ID', '날짜', '유형', '금액', '카테고리', '내용/사용처', '소비성격', '만족도', '결제수단', '카드명', '청구월', '대조완료', '할부', '등록일시']);
    txSheet.getRange(1, 1, 1, 14).setBackground('#2563EB').setFontColor('#FFFFFF').setFontWeight('bold');
    txSheet.setFrozenRows(1);
  }
  
  // 2. 카드값_대조 시트
  var cardSheet = ss.getSheetByName('카드값_대조');
  if (!cardSheet) {
    cardSheet = ss.insertSheet('카드값_대조');
    cardSheet.appendRow(['청구월', '카드명', '실제청구액', '기록합계', '차액', '상태', '메모', '갱신일시']);
    cardSheet.getRange(1, 1, 1, 8).setBackground('#0284C7').setFontColor('#FFFFFF').setFontWeight('bold');
    cardSheet.setFrozenRows(1);
  }
  
  // 3. 자산_원금 시트
  var assetSheet = ss.getSheetByName('자산_원금');
  if (!assetSheet) {
    assetSheet = ss.insertSheet('자산_원금');
    assetSheet.appendRow(['ID', '자산명', '자산종류', '현재금액', '원금(시드)', '메모', '갱신일시']);
    assetSheet.getRange(1, 1, 1, 7).setBackground('#10B981').setFontColor('#FFFFFF').setFontWeight('bold');
    assetSheet.setFrozenRows(1);
    
    // 초기 기본 샘플
    assetSheet.appendRow([1, '비상금 통장', '현금/예적금', 3000000, 3000000, '생활비 비상금', new Date().toISOString()]);
  }
  
  // 4. 주식_투자 시트
  var invSheet = ss.getSheetByName('주식_투자');
  if (!invSheet) {
    invSheet = ss.insertSheet('주식_투자');
    invSheet.appendRow(['ID', '종목명', '시장', '보유수량', '평균매수가', '현재가', '배당률(%)', '목표가', '메모', '갱신일시']);
    invSheet.getRange(1, 1, 1, 10).setBackground('#8B5CF6').setFontColor('#FFFFFF').setFontWeight('bold');
    invSheet.setFrozenRows(1);
  }
  
  // 5. 예산_목표 시트
  var budgetSheet = ss.getSheetByName('예산_목표');
  if (!budgetSheet) {
    budgetSheet = ss.insertSheet('예산_목표');
    budgetSheet.appendRow(['청구월', '카테고리', '예산금액']);
    budgetSheet.getRange(1, 1, 1, 3).setBackground('#F59E0B').setFontColor('#FFFFFF').setFontWeight('bold');
    budgetSheet.setFrozenRows(1);
  }
}

// ==========================================
// 3. API 라우터 (게임 로드 / 세이브 핸들러)
// ==========================================

function handleApiGet(e) {
  var action = e.parameter.action;
  var month = e.parameter.month || Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM');
  var result = {};
  
  if (action === 'getAllData' || action === 'loadGame') {
    result = getAllData(month);
  } else if (action === 'getAdvice') {
    result = generateAiAdvice(month);
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleApiPost(action, data) {
  initSheets();
  
  if (action === 'addTransaction') {
    return addTransaction(data);
  } else if (action === 'deleteTransaction') {
    return deleteTransaction(data.id);
  } else if (action === 'toggleReconcile') {
    return toggleReconcile(data.id);
  } else if (action === 'reconcileCard') {
    return reconcileCard(data);
  } else if (action === 'batchReconcileCard') {
    return batchReconcileCard(data);
  } else if (action === 'saveAsset') {
    return saveAsset(data);
  } else if (action === 'deleteAsset') {
    return deleteAsset(data.id);
  } else if (action === 'saveInvestment') {
    return saveInvestment(data);
  } else if (action === 'deleteInvestment') {
    return deleteInvestment(data.id);
  } else if (action === 'setBudget') {
    return setBudget(data);
  }
  
  return { success: false, error: 'Unknown action: ' + action };
}

// ==========================================
// 4. 데이터 조회 & 집계 로직
// ==========================================

function getAllData(month) {
  var ss = getSpreadsheet();
  initSheets();
  
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
    
    var txDate = String(row[1]).substring(0, 10);
    var txMonth = txDate.substring(0, 7);
    var billingMonth = String(row[10] || txMonth).substring(0, 7);
    var type = row[2];
    var amount = Number(row[3]) || 0;
    var cat = row[4] || '기타';
    var desc = row[5] || '';
    var cType = row[6] || '선택';
    var sat = row[7] || '보통';
    var payMethod = row[8] || '신용카드';
    var cardName = row[9] || '';
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
    
    if (txMonth === month) {
      transactions.unshift(item); // 최신순
      
      if (type === '지출') {
        totalExpense += amount;
        byCategory[cat] = (byCategory[cat] || 0) + amount;
        byConsumptionType[cType] = (byConsumptionType[cType] || 0) + amount;
        bySatisfaction[sat] = (bySatisfaction[sat] || 0) + amount;
      } else {
        totalIncome += amount;
      }
    }
    
    // 카드 청구월 기준 집계
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
    if (crow[0] === month) {
      cardStatements[crow[1]] = {
        billed: Number(crow[2]) || 0,
        recorded: Number(crow[3]) || 0,
        diff: Number(crow[4]) || 0,
        status: crow[5] || '',
        memo: crow[6] || ''
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
    var aType = aRow[2] || '현금/예적금';
    if (aType === '부채/대출') {
      totalDebt += aAmt;
    } else {
      totalAssets += aAmt;
    }
    assetsList.push({
      id: aRow[0],
      name: aRow[1],
      asset_type: aType,
      amount: aAmt,
      initial_amount: Number(aRow[4]) || aAmt,
      memo: aRow[5] || ''
    });
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
      id: vRow[0],
      name: vRow[1],
      market: vRow[2] || '국내주식',
      shares: shares,
      avg_price: avgP,
      current_price: curP,
      dividend_rate: Number(vRow[6]) || 0,
      target_price: Number(vRow[7]) || 0,
      memo: vRow[8] || '',
      total_cost: tCost,
      total_eval: tEval,
      profit: profit,
      profit_rate: Number(pRate)
    });
  }
  
  var grandTotalAssets = totalAssets + invTotalEval;
  var netWorth = grandTotalAssets - totalDebt;
  
  return {
    month: month,
    summary: {
      total_expense: totalExpense,
      total_income: totalIncome,
      balance: totalIncome - totalExpense,
      by_category: byCategory,
      by_consumption_type: byConsumptionType,
      by_satisfaction: bySatisfaction,
      mindful_score: totalExpense > 0 ? Math.max(0, 100 - Math.round(((byConsumptionType['낭비'] || 0) + (bySatisfaction['후회'] || 0)) / totalExpense * 100)) : 100
    },
    transactions: transactions,
    cards_summary: cardsSummary,
    net_worth: {
      net_worth: netWorth,
      total_assets: grandTotalAssets,
      total_debt: totalDebt,
      assets_list: assetsList,
      investments_list: investmentsList,
      inv_total_cost: invTotalCost,
      inv_total_eval: invTotalEval,
      inv_total_profit: invTotalEval - invTotalCost,
      inv_total_profit_rate: invTotalCost > 0 ? ((invTotalEval - invTotalCost) / invTotalCost * 100).toFixed(2) : 0
    }
  };
}

// ==========================================
// 5. 트랜잭션 추가 / 수정 / 대조 함수들
// ==========================================

function addTransaction(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('가계부_내역');
  var id = new Date().getTime();
  var dateStr = data.date || Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  var billingMonth = data.billing_month || dateStr.substring(0, 7);
  
  sheet.appendRow([
    id,
    dateStr,
    data.type || '지출',
    Number(data.amount) || 0,
    data.category || '기타',
    data.description || '',
    data.consumption_type || '선택',
    data.satisfaction || '보통',
    data.payment_method || '신용카드',
    data.card_name || '',
    billingMonth,
    0, // is_reconciled
    Number(data.installment) || 1,
    new Date().toISOString()
  ]);
  
  return { success: true, id: id };
}

function deleteTransaction(id) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('가계부_내역');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Not found' };
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
  return { success: false, error: 'Not found' };
}

function reconcileCard(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('카드값_대조');
  var bMonth = data.billing_month;
  var cardName = data.card_name;
  var billedAmount = Number(data.billed_amount) || 0;
  var memo = data.memo || '';
  
  // 가계부 기록 합계 계산
  var txSheet = ss.getSheetByName('가계부_내역');
  var txData = txSheet.getDataRange().getValues();
  var recorded = 0;
  for (var i = 1; i < txData.length; i++) {
    if (txData[i][2] === '지출' && String(txData[i][10]) === bMonth && String(txData[i][9]) === cardName) {
      recorded += Number(txData[i][3]) || 0;
    }
  }
  
  var diff = billedAmount - recorded;
  var status = diff === 0 ? '일치' : (diff > 0 ? '청구액 초과(누락주의)' : '기록 초과');
  
  // 기존 행 업데이트 또는 추가
  var cData = sheet.getDataRange().getValues();
  var foundRow = -1;
  for (var k = 1; k < cData.length; k++) {
    if (String(cData[k][0]) === bMonth && String(cData[k][1]) === cardName) {
      foundRow = k + 1;
      break;
    }
  }
  
  if (foundRow > 0) {
    sheet.getRange(foundRow, 3, 1, 6).setValues([[billedAmount, recorded, diff, status, memo, new Date().toISOString()]]);
  } else {
    sheet.appendRow([bMonth, cardName, billedAmount, recorded, diff, status, memo, new Date().toISOString()]);
  }
  
  return {
    success: true,
    result: {
      billing_month: bMonth,
      card_name: cardName,
      billed_amount: billedAmount,
      recorded_amount: recorded,
      difference: diff,
      status: status
    }
  };
}

function batchReconcileCard(data) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('가계부_내역');
  var dataArr = sheet.getDataRange().getValues();
  var bMonth = data.billing_month;
  var cardName = data.card_name;
  
  for (var i = 1; i < dataArr.length; i++) {
    if (dataArr[i][2] === '지출' && String(dataArr[i][10]) === bMonth && String(dataArr[i][9]) === cardName) {
      sheet.getRange(i + 1, 12).setValue(1);
    }
  }
  return { success: true };
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
      sheet.deleteRow(i + 1);
      return { success: true };
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
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false };
}
