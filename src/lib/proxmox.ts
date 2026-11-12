export interface ProxmoxVM {
  vmid: number | string
  name: string
  status?: string
  cpus?: number
  maxmem?: number // bytes
  maxdisk?: number // bytes
  vm_type?: 'qemu' | 'lxc'
  ip?: string
  notes?: string
}

/**
 * Parses the text output of `qm list` or `pct list` from Proxmox CLI
 * Example:
 *       VMID NAME                 STATUS     MEM(MB)    BOOTDISK(GB) PID
 *        100 radio13.altomarketing.net running    8192              50.00 1234
 *        101 mate.altomarketing.net running    4096              40.00 5678
 */
export function parseQmListOutput(text: string): ProxmoxVM[] {
  const lines = text.trim().split('\n')
  const vms: ProxmoxVM[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.toLowerCase().startsWith('vmid')) continue

    // Split by whitespace
    const parts = trimmed.split(/\s+/)
    if (parts.length >= 2) {
      const vmid = parts[0]
      const name = parts[1]
      const status = parts[2] || 'running'
      const memMb = parts[3] ? parseFloat(parts[3]) : undefined
      const diskGb = parts[4] ? parseFloat(parts[4]) : undefined

      vms.push({
        vmid,
        name,
        status: status.toLowerCase(),
        maxmem: memMb ? memMb * 1024 * 1024 : undefined,
        maxdisk: diskGb ? diskGb * 1024 * 1024 * 1024 : undefined,
        vm_type: 'qemu'
      })
    }
  }

  return vms
}

/**
 * Parses JSON returned by Proxmox API `/api2/json/nodes/{node}/qemu` or `/lxc`
 */
export function parseProxmoxApiResponse(data: unknown): ProxmoxVM[] {
  if (!data) return []
  
  let list: Record<string, unknown>[] = []
  if (Array.isArray(data)) {
    list = data
  } else if (typeof data === 'object' && 'data' in (data as Record<string, unknown>)) {
    const inner = (data as Record<string, unknown>).data
    if (Array.isArray(inner)) list = inner
  }

  return list.map(item => ({
    vmid: String(item.vmid || item.id || ''),
    name: String(item.name || `VM-${item.vmid}`),
    status: String(item.status || 'unknown'),
    cpus: item.cpus ? Number(item.cpus) : (item.maxcpu ? Number(item.maxcpu) : 1),
    maxmem: item.maxmem ? Number(item.maxmem) : undefined,
    maxdisk: item.maxdisk ? Number(item.maxdisk) : undefined,
    vm_type: item.type === 'lxc' ? 'lxc' : 'qemu'
  }))
}
