/**
 * Unit tests for pure functions in content.js
 * These functions are extracted and tested in isolation (no DOM/Chrome APIs needed)
 */

// ─── Extract pure functions from content.js for testing ──────────────────────

const GIFT_CARD_KEYWORDS = [
  'gift card', 'gift cards', 'itunes card', 'google play card', 'amazon gift card',
  'steam card', 'ebay gift card', 'visa gift card', 'buy gift cards', 'purchase gift cards',
  'get gift cards', 'send gift cards', 'gift card number', 'gift card code',
  'scratch the card', 'scratch card', 'card balance', 'redeem the card',
  'send me the codes', 'send the codes', 'send the numbers'
]

function checkForGiftCardFraud(email) {
  const combined = ((email.subject || '') + ' ' + (email.body || '')).toLowerCase()
  return GIFT_CARD_KEYWORDS.some(kw => combined.includes(kw))
}

function escapeHtml(s) {
  if (s == null || s === '') return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeHttpUrl(raw) {
  if (raw == null || raw === '') return null
  const trimmed = String(raw).trim().slice(0, 2048)
  try {
    const u = new URL(trimmed)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href
  } catch {
    return null
  }
  return null
}

function decodeWrappedUrl(href) {
  if (!href) return href
  try {
    if (href.includes('safelinks.protection.outlook.com')) {
      const u = new URL(href)
      const decoded = u.searchParams.get('url')
      if (decoded) return decodeURIComponent(decoded)
    }
    if (href.includes('trendmicro') || href.includes('imsva') || href.includes('tmase')) {
      const u = new URL(href)
      const decoded = u.searchParams.get('url') || u.searchParams.get('u') || u.searchParams.get('__u')
      if (decoded) return decodeURIComponent(decoded)
      const b64 = u.searchParams.get('redirectUrl') || u.searchParams.get('r')
      if (b64) { try { return atob(b64) } catch(e) {} }
    }
    if (href.includes('urldefense') && href.includes('/v2/')) {
      const u = new URL(href)
      let raw = u.searchParams.get('u')
      if (raw) {
        raw = raw.replace(/-/g, '%').replace(/_/g, '/')
        return decodeURIComponent(raw)
      }
    }
    if (href.includes('urldefense') && href.includes('/v3/')) {
      const match = href.match(/\/v3\/__([^_]+)__/)
      if (match) return decodeURIComponent(match[1])
    }
    if (href.includes('mimecast.com')) {
      const u = new URL(href)
      const decoded = u.searchParams.get('url') || u.searchParams.get('u')
      if (decoded) return decodeURIComponent(decoded)
    }
    if (href.includes('?')) {
      const u = new URL(href)
      const decoded = u.searchParams.get('url') || u.searchParams.get('u')
      if (decoded && (decoded.startsWith('http') || decoded.startsWith('%68%74'))) {
        return decodeURIComponent(decoded)
      }
    }
  } catch(e) {}
  return href
}

// ─── checkForGiftCardFraud ────────────────────────────────────────────────────

describe('checkForGiftCardFraud', () => {

  // --- Should detect fraud ---
  test('detects "gift card" in body', () => {
    expect(checkForGiftCardFraud({ subject: 'Hello', body: 'Please buy a gift card for me' })).toBe(true)
  })

  test('detects "gift cards" in subject', () => {
    expect(checkForGiftCardFraud({ subject: 'Need gift cards urgently', body: '' })).toBe(true)
  })

  test('detects "itunes card"', () => {
    expect(checkForGiftCardFraud({ subject: '', body: 'Buy an itunes card and send me the code' })).toBe(true)
  })

  test('detects "google play card"', () => {
    expect(checkForGiftCardFraud({ subject: '', body: 'Get me a google play card' })).toBe(true)
  })

  test('detects "amazon gift card"', () => {
    expect(checkForGiftCardFraud({ subject: 'amazon gift card needed', body: '' })).toBe(true)
  })

  test('detects "send me the codes"', () => {
    expect(checkForGiftCardFraud({ subject: '', body: 'Please send me the codes ASAP' })).toBe(true)
  })

  test('detects "send the numbers"', () => {
    expect(checkForGiftCardFraud({ subject: '', body: 'send the numbers to this email' })).toBe(true)
  })

  test('detects "scratch the card"', () => {
    expect(checkForGiftCardFraud({ subject: '', body: 'scratch the card and send me the pin' })).toBe(true)
  })

  test('detects "redeem the card"', () => {
    expect(checkForGiftCardFraud({ subject: '', body: 'Please redeem the card for me' })).toBe(true)
  })

  test('is case-insensitive', () => {
    expect(checkForGiftCardFraud({ subject: 'GIFT CARD REQUEST', body: '' })).toBe(true)
  })

  test('detects keyword split across subject and body', () => {
    expect(checkForGiftCardFraud({ subject: 'Urgent request', body: 'buy gift cards now' })).toBe(true)
  })

  // --- Should NOT detect fraud ---
  test('does not flag a normal business email', () => {
    expect(checkForGiftCardFraud({ subject: 'Q3 report', body: 'Please review the attached quarterly report.' })).toBe(false)
  })

  test('does not flag empty email', () => {
    expect(checkForGiftCardFraud({ subject: '', body: '' })).toBe(false)
  })

  test('does not flag null subject/body', () => {
    expect(checkForGiftCardFraud({ subject: null, body: null })).toBe(false)
  })

  test('does not flag undefined subject/body', () => {
    expect(checkForGiftCardFraud({})).toBe(false)
  })

  test('does not flag email mentioning cards in a non-fraud context', () => {
    expect(checkForGiftCardFraud({ subject: 'Birthday party planning', body: 'We are collecting money for a birthday card for Sarah.' })).toBe(false)
  })
})

// ─── escapeHtml ───────────────────────────────────────────────────────────────

describe('escapeHtml', () => {

  test('escapes < and >', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
  })

  test('escapes &', () => {
    expect(escapeHtml('fish & chips')).toBe('fish &amp; chips')
  })

  test('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;')
  })

  test('escapes single quotes', () => {
    expect(escapeHtml("it's fine")).toBe('it&#39;s fine')
  })

  test('escapes a full XSS payload', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  test('returns empty string for null', () => {
    expect(escapeHtml(null)).toBe('')
  })

  test('returns empty string for undefined', () => {
    expect(escapeHtml(undefined)).toBe('')
  })

  test('returns empty string for empty string', () => {
    expect(escapeHtml('')).toBe('')
  })

  test('does not modify safe text', () => {
    expect(escapeHtml('Hello world')).toBe('Hello world')
  })

  test('converts numbers to string', () => {
    expect(escapeHtml(42)).toBe('42')
  })
})

// ─── safeHttpUrl ──────────────────────────────────────────────────────────────

describe('safeHttpUrl', () => {

  // --- Valid URLs ---
  test('accepts https URL', () => {
    expect(safeHttpUrl('https://example.com')).toBe('https://example.com/')
  })

  test('accepts http URL', () => {
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/')
  })

  test('accepts URL with path', () => {
    expect(safeHttpUrl('https://example.com/path/to/page')).toBe('https://example.com/path/to/page')
  })

  test('accepts URL with query string', () => {
    expect(safeHttpUrl('https://example.com?foo=bar')).toBe('https://example.com/?foo=bar')
  })

  // --- Dangerous protocols ---
  test('rejects javascript: URL', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
  })

  test('rejects data: URL', () => {
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  test('rejects ftp: URL', () => {
    expect(safeHttpUrl('ftp://files.example.com/file.txt')).toBeNull()
  })

  test('rejects vbscript: URL', () => {
    expect(safeHttpUrl('vbscript:msgbox(1)')).toBeNull()
  })

  // --- Empty / null ---
  test('returns null for empty string', () => {
    expect(safeHttpUrl('')).toBeNull()
  })

  test('returns null for null', () => {
    expect(safeHttpUrl(null)).toBeNull()
  })

  test('returns null for undefined', () => {
    expect(safeHttpUrl(undefined)).toBeNull()
  })

  test('returns null for invalid URL string', () => {
    expect(safeHttpUrl('not a url')).toBeNull()
  })
})

// ─── decodeWrappedUrl ─────────────────────────────────────────────────────────

describe('decodeWrappedUrl', () => {

  test('decodes Microsoft SafeLinks URL', () => {
    const safelink = 'https://nam.safelinks.protection.outlook.com/?url=https%3A%2F%2Fevil.com%2Fphish&data=abc'
    expect(decodeWrappedUrl(safelink)).toBe('https://evil.com/phish')
  })

  test('decodes Proofpoint URLDefense v2', () => {
    // v2 encodes https://example.com as: - replaces %, _ replaces /
    // https://example.com -> %68%74%74%70%73%3A%2F%2Fexample.com
    // then - for %, _ for /
    const encoded = 'https%3A%2F%2Fexample.com'.replace(/%/g, '-').replace(/\//g, '_')
    const url = `https://urldefense.proofpoint.com/v2/url?u=${encoded}&d=abc`
    const result = decodeWrappedUrl(url)
    expect(result).toContain('example.com')
  })

  test('decodes Proofpoint URLDefense v3', () => {
    const url = 'https://urldefense.com/v3/__https://example.com__'
    expect(decodeWrappedUrl(url)).toBe('https://example.com')
  })

  test('decodes Mimecast URL', () => {
    const url = 'https://protect2.mimecast.com/s/abc?domain=x&url=https%3A%2F%2Fexample.com'
    expect(decodeWrappedUrl(url)).toBe('https://example.com')
  })

  test('returns original URL when not a wrapper', () => {
    expect(decodeWrappedUrl('https://example.com/normal-link')).toBe('https://example.com/normal-link')
  })

  test('returns null/undefined as-is', () => {
    expect(decodeWrappedUrl(null)).toBeNull()
    expect(decodeWrappedUrl(undefined)).toBeUndefined()
  })

  test('returns empty string as-is', () => {
    expect(decodeWrappedUrl('')).toBe('')
  })

  test('handles generic ?url= wrapper', () => {
    const url = 'https://tracker.example.com/click?url=https%3A%2F%2Fdestination.com'
    expect(decodeWrappedUrl(url)).toBe('https://destination.com')
  })

  test('does not decode a non-http ?url= param', () => {
    const url = 'https://example.com/page?url=javascript%3Aalert(1)'
    // should return original since decoded value doesn't start with http
    expect(decodeWrappedUrl(url)).toBe(url)
  })
})
