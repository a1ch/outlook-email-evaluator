const { isAllowedSupabaseFunctionUrl } = require('./proxy-utils')

describe('isAllowedSupabaseFunctionUrl', () => {

  // --- Valid cases ---
  test('accepts valid analyze-email URL', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://abc123.supabase.co/functions/v1/analyze-email', 'analyze-email'
    )).toBe(true)
  })

  test('accepts valid report-feedback URL', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://abc123.supabase.co/functions/v1/report-feedback', 'report-feedback'
    )).toBe(true)
  })

  test('accepts URL with trailing slash', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://abc123.supabase.co/functions/v1/analyze-email/', 'analyze-email'
    )).toBe(true)
  })

  test('accepts URL with leading/trailing whitespace', () => {
    expect(isAllowedSupabaseFunctionUrl(
      '  https://abc123.supabase.co/functions/v1/analyze-email  ', 'analyze-email'
    )).toBe(true)
  })

  // --- Protocol ---
  test('rejects http (non-https) URL', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'http://abc123.supabase.co/functions/v1/analyze-email', 'analyze-email'
    )).toBe(false)
  })

  test('rejects ftp protocol', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'ftp://abc123.supabase.co/functions/v1/analyze-email', 'analyze-email'
    )).toBe(false)
  })

  // --- Domain ---
  test('rejects non-supabase domain', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://evil.com/functions/v1/analyze-email', 'analyze-email'
    )).toBe(false)
  })

  test('rejects domain that only ends with supabase.co but is not a subdomain', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://notsupabase.co/functions/v1/analyze-email', 'analyze-email'
    )).toBe(false)
  })

  test('rejects domain that contains supabase.co but is not a subdomain', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://evil-supabase.co/functions/v1/analyze-email', 'analyze-email'
    )).toBe(false)
  })

  // --- Credentials ---
  test('rejects URL with username and password', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://user:pass@abc123.supabase.co/functions/v1/analyze-email', 'analyze-email'
    )).toBe(false)
  })

  test('rejects URL with username only', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://user@abc123.supabase.co/functions/v1/analyze-email', 'analyze-email'
    )).toBe(false)
  })

  // --- Path ---
  test('rejects URL missing /functions/v1/', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://abc123.supabase.co/analyze-email', 'analyze-email'
    )).toBe(false)
  })

  test('rejects URL with /functions/ but missing /v1/', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://abc123.supabase.co/functions/analyze-email', 'analyze-email'
    )).toBe(false)
  })

  test('rejects path with extra segments before function name', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://abc123.supabase.co/functions/v1/preview/analyze-email', 'analyze-email'
    )).toBe(false)
  })

  test('rejects path where slug is only a substring (suffix)', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://abc123.supabase.co/functions/v1/analyze-email-backup', 'analyze-email'
    )).toBe(false)
  })

  test('rejects unknown function slug argument', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://abc123.supabase.co/functions/v1/analyze-email', 'other-fn'
    )).toBe(false)
  })

  // --- Function slug mismatch ---
  test('rejects wrong function slug', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://abc123.supabase.co/functions/v1/analyze-email', 'report-feedback'
    )).toBe(false)
  })

  // --- Empty / null / invalid inputs ---
  test('rejects empty string URL', () => {
    expect(isAllowedSupabaseFunctionUrl('', 'analyze-email')).toBe(false)
  })

  test('rejects null URL', () => {
    expect(isAllowedSupabaseFunctionUrl(null, 'analyze-email')).toBe(false)
  })

  test('rejects undefined URL', () => {
    expect(isAllowedSupabaseFunctionUrl(undefined, 'analyze-email')).toBe(false)
  })

  test('rejects empty function slug', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://abc123.supabase.co/functions/v1/analyze-email', ''
    )).toBe(false)
  })

  test('rejects null function slug', () => {
    expect(isAllowedSupabaseFunctionUrl(
      'https://abc123.supabase.co/functions/v1/analyze-email', null
    )).toBe(false)
  })

  test('rejects completely invalid string', () => {
    expect(isAllowedSupabaseFunctionUrl('not-a-url', 'analyze-email')).toBe(false)
  })
})
