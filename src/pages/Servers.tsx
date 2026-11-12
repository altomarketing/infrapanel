import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Edit2,
  ExternalLink,
  Eye,
  Filter,
  Globe2,
  MapPin,
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
        .select('*, providers:provider_id(id,name)')
        .eq('workspace_id', workspaceId)
        .order('name'),
      supabase!
        .from('ip_addresses')
        .select('server_id')
        .eq('workspace_id', workspaceId)
        .not('server_id', 'is', null)
    ])

    if (serverResult.error) {
      setError(serverResult.error.message)
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

  const filtered = useMemo(() => {
    return servers.filter(server => {
      const matchesStatus = statusFilter === 'all' || server.status === statusFilter
      const q = query.toLowerCase().trim()
      const matchesQuery =
        !q ||
        server.name.toLowerCase().includes(q) ||
        (server.hostname && server.hostname.toLowerCase().includes(q)) ||
        (server.location && server.location.toLowerCase().includes(q)) ||
        (server.providers?.name && server.providers.name.toLowerCase().includes(q))
      return matchesStatus && matchesQuery
    })
  }, [servers, statusFilter, query])

  const totals = useMemo(() => {
    return {
      all: servers.length,
      active: servers.filter(s => s.status === 'active').length,
      maintenance: servers.filter(s => s.status === 'maintenance').length,
      inactive: servers.filter(s => s.status === 'inactive').length,
      totalCost: servers.reduce((acc, s) => acc + (Number(s.monthly_cost) || 0), 0)
    }
  }, [servers])

  return (
    <div className="servers-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Infraestructura</div>
          <h1>Servidores</h1>
          <p>Gestión de servidores dedicados, VPS y máquinas virtuales en la nube.</p>
        </div>
        <button className="button primary" onClick={() => navigate('/servers/new')}>
          <Plus size={16} /> Nuevo Servidor
        </button>
      </div>

      {notice && <div className="alert success">{notice}</div>}
      {error && <div className="alert error">{error}</div>}

      {/* KPI Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total servidores</div>
          <div className="stat-value">{totals.all}</div>
          <div className="stat-caption">Instancias registradas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Activos</div>
          <div className="stat-value" style={{ color: '#16a34a' }}>{totals.active}</div>
          <div className="stat-caption">Operando en producción</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Mantenimiento / Inactivos</div>
          <div className="stat-value" style={{ color: '#eab308' }}>{totals.maintenance + totals.inactive}</div>
          <div className="stat-caption">Requieren atención</div>
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
                          onClick={() => navigate(`/servers/${server.id}`)}
                          title="Clic para navegar al detalle de IPs y Reverse DNS"
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
                          onClick={() => navigate(`/servers/${server.id}`)}
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
            Mostrando {filtered.length} de {servers.length} servidores
          </span>
          <span>Inventario manual</span>
        </div>
      </section>
    </div>
  )
}
