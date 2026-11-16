import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Save, Server, Boxes, Upload, Zap, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSetBreadcrumbs } from '../lib/breadcrumbs'
import { parseProxmoxApiResponse } from '../lib/proxmox'
import type { Provider, Server as ServerRecord, ServerStatus, ServerType } from '../types'

type FormState = {
  name: string
  hostname: string
  provider_id: string
  parent_id: string
  vm_id: string
  vm_type: 'qemu' | 'lxc'
  role: string
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
  parent_id: '',
  vm_id: '',
  vm_type: 'qemu',
  role: '',
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
  const [searchParams] = useSearchParams()
  const initialParent = searchParams.get('parent') || ''
  const navigate = useNavigate()

  const [form, setForm] = useState<FormState>({
    ...emptyForm,
    parent_id: initialParent,
    server_type: initialParent ? 'vps' : 'dedicated'
  })
  const [providers, setProviders] = useState<Provider[]>([])
  const [parentServers, setParentServers] = useState<ServerRecord[]>([])
  const [serverName, setServerName] = useState('')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Proxmox Direct Priority Mode
  const [creationMode, setCreationMode] = useState<'proxmox' | 'manual'>(initialParent ? 'manual' : 'proxmox')
  const [pveUrl, setPveUrl] = useState('')
  const [pveTokenId, setPveTokenId] = useState('root@pam!infrapanel')
  const [pveTokenSecret, setPveTokenSecret] = useState('')
  const [pveServerName, setPveServerName] = useState('')
  const [pveProviderId, setPveProviderId] = useState('')
  const [pvePublicIp, setPvePublicIp] = useState('')
  const [connectingPve, setConnectingPve] = useState(false)
  const [pveGuideOpen, setPveGuideOpen] = useState(true)
  const [copiedPveCmd, setCopiedPveCmd] = useState(false)
  const [pveFallbackJson, setPveFallbackJson] = useState('')
  const [showPveFallback, setShowPveFallback] = useState(false)

  async function handleProxmoxDirectConnect(e: FormEvent) {
    e.preventDefault()
    if (!pveUrl.trim() || !pveTokenId.trim() || !pveTokenSecret.trim()) {
      setError('Por favor completá la URL, Token ID y Token Secret de Proxmox.')
      return
    }

    setConnectingPve(true)
    setError('')
    setShowPveFallback(false)

    const cleanUrl = pveUrl.trim().replace(/\/+$/, '')
    const endpoint = `${cleanUrl}/api2/json/cluster/resources`

    let json: any = null
    try {
      const res = await fetch(endpoint, {
        headers: {
          Authorization: `PVEAPIToken=${pveTokenId.trim()}=${pveTokenSecret.trim()}`,
          Accept: 'application/json'
        }
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      json = await res.json()
    } catch (err: any) {
      setError(`No se pudo conectar directamente con Proxmox (${err.message}). Suele ocurrir si Proxmox usa certificado SSL autofirmado en el puerto 8006 o restringe CORS. Podés abrir ${cleanUrl} en otra pestaña para aceptar el certificado, o pegar el JSON abajo.`)
      setShowPveFallback(true)
      setConnectingPve(false)
      return
    }

    await createServerAndImportVms(json)
  }

  async function handleFallbackJsonImport(e: FormEvent) {
    e.preventDefault()
    if (!pveFallbackJson.trim()) return
    setConnectingPve(true)
    setError('')
    try {
      const json = JSON.parse(pveFallbackJson.trim())
      await createServerAndImportVms(json)
    } catch (err: any) {
      setError(`El texto ingresado no es un JSON válido: ${err.message}`)
      setConnectingPve(false)
    }
  }

  async function createServerAndImportVms(json: any) {
    const cleanUrl = pveUrl.trim().replace(/\/+$/, '')
    let detectedHostname = ''
    try {
      const urlObj = new URL(cleanUrl)
      detectedHostname = urlObj.hostname
    } catch {
      // ignore
    }

    const hostName = pveServerName.trim() || detectedHostname || 'Proxmox Hipervisor'

    const hostPayload: Record<string, unknown> = {
      workspace_id: workspaceId,
      name: hostName,
      hostname: detectedHostname || null,
      server_type: 'dedicated',
      status: 'active',
      operating_system: 'Proxmox VE',
      provider_id: pveProviderId || null,
      management_url: cleanUrl,
      proxmox_api_url: cleanUrl,
      proxmox_api_token_id: pveTokenId.trim(),
      proxmox_api_token_secret: pveTokenSecret.trim()
    }

    const { data: newHost, error: hostErr } = await supabase!
      .from('servers')
      .insert(hostPayload)
      .select('id')
      .single()

    if (hostErr || !newHost) {
      setError(`Error al registrar el servidor físico: ${hostErr?.message}`)
      setConnectingPve(false)
      return
    }

    const hostId = newHost.id

    if (pvePublicIp.trim()) {
      await supabase!.from('ip_addresses').insert({
        workspace_id: workspaceId,
        server_id: hostId,
        address: pvePublicIp.trim(),
        ip_type: 'public',
        label: 'IP principal host'
      })
    }

    const parsedList = parseProxmoxApiResponse(json)
    for (const item of parsedList) {
      const vmPayload: Record<string, unknown> = {
        workspace_id: workspaceId,
        parent_id: hostId,
        name: item.name,
        hostname: item.name,
        vm_id: String(item.vmid),
        vm_type: item.vm_type || 'qemu',
        server_type: 'vps',
        status: item.status === 'running' ? 'active' : 'inactive',
        cpu: item.cpus ? `${item.cpus} vCPU` : '2 vCPU',
        ram_gb: item.maxmem ? Math.round(item.maxmem / (1024 * 1024 * 1024)) : 4,
        storage_gb: item.maxdisk ? Math.round(item.maxdisk / (1024 * 1024 * 1024)) : 40
      }
      await supabase!.from('servers').upsert(vmPayload, { onConflict: 'workspace_id,name' })
    }

    navigate(`/servers/${hostId}`)
  }

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
    // Load providers & physical servers (potential parents)
    void supabase!
      .from('providers')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name')
      .then(({ data }) => {
        if (data) setProviders(data as Provider[])
      })

    void supabase!
      .from('servers')
      .select('id,name,hostname,server_type')
      .eq('workspace_id', workspaceId)
      .in('server_type', ['dedicated', 'physical', 'other'])
      .order('name')
      .then(({ data }) => {
        if (data) setParentServers(data as ServerRecord[])
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
            parent_id: s.parent_id || '',
            vm_id: s.vm_id ? String(s.vm_id) : '',
            vm_type: s.vm_type || 'qemu',
            role: s.role || '',
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
      parent_id: form.parent_id || null,
      vm_id: form.vm_id.trim() || null,
      vm_type: form.vm_type,
      role: form.role.trim() || null,
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
      let { data, error: insertError } = await supabase!
        .from('servers')
        .insert(payload)
        .select('id')
        .single()

      if (insertError && (insertError.message.includes('parent_id') || insertError.message.includes('vm_id'))) {
        // Fallback without new columns if migration not executed yet
        delete payload.parent_id
        delete payload.vm_id
        delete payload.vm_type
        delete payload.role
        const res = await supabase!.from('servers').insert(payload).select('id').single()
        data = res.data
        insertError = res.error
      }

      if (insertError) {
        setError(insertError.message)
        setSaving(false)
        return
      }

      const newId = data!.id

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
      let { error: updateError } = await supabase!
        .from('servers')
        .update(payload)
        .eq('id', serverId)
        .eq('workspace_id', workspaceId)

      if (updateError && (updateError.message.includes('parent_id') || updateError.message.includes('vm_id'))) {
        delete payload.parent_id
        delete payload.vm_id
        delete payload.vm_type
        delete payload.role
        updateError = (await supabase!.from('servers').update(payload).eq('id', serverId).eq('workspace_id', workspaceId)).error
      }

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

  const isVpsType = form.server_type === 'vps' || Boolean(form.parent_id)

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
          <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: isVpsType ? '#f0fdf4' : '#eff6ff', color: isVpsType ? '#16a34a' : '#2563eb', display: 'grid', placeItems: 'center' }}>
            {isVpsType ? <Boxes size={22} /> : <Server size={22} />}
          </div>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0, color: '#1e293b' }}>
              {isNew ? (isVpsType ? 'Registrar nuevo VPS / VM' : 'Registrar nuevo servidor') : `Editar servidor: ${serverName}`}
            </h1>
            <span style={{ fontSize: '13px', color: '#64748b' }}>
              {isNew ? 'Ingresá las especificaciones y configuración de tu equipo o máquina virtual.' : 'Modificá los parámetros, costos, vinculación o notas técnicas.'}
            </span>
          </div>
        </div>

        {isNew && !initialParent && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '22px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`button ${creationMode === 'proxmox' ? 'primary' : 'secondary'}`}
              style={{
                height: '38px',
                fontSize: '13px',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px'
              }}
              onClick={() => setCreationMode('proxmox')}
            >
              <Zap size={16} /> ⚡ Conexión Directa API Token (Proxmox VE) — Recomendado
            </button>
            <button
              type="button"
              className={`button ${creationMode === 'manual' ? 'primary' : 'secondary'}`}
              style={{
                height: '38px',
                fontSize: '13px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px'
              }}
              onClick={() => setCreationMode('manual')}
            >
              📝 Configuración Manual (Sin Proxmox / Genérico)
            </button>
          </div>
        )}

        {isNew && !initialParent && creationMode === 'proxmox' ? (
          <div>
            <form onSubmit={handleProxmoxDirectConnect}>
              {/* Guidance box */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldCheck size={18} color="#16a34a" />
                    <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                      Token de Solo Lectura con --privsep 1 (Aislamiento Total)
                    </strong>
                  </div>
                  <button
                    type="button"
                    style={{ border: 'none', background: 'none', color: '#2563eb', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => setPveGuideOpen(!pveGuideOpen)}
                  >
                    {pveGuideOpen ? 'Ocultar comandos SSH' : 'Ver comandos para crear el token en Proxmox'}
                  </button>
                </div>

                {pveGuideOpen && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
                    <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#475569' }}>
                      Ejecutá estos dos comandos en la terminal (Shell) de tu Proxmox para crear el token 100% aislado en solo lectura:
                    </p>
                    <div style={{ position: 'relative' }}>
                      <pre style={{ background: '#0f172a', color: '#38bdf8', padding: '12px 14px', borderRadius: '8px', fontSize: '11px', overflowX: 'auto', margin: 0, lineHeight: 1.6 }}>
{`# 1. Crear el token con separación de privilegios activa (--privsep 1)
pveum user token add root@pam infrapanel --privsep 1

# 2. Asignarle el rol PVEAuditor (SOLO LECTURA estricta, no hereda permisos de root)
pveum acl modify / -token 'root@pam!infrapanel' -role PVEAuditor`}
                      </pre>
                      <button
                        type="button"
                        className="button small"
                        style={{ position: 'absolute', top: '8px', right: '8px', fontSize: '11px', padding: '3px 8px' }}
                        onClick={() => {
                          navigator.clipboard.writeText("pveum user token add root@pam infrapanel --privsep 1\npveum acl modify / -token 'root@pam!infrapanel' -role PVEAuditor")
                          setCopiedPveCmd(true)
                          setTimeout(() => setCopiedPveCmd(false), 2000)
                        }}
                      >
                        {copiedPveCmd ? '✓ Copiado' : 'Copiar comandos'}
                      </button>
                    </div>
                    <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#64748b' }}>
                      El comando 1 te devolverá el <code>value</code> (UUID secreto). Pegalo abajo en <strong>Token Secret</strong>.
                    </p>
                  </div>
                )}
              </div>

              {/* Proxmox Form Fields */}
              <div className="form-grid">
                <div className="form-field">
                  <label>Nombre del Servidor en InfraPanel (opcional)</label>
                  <input
                    className="input"
                    placeholder="ej. ns5012993 o Proxmox-Node1"
                    value={pveServerName}
                    onChange={e => setPveServerName(e.target.value)}
                  />
                  <span style={{ fontSize: '10px', color: '#94a3b8' }}>Si se deja vacío, se usará el hostname detectado.</span>
                </div>

                <div className="form-field">
                  <label>URL Endpoint de Proxmox *</label>
                  <input
                    className="input"
                    required
                    placeholder="https://15.235.64.xxx:8006"
                    value={pveUrl}
                    onChange={e => setPveUrl(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>Token ID *</label>
                  <input
                    className="input"
                    required
                    placeholder="root@pam!infrapanel"
                    value={pveTokenId}
                    onChange={e => setPveTokenId(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>Token Secret (UUID del comando 1) *</label>
                  <input
                    className="input"
                    type="password"
                    required
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={pveTokenSecret}
                    onChange={e => setPveTokenSecret(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>IP Pública del Servidor Físico (opcional)</label>
                  <input
                    className="input"
                    placeholder="ej. 15.235.64.xxx"
                    value={pvePublicIp}
                    onChange={e => setPvePublicIp(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>Proveedor (opcional)</label>
                  <select
                    className="input"
                    value={pveProviderId}
                    onChange={e => setPveProviderId(e.target.value)}
                  >
                    <option value="">Sin proveedor asignado</option>
                    {providers.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
                <Link to={backUrl} className="button secondary">
                  Cancelar
                </Link>
                <button
                  type="submit"
                  className="button primary"
                  disabled={connectingPve}
                  style={{ height: '40px', fontSize: '13px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                >
                  <Zap size={16} />
                  {connectingPve ? 'Conectando y detectando VMs…' : '⚡ Conectar, Crear Servidor e Importar VPS'}
                </button>
              </div>
            </form>

            {/* Fallback in case of browser SSL self-signed restriction */}
            {showPveFallback && (
              <div style={{ marginTop: '24px', background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '10px', padding: '16px' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#b45309', fontWeight: 700 }}>
                  ¿Proxmox usa certificado autofirmado en el puerto 8006?
                </h4>
                <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#92400e' }}>
                  Los navegadores bloquean llamadas directas si el SSL de Proxmox es autofirmado.
                  Podés abrir <a href={pveUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 700, textDecoration: 'underline', color: '#2563eb' }}>{pveUrl} en otra pestaña</a> para aceptar el certificado, o pegar la respuesta JSON aquí:
                </p>
                <form onSubmit={handleFallbackJsonImport}>
                  <textarea
                    className="input"
                    rows={4}
                    placeholder="Pegá aquí el JSON devuelto por Proxmox cluster/resources…"
                    value={pveFallbackJson}
                    onChange={e => setPveFallbackJson(e.target.value)}
                    style={{ fontFamily: 'monospace', fontSize: '11px', marginBottom: '10px' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="submit" className="button primary" disabled={connectingPve || !pveFallbackJson.trim()}>
                      <Upload size={14} /> Crear Servidor con este JSON
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-field">
              <label>Tipo de servidor / instancia *</label>
              <select
                className="input"
                value={form.server_type}
                onChange={e => update('server_type', e.target.value as ServerType)}
              >
                <option value="dedicated">Dedicado (Bare Metal con Proxmox / Hipervisor)</option>
                <option value="vps">VPS (Máquina Virtual en Proxmox)</option>
                <option value="cloud">Cloud Instance</option>
                <option value="physical">Servidor Físico</option>
                <option value="virtual_machine">Máquina Virtual Genérica</option>
                <option value="other">Otro</option>
              </select>
            </div>

            {/* If VPS, show parent Proxmox host and VM ID */}
            {isVpsType && (
              <>
                <div className="form-field">
                  <label>Servidor Físico / Hipervisor Proxmox</label>
                  <select
                    className="input"
                    value={form.parent_id}
                    onChange={e => update('parent_id', e.target.value)}
                  >
                    <option value="">Sin hipervisor asignado (Host independiente)</option>
                    {parentServers.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.hostname ? `(${p.hostname})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label>VM ID en Proxmox</label>
                  <input
                    className="input"
                    placeholder="ej. 101"
                    value={form.vm_id}
                    onChange={e => update('vm_id', e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>Tipo de virtualización</label>
                  <select
                    className="input"
                    value={form.vm_type}
                    onChange={e => update('vm_type', e.target.value as 'qemu' | 'lxc')}
                  >
                    <option value="qemu">🖥️ QEMU / KVM (Máquina Virtual)</option>
                    <option value="lxc">📦 LXC (Contenedor)</option>
                  </select>
                </div>

                <div className="form-field">
                  <label>Función / Rol del VPS</label>
                  <input
                    className="input"
                    placeholder="ej. Radio Streaming / CWP Hosting / DB"
                    value={form.role}
                    onChange={e => update('role', e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="form-field">
              <label>Nombre identificatorio *</label>
              <input
                className="input"
                required
                placeholder="ej. ns559079.superCwp o radio13.altomarketing.net"
                value={form.name}
                onChange={e => update('name', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>Hostname / FQDN</label>
              <input
                className="input"
                placeholder="ej. ns559079.ip-54-39-104.net"
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
              <label>Costo mensual ($)</label>
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
                placeholder="ej. AlmaLinux 8 / Proxmox VE 8.1"
                value={form.operating_system}
                onChange={e => update('operating_system', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>Procesador (CPU / Cores)</label>
              <input
                className="input"
                placeholder="ej. 12 x Intel Xeon / 4 vCPU"
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
              <label>Ubicación / Datacenter</label>
              <input
                className="input"
                placeholder="ej. Beauharnois (BHS), Canadá"
                value={form.location}
                onChange={e => update('location', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>URL Panel de Gestión / Proxmox (:8006)</label>
              <input
                className="input"
                type="url"
                placeholder="https://ns559079.ip-54-39-104.net:8006"
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
      )}
    </section>
    </div>
  )
}
