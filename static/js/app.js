/**
 * Smart Budget - Main Client Application (시각적 임팩트 & 소비 자각 특화 버전)
 * Handles theme, audio synthesizer, confetti animations, 3D stamps, transactions, dashboard charts, budgets.
 */

// ==========================================
// Constants & Maps
// ==========================================

const CATEGORY_COLORS = {
  '식비': '#FF6B6B',
  '카페': '#C4A35A',
  '교통': '#4ECDC4',
  '쇼핑': '#FF8E53',
  '생활': '#45B7D1',
  '문화': '#96CEB4',
  '구독': '#9B59B6',
  '저축': '#2ECC71',
  '기타': '#95A5A6'
};

const CATEGORY_EMOJI = {
  '식비': '🍚',
  '카페': '☕',
  '교통': '🚗',
  '쇼핑': '🛒',
  '생활': '🏠',
  '문화': '🎬',
  '구독': '📺',
  '저축': '💰',
  '기타': '📝'
};

let categoryChartInstance = null;
let dailyChartInstance = null;
let audioCtx = null;
let soundEnabled = localStorage.getItem('soundEnabled') !== 'false';

// ==========================================
// 1. Web Audio API Sound Synthesizer (기계식 키보드 타건음)
// ==========================================

function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

/**
 * 기계식 키보드 딸깍(Click-Clack) 타건음 재생
 * @param {'click'|'thock'|'enter'|'pop'|'coin'|'warning'} type
 */
function playSound(type = 'click') {
  if (!soundEnabled) return;
  try {
    initAudio();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;

    if (type === 'click' || type === 'key') {
      // ⌨️ 기계식 청축/갈축 찰진 "딸깍(Click-Clack)" 사운드
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      // Sharp metallic click transient (딸깍 클릭음)
      osc1.type = 'triangle';
      const pitch = 1800 + (Math.random() * 400 - 200);
      osc1.frequency.setValueAtTime(pitch, now);
      osc1.frequency.exponentialRampToValueAtTime(300, now + 0.035);

      // Keycap bottom-out resonance (키캡 바닥 때리는 쫀득한 공명음)
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(450 + (Math.random() * 60 - 30), now);
      osc2.frequency.exponentialRampToValueAtTime(80, now + 0.045);

      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(audioCtx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.045);
      osc2.stop(now + 0.045);
    } else if (type === 'pop') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(450, now);
      osc.frequency.exponentialRampToValueAtTime(850, now + 0.06);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.06);
    } else if (type === 'coin') {
      // High-pitched coin jingle
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(987.77, now);
      osc1.frequency.setValueAtTime(1318.51, now + 0.08);

      osc2.frequency.setValueAtTime(1318.51, now);
      osc2.frequency.setValueAtTime(1760.00, now + 0.08);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(audioCtx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.35);
      osc2.stop(now + 0.35);
    } else if (type === 'warning') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.linearRampToValueAtTime(220, now + 0.25);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch (e) {}
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('soundEnabled', soundEnabled);
  updateSoundToggleUI();
  if (soundEnabled) playSound('click');
  showToast(soundEnabled ? '⌨️ 기계식 타건음이 켜졌습니다.' : '🔇 무음 모드로 전환되었습니다.', 'info');
}

function updateSoundToggleUI() {
  const icon = document.getElementById('soundIcon');
  if (icon) {
    icon.innerText = soundEnabled ? '⌨️' : '🔇';
  }
}

/**
 * 가상 키패드 입력 처리 (기계식 키캡 느낌)
 */
function inputKeypad(key) {
  playSound('click');
  const amountInput = document.getElementById('amount');
  if (!amountInput) return;

  let curVal = String(amountInput.value || '').replace(/[^0-9]/g, '');

  if (key === 'C') {
    amountInput.value = '';
  } else if (key === 'backspace' || key === 'DEL') {
    amountInput.value = curVal.slice(0, -1);
  } else if (key === '+1만') {
    amountInput.value = (parseInt(curVal || '0', 10) + 10000);
  } else if (key === '+5만') {
    amountInput.value = (parseInt(curVal || '0', 10) + 50000);
  } else if (key === '00') {
    if (curVal && curVal !== '0') {
      amountInput.value = curVal + '00';
    }
  } else {
    // 0-9 숫자
    if (curVal === '0') {
      amountInput.value = key;
    } else {
      amountInput.value = curVal + key;
    }
  }

  // 실시간 체감 가치 환산 트리거
  if (typeof updateValueComparison === 'function') {
    updateValueComparison(amountInput.value);
  }
}


// ==========================================
// 2. Visual Impact: 3D Stamp & Confetti
// ==========================================

function triggerConfetti(type = 'default') {
  if (typeof confetti !== 'function') return;

  if (type === 'waste') {
    confetti({
      particleCount: 40,
      spread: 60,
      origin: { y: 0.6 },
      colors: ['#EF4444', '#F87171', '#FCA5A5']
    });
  } else if (type === 'income') {
    confetti({
      particleCount: 90,
      spread: 80,
      origin: { y: 0.5 },
      colors: ['#10B981', '#34D399', '#FBBF24', '#F59E0B']
    });
  } else {
    confetti({
      particleCount: 75,
      spread: 70,
      origin: { y: 0.55 },
      colors: ['#2563EB', '#3B82F6', '#10B981', '#F59E0B', '#EC4899']
    });
  }
}

function showMindfulStamp(type, amount, consumption_type, satisfaction) {
  const overlay = document.getElementById('mindfulStampOverlay');
  const box = document.getElementById('stampBox');
  const icon = document.getElementById('stampIcon');
  const badge = document.getElementById('stampBadge');
  const amountEl = document.getElementById('stampAmount');
  const msg = document.getElementById('stampMessage');

  if (!overlay || !box) return;

  box.className = 'stamp-box';

  if (type === '수입') {
    icon.innerText = '💰';
    badge.innerText = '소중한 소득 기록!';
    badge.style.color = '#10B981';
    msg.innerText = '자산이 늘어났습니다. 현명하게 관리하세요!';
    playSound('coin');
    triggerConfetti('income');
  } else if (consumption_type === '낭비' || satisfaction === '후회') {
    box.classList.add('stamp-waste');
    icon.innerText = '🛑';
    badge.innerText = '낭비 자각 완료! (+절약력 상승)';
    badge.style.color = '#EF4444';
    msg.innerText = '인지하는 순간 절약이 시작됩니다. 다음엔 꼭 아껴봐요!';
    playSound('warning');
    triggerConfetti('waste');
  } else if (consumption_type === '필수') {
    icon.innerText = '🛡️';
    badge.innerText = '현명한 필수 소비 완료!';
    badge.style.color = '#10B981';
    msg.innerText = '삶에 꼭 필요한 곳에 가치 있게 사용하셨습니다.';
    playSound('coin');
    triggerConfetti('default');
  } else {
    box.classList.add('stamp-want');
    icon.innerText = satisfaction === '만족' ? '✨' : '☕';
    badge.innerText = satisfaction === '만족' ? '가치 있는 행복 충전!' : '선택적 소비 기록 완료!';
    badge.style.color = '#F59E0B';
    msg.innerText = '나를 위한 즐거운 소비! 기분 좋게 인지하셨습니다.';
    playSound('coin');
    triggerConfetti('default');
  }

  if (amountEl) {
    amountEl.innerText = `${formatNumber(amount)}원`;
  }

  overlay.style.display = 'flex';
}

// ==========================================
// 3. Theme Toggle & Utilities
// ==========================================

function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.dataset.theme = savedTheme;
  updateThemeToggleUI(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.dataset.theme || localStorage.getItem('theme') || 'light';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = newTheme;
  localStorage.setItem('theme', newTheme);
  updateThemeToggleUI(newTheme);
  playSound('pop');
}

function updateThemeToggleUI(theme) {
  const toggleBtns = document.querySelectorAll('#themeToggle, .theme-toggle, [data-action="toggle-theme"]');
  toggleBtns.forEach((btn) => {
    const iconLight = btn.querySelector('.theme-icon-light');
    const iconDark = btn.querySelector('.theme-icon-dark');
    if (iconLight && iconDark) {
      if (theme === 'dark') {
        iconLight.style.display = 'none';
        iconDark.style.display = 'inline';
      } else {
        iconLight.style.display = 'inline';
        iconDark.style.display = 'none';
      }
    }
  });
}

function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return Number(num).toLocaleString('ko-KR');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-');
  if (parts.length >= 3) {
    const month = parts[1].padStart(2, '0');
    const day = parts[2].substring(0, 2).padStart(2, '0');
    return `${month}/${day}`;
  }
  return dateStr;
}

function getCurrentMonthString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// ==========================================
// 4. Toast Notifications
// ==========================================

function showToast(message, type = 'success') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${type} toast-${type}`;

  const iconSpan = document.createElement('span');
  iconSpan.className = 'toast-icon';
  if (type === 'success') {
    iconSpan.innerHTML = '✓';
  } else if (type === 'error') {
    iconSpan.innerHTML = '✕';
  } else {
    iconSpan.innerHTML = 'ℹ';
  }

  const textSpan = document.createElement('span');
  textSpan.className = 'toast-message';
  textSpan.textContent = message;

  toast.appendChild(iconSpan);
  toast.appendChild(textSpan);
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('toast--visible', 'show');
  });

  setTimeout(() => {
    toast.classList.remove('toast--visible', 'show');
    toast.classList.add('toast--hide', 'hide');
    setTimeout(() => {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    }, 400);
  }, 3000);
}

// ==========================================
// 5. Transaction Form (add.html)
// ==========================================

let isSubmitting = false;

async function submitTransaction(event) {
  if (event && event.preventDefault) {
    event.preventDefault();
  }

  if (isSubmitting) return;

  const form = document.getElementById('transactionForm') || (event && event.target ? event.target.closest('form') : null);
  if (!form) return;

  const dateInput = form.querySelector('[name="date"], #date');
  const typeInput = form.querySelector('input[name="type"]:checked, #type');
  const amountInput = form.querySelector('[name="amount"], #amount');
  const categoryInput = form.querySelector('[name="category"], #category');
  const descriptionInput = form.querySelector('[name="description"], #description');
  const consumptionTypeInput = form.querySelector('#consumption_type, [name="consumption_type"]');
  const satisfactionInput = form.querySelector('#satisfaction, [name="satisfaction"]');
  const paymentMethodInput = form.querySelector('input[name="payment_method"]:checked, #payment_method');
  const cardNameInput = form.querySelector('#card_name, [name="card_name"]');
  const billingMonthInput = form.querySelector('#billing_month, [name="billing_month"]');
  const installmentInput = form.querySelector('#installment, [name="installment"]');

  const date = dateInput ? dateInput.value.trim() : '';
  const type = typeInput ? typeInput.value.trim() : '지출';
  const rawAmount = amountInput ? String(amountInput.value).replace(/[^0-9]/g, '').trim() : '';
  const amount = Number(rawAmount);
  const category = categoryInput ? categoryInput.value.trim() : '식비';
  const description = descriptionInput ? descriptionInput.value.trim() : '';
  const consumption_type = consumptionTypeInput ? consumptionTypeInput.value.trim() : '선택';
  const satisfaction = satisfactionInput ? satisfactionInput.value.trim() : '보통';
  const payment_method = paymentMethodInput ? paymentMethodInput.value.trim() : (type === '지출' ? '신용카드' : '현금/계좌');
  const card_name = (payment_method === '신용카드' || payment_method === '체크카드') && cardNameInput ? cardNameInput.value.trim() : '';
  const billing_month = billingMonthInput ? billingMonthInput.value.trim() : date.substring(0, 7);
  const installment = installmentInput ? Number(installmentInput.value || 1) : 1;

  // Validation
  if (!date) {
    showToast('날짜를 입력해주세요.', 'error');
    if (dateInput) dateInput.focus();
    return;
  }
  if (!amount || isNaN(amount) || amount <= 0) {
    showToast('올바른 금액을 입력해주세요.', 'error');
    if (amountInput) amountInput.focus();
    return;
  }

  const payload = {
    date,
    type,
    amount,
    category,
    description,
    consumption_type,
    satisfaction,
    payment_method,
    card_name,
    billing_month,
    installment
  };

  const submitBtn = form.querySelector('button[type="submit"], .btn-submit');
  const originalBtnText = submitBtn ? submitBtn.innerHTML : '💾 저장하기';

  isSubmitting = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '⏳ 소비 자각 중...';
  }

  try {
    const response = await fetch('/api/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || '거래 내역 저장에 실패했습니다.');
    }

    // 💥 3D Stamp & Sound & Confetti Trigger
    showMindfulStamp(type, amount, consumption_type, satisfaction);

    // Redirect to dashboard after satisfying stamp animation
    setTimeout(() => {
      window.location.href = `/?month=${date.substring(0, 7)}`;
    }, 1400);
  } catch (error) {
    console.error('Error submitting transaction:', error);
    showToast(error.message || '저장 중 오류가 발생했습니다.', 'error');
    isSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  }
}

// ==========================================
// 6. Transaction Edit & Delete (history.html)
// ==========================================

function openEditModal(id, date, type, amount, category, description, consumption_type, satisfaction, payment_method, card_name, billing_month, installment) {
  const modal = document.getElementById('editModal');
  if (!modal) return;

  const idInput = modal.querySelector('#editId');
  const dateInput = modal.querySelector('#editDate');
  const typeInput = modal.querySelector('#editType');
  const amountInput = modal.querySelector('#editAmount');
  const categoryInput = modal.querySelector('#editCategory');
  const cTypeInput = modal.querySelector('#editConsumptionType');
  const satInput = modal.querySelector('#editSatisfaction');
  const pmInput = modal.querySelector('#editPaymentMethod');
  const cardInput = modal.querySelector('#editCardName');
  const descriptionInput = modal.querySelector('#editDescription');

  if (idInput) idInput.value = id || '';
  if (dateInput) dateInput.value = date || '';
  if (typeInput) typeInput.value = type || '지출';
  if (amountInput) amountInput.value = amount || '';
  if (categoryInput) categoryInput.value = category || '기타';
  if (cTypeInput) cTypeInput.value = consumption_type || '선택';
  if (satInput) satInput.value = satisfaction || '보통';
  if (pmInput) pmInput.value = payment_method || '신용카드';
  if (cardInput) cardInput.value = card_name || '';
  if (descriptionInput) descriptionInput.value = description || '';

  modal.style.display = 'flex';
  modal.classList.add('show');
}

function closeEditModal() {
  const modal = document.getElementById('editModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('show');
  }
}

async function submitEdit(event) {
  if (event && event.preventDefault) {
    event.preventDefault();
  }

  const modal = document.getElementById('editModal');
  const form = document.getElementById('editForm') || (modal ? modal.querySelector('form') : null);
  if (!form) return;

  const id = form.querySelector('#editId')?.value;
  const date = form.querySelector('#editDate')?.value.trim();
  const type = form.querySelector('#editType')?.value.trim() || '지출';
  const rawAmount = String(form.querySelector('#editAmount')?.value || '').replace(/[^0-9]/g, '');
  const amount = Number(rawAmount);
  const category = form.querySelector('#editCategory')?.value.trim() || '기타';
  const consumption_type = form.querySelector('#editConsumptionType')?.value.trim() || '선택';
  const satisfaction = form.querySelector('#editSatisfaction')?.value.trim() || '보통';
  const payment_method = form.querySelector('#editPaymentMethod')?.value.trim() || '신용카드';
  const card_name = form.querySelector('#editCardName')?.value.trim() || '';
  const description = form.querySelector('#editDescription')?.value.trim() || '';

  if (!id || !date || !amount) {
    showToast('필수 항목을 모두 입력해주세요.', 'error');
    return;
  }

  const payload = {
    date,
    type,
    amount,
    category,
    description,
    consumption_type,
    satisfaction,
    payment_method,
    card_name
  };
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const response = await fetch(`/api/transactions/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || '수정에 실패했습니다.');
    }

    playSound('coin');
    showToast('수정되었습니다.', 'success');
    closeEditModal();

    setTimeout(() => {
      window.location.reload();
    }, 700);
  } catch (error) {
    console.error('Error updating transaction:', error);
    showToast(error.message || '수정 중 오류가 발생했습니다.', 'error');
    if (submitBtn) submitBtn.disabled = false;
  }
}

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || '수정에 실패했습니다.');
    }

    playSound('coin');
    showToast('수정되었습니다.', 'success');
    closeEditModal();

    setTimeout(() => {
      window.location.reload();
    }, 700);
  } catch (error) {
    console.error('Error updating transaction:', error);
    showToast(error.message || '수정 중 오류가 발생했습니다.', 'error');
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function deleteTransaction(id) {
  if (!confirm('정말 이 내역을 삭제하시겠습니까?')) {
    return;
  }

  try {
    const response = await fetch(`/api/transactions/${id}`, {
      method: 'DELETE',
      headers: { 'Accept': 'application/json' }
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || '삭제에 실패했습니다.');
    }

    const row = document.getElementById(`row-${id}`) || document.querySelector(`tr[data-id="${id}"]`);
    if (row && row.parentElement) {
      row.parentElement.removeChild(row);
    }

    playSound('pop');
    showToast('삭제되었습니다.', 'success');
  } catch (error) {
    console.error('Error deleting transaction:', error);
    showToast(error.message || '삭제 중 오류가 발생했습니다.', 'error');
  }
}

// ==========================================
// 7. Dashboard Charts (dashboard.html)
// ==========================================

async function loadDashboardCharts(month) {
  const categoryCanvas = document.getElementById('categoryChart');
  const dailyCanvas = document.getElementById('dailyChart');

  if (!categoryCanvas && !dailyCanvas) return;

  const targetMonth = month || getCurrentMonthString();

  try {
    const [catRes, dailyRes] = await Promise.all([
      fetch(`/api/summary/category?month=${targetMonth}`),
      fetch(`/api/summary/daily?month=${targetMonth}`)
    ]);

    const catData = catRes.ok ? await catRes.json() : [];
    const dailyData = dailyRes.ok ? await dailyRes.json() : [];

    if (categoryCanvas && typeof Chart !== 'undefined') {
      renderCategoryChart(categoryCanvas, catData);
    }
    if (dailyCanvas && typeof Chart !== 'undefined') {
      renderDailyChart(dailyCanvas, dailyData);
    }
  } catch (error) {
    console.error('Error loading dashboard charts:', error);
  }
}

function renderCategoryChart(canvas, data) {
  if (categoryChartInstance) {
    categoryChartInstance.destroy();
    categoryChartInstance = null;
  }

  const items = Array.isArray(data) ? data : [];
  if (items.length === 0) return;

  const labels = items.map(item => {
    const cat = item.category || '기타';
    const emoji = CATEGORY_EMOJI[cat] ? `${CATEGORY_EMOJI[cat]} ` : '';
    return `${emoji}${cat}`;
  });

  const amounts = items.map(item => Number(item.total || 0));
  const backgroundColors = items.map(item => CATEGORY_COLORS[item.category] || '#95A5A6');

  categoryChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: amounts,
        backgroundColor: backgroundColors,
        borderWidth: 2,
        borderColor: document.documentElement.dataset.theme === 'dark' ? '#1E293B' : '#FFFFFF',
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 12,
            usePointStyle: true,
            pointStyle: 'circle',
            font: { size: 12, family: "'Pretendard', sans-serif" },
            color: document.documentElement.dataset.theme === 'dark' ? '#E2E8F0' : '#475569'
          }
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              const value = context.raw || 0;
              const total = amounts.reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              return ` ${formatNumber(value)}원 (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

function renderDailyChart(canvas, data) {
  if (dailyChartInstance) {
    dailyChartInstance.destroy();
    dailyChartInstance = null;
  }

  const items = Array.isArray(data) ? data : [];
  if (items.length === 0) return;

  const labels = items.map(item => formatDate(item.date));
  const amounts = items.map(item => Number(item.total || 0));

  dailyChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '일별 지출',
        data: amounts,
        borderColor: '#4ECDC4',
        backgroundColor: 'rgba(78, 205, 196, 0.12)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#4ECDC4',
        pointBorderColor: '#FFFFFF',
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: document.documentElement.dataset.theme === 'dark' ? '#94A3B8' : '#64748B',
            font: { size: 11, family: "'Pretendard', sans-serif" }
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: document.documentElement.dataset.theme === 'dark' ? '#334155' : '#E2E8F0'
          },
          ticks: {
            color: document.documentElement.dataset.theme === 'dark' ? '#94A3B8' : '#64748B',
            font: { size: 11, family: "'Pretendard', sans-serif" },
            callback: function (value) {
              if (value >= 10000) return (value / 10000).toLocaleString() + '만';
              return formatNumber(value);
            }
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (context) {
              return ` 지출: ${formatNumber(context.raw)}원`;
            }
          }
        }
      }
    }
  });
}

// ==========================================
// 8. Budget Goals (goals.html)
// ==========================================

async function submitBudget(event) {
  if (event && event.preventDefault) {
    event.preventDefault();
  }

  const form = document.getElementById('budgetForm');
  if (!form) return;

  const month = form.querySelector('#budgetMonth')?.value.trim() || getCurrentMonthString();
  const category = form.querySelector('#budgetCategory')?.value.trim() || '전체';
  const rawAmount = String(form.querySelector('#budgetAmount')?.value || '').replace(/[^0-9]/g, '');
  const budget_amount = Number(rawAmount);

  if (isNaN(budget_amount) || budget_amount <= 0) {
    showToast('올바른 예산 금액을 입력해주세요.', 'error');
    return;
  }

  const payload = { month, category, budget_amount };
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const response = await fetch('/api/budgets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || '예산 설정에 실패했습니다.');
    }

    playSound('coin');
    triggerConfetti('default');
    showToast('예산이 저장되었습니다.', 'success');
    setTimeout(() => {
      window.location.reload();
    }, 800);
  } catch (error) {
    console.error('Error setting budget:', error);
    showToast(error.message || '예산 저장 중 오류가 발생했습니다.', 'error');
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ==========================================
// 9. Global Initialization & Exports
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  updateSoundToggleUI();

  // ⌨️ 글로벌 기계식 키보드 타건 리스너 (입력창 타이핑 시 실시간 찰진 타건음 재생)
  window.addEventListener('keydown', (e) => {
    // Escape or special modifier keys bypass
    if (['Alt', 'Control', 'Shift', 'Meta'].includes(e.key)) return;

    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
      playSound('click');
    }
  });
});

window.CATEGORY_COLORS = CATEGORY_COLORS;
window.CATEGORY_EMOJI = CATEGORY_EMOJI;
window.toggleTheme = toggleTheme;
window.toggleSound = toggleSound;
window.playSound = playSound;
window.inputKeypad = inputKeypad;
window.triggerConfetti = triggerConfetti;
window.showMindfulStamp = showMindfulStamp;
window.formatNumber = formatNumber;
window.formatDate = formatDate;
window.showToast = showToast;
window.submitTransaction = submitTransaction;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.submitEdit = submitEdit;
window.deleteTransaction = deleteTransaction;
window.loadDashboardCharts = loadDashboardCharts;
window.submitBudget = submitBudget;

