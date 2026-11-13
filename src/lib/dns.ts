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

/**
 * Desglosa un bloque CIDR IPv4 (ej. 66.70.129.32/29) en su lista de IPs individuales utilizables.
 * Soporta prefijos desde /24 (256 IPs) hasta /32 (1 IP).
 */
export function expandCidrIpv4(cidr: string): string[] {
  const parts = cidr.trim().split('/')
  if (parts.length !== 2) return [cidr.trim()]
  const baseIp = parts[0].trim()
  const prefix = parseInt(parts[1].trim(), 10)
  if (isNaN(prefix) || prefix < 24 || prefix > 32) return [baseIp]

  const octets = baseIp.split('.').map(Number)
  if (octets.length !== 4 || octets.some(o => isNaN(o) || o < 0 || o > 255)) return [baseIp]

  const intIp = ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]
  const total = 1 << (32 - prefix)
  const ips: string[] = []

  for (let i = 0; i < total; i++) {
    const current = (intIp + i) >>> 0
    const o1 = (current >>> 24) & 255
    const o2 = (current >>> 16) & 255
    const o3 = (current >>> 8) & 255
    const o4 = current & 255
    ips.push(`${o1}.${o2}.${o3}.${o4}`)
  }
  return ips
}

