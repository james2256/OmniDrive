export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  return null;
}

export function validateEmail(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Invalid email format';
  return null;
}

export function validateWebhookUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Invalid webhook URL';
  }

  if (parsed.protocol !== 'https:') return 'Webhook URL must use HTTPS';

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1') {
    return 'Webhook URL must not point to private/internal addresses';
  }

  // Block cloud metadata
  if (hostname === '169.254.169.254' || hostname === 'fd00:ec2::254') {
    return 'Webhook URL must not point to private/internal addresses';
  }

  // Block private/reserved IP ranges
  const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipMatch) {
    const [, a, b] = ipMatch.map(Number);
    // 0.0.0.0/8
    if (a === 0) return 'Webhook URL must not point to private/internal addresses';
    // 10.0.0.0/8
    if (a === 10) return 'Webhook URL must not point to private/internal addresses';
    // 100.64.0.0/10 (CGNAT)
    if (a === 100 && b >= 64 && b <= 127) return 'Webhook URL must not point to private/internal addresses';
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return 'Webhook URL must not point to private/internal addresses';
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return 'Webhook URL must not point to private/internal addresses';
    // 192.168.0.0/16
    if (a === 192 && b === 168) return 'Webhook URL must not point to private/internal addresses';
    // 198.18.0.0/15 (benchmark)
    if (a === 198 && b >= 18 && b <= 19) return 'Webhook URL must not point to private/internal addresses';
  }

  // Block IPv6 private ranges (ULA fc00::/7, link-local fe80::/10)
  if (hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe8') || hostname.startsWith('fe9') || hostname.startsWith('fea') || hostname.startsWith('feb')) {
    return 'Webhook URL must not point to private/internal addresses';
  }

  return null;
}

// ponytail: DNS-over-HTTPS resolution check via Cloudflare DNS.
// Workers runtime doesn't expose socket-level DNS, so we use DoH to resolve
// and reject hostnames that resolve to private/metadata IPs.
// Ceiling: DNS rebinding not fully mitigated — the resolved IP is checked but
// the outbound fetch may still hit a different IP if the attacker controls DNS.
export async function validateWebhookUrlAsync(url: string): Promise<string | null> {
  const basicError = validateWebhookUrl(url);
  if (basicError) return basicError;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Invalid webhook URL';
  }

  const hostname = parsed.hostname.toLowerCase();

  // Only resolve hostnames (not IPs — already checked above)
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) return null;

  try {
    const dohResponse = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { 'Accept': 'application/dns-json' },
    });
    if (!dohResponse.ok) return null; // If DoH fails, don't block — basic checks already passed
    const dohData = await dohResponse.json() as any;
    const answers = dohData.Answer || [];
    for (const answer of answers) {
      const resolvedIp = answer.data;
      const ipCheck = validateWebhookUrl(`https://${resolvedIp}/`);
      if (ipCheck) return 'Webhook URL hostname resolves to a private/internal address';
    }
  } catch {
    // DoH unavailable — basic checks are the safety net
  }

  return null;
}
