import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { ArrowLeft, Save, Server } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSetBreadcrumbs } from '../lib/breadcrumbs'
import type { Provider, Server as ServerRecord, ServerStatus, ServerType } from '../types'

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
  server_type: 'dedicated',
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

export default function ServerForm({ workspaceId, isNew }: { workspaceId: string; isNew?: boolean }) {
  const { serverId } = useParams<{ serverId: string }>()
  const navigate = useNavigate()

  const [form, setForm] = useState<FormState>(emptyForm)
  const [providers, setProviders] = useState<Provider[]>([])
  const [serverName, setServerName] = useState('')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Set breadcrumbs dynamically
  useSetBreadcrumbs(
    isNew
      ? [
          { label: 'Servidores', to: '/servers' },
          { label: 'Nuevo servidor' }
        ]
      : [
          { label: 'Servidores', to: '/servers' },
          { label: serverName || 'Cargando…', to: serverId ? `/servers/${serverId}` : undefined },
          { label: 'Editar' }
        ]
  )

  useEffect(() => {
    // Load providers
    void supabase!
      .from('providers')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name')
      .then(({ data }) => {
        if (data) setProviders(data as Provider[])
      })

    if (!isNew && serverId) {
      void supabase!
        .from('servers')
        .select('*')
        .eq('id', serverId)
        .eq('workspace_id', workspaceId)
        .single()
        .then(({ data, error: err }) => {
          if (err || !data) {
            setError(err ? err.message : 'Servidor no encontrado')
            setLoading(false)
            return
          }
          const s = data as ServerRecord
          setServerName(s.name)
          setForm({
            name: s.name,
            hostname: s.hostname || '',
            provider_id: s.provider_id || '',
            server_type: s.server_type,
            operating_system: s.operating_system || '',
            cpu: s.cpu || '',
            ram_gb: s.ram_gb ? String(s.ram_gb) : '',
            storage_gb: s.storage_gb ? String(s.storage_gb) : '',
            location: s.location || '',
            public_ip: '',
            private_ip: '',
            monthly_cost: s.monthly_cost ? String(s.monthly_cost) : '',
            status: s.status,
            management_url: s.management_url || '',
            expires_at: s.expires_at || '',
            notes: s.notes || ''
          })
          setLoading(false)
        })
    }
  }, [workspaceId, serverId, isNew])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(old => ({ ...old, [key]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

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
      notes: form.notes.trim() || null,
      monthly_cost: form.monthly_cost ? Number(form.monthly_cost) : null
    }

    if (isNew) {
      const { data, error: insertError } = await supabase!
        .from('servers')
        .insert(payload)
        .select('id')
        .single()

      if (insertError) {
        setError(insertError.message)
        setSaving(false)
        return
      }

      const newId = data.id

      // If initial public/private IP provided, register it
      const ipRows = []
      if (form.public_ip.trim()) {
        ipRows.push({
          workspace_id: workspaceId,
          server_id: newId,
          address: form.public_ip.trim(),
          ip_type: 'public' as const,
          label: 'IP pública principal'
        })
      }
      if (form.private_ip.trim()) {
        ipRows.push({
          workspace_id: workspaceId,
          server_id: newId,
          address: form.private_ip.trim(),
          ip_type: 'private' as const,
          label: 'IP privada'
        })
      }
      if (ipRows.length) {
        await supabase!.from('ip_addresses').insert(ipRows)
      }

      navigate(`/servers/${newId}`)
    } else if (serverId) {
      const { error: updateError } = await supabase!
        .from('servers')
        .update(payload)
        .eq('id', serverId)
        .eq('workspace_id', workspaceId)

      if (updateError) {
        setError(updateError.message)
        setSaving(false)
        return
      }

      navigate(`/servers/${serverId}`)
    }
    setSaving(false)
  }

  const backUrl = isNew ? '/servers' : `/servers/${serverId}`

  if (loading) {
    return (
      <div className="table-empty">
        <div className="spinner" /> Cargando datos del servidor…
      </div>
    )
  }

  return (
    <div className="server-form-page">
      <div style={{ marginBottom: '18px' }}>
        <Link to={backUrl} className="button secondary" style={{ height: '36px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <ArrowLeft size={16} /> Volver a {isNew ? 'Servidores' : serverName || 'Servidor'}
        </Link>
      </div>

      {error && <div className="alert error" style={{ marginBottom: '16px' }}>{error}</div>}

      <section className="inpage-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '22px', borderBottom: '1px solid #f1f5f9', paddingBottom: '16px' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#eff6ff', color: '#2563eb', display: 'grid', placeItems: 'center' }}>
            <Server size={22} />
          </div>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0, color: '#1e293b' }}>
              {isNew ? 'Registrar nuevo servidor' : `Editar servidor: ${serverName}`}
            </h1>
            <span style={{ fontSize: '13px', color: '#64748b' }}>
              {isNew ? 'Ingresá las especificaciones y configuración de tu servidor.' : 'Modificá los parámetros, costos o notas técnicas.'}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-field">
              <label>Nombre identificatorio *</label>
              <input
                className="input"
                required
                placeholder="ej. ns559079.superCwp"
                value={form.name}
                onChange={e => update('name', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>Hostname / FQDN</label>
              <input
                className="input"
                placeholder="ej. ns559079.ip-198-50-231.net"
                value={form.hostname}
                onChange={e => update('hostname', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>Proveedor / Datacenter</label>
              <select
                className="input"
                value={form.provider_id}
                onChange={e => update('provider_id', e.target.value)}
              >
                <option value="">Sin proveedor asignado</option>
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
                <option value="dedicated">Dedicado (Bare Metal)</option>
                <option value="vps">VPS (Virtual Private Server)</option>
                <option value="cloud">Cloud Instance</option>
                <option value="physical">Servidor Físico</option>
                <option value="virtual_machine">Máquina Virtual</option>
                <option value="other">Otro</option>
              </select>
            </div>

            <div className="form-field">
              <label>Costo mensual del servidor ($)</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={form.monthly_cost}
                onChange={e => update('monthly_cost', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>Estado operativo</label>
              <select
                className="input"
                value={form.status}
                onChange={e => update('status', e.target.value as ServerStatus)}
              >
                <option value="active">Activo</option>
                <option value="maintenance">Mantenimiento</option>
                <option value="inactive">Inactivo</option>
                <option value="decommissioned">Baja</option>
              </select>
            </div>

            <div className="form-field">
              <label>Sistema Operativo</label>
              <input
                className="input"
                placeholder="ej. AlmaLinux 8 / Ubuntu 24.04"
                value={form.operating_system}
                onChange={e => update('operating_system', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>Procesador (CPU)</label>
              <input
                className="input"
                placeholder="ej. AMD EPYC 7763 64C/128T"
                value={form.cpu}
                onChange={e => update('cpu', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>Memoria RAM (GB)</label>
              <input
                className="input"
                type="number"
                min="0"
                placeholder="ej. 64"
                value={form.ram_gb}
                onChange={e => update('ram_gb', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>Almacenamiento (GB)</label>
              <input
                className="input"
                type="number"
                min="0"
                placeholder="ej. 2000"
                value={form.storage_gb}
                onChange={e => update('storage_gb', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>Ubicación / Región</label>
              <input
                className="input"
                placeholder="ej. Beauharnois (BHS), Canadá"
                value={form.location}
                onChange={e => update('location', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>URL Panel de Gestión</label>
              <input
                className="input"
                type="url"
                placeholder="https://ca.ovh.com/manager/..."
                value={form.management_url}
                onChange={e => update('management_url', e.target.value)}
              />
            </div>

            {isNew && (
              <>
                <div className="form-field">
                  <label>IP Pública inicial (opcional)</label>
                  <input
                    className="input"
                    placeholder="ej. 198.50.231.236"
                    value={form.public_ip}
                    onChange={e => update('public_ip', e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label>IP Privada inicial (opcional)</label>
                  <input
                    className="input"
                    placeholder="ej. 10.0.0.1"
                    value={form.private_ip}
                    onChange={e => update('private_ip', e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="form-field full">
              <label>Notas internas</label>
              <textarea
                className="input"
                rows={3}
                placeholder="Anotaciones sobre servicios corriendo, contratos, accesos…"
                value={form.notes}
                onChange={e => update('notes', e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px', borderTop: '1px solid #f1f5f9', paddingTop: '18px' }}>
            <Link to={backUrl} className="button secondary">
              Cancelar
            </Link>
            <button type="submit" className="button primary" disabled={saving}>
              <Save size={16} />
              {saving ? 'Guardando…' : isNew ? 'Registrar servidor' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
