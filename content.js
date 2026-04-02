// Outlook Email Evaluator - Content Script
let sidebar = null;
let lastEmailId = null;
let observer = null;


// --- XSS-safe HTML / URLs (never interpolate raw strings into innerHTML) ---
function escapeHtml(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Returns https? URL string or null — never javascript:, data:, etc. */
function safeHttpUrl(raw) {
  if (raw == null || raw === '') return null;
  const trimmed = String(raw).trim().slice(0, 2048);
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch {
    return null;
  }
  return null;
}

function buildLinkRowHtml(l, lookalikeHit) {
  const display = escapeHtml(l.display);
  const href = safeHttpUrl(l.fullUrl);
  const mismatch = l.mismatch
    ? ' <span style="color:#cc0000;font-weight:bold;">DESTINATION MISMATCH</span>'
    : '';
  const lookalikeBadge = lookalikeHit
    ? `<span class="oe-link-lookalike-badge" title="Impersonates ${escapeHtml(lookalikeHit.legitimateDomain)} via ${escapeHtml(lookalikeHit.technique)}">🎭 LOOKALIKE: ${escapeHtml(lookalikeHit.brand)}</span>`
    : '';
  if (href) {
    const eh = escapeHtml(href);
    return `<div class="oe-link ${l.mismatch ? 'oe-link-mismatch' : ''}">
      <span class="oe-link-display">${display}</span>
      <span class="oe-link-dest" style="display:block;word-break:break-all;font-size:0.82em;margin-top:3px;color:#555;">→ <a href="${eh}" rel="noopener noreferrer" target="_blank" style="color:#1a6eb5;text-decoration:none;" title="${eh}">${eh}</a>${mismatch}${lookalikeBadge}</span>
    </div>`;
  }
  const fallback = escapeHtml(String(l.fullUrl || l.href || '').trim().slice(0, 2048));
  return `<div class="oe-link ${l.mismatch ? 'oe-link-mismatch' : ''}">
    <span class="oe-link-display">${display}</span>
    <span class="oe-link-dest" style="display:block;word-break:break-all;font-size:0.82em;margin-top:3px;color:#555;">${fallback}${mismatch}${lookalikeBadge}</span>
  </div>`;
}

/** One-line fix + label for common error strings from the background / network. */
function getErrorUi(fullMessage) {
  const m = String(fullMessage || '')
  if (/No proxy URL set/i.test(m)) {
    return { label: 'Setup needed', fix: 'Click the extension icon → Connection → paste your Supabase function URL (…/functions/v1/analyze-email).' }
  }
  if (/Invalid proxy URL/i.test(m)) {
    return { label: 'Invalid URL', fix: 'Use exactly: https://YOUR_PROJECT.supabase.co/functions/v1/analyze-email' }
  }
  if (/No extension token set|extension token/i.test(m)) {
    return { label: 'Setup needed', fix: 'Click the extension icon → Connection → paste your Extension Token (same as Supabase EXTENSION_TOKEN).' }
  }
  if (/wait 5 seconds|Rate limit|429/i.test(m)) {
    return { label: 'Rate limited', fix: 'Wait about 5 seconds, then click Analyze again.' }
  }
  if (/Timed out|timeout/i.test(m)) {
    return { label: 'Timed out', fix: 'Try Analyze again. If it keeps happening, reload this Outlook tab.' }
  }
  if (/Failed to fetch|NetworkError|network|not reachable|ERR_INTERNET|ERR_NETWORK|offline/i.test(m)) {
    return { label: 'Offline or blocked', fix: 'Check your internet and VPN. Ensure Outlook and *.supabase.co are allowed.' }
  }
  if (/Analysis failed:\s*Proxy error 401|401|Unauthorized|Token rejected/i.test(m)) {
    return { label: 'Not authorized', fix: 'Open the extension → Connection → fix Extension Token to match Supabase secrets.' }
  }
  if (/Proxy error|502|503|504/i.test(m)) {
    return { label: 'Server issue', fix: 'The analysis service may be busy. Try again in a moment.' }
  }
  if (/Extension was reloaded|refresh the page/i.test(m)) {
    return { label: 'Extension restarted', fix: 'Refresh this Outlook page (F5), then open the email and analyze again.' }
  }
  if (/Extension not configured|Invalid proxy URL in settings/i.test(m)) {
    return { label: 'Setup needed', fix: 'Click the extension icon → Connection → set function URL and Extension Token, then try again.' }
  }
  if (/Request failed:/i.test(m)) {
    return { label: 'Could not reach server', fix: 'Check internet / VPN, then try again. If it persists, reload this tab.' }
  }
  return { label: 'Something went wrong', fix: 'Try again. If it repeats, reload the page and check Connection settings.' }
}

/** Short notes for odd emails so users know the app isn’t broken. */
function getEmailContextHints(email) {
  const subject = String(email.subject || '')
  const body = String(email.body || '')
  const combined = (subject + ' ' + body).toLowerCase()
  const hints = []
  const bodyTrim = body.trim()
  const bodyLen = bodyTrim.length

  if (/encrypted|can't display|cannot display this message|irm |rights management|sensitivity label|message is protected|unable to display|open in owa only/i.test(combined)) {
    hints.push('This message may be encrypted or rights-protected — only visible text can be analyzed.')
  }
  if (/invitation|calendar|meeting request|teams meeting|zoom meeting|webex|\.ics|accept(ed)? this meeting|decline this meeting|tentative/i.test(combined)) {
    hints.push('Calendar or meeting invites often have little body text — analysis uses only what Outlook shows here.')
  }
  if (bodyLen > 0 && bodyLen < 40 && !/invitation|calendar|meeting/i.test(combined)) {
    hints.push('Very little text was extracted — results may be less certain. Longer threads work best.')
  }
  if ((!email.links || email.links.length === 0) && bodyLen > 15) {
    hints.push('No links found in the visible body — many safe emails have no links.')
  }
  return hints
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
        <div style="display:flex;gap:4px;align-items:center;">
          <button id="oe-dark-toggle" title="Toggle dark mode">🌙</button>
          <button id="oe-close">&#x27E9;</button>
        </div>
      </div>
      <div id="oe-body"><p>Select or open an email to analyze it.</p></div>
      <button id="oe-analyze-btn">🔍 Analyze Email</button>
      <button type="button" id="oe-wake-btn">☀️ Wake Up Extension</button>
      <p class="oe-wake-hint" id="oe-wake-hint">If analysis stops working after sleep, use this before analyzing.</p>
    </div>
  `;
  document.body.appendChild(sidebar);

  document.getElementById('oe-close').addEventListener('click', () => {
    sidebar.classList.add('oe-collapsed');
  });

  // Dark mode - restore saved preference
  try {
    if (localStorage.getItem('oe-dark-mode') === 'true') {
      sidebar.classList.add('oe-dark');
      document.getElementById('oe-dark-toggle').textContent = '☀️';
    }
  } catch(e) {}
  document.getElementById('oe-dark-toggle').addEventListener('click', () => {
    const isDark = sidebar.classList.toggle('oe-dark');
    document.getElementById('oe-dark-toggle').textContent = isDark ? '☀️' : '🌙';
    try { localStorage.setItem('oe-dark-mode', isDark ? 'true' : 'false'); } catch(e) {}
  });
  document.getElementById('oe-tab').addEventListener('click', () => {
    sidebar.classList.remove('oe-collapsed');
  });

  // Ping service worker to wake it, then analyze
  document.getElementById('oe-analyze-btn').addEventListener('click', () => {
    try { chrome.runtime.sendMessage({ type: 'PING' }); } catch(e) {}
    setTimeout(analyzeCurrentEmail, 100);
  });

  // Wake up extension: ping background (content scripts cannot use chrome.tabs / chrome.scripting).
  document.getElementById('oe-wake-btn').addEventListener('click', async () => {
    const btn = document.getElementById('oe-wake-btn');
    btn.textContent = '⏳ Waking up...';
    btn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: 'WAKE_EXTENSION' });
      btn.textContent = '✅ Extension ready. If analysis still fails, refresh this page (F5).';
    } catch (e) {
      btn.textContent = '⚠️ Could not reach extension. Reload the extension or refresh this page.';
    }
    setTimeout(() => {
      btn.textContent = '☀️ Wake Up Extension';
      btn.disabled = false;
    }, 4000);
  });

  // Event delegation for finding card toggles
  document.getElementById('oe-body').addEventListener('click', (e) => {
    const header = e.target.closest('.oe-finding-header');
    if (header) header.parentElement.classList.toggle('oe-finding-open');
  });
}

// --- SafeLinks / URL-wrapper decoder ---
function decodeWrappedUrl(href) {
  if (!href) return href;
  try {
    // Unescape HTML entities Outlook may inject into href attributes (e.g. &amp; -> &)
    href = href.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    // Microsoft SafeLinks: safelinks.protection.outlook.com?url=...
    if (href.includes('safelinks.protection.outlook.com')) {
      const u = new URL(href);
      const decoded = u.searchParams.get('url');
      if (decoded) return decodeURIComponent(decoded);
    }
    // Trend Micro IMSVA / Email Security: various param names
    if (href.includes('trendmicro') || href.includes('imsva') || href.includes('tmase')) {
      const u = new URL(href);
      const decoded = u.searchParams.get('url') || u.searchParams.get('u') || u.searchParams.get('__u');
      if (decoded) return decodeURIComponent(decoded);
      // Trend Micro path-encoded: /redirect?url=BASE64
      const b64 = u.searchParams.get('redirectUrl') || u.searchParams.get('r');
      if (b64) { try { return atob(b64); } catch(e) {} }
    }
    // Proofpoint URLDefense v2: urldefense.proofpoint.com/v2/url?u=...
    if (href.includes('urldefense') && href.includes('/v2/')) {
      const u = new URL(href);
      let raw = u.searchParams.get('u');
      if (raw) {
        raw = raw.replace(/-/g, '%').replace(/_/g, '/');
        return decodeURIComponent(raw);
      }
    }
    // Proofpoint URLDefense v3: urldefense.com/v3/__https://...
    if (href.includes('urldefense') && href.includes('/v3/')) {
      const match = href.match(/\/v3\/__([^_]+)__/);
      if (match) return decodeURIComponent(match[1]);
    }
    // Mimecast: protect2.mimecast.com/s/...?domain=...&url=...
    if (href.includes('mimecast.com')) {
      const u = new URL(href);
      const decoded = u.searchParams.get('url') || u.searchParams.get('u');
      if (decoded) return decodeURIComponent(decoded);
    }
    // Generic: any URL with a ?url= or ?u= param that looks like a full URL
    if (href.includes('?')) {
      const u = new URL(href);
      const decoded = u.searchParams.get('url') || u.searchParams.get('u');
      if (decoded && (decoded.startsWith('http') || decoded.startsWith('%68%74'))) {
        return decodeURIComponent(decoded);
      }
    }
  } catch(e) {}
  return href;
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
        href = decodeWrappedUrl(href);
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
        links.push({ display: displayText.slice(0, 80) || '(no text)', href: hrefDomain, fullUrl: href, mismatch });
      } catch(e) {}
    });
  }

  // --- Attachment scraping: cast a wide net across Outlook's dynamic DOM ---
  const attachments = [];
  try {
    const attachSeen = new Set();
    const EXT_RE = /\.\w{2,5}$/i;
    function addAttachment(raw) {
      const name = (raw || '').trim().toLowerCase();
      if (!name || !EXT_RE.test(name) || attachSeen.has(name)) return;
      attachSeen.add(name);
      attachments.push(name);
    }
    // Outlook attachment pills may be outside the reading pane - search full body
    const attachRoot = document.body;
    // Strategy 1: aria-label attributes that look like filenames
    attachRoot.querySelectorAll('[aria-label]').forEach(el => {
      const label = el.getAttribute('aria-label') || '';
      if (EXT_RE.test(label) && label.length < 260) addAttachment(label);
    });
    // Strategy 2: class-name-based selectors for attachment chips/pills
    attachRoot.querySelectorAll(
      '[class*="attachmentName" i],[class*="fileName" i],' +
      '[class*="AttachmentName" i],[class*="FileName" i],' +
      '[data-testid*="attachment" i],[data-testid*="Attachment" i],' +
      '[class*="attachmentTile" i],[class*="attachmentCard" i]'
    ).forEach(el => { addAttachment(el.innerText); });
    // Strategy 3: leaf-node text inside an attachment container
    attachRoot.querySelectorAll('span,div').forEach(el => {
      if (el.children.length > 0) return;      const txt = (el.innerText || '').trim();
      if (txt.length > 4 && txt.length < 200 && EXT_RE.test(txt) && !txt.includes('\n')) {
        const parent = el.closest('[class*="attach" i],[class*="Attach" i],[aria-label*="attach" i]');
        if (parent) addAttachment(txt);
      }
    });
  } catch(e) {}


  let recipient = '(No recipient found)';
  try {
    const toBtn = Array.from(pane.querySelectorAll('button[aria-label]'))
      .find(b => (b.getAttribute('aria-label') || '').startsWith('To:'));
    if (toBtn) recipient = toBtn.getAttribute('aria-label').replace(/^To:\s*/i, '').trim();
  } catch(e) {}
  if (recipient === '(No recipient found)') {
    recipient = findTextIn(pane, [
      '[data-testid="recipientName"]', '[class*="recipient" i]', '[class*="toLine" i]'
    ]) || '(No recipient found)';
  }

  const senderHasEmail = sender !== '(No sender found)' && sender.includes('@');
  const HIGH_RISK_EXTS = ['.htm','.html','.js','.vbs','.vbe','.ps1','.wsf','.wsh','.jar','.hta'];
  const SUSPICIOUS_EXTS = ['.exe','.msi','.bat','.cmd','.iso','.img','.zip','.rar','.7z','.docm','.xlsm','.pptm','.lnk'];
  const SAFE_DECOY_EXTS = ['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.txt','.png','.jpg','.jpeg','.gif','.csv'];

  // Double-extension detection: e.g. "invoice.pdf.exe", "report.docx.js"
  const doubleExtFiles = attachments.filter(n => {
    const parts = n.split('.');
    if (parts.length < 3) return false;
    const finalExt = '.' + parts[parts.length - 1];
    const penultExt = '.' + parts[parts.length - 2];
    return (HIGH_RISK_EXTS.includes(finalExt) || SUSPICIOUS_EXTS.includes(finalExt)) && SAFE_DECOY_EXTS.includes(penultExt);
  });

  const highRiskFiles = [...new Set([
    ...attachments.filter(n => HIGH_RISK_EXTS.some(ext => n.endsWith(ext))),
    ...doubleExtFiles,
  ])];
  const suspiciousFiles = attachments.filter(n =>
    !highRiskFiles.includes(n) && SUSPICIOUS_EXTS.some(ext => n.endsWith(ext))
  );
  const hasHighRiskAttachment = highRiskFiles.length > 0;
  const hasSuspiciousAttachment = suspiciousFiles.length > 0;
  const attachmentCount = attachments.length;
  const hasHighAttachmentCount = attachmentCount >= 5;

  return { subject, sender, senderHasEmail, recipient, body: body.slice(0, 3000), links: links.slice(0, 20), attachments, hasHighRiskAttachment, hasSuspiciousAttachment, highRiskFiles, suspiciousFiles, doubleExtFiles, attachmentCount, hasHighAttachmentCount };
}
// --- Header Signal Extraction ---
// Outlook Web doesn't expose raw SMTP headers, but several header-derived
// signals ARE visible in the DOM. We extract them here.
function extractHeaderSignals(pane) {
  const signals = {
    replyTo: null,          // Reply-To address if different from sender
    onBehalfOf: null,       // "Sent on behalf of" address
    displayNameMismatch: false, // Display name implies different org than actual email
    displayName: null,      // The display name portion of the sender
    senderEmail: null,      // The raw email portion of the sender
    viaHeader: null,        // "via" domain (e.g. sent via mailchimp.com)
    outlookWarnings: [],    // Any info-bar / banner text Outlook surfaced
  };

  try {
    // --- Reply-To: Outlook sometimes shows this in the details area ---
    const allBtns = Array.from(document.body.querySelectorAll('button[aria-label]'));
    const replyToBtn = allBtns.find(b => /^Reply-To:/i.test(b.getAttribute('aria-label') || ''));
    if (replyToBtn) {
      signals.replyTo = replyToBtn.getAttribute('aria-label').replace(/^Reply-To:\s*/i, '').trim();
    }
    // Also check aria-label on any element containing "Reply-To"
    if (!signals.replyTo) {
      const allEls = Array.from(document.body.querySelectorAll('[aria-label]'));
      const rtEl = allEls.find(el => /reply.?to/i.test(el.getAttribute('aria-label') || ''));
      if (rtEl) {
        const label = rtEl.getAttribute('aria-label');
        const emailMatch = label.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
        if (emailMatch) signals.replyTo = emailMatch[0];
      }
    }

    // --- On-Behalf-Of: "Sent on behalf of <name>" rendering ---
    const fromArea = pane.querySelector('[class*="from" i],[class*="From"],[data-testid*="from" i]');
    const fromText = fromArea ? (fromArea.innerText || '') : (pane.innerText || '');
    const oboMatch = fromText.match(/(?:on behalf of|sent on behalf of)\s+([^\n<(]+)/i);
    if (oboMatch) signals.onBehalfOf = oboMatch[1].trim().slice(0, 200);

    // --- Via header: "via mailchimp.com" or "via sendgrid.net" ---
    const viaMatch = fromText.match(/\bvia\s+([\w.-]+\.[a-z]{2,})/i);
    if (viaMatch) signals.viaHeader = viaMatch[1].toLowerCase();

    // --- Parse display name vs actual email from sender button ---
    const fromBtn = allBtns.find(b => /^From:/i.test(b.getAttribute('aria-label') || ''));
    if (fromBtn) {
      const raw = fromBtn.getAttribute('aria-label').replace(/^From:\s*/i, '').trim();
      // Formats: "Display Name <email@domain.com>" or just "email@domain.com"
      const angleMatch = raw.match(/^(.+?)\s*<([\w.+-]+@[\w.-]+)>/);
      if (angleMatch) {
        signals.displayName = angleMatch[1].trim();
        signals.senderEmail = angleMatch[2].toLowerCase();
      } else {
        const bareEmail = raw.match(/[\w.+-]+@[\w.-]+/);
        if (bareEmail) signals.senderEmail = bareEmail[0].toLowerCase();
        signals.displayName = raw.replace(/[\w.+-]+@[\w.-]+/, '').trim() || null;
      }

      // Display name mismatch: name implies a brand but email is a different domain
      if (signals.displayName && signals.senderEmail) {
        const displayLower = signals.displayName.toLowerCase();
        const emailDomain = signals.senderEmail.split('@')[1] || '';
        // Check if display name contains a well-known brand that differs from sender domain
        const KNOWN_BRANDS = [
          'microsoft','apple','google','amazon','paypal','netflix','facebook','meta',
          'instagram','linkedin','twitter','x.com','dropbox','docusign','zoom',
          'wells fargo','chase','bank of america','citibank','irs','canada revenue',
          'cra','service canada','fedex','ups','dhl','usps',
        ];
        const namedBrand = KNOWN_BRANDS.find(brand => displayLower.includes(brand));
        if (namedBrand) {
          // If brand name is in display but not in email domain, that's suspicious
          const brandCore = namedBrand.replace(/\s+/g, '').replace(/\./g, '');
          if (!emailDomain.includes(brandCore) && !emailDomain.includes(namedBrand.split(' ')[0])) {
            signals.displayNameMismatch = true;
          }
        }
      }
    }

    // --- Collect all Outlook info-bar / banner warnings ---
    const warningCandidates = [
      ...document.body.querySelectorAll('[role="alert"]'),
      ...document.body.querySelectorAll('[role="status"]'),
      ...document.body.querySelectorAll('[class*="InfoBar" i]'),
      ...document.body.querySelectorAll('[class*="infoBar" i]'),
      ...document.body.querySelectorAll('[class*="MessageBar" i]'),
      ...document.body.querySelectorAll('[class*="banner" i]'),
    ];
    const seenWarnings = new Set();
    for (const el of warningCandidates) {
      const txt = (el.innerText || '').trim();
      if (txt.length > 5 && txt.length < 400 && !seenWarnings.has(txt)) {
        seenWarnings.add(txt);
        signals.outlookWarnings.push(txt);
      }
    }
  } catch(e) {}

  return signals;
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
      href = decodeWrappedUrl(href);
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
  window._oe_emailHints = getEmailContextHints(email);
  setLoading();
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

  const headerSignals = extractHeaderSignals(getReadingPane());

  const emailData = {
    subject: email.subject,
    sender: email.sender,
    recipient: email.recipient,    senderHasEmail: email.senderHasEmail,
    body: email.body,
    links: email.links,
    attachments: email.attachments,
    isOutlookExternal: isOutlookExternal,
    // Header-derived signals
    replyTo: headerSignals.replyTo,    onBehalfOf: headerSignals.onBehalfOf,
    viaHeader: headerSignals.viaHeader,
    displayName: headerSignals.displayName,    senderEmail: headerSignals.senderEmail,
    displayNameMismatch: headerSignals.displayNameMismatch,    outlookWarnings: headerSignals.outlookWarnings,
    clientTimestamp: new Date().toISOString(),
    clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };

  try {
    chrome.runtime.sendMessage({ type: 'ANALYZE_EMAIL', emailData });
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
    <div id="oe-loading" style="padding:14px;">
      <div class="oe-ai-steps">
        <div class="oe-ai-step" id="oe-step-read">
          <div class="oe-step-icon-wrap"><span class="oe-step-icon">&#128232;</span><span class="oe-step-check">&#10003;</span></div>
          <div class="oe-step-info">
            <div class="oe-step-title">Reading Email</div>
            <div class="oe-step-bar"><div class="oe-step-fill"></div></div>
          </div>
        </div>
        <div class="oe-ai-step" id="oe-step-think">
          <div class="oe-step-icon-wrap"><span class="oe-step-icon">&#129504;</span><span class="oe-step-check">&#10003;</span></div>
          <div class="oe-step-info">
            <div class="oe-step-title">Thinking...</div>
            <div class="oe-step-bar"><div class="oe-step-fill"></div></div>
          </div>
        </div>
        <div class="oe-ai-step" id="oe-step-generate">
          <div class="oe-step-icon-wrap"><span class="oe-step-icon">&#9997;</span><span class="oe-step-check">&#10003;</span></div>
          <div class="oe-step-info">
            <div class="oe-step-title">Generating Response</div>
            <div class="oe-step-bar"><div class="oe-step-fill"></div></div>
          </div>
        </div>
      </div>
      <p class="oe-loading-hint">Connecting to your analysis server…</p>
    </div>`;
  document.getElementById('oe-analyze-btn').style.display = 'none';
  document.getElementById('oe-wake-btn').style.display = 'none';
  const wakeHint = document.getElementById('oe-wake-hint');
  if (wakeHint) wakeHint.style.display = 'none';
  const _steps = [
    { id: 'oe-step-read',     delay: 0,    duration: 1400 },
    { id: 'oe-step-think',    delay: 1200, duration: 1800 },
    { id: 'oe-step-generate', delay: 2800, duration: 99999 },
  ];
  _steps.forEach(({ id, delay, duration }) => {
    setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.add('oe-step-active');
      setTimeout(() => {
        if (duration < 99999) { el.classList.remove('oe-step-active'); el.classList.add('oe-step-done'); }
      }, duration);
    }, delay);
  });
}

function showError(msg) {
  const raw = String(msg || '')
  const ui = getErrorUi(raw)
  const detail = escapeHtml(raw.replace(/^Analysis failed:\s*/i, '').trim())
  document.getElementById('oe-body').innerHTML = `
    <div class="oe-error-card">
      <div class="oe-error-badge">${escapeHtml(ui.label)}</div>
      <div class="oe-error-detail">⚠️ ${detail}</div>
      <div class="oe-error-fix"><strong>What to do:</strong> ${escapeHtml(ui.fix)}</div>
    </div>`;
  document.getElementById('oe-analyze-btn').style.display = 'block';
  document.getElementById('oe-wake-btn').style.display = 'block';
  const wakeHintErr = document.getElementById('oe-wake-hint');
  if (wakeHintErr) wakeHintErr.style.display = 'block';
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
        <span class="oe-finding-flag">${escapeHtml(f.flag)}</span>
        <span class="oe-finding-toggle">▼</span>
      </div>
      <div class="oe-finding-body">
        <div class="oe-finding-section">
          <div class="oe-finding-label">What's happening</div>
          <div class="oe-finding-text">${escapeHtml(f.explanation)}</div>
        </div>
        <div class="oe-finding-section oe-tip">
          <div class="oe-finding-label">💡 How to spot this yourself</div>
          <div class="oe-finding-text">${escapeHtml(f.howToSpotIt)}</div>
        </div>
      </div>
    </div>
  `).join('');

  const combined = ((email.body || '') + ' ' + (email.subject || '')).toLowerCase();
  const isLoginOrCode = ['sign in','verification code','one-time','otp','log in','verify your',
    'secure link','reset your password','confirm your','your account','click here to'].some(kw => combined.includes(kw));
  const showWarning = isLoginOrCode || result.verdict === 'PHISHING' || result.phishing_score >= 60;

  const hints = window._oe_emailHints || []
  const hintsHtml = hints.length
    ? `<div class="oe-context-hints">${hints.map(h => `<div class="oe-context-hint">ℹ️ ${escapeHtml(h)}</div>`).join('')}</div>`
    : ''

  document.getElementById('oe-body').innerHTML = `
    ${hintsHtml}
    <div class="oe-verdict ${verdictClass}">
      <span class="oe-verdict-icon">${verdictIcon}</span>
      <span class="oe-verdict-label">${escapeHtml(result.verdict)}</span>
    </div>
    <div class="oe-scores">
      <div class="oe-score">
        <span class="oe-score-label">Phishing Risk</span>
        <span class="oe-score-val">${escapeHtml(result.phishing_score)}/100</span>
      </div>
      <div class="oe-score">
        <span class="oe-score-label">Spam Score</span>
        <span class="oe-score-val">${escapeHtml(result.spam_score)}/100</span>
      </div>
    </div>
    ${(email.replyTo || email.onBehalfOf || email.viaHeader || email.displayNameMismatch || (email.outlookWarnings && email.outlookWarnings.length > 0)) ? `
    <div class="oe-section oe-header-signals">
      <div class="oe-section-title">📬 Sender Header Signals</div>
      ${email.displayNameMismatch ? `<div class="oe-header-row oe-header-warn">
        <span class="oe-header-icon">⚠️</span>
        <span class="oe-header-label">Display name mismatch</span>
        <span class="oe-header-val">"${escapeHtml(email.displayName || '')}" — email doesn't match</span>
      </div>` : (email.displayName && email.senderEmail ? `<div class="oe-header-row">
        <span class="oe-header-icon">👤</span>
        <span class="oe-header-label">Sender</span>
        <span class="oe-header-val">${escapeHtml(email.displayName)} &lt;${escapeHtml(email.senderEmail)}&gt;</span>
      </div>` : '')}
      ${email.replyTo ? `<div class="oe-header-row ${email.replyTo !== email.senderEmail ? 'oe-header-warn' : ''}">
        <span class="oe-header-icon">${email.replyTo !== email.senderEmail ? '⚠️' : '↩️'}</span>
        <span class="oe-header-label">Reply-To</span>
        <span class="oe-header-val">${escapeHtml(email.replyTo)}${email.replyTo !== email.senderEmail ? ' <em>(differs from sender)</em>' : ''}</span>
      </div>` : ''}
      ${email.onBehalfOf ? `<div class="oe-header-row oe-header-info">
        <span class="oe-header-icon">📨</span>
        <span class="oe-header-label">On behalf of</span>
        <span class="oe-header-val">${escapeHtml(email.onBehalfOf)}</span>
      </div>` : ''}
      ${email.viaHeader ? `<div class="oe-header-row oe-header-info">
        <span class="oe-header-icon">🔀</span>
        <span class="oe-header-label">Sent via</span>
        <span class="oe-header-val">${escapeHtml(email.viaHeader)}</span>
      </div>` : ''}
      ${(email.outlookWarnings && email.outlookWarnings.length > 0) ? email.outlookWarnings.map(w => `
      <div class="oe-header-row oe-header-outlook-warn">
        <span class="oe-header-icon">🔔</span>
        <span class="oe-header-label">Outlook flagged</span>
        <span class="oe-header-val">${escapeHtml(w)}</span>
      </div>`).join('') : ''}
    </div>` : ''}    <div class="oe-section">
      <div class="oe-section-title">Summary</div>
      <p>${escapeHtml(result.summary)}</p>
    </div>
    ${showWarning ? `
    <div class="oe-warning-banner">
      ⚠️ If you did not request this, do not click any links and <strong>report this to your IT security team immediately.</strong>
    </div>` : ''}
    ${findingsHTML ? `
    <div class="oe-section">
      <div class="oe-section-title">🔍 What We Found — tap each to learn more</div>
      ${findingsHTML}
    </div>` : ''}
    ${email.attachments && email.attachments.length > 0 ? `
    <div class="oe-section oe-attachments-section">
      <div class="oe-section-title">📎 Attachments (${email.attachmentCount})</div>
      ${(email.attachments || []).map(name => {
        const isHigh = (email.highRiskFiles || []).includes(name);
        const isSusp = (email.suspiciousFiles || []).includes(name);
        const isDouble = (email.doubleExtFiles || []).includes(name);
        const icon = isHigh ? '🚨' : isSusp ? '⚠️' : '📄';
        const cls = isHigh ? 'oe-attach-high' : isSusp ? 'oe-attach-suspicious' : 'oe-attach-safe';
        const badge = isDouble
          ? '<span class="oe-attach-badge oe-badge-double">DOUBLE EXT</span>'
          : isHigh
            ? '<span class="oe-attach-badge oe-badge-high">HIGH RISK</span>'
            : isSusp
              ? '<span class="oe-attach-badge oe-badge-susp">SUSPICIOUS</span>'
              : '';
        return `<div class="oe-attach-row ${cls}">${icon} <span class="oe-attach-name">${escapeHtml(name)}</span>${badge}</div>`;
      }).join('')}
    </div>` : ''}
    ${email.links && email.links.length > 0 ? `    <div class="oe-section">
      <div class="oe-section-title">🔗 Links in this email (${email.links.length})</div>
      ${email.links.map(l => {
          const hit = (result.lookalikeDomains || []).find(h => {
            try { return new URL('https://' + h.domain).hostname.toLowerCase() === (l.href || '').toLowerCase().replace(/^www\\./, '') } catch { return false }
          });
          return buildLinkRowHtml(l, hit || null);
        }).join('')}
    </div>` : ''}
    ${result.lesson ? `
    <div class="oe-lesson">
      <div class="oe-lesson-title">📚 Remember for next time</div>
      <div class="oe-lesson-text">${escapeHtml(result.lesson)}</div>
    </div>` : ''}

    <div class="oe-section">
      <div class="oe-section-title">✅ Suggested Action</div>
      <p>${escapeHtml(result.suggested_action)}</p>
    </div>


    ${(result.itSecurityEmail && (result.verdict === 'PHISHING' || result.verdict === 'SUSPICIOUS')) ? `
    <div class="oe-report-it-section">
      <div class="oe-report-it-title">🚨 Report this email</div>
      <p class="oe-report-it-hint">Forward a pre-filled report to your IT security team.</p>
      <button type="button" class="oe-report-it-btn" id="oe-report-it-btn">
        📨 Report to IT Security
      </button>
    </div>` : ''}    <div class="oe-feedback-section" id="oe-feedback-section">
      <div class="oe-feedback-title">Was this analysis accurate?</div>
      <div class="oe-feedback-buttons">
        <button class="oe-feedback-btn oe-fb-false-positive" id="oe-fb-fp">
          👎 False Positive
        </button>
        <button class="oe-feedback-btn oe-fb-missed-threat" id="oe-fb-mt">
          🚨 Missed Threat
        </button>
      </div>
    </div>
  `;

  window._oe_lastResult = result;

  const fpBtn = document.getElementById('oe-fb-fp');
  const mtBtn = document.getElementById('oe-fb-mt');

  fpBtn.addEventListener('click', () => showFeedbackForm('false_positive', result, email));
  mtBtn.addEventListener('click', () => showFeedbackForm('missed_threat', result, email));﻿
  // Report to IT button
  const reportItBtn = document.getElementById('oe-report-it-btn');
  if (reportItBtn && result.itSecurityEmail) {
    reportItBtn.addEventListener('click', () => {
      const to      = encodeURIComponent(result.itSecurityEmail);
      const subject = encodeURIComponent('[Security Report] Suspected ' + result.verdict + ': ' + (email.subject || '(no subject)').slice(0, 80));
      const bodyLines = [
        'I am forwarding a suspicious email for your review.',
        '',
        '--- ANALYSIS SUMMARY ---',
        'Verdict: ' + result.verdict,
        'Phishing Risk: ' + result.phishing_score + '/100',
        'Spam Score: '    + result.spam_score    + '/100',
        '',
        '--- EMAIL DETAILS ---',
        'Subject:   ' + (email.subject   || '(none)'),
        'From:      ' + (email.sender    || '(unknown)'),
        'Recipient: ' + (email.recipient || '(unknown)'),
        '',
        '--- AI SUMMARY ---',
        result.summary || '',
        '',
        '--- SUGGESTED ACTION ---',
        result.suggested_action || '',
        '',
        '--- FINDINGS ---',
        ...(result.findings || []).map((f, i) => (i + 1) + '. ' + f.flag + ': ' + f.explanation),
        '',
        '--- LINKS IN EMAIL ---',
        ...(email.links || []).map(l => '* ' + l.display + ' -> ' + (l.fullUrl || l.href || '')),
        '',
        'Reported via Outlook Email Evaluator.',
      ];
      const body = encodeURIComponent(bodyLines.join('\n'));
      window.open('mailto:' + to + '?subject=' + subject + '&body=' + body, '_blank');
      reportItBtn.textContent = '\u2705 Report opened in mail client';
      reportItBtn.disabled = true;
      setTimeout(() => {
        reportItBtn.textContent = '\uD83D\uDCE8 Report to IT Security';
        reportItBtn.disabled = false;
      }, 4000);
    });
  }

  const btn = document.getElementById('oe-analyze-btn');
  btn.style.display = 'block';
  btn.textContent = 'Analyze Another';
  btn.disabled = false;
  document.getElementById('oe-wake-btn').style.display = 'block';
  const wakeHintRes = document.getElementById('oe-wake-hint');
  if (wakeHintRes) wakeHintRes.style.display = 'block';
}

function showFeedbackForm(feedbackType, result, email) {
  const section = document.getElementById('oe-feedback-section');
  const label = feedbackType === 'false_positive'
    ? 'This email was flagged but is actually safe'
    : 'This email is spam or phishing but was not caught';

  section.innerHTML = `
    <div class="oe-feedback-title">${label}</div>
    <textarea id="oe-fb-comment" class="oe-feedback-comment"
      placeholder="Optional: tell us more about why this was incorrect..."
      maxlength="500" rows="3"></textarea>
    <div class="oe-feedback-actions">
      <button class="oe-feedback-btn oe-fb-submit" id="oe-fb-submit">Send Report</button>
      <button class="oe-feedback-btn oe-fb-cancel" id="oe-fb-cancel">Cancel</button>
    </div>
  `;

  document.getElementById('oe-fb-submit').addEventListener('click', () => {
    const comment = (document.getElementById('oe-fb-comment').value || '').trim();
    submitFeedback(feedbackType, result, email, comment);
  });

  document.getElementById('oe-fb-cancel').addEventListener('click', () => {
    resetFeedbackSection();
  });
}

function submitFeedback(feedbackType, result, email, comment) {
  const section = document.getElementById('oe-feedback-section');
  section.innerHTML = `
    <div class="oe-feedback-title" style="text-align:center;">
      <div class="oe-spinner" style="margin:0 auto 6px;"></div>
      Sending report...
    </div>
  `;

  try {
    chrome.runtime.sendMessage({
      type: 'SUBMIT_FEEDBACK',
      payload: {
        feedbackType,
        originalVerdict: result.verdict,
        originalPhishingScore: result.phishing_score,
        originalSpamScore: result.spam_score,
        emailSubject: (email.subject || '').slice(0, 200),
        emailSender: (email.sender || '').slice(0, 200),
        emailRecipient: (email.recipient || '').slice(0, 200),
        userComment: comment
      }
    });
  } catch(e) {
    section.innerHTML = `<div class="oe-feedback-title oe-feedback-error">Failed to send. Please try again.</div>`;
  }
}

function resetFeedbackSection() {
  const section = document.getElementById('oe-feedback-section');
  if (!section) return;
  section.innerHTML = `
    <div class="oe-feedback-title">Was this analysis accurate?</div>
    <div class="oe-feedback-buttons">
      <button class="oe-feedback-btn oe-fb-false-positive" id="oe-fb-fp">
        👎 False Positive
      </button>
      <button class="oe-feedback-btn oe-fb-missed-threat" id="oe-fb-mt">
        🚨 Missed Threat
      </button>
    </div>
  `;
  const result = window._oe_lastResult || {};
  const email = window._oe_email || {};
  document.getElementById('oe-fb-fp').addEventListener('click', () => showFeedbackForm('false_positive', result, email));
  document.getElementById('oe-fb-mt').addEventListener('click', () => showFeedbackForm('missed_threat', result, email));
}

function showEmailReady(subject) {
  const subj = String(subject || '');
  const short = subj.length > 60 ? subj.slice(0, 60) + '...' : subj;
  document.getElementById('oe-body').innerHTML = `
    <div class="oe-email-ready">
      <p>📨 <strong>${escapeHtml(short)}</strong></p>
      <p>Click Analyze to check this email for threats.</p>
    </div>`;
  document.getElementById('oe-analyze-btn').style.display = 'block';
  document.getElementById('oe-analyze-btn').textContent = 'Analyze Email';
  document.getElementById('oe-wake-btn').style.display = 'block';
  const wakeHintReady = document.getElementById('oe-wake-hint');
  if (wakeHintReady) wakeHintReady.style.display = 'block';
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
          warn.innerHTML = '⚠️ HIGH RISK ATTACHMENT: ' + escapeHtml(highRisk.join(', ')) + '<br>Do NOT open. Report to IT security immediately.';
          bodyEl.insertBefore(warn, bodyEl.firstChild);
        } else if (suspicious.length > 0) {
          const warn = document.createElement('div');
          warn.id = 'oe-attach-warning';
          warn.style.cssText = 'background:#b45309;color:white;padding:10px 12px;border-radius:6px;margin-bottom:8px;font-size:12px;font-weight:bold;line-height:1.5;';
          warn.innerHTML = '⚠️ SUSPICIOUS ATTACHMENT: ' + escapeHtml(suspicious.join(', ')) + '<br>Verify with sender before opening.';
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
    if (message.error) {
      const err = String(message.error)
      const combined = err.startsWith('Analysis failed:') ? err : ('Analysis failed: ' + err)
      showError(combined)
      return
    }
    if (!message.result) { showError('No result received. Please try again.'); return; }
    showResult(message.result, window._oe_email || {});
  }

  if (message.type === 'FEEDBACK_RESULT') {
    const section = document.getElementById('oe-feedback-section');
    if (!section) return;
    if (message.success) {
      section.innerHTML = `
        <div class="oe-feedback-success-block">
          <div class="oe-feedback-title oe-feedback-success">✅ Report received</div>
          <p class="oe-feedback-subtle">Thanks — your feedback helps improve detection for everyone.</p>
          <button type="button" class="oe-feedback-btn oe-fb-thanks" id="oe-fb-thanks">Thanks</button>
        </div>`;
      const thanksBtn = document.getElementById('oe-fb-thanks');
      if (thanksBtn) {
        thanksBtn.addEventListener('click', () => {
          section.innerHTML = `<div class="oe-feedback-dismissed" role="status">Got it — thanks for helping us improve.</div>`;
        });
      }
    } else {
      section.innerHTML = `
        <div class="oe-feedback-title oe-feedback-error">⚠️ ${escapeHtml(message.error || 'Failed to send report.')}</div>
        <div class="oe-feedback-actions">
          <button class="oe-feedback-btn oe-fb-cancel" id="oe-fb-retry">Try Again</button>
        </div>
      `;
      document.getElementById('oe-fb-retry').addEventListener('click', () => resetFeedbackSection());
    }
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  setTimeout(init, 1500);
}
