import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  Copy,
  Edit2,
  ExternalLink,
  Globe2,
  Layers,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  X
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { lookupReverseDns } from '../lib/dns'
import { useSetBreadcrumbs } from '../lib/breadcrumbs'
import type { IPAddress, Server as ServerRecord } from '../types'

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

export default function ServerDetail({ workspaceId }: { workspaceId: string }) {
  const { serverId } = useParams<{ serverId: string }>()
  const navigate = useNavigate()

  const [server, setServer] = useState<ServerRecord | null>(null)
  const [ips, setIps] = useState<IPAddress[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingIps, setLoadingIps] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copiedIp, setCopiedIp] = useState<string | null>(null)

  // In-page Add IP form state (NO MODAL)
  const [showAddIp, setShowAddIp] = useState(false)
  const [newIpAddress, setNewIpAddress] = useState('')
  const [newIpType, setNewIpType] = useState<'public' | 'private'>('public')
  const [newIpRdns, setNewIpRdns] = useState('')
  const [newIpLabel, setNewIpLabel] = useState('')
  const [newIpCost, setNewIpCost] = useState('')
  const [savingIp, setSavingIp] = useState(false)
  const [resolvingDns, setResolvingDns] = useState(false)

  // Inline edit state for single IP
  const [editingIpId, setEditingIpId] = useState<string | null>(null)
  const [editRdnsValue, setEditRdnsValue] = useState('')
  const [editLabelValue, setEditLabelValue] = useState('')
  const [editCostValue, setEditCostValue] = useState('')

  // Filter IPs inside server
  const [ipQuery, setIpQuery] = useState('')

  // Set breadcrumbs dynamically
  useSetBreadcrumbs(
    server
      ? [
          { label: 'Servidores', to: '/servers' },
          { label: server.name }
        ]
      : [
          { label: 'Servidores', to: '/servers' },
          { label: 'Cargando…' }
        ]
  )

  const loadServer = useCallback(async () => {
    if (!serverId) return
    setLoading(true)
    setError('')

    const { data, error: srvErr } = await supabase!
      .from('servers')
      .select('*, providers:provider_id(id,name)')
      .eq('id', serverId)
      .eq('workspace_id', workspaceId)
      .single()

    if (srvErr) {
      setError(`Error al cargar el servidor: ${srvErr.message}`)
      setLoading(false)
      return
    }

    setServer(data as ServerRecord)
    setLoading(false)
  }, [serverId, workspaceId])

  const loadIps = useCallback(async () => {
    if (!serverId) return
    setLoadingIps(true)

    const { data, error: ipErr } = await supabase!
      .from('ip_addresses')
      .select('*')
      .eq('server_id', serverId)
      .eq('workspace_id', workspaceId)
      .order('address', { ascending: true })

    if (ipErr) {
      setError(`Error al cargar IPs: ${ipErr.message}`)
    } else {
      // Always exclude IPv6
      const ipv4Only = (data || []).filter(ip => !ip.address.includes(':'))
      setIps(ipv4Only)
    }
    setLoadingIps(false)
  }, [serverId, workspaceId])

  useEffect(() => {
    loadServer()
    loadIps()
  }, [loadServer, loadIps])

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

  // Copy IP helper
  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
    setCopiedIp(text)
    setTimeout(() => setCopiedIp(null), 1800)
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

    const ipPayload: Record<string, unknown> = {
      workspace_id: workspaceId,
      server_id: serverId,
      address: newIpAddress.trim(),
      ip_type: newIpType,
      label: newIpLabel.trim() || null,
      purpose: rdns || null,
      reverse_dns: rdns || null
    }

    if (newIpCost.trim()) {
      ipPayload.monthly_cost = Number(newIpCost)
    }

    const { error: ipInsertErr } = await supabase!.from('ip_addresses').insert(ipPayload)

    if (ipInsertErr) {
      setError(`Error al registrar IP: ${ipInsertErr.message}`)
    } else {
      setNotice(`IP ${newIpAddress.trim()} asociada con éxito.`)
      setNewIpAddress('')
      setNewIpRdns('')
      setNewIpLabel('')
      setNewIpCost('')
      setShowAddIp(false)
      await loadIps()
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
    }
  }

  // Inline edit save
  async function handleSaveIpEdit(ipId: string) {
    const patchData: Record<string, unknown> = {
      purpose: editRdnsValue.trim() || null,
      reverse_dns: editRdnsValue.trim() || null,
      label: editLabelValue.trim() || null
    }
    if (editCostValue.trim()) {
      patchData.monthly_cost = Number(editCostValue)
    } else {
      patchData.monthly_cost = null
    }

    const { error: patchErr } = await supabase!.from('ip_addresses').update(patchData).eq('id', ipId).eq('workspace_id', workspaceId)
    if (patchErr) {
      setError(`Error al actualizar IP: ${patchErr.message}`)
    } else {
      setEditingIpId(null)
      await loadIps()
    }
  }

  // Delete server
  async function handleDeleteServer() {
    if (!server) return
    if (!window.confirm(`¿Estás seguro de eliminar el servidor “${server.name}”? Sus IPs asociadas también serán eliminadas.`)) return

    const { error: delErr } = await supabase!.from('servers').delete().eq('id', server.id).eq('workspace_id', workspaceId)
    if (delErr) {
      setError(delErr.message)
    } else {
      navigate('/servers')
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

  return (
    <div className="server-detail-page">
      {/* Top back & actions bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', gap: '12px', flexWrap: 'wrap' }}>
        <Link to="/servers" className="button secondary" style={{ height: '36px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <ArrowLeft size={16} /> Volver a Servidores
        </Link>

        <div style={{ display: 'flex', gap: '8px' }}>
          <Link to={`/servers/${server.id}/edit`} className="button secondary" style={{ height: '36px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Edit2 size={15} /> Editar servidor
          </Link>
          {server.management_url && (
            <a href={server.management_url} target="_blank" rel="noreferrer" className="button secondary" style={{ height: '36px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <ExternalLink size={15} /> Abrir panel
            </a>
          )}
          <button type="button" className="button danger-hover" onClick={handleDeleteServer} style={{ height: '36px', display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#dc2626' }}>
            <Trash2 size={15} /> Eliminar
          </button>
        </div>
      </div>

      {notice && <div className="alert success" style={{ marginBottom: '16px' }}>{notice}</div>}
      {error && <div className="alert error" style={{ marginBottom: '16px' }}>{error}</div>}

      {/* Main Server Header Card */}
      <section className="inpage-card" style={{ marginBottom: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#eff6ff', color: '#2563eb', display: 'grid', placeItems: 'center' }}>
              <Server size={26} />
            </div>
            <div>
              <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0, color: '#1e293b' }}>{server.name}</h1>
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
            <span className="type-chip">{typeNames[server.server_type] || server.server_type}</span>
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
            <span>Costo Servidor</span>
            <strong style={{ color: '#2563eb', fontSize: '16px' }}>
              ${Number(server.monthly_cost || 0).toFixed(2)} / mes
            </strong>
          </div>
          <div className="spec-item">
            <span>Costo Total (Inc. IPs)</span>
            <strong style={{ color: '#16a34a', fontSize: '16px' }}>
              ${totalCost.toFixed(2)} / mes
            </strong>
          </div>
          <div className="spec-item">
            <span>Sistema Operativo</span>
            <strong>{server.operating_system || '—'}</strong>
          </div>
          <div className="spec-item">
            <span>CPU</span>
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
              <span>Notas</span>
              <strong style={{ fontWeight: 400, color: '#475569' }}>{server.notes}</strong>
            </div>
          )}
        </div>
      </section>

      {/* IPs & Reverse DNS Section */}
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
                  placeholder="ej. 198.50.231.236"
                  value={newIpAddress}
                  onChange={e => setNewIpAddress(e.target.value)}
                  onBlur={e => triggerDohLookup(e.target.value)}
                />
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
                  placeholder="ej. ns559079.ip-198-50-231.net"
                  value={newIpRdns}
                  onChange={e => setNewIpRdns(e.target.value)}
                />
              </div>

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
                  <th>Etiqueta / Subred</th>
                  <th>Costo / Mes</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredIps.map(ip => {
                  const isEditingThis = editingIpId === ip.id
                  const ptrHost = ip.reverse_dns || ip.purpose || '—'

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
                              title="Editar IP / PTR / Costo"
                              onClick={() => {
                                setEditingIpId(ip.id)
                                setEditRdnsValue(ip.reverse_dns || ip.purpose || '')
                                setEditLabelValue(ip.label || '')
                                setEditCostValue(ip.monthly_cost ? String(ip.monthly_cost) : '')
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
    </div>
  )
}
