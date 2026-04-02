importScripts('proxy-utils.js')

chrome.runtime.onInstalled.addListener(() => {
  console.log('Outlook Email Evaluator installed.')
})

// Content script messages include sender.tab; other callers may not — guard before sendMessage.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Wake service worker; respond so sendMessage Promise resolves (content scripts cannot use chrome.tabs/scripting).
  if (message.type === 'PING' || message.type === 'WAKE_EXTENSION') {
    sendResponse({ ok: true })
    return false
  }

  if (message.type === 'ANALYZE_EMAIL') {
    if (!sender.tab?.id) return false
    chrome.storage.local.get(['proxyUrl', 'extensionToken', 'customPrompt', 'tenantDomain', 'itSecurityEmail'], async (result) => {
      const proxyUrl = (result.proxyUrl || '').trim()
      const extToken = (result.extensionToken || '').trim()
      const customPrompt = result.customPrompt || ''
      const tenantDomain = (result.tenantDomain || '').trim()

      if (!proxyUrl) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'ANALYSIS_DONE',
          error: 'No proxy URL set. Click the extension icon and add your Supabase proxy URL.'
        })
        return
      }
      if (!isAllowedSupabaseFunctionUrl(proxyUrl, 'analyze-email')) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'ANALYSIS_DONE',
          error: 'Invalid proxy URL. Use your Supabase HTTPS URL ending in /functions/v1/analyze-email'
        })
        return
      }
      if (!extToken) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'ANALYSIS_DONE',
          error: 'No extension token set. Click the extension icon and add your token.'
        })
        return
      }

      try {
        const response = await fetch(proxyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-extension-token': extToken,
          },
          body: JSON.stringify({ emailData: message.emailData, customPrompt, tenantDomain, oeAuth: extToken })
        })

        if (response.status === 429) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'ANALYSIS_DONE',
            error: 'Please wait 5 seconds before analyzing another email.'
          })
          return
        }

        if (!response.ok) {
          const err = await response.json().catch(() => ({}))
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'ANALYSIS_DONE',
            error: `Proxy error ${response.status}: ${err.error || response.statusText}`
          })
          return
        }

        const data = await response.json()
        // Server-side itSecurityEmail takes priority; fall back to local setting
        const itEmail = data.result?.itSecurityEmail || (result.itSecurityEmail || '').trim() || null
        if (data.result && itEmail) data.result.itSecurityEmail = itEmail
        chrome.tabs.sendMessage(sender.tab.id, { type: 'ANALYSIS_DONE', result: data.result })

      } catch (err) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'ANALYSIS_DONE',
          error: 'Request failed: ' + err.message
        })
      }
    })
    return true
  }

  if (message.type === 'SUBMIT_FEEDBACK') {
    if (!sender.tab?.id) return false
    chrome.storage.local.get(['proxyUrl', 'extensionToken'], async (result) => {
      const proxyUrl = (result.proxyUrl || '').trim()
      const extToken = (result.extensionToken || '').trim()

      if (!proxyUrl || !extToken) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'FEEDBACK_RESULT', success: false, error: 'Extension not configured.'
        })
        return
      }

      if (!isAllowedSupabaseFunctionUrl(proxyUrl, 'analyze-email')) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'FEEDBACK_RESULT', success: false,
          error: 'Invalid proxy URL in settings.'
        })
        return
      }

      const feedbackUrl = proxyUrl.replace(/\/analyze-email\/?$/, '/report-feedback')

      if (!isAllowedSupabaseFunctionUrl(feedbackUrl, 'report-feedback')) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'FEEDBACK_RESULT', success: false,
          error: 'Could not derive feedback URL from proxy. Check your Supabase function URL.'
        })
        return
      }

      try {
        const response = await fetch(feedbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-extension-token': extToken,
          },
            body: JSON.stringify({ ...message.payload, oeAuth: extToken })
        })

        if (!response.ok) {
          const err = await response.json().catch(() => ({}))
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'FEEDBACK_RESULT', success: false,
            error: err.error || `Error ${response.status}`
          })
          return
        }

        chrome.tabs.sendMessage(sender.tab.id, { type: 'FEEDBACK_RESULT', success: true })

      } catch (err) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'FEEDBACK_RESULT', success: false, error: err.message
        })
      }
    })
    return true
  }
})
