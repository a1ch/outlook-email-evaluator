chrome.runtime.onInstalled.addListener(() => {
  console.log('Outlook Email Evaluator installed.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANALYZE_EMAIL') {
    chrome.storage.local.get(['apiKey', 'tenantDomain', 'customPrompt'], async (result) => {
      const apiKey = result.apiKey;
      const tenantDomain = result.tenantDomain || '';
      const customPrompt = result.customPrompt || '';
      const customPromptLine = customPrompt ? '- Additional instructions: ' + customPrompt : '';
      let prompt = message.prompt
        .replaceAll('__TENANT_DOMAIN__', tenantDomain || 'unknown')
        .replace('__CUSTOM_PROMPT__', customPromptLine);

      if (!apiKey) {
        chrome.tabs.sendMessage(sender.tab.id, { type: 'ANALYSIS_DONE', error: 'No API key set. Click the extension icon to add your key.' });
        return;
      }

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            messages: [{ role: 'user', content: prompt }]
          })
        });

        if (!response.ok) {
          const err = await response.json();
          chrome.tabs.sendMessage(sender.tab.id, { type: 'ANALYSIS_DONE', error: 'API ' + response.status + ': ' + (err.error?.message || JSON.stringify(err)) });
          return;
        }

        const data = await response.json();
        const text = data.content[0].text.trim();
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        chrome.tabs.sendMessage(sender.tab.id, { type: 'ANALYSIS_DONE', result: parsed });
      } catch (err) {
        chrome.tabs.sendMessage(sender.tab.id, { type: 'ANALYSIS_DONE', error: 'Fetch failed: ' + err.message });
      }
    });
    return true;
  }
});

// Keep service worker alive to prevent "Extension context invalidated" errors
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PING') return true;
});
