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
 * Example qm list:
 *       VMID NAME                 STATUS     MEM(MB)    BOOTDISK(GB) PID
 *        100 radio13.altomarketing.net running    8192              50.00 1234
 *        101 mate.altomarketing.net running    4096              40.00 5678
 * Example pct list:
 *       VMID       Status     Lock         Name
 *        105       running                 postal.altomarketing.net
 */
export function parseQmListOutput(text: string): ProxmoxVM[] {
  const isPct = text.toLowerCase().includes('pct') || text.toLowerCase().includes('lock')
  const lines = text.trim().split('\n')
  const vms: ProxmoxVM[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.toLowerCase().startsWith('vmid')) continue

    // Split by whitespace
    const parts = trimmed.split(/\s+/)
    if (parts.length >= 2) {
      const vmid = parts[0]
      let name = parts[1]
      let status = 'running'
      let memMb: number | undefined
      let diskGb: number | undefined

      if (isPct) {
        // pct list format: VMID Status Lock Name OR VMID Status Name
        if (parts[1] === 'running' || parts[1] === 'stopped') {
          status = parts[1]
          name = parts[parts.length - 1]
        }
      } else {
        name = parts[1]
        status = parts[2] || 'running'
        memMb = parts[3] ? parseFloat(parts[3]) : undefined
        diskGb = parts[4] ? parseFloat(parts[4]) : undefined
      }

      vms.push({
        vmid,
        name,
        status: status.toLowerCase(),
        maxmem: memMb ? memMb * 1024 * 1024 : undefined,
        maxdisk: diskGb ? diskGb * 1024 * 1024 * 1024 : undefined,
        vm_type: isPct ? 'lxc' : 'qemu'
      })
    }
  }

  return vms
}

/**
 * Parses JSON returned by Proxmox API `/api2/json/nodes/{node}/qemu`, `/lxc` or `/cluster/resources`
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

  return list.map(item => {
    const typeStr = String(item.type || item.subtype || '').toLowerCase()
    const idStr = String(item.id || '').toLowerCase()
    const isLxc = typeStr === 'lxc' || idStr.startsWith('lxc/') || typeStr.includes('container')

    return {
      vmid: String(item.vmid || item.id || '').replace(/^qemu\//, '').replace(/^lxc\//, ''),
      name: String(item.name || `VM-${item.vmid}`),
      status: String(item.status || 'unknown'),
      cpus: item.cpus ? Number(item.cpus) : (item.maxcpu ? Number(item.maxcpu) : 1),
      maxmem: item.maxmem ? Number(item.maxmem) : undefined,
      maxdisk: item.maxdisk ? Number(item.maxdisk) : undefined,
      vm_type: isLxc ? 'lxc' : 'qemu'
    }
  })
}
