import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Check,
  Copy,
  DollarSign,
  Edit2,
  Filter,
  Globe2,
  Network as NetworkIcon,
  Plus,
  Radio,
  Search,
  Server,
  Trash2,
  Wifi,
  X
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { lookupReverseDns } from '../lib/dns'
import { useSetBreadcrumbs } from '../lib/breadcrumbs'
import type { IPAddress, Network, Server as ServerRecord } from '../types'

type IpFormState = {
  address: string
  server_id: string
  ip_type: 'public' | 'private'
  purpose: string // Reverse DNS
  label: string
  monthly_cost: string
  notes: string
}

const emptyIpForm: IpFormState = {
  address: '',
  server_id: '',
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
        .select('*, servers(name, hostname)')
        .eq('workspace_id', workspaceId)
        .order('address', { ascending: true }),
      supabase!.from('networks').select('*').eq('workspace_id', workspaceId).order('name', { ascending: true }),
      supabase!.from('servers').select('id,name,hostname').eq('workspace_id', workspaceId).order('name')
    ])

    if (ipRes.error) {
      setError(ipRes.error.message)
    } else {
      const onlyIpv4 = ((ipRes.data || []) as IPAddress[]).filter(ip => !ip.address.includes(':'))
      setIps(onlyIpv4)
    }

    if (!netRes.error) {
      setNetworks((netRes.data || []) as Network[])
    }

    if (!srvRes.error) {
      setServers((srvRes.data || []) as ServerRecord[])
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
          (ipFilter === 'assigned' && Boolean(ip.server_id)) ||
          (ipFilter === 'free' && !ip.server_id) ||
          (ipFilter === 'public' && ip.ip_type === 'public') ||
          (ipFilter === 'private' && ip.ip_type === 'private')

        const text = `${ip.address} ${ip.purpose || ''} ${ip.label || ''} ${ip.notes || ''} ${ip.servers?.name || ''} ${ip.servers?.hostname || ''}`.toLowerCase()
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

  const assignedCount = useMemo(() => ips.filter(ip => ip.server_id).length, [ips])
  const freeCount = useMemo(() => ips.filter(ip => !ip.server_id).length, [ips])

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
    setIpForm({
      address: ip.address,
      server_id: ip.server_id || '',
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

    const payload: Record<string, unknown> = {
      workspace_id: workspaceId,
      address: ipForm.address.trim(),
      server_id: ipForm.server_id || null,
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
      const { error: updErr } = await supabase!
        .from('ip_addresses')
        .update(payload)
        .eq('id', editingIp.id)
        .eq('workspace_id', workspaceId)

      if (updErr) {
        setError(updErr.message)
        setSavingIp(false)
        return
      }
      setNotice('Dirección IP actualizada.')
    } else {
      const { error: insErr } = await supabase!.from('ip_addresses').insert(payload)
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
        <div style={{ display: 'flex', gap: '8px' }}>
          {activeTab === 'ips' ? (
            <button className="button primary" onClick={openNewIp}>
              <Plus size={17} /> Registrar IP
            </button>
          ) : (
            <button className="button primary" onClick={openNewNet}>
              <Plus size={17} /> Crear Red / Bloque
            </button>
          )}
        </div>
      </div>

      <div className="server-summary">
        <div>
          <span className="summary-icon">
            <Radio size={18} />
          </span>
          <div>
            <strong>{ips.length}</strong>
            <span>Total direcciones IP</span>
          </div>
        </div>
        <div>
          <span className="summary-icon green">
            <Server size={18} />
          </span>
          <div>
            <strong>{assignedCount}</strong>
            <span>IPs asignadas a servidores</span>
          </div>
        </div>
        <div>
          <span className="summary-icon orange">
            <Wifi size={18} />
          </span>
          <div>
            <strong>{freeCount}</strong>
            <span>IPs libres / disponibles</span>
          </div>
        </div>
        <div>
          <span className="summary-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>
            <DollarSign size={18} />
          </span>
          <div>
            <strong>${totalIpCost.toFixed(2)}</strong>
            <span>Costo mensual en IPs</span>
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

      {error && !ipModalOpen && !netModalOpen && <div className="alert error">{error}</div>}

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
                <label>Servidor asignado</label>
                <select
                  className="input"
                  value={ipForm.server_id}
                  onChange={e => setIpForm(old => ({ ...old, server_id: e.target.value }))}
                >
                  <option value="">Libre / Sin servidor asignado</option>
                  {servers.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.hostname || s.server_type})
                    </option>
                  ))}
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
            <div className="filter-wrap">
              <Filter size={16} />
              <select
                value={ipFilter}
                onChange={e => setIpFilter(e.target.value as any)}
              >
                <option value="all">Todas las IPs ({ips.length})</option>
                <option value="assigned">Asignadas a Servidor ({assignedCount})</option>
                <option value="free">Libres / Sin Asignar ({freeCount})</option>
                <option value="public">Solo Públicas</option>
                <option value="private">Solo Privadas</option>
              </select>
            </div>
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
                    <th>Servidor Asignado</th>
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
                          {ip.servers?.name ? (
                            <span className="ip-badge" style={{ background: '#f8fafc', color: '#334155', borderColor: '#e2e8f0' }}>
                              <Server size={11} /> {ip.servers.name}
                            </span>
                          ) : (
                            <span className="ip-badge" style={{ background: '#fffbeb', color: '#b45309', borderColor: '#fef3c7' }}>
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
