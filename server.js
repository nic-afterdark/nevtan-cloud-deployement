const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Plans ─────────────────────────────────────────────────────────────────────

const PLANS = [
  { id: 'nano',   name: 'Nano',   cpu: '0.5', memory: '256Mi', price: 3,   stripePriceId: 'price_nano'   },
  { id: 'micro',  name: 'Micro',  cpu: '1',   memory: '512Mi', price: 9,   stripePriceId: 'price_micro'  },
  { id: 'small',  name: 'Small',  cpu: '2',   memory: '1Gi',   price: 19,  stripePriceId: 'price_small'  },
  { id: 'medium', name: 'Medium', cpu: '4',   memory: '2Gi',   price: 39,  stripePriceId: 'price_medium' },
  { id: 'large',  name: 'Large',  cpu: '8',   memory: '4Gi',   price: 79,  stripePriceId: 'price_large'  },
];

app.get('/api/plans', (_req, res) => res.json({ plans: PLANS }));

// ── Stripe checkout simulation ────────────────────────────────────────────────

app.post('/api/checkout', (req, res) => {
  const { presetId, email } = req.body;
  const plan = PLANS.find(p => p.id === presetId);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  // In production this calls Stripe and returns session.url
  // For the demo we return a fake Stripe-style checkout URL
  const mockSessionId = 'cs_demo_' + Math.random().toString(36).slice(2, 18);
  const checkoutUrl   = `https://checkout.stripe.com/pay/${mockSessionId}`;

  res.json({
    checkoutUrl,
    sessionId:   mockSessionId,
    plan:        plan.name,
    price:       plan.price,
    customerId:  'cus_demo_' + Math.random().toString(36).slice(2, 14),
    subscriptionId: null,  // set after webhook fires
    status:      'pending',
    message: `[MOCK] Stripe Checkout Session created for plan "${plan.name}" ($${plan.price}/mo)`,
  });
});

// ── Subscription status ───────────────────────────────────────────────────────

app.get('/api/subscription/status', (_req, res) => {
  res.json({
    active:          true,
    subscriptionId:  'sub_demo_abc123',
    subscribedPlan:  'small',
    stripeCustomerId:'cus_demo_xyz789',
    subscribedPayment: 19,
    nextBillingDate: new Date(Date.now() + 30 * 86400_000).toISOString().split('T')[0],
  });
});

// ── Invoices ──────────────────────────────────────────────────────────────────

app.get('/api/invoices', (_req, res) => {
  res.json({
    invoices: [
      { id: 'in_001', description: 'Small Plan — May 2026',   amountPaid: 1900, currency: 'usd', status: 'paid', created: Date.now() / 1000 - 2592000 },
      { id: 'in_002', description: 'Micro Plan — Apr 2026',   amountPaid:  900, currency: 'usd', status: 'paid', created: Date.now() / 1000 - 5184000 },
      { id: 'in_003', description: 'Nano Plan  — Mar 2026',   amountPaid:  300, currency: 'usd', status: 'paid', created: Date.now() / 1000 - 7776000 },
    ],
  });
});

// ── Stripe webhook simulation ─────────────────────────────────────────────────

app.post('/api/webhook/simulate', (req, res) => {
  const { event } = req.body;
  const log = [];

  if (event === 'checkout.session.completed') {
    log.push('[STRIPE WEBHOOK] checkout.session.completed received');
    log.push('[WEBHOOK] Verified HMAC-SHA256 signature ✓');
    log.push('[WEBHOOK] Parsed metadata: { userId: "usr_123", projectId: "proj_456", presetId: "small" }');
    log.push('[DB] Updated project proj_456 → subscriptionStatus: "active"');
    log.push('[DB] Stored stripeSubscriptionId: sub_demo_abc123');
    log.push('[DB] Stored stripeItemId: si_demo_xyz (for future upgrades)');
    log.push('[WEBHOOK] Done in 12 ms');
  } else if (event === 'customer.subscription.deleted') {
    log.push('[STRIPE WEBHOOK] customer.subscription.deleted received');
    log.push('[WEBHOOK] Verified signature ✓');
    log.push('[DB] Cleared subscription fields on project proj_456');
    log.push('[DB] Updated subscriptionStatus: "canceled"');
    log.push('[DOCKER] Stopping container nevtan_proj_456...');
    log.push('[DOCKER] Container stopped ✓');
    log.push('[WEBHOOK] Done in 34 ms');
  } else {
    log.push('[WEBHOOK] Unknown event type: ' + event);
  }

  res.json({ event, log });
});

// ── Container metrics (SSE live stream) ───────────────────────────────────────

let metricsState = {
  containerName: 'nevtan_proj_demo',
  cpuRaw:   12.4,
  memPct:   38.0,
  memUsage: '195MiB / 512MiB',
  netIn:    1_048_576,
  netOut:   524_288,
  blockRead: 2_097_152,
  blockWrite: 1_048_576,
  plan: 'small',
  subscriptionStatus: 'active',
};

// Drift metrics so SSE stream looks alive
setInterval(() => {
  metricsState.cpuRaw   = clamp(metricsState.cpuRaw   + (Math.random() - 0.45) * 4, 2, 95);
  metricsState.memPct   = clamp(metricsState.memPct   + (Math.random() - 0.4)  * 2, 5, 99);
  metricsState.netIn   += Math.round(Math.random() * 50_000);
  metricsState.netOut  += Math.round(Math.random() * 20_000);
  const memMiB = Math.round(metricsState.memPct * 5.12);
  metricsState.memUsage = `${memMiB}MiB / 512MiB`;
}, 3000);

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

app.get('/api/metrics/live', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = () => {
    const alerts = [];
    if (metricsState.memPct >= 90) alerts.push({ level: 'critical', msg: 'Memory at ' + metricsState.memPct.toFixed(1) + '% — email alert sent!' });
    else if (metricsState.memPct >= 70) alerts.push({ level: 'warning', msg: 'Memory at ' + metricsState.memPct.toFixed(1) + '% — warning email sent' });

    res.write(`data: ${JSON.stringify({ ...metricsState, alerts, ts: new Date().toISOString() })}\n\n`);
  };

  send();
  const interval = setInterval(send, 3000);
  req.on('close', () => clearInterval(interval));
});

// ── Snapshot metrics (REST fallback) ─────────────────────────────────────────

app.get('/api/metrics', (_req, res) => res.json(metricsState));

// ── Simulate spike ────────────────────────────────────────────────────────────

app.post('/api/simulate/spike', (req, res) => {
  const { type } = req.body;
  const log = [];

  if (type === 'mem90') {
    metricsState.memPct = 91.5;
    metricsState.memUsage = '469MiB / 512MiB';
    log.push('[MONITOR] Memory spike detected: 91.5%');
    log.push('[ALERT] Threshold 90% crossed — composing email...');
    log.push('[EMAIL] Subject: "Resource Alert (90%) — demo-app"');
    log.push('[EMAIL] Sent from noreply@demo-app.com to user@example.com ✓');
    log.push('[COOLDOWN] Alert suppressed for next 60 minutes');
  } else if (type === 'autoscale') {
    metricsState.memPct = 82.3;
    metricsState.plan = 'medium';
    metricsState.memUsage = '842MiB / 1024MiB';
    log.push('[MONITOR] Memory at 82.3% — auto-scale check triggered');
    log.push('[AUTOSCALE] Project has autoScaling=true and autoPayEnabled=true ✓');
    log.push('[AUTOSCALE] Current plan: small ($19/mo) → next plan: medium ($39/mo)');
    log.push('[STRIPE] Calling SubscriptionItem.update with new priceId...');
    log.push('[STRIPE] Proration created — user billed for the difference ✓');
    log.push('[DOCKER] docker update --memory 2g --cpus 4 nevtan_proj_demo');
    log.push('[DOCKER] Container resource limits updated ✓');
    log.push('[DB] project.payload.resource_preset = "medium"');
    log.push('[DB] project.logs.push "[AUTO-SCALE] Upgraded small → medium at 82.3%"');
    log.push('[EMAIL] Subject: "Plan Auto-Upgraded — demo-app" → sent ✓');
    log.push('[COOLDOWN] Next auto-scale locked for 24 hours');
  } else if (type === 'deploy_fail') {
    log.push('[DEPLOY] Cloning repo: github.com/nic-afterdark/demo-app ...');
    log.push('[DEPLOY] Building Docker image...');
    log.push('[ERROR] npm ERR! Cannot find module \'missing-dep\'');
    log.push('[DEPLOY] Build failed — container not started');
    log.push('[EMAIL] Subject: "Deployment Failed — demo-app"');
    log.push('[EMAIL] Attached full build logs (47 lines)');
    log.push('[EMAIL] Sent from noreply@demo-app.com to user@example.com ✓');
  } else if (type === 'deploy_success') {
    log.push('[DEPLOY] Cloning repo: github.com/nic-afterdark/demo-app ...');
    log.push('[DEPLOY] Installing dependencies...');
    log.push('[DEPLOY] Building Docker image... Done (18.3s)');
    log.push('[DOCKER] Starting container nevtan_proj_demo on port 3000...');
    log.push('[DEPLOY] Health check passed ✓');
    log.push('[NGINX] Routing https://demo-app.nevtan.app → container:3000');
    log.push('[EMAIL] Subject: "Deployment Successful — demo-app"');
    log.push('[EMAIL] Live URL: https://demo-app.nevtan.app');
    log.push('[EMAIL] Sent ✓ in 43 ms');
  }

  res.json({ type, log });
});

// ── Email template previews ───────────────────────────────────────────────────

app.get('/api/email/:type', (req, res) => {
  const type = req.params.type;
  const templates = {
    success:    buildSuccessEmail(),
    failure:    buildFailureEmail(),
    resource:   buildResourceEmail(90),
    autoscale:  buildAutoScaleEmail(),
    invitation: buildInvitationEmail(),
  };
  const html = templates[type];
  if (!html) return res.status(404).json({ error: 'Unknown template' });
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ── Root ──────────────────────────────────────────────────────────────────────

app.get('/', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`[NEVTAN DEMO] Running at http://localhost:${PORT}`)
);

// ── Email HTML builders (mirrors production EmailService.java) ────────────────

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function row(label, value) {
  return `<tr>
    <td style="padding:8px 12px 8px 0;color:#6b7280;width:130px;vertical-align:top;">${label}</td>
    <td style="padding:8px 0;color:#111827;font-weight:500;word-break:break-all;">${value}</td>
  </tr>`;
}

function buildSuccessEmail() {
  return `<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;'>
<div style='max-width:680px;margin:32px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);'>
  <div style='background:#16a34a;padding:28px 32px;'>
    <h2 style='margin:0;color:#ffffff;font-size:20px;'>&#9989; Deployment Successful</h2>
  </div>
  <div style='padding:28px 32px;'>
    <p style='margin:0 0 20px;color:#374151;font-size:15px;'>Hi Nischay,</p>
    <p style='margin:0 0 24px;color:#374151;font-size:15px;'>Your deployment for <strong>demo-app</strong> is now live with no errors.</p>
    <table style='width:100%;border-collapse:collapse;margin-bottom:24px;font-size:14px;'>
      ${row('Project','demo-app')}
      ${row('Deployment ID','dep_20260520_abc')}
      ${row('Time (UTC)','20 May 2026, 12:34:56 UTC')}
    </table>
    <p style='margin:0 0 8px;color:#374151;font-weight:bold;font-size:14px;'>Live URL</p>
    <a href='#' style='display:inline-block;background:#16a34a;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:bold;margin-bottom:24px;'>https://demo-app.nevtan.app</a>
    <p style='margin:0;color:#6b7280;font-size:13px;'>Log into your dashboard to manage your deployment.</p>
  </div>
  <div style='background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;'>
    <p style='margin:0;color:#9ca3af;font-size:12px;'>This is an automated notification from Nevtan Cloud. Do not reply to this email.</p>
  </div>
</div></body></html>`;
}

function buildFailureEmail() {
  return `<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;'>
<div style='max-width:680px;margin:32px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);'>
  <div style='background:#dc2626;padding:28px 32px;'>
    <h2 style='margin:0;color:#ffffff;font-size:20px;'>&#10060; Deployment Failed</h2>
  </div>
  <div style='padding:28px 32px;'>
    <p style='margin:0 0 20px;color:#374151;font-size:15px;'>Hi Nischay,</p>
    <p style='margin:0 0 24px;color:#374151;font-size:15px;'>Your deployment for <strong>demo-app</strong> has failed.</p>
    <table style='width:100%;border-collapse:collapse;margin-bottom:24px;font-size:14px;'>
      ${row('Project','demo-app')}
      ${row('Repository','github.com/nic-afterdark/demo-app')}
      ${row('Branch','main')}
      ${row('Deployment ID','dep_20260520_abc')}
      ${row('Time (UTC)','20 May 2026, 12:34:56 UTC')}
    </table>
    <p style='margin:0 0 8px;color:#374151;font-weight:bold;font-size:14px;'>Error</p>
    <div style='background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;border-radius:4px;margin-bottom:24px;'>
      <code style='color:#991b1b;font-size:13px;white-space:pre-wrap;'>npm ERR! Cannot find module 'missing-dep'
npm ERR! Require stack:
npm ERR!   /app/src/index.js</code>
    </div>
    <p style='margin:0 0 8px;color:#374151;font-weight:bold;font-size:14px;'>Build Logs</p>
    <pre style='background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:6px;font-size:11px;overflow-x:auto;white-space:pre-wrap;margin:0 0 24px;'>
[BUILD] Cloning repository...
[BUILD] npm install...
[BUILD] Running npm run build...
[ERROR] Cannot find module 'missing-dep'
[BUILD] Exited with code 1</pre>
    <p style='margin:0;color:#6b7280;font-size:13px;'>Log into your dashboard to view logs and redeploy.</p>
  </div>
  <div style='background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;'>
    <p style='margin:0;color:#9ca3af;font-size:12px;'>This is an automated notification from Nevtan Cloud. Do not reply to this email.</p>
  </div>
</div></body></html>`;
}

function buildResourceEmail(threshold) {
  const critical = threshold >= 90;
  const color  = critical ? '#dc2626' : '#d97706';
  const icon   = critical ? '&#128721;' : '&#9888;';
  const label  = critical ? 'Critical Resource Alert' : 'Resource Usage Warning';
  const pct    = threshold + 1.5;
  const barPct = Math.min(100, pct);

  return `<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;'>
<div style='max-width:680px;margin:32px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);'>
  <div style='background:${color};padding:28px 32px;'>
    <h2 style='margin:0;color:#ffffff;font-size:20px;'>${icon} ${label}</h2>
  </div>
  <div style='padding:28px 32px;'>
    <p style='margin:0 0 20px;color:#374151;font-size:15px;'>Hi Nischay,</p>
    <p style='margin:0 0 24px;color:#374151;font-size:15px;'>Your project <strong>demo-app</strong> has reached <strong>${threshold}%</strong> memory usage. If left unaddressed, <strong>your service will be stopped</strong>. Please upgrade your plan now.</p>
    <table style='width:100%;border-collapse:collapse;margin-bottom:24px;font-size:14px;'>
      ${row('Project','demo-app')}
      ${row('Container','nevtan_proj_demo')}
      ${row('Resource Plan','Small (1 CPU / 512MiB)')}
      ${row('Memory Usage','469MiB / 512MiB')}
      ${row('Memory %','91.6%')}
      ${row('CPU %','34.2% of system / 68.4% of plan')}
      ${row('Alert Level',threshold + '%')}
      ${row('Time (UTC)','20 May 2026, 13:05:12 UTC')}
    </table>
    <p style='margin:0 0 6px;color:#374151;font-weight:bold;font-size:14px;'>Memory Usage</p>
    <div style='background:#e5e7eb;border-radius:4px;overflow:hidden;height:20px;margin-bottom:24px;'>
      <div style='background:${color};height:20px;width:${barPct}%;'></div>
    </div>
    <p style='margin:0;color:#6b7280;font-size:13px;'>Log into your dashboard to upgrade your plan.</p>
  </div>
  <div style='background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;'>
    <p style='margin:0;color:#9ca3af;font-size:12px;'>This is an automated notification from Nevtan Cloud. Do not reply to this email.</p>
  </div>
</div></body></html>`;
}

function buildAutoScaleEmail() {
  return `<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;'>
<div style='max-width:680px;margin:32px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);'>
  <div style='background:#0369a1;padding:28px 32px;'>
    <h2 style='margin:0;color:#ffffff;font-size:20px;'>&#9650; Plan Auto-Upgraded</h2>
  </div>
  <div style='padding:28px 32px;'>
    <p style='margin:0 0 20px;color:#374151;font-size:15px;'>Hi Nischay,</p>
    <p style='margin:0 0 24px;color:#374151;font-size:15px;'>Your project <strong>demo-app</strong> reached <strong>82.3%</strong> memory usage, so your plan was automatically upgraded to keep your service running.</p>
    <table style='width:100%;border-collapse:collapse;margin-bottom:24px;font-size:14px;'>
      ${row('Project','demo-app')}
      ${row('Previous Plan','Small ($19.00/mo)')}
      ${row('New Plan','<strong>Medium ($39.00/mo)</strong>')}
      ${row('Memory at Upgrade','82.3%')}
      ${row('Time (UTC)','20 May 2026, 13:07:00 UTC')}
    </table>
    <div style='background:#eff6ff;border-left:4px solid #0369a1;padding:12px 16px;border-radius:4px;margin-bottom:24px;'>
      <p style='margin:0;color:#1e40af;font-size:13px;'>Your billing has been updated and the difference will be prorated on your next invoice. You can manage your plan from the dashboard at any time.</p>
    </div>
    <p style='margin:0;color:#6b7280;font-size:13px;'>To disable auto-scaling, go to your project settings and turn off <strong>Auto Scaling</strong>.</p>
  </div>
  <div style='background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;'>
    <p style='margin:0;color:#9ca3af;font-size:12px;'>This is an automated notification from Nevtan Cloud. Do not reply to this email.</p>
  </div>
</div></body></html>`;
}

function buildInvitationEmail() {
  return `<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14px;color:#24292f;'>
  <div style='text-align:center;padding:32px 0 20px;'>
    <span style='font-size:30px;font-weight:800;color:#24292f;letter-spacing:-0.5px;'>Nevtan</span>
  </div>
  <div style='max-width:544px;margin:0 auto 32px;background:#ffffff;border:1px solid #d0d7de;border-radius:6px;padding:32px;'>
    <div style='text-align:center;margin-bottom:24px;'>
      <div style='display:inline-block;vertical-align:middle;width:64px;height:64px;border-radius:50%;background:#0969da;color:#fff;font-size:28px;font-weight:700;line-height:64px;text-align:center;border:1px solid #d0d7de;'>N</div>
      <span style='display:inline-block;vertical-align:middle;font-size:24px;color:#57606a;margin:0 12px;font-weight:300;'>+</span>
      <div style='display:inline-block;vertical-align:middle;width:64px;height:64px;border-radius:6px;background:#1d4ed8;color:#fff;font-size:28px;font-weight:700;line-height:64px;text-align:center;border:1px solid #d0d7de;'>D</div>
    </div>
    <p style='text-align:center;font-size:16px;margin:0 0 16px;color:#24292f;'>
      <strong>@nic-afterdark</strong> has invited you to collaborate on the <strong>demo-app</strong> project as a <strong>Editor</strong>.
    </p>
    <p style='color:#57606a;font-size:14px;margin:0 0 4px;'>This invitation will expire in <strong>7 days</strong>.</p>
    <div style='text-align:center;margin:24px 0;'>
      <a href='#' style='display:inline-block;background:#1f883d;color:#ffffff;padding:9px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;border:1px solid rgba(31,136,61,0.4);'>View invitation</a>
    </div>
    <hr style='border:none;border-top:1px solid #d0d7de;margin:0 0 16px;' />
    <p style='color:#57606a;font-size:12px;margin:0;'><strong>Note:</strong> This invitation was intended for collaborator@example.com.</p>
  </div>
</body></html>`;
}
