chrome.runtime.onInstalled.addListener(() => {
  console.log('Outlook Email Evaluator installed.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_EMAIL') {
    chrome.storage.local.get(['proxyUrl', 'extensionToken', 'customPrompt'], async (result) => {
      const proxyUrl     = (result.proxyUrl || '').trim()
      const extToken     = (result.extensionToken || '').trim()
      const customPrompt = result.customPrompt || ''

      if (!proxyUrl) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'ANALYSIS_DONE',
          error: 'No proxy URL set. Click the extension icon and add your Supabase proxy URL.'
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
          body: JSON.stringify({ emailData: message.emailData, customPrompt })
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
})

// Keep service worker alive
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PING') return true
})
