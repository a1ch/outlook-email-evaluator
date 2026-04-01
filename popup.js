// ── Tabs ───────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
    tab.classList.add('active')
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active')
  })
})

// ── Load saved values ──────────────────────────────────────────────────────────
const DEFAULT_PROXY_URL = 'https://pikplhvawbhndijpkdbq.supabase.co/functions/v1/analyze-email'
chrome.storage.local.get(['proxyUrl', 'extensionToken', 'tenantDomain', 'customPrompt'], (data) => {
  document.getElementById('proxyUrl').value       = data.proxyUrl || DEFAULT_PROXY_URL
  if (data.extensionToken) document.getElementById('extensionToken').value = data.extensionToken
  if (data.tenantDomain)   document.getElementById('tenantDomain').value   = data.tenantDomain
  if (data.customPrompt)   document.getElementById('customPrompt').value   = data.customPrompt
})

// ── Show/hide token ────────────────────────────────────────────────────────────
document.getElementById('toggleToken').addEventListener('click', () => {
  const input = document.getElementById('extensionToken')
  const btn   = document.getElementById('toggleToken')
  input.type  = input.type === 'password' ? 'text' : 'password'
  btn.textContent = input.type === 'password' ? 'Show token' : 'Hide token'
})

// ── Save & Test Connection ─────────────────────────────────────────────────────
document.getElementById('saveConnection').addEventListener('click', async () => {
  const proxyUrl  = document.getElementById('proxyUrl').value.trim()
  const extToken  = document.getElementById('extensionToken').value.trim()
  const status    = document.getElementById('connectionStatus')

  if (!proxyUrl)  return showStatus(status, 'Please enter the proxy URL.', false)
  if (!extToken)  return showStatus(status, 'Please enter the extension token.', false)

  if (!proxyUrl.startsWith('https://')) {
    return showStatus(status, 'Proxy URL must start with https://', false)
  }

  if (!isAllowedSupabaseFunctionUrl(proxyUrl, 'analyze-email')) {
    return showStatus(status, 'Proxy URL must be your Supabase function URL, e.g. https://YOUR_PROJECT.supabase.co/functions/v1/analyze-email', false)
  }

  showStatus(status, '⏳ Testing connection...', true)

  // Save first, then test
  chrome.storage.local.set({ proxyUrl, extensionToken: extToken }, async () => {
    try {
      const res = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-extension-token': extToken,
        },
        body: JSON.stringify({ ping: true, token: extToken })
      })

      if (res.status === 401) {
        return showStatus(status, '❌ Token rejected — check your extension token.', false)
      }
      if (res.status === 429) {
        return showStatus(status, '✅ Connected! (Rate limited — wait 5s and try again)', true)
      }

      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok === true) {
        return showStatus(status, '✅ Connected successfully!', true)
      }
      return showStatus(status, `⚠️ Unexpected response: ${res.status}`, false)

    } catch (err) {
      showStatus(status, `❌ Could not reach proxy: ${err.message}`, false)
    }
  })
})

// ── Save Settings ──────────────────────────────────────────────────────────────
document.getElementById('saveSettings').addEventListener('click', () => {
  const tenantDomain = document.getElementById('tenantDomain').value.trim()
  const customPrompt = document.getElementById('customPrompt').value.trim()
  const status       = document.getElementById('settingsStatus')

  chrome.storage.local.set({ tenantDomain, customPrompt }, () => {
    showStatus(status, '✅ Settings saved!', true)
  })
})

// ── Wake Up Extension ──────────────────────────────────────────────────────────
document.getElementById('wakeUpBtn').addEventListener('click', async () => {
  const btn      = document.getElementById('wakeUpBtn')
  const icon     = document.getElementById('wakeIcon')
  const text     = document.getElementById('wakeText')
  const status   = document.getElementById('wakeStatus')

  btn.classList.add('waking')
  btn.disabled = true
  icon.textContent = '⏳'
  text.textContent = 'Waking up...'
  status.className = 'status-msg'

  try {
    // 1. Ping the service worker to wake it up (sending any message forces it to start)
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'PING' }, () => {
        // Ignore chrome.runtime.lastError — the worker may have been dead, that's fine
        void chrome.runtime.lastError
        resolve()
      })
    })

    // 2. Re-inject the content script into all matching Outlook tabs
    const outlookPattern = '*://outlook.cloud.microsoft/*'
    const tabs = await chrome.tabs.query({ url: outlookPattern })

    let injected = 0
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        })
        injected++
      } catch {
        // Tab may be restricted or already has the script — skip silently
      }
    }

    // 3. Show result
    btn.classList.remove('waking')
    btn.classList.add('awake')
    icon.textContent = '✅'

    if (injected > 0) {
      text.textContent = 'Extension awake!'
      showStatus(status, `✅ Restarted on ${injected} Outlook tab${injected > 1 ? 's' : ''}. Refresh your email view.`, true)
    } else if (tabs.length === 0) {
      text.textContent = 'Extension awake!'
      showStatus(status, '✅ Service worker restarted. Open Outlook in Chrome to use the analyzer.', true)
    } else {
      text.textContent = 'Extension awake!'
      showStatus(status, '✅ Service worker restarted. Try refreshing your Outlook tab (Ctrl+Shift+R).', true)
    }

  } catch (err) {
    btn.classList.remove('waking')
    icon.textContent = '☀️'
    text.textContent = 'Wake Up Extension'
    btn.disabled = false
    showStatus(status, `❌ Wake up failed: ${err.message}`, false)
    return
  }

  // Reset button after 4 seconds
  setTimeout(() => {
    btn.classList.remove('awake')
    btn.disabled = false
    icon.textContent = '☀️'
    text.textContent = 'Wake Up Extension'
  }, 4000)
})

// ── Helper ─────────────────────────────────────────────────────────────────────
function showStatus(el, msg, success) {
  el.textContent  = msg
  el.className    = 'status-msg ' + (success ? 'success' : 'error')
  if (success && !msg.includes('⏳')) {
    setTimeout(() => { el.style.display = 'none' }, 5000)
  }
}
