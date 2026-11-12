import { useEffect, useState } from 'react'
import { Activity, ArrowUpRight, Boxes, Globe2, Plus, Server, ServerCog, Wifi } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Dashboard({ workspaceId }: { workspaceId: string }) {
  const [counts, setCounts] = useState({ servers: 0, services: 0, domains: 0, networks: 0 })
  const [recent, setRecent] = useState<{ id: string; name: string; hostname: string | null; status: string; server_type: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true); setError('')
      const [servers, services, domains, networks, latest] = await Promise.all([
        supabase!.from('servers').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
        supabase!.from('services').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
        supabase!.from('domains').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
        supabase!.from('networks').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
        supabase!.from('servers').select('id,name,hostname,status,server_type').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(5),
      ])
      if (!alive) return
      const firstError = servers.error || services.error || domains.error || networks.error || latest.error
      if (firstError) setError(firstError.message)
      setCounts({ servers: servers.count || 0, services: services.count || 0, domains: domains.count || 0, networks: networks.count || 0 })
      setRecent(latest.data || [])
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [workspaceId])

  const cards = [
    { label: 'Servidores', value: counts.servers, icon: Server, tone: 'blue', to: '/servers', caption: 'Equipos registrados' },
    { label: 'Servicios', value: counts.services, icon: Boxes, tone: 'violet', to: '/servers', caption: 'Aplicaciones y plataformas' },
    { label: 'Dominios', value: counts.domains, icon: Globe2, tone: 'green', to: '/servers', caption: 'Dominios administrados' },
    { label: 'Redes e IP', value: counts.networks, icon: Wifi, tone: 'orange', to: '/servers', caption: 'Redes configuradas' },
  ]
  return <div className="page-stack"><div className="page-heading"><div><div className="eyebrow">VISTA GENERAL</div><h1>Dashboard</h1><p>Un resumen de tu infraestructura y sus componentes.</p></div><Link to="/servers" className="button primary"><Plus size={17}/> Agregar servidor</Link></div>
    {error && <div className="alert error">No se pudieron cargar todos los datos: {error}</div>}
    <div className="stats-grid">{cards.map(card => <Link to={card.to} className="stat-card" key={card.label}><div className="stat-top"><span>{card.label}</span><span className={`stat-icon ${card.tone}`}><card.icon size={18}/></span></div><div className="stat-value">{loading ? '—' : card.value}</div><div className="stat-caption">{card.caption}<ArrowUpRight size={14}/></div></Link>)}</div>
    <div className="dashboard-grid"><section className="panel recent-panel"><div className="panel-heading"><div><h2>Servidores recientes</h2><p>Últimos equipos agregados al inventario.</p></div><Link to="/servers" className="text-link">Ver todos <ArrowUpRight size={15}/></Link></div>{loading ? <div className="empty-state">Cargando servidores…</div> : recent.length === 0 ? <div className="empty-state"><div className="empty-icon"><ServerCog size={22}/></div><strong>Tu inventario está vacío</strong><span>Agregá tu primer servidor para empezar a organizar tu infraestructura.</span><Link to="/servers" className="button secondary"><Plus size={16}/> Registrar servidor</Link></div> : <div className="recent-list">{recent.map(server => <Link to="/servers" className="recent-row" key={server.id}><div className="server-mini-icon"><Server size={17}/></div><div className="recent-main"><strong>{server.name}</strong><span>{server.hostname || server.server_type.replace('_', ' ')}</span></div><span className={`status-pill ${server.status}`}>{statusLabel(server.status)}</span><ArrowUpRight size={15} className="row-arrow"/></Link>)}</div>}</section>
      <section className="panel overview-panel"><div className="panel-heading"><div><h2>Estado general</h2><p>Resumen de registros.</p></div><Activity size={18} className="muted-icon"/></div><div className="overview-number"><strong>{loading ? '—' : counts.servers + counts.services + counts.domains + counts.networks}</strong><span>elementos registrados</span></div><div className="overview-bars">{[{label:'Servidores',value:counts.servers,color:'bar-blue'},{label:'Servicios',value:counts.services,color:'bar-violet'},{label:'Dominios',value:counts.domains,color:'bar-green'},{label:'Redes',value:counts.networks,color:'bar-orange'}].map(item => <div className="bar-row" key={item.label}><div><span>{item.label}</span><strong>{loading ? '—' : item.value}</strong></div><div className="bar-track"><div className={item.color} style={{ width: `${counts.servers + counts.services + counts.domains + counts.networks ? item.value / (counts.servers + counts.services + counts.domains + counts.networks) * 100 : 0}%` }}/></div></div>)}</div><div className="manual-note"><span className="note-dot"/> Inventario manual · Sin monitoreo automático</div></section></div>
  </div>
}
function statusLabel(status: string) { return ({ active: 'Activo', maintenance: 'Mantenimiento', inactive: 'Inactivo', decommissioned: 'Baja' } as Record<string,string>)[status] || status }
