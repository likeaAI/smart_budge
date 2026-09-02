/**
 * 💰 스마트 머니 허브 - 구글 앱스크립트 (Google Apps Script Backend)
 * 구글 시트를 DB로 활용하는 가계부 + 웹훅(Webhook) 수신 & 문자 파싱 + 카드값 대조 API
 */

// ==========================================
// 1. 웹 앱 진입점 (doGet / doPost - 웹훅 수신)
// ==========================================

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
  
  if (action) {
    return handleApiGet(e);
  }
  
  initSheets();
  var template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle('스마트 머니 허브')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * ⚡ 웹훅(Webhook) 수신 핸들러 (외부 앱, 텔레그램, 카드문자, 테스터 등)
 */
function doPost(e) {
  try {
    var data = {};
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (jsonErr) {
        // Raw Text(문자 그대로)가 들어온 경우
        data = { text: e.postData.contents };
      }
    } else if (e.parameter) {
      data = e.parameter;
    }
    
    var action = data.action || (e.parameter ? e.parameter.action : '');
    
    // 만약 문자 텍스트(text/sms/message)만 웹훅으로 쏴진 경우 자동 파싱 액션으로 분기
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
// 2. 웹훅 & API 액션 라우터
// ==========================================

function handleApiPost(action, data) {
  initSheets();
  
  // ⚡ 1. 카드 결제 문자 웹훅 수신 & 자동 파싱 저장
  if (action === 'parseSmsWebhook' || action === 'webhook') {
    var rawText = data.text || data.sms || data.message || data.body || '';
    return parseSmsAndSave(rawText, data);
  }
  
  // ✍️ 2. 거래 내역 직접 추가
  else if (action === 'addTransaction') {
    return addTransaction(data);
  }
  
  // 🗑️ 3. 거래 내역 삭제
  else if (action === 'deleteTransaction') {
    return deleteTransaction(data.id);
  }
  
  // ☑️ 4. 개별 거래 대조 상태 토글
  else if (action === 'toggleReconcile') {
    return toggleReconcile(data.id);
  }
  
  // 💳 5. 카드사 청구서 금액 대조
  else if (action === 'reconcileCard') {
    return reconcileCard(data);
  }
  
  // 🏦 6. 자산 저장 및 삭제
  else if (action === 'saveAsset') {
    return saveAsset(data);
  } else if (action === 'deleteAsset') {
    return deleteAsset(data.id);
  }
  
  // 📈 7. 주식/투자 저장 및 삭제
  else if (action === 'saveInvestment') {
    return saveInvestment(data);
  } else if (action === 'deleteInvestment') {
    return deleteInvestment(data.id);
  }
  
  return { success: false, error: 'Unknown action: ' + action };
}

// ==========================================
// 3. 📱 카드 결제 문자(SMS) 자동 분석 & 시트 저장
// ==========================================

function parseSmsAndSave(text, rawData) {
  if (!text) {
    return { success: false, error: 'Empty text' };
  }
  
  // 1. 금액 추출 (예: 15,000원, 15000원, 15,000 등)
  var amount = 0;
  var amtMatch = text.match(/([0-9,]+)\s*원/i) || text.match(/(?:KRW|₩)\s*([0-9,]+)/i) || text.match(/\b([0-9]{1,3}(?:,[0-9]{3})+)\b/);
  if (amtMatch) {
    amount = parseInt(amtMatch[1].replace(/,/g, ''), 10);
  }
  if (!amount && rawData.amount) {
    amount = Number(rawData.amount);
  }
  
  // 2. 카드사 추출
  var cardName = '현대카드';
  if (text.indexOf('신한') >= 0) cardName = '신한카드';
  else if (text.indexOf('삼성') >= 0) cardName = '삼성카드';
  else if (text.indexOf('국민') >= 0 || text.indexOf('KB') >= 0) cardName = 'KB국민카드';
  else if (text.indexOf('롯데') >= 0) cardName = '롯데카드';
  else if (text.indexOf('우리') >= 0) cardName = '우리카드';
  else if (text.indexOf('하나') >= 0) cardName = '하나카드';
  else if (text.indexOf('농협') >= 0 || text.indexOf('NH') >= 0) cardName = 'NH농협카드';
  else if (text.indexOf('BC') >= 0 || text.indexOf('비씨') >= 0) cardName = 'BC카드';
  if (rawData.card_name) cardName = rawData.card_name;
  
  // 3. 사용처 및 카테고리 유추
  var category = '식비';
  var desc = '카드 결제';
  
  if (text.indexOf('스타벅스') >= 0 || text.indexOf('커피') >= 0 || text.indexOf('카페') >= 0 || text.indexOf('메가커피') >= 0) {
    category = '카페'; desc = '카페/음료';
  } else if (text.indexOf('식당') >= 0 || text.indexOf('배민') >= 0 || text.indexOf('배달의민족') >= 0 || text.indexOf('백반') >= 0 || text.indexOf('김밥') >= 0) {
    category = '식비'; desc = '외식/식비';
  } else if (text.indexOf('주유') >= 0 || text.indexOf('택시') >= 0 || text.indexOf('교통') >= 0 || text.indexOf('코레일') >= 0) {
    category = '교통'; desc = '교통비';
  } else if (text.indexOf('쿠팡') >= 0 || text.indexOf('네이버') >= 0 || text.indexOf('마트') >= 0 || text.indexOf('이마트') >= 0) {
    category = '쇼핑'; desc = '쇼핑';
  }
  
  var today = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  var billingMonth = today.substring(0, 7);
  
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
    billing_month: billingMonth,
    installment: 1
  };
  
  var saveRes = addTransaction(txData);
  
  return {
    success: true,
    message: '웹훅 문자 파싱 및 저장 완료',
    parsed: txData,
    id: saveRes.id
  };
}

// ==========================================
// 4. 구글 시트 데이터베이스 초기화
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
}

// ==========================================
// 5. 트랜잭션 CRUD 및 카드 대조
// ==========================================

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
  
  var cData = sheet.getDataRange().getValues();
  var foundRow = -1;
  for (var k = 1; k < cData.length; k++) {
    if (String(cData[k][0]) === bMonth && String(cData[k][1]) === cardName) {
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

// ==========================================
// 6. 🧪 구글 스크립트 내부 수동 테스트 함수
// ==========================================

/**
 * Apps Script 상단에서 이 함수를 선택하고 [▶ 실행]을 누르면 즉시 수동 테스트가 시트에 기록됩니다!
 */
function testWebhookManual() {
  var sampleSms = "[현대카드] 09/02 12:35 스타벅스 15,000원 일시불";
  var result = parseSmsAndSave(sampleSms, {});
  Logger.log("웹훅 테스트 결과: " + JSON.stringify(result));
}
