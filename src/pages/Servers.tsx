import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  Check,
  Copy,
  DollarSign,
  Edit2,
  ExternalLink,
  Eye,
  Filter,
  Globe2,
  Layers,
  MapPin,
  Plus,
  Search,
  Server,
  Trash2,
  X
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { lookupReverseDns } from '../lib/dns'
import type { IPAddress, Provider, Server as ServerRecord, ServerStatus, ServerType } from '../types'

type FormState = {
  name: string
  hostname: string
  provider_id: string
  server_type: ServerType
  operating_system: string
  cpu: string
  ram_gb: string
  storage_gb: string
  location: string
  public_ip: string
  private_ip: string
  monthly_cost: string
  status: ServerStatus
  management_url: string
  expires_at: string
  notes: string
}

const emptyForm: FormState = {
  name: '',
  hostname: '',
  provider_id: '',
  server_type: 'vps',
  operating_system: '',
  cpu: '',
  ram_gb: '',
  storage_gb: '',
  location: '',
  public_ip: '',
  private_ip: '',
  monthly_cost: '',
  status: 'active',
  management_url: '',
  expires_at: '',
  notes: ''
}

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

export default function Servers({ workspaceId }: { workspaceId: string }) {
  const [servers, setServers] = useState<ServerRecord[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [serverIpCounts, setServerIpCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  // Edit / Create modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ServerRecord | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)

  // Server Detail (IPs & Reverse DNS) modal state
  const [detailServer, setDetailServer] = useState<ServerRecord | null>(null)
  const [detailIps, setDetailIps] = useState<IPAddress[]>([])
  const [loadingIps, setLoadingIps] = useState(false)
  const [copiedIp, setCopiedIp] = useState<string | null>(null)

  // Add IP inside Detail modal
  const [showAddIp, setShowAddIp] = useState(false)
  const [newIpAddress, setNewIpAddress] = useState('')
  const [newIpType, setNewIpType] = useState<'public' | 'private'>('public')
  const [newIpRdns, setNewIpRdns] = useState('')
  const [newIpLabel, setNewIpLabel] = useState('')
  const [newIpCost, setNewIpCost] = useState('')
  const [savingIp, setSavingIp] = useState(false)

  // Editing single IP inside detail modal
  const [editingIpId, setEditingIpId] = useState<string | null>(null)
  const [editRdnsValue, setEditRdnsValue] = useState('')
  const [editLabelValue, setEditLabelValue] = useState('')
  const [editCostValue, setEditCostValue] = useState('')

  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [serverResult, providerResult, ipCountResult] = await Promise.all([
      supabase!.from('servers').select('*, providers(name)').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
      supabase!.from('providers').select('*').eq('workspace_id', workspaceId).order('name'),
      supabase!.from('ip_addresses').select('server_id, address').eq('workspace_id', workspaceId).not('server_id', 'is', null)
    ])

    if (serverResult.error) {
      setError(serverResult.error.message)
    } else {
      setServers((serverResult.data || []) as ServerRecord[])
    }

    if (!providerResult.error) {
      setProviders(providerResult.data || [])
    }

    if (ipCountResult.data) {
      const counts: Record<string, number> = {}
      for (const row of ipCountResult.data) {
        if (row.server_id && !row.address?.includes(':')) {
          counts[row.server_id] = (counts[row.server_id] || 0) + 1
        }
      }
      setServerIpCounts(counts)
    }

    setLoading(false)
  }, [workspaceId])

  useEffect(() => {
    load()
  }, [load])

  // Load IPs for server detail
  const loadServerIps = useCallback(async (serverId: string) => {
    setLoadingIps(true)
    const { data, error: ipErr } = await supabase!
      .from('ip_addresses')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('server_id', serverId)
      .order('created_at', { ascending: true })

    if (ipErr) {
      setError(ipErr.message)
    } else {
      const onlyIpv4 = ((data || []) as IPAddress[]).filter(ip => !ip.address.includes(':'))
      setDetailIps(onlyIpv4)
    }
    setLoadingIps(false)
  }, [workspaceId])

  function openDetail(server: ServerRecord) {
    setDetailServer(server)
    setShowAddIp(false)
    setEditingIpId(null)
    loadServerIps(server.id)
  }

  function closeDetail() {
    setDetailServer(null)
    setDetailIps([])
    setShowAddIp(false)
    setEditingIpId(null)
  }

  const filtered = useMemo(() => servers.filter(s => {
    const text = `${s.name} ${s.hostname || ''} ${s.location || ''} ${s.operating_system || ''} ${s.providers?.name || ''}`.toLowerCase()
    return text.includes(query.toLowerCase()) && (statusFilter === 'all' || s.status === statusFilter)
  }), [servers, query, statusFilter])

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setModalOpen(true)
  }

  function openEdit(server: ServerRecord) {
    setEditing(server)
    setForm({
      name: server.name,
      hostname: server.hostname || '',
      provider_id: server.provider_id || '',
      server_type: server.server_type,
      operating_system: server.operating_system || '',
      cpu: server.cpu || '',
      ram_gb: server.ram_gb?.toString() || '',
      storage_gb: server.storage_gb?.toString() || '',
      location: server.location || '',
      public_ip: '',
      private_ip: '',
      monthly_cost: server.monthly_cost?.toString() || '',
      status: server.status,
      management_url: server.management_url || '',
      expires_at: server.expires_at || '',
      notes: server.notes || ''
    })
    setError('')
    setModalOpen(true)

    void supabase!
      .from('ip_addresses')
      .select('address,ip_type')
      .eq('workspace_id', workspaceId)
      .eq('server_id', server.id)
      .then(({ data }) => {
        if (!data) return
        setForm(old => ({
          ...old,
          public_ip: data.find(ip => ip.ip_type === 'public')?.address || '',
          private_ip: data.find(ip => ip.ip_type === 'private')?.address || ''
        }))
      })
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(old => ({ ...old, [key]: value }))
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')

    const payload: Record<string, unknown> = {
      workspace_id: workspaceId,
      name: form.name.trim(),
      hostname: form.hostname.trim() || null,
      provider_id: form.provider_id || null,
      server_type: form.server_type,
      operating_system: form.operating_system.trim() || null,
      cpu: form.cpu.trim() || null,
      ram_gb: form.ram_gb ? Number(form.ram_gb) : null,
      storage_gb: form.storage_gb ? Number(form.storage_gb) : null,
      location: form.location.trim() || null,
      status: form.status,
      management_url: form.management_url.trim() || null,
      expires_at: form.expires_at || null,
      notes: form.notes.trim() || null
    }

    if (form.monthly_cost) {
      payload.monthly_cost = Number(form.monthly_cost)
    } else {
      payload.monthly_cost = null
    }

    let serverId = editing?.id

    if (editing) {
      const { error: updateError } = await supabase!
        .from('servers')
        .update(payload)
        .eq('id', editing.id)
        .eq('workspace_id', workspaceId)

      if (updateError) {
        if (updateError.message.includes('monthly_cost')) {
          setError(`Para guardar el costo mensual, ejecuta el script SQL de actualización en Supabase: ${updateError.message}`)
        } else {
          setError(updateError.message)
        }
        setSaving(false)
        return
      }
    } else {
      const { data, error: insertError } = await supabase!
        .from('servers')
        .insert(payload)
        .select('id')
        .single()

      if (insertError) {
        if (insertError.message.includes('monthly_cost')) {
          setError(`Para guardar el costo mensual, ejecuta el script SQL de actualización en Supabase: ${insertError.message}`)
        } else {
          setError(insertError.message)
        }
        setSaving(false)
        return
      }
      serverId = data.id

      // For new server, register public/private IP if filled
      const ipRows: { workspace_id: string; server_id: string; address: string; ip_type: 'public' | 'private'; label: string }[] = []
      if (form.public_ip.trim()) {
        ipRows.push({ workspace_id: workspaceId, server_id: serverId!, address: form.public_ip.trim(), ip_type: 'public', label: 'IP pública principal' })
      }
      if (form.private_ip.trim()) {
        ipRows.push({ workspace_id: workspaceId, server_id: serverId!, address: form.private_ip.trim(), ip_type: 'private', label: 'IP privada' })
      }
      if (ipRows.length) {
        await supabase!.from('ip_addresses').insert(ipRows)
      }
    }

    setModalOpen(false)
    setNotice(editing ? 'Servidor actualizado correctamente.' : 'Servidor registrado correctamente.')
    setSaving(false)
    await load()

    if (detailServer && editing && detailServer.id === editing.id) {
      const updatedSrv = servers.find(s => s.id === editing.id)
      if (updatedSrv) setDetailServer(updatedSrv)
    }
  }

  async function remove(server: ServerRecord) {
    if (!window.confirm(`¿Eliminar el servidor “${server.name}”? Sus IPs asociadas también se eliminarán.`)) return
    const { error: deleteError } = await supabase!.from('servers').delete().eq('id', server.id).eq('workspace_id', workspaceId)
    if (deleteError) {
      setError(deleteError.message)
    } else {
      setNotice('Servidor eliminado.')
      if (detailServer?.id === server.id) closeDetail()
      await load()
    }
  }

  // Add individual IP to detail server
  async function handleAddIp(e: FormEvent) {
    e.preventDefault()
    if (!detailServer || !newIpAddress.trim()) return

    setSavingIp(true)
    setError('')

    let rdns = newIpRdns.trim()
    if (!rdns && newIpAddress.trim()) {
      const autoHost = await lookupReverseDns(newIpAddress.trim())
      if (autoHost) rdns = autoHost
    }

    const ipPayload: Record<string, unknown> = {
      workspace_id: workspaceId,
      server_id: detailServer.id,
      address: newIpAddress.trim(),
      ip_type: newIpType,
      label: newIpLabel.trim() || null,
      purpose: rdns || null
    }

    if (newIpCost.trim()) {
      ipPayload.monthly_cost = Number(newIpCost)
    }

    const { error: ipInsertErr } = await supabase!.from('ip_addresses').insert(ipPayload)

    if (ipInsertErr) {
      setError(`Error al registrar IP: ${ipInsertErr.message}`)
    } else {
      setNewIpAddress('')
      setNewIpRdns('')
      setNewIpLabel('')
      setNewIpCost('')
      setShowAddIp(false)
      await loadServerIps(detailServer.id)
      await load()
    }
    setSavingIp(false)
  }

  // Delete IP
  async function handleDeleteIp(ipId: string, addr: string) {
    if (!window.confirm(`¿Eliminar la IP ${addr} de este servidor?`)) return
    const { error: delErr } = await supabase!.from('ip_addresses').delete().eq('id', ipId).eq('workspace_id', workspaceId)
    if (delErr) {
      setError(delErr.message)
    } else {
      if (detailServer) await loadServerIps(detailServer.id)
      await load()
    }
  }

  // Save edited Reverse DNS / label / cost on single IP
  async function handleSaveIpEdit(ipId: string) {
    const patchData: Record<string, unknown> = {
      purpose: editRdnsValue.trim() || null,
      label: editLabelValue.trim() || null
    }
    if (editCostValue.trim()) {
      patchData.monthly_cost = Number(editCostValue)
    } else {
      patchData.monthly_cost = null
    }

    const { error: patchErr } = await supabase!
      .from('ip_addresses')
      .update(patchData)
      .eq('id', ipId)
      .eq('workspace_id', workspaceId)

    if (patchErr) {
      setError(patchErr.message)
    } else {
      setEditingIpId(null)
      if (detailServer) await loadServerIps(detailServer.id)
    }
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text)
    setCopiedIp(text)
    setTimeout(() => setCopiedIp(null), 2000)
  }

  const totalServerCost = useMemo(() => {
    return servers.reduce((acc, s) => acc + (s.monthly_cost || 0), 0)
  }, [servers])

  const detailTotalCost = useMemo(() => {
    if (!detailServer) return 0
    const sCost = detailServer.monthly_cost || 0
    const ipCost = detailIps.reduce((acc, ip) => acc + (ip.monthly_cost || 0), 0)
    return sCost + ipCost
  }, [detailServer, detailIps])

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <div className="eyebrow">INVENTARIO</div>
          <h1>Servidores</h1>
          <p>Administrá tus VPS, servidores dedicados, IPs asociadas y costos mensuales.</p>
        </div>
        <button className="button primary" onClick={openNew}>
          <Plus size={17} /> Agregar servidor
        </button>
      </div>

      <div className="server-summary">
        <div>
          <span className="summary-icon">
            <Server size={18} />
          </span>
          <div>
            <strong>{servers.length}</strong>
            <span>Servidores registrados</span>
          </div>
        </div>
        <div>
          <span className="summary-icon green">
            <Activity size={18} />
          </span>
          <div>
            <strong>{servers.filter(s => s.status === 'active').length}</strong>
            <span>Activos</span>
          </div>
        </div>
        <div>
          <span className="summary-icon orange">
            <DollarSign size={18} />
          </span>
          <div>
            <strong>${totalServerCost.toFixed(2)}</strong>
            <span>Costo mensual servidores</span>
          </div>
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

      {error && !modalOpen && !detailServer && <div className="alert error">{error}</div>}

      <section className="panel table-panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar por nombre, hostname, ubicación…"
            />
          </div>
          <div className="filter-wrap">
            <Filter size={16} />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">Todos los estados</option>
              <option value="active">Activo</option>
              <option value="maintenance">Mantenimiento</option>
              <option value="inactive">Inactivo</option>
              <option value="decommissioned">Baja</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="table-empty">Cargando inventario…</div>
        ) : filtered.length === 0 ? (
          <div className="table-empty">
            <div className="empty-icon">
              <Server size={22} />
            </div>
            <strong>{servers.length ? 'No hay resultados' : 'Todavía no registraste servidores'}</strong>
            <span>{servers.length ? 'Probá cambiar la búsqueda o el filtro.' : 'Agregá tu primer servidor para comenzar.'}</span>
            {!servers.length && (
              <button className="button secondary" onClick={openNew}>
                <Plus size={16} /> Agregar primer servidor
              </button>
            )}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Servidor</th>
                  <th>IPs</th>
                  <th>Proveedor</th>
                  <th>Tipo</th>
                  <th>Costo / Mes</th>
                  <th>Ubicación</th>
                  <th>Estado</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(server => {
                  const ipCount = serverIpCounts[server.id] || 0
                  return (
                    <tr key={server.id}>
                      <td>
                        <div
                          className="server-cell clickable"
                          onClick={() => openDetail(server)}
                          title="Clic para ver IPs, Reverse DNS y Costos"
                        >
                          <div className="server-table-icon">
                            <Server size={17} />
                          </div>
                          <div>
                            <strong>{server.name}</strong>
                            <span>{server.hostname || 'Sin hostname'}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ip-badge"
                          onClick={() => openDetail(server)}
                          title="Ver detalle de IPs"
                        >
                          <Globe2 size={12} />
                          {ipCount} {ipCount === 1 ? 'IP' : 'IPs'}
                        </button>
                      </td>
                      <td>{server.providers?.name || <span className="muted-cell">Sin proveedor</span>}</td>
                      <td>
                        <span className="type-chip">{typeNames[server.server_type] || server.server_type}</span>
                      </td>
                      <td>
                        {server.monthly_cost ? (
                          <strong style={{ color: '#1e293b' }}>${Number(server.monthly_cost).toFixed(2)}</strong>
                        ) : (
                          <span className="muted-cell">—</span>
                        )}
                      </td>
                      <td>
                        {server.location ? (
                          <span className="location-cell">
                            <MapPin size={14} />
                            {server.location}
                          </span>
                        ) : (
                          <span className="muted-cell">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`status-pill ${server.status}`}>{statusNames[server.status] || server.status}</span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="icon-button"
                            title="Ver detalles e IPs"
                            onClick={() => openDetail(server)}
                          >
                            <Eye size={15} />
                          </button>
                          <button className="icon-button" title="Editar" onClick={() => openEdit(server)}>
                            <Edit2 size={15} />
                          </button>
                          {server.management_url && (
                            <a
                              className="icon-button"
                              href={server.management_url}
                              target="_blank"
                              rel="noreferrer"
                              title="Abrir panel"
                            >
                              <ExternalLink size={15} />
                            </a>
                          )}
                          <button
                            className="icon-button danger-hover"
                            title="Eliminar"
                            onClick={() => remove(server)}
                          >
                            <Trash2 size={15} />
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

        <div className="table-footer">
          <span>
            Mostrando {filtered.length} de {servers.length} servidores
          </span>
          <span>Inventario manual</span>
        </div>
      </section>

      {/* MODAL DETALLE DE SERVIDOR (IPS, REVERSE DNS & COSTOS) */}
      {detailServer && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closeDetail() }}>
          <div className="modal-card detail-modal">
            <div className="detail-header">
              <div className="detail-header-main">
                <div className="detail-icon">
                  <Server size={24} />
                </div>
                <div className="detail-titles">
                  <h2>{detailServer.name}</h2>
                  <div className="detail-hostname">
                    <Globe2 size={13} />
                    <span>{detailServer.hostname || 'Sin hostname configurado'}</span>
                  </div>
                  <div className="detail-badges">
                    <span className={`status-pill ${detailServer.status}`}>
                      {statusNames[detailServer.status] || detailServer.status}
                    </span>
                    <span className="type-chip">{typeNames[detailServer.server_type] || detailServer.server_type}</span>
                    {detailServer.providers?.name && (
                      <span className="type-chip">{detailServer.providers.name}</span>
                    )}
                    {detailServer.location && (
                      <span className="location-cell" style={{ fontSize: '10px' }}>
                        <MapPin size={13} />
                        {detailServer.location}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button type="button" className="icon-button" onClick={closeDetail} title="Cerrar">
                <X size={20} />
              </button>
            </div>

            {/* Quick specs & Cost Summary */}
            <div className="specs-panel">
              <div className="spec-item">
                <span>Costo del Servidor</span>
                <strong style={{ color: '#2563eb' }}>
                  ${(detailServer.monthly_cost || 0).toFixed(2)} / mes
                </strong>
              </div>
              <div className="spec-item">
                <span>Costo Total (Inc. IPs)</span>
                <strong style={{ color: '#16a34a' }}>
                  ${detailTotalCost.toFixed(2)} / mes
                </strong>
              </div>
              <div className="spec-item">
                <span>Sistema Operativo</span>
                <strong>{detailServer.operating_system || 'No especificado'}</strong>
              </div>
              <div className="spec-item">
                <span>CPU</span>
                <strong>{detailServer.cpu || 'No especificado'}</strong>
              </div>
              <div className="spec-item">
                <span>Memoria RAM</span>
                <strong>{detailServer.ram_gb ? `${detailServer.ram_gb} GB` : '—'}</strong>
              </div>
              <div className="spec-item">
                <span>Almacenamiento</span>
                <strong>{detailServer.storage_gb ? `${detailServer.storage_gb} GB` : '—'}</strong>
              </div>
              {detailServer.notes && (
                <div className="spec-item" style={{ gridColumn: '1 / -1' }}>
                  <span>Notas del equipo</span>
                  <strong style={{ fontWeight: 400, color: '#64748b' }}>{detailServer.notes}</strong>
                </div>
              )}
            </div>

            {/* IP Addresses & Reverse DNS Section */}
            <div className="ips-section">
              <div className="ips-header">
                <h3>
                  <Layers size={17} />
                  Direcciones IP, Reverse DNS y Costos
                  <span className="ip-badge">{detailIps.length}</span>
                </h3>
                <button
                  type="button"
                  className="button secondary"
                  style={{ height: '32px', fontSize: '10px' }}
                  onClick={() => setShowAddIp(!showAddIp)}
                >
                  <Plus size={14} />
                  {showAddIp ? 'Ocultar formulario' : 'Asociar nueva IP'}
                </button>
              </div>

              {/* Form to add IP */}
              {showAddIp && (
                <form className="ip-add-box" onSubmit={handleAddIp}>
                  <h4>Asignar nueva dirección IP o Bloque</h4>
                  <div className="ip-add-grid" style={{ gridTemplateColumns: '1.2fr 0.8fr 1.5fr 1fr 0.8fr auto' }}>
                    <div>
                      <label>Dirección IP o Bloque *</label>
                      <input
                        className="input"
                        placeholder="Ej. 198.50.231.236"
                        value={newIpAddress}
                        onChange={e => setNewIpAddress(e.target.value)}
                        onBlur={async () => {
                          if (!newIpRdns.trim() && newIpAddress.trim()) {
                            const h = await lookupReverseDns(newIpAddress)
                            if (h) setNewIpRdns(h)
                          }
                        }}
                        required
                        autoFocus
                      />
                    </div>
                    <div>
                      <label>Tipo</label>
                      <select
                        className="input"
                        value={newIpType}
                        onChange={e => setNewIpType(e.target.value as 'public' | 'private')}
                      >
                        <option value="public">Pública</option>
                        <option value="private">Privada</option>
                      </select>
                    </div>
                    <div>
                      <label>Reverse DNS (PTR)</label>
                      <input
                        className="input"
                        placeholder="server01.midominio.com"
                        value={newIpRdns}
                        onChange={e => setNewIpRdns(e.target.value)}
                      />
                    </div>
                    <div>
                      <label>Etiqueta / Uso</label>
                      <input
                        className="input"
                        placeholder="Failover, CWP..."
                        value={newIpLabel}
                        onChange={e => setNewIpLabel(e.target.value)}
                      />
                    </div>
                    <div>
                      <label>Costo $/mes</label>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="3.00"
                        value={newIpCost}
                        onChange={e => setNewIpCost(e.target.value)}
                      />
                    </div>
                    <div>
                      <button className="button primary" style={{ height: '34px' }} disabled={savingIp}>
                        {savingIp ? 'Guardando…' : 'Guardar'}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* IPs Table */}
              <div className="ips-table-wrap">
                {loadingIps ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>
                    Cargando direcciones IP…
                  </div>
                ) : detailIps.length === 0 ? (
                  <div style={{ padding: '28px', textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>
                    Este servidor no tiene direcciones IP asociadas todavía.
                  </div>
                ) : (
                  <table className="ips-table">
                    <thead>
                      <tr>
                        <th>Dirección IP</th>
                        <th>Tipo</th>
                        <th>Reverse DNS (PTR)</th>
                        <th>Etiqueta / Uso</th>
                        <th>Costo/mes</th>
                        <th style={{ textAlign: 'right' }}>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailIps.map(ip => {
                        const isEditingThis = editingIpId === ip.id
                        return (
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
                                  {copiedIp === ip.address ? <Check size={12} /> : <Copy size={12} />}
                                </button>
                              </div>
                            </td>
                            <td>
                              <span className="type-chip">
                                {ip.ip_type === 'public' ? 'Pública' : 'Privada'}
                              </span>
                            </td>
                            <td>
                              {isEditingThis ? (
                                <input
                                  className="input"
                                  style={{ height: '28px', fontSize: '10px' }}
                                  value={editRdnsValue}
                                  onChange={e => setEditRdnsValue(e.target.value)}
                                  placeholder="Reverse DNS..."
                                />
                              ) : ip.purpose ? (
                                <span className="rdns-tag">
                                  <Globe2 size={11} />
                                  {ip.purpose}
                                </span>
                              ) : (
                                <span className="rdns-tag empty">Sin reverse DNS</span>
                              )}
                            </td>
                            <td>
                              {isEditingThis ? (
                                <input
                                  className="input"
                                  style={{ height: '28px', fontSize: '10px' }}
                                  value={editLabelValue}
                                  onChange={e => setEditLabelValue(e.target.value)}
                                  placeholder="Etiqueta..."
                                />
                              ) : (
                                <span style={{ color: '#64748b' }}>{ip.label || '—'}</span>
                              )}
                            </td>
                            <td>
                              {isEditingThis ? (
                                <input
                                  className="input"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  style={{ height: '28px', width: '70px', fontSize: '10px' }}
                                  value={editCostValue}
                                  onChange={e => setEditCostValue(e.target.value)}
                                  placeholder="$0.00"
                                />
                              ) : ip.monthly_cost ? (
                                <span style={{ fontWeight: 600, color: '#16a34a' }}>
                                  ${Number(ip.monthly_cost).toFixed(2)}
                                </span>
                              ) : (
                                <span className="muted-cell">—</span>
                              )}
                            </td>
                            <td>
                              <div className="ip-actions">
                                {isEditingThis ? (
                                  <>
                                    <button
                                      type="button"
                                      className="button primary"
                                      style={{ height: '26px', padding: '0 8px', fontSize: '9px' }}
                                      onClick={() => handleSaveIpEdit(ip.id)}
                                    >
                                      Guardar
                                    </button>
                                    <button
                                      type="button"
                                      className="button secondary"
                                      style={{ height: '26px', padding: '0 8px', fontSize: '9px' }}
                                      onClick={() => setEditingIpId(null)}
                                    >
                                      Cancelar
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className="icon-button"
                                      title="Editar Reverse DNS, Etiqueta y Costo"
                                      onClick={() => {
                                        setEditingIpId(ip.id)
                                        setEditRdnsValue(ip.purpose || '')
                                        setEditLabelValue(ip.label || '')
                                        setEditCostValue(ip.monthly_cost?.toString() || '')
                                      }}
                                    >
                                      <Edit2 size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      className="icon-button danger-hover"
                                      title="Eliminar IP"
                                      onClick={() => handleDeleteIp(ip.id, ip.address)}
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Modal footer */}
            <div className="modal-actions" style={{ marginTop: '24px' }}>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  closeDetail()
                  openEdit(detailServer)
                }}
              >
                <Edit2 size={14} /> Editar servidor
              </button>
              {detailServer.management_url && (
                <a
                  className="button secondary"
                  href={detailServer.management_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} /> Abrir panel de control
                </a>
              )}
              <button type="button" className="button primary" onClick={closeDetail}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CREAR / EDITAR SERVIDOR */}
      {modalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setModalOpen(false)
          }}
        >
          <form className="modal-card" onSubmit={save}>
            <div className="modal-heading">
              <div>
                <div className="eyebrow">INVENTARIO</div>
                <h2>{editing ? 'Editar servidor' : 'Nuevo servidor'}</h2>
                <p>Completá los datos principales del equipo y su costo mensual.</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setModalOpen(false)}>
                <X size={19} />
              </button>
            </div>

            <div className="form-grid">
              <div className="form-field full">
                <label>Nombre del servidor *</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={e => update('name', e.target.value)}
                  placeholder="Ej. 576680.jul25.DOCKERS"
                  required
                  autoFocus
                />
              </div>
              <div className="form-field">
                <label>Hostname</label>
                <input
                  className="input"
                  value={form.hostname}
                  onChange={e => update('hostname', e.target.value)}
                  placeholder="ns576680.ip-51-222-104.net"
                />
              </div>
              <div className="form-field">
                <label>Proveedor</label>
                <select
                  className="input"
                  value={form.provider_id}
                  onChange={e => update('provider_id', e.target.value)}
                >
                  <option value="">Sin proveedor</option>
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>Tipo de servidor</label>
                <select
                  className="input"
                  value={form.server_type}
                  onChange={e => update('server_type', e.target.value as ServerType)}
                >
                  {Object.entries(typeNames).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>Costo mensual ($)</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monthly_cost}
                  onChange={e => update('monthly_cost', e.target.value)}
                  placeholder="Ej. 49.99"
                />
              </div>
              <div className="form-field">
                <label>Sistema operativo</label>
                <input
                  className="input"
                  value={form.operating_system}
                  onChange={e => update('operating_system', e.target.value)}
                  placeholder="Ubuntu 24.04 LTS / Proxmox"
                />
              </div>
              <div className="form-field">
                <label>CPU</label>
                <input
                  className="input"
                  value={form.cpu}
                  onChange={e => update('cpu', e.target.value)}
                  placeholder="AMD Epyc / Intel Xeon"
                />
              </div>
              <div className="form-field">
                <label>RAM (GB)</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.25"
                  value={form.ram_gb}
                  onChange={e => update('ram_gb', e.target.value)}
                  placeholder="64"
                />
              </div>
              <div className="form-field">
                <label>Almacenamiento (GB)</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  value={form.storage_gb}
                  onChange={e => update('storage_gb', e.target.value)}
                  placeholder="2000"
                />
              </div>
              <div className="form-field">
                <label>Ubicación</label>
                <input
                  className="input"
                  value={form.location}
                  onChange={e => update('location', e.target.value)}
                  placeholder="Canadá (OVHcloud BHS)"
                />
              </div>
              {!editing && (
                <>
                  <div className="form-field">
                    <label>IP pública principal</label>
                    <input
                      className="input"
                      value={form.public_ip}
                      onChange={e => update('public_ip', e.target.value)}
                      placeholder="51.222.104.167"
                    />
                  </div>
                  <div className="form-field">
                    <label>IP privada</label>
                    <input
                      className="input"
                      value={form.private_ip}
                      onChange={e => update('private_ip', e.target.value)}
                      placeholder="10.0.0.10"
                    />
                  </div>
                </>
              )}
              <div className="form-field">
                <label>Estado</label>
                <select
                  className="input"
                  value={form.status}
                  onChange={e => update('status', e.target.value as ServerStatus)}
                >
                  {Object.entries(statusNames).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>URL de administración</label>
                <input
                  className="input"
                  type="url"
                  value={form.management_url}
                  onChange={e => update('management_url', e.target.value)}
                  placeholder="https://ca.ovh.com/manager/"
                />
              </div>
              <div className="form-field">
                <label>Vencimiento</label>
                <input
                  className="input"
                  type="date"
                  value={form.expires_at}
                  onChange={e => update('expires_at', e.target.value)}
                />
              </div>
              <div className="form-field full">
                <label>Notas</label>
                <textarea
                  className="input textarea"
                  rows={3}
                  value={form.notes}
                  onChange={e => update('notes', e.target.value)}
                  placeholder="Información adicional del servidor…"
                />
              </div>
            </div>

            {error && <div className="alert error">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setModalOpen(false)}>
                Cancelar
              </button>
              <button className="button primary" disabled={saving}>
                {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Registrar servidor'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
