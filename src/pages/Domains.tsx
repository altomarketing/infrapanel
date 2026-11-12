import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Calendar,
  Check,
  Copy,
  DollarSign,
  Edit2,
  Filter,
  Globe2,
  Plus,
  Search,
  Server,
  Trash2,
  X
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSetBreadcrumbs } from '../lib/breadcrumbs'
import type { Domain, DomainStatus, IPAddress, Provider, Server as ServerRecord } from '../types'

type FormState = {
  name: string
  registrar_provider_id: string
  dns_provider_id: string
  target_ip: string
  server_id: string
  monthly_cost: string
  expires_at: string
  auto_renew: boolean
  status: DomainStatus
  notes: string
}

const emptyForm: FormState = {
  name: '',
  registrar_provider_id: '',
  dns_provider_id: '',
  target_ip: '',
  server_id: '',
  monthly_cost: '',
  expires_at: '',
  auto_renew: true,
  status: 'active',
  notes: ''
}

const statusLabels: Record<DomainStatus, string> = {
  active: 'Activo',
  pending: 'Pendiente',
  expired: 'Vencido',
  inactive: 'Inactivo'
}

export default function Domains({ workspaceId }: { workspaceId: string }) {
  useSetBreadcrumbs([{ label: 'Dominios' }])
  const [domains, setDomains] = useState<Domain[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [servers, setServers] = useState<ServerRecord[]>([])
  const [availableIps, setAvailableIps] = useState<IPAddress[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Domain | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [copiedIp, setCopiedIp] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [domRes, provRes, srvRes, ipRes] = await Promise.all([
      supabase!
        .from('domains')
        .select('*, registrar_provider:providers!registrar_provider_id(name), dns_provider:providers!dns_provider_id(name), servers(name, hostname)')
        .eq('workspace_id', workspaceId)
        .order('name', { ascending: true }),
      supabase!.from('providers').select('id,name').eq('workspace_id', workspaceId).order('name'),
      supabase!.from('servers').select('id,name,hostname').eq('workspace_id', workspaceId).order('name'),
      supabase!.from('ip_addresses').select('id,address,label,purpose,server_id').eq('workspace_id', workspaceId).order('address')
    ])

    if (domRes.error) {
      // If server_id or target_ip relation failed because column doesn't exist yet, fallback to simple select
      const fallback = await supabase!.from('domains').select('*').eq('workspace_id', workspaceId)
      if (fallback.error) {
        setError(fallback.error.message)
      } else {
        setDomains((fallback.data || []) as Domain[])
      }
    } else {
      setDomains((domRes.data || []) as Domain[])
    }

    if (!provRes.error) setProviders((provRes.data || []) as Provider[])
    if (!srvRes.error) setServers((srvRes.data || []) as ServerRecord[])
    if (!ipRes.error) {
      const onlyIpv4 = ((ipRes.data || []) as IPAddress[]).filter(ip => !ip.address.includes(':'))
      setAvailableIps(onlyIpv4)
    }

    setLoading(false)
  }, [workspaceId])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    return domains.filter(d => {
      const text = `${d.name} ${d.target_ip || ''} ${d.notes || ''} ${d.registrar_provider?.name || ''} ${d.servers?.name || ''}`.toLowerCase()
      return text.includes(query.toLowerCase()) && (statusFilter === 'all' || d.status === statusFilter)
    })
  }, [domains, query, statusFilter])

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setModalOpen(true)
  }

  function openEdit(d: Domain) {
    setEditing(d)
    setForm({
      name: d.name,
      registrar_provider_id: d.registrar_provider_id || '',
      dns_provider_id: d.dns_provider_id || '',
      target_ip: d.target_ip || '',
      server_id: d.server_id || '',
      monthly_cost: d.monthly_cost?.toString() || '',
      expires_at: d.expires_at || '',
      auto_renew: d.auto_renew ?? true,
      status: d.status,
      notes: d.notes || ''
    })
    setError('')
    setModalOpen(true)
  }

  function handleServerChange(serverId: string) {
    setForm(old => {
      let autoIp = old.target_ip
      // If no IP is filled yet, pick the first IP associated with this server
      if (!autoIp && serverId) {
        const found = availableIps.find(ip => ip.server_id === serverId)
        if (found) autoIp = found.address
      }
      return { ...old, server_id: serverId, target_ip: autoIp }
    })
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const payload: Record<string, unknown> = {
      workspace_id: workspaceId,
      name: form.name.trim().toLowerCase(),
      registrar_provider_id: form.registrar_provider_id || null,
      dns_provider_id: form.dns_provider_id || null,
      expires_at: form.expires_at || null,
      auto_renew: form.auto_renew,
      status: form.status,
      notes: form.notes.trim() || null
    }

    // Add target_ip, server_id, monthly_cost
    if (form.target_ip.trim()) payload.target_ip = form.target_ip.trim()
    else payload.target_ip = null

    if (form.server_id) payload.server_id = form.server_id
    else payload.server_id = null

    if (form.monthly_cost) payload.monthly_cost = Number(form.monthly_cost)
    else payload.monthly_cost = null

    let opError = null

    if (editing) {
      const { error: updErr } = await supabase!
        .from('domains')
        .update(payload)
        .eq('id', editing.id)
        .eq('workspace_id', workspaceId)

      opError = updErr
      if (!updErr) setNotice('Dominio actualizado.')
    } else {
      const { error: insErr } = await supabase!.from('domains').insert(payload)
      opError = insErr
      if (!insErr) setNotice('Dominio registrado.')
    }

    if (opError) {
      // If error is because columns don't exist yet, notify user to run SQL
      if (opError.message.includes('target_ip') || opError.message.includes('server_id') || opError.message.includes('monthly_cost')) {
        setError(`Para guardar IP o costo en dominios, ejecuta el script de actualización SQL en Supabase: ${opError.message}`)
      } else {
        setError(opError.message)
      }
      setSaving(false)
      return
    }

    setModalOpen(false)
    setSaving(false)
    await load()
  }

  async function remove(d: Domain) {
    if (!window.confirm(`¿Eliminar el dominio “${d.name}”?`)) return
    const { error: delErr } = await supabase!.from('domains').delete().eq('id', d.id).eq('workspace_id', workspaceId)
    if (delErr) {
      setError(delErr.message)
    } else {
      setNotice('Dominio eliminado.')
      await load()
    }
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text)
    setCopiedIp(text)
    setTimeout(() => setCopiedIp(null), 2000)
  }

  const totalMonthly = useMemo(() => {
    return domains.reduce((sum, d) => sum + (d.monthly_cost || 0), 0)
  }, [domains])

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <div className="eyebrow">DIRECCIONAMIENTO</div>
          <h1>Dominios</h1>
          <p>Administrá tus dominios web, registradores, costos y las IPs a las que apuntan.</p>
        </div>
        <button className="button primary" onClick={openNew}>
          <Plus size={17} /> Agregar dominio
        </button>
      </div>

      <div className="server-summary">
        <div>
          <span className="summary-icon">
            <Globe2 size={18} />
          </span>
          <div>
            <strong>{domains.length}</strong>
            <span>Dominios registrados</span>
          </div>
        </div>
        <div>
          <span className="summary-icon green">
            <Server size={18} />
          </span>
          <div>
            <strong>{domains.filter(d => d.target_ip || d.server_id).length}</strong>
            <span>Asociados a IP o servidor</span>
          </div>
        </div>
        <div>
          <span className="summary-icon orange">
            <DollarSign size={18} />
          </span>
          <div>
            <strong>${totalMonthly.toFixed(2)}</strong>
            <span>Costo mensual en dominios</span>
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

      {error && !modalOpen && <div className="alert error">{error}</div>}

      {/* IN-PAGE FORM: CREAR / EDITAR DOMINIO (NO MODAL) */}
      {modalOpen && (
        <section className="inpage-card" style={{ marginBottom: '22px' }}>
          <form onSubmit={save}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px' }}>
              <div>
                <div className="eyebrow">DIRECCIONAMIENTO</div>
                <h2 style={{ margin: '2px 0 0', fontSize: '18px', fontWeight: 800, color: '#1e293b' }}>
                  {editing ? 'Editar dominio' : 'Registrar nuevo dominio'}
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                  Completá los datos del dominio y la IP a la que apunta.
                </p>
              </div>
              <button type="button" className="icon-button" onClick={() => setModalOpen(false)}>
                <X size={19} />
              </button>
            </div>

            <div className="form-grid">
              <div className="form-field full">
                <label>Nombre del dominio *</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={e => setForm(old => ({ ...old, name: e.target.value }))}
                  placeholder="Ej. midominio.com, radio11.servidorderadio.net..."
                  required
                  autoFocus
                />
              </div>

              {/* Server selector */}
              <div className="form-field">
                <label>Servidor asociado (opcional)</label>
                <select
                  className="input"
                  value={form.server_id}
                  onChange={e => handleServerChange(e.target.value)}
                >
                  <option value="">Sin servidor asignado</option>
                  {servers.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.hostname ? `(${s.hostname})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Target IP */}
              <div className="form-field">
                <label>Dirección IP a la que apunta</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    className="input"
                    value={form.target_ip}
                    onChange={e => setForm(old => ({ ...old, target_ip: e.target.value }))}
                    placeholder="Ej. 54.39.104.54"
                  />
                  {availableIps.length > 0 && (
                    <select
                      className="input"
                      style={{ width: 'auto', maxWidth: '140px' }}
                      onChange={e => {
                        if (e.target.value) setForm(old => ({ ...old, target_ip: e.target.value }))
                      }}
                      value=""
                    >
                      <option value="" disabled>
                        Elegir IP…
                      </option>
                      {availableIps.map(ip => (
                        <option key={ip.id} value={ip.address}>
                          {ip.address} {ip.label ? `(${ip.label})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="form-field">
                <label>Registrador de dominio</label>
                <select
                  className="input"
                  value={form.registrar_provider_id}
                  onChange={e => setForm(old => ({ ...old, registrar_provider_id: e.target.value }))}
                >
                  <option value="">Sin registrador</option>
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label>Proveedor de DNS</label>
                <select
                  className="input"
                  value={form.dns_provider_id}
                  onChange={e => setForm(old => ({ ...old, dns_provider_id: e.target.value }))}
                >
                  <option value="">Sin proveedor DNS (o mismo que registrador)</option>
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label>Costo mensual estimado ($)</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monthly_cost}
                  onChange={e => setForm(old => ({ ...old, monthly_cost: e.target.value }))}
                  placeholder="Ej. 1.25 (o prorrateo anual)"
                />
              </div>

              <div className="form-field">
                <label>Fecha de vencimiento</label>
                <input
                  className="input"
                  type="date"
                  value={form.expires_at}
                  onChange={e => setForm(old => ({ ...old, expires_at: e.target.value }))}
                />
              </div>

              <div className="form-field">
                <label>Estado del dominio</label>
                <select
                  className="input"
                  value={form.status}
                  onChange={e => setForm(old => ({ ...old, status: e.target.value as DomainStatus }))}
                >
                  {Object.entries(statusLabels).map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field" style={{ justifyContent: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '16px' }}>
                  <input
                    type="checkbox"
                    checked={form.auto_renew}
                    onChange={e => setForm(old => ({ ...old, auto_renew: e.target.checked }))}
                  />
                  <span>Renovación automática habilitada</span>
                </label>
              </div>

              <div className="form-field full">
                <label>Notas adicionales</label>
                <textarea
                  className="input textarea"
                  rows={3}
                  value={form.notes}
                  onChange={e => setForm(old => ({ ...old, notes: e.target.value }))}
                  placeholder="Nameservers, registro TXT de verificación, etc..."
                />
              </div>
            </div>

            {error && <div className="alert error" style={{ marginTop: '14px' }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
              <button type="button" className="button secondary" onClick={() => setModalOpen(false)}>
                Cancelar
              </button>
              <button className="button primary" disabled={saving}>
                {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Registrar dominio'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="panel table-panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar por dominio, IP, servidor o notas…"
            />
          </div>
          <div className="filter-wrap">
            <Filter size={16} />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">Todos los estados</option>
              {Object.entries(statusLabels).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="table-empty">Cargando dominios…</div>
        ) : filtered.length === 0 ? (
          <div className="table-empty">
            <div className="empty-icon">
              <Globe2 size={22} />
            </div>
            <strong>{domains.length ? 'No hay resultados' : 'Todavía no registraste dominios'}</strong>
            <span>{domains.length ? 'Probá cambiar la búsqueda.' : 'Agregá tu primer dominio y asócialo a una IP.'}</span>
            {!domains.length && (
              <button className="button secondary" onClick={openNew}>
                <Plus size={16} /> Agregar dominio
              </button>
            )}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Dominio</th>
                  <th>IP Asociada</th>
                  <th>Servidor</th>
                  <th>Registrador / DNS</th>
                  <th>Costo / Mes</th>
                  <th>Vencimiento</th>
                  <th>Estado</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(d => (
                  <tr key={d.id}>
                    <td>
                      <div className="server-cell">
                        <div className="server-table-icon">
                          <Globe2 size={16} />
                        </div>
                        <div>
                          <strong>{d.name}</strong>
                          <span>{d.notes || (d.auto_renew ? 'Auto-renovación activa' : 'Renovación manual')}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      {d.target_ip ? (
                        <div className="ip-address-cell" style={{ fontSize: '10px' }}>
                          <span>{d.target_ip}</span>
                          <button
                            type="button"
                            className={`copy-pill ${copiedIp === d.target_ip ? 'copied' : ''}`}
                            onClick={() => copyToClipboard(d.target_ip!)}
                            title="Copiar IP"
                          >
                            {copiedIp === d.target_ip ? <Check size={11} /> : <Copy size={11} />}
                          </button>
                        </div>
                      ) : (
                        <span className="muted-cell">Sin IP asociada</span>
                      )}
                    </td>
                    <td>
                      {d.servers?.name ? (
                        <span className="type-chip">
                          <Server size={11} style={{ marginRight: '4px' }} />
                          {d.servers.name}
                        </span>
                      ) : (
                        <span className="muted-cell">—</span>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: '10px' }}>
                        <div>{d.registrar_provider?.name || '—'}</div>
                        {d.dns_provider?.name && d.dns_provider.name !== d.registrar_provider?.name && (
                          <span style={{ fontSize: '9px', color: '#8c95a2' }}>DNS: {d.dns_provider.name}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {d.monthly_cost ? (
                        <strong style={{ color: '#1e293b' }}>${Number(d.monthly_cost).toFixed(2)}</strong>
                      ) : (
                        <span className="muted-cell">—</span>
                      )}
                    </td>
                    <td>
                      {d.expires_at ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}>
                          <Calendar size={12} color="#94a3b8" />
                          {d.expires_at}
                        </span>
                      ) : (
                        <span className="muted-cell">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-pill ${d.status}`}>{statusLabels[d.status] || d.status}</span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-button" title="Editar" onClick={() => openEdit(d)}>
                          <Edit2 size={15} />
                        </button>
                        <button
                          className="icon-button danger-hover"
                          title="Eliminar"
                          onClick={() => remove(d)}
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
            Mostrando {filtered.length} de {domains.length} dominios
          </span>
          <span>Inventario manual</span>
        </div>
      </section>
    </div>
  )
}
