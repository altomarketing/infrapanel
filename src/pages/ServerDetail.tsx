import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Boxes,
  Check,
  ChevronRight,
  Container,
  Copy,
  Edit2,
  ExternalLink,
  Globe2,
  Layers,
  MapPin,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { lookupReverseDns, expandCidrIpv4 } from '../lib/dns'
import { useSetBreadcrumbs } from '../lib/breadcrumbs'
import { parseQmListOutput, parseProxmoxApiResponse } from '../lib/proxmox'
import type { IPAddress, Server as ServerRecord, Domain } from '../types'

const statusNames: Record<string, string> = {
  active: 'Activo',
  maintenance: 'Mantenimiento',
  inactive: 'Inactivo',
  decommissioned: 'Baja'
}

const typeNames: Record<string, string> = {
  vps: 'VPS',
  dedicated: 'Dedicado',
  physical: 'Físico',
  cloud: 'Cloud',
  virtual_machine: 'Máquina virtual',
  other: 'Otro'
}

type VmFormState = {
  name: string
  vm_id: string
  vm_type: 'qemu' | 'lxc'
  role: string
  operating_system: string
  cpu: string
  ram_gb: string
  storage_gb: string
  assigned_ip_id: string
  monthly_cost: string
  notes: string
}

const emptyVmForm: VmFormState = {
  name: '',
  vm_id: '',
  vm_type: 'qemu',
  role: '',
  operating_system: 'AlmaLinux 8',
  cpu: '2',
  ram_gb: '4',
  storage_gb: '40',
  assigned_ip_id: '',
  monthly_cost: '',
  notes: ''
}

export default function ServerDetail({ workspaceId }: { workspaceId: string }) {
  const { serverId } = useParams<{ serverId: string }>()
  const navigate = useNavigate()

  const [server, setServer] = useState<ServerRecord | null>(null)
  const [ips, setIps] = useState<IPAddress[]>([])
  const [parentIps, setParentIps] = useState<IPAddress[]>([])
  const [vms, setVms] = useState<ServerRecord[]>([])
  const [domains, setDomains] = useState<Domain[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingIps, setLoadingIps] = useState(false)
  const [loadingVms, setLoadingVms] = useState(false)
  const [activeTab, setActiveTab] = useState<'vms' | 'ips' | 'domains'>('vms')

  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copiedIp, setCopiedIp] = useState<string | null>(null)

  // In-page Add IP form
  const [showAddIp, setShowAddIp] = useState(false)
  const [newIpAddress, setNewIpAddress] = useState('')
  const [newIpType, setNewIpType] = useState<'public' | 'private'>('public')
  const [newIpRdns, setNewIpRdns] = useState('')
  const [newIpLabel, setNewIpLabel] = useState('')
  const [newIpCost, setNewIpCost] = useState('')
  const [newIpAssignedVm, setNewIpAssignedVm] = useState('')
  const [savingIp, setSavingIp] = useState(false)
  const [resolvingDns, setResolvingDns] = useState(false)

  // Inline edit state for single IP
  const [editingIpId, setEditingIpId] = useState<string | null>(null)
  const [editRdnsValue, setEditRdnsValue] = useState('')
  const [editLabelValue, setEditLabelValue] = useState('')
  const [editCostValue, setEditCostValue] = useState('')
  const [editVmValue, setEditVmValue] = useState('')

  // In-page Add VM / VPS form
  const [showAddVm, setShowAddVm] = useState(false)
  const [vmForm, setVmForm] = useState<VmFormState>(emptyVmForm)
  const [savingVm, setSavingVm] = useState(false)

  // In-page Proxmox Sync / Import panel
  const [showSyncProxmox, setShowSyncProxmox] = useState(false)
  const [syncImportText, setSyncImportText] = useState('')
  const [importingVms, setImportingVms] = useState(false)

  // Filter IPs & VMs inside server
  const [ipQuery, setIpQuery] = useState('')
  const [vmQuery, setVmQuery] = useState('')
  const [vmTypeFilter, setVmTypeFilter] = useState<'all' | 'qemu' | 'lxc'>('all')

  // Dynamic breadcrumbs
  useSetBreadcrumbs(
    server
      ? server.parent_id && server.parent_server
        ? [
            { label: 'Servidores', to: '/servers' },
            { label: server.parent_server.name, to: `/servers/${server.parent_id}` },
            { label: `${server.vm_id ? `[${server.vm_id}] ` : ''}${server.name}` }
          ]
        : [
            { label: 'Servidores', to: '/servers' },
            { label: server.name }
          ]
      : [
          { label: 'Servidores', to: '/servers' },
          { label: 'Cargando…' }
        ]
  )

  const isChildVps = Boolean(server?.parent_id)

  const loadServer = useCallback(async () => {
    if (!serverId) return
    setLoading(true)
    setError('')

    // Try select with parent_server
    let srvData: ServerRecord | null = null
    const { data, error: srvErr } = await supabase!
      .from('servers')
      .select('*, providers:provider_id(id,name), parent_server:parent_id(id,name)')
      .eq('id', serverId)
      .eq('workspace_id', workspaceId)
      .single()

    if (srvErr) {
      // Fallback if parent_id column doesn't exist yet
      const fallback = await supabase!
        .from('servers')
        .select('*, providers:provider_id(id,name)')
        .eq('id', serverId)
        .eq('workspace_id', workspaceId)
        .single()

      if (fallback.error) {
        setError(`Error al cargar el servidor: ${fallback.error.message}`)
        setLoading(false)
        return
      }
      srvData = fallback.data as ServerRecord
    } else {
      srvData = data as ServerRecord
    }

    setServer(srvData)
    // If it's a child VPS, default tab to IPs or details
    if (srvData.parent_id) {
      setActiveTab('ips')
    }
    setLoading(false)
  }, [serverId, workspaceId])

  const loadIps = useCallback(async () => {
    if (!serverId) return
    setLoadingIps(true)

    // Check if this server is a child VPS to know parent_id
    const { data: srvData } = await supabase!
      .from('servers')
      .select('parent_id')
      .eq('id', serverId)
      .maybeSingle()

    const parentId = srvData?.parent_id

    let ipList: IPAddress[] = []

    if (parentId) {
      // For child VPS, show IPs assigned to this VPS or having server_id = serverId
      const { data, error: ipErr } = await supabase!
        .from('ip_addresses')
        .select('*')
        .eq('workspace_id', workspaceId)
        .or(`assigned_vps_id.eq.${serverId},server_id.eq.${serverId}`)
        .order('address', { ascending: true })

      if (!ipErr && data) {
        ipList = data as IPAddress[]
      }
    } else {
      // For physical host: load direct IPs and also any IPs assigned to child VMs
      const { data: directIps } = await supabase!
        .from('ip_addresses')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('server_id', serverId)
        .order('address', { ascending: true })

      const { data: hostVms } = await supabase!
        .from('servers')
        .select('id')
        .eq('parent_id', serverId)

      const vmIds = (hostVms || []).map(v => v.id)
      let vpsIps: any[] = []
      if (vmIds.length > 0) {
        const { data: vData } = await supabase!
          .from('ip_addresses')
          .select('*')
          .eq('workspace_id', workspaceId)
          .in('assigned_vps_id', vmIds)
        vpsIps = vData || []
      }

      const map = new Map<string, IPAddress>()
      for (const ip of directIps || []) map.set(ip.id, ip as IPAddress)
      for (const ip of vpsIps) {
        map.set(ip.id, ip as IPAddress)
        if (ip.server_id !== serverId) {
          // Normalize server_id to point to physical host
          supabase!.from('ip_addresses').update({ server_id: serverId }).eq('id', ip.id).then()
        }
      }
      ipList = Array.from(map.values())
    }

    const ipv4Only = ipList
      .filter(ip => !ip.address.includes(':'))
      .sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }))
    setIps(ipv4Only)

    // If child VPS, also load parent server IPs to allow quick association
    if (parentId) {
      const { data: pData } = await supabase!
        .from('ip_addresses')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('server_id', parentId)
        .order('address', { ascending: true })
      if (pData) {
        setParentIps(pData.filter(ip => !ip.address.includes(':')))
      }
    }

    setLoadingIps(false)
  }, [serverId, workspaceId])

  const loadVms = useCallback(async () => {
    if (!serverId) return
    setLoadingVms(true)

    try {
      const { data, error: vmErr } = await supabase!
        .from('servers')
        .select('*')
        .eq('parent_id', serverId)
        .eq('workspace_id', workspaceId)
        .order('name', { ascending: true })

      if (vmErr) {
        console.error('Error loading VMs:', vmErr)
      } else if (data) {
        // Sort by vm_id numerically if available
        const sorted = (data as ServerRecord[]).sort((a, b) => {
          const numA = parseInt(String(a.vm_id || '999999'), 10)
          const numB = parseInt(String(b.vm_id || '999999'), 10)
          return numA - numB
        })
        setVms(sorted)
      }
    } catch (err) {
      console.error('Catch loadVms:', err)
    }
    setLoadingVms(false)
  }, [serverId, workspaceId])

  const loadDomains = useCallback(async () => {
    if (!serverId) return
    try {
      const { data } = await supabase!
        .from('domains')
        .select('*, registrar_provider:providers!registrar_provider_id(name)')
        .eq('server_id', serverId)
        .eq('workspace_id', workspaceId)

      if (data) setDomains(data as Domain[])
    } catch {
      // ignore
    }
  }, [serverId, workspaceId])

  useEffect(() => {
    loadServer()
    loadIps()
    loadVms()
    loadDomains()
  }, [loadServer, loadIps, loadVms, loadDomains])

  // Real-time PTR resolution when user types IP in Add form
  async function triggerDohLookup(ipVal: string) {
    const clean = ipVal.trim()
    if (!clean || clean.includes('/') || clean.includes(':')) return
    setResolvingDns(true)
    try {
      const hostname = await lookupReverseDns(clean)
      if (hostname) {
        setNewIpRdns(hostname)
      }
    } catch {
      // ignore
    } finally {
      setResolvingDns(false)
    }
  }

  // Cost calculation
  const totalCost = useMemo(() => {
    const srvCost = Number(server?.monthly_cost) || 0
    const ipCost = ips.reduce((sum, ip) => sum + (Number(ip.monthly_cost) || 0), 0)
    return srvCost + ipCost
  }, [server?.monthly_cost, ips])

  // Resource capacity totals of VMs
  const capacityMetrics = useMemo(() => {
    const totalVms = vms.length
    const runningVms = vms.filter(v => v.status === 'active').length
    const assignedRam = vms.reduce((acc, v) => acc + (Number(v.ram_gb) || 0), 0)
    const assignedDisk = vms.reduce((acc, v) => acc + (Number(v.storage_gb) || 0), 0)
    const assignedCpus = vms.reduce((acc, v) => acc + (parseInt(String(v.cpu || '0'), 10) || 1), 0)
    return {
      totalVms,
      runningVms,
      assignedRam,
      assignedDisk,
      assignedCpus
    }
  }, [vms])

  // Filtered IPs
  const filteredIps = useMemo(() => {
    if (!ipQuery.trim()) return ips
    const q = ipQuery.toLowerCase().trim()
    return ips.filter(
      ip =>
        ip.address.toLowerCase().includes(q) ||
        (ip.reverse_dns && ip.reverse_dns.toLowerCase().includes(q)) ||
        (ip.purpose && ip.purpose.toLowerCase().includes(q)) ||
        (ip.label && ip.label.toLowerCase().includes(q))
    )
  }, [ips, ipQuery])

  // Filtered VMs
  const filteredVms = useMemo(() => {
    return vms.filter(v => {
      if (vmTypeFilter === 'qemu' && v.vm_type === 'lxc') return false
      if (vmTypeFilter === 'lxc' && v.vm_type !== 'lxc') return false

      if (!vmQuery.trim()) return true
      const q = vmQuery.toLowerCase().trim()
      return (
        v.name.toLowerCase().includes(q) ||
        (v.vm_id && String(v.vm_id).includes(q)) ||
        (v.hostname && v.hostname.toLowerCase().includes(q)) ||
        (v.role && v.role.toLowerCase().includes(q)) ||
        (v.operating_system && v.operating_system.toLowerCase().includes(q))
      )
    })
  }, [vms, vmQuery, vmTypeFilter])

  const kvmCount = useMemo(() => vms.filter(v => v.vm_type !== 'lxc').length, [vms])
  const lxcCount = useMemo(() => vms.filter(v => v.vm_type === 'lxc').length, [vms])

  async function handleToggleVmType(vm: ServerRecord) {
    const nextType: 'qemu' | 'lxc' = vm.vm_type === 'lxc' ? 'qemu' : 'lxc'
    const label = nextType === 'lxc' ? 'Contenedor LXC' : 'Máquina KVM'
    const { error: updErr } = await supabase!
      .from('servers')
      .update({ vm_type: nextType })
      .eq('id', vm.id)

    if (updErr) {
      setError(updErr.message)
    } else {
      setVms(prev => prev.map(v => (v.id === vm.id ? { ...v, vm_type: nextType } : v)))
      setNotice(`Se actualizó ${vm.name} a ${label}.`)
    }
  }

  // Copy IP helper
  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
    setCopiedIp(text)
    setTimeout(() => setCopiedIp(null), 1800)
  }

  // Quick Assign / Unassign IP to VPS
  async function handleQuickAssignIp(ipId: string, vpsId: string | null) {
    if (!ipId) return
    setError('')
    const { error: err } = await supabase!
      .from('ip_addresses')
      .update({ assigned_vps_id: vpsId || null })
      .eq('id', ipId)
      .eq('workspace_id', workspaceId)

    if (err) {
      setError(`Error al asociar IP: ${err.message}`)
    } else {
      const targetVm = vpsId ? vms.find(v => v.id === vpsId) : null
      const vmName = targetVm ? targetVm.name : 'Host Proxmox'
      setNotice(vpsId ? `IP asociada a ${vmName} correctamente.` : 'IP liberada (asignada al Host base).')
      await loadIps()
      await loadVms()
    }
  }

  // Add IP handler
  async function handleAddIp(e: FormEvent) {
    e.preventDefault()
    if (!serverId || !newIpAddress.trim()) return

    setSavingIp(true)
    setError('')

    let rdns = newIpRdns.trim()
    if (!rdns && newIpAddress.trim() && !newIpAddress.includes('/')) {
      const autoHost = await lookupReverseDns(newIpAddress.trim())
      if (autoHost) rdns = autoHost
    }

    const hostServerId = isChildVps && server?.parent_id ? server.parent_id : serverId
    const targetVpsId = isChildVps ? serverId : (newIpAssignedVm || null)

    // Check if IP already exists in workspace
    const { data: existingIp } = await supabase!
      .from('ip_addresses')
      .select('id, server_id, assigned_vps_id')
      .eq('workspace_id', workspaceId)
      .eq('address', newIpAddress.trim())
      .maybeSingle()

    if (existingIp) {
      // Update existing IP with assignment
      const patchData: Record<string, unknown> = {
        server_id: hostServerId,
        assigned_vps_id: targetVpsId,
        purpose: rdns || null,
        reverse_dns: rdns || null
      }
      if (newIpLabel.trim()) patchData.label = newIpLabel.trim()
      if (newIpCost.trim()) patchData.monthly_cost = Number(newIpCost)

      const { error: updErr } = await supabase!
        .from('ip_addresses')
        .update(patchData)
        .eq('id', existingIp.id)

      if (updErr) {
        setError(`Error al asociar IP existente: ${updErr.message}`)
      } else {
        setNotice(`IP ${newIpAddress.trim()} asociada con éxito.`)
        setNewIpAddress('')
        setNewIpRdns('')
        setNewIpLabel('')
        setNewIpCost('')
        setNewIpAssignedVm('')
        setShowAddIp(false)
        await loadIps()
        await loadVms()
      }
      setSavingIp(false)
      return
    }

    const ipPayload: Record<string, unknown> = {
      workspace_id: workspaceId,
      server_id: hostServerId,
      assigned_vps_id: targetVpsId,
      address: newIpAddress.trim(),
      ip_type: newIpType,
      label: newIpLabel.trim() || null,
      purpose: rdns || null,
      reverse_dns: rdns || null
    }

    if (newIpCost.trim()) {
      ipPayload.monthly_cost = Number(newIpCost)
    }

    let insertErr = (await supabase!.from('ip_addresses').insert(ipPayload)).error
    if (insertErr && insertErr.message.includes('assigned_vps_id')) {
      // Retry without assigned_vps_id if column not created yet
      delete ipPayload.assigned_vps_id
      insertErr = (await supabase!.from('ip_addresses').insert(ipPayload)).error
    }

    if (insertErr) {
      setError(`Error al registrar IP: ${insertErr.message}`)
    } else {
      setNotice(`IP ${newIpAddress.trim()} asociada con éxito.`)
      setNewIpAddress('')
      setNewIpRdns('')
      setNewIpLabel('')
      setNewIpCost('')
      setNewIpAssignedVm('')
      setShowAddIp(false)
      await loadIps()
      await loadVms()
    }
    setSavingIp(false)
  }

  // Delete single IP
  async function handleDeleteIp(ipId: string, addr: string) {
    if (!window.confirm(`¿Eliminar la IP ${addr} de este servidor?`)) return
    const { error: delErr } = await supabase!.from('ip_addresses').delete().eq('id', ipId).eq('workspace_id', workspaceId)
    if (delErr) {
      setError(delErr.message)
    } else {
      setNotice(`IP ${addr} eliminada.`)
      await loadIps()
      await loadVms()
    }
  }

  // Inline edit save for IP
  async function handleSaveIpEdit(ipId: string) {
    setError('')
    const patchData: Record<string, unknown> = {
      purpose: editRdnsValue.trim() || null,
      reverse_dns: editRdnsValue.trim() || null,
      label: editLabelValue.trim() || null,
      assigned_vps_id: editVmValue || null
    }
    if (editCostValue.trim()) {
      patchData.monthly_cost = Number(editCostValue)
    } else {
      patchData.monthly_cost = null
    }

    let { error: patchErr } = await supabase!.from('ip_addresses').update(patchData).eq('id', ipId).eq('workspace_id', workspaceId)
    if (patchErr && patchErr.message.includes('assigned_vps_id')) {
      delete patchData.assigned_vps_id
      patchErr = (await supabase!.from('ip_addresses').update(patchData).eq('id', ipId).eq('workspace_id', workspaceId)).error
    }

    if (patchErr) {
      setError(`Error al actualizar IP: ${patchErr.message}`)
    } else {
      setNotice('IP actualizada con éxito.')
      setEditingIpId(null)
      await loadIps()
      await loadVms()
    }
  }

  // Create Child VPS in Proxmox
  async function handleCreateVm(e: FormEvent) {
    e.preventDefault()
    if (!serverId || !vmForm.name.trim()) return

    setSavingVm(true)
    setError('')

    const payload: Record<string, unknown> = {
      workspace_id: workspaceId,
      parent_id: serverId,
      name: vmForm.name.trim(),
      hostname: vmForm.name.trim(),
      vm_id: vmForm.vm_id.trim() || null,
      vm_type: vmForm.vm_type,
      role: vmForm.role.trim() || null,
      server_type: 'vps',
      operating_system: vmForm.operating_system.trim() || null,
      cpu: vmForm.cpu.trim() || null,
      ram_gb: vmForm.ram_gb ? Number(vmForm.ram_gb) : null,
      storage_gb: vmForm.storage_gb ? Number(vmForm.storage_gb) : null,
      monthly_cost: vmForm.monthly_cost ? Number(vmForm.monthly_cost) : null,
      status: 'active',
      notes: vmForm.notes.trim() || null
    }

    const { data: newVm, error: insertErr } = await supabase!.from('servers').insert(payload).select('id').single()

    if (insertErr) {
      if (insertErr.message.includes('parent_id') || insertErr.message.includes('vm_id')) {
        setError(`Para guardar VPS vinculados a Proxmox, ejecutá en Supabase SQL Editor el script migration_proxmox.sql: ${insertErr.message}`)
      } else {
        setError(insertErr.message)
      }
      setSavingVm(false)
      return
    }

    // Assign IP if selected
    if (vmForm.assigned_ip_id && newVm) {
      try {
        await supabase!.from('ip_addresses').update({ assigned_vps_id: newVm.id }).eq('id', vmForm.assigned_ip_id)
      } catch {
        // ignore
      }
    }

    setNotice(`VPS [${vmForm.vm_id || 'VM'}] ${vmForm.name} creado correctamente.`)
    setVmForm(emptyVmForm)
    setShowAddVm(false)
    await loadVms()
    await loadIps()
    setSavingVm(false)
  }

  // Parse & Bulk Import from Proxmox qm list or JSON
  async function handleBulkImportProxmox(e: FormEvent) {
    e.preventDefault()
    if (!serverId || !syncImportText.trim()) return

    setImportingVms(true)
    setError('')

    let parsedList = []
    const trimmed = syncImportText.trim()
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        parsedList = parseProxmoxApiResponse(JSON.parse(trimmed))
      } catch (jsonErr) {
        setError('Error al analizar JSON de Proxmox: verifique el formato.')
        setImportingVms(false)
        return
      }
    } else {
      parsedList = parseQmListOutput(trimmed)
    }

    if (parsedList.length === 0) {
      setError('No se detectaron VMs válidas en el texto ingresado. Asegurate de copiar la salida de "qm list" o el JSON de la API.')
      setImportingVms(false)
      return
    }

    let importedCount = 0
    let lastErr = ''
    for (const item of parsedList) {
      const payload: Record<string, unknown> = {
        workspace_id: workspaceId,
        parent_id: serverId,
        name: item.name,
        hostname: item.name,
        vm_id: String(item.vmid),
        vm_type: item.vm_type || 'qemu',
        server_type: 'vps',
        status: item.status === 'running' ? 'active' : 'inactive',
        cpu: item.cpus ? `${item.cpus} vCPU` : '2 vCPU',
        ram_gb: item.maxmem ? Math.round(item.maxmem / (1024 * 1024 * 1024)) : 4,
        storage_gb: item.maxdisk ? Math.round(item.maxdisk / (1024 * 1024 * 1024)) : 40
      }

      const { error: insErr } = await supabase!.from('servers').upsert(payload, { onConflict: 'workspace_id,name' })
      if (!insErr) {
        importedCount++
      } else {
        lastErr = insErr.message
      }
    }

    if (importedCount > 0) {
      setNotice(`Se sincronizaron ${importedCount} VPS de Proxmox correctamente.`)
      setSyncImportText('')
      setShowSyncProxmox(false)
    } else if (lastErr) {
      setError(`Error al sincronizar: ${lastErr}`)
    }
    await loadVms()
    await loadIps()
    setImportingVms(false)
  }

  // Delete server or child VM
  async function handleDeleteServer() {
    if (!server) return
    const msg = isChildVps
      ? `¿Eliminar el VPS “${server.name}”?`
      : `¿Eliminar el servidor físico “${server.name}”? Sus VPS e IPs asociadas también serán afectadas.`
    if (!window.confirm(msg)) return

    const { error: delErr } = await supabase!.from('servers').delete().eq('id', server.id).eq('workspace_id', workspaceId)
    if (delErr) {
      setError(delErr.message)
    } else {
      if (server.parent_id) {
        navigate(`/servers/${server.parent_id}`)
      } else {
        navigate('/servers')
      }
    }
  }

  if (loading) {
    return (
      <div className="table-empty">
        <div className="spinner" /> Cargando servidor…
      </div>
    )
  }

  if (!server) {
    return (
      <div className="table-empty">
        <h2>Servidor no encontrado</h2>
        <p>No se encontró el servidor solicitado o fue eliminado.</p>
        <Link to="/servers" className="button secondary">
          <ArrowLeft size={16} /> Volver a Servidores
        </Link>
      </div>
    )
  }

  // Host Proxmox URL helper
  const proxmoxWebUrl = server.management_url || (server.hostname ? `https://${server.hostname}:8006` : null)
  const childProxmoxConsoleUrl = isChildVps && server.parent_server && server.vm_id
    ? `https://${server.parent_server.name}:8006/#v1:0:=${server.vm_type === 'lxc' ? 'lxc' : 'qemu'}/${server.vm_id}`
    : proxmoxWebUrl

  return (
    <div className="server-detail-page">
      {/* Top Navigation Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', gap: '12px', flexWrap: 'wrap' }}>
        {isChildVps && server.parent_id ? (
          <Link
            to={`/servers/${server.parent_id}`}
            className="button secondary"
            style={{ height: '36px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          >
            <ArrowLeft size={16} /> Volver al Host Proxmox ({server.parent_server?.name || 'Hipervisor'})
          </Link>
        ) : (
          <Link to="/servers" className="button secondary" style={{ height: '36px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <ArrowLeft size={16} /> Volver a Servidores
          </Link>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          <Link to={`/servers/${server.id}/edit`} className="button secondary" style={{ height: '36px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Edit2 size={15} /> Editar
          </Link>
          {(childProxmoxConsoleUrl || proxmoxWebUrl) && (
            <a
              href={childProxmoxConsoleUrl || proxmoxWebUrl || '#'}
              target="_blank"
              rel="noreferrer"
              className="button secondary"
              style={{ height: '36px', display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#e65100', fontWeight: 600 }}
              title="Abrir consola web Proxmox VE en puerto 8006"
            >
              <ExternalLink size={15} /> Proxmox {isChildVps ? 'Console' : 'Web'}
            </a>
          )}
          <button type="button" className="button danger-hover" onClick={handleDeleteServer} style={{ height: '36px', display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#dc2626' }}>
            <Trash2 size={15} /> Eliminar
          </button>
        </div>
      </div>

      {notice && <div className="alert success" style={{ marginBottom: '16px' }}>{notice}</div>}
      {error && <div className="alert error" style={{ marginBottom: '16px' }}>{error}</div>}

      {/* PARENT / CHILD BADGE ALERT */}
      {isChildVps && server.parent_server && (
        <div className="alert" style={{ background: '#f0f9ff', borderColor: '#bae6fd', color: '#0369a1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {server.vm_type === 'lxc' ? <Container size={18} /> : <Monitor size={18} />}
            <span>
              Este servidor es un <strong>{server.vm_type === 'lxc' ? 'Contenedor LXC' : 'VPS KVM (QEMU)'}</strong> alojado en el nodo físico <strong>{server.parent_server.name}</strong> (VM ID: {server.vm_id || '—'}).
            </span>
          </div>
          <Link to={`/servers/${server.parent_id}`} className="text-link" style={{ fontWeight: 700, fontSize: '12px' }}>
            Ver Hipervisor Proxmox →
          </Link>
        </div>
      )}

      {/* Main Server Header Card */}
      <section className="inpage-card" style={{ marginBottom: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: !isChildVps ? '#eff6ff' : server.vm_type === 'lxc' ? '#ecfeff' : '#f0fdf4',
                color: !isChildVps ? '#2563eb' : server.vm_type === 'lxc' ? '#0891b2' : '#16a34a',
                display: 'grid',
                placeItems: 'center'
              }}
              title={!isChildVps ? 'Servidor Dedicado / Host Proxmox' : server.vm_type === 'lxc' ? 'Contenedor LXC' : 'Máquina Virtual KVM'}
            >
              {!isChildVps ? (
                <Server size={26} />
              ) : server.vm_type === 'lxc' ? (
                <Container size={26} />
              ) : (
                <Monitor size={26} />
              )}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0, color: '#1e293b' }}>
                  {server.vm_id ? `[${server.vm_id}] ` : ''}{server.name}
                </h1>
                {server.role && (
                  <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                    {server.role}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b', fontSize: '13px', marginTop: '3px' }}>
                <Globe2 size={14} />
                <span>{server.hostname || 'Sin hostname configurado'}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span className={`status-pill ${server.status}`}>
              {statusNames[server.status] || server.status}
            </span>
            <span
              className="type-chip"
              style={
                isChildVps
                  ? server.vm_type === 'lxc'
                    ? { background: '#ecfeff', color: '#0891b2', borderColor: '#a5f3fc', display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 700 }
                    : { background: '#f0fdf4', color: '#16a34a', borderColor: '#bbf7d0', display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 700 }
                  : undefined
              }
            >
              {isChildVps ? (
                server.vm_type === 'lxc' ? (
                  <>
                    <Container size={13} /> Contenedor LXC
                  </>
                ) : (
                  <>
                    <Monitor size={13} /> Máquina KVM
                  </>
                )
              ) : (
                typeNames[server.server_type] || server.server_type
              )}
            </span>
            {server.providers?.name && (
              <span className="type-chip">{server.providers.name}</span>
            )}
            {server.location && (
              <span className="location-cell" style={{ fontSize: '11px' }}>
                <MapPin size={14} />
                {server.location}
              </span>
            )}
          </div>
        </div>

        {/* Specs & Cost breakdown grid */}
        <div className="specs-panel" style={{ marginTop: '20px' }}>
          <div className="spec-item">
            <span>Costo {isChildVps ? 'del VPS' : 'Servidor Base'}</span>
            <strong style={{ color: '#2563eb', fontSize: '16px' }}>
              ${Number(server.monthly_cost || 0).toFixed(2)} / mes
            </strong>
          </div>
          {!isChildVps && (
            <div className="spec-item">
              <span>Costo Total (Host + IPs)</span>
              <strong style={{ color: '#16a34a', fontSize: '16px' }}>
                ${totalCost.toFixed(2)} / mes
              </strong>
            </div>
          )}
          <div className="spec-item">
            <span>Sistema Operativo</span>
            <strong>{server.operating_system || '—'}</strong>
          </div>
          <div className="spec-item">
            <span>CPU / Núcleos</span>
            <strong>{server.cpu || '—'}</strong>
          </div>
          <div className="spec-item">
            <span>Memoria RAM</span>
            <strong>{server.ram_gb ? `${server.ram_gb} GB` : '—'}</strong>
          </div>
          <div className="spec-item">
            <span>Almacenamiento</span>
            <strong>{server.storage_gb ? `${server.storage_gb} GB` : '—'}</strong>
          </div>
          {server.notes && (
            <div className="spec-item" style={{ gridColumn: '1 / -1' }}>
              <span>Notas Técnicas</span>
              <strong style={{ fontWeight: 400, color: '#475569' }}>{server.notes}</strong>
            </div>
          )}
        </div>
      </section>

      {/* Tabs Selector */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', marginBottom: '20px' }}>
        {!isChildVps && (
          <button
            type="button"
            className={`button ${activeTab === 'vms' ? 'primary' : 'secondary'}`}
            style={{ borderRadius: '8px 8px 0 0', height: '38px', fontSize: '12px' }}
            onClick={() => setActiveTab('vms')}
          >
            <Boxes size={16} />
            Máquinas Virtuales / VPS ({vms.length})
          </button>
        )}
        <button
          type="button"
          className={`button ${activeTab === 'ips' ? 'primary' : 'secondary'}`}
          style={{ borderRadius: '8px 8px 0 0', height: '38px', fontSize: '12px' }}
          onClick={() => setActiveTab('ips')}
        >
          <Layers size={16} />
          Direcciones IP y Reverse DNS ({ips.length})
        </button>
        {domains.length > 0 && (
          <button
            type="button"
            className={`button ${activeTab === 'domains' ? 'primary' : 'secondary'}`}
            style={{ borderRadius: '8px 8px 0 0', height: '38px', fontSize: '12px' }}
            onClick={() => setActiveTab('domains')}
          >
            <Globe2 size={16} />
            Dominios Asociados ({domains.length})
          </button>
        )}
      </div>

      {/* TAB 1: PROXMOX VMS (FOR PHYSICAL HOSTS) */}
      {!isChildVps && activeTab === 'vms' && (
        <section className="inpage-card">
          {/* Capacity stats banner */}
          <div className="stats-grid" style={{ marginBottom: '22px' }}>
            <div className="stat-card">
              <div className="stat-label">Total VPS / Máquinas</div>
              <div className="stat-value">{capacityMetrics.totalVms}</div>
              <div className="stat-caption">{capacityMetrics.runningVms} activas en Proxmox</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">vCPUs asignadas</div>
              <div className="stat-value" style={{ color: '#2563eb' }}>{capacityMetrics.assignedCpus} vCPU</div>
              <div className="stat-caption">Host: {server.cpu || '12 Cores'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">RAM asignada a VMs</div>
              <div className="stat-value" style={{ color: '#16a34a' }}>{capacityMetrics.assignedRam} GB</div>
              <div className="stat-caption">De {server.ram_gb || 128} GB físicos disponibles</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Almacenamiento VMs</div>
              <div className="stat-value" style={{ color: '#eab308' }}>{capacityMetrics.assignedDisk} GB</div>
              <div className="stat-caption">De {server.storage_gb || 2000} GB totales</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div className="search-box" style={{ width: '220px' }}>
                <Search size={15} />
                <input
                  className="input"
                  value={vmQuery}
                  onChange={e => setVmQuery(e.target.value)}
                  placeholder="Buscar VM por nombre, ID, SO…"
                  style={{ height: '34px', fontSize: '12px' }}
                />
              </div>

              <div style={{ display: 'inline-flex', gap: '4px', background: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
                <button
                  type="button"
                  onClick={() => setVmTypeFilter('all')}
                  style={{
                    border: 'none',
                    background: vmTypeFilter === 'all' ? '#fff' : 'transparent',
                    boxShadow: vmTypeFilter === 'all' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                    color: vmTypeFilter === 'all' ? '#0f172a' : '#64748b',
                    fontWeight: 600,
                    fontSize: '11px',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  Todos ({vms.length})
                </button>
                <button
                  type="button"
                  onClick={() => setVmTypeFilter('qemu')}
                  style={{
                    border: 'none',
                    background: vmTypeFilter === 'qemu' ? '#fff' : 'transparent',
                    boxShadow: vmTypeFilter === 'qemu' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                    color: vmTypeFilter === 'qemu' ? '#16a34a' : '#64748b',
                    fontWeight: 600,
                    fontSize: '11px',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Monitor size={12} /> KVM ({kvmCount})
                </button>
                <button
                  type="button"
                  onClick={() => setVmTypeFilter('lxc')}
                  style={{
                    border: 'none',
                    background: vmTypeFilter === 'lxc' ? '#fff' : 'transparent',
                    boxShadow: vmTypeFilter === 'lxc' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                    color: vmTypeFilter === 'lxc' ? '#0891b2' : '#64748b',
                    fontWeight: 600,
                    fontSize: '11px',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Container size={12} /> LXC ({lxcCount})
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="button secondary"
                style={{ height: '34px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onClick={() => setShowSyncProxmox(!showSyncProxmox)}
              >
                <RefreshCw size={14} /> Sincronizar Proxmox
              </button>
              <button
                type="button"
                className="button primary"
                style={{ height: '34px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onClick={() => setShowAddVm(!showAddVm)}
              >
                <Plus size={15} /> {showAddVm ? 'Ocultar formulario' : 'Nuevo VPS / VM'}
              </button>
            </div>
          </div>

          {/* IN-PAGE SYNC / IMPORT PANEL */}
          {showSyncProxmox && (
            <form className="inpage-subform" onSubmit={handleBulkImportProxmox} style={{ marginBottom: '22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#1e293b' }}>
                    Sincronización rápida con Proxmox VE
                  </h3>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    Pegá la salida del comando <code>qm list</code> (KVM), <code>pct list</code> (LXC) o el JSON de la API de Proxmox para importar y sincronizar todas las instancias.
                  </span>
                </div>
                <button type="button" className="icon-button" onClick={() => setShowSyncProxmox(false)}>
                  <X size={17} />
                </button>
              </div>

              <textarea
                className="input"
                rows={5}
                required
                placeholder="VMID NAME                 STATUS     MEM(MB)    BOOTDISK(GB)&#10; 100 radio13.altomarketing.net running    8192       50.00&#10; 101 mate.altomarketing.net running    4096       40.00"
                value={syncImportText}
                onChange={e => setSyncImportText(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '12px', marginBottom: '12px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="button secondary" onClick={() => setShowSyncProxmox(false)}>
                  Cancelar
                </button>
                <button type="submit" className="button primary" disabled={importingVms}>
                  <Upload size={14} /> {importingVms ? 'Importando…' : 'Procesar e Importar VMs'}
                </button>
              </div>
            </form>
          )}

          {/* IN-PAGE ADD VM FORM */}
          {showAddVm && (
            <form className="inpage-subform" onSubmit={handleCreateVm} style={{ marginBottom: '22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#1e293b' }}>
                  Crear nuevo VPS / VM en este Proxmox
                </h3>
                <button type="button" className="icon-button" onClick={() => setShowAddVm(false)}>
                  <X size={17} />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Nombre del VPS (Hostname) *
                  </label>
                  <input
                    className="input"
                    required
                    placeholder="ej. radio13.altomarketing.net"
                    value={vmForm.name}
                    onChange={e => setVmForm(old => ({ ...old, name: e.target.value }))}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    VM ID en Proxmox *
                  </label>
                  <input
                    className="input"
                    required
                    placeholder="ej. 101"
                    value={vmForm.vm_id}
                    onChange={e => setVmForm(old => ({ ...old, vm_id: e.target.value }))}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Tipo de virtualización
                  </label>
                  <select
                    className="input"
                    value={vmForm.vm_type}
                    onChange={e => setVmForm(old => ({ ...old, vm_type: e.target.value as 'qemu' | 'lxc' }))}
                  >
                    <option value="qemu">QEMU / KVM (Máquina Virtual)</option>
                    <option value="lxc">LXC (Contenedor)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Función / Rol
                  </label>
                  <input
                    className="input"
                    placeholder="ej. Radio Streaming / CWP Hosting"
                    value={vmForm.role}
                    onChange={e => setVmForm(old => ({ ...old, role: e.target.value }))}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Asignar IP Failover
                  </label>
                  <select
                    className="input"
                    value={vmForm.assigned_ip_id}
                    onChange={e => setVmForm(old => ({ ...old, assigned_ip_id: e.target.value }))}
                  >
                    <option value="">Sin IP asignada de momento</option>
                    {ips.map(ip => (
                      <option key={ip.id} value={ip.id}>
                        {ip.address} {ip.reverse_dns ? `(${ip.reverse_dns})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Sistema Operativo
                  </label>
                  <input
                    className="input"
                    placeholder="ej. AlmaLinux 8 / Debian 12"
                    value={vmForm.operating_system}
                    onChange={e => setVmForm(old => ({ ...old, operating_system: e.target.value }))}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    vCPUs
                  </label>
                  <input
                    className="input"
                    placeholder="ej. 4"
                    value={vmForm.cpu}
                    onChange={e => setVmForm(old => ({ ...old, cpu: e.target.value }))}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    RAM (GB)
                  </label>
                  <input
                    className="input"
                    type="number"
                    placeholder="ej. 8"
                    value={vmForm.ram_gb}
                    onChange={e => setVmForm(old => ({ ...old, ram_gb: e.target.value }))}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Disco (GB)
                  </label>
                  <input
                    className="input"
                    type="number"
                    placeholder="ej. 60"
                    value={vmForm.storage_gb}
                    onChange={e => setVmForm(old => ({ ...old, storage_gb: e.target.value }))}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Costo mensual ($)
                  </label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={vmForm.monthly_cost}
                    onChange={e => setVmForm(old => ({ ...old, monthly_cost: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="button secondary" onClick={() => setShowAddVm(false)}>
                  Cancelar
                </button>
                <button type="submit" className="button primary" disabled={savingVm}>
                  {savingVm ? 'Creando…' : 'Crear VPS'}
                </button>
              </div>
            </form>
          )}

          {/* VMs Table */}
          {loadingVms ? (
            <div className="table-empty">Cargando máquinas virtuales…</div>
          ) : filteredVms.length === 0 ? (
            <div className="table-empty" style={{ padding: '36px' }}>
              <Boxes size={26} style={{ color: '#94a3b8', marginBottom: '8px' }} />
              <strong>{vms.length === 0 ? 'No hay VPS registrados en este Proxmox' : 'Sin coincidencias con la búsqueda'}</strong>
              <span>
                {vms.length === 0
                  ? 'Podés agregar tus VPS manualmente con el botón "Nuevo VPS / VM" o sincronizarlos desde Proxmox.'
                  : 'Probá con otro término de búsqueda.'}
              </span>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>VM ID</th>
                    <th>Nombre / Hostname</th>
                    <th>Función / Rol</th>
                    <th>IP / Reverse DNS</th>
                    <th>Sistema Operativo</th>
                    <th>Recursos</th>
                    <th>Estado</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVms.map(vm => {
                    const assignedIp = ips.find(ip => ip.assigned_vps_id === vm.id) || (vm.ip_addresses && vm.ip_addresses[0])
                    const isLxc = vm.vm_type === 'lxc'
                    const vmConsoleUrl = proxmoxWebUrl && vm.vm_id ? `${proxmoxWebUrl}/#v1:0:=${isLxc ? 'lxc' : 'qemu'}/${vm.vm_id}` : null

                    return (
                      <tr key={vm.id}>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#0f172a', background: '#f1f5f9', padding: '3px 7px', borderRadius: '6px' }}>
                            {vm.vm_id || '—'}
                          </span>
                        </td>

                        <td>
                          <div
                            className="server-cell clickable"
                            onClick={() => navigate(`/servers/${vm.id}`)}
                            title="Ver ficha completa de este VPS"
                          >
                            <div
                              className="server-table-icon"
                              style={{
                                background: isLxc ? '#ecfeff' : '#f0fdf4',
                                color: isLxc ? '#0891b2' : '#16a34a'
                              }}
                              title={isLxc ? 'Contenedor LXC' : 'Máquina Virtual KVM'}
                            >
                              {isLxc ? <Container size={16} /> : <Monitor size={16} />}
                            </div>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <strong>{vm.name}</strong>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleToggleVmType(vm)
                                  }}
                                  title="Clic para cambiar entre KVM y LXC"
                                  style={{
                                    border: `1px solid ${isLxc ? '#a5f3fc' : '#bbf7d0'}`,
                                    background: isLxc ? '#ecfeff' : '#f0fdf4',
                                    color: isLxc ? '#0891b2' : '#16a34a',
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px'
                                  }}
                                >
                                  {isLxc ? <Container size={10} /> : <Monitor size={10} />}
                                  {isLxc ? 'LXC' : 'KVM'}
                                </button>
                              </div>
                              <span style={{ fontSize: '11px', color: '#64748b' }}>
                                {isLxc ? 'Contenedor LXC' : 'Máquina Virtual QEMU/KVM'}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td>
                          {vm.role ? (
                            <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                              {vm.role}
                            </span>
                          ) : (
                            <span className="muted-cell">—</span>
                          )}
                        </td>

                        <td>
                          {assignedIp ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                              <div>
                                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a', fontSize: '12px' }}>
                                  {assignedIp.address}
                                </span>
                                {assignedIp.reverse_dns && (
                                  <div style={{ fontSize: '10px', color: '#2563eb', fontFamily: 'monospace' }}>
                                    {assignedIp.reverse_dns}
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                className="icon-button"
                                style={{ width: '22px', height: '22px', color: '#94a3b8' }}
                                title="Desasociar IP de este VPS"
                                onClick={() => handleQuickAssignIp(assignedIp.id, null)}
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ) : ips.length === 0 ? (
                            <button
                              type="button"
                              className="button small outline"
                              style={{ height: '28px', fontSize: '11px', padding: '0 8px', color: '#2563eb', borderColor: '#bfdbfe', background: '#eff6ff', whiteSpace: 'nowrap' }}
                              title="Cargar IP failover en este servidor para asignarla a este VPS"
                              onClick={() => {
                                setNewIpAssignedVm(vm.id)
                                setShowAddIp(true)
                                setActiveTab('ips')
                              }}
                            >
                              + Cargar IP failover
                            </button>
                          ) : (
                            <select
                              className="input"
                              style={{ height: '28px', fontSize: '11px', padding: '0 6px', maxWidth: '175px', color: '#2563eb', borderColor: '#bfdbfe', background: '#eff6ff' }}
                              value=""
                              onChange={e => {
                                if (e.target.value === '__NEW__') {
                                  setNewIpAssignedVm(vm.id)
                                  setShowAddIp(true)
                                  setActiveTab('ips')
                                } else if (e.target.value) {
                                  handleQuickAssignIp(e.target.value, vm.id)
                                }
                              }}
                            >
                              <option value="" disabled>+ Asociar IP failover…</option>
                              {ips
                                .filter(ip => !ip.assigned_vps_id || ip.assigned_vps_id === vm.id)
                                .map(ip => (
                                  <option key={ip.id} value={ip.id}>
                                    {ip.address} {ip.reverse_dns ? `(${ip.reverse_dns})` : ''}
                                  </option>
                                ))}
                              <option value="__NEW__">➕ Cargar nueva IP failover…</option>
                            </select>
                          )}
                        </td>

                        <td>
                          <span style={{ fontSize: '12px', color: '#475569' }}>
                            {vm.operating_system || '—'}
                          </span>
                        </td>

                        <td>
                          <div style={{ fontSize: '11px', color: '#334155', display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <span>{vm.cpu || '2 vCPU'}</span>
                            <span>·</span>
                            <span>{vm.ram_gb ? `${vm.ram_gb} GB` : '—'}</span>
                            <span>·</span>
                            <span>{vm.storage_gb ? `${vm.storage_gb} GB` : '—'}</span>
                          </div>
                        </td>

                        <td>
                          <span className={`status-pill ${vm.status}`}>
                            {statusNames[vm.status] || vm.status}
                          </span>
                        </td>

                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '4px' }}>
                            <button
                              type="button"
                              className="icon-button"
                              title="Ver ficha del VPS"
                              onClick={() => navigate(`/servers/${vm.id}`)}
                            >
                              <ChevronRight size={16} />
                            </button>
                            {vmConsoleUrl && (
                              <a
                                href={vmConsoleUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="icon-button"
                                title="Abrir consola en Proxmox"
                              >
                                <ExternalLink size={14} />
                              </a>
                            )}
                            <button
                              type="button"
                              className="icon-button danger-hover"
                              title="Eliminar VPS"
                              onClick={async () => {
                                if (window.confirm(`¿Eliminar el VPS ${vm.name}?`)) {
                                  await supabase!.from('servers').delete().eq('id', vm.id).eq('workspace_id', workspaceId)
                                  await loadVms()
                                  await loadIps()
                                }
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="table-footer" style={{ marginTop: '14px' }}>
            <span>Mostrando {filteredVms.length} de {vms.length} VPS en este nodo</span>
            <span>Virtualización Proxmox VE</span>
          </div>
        </section>
      )}

      {/* TAB 2: IPS & REVERSE DNS */}
      {activeTab === 'ips' && (
        <section className="inpage-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#f1f5f9', display: 'grid', placeItems: 'center', color: '#475569' }}>
                <Layers size={18} />
              </div>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: '#1e293b' }}>
                  Direcciones IP y Reverse DNS
                </h2>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  {ips.length} {ips.length === 1 ? 'dirección IPv4 registrada' : 'direcciones IPv4 registradas'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div className="search-box" style={{ width: '220px' }}>
                <Search size={15} />
                <input
                  className="input"
                  value={ipQuery}
                  onChange={e => setIpQuery(e.target.value)}
                  placeholder="Filtrar IPs o PTR…"
                  style={{ height: '34px', fontSize: '12px' }}
                />
              </div>
              <button
                type="button"
                className="button primary"
                style={{ height: '34px', fontSize: '12px' }}
                onClick={() => setShowAddIp(!showAddIp)}
              >
                <Plus size={15} />
                {showAddIp ? 'Ocultar formulario' : 'Asociar nueva IP'}
              </button>
            </div>
          </div>

          {/* Quick associate failover IP from host (for child VPS) */}
          {isChildVps && parentIps.length > 0 && (
            <div
              className="inpage-subform"
              style={{
                marginBottom: '18px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                flexWrap: 'wrap'
              }}
            >
              <div>
                <strong style={{ fontSize: '13px', color: '#1e293b', display: 'block' }}>
                  Asociar IP failover desde el Host Proxmox ({server?.parent_server?.name || 'Hipervisor'})
                </strong>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Elegí una IP pública o failover disponible en el Proxmox físico para asociarla a este VPS.
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  className="input"
                  style={{ height: '34px', fontSize: '12px', minWidth: '220px' }}
                  onChange={e => {
                    if (e.target.value) handleQuickAssignIp(e.target.value, serverId || null)
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>Seleccionar IP failover del Host…</option>
                  {parentIps
                    .filter(p => !p.assigned_vps_id || p.assigned_vps_id === serverId)
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.address} {p.reverse_dns ? `(${p.reverse_dns})` : ''} {p.assigned_vps_id === serverId ? '✓ Ya asignada' : ''}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          )}

          {/* IN-PAGE ADD IP PANEL (NO MODAL) */}
          {showAddIp && (
            <form className="inpage-subform" onSubmit={handleAddIp} style={{ marginBottom: '22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: '#1e293b' }}>
                  Asignar nueva dirección IP al servidor
                </h3>
                <button type="button" className="icon-button" onClick={() => setShowAddIp(false)}>
                  <X size={17} />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Dirección IP o Bloque *
                  </label>
                  <input
                    className="input"
                    required
                    placeholder="ej. 198.50.231.236 o 66.70.129.32/29"
                    value={newIpAddress}
                    onChange={e => setNewIpAddress(e.target.value)}
                    onBlur={e => triggerDohLookup(e.target.value)}
                  />
                  {newIpAddress.includes('/') && expandCidrIpv4(newIpAddress).length > 1 && (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: '#2563eb', background: '#eff6ff', padding: '6px 8px', borderRadius: '4px', border: '1px solid #bfdbfe' }}>
                      💡 Bloque CIDR detectado ({expandCidrIpv4(newIpAddress).length} IPs).
                      <button
                        type="button"
                        style={{ marginLeft: '6px', background: 'none', border: 'none', textDecoration: 'underline', color: '#1d4ed8', cursor: 'pointer', fontWeight: 600 }}
                        onClick={async () => {
                          const expanded = expandCidrIpv4(newIpAddress)
                          setSavingIp(true)
                          const hostServerId = isChildVps && server?.parent_id ? server.parent_id : serverId
                          for (let i = 0; i < expanded.length; i++) {
                            const ipStr = expanded[i]
                            const rdnsStr = await lookupReverseDns(ipStr)
                            await supabase!.from('ip_addresses').insert({
                              workspace_id: workspaceId,
                              server_id: hostServerId,
                              assigned_vps_id: i === 0 ? (newIpAssignedVm || null) : null,
                              address: ipStr,
                              ip_type: newIpType,
                              purpose: rdnsStr || null,
                              reverse_dns: rdnsStr || null
                            })
                          }
                          setSavingIp(false)
                          setShowAddIp(false)
                          setNotice(`Se desglosaron y crearon ${expanded.length} IPs individuales para este nodo.`)
                          await loadIps()
                          await loadVms()
                        }}
                      >
                        Desglosar en {expandCidrIpv4(newIpAddress).length} IPs utilizables
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Tipo de IP
                  </label>
                  <select
                    className="input"
                    value={newIpType}
                    onChange={e => setNewIpType(e.target.value as 'public' | 'private')}
                  >
                    <option value="public">Pública (Failover / Primaria)</option>
                    <option value="private">Privada / LAN</option>
                  </select>
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>
                      Reverse DNS (PTR)
                    </label>
                    <button
                      type="button"
                      onClick={() => triggerDohLookup(newIpAddress)}
                      disabled={resolvingDns || !newIpAddress.trim()}
                      style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
                    >
                      <RefreshCw size={10} className={resolvingDns ? 'spinner' : ''} />
                      {resolvingDns ? 'Resolviendo…' : '🔍 Resolver PTR'}
                    </button>
                  </div>
                  <input
                    className="input"
                    placeholder="ej. mate.altomarketing.net"
                    value={newIpRdns}
                    onChange={e => setNewIpRdns(e.target.value)}
                  />
                </div>

                {!isChildVps && vms.length > 0 && (
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                      Asignar a VPS (Proxmox)
                    </label>
                    <select
                      className="input"
                      value={newIpAssignedVm}
                      onChange={e => setNewIpAssignedVm(e.target.value)}
                    >
                      <option value="">Libre / Host Proxmox</option>
                      {vms.map(v => (
                        <option key={v.id} value={v.id}>
                          VM {v.vm_id}: {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Etiqueta / Bloque failover
                  </label>
                  <input
                    className="input"
                    placeholder="ej. Failover /29"
                    value={newIpLabel}
                    onChange={e => setNewIpLabel(e.target.value)}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Costo mensual ($)
                  </label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={newIpCost}
                    onChange={e => setNewIpCost(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="button secondary" onClick={() => setShowAddIp(false)}>
                  Cancelar
                </button>
                <button type="submit" className="button primary" disabled={savingIp}>
                  {savingIp ? 'Guardando…' : 'Asociar IP'}
                </button>
              </div>
            </form>
          )}

          {/* IPs Table */}
          {loadingIps ? (
            <div className="table-empty">Cargando direcciones IP…</div>
          ) : filteredIps.length === 0 ? (
            <div className="table-empty" style={{ padding: '32px' }}>
              <Layers size={22} style={{ color: '#94a3b8', marginBottom: '8px' }} />
              <strong>{ips.length === 0 ? 'Sin IPs asociadas a este servidor' : 'No hay IPs coincidentes con la búsqueda'}</strong>
              <span>{ips.length === 0 ? 'Hacé clic en “Asociar nueva IP” para registrar una IP pública o failover.' : 'Probá con otra dirección o término.'}</span>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Dirección IP</th>
                    <th>Tipo</th>
                    <th>Reverse DNS (PTR)</th>
                    {!isChildVps && <th>Asignada a VPS</th>}
                    <th>Etiqueta / Subred</th>
                    <th>Costo / Mes</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIps.map(ip => {
                    const isEditingThis = editingIpId === ip.id
                    const ptrHost = ip.reverse_dns || ip.purpose || '—'
                    const assignedVm = vms.find(v => v.id === ip.assigned_vps_id) || ip.assigned_vps

                    return (
                      <tr key={ip.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a', fontSize: '13px' }}>
                              {ip.address}
                            </span>
                            <button
                              type="button"
                              className="icon-button"
                              style={{ width: '22px', height: '22px' }}
                              title="Copiar IP"
                              onClick={() => copyToClipboard(ip.address)}
                            >
                              {copiedIp === ip.address ? <Check size={13} style={{ color: '#16a34a' }} /> : <Copy size={13} />}
                            </button>
                          </div>
                        </td>

                        <td>
                          <span className={`type-chip ${ip.ip_type === 'public' ? 'blue' : ''}`}>
                            {ip.ip_type === 'public' ? 'Pública' : 'Privada'}
                          </span>
                        </td>

                        <td>
                          {isEditingThis ? (
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              <input
                                className="input"
                                style={{ height: '30px', fontSize: '11px', minWidth: '180px' }}
                                value={editRdnsValue}
                                onChange={e => setEditRdnsValue(e.target.value)}
                                placeholder="Hostname PTR"
                              />
                              <button
                                type="button"
                                className="icon-button"
                                style={{ width: '28px', height: '28px' }}
                                title="Resolver DoH"
                                onClick={async () => {
                                  const h = await lookupReverseDns(ip.address)
                                  if (h) setEditRdnsValue(h)
                                }}
                              >
                                <RefreshCw size={13} />
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontFamily: 'monospace', fontSize: '12px', color: ptrHost !== '—' ? '#2563eb' : '#94a3b8' }}>
                              {ptrHost}
                            </span>
                          )}
                        </td>

                        {!isChildVps && (
                          <td>
                            {isEditingThis ? (
                              <select
                                className="input"
                                style={{ height: '30px', fontSize: '11px', minWidth: '140px' }}
                                value={editVmValue}
                                onChange={e => setEditVmValue(e.target.value)}
                              >
                                <option value="">Host Proxmox</option>
                                {vms.map(v => (
                                  <option key={v.id} value={v.id}>
                                    VM {v.vm_id}: {v.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <select
                                  className="input"
                                  style={{
                                    height: '28px',
                                    fontSize: '11px',
                                    minWidth: '160px',
                                    padding: '0 6px',
                                    fontWeight: assignedVm ? 600 : 400,
                                    background: assignedVm ? (assignedVm.vm_type === 'lxc' ? '#ecfeff' : '#f0fdf4') : '#fff',
                                    borderColor: assignedVm ? (assignedVm.vm_type === 'lxc' ? '#a5f3fc' : '#bbf7d0') : '#cbd5e1',
                                    color: assignedVm ? (assignedVm.vm_type === 'lxc' ? '#0891b2' : '#16a34a') : '#64748b'
                                  }}
                                  value={assignedVm ? assignedVm.id : (ip.assigned_vps_id || '')}
                                  onChange={e => handleQuickAssignIp(ip.id, e.target.value || null)}
                                  title="Asignar IP a un VPS"
                                >
                                  <option value="">Host Proxmox (Libre)</option>
                                  {vms.map(v => (
                                    <option key={v.id} value={v.id}>
                                      {v.vm_type === 'lxc' ? '📦 LXC' : '🖥️ KVM'} [{v.vm_id || '?'}] {v.name}
                                    </option>
                                  ))}
                                </select>
                                {assignedVm && (
                                  <Link
                                    to={`/servers/${assignedVm.id}`}
                                    className="icon-button"
                                    style={{ width: '24px', height: '24px' }}
                                    title="Ir a la ficha de este VPS"
                                  >
                                    <ChevronRight size={14} />
                                  </Link>
                                )}
                              </div>
                            )}
                          </td>
                        )}

                        <td>
                          {isEditingThis ? (
                            <input
                              className="input"
                              style={{ height: '30px', fontSize: '11px', width: '130px' }}
                              value={editLabelValue}
                              onChange={e => setEditLabelValue(e.target.value)}
                              placeholder="Etiqueta"
                            />
                          ) : (
                            <span style={{ fontSize: '12px', color: '#64748b' }}>
                              {ip.label || '—'}
                            </span>
                          )}
                        </td>

                        <td>
                          {isEditingThis ? (
                            <input
                              className="input"
                              type="number"
                              step="0.01"
                              min="0"
                              style={{ height: '30px', fontSize: '11px', width: '80px' }}
                              value={editCostValue}
                              onChange={e => setEditCostValue(e.target.value)}
                              placeholder="0.00"
                            />
                          ) : (
                            <span style={{ fontSize: '12px', fontWeight: 600, color: ip.monthly_cost ? '#0f172a' : '#94a3b8' }}>
                              {ip.monthly_cost ? `$${Number(ip.monthly_cost).toFixed(2)}` : '—'}
                            </span>
                          )}
                        </td>

                        <td style={{ textAlign: 'right' }}>
                          {isEditingThis ? (
                            <div style={{ display: 'inline-flex', gap: '4px' }}>
                              <button
                                type="button"
                                className="button primary"
                                style={{ height: '28px', padding: '0 8px', fontSize: '11px' }}
                                onClick={() => handleSaveIpEdit(ip.id)}
                              >
                                Guardar
                              </button>
                              <button
                                type="button"
                                className="button secondary"
                                style={{ height: '28px', padding: '0 8px', fontSize: '11px' }}
                                onClick={() => setEditingIpId(null)}
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'inline-flex', gap: '4px' }}>
                              <button
                                type="button"
                                className="icon-button"
                                title="Editar IP / PTR / Costo / Asignación"
                                onClick={() => {
                                  setEditingIpId(ip.id)
                                  setEditRdnsValue(ip.reverse_dns || ip.purpose || '')
                                  setEditLabelValue(ip.label || '')
                                  setEditCostValue(ip.monthly_cost ? String(ip.monthly_cost) : '')
                                  setEditVmValue(ip.assigned_vps_id || '')
                                }}
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                type="button"
                                className="icon-button danger-hover"
                                title="Eliminar IP"
                                onClick={() => handleDeleteIp(ip.id, ip.address)}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="table-footer" style={{ marginTop: '12px' }}>
            <span>Mostrando {filteredIps.length} de {ips.length} IPs</span>
            <span>Inventario IPv4</span>
          </div>
        </section>
      )}

      {/* TAB 3: DOMAINS POINTING TO THIS SERVER */}
      {domains.length > 0 && activeTab === 'domains' && (
        <section className="inpage-card">
          <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 16px', color: '#1e293b' }}>
            Dominios alojados en este servidor
          </h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Dominio</th>
                  <th>IP Destino</th>
                  <th>Registrador</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {domains.map(d => (
                  <tr key={d.id}>
                    <td>
                      <strong style={{ color: '#0f172a' }}>{d.name}</strong>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace' }}>{d.target_ip || '—'}</span>
                    </td>
                    <td>{d.registrar_provider?.name || '—'}</td>
                    <td>
                      <span className={`status-pill ${d.status}`}>{d.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
