/* ── Helpers ──────────────────────────────────────────────────────────────── */

function fmt(bytes) {
  if (bytes === 0) return '0 B';
  const u = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
}

function setBar(id, pct, warnAt, critAt) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.width = Math.min(100, pct).toFixed(1) + '%';
  if (pct >= critAt)      el.style.background = '#ef4444';
  else if (pct >= warnAt) el.style.background = '#f59e0b';
  else                    el.style.background = '#10b981';
}

function appendLog(bodyId, lines) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  const ts = new Date().toLocaleTimeString('en-GB');
  lines.forEach((line, idx) => {
    const div = document.createElement('div');
    div.className = 'log-line';
    const cls = line.includes('[ERROR]') || line.includes('[DOCKER] Stopping') ? 'log-err'
              : line.includes('[OK]') || line.includes('✓') || line.includes('[STRIPE]') ? 'log-ok'
              : line.includes('[WARN]') ? 'log-warn'
              : 'log-info';
    div.innerHTML = `<span class="log-ts">${ts}</span> <span class="${cls}">${escHtml(line)}</span>`;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  });
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Plans ────────────────────────────────────────────────────────────────── */

async function loadPlans() {
  const res  = await fetch('/api/plans');
  const data = await res.json();
  const grid = document.getElementById('plansGrid');
  grid.innerHTML = '';
  data.plans.forEach(plan => {
    const card = document.createElement('div');
    card.className = 'plan-card';
    card.id = 'plan-' + plan.id;
    card.innerHTML = `
      <div class="plan-name">${plan.name}</div>
      <div class="plan-price">$${plan.price}<span>/mo</span></div>
      <div class="plan-specs">${plan.cpu} CPU · ${plan.memory}<br>Stripe: <code style="font-size:10px;">${plan.stripePriceId}</code></div>
      <button class="plan-btn" onclick="selectPlan('${plan.id}')">Subscribe</button>
    `;
    grid.appendChild(card);
  });
}

async function selectPlan(presetId) {
  document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('plan-' + presetId)?.classList.add('selected');

  advanceStep(2);

  const res  = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presetId, email: 'user@example.com' }),
  });
  const data = await res.json();

  const result = document.getElementById('checkoutResult');
  const fields = document.getElementById('checkoutFields');
  result.classList.remove('hidden');

  fields.innerHTML = `
    <div><strong>Plan:</strong> ${data.plan} ($${data.price}/mo)</div>
    <div><strong>Session ID:</strong> <code>${data.sessionId}</code></div>
    <div><strong>Customer ID:</strong> <code>${data.customerId}</code></div>
    <div><strong>Checkout URL:</strong> <code style="color:#635bff;">${data.checkoutUrl}</code></div>
    <div><strong>Status:</strong> pending payment → webhook will activate</div>
  `;

  // Animate steps 3 and 4 after a short delay
  setTimeout(() => advanceStep(3), 1800);
  setTimeout(() => advanceStep(4), 3200);
}

function advanceStep(n) {
  for (let i = 1; i < n; i++) {
    document.getElementById('step-' + i)?.classList.add('done');
    document.getElementById('step-' + i)?.classList.remove('active');
  }
  document.getElementById('step-' + n)?.classList.add('active');
}

/* ── Invoices ─────────────────────────────────────────────────────────────── */

async function loadInvoices() {
  const res  = await fetch('/api/invoices');
  const data = await res.json();
  const body = document.getElementById('invoiceBody');
  body.innerHTML = '';
  data.invoices.forEach(inv => {
    const date = new Date(inv.created * 1000).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
    const amt  = '$' + (inv.amountPaid / 100).toFixed(2);
    const tr   = document.createElement('tr');
    tr.innerHTML = `
      <td>${inv.description}</td>
      <td>${amt}</td>
      <td><span class="badge-paid">paid</span></td>
      <td>${date}</td>
    `;
    body.appendChild(tr);
  });
}

/* ── Live metrics (SSE) ───────────────────────────────────────────────────── */

function connectMetrics() {
  const evtSource = new EventSource('/api/metrics/live');

  evtSource.onmessage = (e) => {
    const d = JSON.parse(e.data);

    const cpuEl = document.getElementById('cpuVal');
    const memEl = document.getElementById('memVal');
    const niEl  = document.getElementById('netInVal');
    const noEl  = document.getElementById('netOutVal');
    const memSub = document.getElementById('memSub');

    if (cpuEl)  cpuEl.textContent  = d.cpuRaw.toFixed(1) + '%';
    if (memEl)  memEl.textContent  = d.memPct.toFixed(1) + '%';
    if (niEl)   niEl.textContent   = fmt(d.netIn);
    if (noEl)   noEl.textContent   = fmt(d.netOut);
    if (memSub) memSub.textContent = d.memUsage;

    setBar('cpuBar', d.cpuRaw, 70, 90);
    setBar('memBar', d.memPct, 70, 90);

    // Alert banner
    const banner = document.getElementById('alertBanner');
    if (banner) {
      if (d.alerts && d.alerts.length > 0) {
        banner.classList.remove('hidden', 'warning', 'critical');
        const a = d.alerts[0];
        banner.classList.add(a.level === 'critical' ? 'critical' : 'warning');
        banner.textContent = '⚠ ' + a.msg;
      } else {
        banner.classList.add('hidden');
      }
    }
  };
}

/* ── Simulate ─────────────────────────────────────────────────────────────── */

async function simulate(type) {
  const isAutoScale = (type === 'autoscale');
  const logId   = isAutoScale ? 'simLog2' : 'simLog';
  const bodyId  = isAutoScale ? 'simLogBody2' : 'simLogBody';

  const logEl = document.getElementById(logId);
  const body  = document.getElementById(bodyId);
  if (logEl) logEl.classList.remove('hidden');
  if (body)  body.innerHTML = '';

  const res  = await fetch('/api/simulate/spike', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  });
  const data = await res.json();

  let i = 0;
  const ticker = setInterval(() => {
    if (i >= data.log.length) { clearInterval(ticker); return; }
    appendLog(bodyId, [data.log[i++]]);
  }, 240);
}

/* ── Email tabs ───────────────────────────────────────────────────────────── */

function loadEmail(type, btn) {
  document.querySelectorAll('.etab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('emailPreview').src = '/api/email/' + type;
}

/* ── Webhooks ─────────────────────────────────────────────────────────────── */

async function triggerWebhook(event) {
  const logEl = document.getElementById('webhookLog');
  const body  = document.getElementById('webhookLogBody');
  if (logEl) logEl.classList.remove('hidden');
  if (body)  body.innerHTML = '';

  const res  = await fetch('/api/webhook/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  });
  const data = await res.json();

  let i = 0;
  const ticker = setInterval(() => {
    if (i >= data.log.length) { clearInterval(ticker); return; }
    appendLog('webhookLogBody', [data.log[i++]]);
  }, 280);
}

/* ── Hero terminal live scroll ────────────────────────────────────────────── */

const extraLogs = [
  { cls: 'log-info', text: '[MONITOR] Poll #2 — CPU 14.1% | Mem 39.2%' },
  { cls: 'log-info', text: '[MONITOR] Poll #3 — CPU 11.8% | Mem 40.5%' },
  { cls: 'log-info', text: '[STRIPE]  Webhook: checkout.session.completed' },
  { cls: 'log-ok',   text: '[DB] project.subscriptionStatus = "active"' },
  { cls: 'log-ok',   text: '[DB] project.stripeItemId stored for upgrades' },
  { cls: 'log-info', text: '[MONITOR] Poll #4 — CPU 16.3% | Mem 42.1%' },
  { cls: 'log-warn', text: '[MONITOR] Memory at 71.2% — warning threshold' },
  { cls: 'log-warn', text: '[EMAIL]  "Resource Alert (70%)" sent to user' },
  { cls: 'log-info', text: '[MONITOR] Poll #5 — CPU 13.5% | Mem 68.8%' },
];

let heroIdx = 0;
setInterval(() => {
  if (heroIdx >= extraLogs.length) return;
  const log = extraLogs[heroIdx++];
  const body = document.getElementById('heroLog');
  if (!body) return;
  const ts = new Date().toLocaleTimeString('en-GB');
  const div = document.createElement('div');
  div.className = 'log-line';
  div.innerHTML = `<span class="log-ts">${ts}</span> <span class="${log.cls}">${escHtml(log.text)}</span>`;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}, 3500);

/* ── Boot ─────────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  loadPlans();
  loadInvoices();
  connectMetrics();
});
