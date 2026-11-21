import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Check,
  Container,
  Copy,
  DollarSign,
  Download,
  Edit2,
  ExternalLink,
  Globe2,
  Monitor,
  Network as NetworkIcon,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Upload,
  Wifi,
  X
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { lookupReverseDns, expandCidrIpv4 } from '../lib/dns'
import { useSetBreadcrumbs } from '../lib/breadcrumbs'
import type { IPAddress, Network, Server as ServerRecord } from '../types'

type IpFormState = {
  address: string
  server_id: string
  assigned_vps_id: string
  ip_type: 'public' | 'private'
  purpose: string // Reverse DNS
  label: string
  monthly_cost: string
  notes: string
}

const emptyIpForm: IpFormState = {
  address: '',
  server_id: '',
  assigned_vps_id: '',
  ip_type: 'public',
  purpose: '',
  label: '',
  monthly_cost: '',
  notes: ''
}

type NetFormState = {
  name: string
  cidr: string
  gateway: string
  network_type: string
  description: string
  monthly_cost: string
  notes: string
}

const emptyNetForm: NetFormState = {
  name: '',
  cidr: '',
  gateway: '',
  network_type: 'public',
  description: '',
  monthly_cost: '',
  notes: ''
}

export default function Networks({ workspaceId }: { workspaceId: string }) {
  useSetBreadcrumbs([{ label: 'Redes e IP' }])
  const [activeTab, setActiveTab] = useState<'ips' | 'networks'>('ips')
  const [ips, setIps] = useState<IPAddress[]>([])
  const [networks, setNetworks] = useState<Network[]>([])
  const [servers, setServers] = useState<ServerRecord[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [query, setQuery] = useState('')
  const [ipFilter, setIpFilter] = useState<'all' | 'assigned' | 'free' | 'public' | 'private'>('all')

  // IP Modal
  const [ipModalOpen, setIpModalOpen] = useState(false)
  const [editingIp, setEditingIp] = useState<IPAddress | null>(null)
  const [ipForm, setIpForm] = useState<IpFormState>(emptyIpForm)
  const [savingIp, setSavingIp] = useState(false)
  const [resolvingRdns, setResolvingRdns] = useState(false)

  async function handleAutoResolveRdns(ipInput: string) {
    if (!ipInput.trim() || ipForm.purpose.trim()) return
    setResolvingRdns(true)
    const host = await lookupReverseDns(ipInput)
    if (host) {
      setIpForm(old => ({ ...old, purpose: host }))
    }
    setResolvingRdns(false)
  }

  // Network Modal
  const [netModalOpen, setNetModalOpen] = useState(false)
  const [editingNet, setEditingNet] = useState<Network | null>(null)
  const [netForm, setNetForm] = useState<NetFormState>(emptyNetForm)
  const [savingNet, setSavingNet] = useState(false)

  const [copiedIp, setCopiedIp] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [ipRes, netRes, srvRes] = await Promise.all([
      supabase!
        .from('ip_addresses')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('address', { ascending: true }),
      supabase!.from('networks').select('*').eq('workspace_id', workspaceId).order('name', { ascending: true }),
      supabase!.from('servers').select('id,name,hostname,parent_id,vm_id,vm_type,role,server_type').eq('workspace_id', workspaceId).order('name')
    ])

    const srvList = (srvRes.data || []) as ServerRecord[]
    const srvMap = new Map<string, ServerRecord>()
    for (const s of srvList) {
      srvMap.set(s.id, s)
    }

    if (ipRes.error) {
      setError(ipRes.error.message)
    } else {
      const onlyIpv4 = ((ipRes.data || []) as IPAddress[])
        .filter(ip => !ip.address.includes(':'))
        .map(ip => {
          let srv = ip.server_id ? srvMap.get(ip.server_id) : null
          let vps = ip.assigned_vps_id ? srvMap.get(ip.assigned_vps_id) : null

          // Normalización: si srv es en realidad una VM/VPS hija (tiene parent_id) y vps no estaba seteado
          if (srv && srv.parent_id && !vps) {
            vps = srv
            srv = srvMap.get(srv.parent_id) || null
            if (srv && vps) {
              supabase!
                .from('ip_addresses')
                .update({ server_id: srv.id, assigned_vps_id: vps.id })
                .eq('id', ip.id)
                .then()
            }
          }

          let physicalServer: ServerRecord | null = null
          if (srv && !srv.parent_id) {
            physicalServer = srv
          } else if (vps && vps.parent_id) {
            physicalServer = srvMap.get(vps.parent_id) || null
          } else if (srv && srv.parent_id) {
            physicalServer = srvMap.get(srv.parent_id) || null
          }

          return {
            ...ip,
            servers: srv ? { id: srv.id, name: srv.name, hostname: srv.hostname } : null,
            assigned_vps: vps ? { id: vps.id, name: vps.name, vm_id: vps.vm_id, vm_type: vps.vm_type } : null,
            physical_server: physicalServer ? { id: physicalServer.id, name: physicalServer.name, hostname: physicalServer.hostname } : null
          }
        })
      setIps(onlyIpv4)
    }

    if (!netRes.error) {
      setNetworks((netRes.data || []) as Network[])
    }

    if (!srvRes.error) {
      setServers(srvList)
    }

    setLoading(false)
  }, [workspaceId])

  useEffect(() => {
    load()
  }, [load])

  // Filtered IPs (Always hide IPv6)
  const filteredIps = useMemo(() => {
    return ips
      .filter(ip => !ip.address.includes(':'))
      .filter(ip => {
        const matchesFilter =
          ipFilter === 'all' ||
          (ipFilter === 'assigned' && (Boolean(ip.server_id) || Boolean(ip.assigned_vps_id))) ||
          (ipFilter === 'free' && !ip.server_id && !ip.assigned_vps_id) ||
          (ipFilter === 'public' && ip.ip_type === 'public') ||
          (ipFilter === 'private' && ip.ip_type === 'private')

        const text = `${ip.address} ${ip.purpose || ''} ${ip.label || ''} ${ip.notes || ''} ${ip.servers?.name || ''} ${ip.servers?.hostname || ''} ${ip.assigned_vps?.name || ''} ${ip.physical_server?.name || ''} ${ip.physical_server?.hostname || ''}`.toLowerCase()
        return matchesFilter && text.includes(query.toLowerCase())
      })
  }, [ips, ipFilter, query])

  // Filtered Networks
  const filteredNets = useMemo(() => {
    return networks.filter(n => {
      const text = `${n.name} ${n.cidr || ''} ${n.description || ''} ${n.notes || ''}`.toLowerCase()
      return text.includes(query.toLowerCase())
    })
  }, [networks, query])

  const totalIpCost = useMemo(() => {
    return ips.reduce((sum, ip) => sum + (ip.monthly_cost || 0), 0)
  }, [ips])

  const assignedCount = useMemo(() => ips.filter(ip => ip.server_id || ip.assigned_vps_id).length, [ips])
  const freeCount = useMemo(() => ips.filter(ip => !ip.server_id && !ip.assigned_vps_id).length, [ips])

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text)
    setCopiedIp(text)
    setTimeout(() => setCopiedIp(null), 2000)
  }

  // IP Handlers
  function openNewIp() {
    setEditingIp(null)
    setIpForm(emptyIpForm)
    setError('')
    setIpModalOpen(true)
  }

  function openEditIp(ip: IPAddress) {
    setEditingIp(ip)
    let srvId = ip.server_id || ''
    let vpsId = ip.assigned_vps_id || ''

    // Normalizar si la IP tenía asignado como server_id un VPS (por el selector plano anterior)
    const targetSrv = servers.find(s => s.id === srvId)
    if (targetSrv && targetSrv.parent_id) {
      vpsId = targetSrv.id
      srvId = targetSrv.parent_id
    }

    setIpForm({
      address: ip.address,
      server_id: srvId,
      assigned_vps_id: vpsId,
      ip_type: ip.ip_type === 'private' ? 'private' : 'public',
      purpose: ip.purpose || '',
      label: ip.label || '',
      monthly_cost: ip.monthly_cost?.toString() || '',
      notes: ip.notes || ''
    })
    setError('')
    setIpModalOpen(true)
  }

  async function saveIp(e: FormEvent) {
    e.preventDefault()
    setSavingIp(true)
    setError('')

    let purpose = ipForm.purpose.trim()
    if (!purpose && ipForm.address.trim()) {
      const autoHost = await lookupReverseDns(ipForm.address.trim())
      if (autoHost) purpose = autoHost
    }

    let srvId = ipForm.server_id || null
    let vpsId = ipForm.assigned_vps_id || null

    // Si se asignó un VPS, asegurar que server_id sea siempre el servidor físico host
    if (vpsId) {
      const vpsObj = servers.find(s => s.id === vpsId)
      if (vpsObj && vpsObj.parent_id) {
        srvId = vpsObj.parent_id
      }
    } else if (srvId) {
      // Si srvId era en realidad un VPS (con parent_id), moverlo a vpsId y apuntar srvId al host
      const srvObj = servers.find(s => s.id === srvId)
      if (srvObj && srvObj.parent_id) {
        vpsId = srvObj.id
        srvId = srvObj.parent_id
      }
    }

    const payload: Record<string, unknown> = {
      workspace_id: workspaceId,
      address: ipForm.address.trim(),
      server_id: srvId,
      assigned_vps_id: vpsId,
      ip_type: ipForm.ip_type,
      purpose: purpose || null,
      label: ipForm.label.trim() || null,
      notes: ipForm.notes.trim() || null
    }

    if (ipForm.monthly_cost) {
      payload.monthly_cost = Number(ipForm.monthly_cost)
    } else {
      payload.monthly_cost = null
    }

    if (editingIp) {
      let { error: updErr } = await supabase!
        .from('ip_addresses')
        .update(payload)
        .eq('id', editingIp.id)
        .eq('workspace_id', workspaceId)

      if (updErr && updErr.message.includes('assigned_vps_id')) {
        delete payload.assigned_vps_id
        updErr = (await supabase!.from('ip_addresses').update(payload).eq('id', editingIp.id).eq('workspace_id', workspaceId)).error
      }

      if (updErr) {
        setError(updErr.message)
        setSavingIp(false)
        return
      }
      setNotice('Dirección IP actualizada.')
    } else {
      let { error: insErr } = await supabase!.from('ip_addresses').insert(payload)
      if (insErr && insErr.message.includes('assigned_vps_id')) {
        delete payload.assigned_vps_id
        insErr = (await supabase!.from('ip_addresses').insert(payload)).error
      }

      if (insErr) {
        setError(insErr.message)
        setSavingIp(false)
        return
      }
      setNotice('Dirección IP registrada.')
    }

    setIpModalOpen(false)
    setSavingIp(false)
    await load()
  }

  async function removeIp(ip: IPAddress) {
    if (!window.confirm(`¿Eliminar la IP ${ip.address}?`)) return
    const { error: delErr } = await supabase!.from('ip_addresses').delete().eq('id', ip.id).eq('workspace_id', workspaceId)
    if (delErr) {
      setError(delErr.message)
    } else {
      setNotice('IP eliminada del inventario.')
      await load()
    }
  }

  // Batch PTR resolve
  const [resolvingBatch, setResolvingBatch] = useState(false)
  const [batchStatus, setBatchStatus] = useState('')

  async function handleBatchResolveRdns() {
    const pending = ips.filter(ip => !ip.address.includes(':') && !ip.purpose && !ip.reverse_dns)
    if (pending.length === 0) {
      setNotice('Todas las direcciones IPv4 ya tienen su Reverse DNS (PTR) resuelto.')
      return
    }

    setResolvingBatch(true)
    setError('')
    let resolvedCount = 0

    for (let i = 0; i < pending.length; i++) {
      const ip = pending[i]
      setBatchStatus(`Resolviendo ${i + 1}/${pending.length}…`)
      try {
        const ptr = await lookupReverseDns(ip.address)
        if (ptr) {
          const { error: updErr } = await supabase!
            .from('ip_addresses')
            .update({ purpose: ptr, reverse_dns: ptr })
            .eq('id', ip.id)
            .eq('workspace_id', workspaceId)
          if (!updErr) resolvedCount++
        }
      } catch {
        // continue
      }
    }

    setResolvingBatch(false)
    setBatchStatus('')
    setNotice(`Resolución completada: se actualizaron ${resolvedCount} de ${pending.length} IPs con su Reverse DNS real.`)
    await load()
  }

  // Export CSV
  function handleExportCsv() {
    const rows = [
      ['IP', 'Tipo', 'Reverse DNS', 'Servidor Host', 'VPS Asignado', 'Etiqueta', 'Costo Mensual', 'Notas']
    ]

    for (const ip of filteredIps) {
      rows.push([
        ip.address,
        ip.ip_type,
        ip.purpose || ip.reverse_dns || '',
        ip.physical_server?.name || ip.servers?.name || '',
        ip.assigned_vps ? `${ip.assigned_vps.vm_type === 'lxc' ? 'LXC' : 'KVM'} ${ip.assigned_vps.name}` : '',
        ip.label || '',
        ip.monthly_cost ? ip.monthly_cost.toString() : '',
        (ip.notes || '').replace(/[\r\n]+/g, ' ')
      ])
    }

    const csvContent = rows
      .map(row => row.map(val => `"${val.replace(/"/g, '""')}"`).join(','))
      .join('\r\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const dateStr = new Date().toISOString().slice(0, 10)
    link.href = url
    link.setAttribute('download', `infrapanel-ips-${dateStr}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Bulk Import
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importHostId, setImportHostId] = useState('')
  const [importAutoRdns, setImportAutoRdns] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')

  async function handleBulkImport(e: FormEvent) {
    e.preventDefault()
    if (!importText.trim()) return

    setImporting(true)
    setError('')
    setImportProgress('Procesando lista…')

    const rawLines = importText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const toInsert: { address: string; purpose?: string; label?: string }[] = []

    for (const line of rawLines) {
      if (line.startsWith('#') || line.toLowerCase().startsWith('ip,')) continue
      const parts = line.split(/[,;\t]/).map(p => p.trim().replace(/^["']|["']$/g, ''))
      const ipCandidate = parts[0]

      if (ipCandidate.includes('/')) {
        const expanded = expandCidrIpv4(ipCandidate)
        for (const exp of expanded) {
          toInsert.push({ address: exp, purpose: parts[1] || undefined, label: parts[2] || undefined })
        }
      } else if (ipCandidate) {
        toInsert.push({ address: ipCandidate, purpose: parts[1] || undefined, label: parts[2] || undefined })
      }
    }

    if (toInsert.length === 0) {
      setError('No se encontraron direcciones IPv4 válidas en el texto ingresado.')
      setImporting(false)
      return
    }

    const uniqueIps = Array.from(new Map(toInsert.map(item => [item.address, item])).values())
    let addedCount = 0

    for (let i = 0; i < uniqueIps.length; i++) {
      const item = uniqueIps[i]
      setImportProgress(`Importando ${i + 1} de ${uniqueIps.length}: ${item.address}…`)

      let ptr = item.purpose
      if (!ptr && importAutoRdns) {
        ptr = (await lookupReverseDns(item.address)) || undefined
      }

      const payload: Record<string, unknown> = {
        workspace_id: workspaceId,
        address: item.address,
        server_id: importHostId || null,
        ip_type: 'public',
        purpose: ptr || null,
        reverse_dns: ptr || null,
        label: item.label || null
      }

      const { data: existing } = await supabase!
        .from('ip_addresses')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('address', item.address)
        .maybeSingle()

      if (existing) {
        await supabase!.from('ip_addresses').update(payload).eq('id', existing.id)
      } else {
        await supabase!.from('ip_addresses').insert(payload)
      }
      addedCount++
    }

    setImporting(false)
    setImportProgress('')
    setImportOpen(false)
    setImportText('')
    setNotice(`Se importaron / actualizaron ${addedCount} direcciones IP correctamente.`)
    await load()
  }

  // Network Handlers
  function openNewNet() {
    setEditingNet(null)
    setNetForm(emptyNetForm)
    setError('')
    setNetModalOpen(true)
  }

  function openEditNet(n: Network) {
    setEditingNet(n)
    setNetForm({
      name: n.name,
      cidr: n.cidr || '',
      gateway: n.gateway || '',
      network_type: n.network_type || 'public',
      description: n.description || '',
      monthly_cost: n.monthly_cost?.toString() || '',
      notes: n.notes || ''
    })
    setError('')
    setNetModalOpen(true)
  }

  async function saveNet(e: FormEvent) {
    e.preventDefault()
    setSavingNet(true)
    setError('')

    const payload: Record<string, unknown> = {
      workspace_id: workspaceId,
      name: netForm.name.trim(),
      cidr: netForm.cidr.trim() || null,
      gateway: netForm.gateway.trim() || null,
      network_type: netForm.network_type,
      description: netForm.description.trim() || null,
      notes: netForm.notes.trim() || null
    }

    if (netForm.monthly_cost) {
      payload.monthly_cost = Number(netForm.monthly_cost)
    } else {
      payload.monthly_cost = null
    }

    if (editingNet) {
      const { error: updErr } = await supabase!
        .from('networks')
        .update(payload)
        .eq('id', editingNet.id)
        .eq('workspace_id', workspaceId)

      if (updErr) {
        setError(updErr.message)
        setSavingNet(false)
        return
      }
      setNotice('Red / Bloque actualizado.')
    } else {
      const { error: insErr } = await supabase!.from('networks').insert(payload)
      if (insErr) {
        setError(insErr.message)
        setSavingNet(false)
        return
      }
      setNotice('Red / Bloque registrado.')
    }

    setNetModalOpen(false)
    setSavingNet(false)
    await load()
  }

  async function removeNet(n: Network) {
    if (!window.confirm(`¿Eliminar la red “${n.name}”?`)) return
    const { error: delErr } = await supabase!.from('networks').delete().eq('id', n.id).eq('workspace_id', workspaceId)
    if (delErr) {
      setError(delErr.message)
    } else {
      setNotice('Red eliminada.')
      await load()
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <div className="eyebrow">DIRECCIONAMIENTO & IPAM</div>
          <h1>Redes e IP</h1>
          <p>Inventario general de todas tus direcciones IP, Reverse DNS (PTR), servidores y bloques CIDR.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {activeTab === 'ips' ? (
            <>
              <button
                type="button"
                className="button secondary"
                onClick={handleBatchResolveRdns}
                disabled={resolvingBatch}
                title="Buscar y resolver PTR mediante DNS para todas las IPs que no tengan Reverse DNS"
              >
                <RefreshCw size={15} className={resolvingBatch ? 'spinner' : ''} />
                {resolvingBatch ? batchStatus : 'Resolver PTR faltantes'}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={handleExportCsv}
                title="Exportar inventario de IPs a CSV"
              >
                <Download size={15} /> Exportar CSV
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setImportOpen(true)}
                title="Importar IPs masivamente desde texto o CSV"
              >
                <Upload size={15} /> Importar IPs
              </button>
              <button className="button primary" onClick={openNewIp}>
                <Plus size={17} /> Registrar IP
              </button>
            </>
          ) : (
            <button className="button primary" onClick={openNewNet}>
              <Plus size={17} /> Crear Red / Bloque
            </button>
          )}
        </div>
      </div>

      <div className="stats-grid">
        <div
          className="stat-card"
          onClick={() => setIpFilter('all')}
          style={{
            cursor: 'pointer',
            border: ipFilter === 'all' ? '2px solid #2563eb' : '1px solid #e2e8f0',
            background: ipFilter === 'all' ? '#eff6ff' : '#fff',
            boxShadow: ipFilter === 'all' ? '0 4px 12px rgba(37, 99, 235, 0.12)' : undefined,
            transition: 'all 0.15s ease',
            userSelect: 'none'
          }}
          title={ipFilter === 'all' ? 'Mostrando todas las IPs' : 'Clic para ver todas las IPs'}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <div className="stat-label">Total Direcciones IP</div>
            <Radio size={18} style={{ color: ipFilter === 'all' ? '#2563eb' : '#64748b' }} />
          </div>
          <div className="stat-value" style={{ color: '#2563eb' }}>{ips.length}</div>
          <div className="stat-caption" style={{ color: ipFilter === 'all' ? '#1d4ed8' : undefined, fontWeight: ipFilter === 'all' ? 700 : 400 }}>
            {ipFilter === 'all' ? '✓ Mostrando todas las IPs' : 'Inventario IPv4 (clic para ver todas)'}
          </div>
        </div>

        <div
          className="stat-card"
          onClick={() => setIpFilter(old => (old === 'assigned' ? 'all' : 'assigned'))}
          style={{
            cursor: 'pointer',
            border: ipFilter === 'assigned' ? '2px solid #16a34a' : '1px solid #e2e8f0',
            background: ipFilter === 'assigned' ? '#f0fdf4' : '#fff',
            boxShadow: ipFilter === 'assigned' ? '0 4px 12px rgba(22, 163, 74, 0.12)' : undefined,
            transition: 'all 0.15s ease',
            userSelect: 'none'
          }}
          title={ipFilter === 'assigned' ? 'Filtro activo: mostrando solo IPs asignadas. Clic para mostrar todas.' : 'Clic para filtrar y ver solo IPs asignadas'}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <div className="stat-label">IPs Asignadas</div>
            <Server size={18} style={{ color: '#16a34a' }} />
          </div>
          <div className="stat-value" style={{ color: '#16a34a' }}>{assignedCount}</div>
          <div className="stat-caption" style={{ color: ipFilter === 'assigned' ? '#15803d' : undefined, fontWeight: ipFilter === 'assigned' ? 700 : 400 }}>
            {ipFilter === 'assigned' ? '✓ Filtrando asignadas (clic para quitar)' : 'Ruteadas a Host o VPS (clic para filtrar)'}
          </div>
        </div>

        <div
          className="stat-card"
          onClick={() => setIpFilter(old => (old === 'free' ? 'all' : 'free'))}
          style={{
            cursor: 'pointer',
            border: ipFilter === 'free' ? '2px solid #f59e0b' : '1px solid #e2e8f0',
            background: ipFilter === 'free' ? '#fffbeb' : '#fff',
            boxShadow: ipFilter === 'free' ? '0 4px 12px rgba(245, 158, 11, 0.12)' : undefined,
            transition: 'all 0.15s ease',
            userSelect: 'none'
          }}
          title={ipFilter === 'free' ? 'Filtro activo: mostrando solo IPs libres. Clic para mostrar todas.' : 'Clic para filtrar y ver solo IPs libres'}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <div className="stat-label">IPs Libres / Disponibles</div>
            <Wifi size={18} style={{ color: '#f59e0b' }} />
          </div>
          <div className="stat-value" style={{ color: '#f59e0b' }}>{freeCount}</div>
          <div className="stat-caption" style={{ color: ipFilter === 'free' ? '#b45309' : undefined, fontWeight: ipFilter === 'free' ? 700 : 400 }}>
            {ipFilter === 'free' ? '✓ Filtrando libres (clic para quitar)' : 'Sin servidor asignado (clic para filtrar)'}
          </div>
        </div>

        <div className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <div className="stat-label">Costo Mensual en IPs</div>
            <DollarSign size={18} style={{ color: '#16a34a' }} />
          </div>
          <div className="stat-value" style={{ color: '#0f172a' }}>${totalIpCost.toFixed(2)}</div>
          <div className="stat-caption">USD / mes en IPs adicionales</div>
        </div>
      </div>

      {notice && (
        <div className="alert success">
          {notice}
          <button className="alert-close" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}

      {error && !ipModalOpen && !netModalOpen && !importOpen && <div className="alert error">{error}</div>}

      {/* IN-PAGE FORM: IMPORTAR IPS MASIVAMENTE (NO MODAL) */}
      {importOpen && (
        <section className="inpage-card" style={{ marginBottom: '22px' }}>
          <form onSubmit={handleBulkImport}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px' }}>
              <div>
                <div className="eyebrow">IPAM MASIVO</div>
                <h2 style={{ margin: '2px 0 0', fontSize: '18px', fontWeight: 800, color: '#1e293b' }}>
                  Importación masiva de direcciones IP
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                  Pegá una lista de IPs (una por línea), bloques CIDR (ej: 66.70.129.32/29) o líneas CSV.
                </p>
              </div>
              <button type="button" className="icon-button" onClick={() => setImportOpen(false)}>
                <X size={19} />
              </button>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <label>Asignar a Servidor Host Físico (opcional)</label>
                <select
                  className="input"
                  value={importHostId}
                  onChange={e => setImportHostId(e.target.value)}
                >
                  <option value="">Sin host físico / Libre</option>
                  {servers.filter(s => !s.parent_id).map(s => (
                    <option key={s.id} value={s.id}>
                      🖥️ {s.name} ({s.hostname || 'Host'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '22px' }}>
                  <input
                    type="checkbox"
                    checked={importAutoRdns}
                    onChange={e => setImportAutoRdns(e.target.checked)}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                    Resolver Reverse DNS (PTR) automáticamente con DoH
                  </span>
                </label>
              </div>

              <div className="form-field full">
                <label>Lista de IPs o Bloques CIDR *</label>
                <textarea
                  className="input"
                  rows={6}
                  required
                  placeholder={`198.50.231.236\n198.50.231.237, panel01.altomarketing.net, Panel CWP\n66.70.129.32/29`}
                  value={importText}
                  onChange={e => setImportText(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: '12px', lineHeight: 1.5 }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px', borderTop: '1px solid #f1f5f9', paddingTop: '14px' }}>
              <button type="button" className="button secondary" onClick={() => setImportOpen(false)} disabled={importing}>
                Cancelar
              </button>
              <button type="submit" className="button primary" disabled={importing || !importText.trim()}>
                {importing ? (
                  <>
                    <RefreshCw size={15} className="spinner" />
                    {importProgress || 'Importando…'}
                  </>
                ) : (
                  <>
                    <Upload size={16} /> Importar IPs ahora
                  </>
                )}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* IN-PAGE FORM: CREAR / EDITAR IP (NO MODAL) */}
      {ipModalOpen && (
        <section className="inpage-card" style={{ marginBottom: '22px' }}>
          <form onSubmit={saveIp}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px' }}>
              <div>
                <div className="eyebrow">IPAM</div>
                <h2 style={{ margin: '2px 0 0', fontSize: '18px', fontWeight: 800, color: '#1e293b' }}>
                  {editingIp ? 'Editar dirección IP' : 'Registrar nueva IP'}
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                  Completá los datos de la dirección, reverse DNS y asignación.
                </p>
              </div>
              <button type="button" className="icon-button" onClick={() => setIpModalOpen(false)}>
                <X size={19} />
              </button>
            </div>

            <div className="form-grid">
              <div className="form-field full">
                <label>Dirección IP o Bloque *</label>
                <input
                  className="input"
                  value={ipForm.address}
                  onChange={e => setIpForm(old => ({ ...old, address: e.target.value }))}
                  onBlur={() => handleAutoResolveRdns(ipForm.address)}
                  placeholder="Ej. 198.50.231.236"
                  required
                  autoFocus
                />
              </div>

              <div className="form-field">
                <label>Servidor Host (Físico / Hipervisor)</label>
                <select
                  className="input"
                  value={ipForm.server_id}
                  onChange={e => {
                    const nextHostId = e.target.value
                    setIpForm(old => {
                      const vpsBelongs = servers.some(s => s.id === old.assigned_vps_id && s.parent_id === nextHostId)
                      return {
                        ...old,
                        server_id: nextHostId,
                        assigned_vps_id: vpsBelongs ? old.assigned_vps_id : ''
                      }
                    })
                  }}
                >
                  <option value="">Libre / Sin servidor asignado</option>
                  {servers
                    .filter(s => !s.parent_id)
                    .map(s => (
                      <option key={s.id} value={s.id}>
                        🖥️ {s.name} ({s.hostname || s.server_type || 'Host'})
                      </option>
                    ))}
                </select>
              </div>

              <div className="form-field">
                <label>VPS asignado (Proxmox)</label>
                <select
                  className="input"
                  value={ipForm.assigned_vps_id}
                  onChange={e => setIpForm(old => ({ ...old, assigned_vps_id: e.target.value }))}
                  disabled={!ipForm.server_id}
                >
                  {!ipForm.server_id ? (
                    <option value="">Primero seleccioná un servidor físico</option>
                  ) : servers.filter(s => s.parent_id === ipForm.server_id).length === 0 ? (
                    <option value="">(Este servidor no tiene VPS registrados)</option>
                  ) : (
                    <>
                      <option value="">Host Proxmox (Libre / Sin VPS)</option>
                      {servers
                        .filter(s => s.parent_id === ipForm.server_id)
                        .map(v => (
                          <option key={v.id} value={v.id}>
                            {v.vm_type === 'lxc' ? '📦 LXC' : '🖥️ KVM'} [{v.vm_id || '?'}] {v.name}
                          </option>
                        ))}
                    </>
                  )}
                </select>
              </div>

              <div className="form-field">
                <label>Tipo de IP</label>
                <select
                  className="input"
                  value={ipForm.ip_type}
                  onChange={e => setIpForm(old => ({ ...old, ip_type: e.target.value as 'public' | 'private' }))}
                >
                  <option value="public">Pública</option>
                  <option value="private">Privada</option>
                </select>
              </div>

              <div className="form-field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>Reverse DNS (PTR)</label>
                  <button
                    type="button"
                    style={{ border: 0, background: 'none', color: '#2563eb', fontSize: '10px', cursor: 'pointer', padding: 0 }}
                    onClick={() => handleAutoResolveRdns(ipForm.address)}
                    disabled={resolvingRdns}
                  >
                    {resolvingRdns ? 'Consultando DNS…' : '🔍 Resolver PTR'}
                  </button>
                </div>
                <input
                  className="input"
                  value={ipForm.purpose}
                  onChange={e => setIpForm(old => ({ ...old, purpose: e.target.value }))}
                  placeholder={resolvingRdns ? 'Buscando PTR automáticamente…' : 'server01.midominio.com'}
                />
              </div>

              <div className="form-field">
                <label>Etiqueta / Uso</label>
                <input
                  className="input"
                  value={ipForm.label}
                  onChange={e => setIpForm(old => ({ ...old, label: e.target.value }))}
                  placeholder="Failover, CWP, Principal..."
                />
              </div>

              <div className="form-field">
                <label>Costo mensual ($)</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={ipForm.monthly_cost}
                  onChange={e => setIpForm(old => ({ ...old, monthly_cost: e.target.value }))}
                  placeholder="Ej. 3.00"
                />
              </div>

              <div className="form-field full">
                <label>Notas</label>
                <textarea
                  className="input textarea"
                  rows={2}
                  value={ipForm.notes}
                  onChange={e => setIpForm(old => ({ ...old, notes: e.target.value }))}
                  placeholder="Información adicional sobre enrutamiento o uso..."
                />
              </div>
            </div>

            {error && <div className="alert error" style={{ marginTop: '14px' }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
              <button type="button" className="button secondary" onClick={() => setIpModalOpen(false)}>
                Cancelar
              </button>
              <button className="button primary" disabled={savingIp}>
                {savingIp ? 'Guardando…' : editingIp ? 'Guardar cambios' : 'Registrar IP'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* IN-PAGE FORM: CREAR / EDITAR SUBRED (NO MODAL) */}
      {netModalOpen && (
        <section className="inpage-card" style={{ marginBottom: '22px' }}>
          <form onSubmit={saveNet}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px' }}>
              <div>
                <div className="eyebrow">SUBREDES</div>
                <h2 style={{ margin: '2px 0 0', fontSize: '18px', fontWeight: 800, color: '#1e293b' }}>
                  {editingNet ? 'Editar Subred' : 'Crear Subred / Bloque'}
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                  Configurá un rango CIDR o red para tu inventario.
                </p>
              </div>
              <button type="button" className="icon-button" onClick={() => setNetModalOpen(false)}>
                <X size={19} />
              </button>
            </div>

            <div className="form-grid">
              <div className="form-field full">
                <label>Nombre de la red / bloque *</label>
                <input
                  className="input"
                  value={netForm.name}
                  onChange={e => setNetForm(old => ({ ...old, name: e.target.value }))}
                  placeholder="Ej. Bloque Failover Canadá o LAN Privada"
                  required
                  autoFocus
                />
              </div>

              <div className="form-field">
                <label>Bloque CIDR</label>
                <input
                  className="input"
                  value={netForm.cidr}
                  onChange={e => setNetForm(old => ({ ...old, cidr: e.target.value }))}
                  placeholder="Ej. 198.51.100.0/29 o 10.0.0.0/24"
                />
              </div>

              <div className="form-field">
                <label>Puerta de enlace (Gateway)</label>
                <input
                  className="input"
                  value={netForm.gateway}
                  onChange={e => setNetForm(old => ({ ...old, gateway: e.target.value }))}
                  placeholder="Ej. 198.51.100.1"
                />
              </div>

              <div className="form-field">
                <label>Tipo de red</label>
                <select
                  className="input"
                  value={netForm.network_type}
                  onChange={e => setNetForm(old => ({ ...old, network_type: e.target.value }))}
                >
                  <option value="public">Pública / Failover</option>
                  <option value="private">Privada / VPC</option>
                  <option value="management">Gestión / IPMI</option>
                  <option value="vlan">VLAN</option>
                  <option value="vpn">VPN</option>
                </select>
              </div>

              <div className="form-field">
                <label>Costo mensual ($)</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={netForm.monthly_cost}
                  onChange={e => setNetForm(old => ({ ...old, monthly_cost: e.target.value }))}
                  placeholder="Ej. 15.00"
                />
              </div>

              <div className="form-field full">
                <label>Descripción / Notas</label>
                <input
                  className="input"
                  value={netForm.description}
                  onChange={e => setNetForm(old => ({ ...old, description: e.target.value }))}
                  placeholder="Detalles sobre el proveedor o destino del bloque..."
                />
              </div>
            </div>

            {error && <div className="alert error" style={{ marginTop: '14px' }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
              <button type="button" className="button secondary" onClick={() => setNetModalOpen(false)}>
                Cancelar
              </button>
              <button className="button primary" disabled={savingNet}>
                {savingNet ? 'Guardando…' : editingNet ? 'Guardar cambios' : 'Crear Subred'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid #e2e8f0', paddingBottom: '2px' }}>
        <button
          type="button"
          className={`button ${activeTab === 'ips' ? 'primary' : 'secondary'}`}
          style={{ height: '34px', fontSize: '11px', borderRadius: '8px 8px 0 0' }}
          onClick={() => setActiveTab('ips')}
        >
          <Radio size={14} />
          Todas las Direcciones IP ({ips.length})
        </button>
        <button
          type="button"
          className={`button ${activeTab === 'networks' ? 'primary' : 'secondary'}`}
          style={{ height: '34px', fontSize: '11px', borderRadius: '8px 8px 0 0' }}
          onClick={() => setActiveTab('networks')}
        >
          <NetworkIcon size={14} />
          Subredes y Bloques CIDR ({networks.length})
        </button>
      </div>

      {/* TAB 1: ALL IPS */}
      {activeTab === 'ips' && (
        <section className="panel table-panel">
          <div className="table-toolbar">
            <div className="search-box">
              <Search size={17} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar por IP, Reverse DNS, servidor o etiqueta…"
              />
            </div>

            {ipFilter !== 'all' && (
              <button
                type="button"
                className="button secondary"
                style={{
                  height: '34px',
                  fontSize: '11px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: ipFilter === 'assigned' ? '#f0fdf4' : ipFilter === 'free' ? '#fffbeb' : '#f0f9ff',
                  borderColor: ipFilter === 'assigned' ? '#bbf7d0' : ipFilter === 'free' ? '#fef3c7' : '#bae6fd',
                  color: ipFilter === 'assigned' ? '#15803d' : ipFilter === 'free' ? '#b45309' : '#0369a1',
                  fontWeight: 600
                }}
                onClick={() => setIpFilter('all')}
                title="Quitar filtro y ver todas las IPs"
              >
                <span>Filtro activo: <strong>{ipFilter === 'assigned' ? 'Solo IPs Asignadas' : 'Solo IPs Libres / Disponibles'}</strong></span>
                <X size={13} />
              </button>
            )}
          </div>

          {loading ? (
            <div className="table-empty">Cargando direcciones IP…</div>
          ) : filteredIps.length === 0 ? (
            <div className="table-empty">
              <div className="empty-icon">
                <Radio size={22} />
              </div>
              <strong>{ips.length ? 'No hay resultados para el filtro seleccionado' : 'Todavía no registraste direcciones IP'}</strong>
              <span>{ips.length ? 'Probá cambiar el filtro o la búsqueda.' : 'Registrá tu primer dirección IP o bloque.'}</span>
              {!ips.length && (
                <button className="button secondary" onClick={openNewIp}>
                  <Plus size={16} /> Registrar IP
                </button>
              )}
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Dirección IP / Bloque</th>
                    <th>Tipo</th>
                    <th>Reverse DNS (PTR)</th>
                    <th>Servidor Físico</th>
                    <th>VPS / Instancia Asignada</th>
                    <th>Etiqueta / Uso</th>
                    <th>Costo / Mes</th>
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIps.map(ip => (
                    <tr key={ip.id}>
                      <td>
                        <div className="ip-address-cell">
                          <span>{ip.address}</span>
                          <button
                            type="button"
                            className={`copy-pill ${copiedIp === ip.address ? 'copied' : ''}`}
                            onClick={() => copyToClipboard(ip.address)}
                            title="Copiar IP al portapapeles"
                          >
                            {copiedIp === ip.address ? <Check size={11} /> : <Copy size={11} />}
                          </button>
                        </div>
                      </td>
                      <td>
                        <span className="type-chip">
                          {ip.ip_type === 'public' ? 'Pública' : 'Privada'}
                        </span>
                      </td>
                        <td>
                          {ip.purpose ? (
                            <span className="rdns-tag">
                              <Globe2 size={11} />
                              {ip.purpose}
                            </span>
                          ) : (
                            <span className="rdns-tag empty">Sin reverse DNS</span>
                          )}
                        </td>
                        <td>
                          {ip.physical_server ? (
                            <Link
                              to={`/servers/${ip.physical_server.id}`}
                              className="ip-badge"
                              style={{
                                background: '#eff6ff',
                                color: '#1d4ed8',
                                borderColor: '#bfdbfe',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                textDecoration: 'none',
                                fontWeight: 600,
                                fontSize: '11px',
                                padding: '3px 8px',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                              title={`Servidor Físico: ${ip.physical_server.name} (${ip.physical_server.hostname || 'Sin hostname'}) - Clic para ver detalle`}
                            >
                              <Server size={12} style={{ color: '#2563eb', flexShrink: 0 }} />
                              <span>{ip.physical_server.name}</span>
                              <ExternalLink size={10} style={{ opacity: 0.6, flexShrink: 0 }} />
                            </Link>
                          ) : (
                            <span
                              className="ip-badge"
                              style={{ background: '#f8fafc', color: '#94a3b8', borderColor: '#e2e8f0', fontSize: '10px' }}
                              title="Sin servidor físico asignado"
                            >
                              —
                            </span>
                          )}
                        </td>
                        <td>
                          {ip.assigned_vps ? (
                            <Link
                              to={`/servers/${ip.assigned_vps.id}`}
                              className="ip-badge"
                              style={{
                                background: ip.assigned_vps.vm_type === 'lxc' ? '#ecfeff' : '#f0fdf4',
                                color: ip.assigned_vps.vm_type === 'lxc' ? '#0891b2' : '#16a34a',
                                borderColor: ip.assigned_vps.vm_type === 'lxc' ? '#a5f3fc' : '#bbf7d0',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                textDecoration: 'none',
                                fontWeight: 600,
                                fontSize: '11px',
                                padding: '3px 8px',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                              title={`VPS / Contenedor: ${ip.assigned_vps.name} - Clic para ver detalle`}
                            >
                              {ip.assigned_vps.vm_type === 'lxc' ? <Container size={11} style={{ flexShrink: 0 }} /> : <Monitor size={11} style={{ flexShrink: 0 }} />}
                              <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px', background: 'rgba(0,0,0,0.06)' }}>
                                {ip.assigned_vps.vm_type === 'lxc' ? 'LXC' : 'KVM'}
                              </span>
                              <span>{ip.assigned_vps.vm_id ? `[${ip.assigned_vps.vm_id}] ` : ''}{ip.assigned_vps.name}</span>
                              <ExternalLink size={10} style={{ opacity: 0.6, flexShrink: 0 }} />
                            </Link>
                          ) : ip.physical_server ? (
                            <span
                              className="ip-badge"
                              style={{ background: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0', fontSize: '10px' }}
                              title="Asignada al servidor físico directamente (sin VPS hijo)"
                            >
                              Host directo / Pool
                            </span>
                          ) : (
                            <span
                              className="ip-badge"
                              style={{ background: '#fffbeb', color: '#b45309', borderColor: '#fef3c7', fontSize: '10px' }}
                            >
                              Libre / Sin servidor
                            </span>
                          )}
                        </td>
                        <td>
                          <span style={{ fontSize: '10px', color: '#64748b' }}>{ip.label || '—'}</span>
                        </td>
                        <td>
                          {ip.monthly_cost ? (
                            <strong style={{ color: '#16a34a' }}>${Number(ip.monthly_cost).toFixed(2)}</strong>
                          ) : (
                            <span className="muted-cell">—</span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button className="icon-button" title="Editar" onClick={() => openEditIp(ip)}>
                              <Edit2 size={15} />
                            </button>
                            <button
                              className="icon-button danger-hover"
                              title="Eliminar"
                              onClick={() => removeIp(ip)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="table-footer">
            <span>
              Mostrando {filteredIps.length} de {ips.length} direcciones IP
            </span>
            <span>Inventario manual IPAM</span>
          </div>
        </section>
      )}

      {/* TAB 2: SUBNETS / NETWORKS */}
      {activeTab === 'networks' && (
        <section className="panel table-panel">
          <div className="table-toolbar">
            <div className="search-box">
              <Search size={17} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar por nombre, CIDR o descripción…"
              />
            </div>
          </div>

          {loading ? (
            <div className="table-empty">Cargando subredes…</div>
          ) : filteredNets.length === 0 ? (
            <div className="table-empty">
              <div className="empty-icon">
                <NetworkIcon size={22} />
              </div>
              <strong>No hay subredes o bloques registrados</strong>
              <span>Creá un bloque CIDR (ej. /29, /30, /24) para organizar tus pools de IPs.</span>
              <button className="button secondary" onClick={openNewNet}>
                <Plus size={16} /> Crear Subred / Bloque
              </button>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nombre de la Red</th>
                    <th>Bloque CIDR</th>
                    <th>Tipo</th>
                    <th>Gateway</th>
                    <th>Descripción</th>
                    <th>Costo / Mes</th>
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNets.map(net => (
                    <tr key={net.id}>
                      <td>
                        <div className="server-cell">
                          <div className="server-table-icon">
                            <NetworkIcon size={16} />
                          </div>
                          <div>
                            <strong>{net.name}</strong>
                            <span>{net.notes || 'Subred configurada'}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="ip-address-cell">
                          <span style={{ color: '#2563eb' }}>{net.cidr || '—'}</span>
                          {net.cidr && (
                            <button
                              type="button"
                              className={`copy-pill ${copiedIp === net.cidr ? 'copied' : ''}`}
                              onClick={() => copyToClipboard(net.cidr!)}
                              title="Copiar CIDR"
                            >
                              {copiedIp === net.cidr ? <Check size={11} /> : <Copy size={11} />}
                            </button>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="type-chip">{net.network_type}</span>
                      </td>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontSize: '10px' }}>
                          {net.gateway || '—'}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '10px', color: '#64748b' }}>{net.description || '—'}</span>
                      </td>
                      <td>
                        {net.monthly_cost ? (
                          <strong style={{ color: '#16a34a' }}>${Number(net.monthly_cost).toFixed(2)}</strong>
                        ) : (
                          <span className="muted-cell">—</span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="icon-button" title="Editar" onClick={() => openEditNet(net)}>
                            <Edit2 size={15} />
                          </button>
                          <button
                            className="icon-button danger-hover"
                            title="Eliminar"
                            onClick={() => removeNet(net)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="table-footer">
            <span>
              Mostrando {filteredNets.length} de {networks.length} redes / bloques
            </span>
            <span>Inventario de Subredes</span>
          </div>
        </section>
      )}
    </div>
  )
}
