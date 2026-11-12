import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Activity, Edit2, ExternalLink, Filter, HardDrive, MapPin, Plus, Search, Server, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Provider, Server as ServerRecord, ServerStatus, ServerType } from '../types'

type FormState = { name: string; hostname: string; provider_id: string; server_type: ServerType; operating_system: string; cpu: string; ram_gb: string; storage_gb: string; location: string; public_ip: string; private_ip: string; status: ServerStatus; management_url: string; expires_at: string; notes: string }
const emptyForm: FormState = { name:'', hostname:'', provider_id:'', server_type:'vps', operating_system:'', cpu:'', ram_gb:'', storage_gb:'', location:'', public_ip:'', private_ip:'', status:'active', management_url:'', expires_at:'', notes:'' }
const statusNames: Record<string,string> = { active:'Activo', maintenance:'Mantenimiento', inactive:'Inactivo', decommissioned:'Baja' }
const typeNames: Record<string,string> = { vps:'VPS', dedicated:'Dedicado', physical:'Físico', cloud:'Cloud', virtual_machine:'Máquina virtual', other:'Otro' }

export default function Servers({ workspaceId }: { workspaceId: string }) {
  const [servers, setServers] = useState<ServerRecord[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ServerRecord | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const [serverResult, providerResult] = await Promise.all([
      supabase!.from('servers').select('*, providers(name)').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
      supabase!.from('providers').select('id,name').eq('workspace_id', workspaceId).order('name'),
    ])
    if (serverResult.error) setError(serverResult.error.message)
    else setServers((serverResult.data || []) as ServerRecord[])
    if (!providerResult.error) setProviders(providerResult.data || [])
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { load() }, [load])
  const filtered = useMemo(() => servers.filter(s => {
    const text = `${s.name} ${s.hostname || ''} ${s.location || ''} ${s.operating_system || ''} ${s.providers?.name || ''}`.toLowerCase()
    return text.includes(query.toLowerCase()) && (statusFilter === 'all' || s.status === statusFilter)
  }), [servers, query, statusFilter])

  function openNew() { setEditing(null); setForm(emptyForm); setError(''); setModalOpen(true) }
  function openEdit(server: ServerRecord) {
    setEditing(server)
    setForm({ name:server.name, hostname:server.hostname || '', provider_id:server.provider_id || '', server_type:server.server_type, operating_system:server.operating_system || '', cpu:server.cpu || '', ram_gb:server.ram_gb?.toString() || '', storage_gb:server.storage_gb?.toString() || '', location:server.location || '', public_ip:'', private_ip:'', status:server.status, management_url:server.management_url || '', expires_at:server.expires_at || '', notes:server.notes || '' })
    setError(''); setModalOpen(true)
    void supabase!.from('ip_addresses').select('address,ip_type').eq('workspace_id', workspaceId).eq('server_id', server.id).then(({ data }) => {
      if (!data) return
      setForm(old => ({ ...old, public_ip: data.find(ip => ip.ip_type === 'public')?.address || '', private_ip: data.find(ip => ip.ip_type === 'private')?.address || '' }))
    })
  }
  function update<K extends keyof FormState>(key: K, value: FormState[K]) { setForm(old => ({ ...old, [key]: value })) }

  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    const payload = { workspace_id:workspaceId, name:form.name.trim(), hostname:form.hostname.trim() || null, provider_id:form.provider_id || null, server_type:form.server_type, operating_system:form.operating_system.trim() || null, cpu:form.cpu.trim() || null, ram_gb:form.ram_gb ? Number(form.ram_gb) : null, storage_gb:form.storage_gb ? Number(form.storage_gb) : null, location:form.location.trim() || null, status:form.status, management_url:form.management_url.trim() || null, expires_at:form.expires_at || null, notes:form.notes.trim() || null }
    let serverId = editing?.id
    if (editing) {
      const { error: updateError } = await supabase!.from('servers').update(payload).eq('id', editing.id).eq('workspace_id', workspaceId)
      if (updateError) { setError(updateError.message); setSaving(false); return }
    } else {
      const { data, error: insertError } = await supabase!.from('servers').insert(payload).select('id').single()
      if (insertError) { setError(insertError.message); setSaving(false); return }
      serverId = data.id
    }
    const { error: clearIpError } = await supabase!.from('ip_addresses').delete().eq('workspace_id', workspaceId).eq('server_id', serverId)
    if (clearIpError) { setError(`El servidor se guardó, pero no se pudieron actualizar sus IP: ${clearIpError.message}`); setSaving(false); await load(); return }
    const ipRows: { workspace_id: string; server_id: string; address: string; ip_type: 'public' | 'private'; label: string }[] = []
    if (form.public_ip.trim()) ipRows.push({ workspace_id: workspaceId, server_id: serverId!, address: form.public_ip.trim(), ip_type: 'public', label: 'IP pública' })
    if (form.private_ip.trim()) ipRows.push({ workspace_id: workspaceId, server_id: serverId!, address: form.private_ip.trim(), ip_type: 'private', label: 'IP privada' })
    if (ipRows.length) {
      const { error: ipError } = await supabase!.from('ip_addresses').insert(ipRows)
      if (ipError) { setError(`El servidor se guardó, pero hubo un error registrando las IP: ${ipError.message}`); setSaving(false); await load(); return }
    }
    setModalOpen(false); setNotice(editing ? 'Servidor actualizado correctamente.' : 'Servidor registrado correctamente.'); setSaving(false); await load()
  }

  async function remove(server: ServerRecord) {
    if (!window.confirm(`¿Eliminar el servidor “${server.name}”? Las relaciones asociadas también se eliminarán.`)) return
    const { error: deleteError } = await supabase!.from('servers').delete().eq('id', server.id).eq('workspace_id', workspaceId)
    if (deleteError) setError(deleteError.message)
    else { setNotice('Servidor eliminado.'); await load() }
  }

  return <div className="page-stack"><div className="page-heading"><div><div className="eyebrow">INVENTARIO</div><h1>Servidores</h1><p>Administrá tus VPS, servidores dedicados y máquinas físicas.</p></div><button className="button primary" onClick={openNew}><Plus size={17}/> Agregar servidor</button></div>
    <div className="server-summary"><div><span className="summary-icon"><Server size={18}/></span><div><strong>{servers.length}</strong><span>Servidores registrados</span></div></div><div><span className="summary-icon green"><Activity size={18}/></span><div><strong>{servers.filter(s => s.status === 'active').length}</strong><span>Activos</span></div></div><div><span className="summary-icon orange"><HardDrive size={18}/></span><div><strong>{servers.filter(s => s.status === 'maintenance').length}</strong><span>En mantenimiento</span></div></div></div>
    {notice && <div className="alert success">{notice}<button className="alert-close" onClick={() => setNotice('')}><X size={15}/></button></div>}
    {error && !modalOpen && <div className="alert error">{error}</div>}
    <section className="panel table-panel"><div className="table-toolbar"><div className="search-box"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre, hostname, ubicación…"/></div><div className="filter-wrap"><Filter size={16}/><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="all">Todos los estados</option><option value="active">Activo</option><option value="maintenance">Mantenimiento</option><option value="inactive">Inactivo</option><option value="decommissioned">Baja</option></select></div></div>
      {loading ? <div className="table-empty">Cargando inventario…</div> : filtered.length === 0 ? <div className="table-empty"><div className="empty-icon"><Server size={22}/></div><strong>{servers.length ? 'No hay resultados' : 'Todavía no registraste servidores'}</strong><span>{servers.length ? 'Probá cambiar la búsqueda o el filtro.' : 'Agregá tu primer servidor para comenzar.'}</span>{!servers.length && <button className="button secondary" onClick={openNew}><Plus size={16}/> Agregar primer servidor</button>}</div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Servidor</th><th>Proveedor</th><th>Tipo</th><th>Ubicación</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{filtered.map(server => <tr key={server.id}><td><div className="server-cell"><div className="server-table-icon"><Server size={17}/></div><div><strong>{server.name}</strong><span>{server.hostname || 'Sin hostname'}</span></div></div></td><td>{server.providers?.name || <span className="muted-cell">Sin proveedor</span>}</td><td><span className="type-chip">{typeNames[server.server_type] || server.server_type}</span></td><td>{server.location ? <span className="location-cell"><MapPin size={14}/>{server.location}</span> : <span className="muted-cell">—</span>}</td><td><span className={`status-pill ${server.status}`}>{statusNames[server.status] || server.status}</span></td><td><div className="row-actions"><button className="icon-button" title="Editar" onClick={() => openEdit(server)}><Edit2 size={15}/></button>{server.management_url && <a className="icon-button" href={server.management_url} target="_blank" rel="noreferrer" title="Abrir panel"><ExternalLink size={15}/></a>}<button className="icon-button danger-hover" title="Eliminar" onClick={() => remove(server)}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div>}
      <div className="table-footer"><span>Mostrando {filtered.length} de {servers.length} servidores</span><span>Inventario manual</span></div>
    </section>
    {modalOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModalOpen(false) }}><form className="modal-card" onSubmit={save}><div className="modal-heading"><div><div className="eyebrow">INVENTARIO</div><h2>{editing ? 'Editar servidor' : 'Nuevo servidor'}</h2><p>Completá los datos principales del equipo.</p></div><button type="button" className="icon-button" onClick={() => setModalOpen(false)}><X size={19}/></button></div><div className="form-grid"><div className="form-field full"><label>Nombre del servidor *</label><input className="input" value={form.name} onChange={e => update('name',e.target.value)} placeholder="Ej. VPS Docker 01" required autoFocus/></div><div className="form-field"><label>Hostname</label><input className="input" value={form.hostname} onChange={e => update('hostname',e.target.value)} placeholder="server01.midominio.com"/></div><div className="form-field"><label>Proveedor</label><select className="input" value={form.provider_id} onChange={e => update('provider_id',e.target.value)}><option value="">Sin proveedor</option>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div><div className="form-field"><label>Tipo de servidor</label><select className="input" value={form.server_type} onChange={e => update('server_type',e.target.value as ServerType)}>{Object.entries(typeNames).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="form-field"><label>Sistema operativo</label><input className="input" value={form.operating_system} onChange={e => update('operating_system',e.target.value)} placeholder="Ubuntu 24.04 LTS"/></div><div className="form-field"><label>CPU</label><input className="input" value={form.cpu} onChange={e => update('cpu',e.target.value)} placeholder="4 vCPU"/></div><div className="form-field"><label>RAM (GB)</label><input className="input" type="number" min="0" step="0.25" value={form.ram_gb} onChange={e => update('ram_gb',e.target.value)} placeholder="8"/></div><div className="form-field"><label>Almacenamiento (GB)</label><input className="input" type="number" min="0" step="1" value={form.storage_gb} onChange={e => update('storage_gb',e.target.value)} placeholder="160"/></div><div className="form-field"><label>Ubicación</label><input className="input" value={form.location} onChange={e => update('location',e.target.value)} placeholder="Frankfurt, Alemania"/></div><div className="form-field"><label>IP pública</label><input className="input" value={form.public_ip} onChange={e => update('public_ip',e.target.value)} placeholder="203.0.113.10"/></div><div className="form-field"><label>IP privada</label><input className="input" value={form.private_ip} onChange={e => update('private_ip',e.target.value)} placeholder="10.0.0.10"/></div><div className="form-field"><label>Estado</label><select className="input" value={form.status} onChange={e => update('status',e.target.value as ServerStatus)}>{Object.entries(statusNames).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="form-field"><label>URL de administración</label><input className="input" type="url" value={form.management_url} onChange={e => update('management_url',e.target.value)} placeholder="https://panel.proveedor.com"/></div><div className="form-field"><label>Vencimiento</label><input className="input" type="date" value={form.expires_at} onChange={e => update('expires_at',e.target.value)}/></div><div className="form-field full"><label>Notas</label><textarea className="input textarea" rows={3} value={form.notes} onChange={e => update('notes',e.target.value)} placeholder="Información adicional del servidor…"/></div></div>{error && <div className="alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModalOpen(false)}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Registrar servidor'}</button></div></form></div>}
  </div>
}
