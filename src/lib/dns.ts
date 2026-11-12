/**
 * Realiza una consulta Reverse DNS (PTR) en tiempo real desde el cliente usando
 * DNS-over-HTTPS (DoH) estándar (Google DoH y Cloudflare 1.1.1.1).
 */
export async function lookupReverseDns(ipAddress: string): Promise<string | null> {
  const cleanIp = ipAddress.trim().split('/')[0]
  if (!cleanIp) return null

  // Verificar si es un IPv4 válido de 4 octetos
  const parts = cleanIp.split('.')
  if (parts.length !== 4) return null
  for (const p of parts) {
    const n = Number(p)
    if (isNaN(n) || n < 0 || n > 255) return null
  }

  // Orden inverso para in-addr.arpa: 198.50.231.236 -> 236.231.50.198.in-addr.arpa
  const reverseArpa = `${parts[3]}.${parts[2]}.${parts[1]}.${parts[0]}.in-addr.arpa`

  // 1. Intentar con Google DNS-over-HTTPS
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3500)
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(reverseArpa)}&type=PTR`, {
      headers: { Accept: 'application/dns-json' },
      signal: controller.signal
    })
    clearTimeout(timeout)
    if (res.ok) {
      const data = await res.json()
      if (data.Answer && data.Answer.length > 0) {
        const ptr = data.Answer[0].data as string
        if (ptr) return ptr.endsWith('.') ? ptr.slice(0, -1) : ptr
      }
    }
  } catch {
    // Continuar con Cloudflare
  }

  // 2. Fallback a Cloudflare 1.1.1.1 DoH
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3500)
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(reverseArpa)}&type=PTR`, {
      headers: { Accept: 'application/dns-json' },
      signal: controller.signal
    })
    clearTimeout(timeout)
    if (res.ok) {
      const data = await res.json()
      if (data.Answer && data.Answer.length > 0) {
        const ptr = data.Answer[0].data as string
        if (ptr) return ptr.endsWith('.') ? ptr.slice(0, -1) : ptr
      }
    }
  } catch {
    // No se pudo resolver
  }

  return null
}
