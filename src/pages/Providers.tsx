import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ExternalLink,
  Filter,
  Globe2,
  Plus,
  Search,
  Server,
  Tags,
  Trash2,
  Edit2,
  X
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Provider, ProviderType } from '../types'

type FormState = {
  name: string
  provider_type: ProviderType
  website: string
  panel_url: string
  contact_info: string
  notes: string
}

const emptyForm: FormState = {
  name: '',
  provider_type: 'hosting',
  website: '',
  panel_url: '',
  contact_info: '',
  notes: ''
}

const typeLabels: Record<ProviderType, string> = {
  hosting: 'Hosting / Servidores',
  cloud: 'Cloud / VPS',
  cdn: 'CDN',
  dns: 'DNS',
  registrar: 'Registrador de Dominios',
  datacenter: 'Datacenter / Colocation',
  other: 'Otro'
}

export default function Providers({ workspaceId }: { workspaceId: string }) {
  const [providers, setProviders] = useState<Provider[]>([])
  const [serverCounts, setServerCounts] = useState<Record<string, number>>({})
  const [domainCounts, setDomainCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Provider | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [provRes, srvRes, domRes] = await Promise.all([
      supabase!.from('providers').select('*').eq('workspace_id', workspaceId).order('name', { ascending: true }),
      supabase!.from('servers').select('provider_id').eq('workspace_id', workspaceId).not('provider_id', 'is', null),
      supabase!.from('domains').select('registrar_provider_id, dns_provider_id').eq('workspace_id', workspaceId)
    ])

    if (provRes.error) {
      setError(provRes.error.message)
    } else {
      setProviders((provRes.data || []) as Provider[])
    }

    if (srvRes.data) {
      const counts: Record<string, number> = {}
      for (const row of srvRes.data) {
        if (row.provider_id) counts[row.provider_id] = (counts[row.provider_id] || 0) + 1
      }
      setServerCounts(counts)
    }

    if (domRes.data) {
      const counts: Record<string, number> = {}
      for (const row of domRes.data) {
        if (row.registrar_provider_id) counts[row.registrar_provider_id] = (counts[row.registrar_provider_id] || 0) + 1
        if (row.dns_provider_id && row.dns_provider_id !== row.registrar_provider_id) {
          counts[row.dns_provider_id] = (counts[row.dns_provider_id] || 0) + 1
        }
      }
      setDomainCounts(counts)
    }

    setLoading(false)
  }, [workspaceId])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    return providers.filter(p => {
      const text = `${p.name} ${p.website || ''} ${p.notes || ''}`.toLowerCase()
      return text.includes(query.toLowerCase()) && (typeFilter === 'all' || p.provider_type === typeFilter)
    })
  }, [providers, query, typeFilter])

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setError('')
    setModalOpen(true)
  }

  function openEdit(p: Provider) {
    setEditing(p)
    setForm({
      name: p.name,
      provider_type: p.provider_type,
      website: p.website || '',
      panel_url: p.panel_url || '',
      contact_info: p.contact_info || '',
      notes: p.notes || ''
    })
    setError('')
    setModalOpen(true)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const payload = {
      workspace_id: workspaceId,
      name: form.name.trim(),
      provider_type: form.provider_type,
      website: form.website.trim() || null,
      panel_url: form.panel_url.trim() || null,
      contact_info: form.contact_info.trim() || null,
      notes: form.notes.trim() || null
    }

    if (editing) {
      const { error: updErr } = await supabase!
        .from('providers')
        .update(payload)
        .eq('id', editing.id)
        .eq('workspace_id', workspaceId)

      if (updErr) {
        setError(updErr.message)
        setSaving(false)
        return
      }
      setNotice('Proveedor actualizado.')
    } else {
      const { error: insErr } = await supabase!.from('providers').insert(payload)
      if (insErr) {
        setError(insErr.message)
        setSaving(false)
        return
      }
      setNotice('Proveedor creado.')
    }

    setModalOpen(false)
    setSaving(false)
    await load()
  }

  async function remove(p: Provider) {
    if (!window.confirm(`¿Eliminar el proveedor “${p.name}”?`)) return
    const { error: delErr } = await supabase!.from('providers').delete().eq('id', p.id).eq('workspace_id', workspaceId)
    if (delErr) {
      setError(delErr.message)
    } else {
      setNotice('Proveedor eliminado.')
      await load()
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ORGANIZACIÓN</div>
          <h1>Proveedores</h1>
          <p>Administrá empresas de hosting, clouds, registradores y servicios externos.</p>
        </div>
        <button className="button primary" onClick={openNew}>
          <Plus size={17} /> Agregar proveedor
        </button>
      </div>

      <div className="server-summary">
        <div>
          <span className="summary-icon">
            <Tags size={18} />
          </span>
          <div>
            <strong>{providers.length}</strong>
            <span>Proveedores registrados</span>
          </div>
        </div>
        <div>
          <span className="summary-icon green">
            <Server size={18} />
          </span>
          <div>
            <strong>{Object.values(serverCounts).reduce((a, b) => a + b, 0)}</strong>
            <span>Servidores vinculados</span>
          </div>
        </div>
        <div>
          <span className="summary-icon orange">
            <Globe2 size={18} />
          </span>
          <div>
            <strong>{Object.values(domainCounts).reduce((a, b) => a + b, 0)}</strong>
            <span>Dominios vinculados</span>
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

      <section className="panel table-panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar por nombre, web o notas…"
            />
          </div>
          <div className="filter-wrap">
            <Filter size={16} />
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">Todos los tipos</option>
              {Object.entries(typeLabels).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="table-empty">Cargando proveedores…</div>
        ) : filtered.length === 0 ? (
          <div className="table-empty">
            <div className="empty-icon">
              <Tags size={22} />
            </div>
            <strong>{providers.length ? 'No hay resultados' : 'Todavía no registraste proveedores'}</strong>
            <span>{providers.length ? 'Probá cambiar la búsqueda.' : 'Agregá tu primer proveedor para comenzar.'}</span>
            {!providers.length && (
              <button className="button secondary" onClick={openNew}>
                <Plus size={16} /> Agregar proveedor
              </button>
            )}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>Tipo</th>
                  <th>Servidores</th>
                  <th>Dominios</th>
                  <th>Sitio web / Panel</th>
                  <th>Notas</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const sCount = serverCounts[p.id] || 0
                  const dCount = domainCounts[p.id] || 0
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="server-cell">
                          <div className="server-table-icon">
                            <Tags size={16} />
                          </div>
                          <div>
                            <strong>{p.name}</strong>
                            <span>{p.contact_info || 'Sin datos de contacto'}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="type-chip">{typeLabels[p.provider_type] || p.provider_type}</span>
                      </td>
                      <td>
                        <span className="ip-badge">
                          <Server size={11} /> {sCount} {sCount === 1 ? 'Servidor' : 'Servidores'}
                        </span>
                      </td>
                      <td>
                        <span className="ip-badge">
                          <Globe2 size={11} /> {dCount} {dCount === 1 ? 'Dominio' : 'Dominios'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {p.website && (
                            <a
                              href={p.website}
                              target="_blank"
                              rel="noreferrer"
                              className="text-link"
                              title="Abrir sitio web"
                            >
                              Web <ExternalLink size={12} />
                            </a>
                          )}
                          {p.panel_url && (
                            <a
                              href={p.panel_url}
                              target="_blank"
                              rel="noreferrer"
                              className="button secondary"
                              style={{ height: '24px', padding: '0 8px', fontSize: '9px' }}
                              title="Abrir panel del proveedor"
                            >
                              Panel <ExternalLink size={11} />
                            </a>
                          )}
                          {!p.website && !p.panel_url && <span className="muted-cell">—</span>}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '10px', color: '#64748b', maxWidth: '200px', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.notes || '—'}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="icon-button" title="Editar" onClick={() => openEdit(p)}>
                            <Edit2 size={15} />
                          </button>
                          <button
                            className="icon-button danger-hover"
                            title="Eliminar"
                            onClick={() => remove(p)}
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
            Mostrando {filtered.length} de {providers.length} proveedores
          </span>
          <span>Inventario manual</span>
        </div>
      </section>

      {/* MODAL CREAR / EDITAR PROVEEDOR */}
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
                <div className="eyebrow">ORGANIZACIÓN</div>
                <h2>{editing ? 'Editar proveedor' : 'Nuevo proveedor'}</h2>
                <p>Completá los datos del proveedor o registrador.</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setModalOpen(false)}>
                <X size={19} />
              </button>
            </div>

            <div className="form-grid">
              <div className="form-field full">
                <label>Nombre del proveedor *</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={e => setForm(old => ({ ...old, name: e.target.value }))}
                  placeholder="Ej. OVHcloud, Hetzner, Cloudflare, Donweb..."
                  required
                  autoFocus
                />
              </div>

              <div className="form-field">
                <label>Tipo de proveedor</label>
                <select
                  className="input"
                  value={form.provider_type}
                  onChange={e => setForm(old => ({ ...old, provider_type: e.target.value as ProviderType }))}
                >
                  {Object.entries(typeLabels).map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label>Datos de contacto / ID cliente</label>
                <input
                  className="input"
                  value={form.contact_info}
                  onChange={e => setForm(old => ({ ...old, contact_info: e.target.value }))}
                  placeholder="Ej. NIC handle, email de soporte o ID de cliente"
                />
              </div>

              <div className="form-field">
                <label>Sitio web</label>
                <input
                  className="input"
                  type="url"
                  value={form.website}
                  onChange={e => setForm(old => ({ ...old, website: e.target.value }))}
                  placeholder="https://www.proveedor.com"
                />
              </div>

              <div className="form-field">
                <label>URL de acceso al panel</label>
                <input
                  className="input"
                  type="url"
                  value={form.panel_url}
                  onChange={e => setForm(old => ({ ...old, panel_url: e.target.value }))}
                  placeholder="https://panel.proveedor.com"
                />
              </div>

              <div className="form-field full">
                <label>Notas adicionales</label>
                <textarea
                  className="input textarea"
                  rows={3}
                  value={form.notes}
                  onChange={e => setForm(old => ({ ...old, notes: e.target.value }))}
                  placeholder="Detalles sobre facturación, métodos de pago o soporte..."
                />
              </div>
            </div>

            {error && <div className="alert error">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setModalOpen(false)}>
                Cancelar
              </button>
              <button className="button primary" disabled={saving}>
                {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Registrar proveedor'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
