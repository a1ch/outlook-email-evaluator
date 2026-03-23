// Outlook Email Evaluator - Content Script
let sidebar = null;
let lastEmailId = null;
let observer = null;

// --- Gift Card Fraud Detection (pre-check before API call) ---
const GIFT_CARD_KEYWORDS = [
  'gift card', 'gift cards', 'itunes card', 'google play card', 'amazon gift card',
  'steam card', 'ebay gift card', 'visa gift card', 'buy gift cards', 'purchase gift cards',
  'get gift cards', 'send gift cards', 'gift card number', 'gift card code',
  'scratch the card', 'scratch card', 'card balance', 'redeem the card',
  'send me the codes', 'send the codes', 'send the numbers'
];

function checkForGiftCardFraud(email) {
  const combined = ((email.subject || '') + ' ' + (email.body || '')).toLowerCase();
  return GIFT_CARD_KEYWORDS.some(kw => combined.includes(kw));
}

// --- Sidebar Injection ---
function createSidebar() {
  if (document.getElementById('oe-sidebar')) return;
  sidebar = document.createElement('div');
  sidebar.id = 'oe-sidebar';
  sidebar.innerHTML = `
    <div id="oe-tab"><span>📧</span><span>EVALUATOR</span></div>
    <div id="oe-panel">
      <div id="oe-header">
        <span>📧 Email Evaluator</span>
        <button id="oe-close">&#x27E9;</button>
      </div>
      <div id="oe-body"><p>Select or open an email to analyze it.</p></div>
      <button id="oe-analyze-btn">🔍 Analyze Email</button>
    </div>
  `;
  document.body.appendChild(sidebar);

  document.getElementById('oe-close').addEventListener('click', () => {
    sidebar.classList.add('oe-collapsed');
  });
  document.getElementById('oe-tab').addEventListener('click', () => {
    sidebar.classList.remove('oe-collapsed');
  });

  // Ping service worker to wake it, then analyze
  document.getElementById('oe-analyze-btn').addEventListener('click', () => {
    try { chrome.runtime.sendMessage({ type: 'PING' }); } catch(e) {}
    setTimeout(analyzeCurrentEmail, 100);
  });

  // Event delegation for finding card toggles
  document.getElementById('oe-body').addEventListener('click', (e) => {
    const header = e.target.closest('.oe-finding-header');
    if (header) header.parentElement.classList.toggle('oe-finding-open');
  });
}

// --- Email Extraction ---
function getReadingPane() {
  const candidates = [
    document.querySelector('[aria-label="Reading Pane"]'),
    document.querySelector('[aria-label="reading pane"]'),
    document.querySelector('[class*="ReadingPane"]'),
    document.querySelector('[class*="readingPane"]'),
    document.querySelector('[data-testid="reading-pane"]'),
  ];
  return candidates.find(el => el !== null) || document.body;
}

function findTextIn(container, selectorList) {
  for (const sel of selectorList) {
    try {
      const el = container.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length > 0) return el.innerText.trim();
    } catch(e) {}
  }
  return null;
}

function extractEmail() {
  const pane = getReadingPane();
  const subject = findTextIn(pane, [
    '[data-testid="subject"]', '[aria-label="Message subject"]',
    'h1', 'h2', '[role="heading"]', '[class*="subject" i]'
  ]) || '(No subject found)';

  // --- Sender extraction - multiple strategies to handle regular + system emails ---
  let sender = '(No sender found)';
  try {
    const allBtns = Array.from(pane.querySelectorAll('button[aria-label]'));
    const fromBtn = allBtns.find(b => b.getAttribute('aria-label').startsWith('From:'));
    if (fromBtn) sender = fromBtn.getAttribute('aria-label').replace(/^From:\s*/i, '').trim();
  } catch(e) {}

  if (sender === '(No sender found)') {
    try {
      const allEls = Array.from(pane.querySelectorAll('[aria-label]'));
      const emailEl = allEls.find(el => {
        const label = el.getAttribute('aria-label') || '';
        return label.includes('@') && label.length < 200;
      });
      if (emailEl) sender = emailEl.getAttribute('aria-label').trim();
    } catch(e) {}
  }

  if (sender === '(No sender found)') {
    sender = findTextIn(pane, [
      '[data-testid="senderName"]', '[class*="sender" i]', '[class*="Sender"]',
      '[class*="from" i]', '[class*="From"]',
    ]) || '(No sender found)';
  }

  if (sender === '(No sender found)') {
    try {
      const allText = pane.innerText || '';
      const emailMatch = allText.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      if (emailMatch) sender = emailMatch[0];
    } catch(e) {}
  }

  const body = findTextIn(pane, [
    '[aria-label="Message body"]', '[data-testid="message-body"]',
    'div[class*="UniqueMessageBody"]', '[id*="UniqueMessageBody"]',
    'div[class*="messageBody"]', 'div[class*="MessageBody"]',
    '[class*="ReadingPaneContent"]', '[class*="readingPaneContent"]'
  ]) || '(No body found)';

  const links = [];
  const bodyEl = pane.querySelector('[aria-label="Message body"]') ||
    pane.querySelector('div[class*="UniqueMessageBody"]') ||
    pane.querySelector('[id*="UniqueMessageBody"]') ||
    pane.querySelector('div[class*="messageBody"]') || pane;

  if (bodyEl) {
    const seen = new Set();
    bodyEl.querySelectorAll('a[href]').forEach(a => {
      try {
        const displayText = a.innerText.trim();
        let href = a.getAttribute('href') || '';
        if (href.includes('safelinks.protection.outlook.com') || href.includes('urldefense') || href.includes('trendmicro')) {
          try {
            const u = new URL(href);
            const urlParam = u.searchParams.get('url') || u.searchParams.get('u');
            if (urlParam) href = decodeURIComponent(urlParam);
          } catch(e) {}
        }
        if (!href || href.startsWith('mailto:') || href.startsWith('#') || href.length < 10) return;
        let hrefDomain = '';
        try { hrefDomain = new URL(href).hostname.toLowerCase(); } catch(e) { hrefDomain = href.slice(0, 60); }
        if (seen.has(hrefDomain)) return;
        seen.add(hrefDomain);
        let displayDomain = '';
        const urlPattern = displayText.match(/(?:https?:\/\/|www\.)([\w.-]+)/i);
        if (urlPattern) {
          try {
            const normalized = displayText.startsWith('http') ? displayText : 'https://' + displayText;
            displayDomain = new URL(normalized).hostname.toLowerCase();
          } catch(e) { displayDomain = urlPattern[1].toLowerCase(); }
        }
        const mismatch = displayDomain && hrefDomain &&
          !hrefDomain.includes(displayDomain.replace(/^www\./, '')) &&
          !displayDomain.includes(hrefDomain.replace(/^www\./, ''));
        links.push({ display: displayText.slice(0, 80) || '(no text)', href: hrefDomain, mismatch });
      } catch(e) {}
    });
  }

  const attachments = [];
  try {
    pane.querySelectorAll('[aria-label*="attachment" i],[class*="attachment" i],[class*="Attachment" i]').forEach(el => {
      const name = el.getAttribute('aria-label') || el.innerText || '';
      if (name.trim()) attachments.push(name.trim().toLowerCase());
    });
    pane.querySelectorAll('[class*="attachmentName" i],[class*="fileName" i],[data-testid*="attachment" i]').forEach(el => {
      const name = el.innerText || '';
      if (name.trim()) attachments.push(name.trim().toLowerCase());
    });
  } catch(e) {}

  const HIGH_RISK_EXTENSIONS = ['.htm','.html','.js','.vbs','.vbe','.ps1','.wsf','.wsh','.jar','.hta'];
  const SUSPICIOUS_EXTENSIONS = ['.exe','.msi','.bat','.cmd','.iso','.img','.zip','.rar','.7z','.docm','.xlsm','.pptm','.lnk'];
  const hasHighRiskAttachment = attachments.some(a => HIGH_RISK_EXTENSIONS.some(ext => a.endsWith(ext)));
  const hasSuspiciousAttachment = attachments.some(a => SUSPICIOUS_EXTENSIONS.some(ext => a.endsWith(ext)));
  const highRiskFiles = attachments.filter(a => HIGH_RISK_EXTENSIONS.some(ext => a.endsWith(ext)));
  const suspiciousFiles = attachments.filter(a => SUSPICIOUS_EXTENSIONS.some(ext => a.endsWith(ext)));

  return { subject, sender, senderHasEmail, body: body.slice(0, 3000), links: links.slice(0, 20), attachments, hasHighRiskAttachment, hasSuspiciousAttachment, highRiskFiles, suspiciousFiles };
}

// --- Link Revelation ---
function revealLinks() {
  const pane = getReadingPane();
  const bodyEl = pane.querySelector('[aria-label="Message body"]') ||
    pane.querySelector('div[class*="UniqueMessageBody"]') ||
    pane.querySelector('[id*="UniqueMessageBody"]') ||
    pane.querySelector('div[class*="messageBody"]');
  if (!bodyEl) return;

  bodyEl.querySelectorAll('a[href]').forEach(a => {
    if (a.getAttribute('data-oe-revealed')) return;
    a.setAttribute('data-oe-revealed', '1');
    try {
      let href = a.getAttribute('href') || '';
      if (href.includes('safelinks.protection.outlook.com') || href.includes('urldefense') || href.includes('trendmicro')) {
        try {
          const u = new URL(href);
          const urlParam = u.searchParams.get('url') || u.searchParams.get('u');
          if (urlParam) href = decodeURIComponent(urlParam);
        } catch(e) {}
      }
      if (!href || href.startsWith('mailto:') || href.startsWith('#') || href.length < 10) return;
      let domain = '';
      try { domain = new URL(href).hostname.toLowerCase(); } catch(e) { return; }
      const displayText = a.innerText.trim().toLowerCase();
      if (displayText.includes(domain)) return;
      const label = document.createElement('span');
      label.style.cssText = 'color:#888;font-size:0.85em;font-weight:normal;user-select:text;';
      label.textContent = ' [' + domain + ']';
      const urlPattern = displayText.match(/(?:https?:\/\/|www\.)([\w.-]+)/i);
      if (urlPattern) {
        const dd = urlPattern[1].replace(/^www\./, '');
        const rd = domain.replace(/^www\./, '');
        if (!rd.includes(dd) && !dd.includes(rd)) {
          label.style.color = '#cc0000';
          label.style.fontWeight = 'bold';
          label.textContent = ' WARNING [GOES TO: ' + domain + ']';
        }
      }
      a.insertAdjacentElement('afterend', label);
    } catch(e) {}
  });
}

// --- Analysis ---
async function analyzeCurrentEmail() {
  const email = extractEmail();
  setLoading();

  // --- GIFT CARD FRAUD: hard pre-check, bypass API ---
  if (checkForGiftCardFraud(email)) {
    showResult({
      verdict: 'PHISHING',
      phishing_score: 99,
      spam_score: 10,
      summary: 'This email contains a request for gift cards. This is one of the most common fraud tactics used against businesses — it is almost certainly a scam.',
      findings: [
        {
          flag: 'Gift card request detected',
          explanation: 'Fraudsters impersonate managers, executives, or colleagues and ask employees to buy gift cards (iTunes, Google Play, Amazon, Visa, etc.) urgently. They always claim it is for a surprise, a client, or an emergency. No legitimate business request will ever ask for gift card payments — this is a well-known scam that costs businesses millions every year.',
          howToSpotIt: 'If ANY email asks you to buy gift cards and send the codes — stop immediately. It does not matter if it appears to come from your boss or a senior executive. Call that person directly on a known phone number to verify before doing anything.'
        }
      ],
      lesson: 'No legitimate business transaction is ever completed with gift cards. If someone asks you to buy gift cards and send the codes, it is a scam — 100% of the time.',
      suggested_action: 'Do NOT purchase any gift cards. Report this email to your IT security team and your manager immediately. If you have already purchased cards, contact the card issuer right away to try to stop the transaction.'
    }, email);
    return;
  }

  const now = new Date();
  const utcString = now.toUTCString();
  const localString = now.toLocaleString('en-US', { timeZone: 'America/Edmonton', timeZoneName: 'short' });

  let isOutlookExternal = false;
  try {
    const paneForExternal = getReadingPane();
    const candidates = [
      ...paneForExternal.querySelectorAll('[role="alert"]'),
      ...paneForExternal.querySelectorAll('[role="status"]'),
      ...paneForExternal.querySelectorAll('[class*="InfoBar" i]'),
      ...paneForExternal.querySelectorAll('[class*="infoBar" i]'),
      ...paneForExternal.querySelectorAll('[class*="banner" i]'),
      ...paneForExternal.querySelectorAll('[class*="warning" i]'),
    ];
    for (const el of candidates) {
      const text = el.innerText || '';
      if (text.length < 200 && text.toLowerCase().includes('external organization')) {
        isOutlookExternal = true;
        break;
      }
    }
  } catch(e) {}

  const prompt = `You are a cybersecurity educator helping everyday office workers learn to identify email threats. Analyze the email below and respond ONLY with a JSON object - no markdown, no text outside the JSON.

IMPORTANT CONTEXT:
- Current date/time: ${utcString} (UTC) / ${localString} (Mountain Time). Do not flag dates as suspicious if they fall within the current day across timezones.
- Recipient organization domain: __TENANT_DOMAIN__
- Sender: ${email.sender}
- Outlook external org warning present: ${isOutlookExternal ? 'YES - Microsoft has confirmed this is from an external organization.' : 'NO - treat as internal unless you find an external email address in body/signature'}
- If sender is "(No sender found)" that is a technical extraction issue, NOT a red flag - do not flag it as suspicious
- Do NOT assume external based on display name alone
- SharePoint/OneDrive links from __TENANT_DOMAIN__ or sharepoint.com are INTERNAL collaboration links, never flag as suspicious
- Microsoft system emails (PowerAutomateNoReply, SharePoint, Teams notifications) from microsoft.com are legitimate system notifications, not suspicious
__CUSTOM_PROMPT__

KEY RULES:
1. NEVER give any email a free pass based on sender domain alone - even internal senders can be compromised.
2. Only flag as external if Outlook shows the warning OR you find an external email address in body/signature.
3. Well-known domains (microsoft.com etc) - don't flag the domain itself, but DO flag suspicious content, urgency, credential requests.
4. Analyze content and intent independently of sender.
5. If email involves adding users, granting access, payments, credential changes, or urgent action - suggested_action MUST include: "Verify this request through official channels other than email before taking action."
6. If email contains a login link, verification code, OTP, security alert, or account notification - suggested_action MUST include: "If you did not request this, do not click any links and report this to your IT security team immediately."
7. If email contains a verification or security code - suggested_action MUST include: "Never share this code with anyone - legitimate services will never ask you for it."
8. GIFT CARD RULE: Any request to purchase or send gift cards of any kind (iTunes, Google Play, Amazon, Visa, Steam, etc.) MUST be flagged as PHISHING with phishing_score of 99. No legitimate business ever requests gift card payments. This is always fraud.

VERDICT DEFINITIONS - apply these strictly:
- SAFE: Legitimate email with no red flags. Internal comms, expected system notifications, known business contacts.
- SPAM: Unsolicited commercial or marketing email. Insurance offers, benefit programs, promotions, newsletters, sales pitches from outside the org. No credential theft or malware risk - just unwanted. Use SPAM (not SUSPICIOUS) for these.
- SUSPICIOUS: Something feels off but not clearly malicious. Unexpected requests, odd sender, minor red flags that don't rise to phishing.
- PHISHING: Actively trying to steal credentials, install malware, or trick the user into a harmful action.

EDUCATION FOCUS - THIS IS CRITICAL:
Write all findings for a non-technical audience. No jargon. For each red flag:
- Explain what the attacker is doing and WHY it fools people
- Explain exactly how the user can spot this themselves next time
- Use plain conversational language like explaining to a friend
- If there are NO red flags, return an empty findings array - do not invent issues

Email details:
Subject: ${email.subject}
From: ${email.sender}
Body:
${email.body}
Attachments found: ${email.attachments && email.attachments.length > 0 ? email.attachments.join(', ') : '(none)'}
${email.hasHighRiskAttachment ? 'CRITICAL: HIGH RISK attachment(s) detected: ' + email.highRiskFiles.join(', ') + '. You MUST set verdict to PHISHING, phishing_score to at least 90, and suggested_action MUST include: Do NOT open this attachment. Report this email to your IT security team immediately.' : ''}
${email.hasSuspiciousAttachment && !email.hasHighRiskAttachment ? 'WARNING: SUSPICIOUS attachment(s) detected: ' + email.suspiciousFiles.join(', ') + '. Set phishing_score to at least 60 and suggested_action MUST include: Do not open this attachment unless you are certain of its origin.' : ''}

EMBEDDED LINKS (already decoded from safelinks wrappers):
${email.links.length > 0 ? email.links.map(l => ' - Display: "' + l.display + '" -> Real domain: ' + l.href + (l.mismatch ? ' WARNING: DOMAIN MISMATCH' : '')).join('\n') : ' (No links found)'}

When analyzing links:
1. Do NOT flag safelinks.protection.outlook.com or urldefense.com - already decoded above
2. Flag display text showing one domain but real destination is completely different
3. Flag suspicious TLDs or domains impersonating known brands
4. Flag URL shorteners (bit.ly, tinyurl, t.co)

Respond with this EXACT JSON structure:
{
  "verdict": "SAFE" | "SUSPICIOUS" | "SPAM" | "PHISHING",
  "phishing_score": <0-100>,
  "spam_score": <0-100>,
  "summary": "<1-2 sentence plain-English summary>",
  "findings": [
    {
      "flag": "<Short plain-English name of the red flag>",
      "explanation": "<2-3 sentences: what the attacker is doing, why this technique fools people, what the risk is>",
      "howToSpotIt": "<1-2 sentences: exactly what to look for in any email to catch this yourself next time>"
    }
  ],
  "lesson": "<One memorable sentence the user can apply to every future email>",
  "suggested_action": "<Clear instruction on what to do right now>"
}`;

  try {
    chrome.runtime.sendMessage({ type: 'ANALYZE_EMAIL', prompt });
  } catch(e) {
    showError('Extension was reloaded. Please refresh the page and try again.');
    return;
  }

  window._oe_timeout = setTimeout(() => {
    showError('Timed out. Check the service worker console at chrome://extensions.');
  }, 20000);
  window._oe_email = email;
}

// --- UI States ---
function setLoading() {
  document.getElementById('oe-body').innerHTML = `
    <div id="oe-loading" style="text-align:center;padding:20px;color:#555;">
      <div class="oe-spinner"></div>
      <p>Analyzing email...</p>
    </div>`;
  document.getElementById('oe-analyze-btn').style.display = 'none';
}

function showError(msg) {
  document.getElementById('oe-body').innerHTML = `<div style="color:#c00;padding:12px;">⚠️ ${msg}</div>`;
  document.getElementById('oe-analyze-btn').style.display = 'block';
}

function showResult(result, email) {
  const verdictClass = {
    'SAFE': 'verdict-safe', 'SUSPICIOUS': 'verdict-suspicious',
    'SPAM': 'verdict-spam', 'PHISHING': 'verdict-phishing'
  }[result.verdict] || 'verdict-suspicious';

  const verdictIcon = {
    'SAFE': '✅', 'SUSPICIOUS': '⚠️', 'SPAM': '🚫', 'PHISHING': '🎣'
  }[result.verdict] || '⚠️';

  const findingsHTML = (result.findings || []).map(f => `
    <div class="oe-finding">
      <div class="oe-finding-header">
        <span class="oe-finding-icon">🚩</span>
        <span class="oe-finding-flag">${f.flag}</span>
        <span class="oe-finding-toggle">▼</span>
      </div>
      <div class="oe-finding-body">
        <div class="oe-finding-section">
          <div class="oe-finding-label">What's happening</div>
          <div class="oe-finding-text">${f.explanation}</div>
        </div>
        <div class="oe-finding-section oe-tip">
          <div class="oe-finding-label">💡 How to spot this yourself</div>
          <div class="oe-finding-text">${f.howToSpotIt}</div>
        </div>
      </div>
    </div>
  `).join('');

  const combined = ((email.body || '') + ' ' + (email.subject || '')).toLowerCase();
  const isLoginOrCode = ['sign in','verification code','one-time','otp','log in','verify your',
    'secure link','reset your password','confirm your','your account','click here to'].some(kw => combined.includes(kw));
  const showWarning = isLoginOrCode || result.verdict === 'PHISHING' || result.phishing_score >= 60;

  document.getElementById('oe-body').innerHTML = `
    <div class="oe-verdict ${verdictClass}">
      <span class="oe-verdict-icon">${verdictIcon}</span>
      <span class="oe-verdict-label">${result.verdict}</span>
    </div>
    <div class="oe-scores">
      <div class="oe-score">
        <span class="oe-score-label">Phishing Risk</span>
        <span class="oe-score-val">${result.phishing_score}/100</span>
      </div>
      <div class="oe-score">
        <span class="oe-score-label">Spam Score</span>
        <span class="oe-score-val">${result.spam_score}/100</span>
      </div>
    </div>
    <div class="oe-section">
      <div class="oe-section-title">Summary</div>
      <p>${result.summary}</p>
    </div>
    ${findingsHTML ? `
    <div class="oe-section">
      <div class="oe-section-title">🔍 What We Found — tap each to learn more</div>
      ${findingsHTML}
    </div>` : ''}
    ${email.links && email.links.length > 0 ? `
    <div class="oe-section">
      <div class="oe-section-title">🔗 Links in this email (${email.links.length})</div>
      ${email.links.map(l => `
        <div class="oe-link ${l.mismatch ? 'oe-link-mismatch' : ''}">
          <span class="oe-link-display">${l.display}</span>
          <span class="oe-link-dest">→ ${l.href}${l.mismatch ? ' ⚠️ GOES SOMEWHERE DIFFERENT' : ''}</span>
        </div>`).join('')}
    </div>` : ''}
    ${result.lesson ? `
    <div class="oe-lesson">
      <div class="oe-lesson-title">📚 Remember for next time</div>
      <div class="oe-lesson-text">${result.lesson}</div>
    </div>` : ''}
    ${showWarning ? `
    <div class="oe-warning-banner">
      ⚠️ If you did not request this, do not click any links and <strong>report this to your IT security team immediately.</strong>
    </div>` : ''}
    <div class="oe-section">
      <div class="oe-section-title">✅ Suggested Action</div>
      <p>${result.suggested_action}</p>
    </div>
  `;

  const btn = document.getElementById('oe-analyze-btn');
  btn.style.display = 'block';
  btn.textContent = 'Analyze Another';
  btn.disabled = false;
}

function showEmailReady(subject) {
  document.getElementById('oe-body').innerHTML = `
    <div class="oe-email-ready">
      <p>📨 <strong>${subject.slice(0, 60)}${subject.length > 60 ? '...' : ''}</strong></p>
      <p>Click Analyze to check this email for threats.</p>
    </div>`;
  document.getElementById('oe-analyze-btn').style.display = 'block';
  document.getElementById('oe-analyze-btn').textContent = 'Analyze Email';
}

// --- Email Change Detection ---
function checkForEmailChange() {
  const pane = getReadingPane();
  const allBtns = Array.from(pane.querySelectorAll('button[aria-label]'));
  const fromBtn = allBtns.find(b => b.getAttribute('aria-label').startsWith('From:'));
  const selectedRow = document.querySelector('[aria-selected="true"]');
  const selectedLabel = selectedRow ? (selectedRow.getAttribute('aria-label') || '') : '';
  const emailId = (fromBtn ? fromBtn.getAttribute('aria-label') : '') + selectedLabel;

  if (emailId && emailId.length > 5 && emailId !== lastEmailId) {
    lastEmailId = emailId;
    const isLoading = !!document.getElementById('oe-loading');
    if (!isLoading) {
      const displaySubject = findTextIn(pane, [
        '[data-testid="subject"]', '[aria-label="Message subject"]', 'h1', '[role="heading"]'
      ]) || selectedLabel.slice(0, 80);
      showEmailReady(displaySubject || 'Email selected');
      setTimeout(revealLinks, 800);

      setTimeout(() => {
        const HIGH_RISK = ['.htm','.html','.js','.vbs','.vbe','.ps1','.wsf','.wsh','.jar','.hta'];
        const SUSPICIOUS = ['.exe','.msi','.bat','.cmd','.iso','.img','.zip','.rar','.7z','.docm','.xlsm','.pptm','.lnk'];
        const p = getReadingPane();
        const attachEls = p.querySelectorAll('[aria-label*="attachment" i],[class*="attachmentName" i],[class*="fileName" i]');
        const highRisk = [];
        const suspicious = [];
        attachEls.forEach(el => {
          const name = (el.getAttribute('aria-label') || el.innerText || '').toLowerCase().trim();
          if (HIGH_RISK.some(ext => name.endsWith(ext))) highRisk.push(name);
          else if (SUSPICIOUS.some(ext => name.endsWith(ext))) suspicious.push(name);
        });
        const bodyEl = document.getElementById('oe-body');
        if (!bodyEl) return;
        const existing = document.getElementById('oe-attach-warning');
        if (existing) existing.remove();
        if (highRisk.length > 0) {
          const warn = document.createElement('div');
          warn.id = 'oe-attach-warning';
          warn.style.cssText = 'background:#cc0000;color:white;padding:10px 12px;border-radius:6px;margin-bottom:8px;font-size:12px;font-weight:bold;line-height:1.5;';
          warn.innerHTML = '⚠️ HIGH RISK ATTACHMENT: ' + highRisk.join(', ') + '<br>Do NOT open. Report to IT security immediately.';
          bodyEl.insertBefore(warn, bodyEl.firstChild);
        } else if (suspicious.length > 0) {
          const warn = document.createElement('div');
          warn.id = 'oe-attach-warning';
          warn.style.cssText = 'background:#b45309;color:white;padding:10px 12px;border-radius:6px;margin-bottom:8px;font-size:12px;font-weight:bold;line-height:1.5;';
          warn.innerHTML = '⚠️ SUSPICIOUS ATTACHMENT: ' + suspicious.join(', ') + '<br>Verify with sender before opening.';
          bodyEl.insertBefore(warn, bodyEl.firstChild);
        }
      }, 1000);
    }
  }
}

// --- Init ---
function init() {
  createSidebar();
  setTimeout(() => {
    const btn = document.getElementById('oe-analyze-btn');
    if (btn && btn.style.display === 'none') {
      btn.style.display = 'block';
      btn.textContent = 'Analyze Email';
    }
  }, 3000);
  setInterval(checkForEmailChange, 1000);
  observer = new MutationObserver(() => { checkForEmailChange(); });
  observer.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected']
  });
  setTimeout(checkForEmailChange, 2000);
}

// --- Message listener ---
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ANALYSIS_DONE') {
    clearTimeout(window._oe_timeout);
    if (message.error) { showError('Analysis failed: ' + message.error); return; }
    if (!message.result) { showError('No result received. Please try again.'); return; }
    showResult(message.result, window._oe_email || {});
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  setTimeout(init, 1500);
}
