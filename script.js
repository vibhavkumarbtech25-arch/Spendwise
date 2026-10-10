'use strict';

/* =====================================================
   CONFIG
===================================================== */
const CATS = {
  Food:          { icon: '🍔', color: '#f97316' },
  Travel:        { icon: '🚌', color: '#0ea5e9' },
  College:       { icon: '🎓', color: '#8b5cf6' },
  Shopping:      { icon: '🛍️', color: '#ec4899' },
  Entertainment: { icon: '🎬', color: '#eab308' },
  Health:        { icon: '💊', color: '#10b981' },
  Rent:          { icon: '🏠', color: '#64748b' },
  Other:         { icon: '📦', color: '#a855f7' },
};
const PAYMENTS = ['UPI', 'Cash', 'Card'];
const VIEWS = {
  dashboard:    ['Dashboard',    'Your money at a glance'],
  transactions: ['Transactions', 'Search, filter and edit every expense'],
  goals:        ['Savings goals','Save towards the things that matter'],
  recurring:    ['Recurring',    'Subscriptions and monthly bills, on autopilot'],
  settings:     ['Settings',     'Theme, export and backups'],
};

/* =====================================================
   HELPERS
===================================================== */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthOf = (s) => s.slice(0, 7);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const sum = (arr) => arr.reduce((s, e) => s + e.amount, 0);
const catOf = (e) => (CATS[e.category] ? e.category : 'Other');
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmtDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const monthLabel = (m, short) => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: short ? 'short' : 'long', year: short ? '2-digit' : 'numeric' });

function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function daysIn(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo, 0).getDate();
}
const monthExp = (m) => state.expenses.filter((e) => monthOf(e.date) === m);
const level = (pct) => (pct >= 100 ? 'over' : pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : 'ok');
const LEVELS = ['ok', 'warn', 'danger', 'over'];

let toastTimer;
function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* =====================================================
   STATE + STORAGE
===================================================== */
const load = (k, d) => {
  try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; }
};

const state = {
  // falls back to keys from the older version of the app
  expenses:  load('sw_expenses', load('expenses', [])),
  budget:    Number(load('sw_budget', load('budget', 0))) || 0,
  goals:     load('sw_goals', []),
  recurring: load('sw_recurring', []),
  theme:     load('sw_theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  month:     monthOf(localISO(new Date())),
};

let view = 'dashboard';
let editingId = null;
let fundsGoalId = null;
let charts = {};

function persist() {
  try {
    localStorage.setItem('sw_expenses', JSON.stringify(state.expenses));
    localStorage.setItem('sw_budget', JSON.stringify(state.budget));
    localStorage.setItem('sw_goals', JSON.stringify(state.goals));
    localStorage.setItem('sw_recurring', JSON.stringify(state.recurring));
    localStorage.setItem('sw_theme', JSON.stringify(state.theme));
  } catch {
    toast('Could not save — browser storage is full or blocked.', 'error');
  }
}

/* =====================================================
   THEME
===================================================== */
const chartOK = () => typeof Chart !== 'undefined';

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  $('themeBtn').textContent = state.theme === 'dark' ? '☀️' : '🌙';
  $('themeSwitch').checked = state.theme === 'dark';
  if (chartOK()) {
    Chart.defaults.color = cssVar('--muted');
    Chart.defaults.borderColor = cssVar('--border');
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  }
}

function toggleTheme(dark) {
  state.theme = dark ? 'dark' : 'light';
  persist();
  applyTheme();
  Object.values(charts).forEach((c) => c.destroy());
  charts = {};
  render();
}

/* =====================================================
   NAVIGATION
===================================================== */
function setView(v) {
  view = v;
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('viewTitle').textContent = VIEWS[v][0];
  $('viewSub').textContent = VIEWS[v][1];
  $('monthNav').style.display = v === 'dashboard' ? '' : 'none';
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  if (view === 'dashboard') renderDashboard();
  else if (view === 'transactions') renderTransactions();
  else if (view === 'goals') renderGoals();
  else if (view === 'recurring') renderRecurring();
  else if (view === 'settings') renderSettings();
}

/* =====================================================
   DASHBOARD
===================================================== */
function renderDashboard() {
  const m = state.month;
  const cur = monthExp(m);
  const total = sum(cur);
  const prevTotal = sum(monthExp(shiftMonth(m, -1)));

  const todayStr = localISO(new Date());
  const curMonth = monthOf(todayStr);
  const dayNum = m === curMonth ? Number(todayStr.slice(8)) : m > curMonth ? 1 : daysIn(m);

  // Hero
  $('heroLabel').textContent = `Spent in ${monthLabel(m)}`;
  $('heroTotal').textContent = money(total);
  const chg = $('heroChange');
  if (prevTotal > 0) {
    const p = ((total - prevTotal) / prevTotal) * 100;
    chg.textContent = `${p > 0 ? '▲' : p < 0 ? '▼' : '•'} ${Math.abs(p).toFixed(0)}% vs last month`;
  } else {
    chg.textContent = 'No data for last month';
  }

  // Stats
  if (state.budget) {
    const left = state.budget - total;
    $('statLeft').textContent = money(Math.max(left, 0));
    $('statLeftSub').textContent = left < 0 ? `Over by ${money(-left)}` : `of ${money(state.budget)}`;
  } else {
    $('statLeft').textContent = '—';
    $('statLeftSub').textContent = 'No budget set';
  }
  $('statAvg').textContent = money(total / dayNum);

  const byCat = {};
  cur.forEach((e) => (byCat[catOf(e)] = (byCat[catOf(e)] || 0) + e.amount));
  const ranked = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (ranked.length) {
    $('statTop').textContent = `${CATS[ranked[0][0]].icon} ${ranked[0][0]}`;
    $('statTopSub').textContent = money(ranked[0][1]);
  } else {
    $('statTop').textContent = '—';
    $('statTopSub').textContent = '';
  }

  renderBudget(total, m, curMonth, dayNum);
  renderInsights(cur, total, prevTotal, byCat, ranked, m, curMonth, dayNum);
  renderCharts(cur, total, ranked, m);

  // Recent
  const recent = [...cur].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $('recentList').innerHTML = recent.map((e) => txRow(e, true)).join('');
  $('recentEmpty').style.display = recent.length ? 'none' : 'block';
}

function renderBudget(total, m, curMonth, dayNum) {
  const box = $('budgetAlert');
  const bar = $('progressBar');
  if (document.activeElement !== $('budgetInput')) $('budgetInput').value = state.budget || '';

  if (!state.budget) {
    box.className = 'alert none';
    box.textContent = 'Set a monthly budget to get smart alerts at 75%, 90% and 100%.';
    bar.style.width = '0%';
    $('budgetPct').textContent = '';
    $('budgetMeta').textContent = '';
    return;
  }

  const pct = (total / state.budget) * 100;
  const lv = level(pct);
  const left = state.budget - total;
  const msgs = {
    ok:     `✅ ${pct.toFixed(0)}% of your budget used — you're on track.`,
    warn:   `⚠️ You've used ${pct.toFixed(0)}% of your budget. Slow down a little.`,
    danger: `⚠️ ${pct.toFixed(0)}% used — only ${money(left)} left this month!`,
    over:   `🚨 You've exceeded your budget by ${money(-left)}.`,
  };
  box.className = 'alert ' + lv;
  box.textContent = msgs[lv];
  bar.className = lv;
  bar.style.width = Math.min(pct, 100) + '%';
  $('budgetPct').textContent = pct.toFixed(0) + '%';

  if (m === curMonth && total > 0) {
    const proj = (total / dayNum) * daysIn(m);
    $('budgetMeta').textContent =
      `At this pace you'll spend about ${money(proj)} this month` +
      (proj > state.budget ? ` — ${money(proj - state.budget)} over budget.` : '.');
  } else {
    $('budgetMeta').textContent = '';
  }
}

function renderInsights(cur, total, prevTotal, byCat, ranked, m, curMonth, dayNum) {
  const out = [];

  if (!cur.length) {
    out.push(['💡', 'Add a few expenses and SpendWise will start spotting patterns for you.']);
  } else {
    // Top category share
    const [topCat, topAmt] = ranked[0];
    out.push([CATS[topCat].icon, `${topCat} accounts for ${((topAmt / total) * 100).toFixed(0)}% of your spending.`]);

    // vs last month
    if (prevTotal > 0) {
      const p = ((total - prevTotal) / prevTotal) * 100;
      if (Math.abs(p) >= 1) {
        out.push([p < 0 ? '📉' : '📈', `You spent ${Math.abs(p).toFixed(0)}% ${p < 0 ? 'less' : 'more'} than last month.`]);
      }
    }

    // Biggest category jump
    const prevByCat = {};
    monthExp(shiftMonth(m, -1)).forEach((e) => (prevByCat[catOf(e)] = (prevByCat[catOf(e)] || 0) + e.amount));
    let surge = null;
    Object.entries(byCat).forEach(([c, v]) => {
      const pv = prevByCat[c] || 0;
      if (pv > 0 && v > pv * 1.3 && v - pv >= 100) {
        const up = ((v - pv) / pv) * 100;
        if (!surge || up > surge.up) surge = { c, up };
      }
    });
    if (surge) out.push(['🔥', `${surge.c} spending is up ${surge.up.toFixed(0)}% compared with last month.`]);

    // Biggest single expense
    const big = [...cur].sort((a, b) => b.amount - a.amount)[0];
    out.push(['💸', `Your biggest expense was “${big.title}” at ${money(big.amount)}.`]);

    // Projection
    if (state.budget && m === curMonth) {
      const proj = (total / dayNum) * daysIn(m);
      out.push(proj > state.budget
        ? ['🧭', `Projected spend is ${money(proj)} — about ${money(proj - state.budget)} over your budget.`]
        : ['🧭', `Projected spend is ${money(proj)}, safely within your budget.`]);
    }
  }

  // Goals nudge
  const open = state.goals.filter((g) => g.saved < g.target).sort((a, b) => (b.saved / b.target) - (a.saved / a.target))[0];
  if (open) {
    out.push(['🎯', `“${open.name}” is ${((open.saved / open.target) * 100).toFixed(0)}% funded — ${money(open.target - open.saved)} to go.`]);
  }

  $('insights').innerHTML = out.slice(0, 6).map(([i, t]) => `<li><span>${i}</span><span>${esc(t)}</span></li>`).join('');
}

/* ---------- Charts ---------- */
function toggleEmpty(boxId, hasData) {
  $(boxId).classList.toggle('empty', !hasData);
}

function upsertChart(key, canvasId, config) {
  if (charts[key]) {
    charts[key].data = config.data;
    charts[key].options = config.options;
    charts[key].update();
  } else {
    charts[key] = new Chart($(canvasId), config);
  }
}

function renderCharts(cur, total, ranked, m) {
  if (!chartOK()) {
    document.querySelectorAll('.chart-box').forEach((b) => {
      b.innerHTML = '<p class="empty-mini" style="display:grid">Charts need an internet connection to load Chart.js.</p>';
    });
    return;
  }

  const primary = cssVar('--primary');
  const yTicks = { callback: (v) => '₹' + v.toLocaleString('en-IN') };

  // Category doughnut + legend
  toggleEmpty('catBox', total > 0);
  if (total > 0) {
    upsertChart('cat', 'catChart', {
      type: 'doughnut',
      data: {
        labels: ranked.map(([c]) => c),
        datasets: [{
          data: ranked.map(([, v]) => v),
          backgroundColor: ranked.map(([c]) => CATS[c].color),
          borderColor: cssVar('--surface'),
          borderWidth: 3,
        }],
      },
      options: {
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.label}: ${money(c.parsed)}` } },
        },
      },
    });
  }
  $('catLegend').innerHTML = ranked.map(([c, v]) => `
    <div class="legend-row">
      <span class="dot" style="background:${CATS[c].color}"></span>
      <span class="name">${CATS[c].icon} ${c}</span>
      <span>${money(v)}</span>
      <span class="pct">${((v / total) * 100).toFixed(0)}%</span>
    </div>`).join('');

  // Daily trend
  toggleEmpty('trendBox', total > 0);
  if (total > 0) {
    const dim = daysIn(m);
    const daily = Array(dim).fill(0);
    cur.forEach((e) => { daily[Number(e.date.slice(8, 10)) - 1] += e.amount; });
    upsertChart('trend', 'trendChart', {
      type: 'line',
      data: {
        labels: daily.map((_, i) => i + 1),
        datasets: [{
          label: 'Spent',
          data: daily,
          borderColor: primary,
          backgroundColor: 'rgba(108, 92, 231, 0.15)',
          fill: true,
          tension: 0.35,
          pointRadius: 2,
          pointHoverRadius: 5,
        }],
      },
      options: {
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: yTicks }, x: { grid: { display: false } } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: (i) => `Day ${i[0].label}`, label: (c) => ' ' + money(c.parsed.y) } },
        },
      },
    });
  }

  // 6-month comparison
  const months = [5, 4, 3, 2, 1, 0].map((i) => shiftMonth(m, -i));
  const totals = months.map((x) => sum(monthExp(x)));
  const hasAny = totals.some((t) => t > 0);
  toggleEmpty('compareBox', hasAny);
  if (hasAny) {
    upsertChart('compare', 'compareChart', {
      type: 'bar',
      data: {
        labels: months.map((x) => monthLabel(x, true)),
        datasets: [{
          data: totals,
          backgroundColor: months.map((x) => (x === m ? primary : primary + '55')),
          borderRadius: 8,
        }],
      },
      options: {
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: yTicks }, x: { grid: { display: false } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + money(c.parsed.y) } } },
      },
    });
  }
}

/* =====================================================
   TRANSACTIONS
===================================================== */
function txRow(e, withActions) {
  const c = CATS[catOf(e)];
  return `
    <li class="tx">
      <div class="tx-icon" style="background:${c.color}22">${c.icon}</div>
      <div class="tx-info">
        <strong>${esc(e.title)}</strong>
        <small>${esc(catOf(e))} · ${esc(e.payment || '—')} · ${fmtDate(e.date)}${e.recurringId ? ' · 🔁' : ''}</small>
        ${e.note ? `<small class="note">${esc(e.note)}</small>` : ''}
      </div>
      <div class="tx-amt">-${money(e.amount)}</div>
      ${withActions ? `
        <div class="tx-actions">
          <button class="icon-sm" data-act="edit" data-id="${esc(e.id)}" aria-label="Edit">✏️</button>
          <button class="icon-sm" data-act="del" data-id="${esc(e.id)}" aria-label="Delete">🗑️</button>
        </div>` : ''}
    </li>`;
}

function renderTransactions() {
  const q = $('search').value.trim().toLowerCase();
  const cat = $('fCat').value;
  const from = $('fFrom').value;
  const to = $('fTo').value;

  const items = state.expenses.filter((e) =>
    (cat === 'all' || catOf(e) === cat) &&
    (!from || e.date >= from) &&
    (!to || e.date <= to) &&
    (!q || e.title.toLowerCase().includes(q) || (e.note || '').toLowerCase().includes(q))
  );

  const sorters = {
    dateDesc: (a, b) => b.date.localeCompare(a.date),
    dateAsc:  (a, b) => a.date.localeCompare(b.date),
    amtDesc:  (a, b) => b.amount - a.amount,
    amtAsc:   (a, b) => a.amount - b.amount,
  };
  items.sort(sorters[$('fSort').value]);

  const LIMIT = 200;
  $('txList').innerHTML = items.slice(0, LIMIT).map((e) => txRow(e, true)).join('');
  $('txEmpty').style.display = items.length ? 'none' : 'block';
  $('txSummary').textContent = items.length
    ? `${items.length} transaction${items.length > 1 ? 's' : ''} · total ${money(sum(items))}` +
      (items.length > LIMIT ? ` · showing first ${LIMIT}` : '')
    : '';
}

/* =====================================================
   EXPENSE MODAL (add / edit / delete)
===================================================== */
function openExpenseModal(id) {
  editingId = id || null;
  const e = id ? state.expenses.find((x) => String(x.id) === String(id)) : null;
  $('modalTitle').textContent = e ? 'Edit expense' : 'Add expense';
  $('saveBtn').textContent = e ? 'Update' : 'Save';
  $('eTitle').value = e ? e.title : '';
  $('eAmount').value = e ? e.amount : '';
  $('eDate').value = e ? e.date : localISO(new Date());
  $('eCat').value = e ? catOf(e) : 'Food';
  $('ePay').value = e && PAYMENTS.includes(e.payment) ? e.payment : 'UPI';
  $('eNote').value = e ? e.note || '' : '';
  $('expenseModal').showModal();
  $('eTitle').focus();
}

function saveExpense(ev) {
  ev.preventDefault();
  const d = {
    title: $('eTitle').value.trim(),
    amount: Math.round(Number($('eAmount').value) * 100) / 100,
    date: $('eDate').value,
    category: $('eCat').value,
    payment: $('ePay').value,
    note: $('eNote').value.trim(),
  };
  if (!d.title || !(d.amount > 0) || !d.date) return toast('Please enter a title, amount and date.', 'error');

  const targetMonth = monthOf(d.date);
  const before = sum(monthExp(targetMonth));

  let msg;
  if (editingId) {
    const i = state.expenses.findIndex((x) => String(x.id) === String(editingId));
    if (i > -1) state.expenses[i] = { ...state.expenses[i], ...d };
    msg = 'Expense updated ✏️';
  } else {
    state.expenses.push({ id: uid(), ...d });
    msg = 'Expense added ✅';
  }
  persist();
  $('expenseModal').close();

  // Budget threshold alert
  let alertMsg = null;
  if (state.budget) {
    const b = level((before / state.budget) * 100);
    const afterPct = (sum(monthExp(targetMonth)) / state.budget) * 100;
    const a = level(afterPct);
    if (LEVELS.indexOf(a) > LEVELS.indexOf(b)) {
      alertMsg = a === 'over'
        ? `🚨 Budget exceeded for ${monthLabel(targetMonth)}!`
        : `⚠️ ${afterPct.toFixed(0)}% of your ${monthLabel(targetMonth)} budget used.`;
    }
  }
  toast(alertMsg || msg, alertMsg ? (alertMsg.startsWith('🚨') ? 'error' : 'warn') : '');

  state.month = targetMonth;
  $('monthPicker').value = state.month;
  render();
}

function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  state.expenses = state.expenses.filter((e) => String(e.id) !== String(id));
  persist();
  render();
  toast('Expense deleted 🗑️');
}

/* =====================================================
   GOALS
===================================================== */
function renderGoals() {
  $('goalEmpty').style.display = state.goals.length ? 'none' : 'block';
  $('goalList').innerHTML = state.goals.map((g) => {
    const pct = Math.min((g.saved / g.target) * 100, 100);
    const remaining = Math.max(g.target - g.saved, 0);
    const done = remaining === 0;

    let hint = 'No deadline set';
    if (done) hint = '🎉 Goal reached!';
    else if (g.deadline) {
      const ms = new Date(g.deadline + 'T00:00:00') - new Date();
      if (ms <= 0) hint = 'Deadline has passed';
      else {
        const months = Math.max(1, Math.ceil(ms / (30.44 * 86400000)));
        hint = `Save ~${money(Math.ceil(remaining / months))}/month to finish by ${fmtDate(g.deadline)}`;
      }
    }

    return `
      <div class="card">
        <div class="goal-head">
          <div><h3>${esc(g.name)}</h3><small class="muted">${esc(hint)}</small></div>
          <span class="pct-pill ${done ? 'done' : ''}">${pct.toFixed(0)}%</span>
        </div>
        <div class="progress"><div class="${done ? 'ok' : ''}" style="width:${pct}%"></div></div>
        <div class="goal-nums"><span><strong>${money(g.saved)}</strong> saved</span><span>of ${money(g.target)}</span></div>
        <div class="goal-actions">
          <button class="btn soft" data-act="funds" data-id="${esc(g.id)}">＋ Add funds</button>
          <button class="icon-sm" data-act="goalDel" data-id="${esc(g.id)}" aria-label="Delete goal">🗑️</button>
        </div>
      </div>`;
  }).join('');
}

function addGoal(ev) {
  ev.preventDefault();
  const target = Number($('gTarget').value);
  const saved = Math.max(Number($('gSaved').value) || 0, 0);
  const name = $('gName').value.trim();
  if (!name || !(target > 0)) return toast('Enter a name and a target amount.', 'error');
  state.goals.push({ id: uid(), name, target, saved, deadline: $('gDeadline').value || '' });
  persist();
  $('goalForm').reset();
  renderGoals();
  toast('Goal created 🎯');
}

function openFunds(id) {
  const g = state.goals.find((x) => String(x.id) === String(id));
  if (!g) return;
  fundsGoalId = id;
  $('fundsTitle').textContent = `Add funds to “${g.name}”`;
  $('fAmount').value = '';
  $('fundsModal').showModal();
  $('fAmount').focus();
}

function addFunds(ev) {
  ev.preventDefault();
  const amt = Number($('fAmount').value);
  const g = state.goals.find((x) => String(x.id) === String(fundsGoalId));
  if (!g || !(amt > 0)) return;
  const wasDone = g.saved >= g.target;
  g.saved += amt;
  persist();
  $('fundsModal').close();
  renderGoals();
  toast(!wasDone && g.saved >= g.target ? `🎉 Goal “${g.name}” reached!` : 'Funds added 💰');
}

function deleteGoal(id) {
  if (!confirm('Delete this goal?')) return;
  state.goals = state.goals.filter((g) => String(g.id) !== String(id));
  persist();
  renderGoals();
}

/* =====================================================
   RECURRING
===================================================== */
function processRecurring() {
  const today = localISO(new Date());
  const curMonth = monthOf(today);
  let added = 0;

  state.recurring.forEach((r) => {
    if (!r.active) return;
    r.generated = r.generated || [];
    for (let m = r.startMonth; m <= curMonth; m = shiftMonth(m, 1)) {
      if (r.generated.includes(m)) continue;
      const date = `${m}-${pad(Math.min(r.day, daysIn(m)))}`;
      if (date > today) continue;
      state.expenses.push({
        id: uid(), title: r.title, amount: r.amount, date,
        category: r.category, payment: r.payment, note: 'Recurring', recurringId: r.id,
      });
      r.generated.push(m);
      added++;
    }
  });

  if (added) {
    persist();
    toast(`🔁 ${added} recurring expense${added > 1 ? 's' : ''} added automatically`);
  }
}

function renderRecurring() {
  const active = state.recurring.filter((r) => r.active);
  $('recTotal').textContent = `${money(sum(active))} / month`;
  $('recEmpty').style.display = state.recurring.length ? 'none' : 'block';
  $('recList').innerHTML = state.recurring.map((r) => {
    const c = CATS[CATS[r.category] ? r.category : 'Other'];
    return `
      <li class="tx" style="${r.active ? '' : 'opacity:.55'}">
        <div class="tx-icon" style="background:${c.color}22">${c.icon}</div>
        <div class="tx-info">
          <strong>${esc(r.title)}</strong>
          <small>${esc(r.category)} · ${esc(r.payment)} · day ${r.day} of every month${r.active ? '' : ' · paused'}</small>
        </div>
        <div class="tx-amt">${money(r.amount)}</div>
        <div class="tx-actions">
          <label class="switch" title="Pause / resume">
            <input type="checkbox" data-act="recToggle" data-id="${esc(r.id)}" ${r.active ? 'checked' : ''} /><span></span>
          </label>
          <button class="icon-sm" data-act="recDel" data-id="${esc(r.id)}" aria-label="Delete">🗑️</button>
        </div>
      </li>`;
  }).join('');
}

function addRecurring(ev) {
  ev.preventDefault();
  const r = {
    id: uid(),
    title: $('rTitle').value.trim(),
    amount: Number($('rAmount').value),
    category: $('rCat').value,
    payment: $('rPay').value,
    day: Math.min(Math.max(parseInt($('rDay').value, 10) || 1, 1), 31),
    startMonth: monthOf(localISO(new Date())),
    active: true,
    generated: [],
  };
  if (!r.title || !(r.amount > 0)) return toast('Enter a title and amount.', 'error');
  state.recurring.push(r);
  persist();
  $('recForm').reset();
  $('rDay').value = 1;
  processRecurring();
  renderRecurring();
  toast('Recurring expense saved 🔁');
}

function toggleRecurring(id, on) {
  const r = state.recurring.find((x) => String(x.id) === String(id));
  if (!r) return;
  r.active = on;
  if (on) r.startMonth = monthOf(localISO(new Date())); // don't backfill the paused period
  persist();
  if (on) processRecurring();
  renderRecurring();
}

function deleteRecurring(id) {
  if (!confirm('Delete this recurring expense? Past transactions stay in your history.')) return;
  state.recurring = state.recurring.filter((r) => String(r.id) !== String(id));
  persist();
  renderRecurring();
}

/* =====================================================
   SETTINGS: export / backup / restore / clear
===================================================== */
function renderSettings() {
  $('storageInfo').textContent =
    `${state.expenses.length} expenses · ${state.goals.length} goals · ${state.recurring.length} recurring items`;
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV() {
  if (!state.expenses.length) return toast('Nothing to export yet.');
  // Prefix risky cells so spreadsheets don't treat them as formulas
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = [['Date', 'Title', 'Category', 'Payment', 'Amount', 'Note']];
  [...state.expenses].sort((a, b) => a.date.localeCompare(b.date)).forEach((e) =>
    rows.push([e.date, e.title, catOf(e), e.payment || '', e.amount, e.note || '']));
  download('spendwise-expenses.csv', '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  toast('CSV exported ✅');
}

function backup() {
  const data = {
    app: 'SpendWise', version: 1, exportedAt: new Date().toISOString(),
    expenses: state.expenses, budget: state.budget, goals: state.goals, recurring: state.recurring,
  };
  download(`spendwise-backup-${localISO(new Date())}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('Backup downloaded 💾');
}

function sanitizeBackup(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.expenses)) throw new Error('This is not a valid SpendWise backup.');
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isMonth = (s) => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
  const cat = (c) => (CATS[c] ? c : 'Other');
  const pay = (p) => (PAYMENTS.includes(p) ? p : 'UPI');

  const expenses = d.expenses
    .filter((e) => e && typeof e.title === 'string' && Number(e.amount) > 0 && isDate(e.date))
    .map((e) => ({
      id: String(e.id ?? uid()), title: e.title.slice(0, 60), amount: Number(e.amount), date: e.date,
      category: cat(e.category), payment: pay(e.payment), note: String(e.note || '').slice(0, 100),
      ...(e.recurringId ? { recurringId: String(e.recurringId) } : {}),
    }));

  const goals = (Array.isArray(d.goals) ? d.goals : [])
    .filter((g) => g && typeof g.name === 'string' && Number(g.target) > 0)
    .map((g) => ({
      id: String(g.id ?? uid()), name: g.name.slice(0, 40), target: Number(g.target),
      saved: Math.max(Number(g.saved) || 0, 0), deadline: isDate(g.deadline) ? g.deadline : '',
    }));

  const recurring = (Array.isArray(d.recurring) ? d.recurring : [])
    .filter((r) => r && typeof r.title === 'string' && Number(r.amount) > 0 && isMonth(r.startMonth))
    .map((r) => ({
      id: String(r.id ?? uid()), title: r.title.slice(0, 60), amount: Number(r.amount),
      category: cat(r.category), payment: pay(r.payment),
      day: Math.min(Math.max(parseInt(r.day, 10) || 1, 1), 31),
      startMonth: r.startMonth, active: r.active !== false,
      generated: Array.isArray(r.generated) ? r.generated.filter(isMonth) : [],
    }));

  return { expenses, goals, recurring, budget: Math.max(Number(d.budget) || 0, 0) };
}

function restore(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const clean = sanitizeBackup(JSON.parse(reader.result));
      const msg = `Restore ${clean.expenses.length} expenses, ${clean.goals.length} goals and ${clean.recurring.length} recurring items?\n\nThis REPLACES your current data.`;
      if (!confirm(msg)) return;
      Object.assign(state, clean);
      persist();
      render();
      toast('Backup restored ✅');
    } catch (err) {
      toast(err.message || 'Could not read that file.', 'error');
    }
  };
  reader.onerror = () => toast('Could not read that file.', 'error');
  reader.readAsText(file);
}

function clearAll() {
  if (!confirm('Delete ALL data from this browser? This cannot be undone.')) return;
  state.expenses = [];
  state.goals = [];
  state.recurring = [];
  state.budget = 0;
  persist();
  render();
  toast('All data deleted 🧹');
}

/* =====================================================
   EVENTS
===================================================== */
$('nav').addEventListener('click', (e) => {
  const b = e.target.closest('.nav-btn');
  if (b) setView(b.dataset.view);
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.tagName === 'INPUT') return;
  const id = btn.dataset.id;
  switch (btn.dataset.act) {
    case 'edit':       openExpenseModal(id); break;
    case 'del':        deleteExpense(id); break;
    case 'funds':      openFunds(id); break;
    case 'goalDel':    deleteGoal(id); break;
    case 'recDel':     deleteRecurring(id); break;
    case 'goto':       setView(btn.dataset.view); break;
    case 'addExpense': openExpenseModal(); break;
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches && t.matches('[data-act="recToggle"]')) toggleRecurring(t.dataset.id, t.checked);
});

$('addBtn').onclick = () => openExpenseModal();
$('themeBtn').onclick = () => toggleTheme(state.theme !== 'dark');
$('themeSwitch').onchange = (e) => toggleTheme(e.target.checked);

$('expenseForm').addEventListener('submit', saveExpense);
$('cancelModal').onclick = () => $('expenseModal').close();
$('fundsForm').addEventListener('submit', addFunds);
$('cancelFunds').onclick = () => $('fundsModal').close();
['expenseModal', 'fundsModal'].forEach((id) =>
  $(id).addEventListener('click', (e) => { if (e.target === $(id)) $(id).close(); }));

$('goalForm').addEventListener('submit', addGoal);
$('recForm').addEventListener('submit', addRecurring);

$('prevMonth').onclick = () => { state.month = shiftMonth(state.month, -1); $('monthPicker').value = state.month; render(); };
$('nextMonth').onclick = () => { state.month = shiftMonth(state.month, 1); $('monthPicker').value = state.month; render(); };
$('monthPicker').addEventListener('change', (e) => { if (e.target.value) { state.month = e.target.value; render(); } });

$('budgetInput').addEventListener('input', (e) => {
  state.budget = Math.max(Number(e.target.value) || 0, 0);
  persist();
  renderDashboard();
});

['search', 'fCat', 'fFrom', 'fTo', 'fSort'].forEach((id) =>
  $(id).addEventListener(id === 'search' ? 'input' : 'change', renderTransactions));
$('clearFilters').onclick = () => {
  $('search').value = ''; $('fCat').value = 'all'; $('fFrom').value = ''; $('fTo').value = ''; $('fSort').value = 'dateDesc';
  renderTransactions();
};

$('exportCsv').onclick = exportCSV;
$('backupBtn').onclick = backup;
$('restoreBtn').onclick = () => $('restoreInput').click();
$('restoreInput').addEventListener('change', (e) => { restore(e.target.files[0]); e.target.value = ''; });
$('clearAll').onclick = clearAll;

/* =====================================================
   INIT
===================================================== */
function init() {
  Object.keys(CATS).forEach((c) => {
    const label = `${CATS[c].icon} ${c}`;
    $('eCat').add(new Option(label, c));
    $('rCat').add(new Option(label, c));
    $('fCat').add(new Option(label, c));
  });
  $('fCat').add(new Option('All categories', 'all'), 0);
  $('fCat').value = 'all';

  $('monthPicker').value = state.month;
  applyTheme();
  processRecurring();
  persist(); // locks in migrated data from the older version
  render();

  setTimeout(() => {
    $('splash').classList.add('hide');
    setTimeout(() => $('splash').remove(), 450);
  }, 500);
}

<<<<<<< HEAD
init();
=======
init();
>>>>>>> 11e0598a5d7ff1a4f88190c0350fffaa317127cc
