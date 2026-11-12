import { useEffect, useState } from 'react'
import { ArrowUpRight, DollarSign, Globe2, Plus, Server, ServerCog, Tags, Wifi } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSetBreadcrumbs } from '../lib/breadcrumbs'

export default function Dashboard({ workspaceId }: { workspaceId: string }) {
  useSetBreadcrumbs([{ label: 'Dashboard' }])
  const [counts, setCounts] = useState({ servers: 0, providers: 0, domains: 0, networks: 0 })
  const [totalCost, setTotalCost] = useState(0)
  const [recent, setRecent] = useState<{ id: string; name: string; hostname: string | null; status: string; server_type: string; monthly_cost?: number | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      setError('')
      const [servers, providers, domains, networks, latest, srvCosts, ipCosts, domCosts] = await Promise.all([
        supabase!.from('servers').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
        supabase!.from('providers').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
        supabase!.from('domains').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
        supabase!.from('networks').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
        supabase!.from('servers').select('id,name,hostname,status,server_type,monthly_cost').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(5),
        supabase!.from('servers').select('monthly_cost').eq('workspace_id', workspaceId),
        supabase!.from('ip_addresses').select('monthly_cost').eq('workspace_id', workspaceId),
        supabase!.from('domains').select('monthly_cost').eq('workspace_id', workspaceId)
      ])

      if (!alive) return

      const firstError = servers.error || providers.error || domains.error || networks.error || latest.error
      if (firstError) setError(firstError.message)

      setCounts({
        servers: servers.count || 0,
        providers: providers.count || 0,
        domains: domains.count || 0,
        networks: networks.count || 0
      })
      setRecent(latest.data || [])

      // Calculate total cost (servers + IPs + domains)
      let sum = 0
      if (srvCosts.data) {
        for (const r of srvCosts.data) sum += Number(r.monthly_cost || 0)
      }
      if (ipCosts.data) {
        for (const r of ipCosts.data) sum += Number(r.monthly_cost || 0)
      }
      if (domCosts.data) {
        for (const r of domCosts.data) sum += Number(r.monthly_cost || 0)
      }
      setTotalCost(sum)

      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [workspaceId])

  const cards = [
    { label: 'Servidores', value: counts.servers, icon: Server, tone: 'blue', to: '/servers', caption: 'Equipos registrados' },
    { label: 'Proveedores', value: counts.providers, icon: Tags, tone: 'violet', to: '/providers', caption: 'Hosting, Cloud, DNS' },
    { label: 'Dominios', value: counts.domains, icon: Globe2, tone: 'green', to: '/domains', caption: 'Dominios e IPs asignadas' },
    { label: 'Redes e IP', value: counts.networks, icon: Wifi, tone: 'orange', to: '/networks', caption: 'Redes y bloques' },
  ]

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <div className="eyebrow">VISTA GENERAL</div>
          <h1>Dashboard</h1>
          <p>Un resumen de tu infraestructura, costos mensuales y componentes.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Link to="/domains" className="button secondary">
            <Plus size={16} /> Agregar dominio
          </Link>
          <Link to="/servers" className="button primary">
            <Plus size={17} /> Agregar servidor
          </Link>
        </div>
      </div>

      {error && <div className="alert error">No se pudieron cargar todos los datos: {error}</div>}

      <div className="stats-grid">
        {cards.map(card => (
          <Link to={card.to} className="stat-card" key={card.label}>
            <div className="stat-top">
              <span>{card.label}</span>
              <span className={`stat-icon ${card.tone}`}>
                <card.icon size={18} />
              </span>
            </div>
            <div className="stat-value">{loading ? '—' : card.value}</div>
            <div className="stat-caption">
              {card.caption}
              <ArrowUpRight size={14} />
            </div>
          </Link>
        ))}
      </div>

      <div className="dashboard-grid">
        <section className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <h2>Servidores en inventario</h2>
              <p>Últimos equipos registrados y su estado.</p>
            </div>
            <Link to="/servers" className="text-link">
              Ver todos <ArrowUpRight size={15} />
            </Link>
          </div>
          {loading ? (
            <div className="empty-state">Cargando servidores…</div>
          ) : recent.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <ServerCog size={22} />
              </div>
              <strong>Tu inventario está vacío</strong>
              <span>Agregá tu primer servidor para empezar a organizar tu infraestructura.</span>
              <Link to="/servers" className="button secondary">
                <Plus size={16} /> Registrar servidor
              </Link>
            </div>
          ) : (
            <div className="recent-list">
              {recent.map(server => (
                <Link to={`/servers/${server.id}`} className="recent-row" key={server.id} title={`Ver detalle de ${server.name}`}>
                  <div className="server-mini-icon">
                    <Server size={17} />
                  </div>
                  <div className="recent-main">
                    <strong>{server.name}</strong>
                    <span>{server.hostname || server.server_type.replace('_', ' ')}</span>
                  </div>
                  {server.monthly_cost ? (
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#2563eb', marginRight: '6px' }}>
                      ${Number(server.monthly_cost).toFixed(2)}/m
                    </span>
                  ) : null}
                  <span className={`status-pill ${server.status}`}>{statusLabel(server.status)}</span>
                  <ArrowUpRight size={15} className="row-arrow" />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel overview-panel">
          <div className="panel-heading">
            <div>
              <h2>Costo mensual estimado</h2>
              <p>Gasto proyectado de infraestructura.</p>
            </div>
            <DollarSign size={18} style={{ color: '#16a34a' }} />
          </div>

          <div className="overview-number">
            <strong style={{ color: '#16a34a' }}>${loading ? '—' : totalCost.toFixed(2)}</strong>
            <span>total mensual (servidores, IPs y dominios)</span>
          </div>

          <div className="overview-bars">
            {[
              { label: 'Servidores', value: counts.servers, color: 'bar-blue' },
              { label: 'Proveedores', value: counts.providers, color: 'bar-violet' },
              { label: 'Dominios', value: counts.domains, color: 'bar-green' },
              { label: 'Redes', value: counts.networks, color: 'bar-orange' }
            ].map(item => (
              <div className="bar-row" key={item.label}>
                <div>
                  <span>{item.label}</span>
                  <strong>{loading ? '—' : item.value}</strong>
                </div>
                <div className="bar-track">
                  <div
                    className={item.color}
                    style={{
                      width: `${
                        counts.servers + counts.providers + counts.domains + counts.networks
                          ? (item.value /
                              (counts.servers + counts.providers + counts.domains + counts.networks)) *
                            100
                          : 0
                      }%`
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="manual-note">
            <span className="note-dot" /> Inventario manual · Costos calculados en tiempo real
          </div>
        </section>
      </div>
    </div>
  )
}

function statusLabel(status: string) {
  return (
    ({
      active: 'Activo',
      maintenance: 'Mantenimiento',
      inactive: 'Inactivo',
      decommissioned: 'Baja'
    } as Record<string, string>)[status] || status
  )
}
