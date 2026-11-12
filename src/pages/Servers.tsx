import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Boxes,
  Container,
  Edit2,
  ExternalLink,
  Eye,
  Filter,
  Globe2,
  MapPin,
  Monitor,
  Plus,
  Search,
  Server,
  Trash2
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSetBreadcrumbs } from '../lib/breadcrumbs'
import type { Server as ServerRecord } from '../types'

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
  const navigate = useNavigate()

  const [servers, setServers] = useState<ServerRecord[]>([])
  const [serverIpCounts, setServerIpCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState<'all' | 'hosts' | 'vps' | 'kvm' | 'lxc'>('all')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Set topbar breadcrumbs
  useSetBreadcrumbs([{ label: 'Servidores' }])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [serverResult, ipCountResult] = await Promise.all([
      supabase!
        .from('servers')
        .select('*, providers:provider_id(id,name), parent_server:parent_id(id,name)')
        .eq('workspace_id', workspaceId)
        .order('name'),
      supabase!
        .from('ip_addresses')
        .select('server_id')
        .eq('workspace_id', workspaceId)
        .not('server_id', 'is', null)
    ])

    if (serverResult.error) {
      // Fallback if parent_server join fails
      const fallback = await supabase!
        .from('servers')
        .select('*, providers:provider_id(id,name)')
        .eq('workspace_id', workspaceId)
        .order('name')
      if (fallback.data) {
        setServers(fallback.data as ServerRecord[])
      } else {
        setError(serverResult.error.message)
      }
    } else {
      setServers((serverResult.data || []) as ServerRecord[])
    }

    if (ipCountResult.data) {
      const counts: Record<string, number> = {}
      for (const row of ipCountResult.data) {
        if (row.server_id) {
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

  async function remove(server: ServerRecord) {
    if (!window.confirm(`¿Eliminar el servidor “${server.name}”? Sus IPs asociadas también se desvincularán.`)) return
    const { error: deleteError } = await supabase!.from('servers').delete().eq('id', server.id).eq('workspace_id', workspaceId)
    if (deleteError) {
      setError(deleteError.message)
    } else {
      setNotice('Servidor eliminado.')
      await load()
    }
  }

  // Count child VMs for each parent server
  const vmCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of servers) {
      if (s.parent_id) {
        counts[s.parent_id] = (counts[s.parent_id] || 0) + 1
      }
    }
    return counts
  }, [servers])

  const filtered = useMemo(() => {
    return servers.filter(server => {
      const matchesStatus = statusFilter === 'all' || server.status === statusFilter
      const isHost = !server.parent_id && (server.server_type === 'dedicated' || server.server_type === 'physical')
      const isVps = Boolean(server.parent_id) || server.server_type === 'vps'
      const isLxc = isVps && server.vm_type === 'lxc'
      const isKvm = isVps && server.vm_type !== 'lxc'

      if (roleFilter === 'hosts' && !isHost) return false
      if (roleFilter === 'vps' && !isVps) return false
      if (roleFilter === 'kvm' && !isKvm) return false
      if (roleFilter === 'lxc' && !isLxc) return false

      const q = query.toLowerCase().trim()
      const matchesQuery =
        !q ||
        server.name.toLowerCase().includes(q) ||
        (server.hostname && server.hostname.toLowerCase().includes(q)) ||
        (server.role && server.role.toLowerCase().includes(q)) ||
        (server.location && server.location.toLowerCase().includes(q)) ||
        (server.providers?.name && server.providers.name.toLowerCase().includes(q))
      return matchesStatus && matchesQuery
    })
  }, [servers, statusFilter, roleFilter, query])

  const totals = useMemo(() => {
    const physicalHosts = servers.filter(s => !s.parent_id && (s.server_type === 'dedicated' || s.server_type === 'physical'))
    const virtualVps = servers.filter(s => Boolean(s.parent_id) || s.server_type === 'vps')
    const kvmCount = servers.filter(s => (Boolean(s.parent_id) || s.server_type === 'vps') && s.vm_type !== 'lxc')
    const lxcCount = servers.filter(s => (Boolean(s.parent_id) || s.server_type === 'vps') && s.vm_type === 'lxc')
    const active = servers.filter(s => s.status === 'active')
    const totalCost = servers.reduce((acc, s) => acc + (Number(s.monthly_cost) || 0), 0)

    return {
      all: servers.length,
      physicalHosts: physicalHosts.length,
      virtualVps: virtualVps.length,
      kvmCount: kvmCount.length,
      lxcCount: lxcCount.length,
      active: active.length,
      totalCost
    }
  }, [servers])

  return (
    <div className="servers-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Infraestructura</div>
          <h1>Servidores y Virtualización Proxmox</h1>
          <p>Gestión de hipervisores físicos dedicados, máquinas virtuales (VPS) y contenedores LXC.</p>
        </div>
        <button className="button primary" onClick={() => navigate('/servers/new')}>
          <Plus size={16} /> Nuevo Servidor / VPS
        </button>
      </div>

      {notice && <div className="alert success">{notice}</div>}
      {error && <div className="alert error">{error}</div>}

      {/* KPI Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Hipervisores Proxmox</div>
          <div className="stat-value" style={{ color: '#0284c7' }}>{totals.physicalHosts}</div>
          <div className="stat-caption">Servidores dedicados físicos</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">VPS Virtualizados</div>
          <div className="stat-value" style={{ color: '#16a34a' }}>{totals.virtualVps}</div>
          <div className="stat-caption">Máquinas KVM / LXC</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Instancias Activas</div>
          <div className="stat-value" style={{ color: '#0f172a' }}>{totals.active}</div>
          <div className="stat-caption">Operando en producción</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Gasto Mensual Servidores</div>
          <div className="stat-value" style={{ color: '#2563eb' }}>${totals.totalCost.toFixed(2)}</div>
          <div className="stat-caption">USD / mes (sin IPs extras)</div>
        </div>
      </div>

      {/* Inventory Table */}
      <section className="table-card">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              className="input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar por nombre, hostname, función, ubicación…"
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <div className="filter-wrap">
              <Boxes size={16} />
              <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as 'all' | 'hosts' | 'vps' | 'kvm' | 'lxc')}>
                <option value="all">Todas las instancias ({servers.length})</option>
                <option value="hosts">Solo Hipervisores Físicos ({totals.physicalHosts})</option>
                <option value="vps">Todos los VPS / Contenedores ({totals.virtualVps})</option>
                <option value="kvm">Solo KVM - Máquinas Virtuales ({totals.kvmCount})</option>
                <option value="lxc">Solo LXC - Contenedores ({totals.lxcCount})</option>
              </select>
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
              <button className="button secondary" onClick={() => navigate('/servers/new')}>
                <Plus size={16} /> Agregar primer servidor
              </button>
            )}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Servidor / Instancia</th>
                  <th>Tipo / Entorno</th>
                  <th>IPs Asignadas</th>
                  <th>Proveedor</th>
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
                  const childCount = vmCounts[server.id] || 0
                  const isHost = !server.parent_id && (server.server_type === 'dedicated' || server.server_type === 'physical')
                  const isVps = Boolean(server.parent_id) || server.server_type === 'vps'
                  const isLxc = isVps && server.vm_type === 'lxc'
                  const isKvm = isVps && server.vm_type !== 'lxc'

                  return (
                    <tr key={server.id}>
                      <td>
                        <div
                          className="server-cell clickable"
                          onClick={() => navigate(`/servers/${server.id}`)}
                          title="Clic para navegar al detalle"
                        >
                          <div
                            className="server-table-icon"
                            style={{
                              background: !isVps ? '#eff6ff' : isLxc ? '#ecfeff' : '#f0fdf4',
                              color: !isVps ? '#2563eb' : isLxc ? '#0891b2' : '#16a34a'
                            }}
                            title={!isVps ? 'Servidor Dedicado / Host Proxmox' : isLxc ? 'Contenedor LXC' : 'Máquina Virtual KVM'}
                          >
                            {!isVps ? (
                              <Server size={17} />
                            ) : isLxc ? (
                              <Container size={17} />
                            ) : (
                              <Monitor size={17} />
                            )}
                          </div>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <strong>{server.vm_id ? `[${server.vm_id}] ` : ''}{server.name}</strong>
                              {isVps && (
                                <span
                                  style={{
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    padding: '1px 5px',
                                    borderRadius: '4px',
                                    background: isLxc ? '#e0f2fe' : '#dcfce7',
                                    color: isLxc ? '#0369a1' : '#15803d',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px'
                                  }}
                                >
                                  {isLxc ? <Container size={10} /> : <Monitor size={10} />}
                                  {isLxc ? 'LXC' : 'KVM'}
                                </span>
                              )}
                              {server.role && (
                                <span style={{ fontSize: '10px', background: '#f1f5f9', color: '#334155', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                  {server.role}
                                </span>
                              )}
                            </div>
                            <span>
                              {server.parent_server ? (
                                <span style={{ color: '#0284c7' }}>Host: {server.parent_server.name}</span>
                              ) : (
                                server.hostname || 'Sin hostname'
                              )}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {isLxc ? (
                            <span className="type-chip" style={{ background: '#ecfeff', color: '#0891b2', borderColor: '#a5f3fc', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
                              <Container size={12} /> LXC
                            </span>
                          ) : isKvm ? (
                            <span className="type-chip" style={{ background: '#f0fdf4', color: '#16a34a', borderColor: '#bbf7d0', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
                              <Monitor size={12} /> KVM
                            </span>
                          ) : (
                            <span className="type-chip">{typeNames[server.server_type] || server.server_type}</span>
                          )}
                          {isHost && childCount > 0 && (
                            <button
                              type="button"
                              className="ip-badge"
                              style={{ background: '#f0fdf4', color: '#16a34a', borderColor: '#bbf7d0' }}
                              onClick={() => navigate(`/servers/${server.id}`)}
                              title="Ver las VMs de este Proxmox"
                            >
                              <Boxes size={11} />
                              {childCount} {childCount === 1 ? 'VPS' : 'VPS'}
                            </button>
                          )}
                        </div>
                      </td>

                      <td>
                        <button
                          type="button"
                          className="ip-badge"
                          onClick={() => navigate(`/servers/${server.id}`)}
                          title="Ver detalle de IPs"
                        >
                          <Globe2 size={12} />
                          {ipCount} {ipCount === 1 ? 'IP' : 'IPs'}
                        </button>
                      </td>

                      <td>{server.providers?.name || <span className="muted-cell">Sin proveedor</span>}</td>

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
                            title="Ver detalles"
                            onClick={() => navigate(`/servers/${server.id}`)}
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            className="icon-button"
                            title="Editar"
                            onClick={() => navigate(`/servers/${server.id}/edit`)}
                          >
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
            Mostrando {filtered.length} de {servers.length} servidores e instancias
          </span>
          <span>Inventario Proxmox / Bare Metal</span>
        </div>
      </section>
    </div>
  )
}
