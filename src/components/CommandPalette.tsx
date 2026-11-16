import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Container,
  Globe2,
  Monitor,
  Plus,
  Radio,
  Search,
  Server,
  Tags,
  X
} from 'lucide-react'
import { supabase } from '../lib/supabase'

type SearchItem = {
  id: string
  title: string
  subtitle?: string
  category: 'Servidores' | 'VPS / Máquinas' | 'Direcciones IP' | 'Dominios' | 'Proveedores' | 'Acciones'
  to: string
  icon: typeof Server
  badge?: string
}

export default function CommandPalette({
  isOpen,
  onClose,
  workspaceId
}: {
  isOpen: boolean
  onClose: () => void
  workspaceId: string
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [items, setItems] = useState<SearchItem[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Load index data when opened
  useEffect(() => {
    if (!isOpen || !workspaceId) return
    let active = true

    async function loadData() {
      setLoading(true)
      const [serversRes, ipsRes, domainsRes, providersRes] = await Promise.all([
        supabase!.from('servers').select('id, name, hostname, parent_id, vm_id, vm_type').eq('workspace_id', workspaceId),
        supabase!.from('ip_addresses').select('id, address, purpose, reverse_dns, label, server_id, assigned_vps_id').eq('workspace_id', workspaceId),
        supabase!.from('domains').select('id, name, target_ip, status').eq('workspace_id', workspaceId),
        supabase!.from('providers').select('id, name, provider_type').eq('workspace_id', workspaceId)
      ])

      if (!active) return

      const list: SearchItem[] = []

      // Quick actions
      list.push({
        id: 'action-new-server',
        title: 'Agregar nuevo servidor',
        subtitle: 'Registrar hipervisor dedicado o VPS',
        category: 'Acciones',
        to: '/servers',
        icon: Plus,
        badge: 'Acción'
      })
      list.push({
        id: 'action-new-ip',
        title: 'Registrar nueva IP / Bloque',
        subtitle: 'Asignar IP pública o failover',
        category: 'Acciones',
        to: '/networks',
        icon: Plus,
        badge: 'Acción'
      })
      list.push({
        id: 'action-new-domain',
        title: 'Agregar nuevo dominio',
        subtitle: 'Registrar dominio y apuntar a IP',
        category: 'Acciones',
        to: '/domains',
        icon: Plus,
        badge: 'Acción'
      })

      // Servers & VPS
      const allServers = serversRes.data || []
      const hostMap = new Map<string, string>()
      for (const s of allServers) {
        if (!s.parent_id) hostMap.set(s.id, s.name)
      }

      for (const s of allServers) {
        if (s.parent_id) {
          // Child VPS
          const parentName = hostMap.get(s.parent_id) || 'Host Proxmox'
          list.push({
            id: `vps-${s.id}`,
            title: s.name,
            subtitle: `${s.vm_type === 'lxc' ? 'LXC' : 'KVM'} ${s.vm_id ? `[VM ${s.vm_id}]` : ''} · Nodo: ${parentName}`,
            category: 'VPS / Máquinas',
            to: `/servers/${s.id}`,
            icon: s.vm_type === 'lxc' ? Container : Monitor,
            badge: s.vm_type === 'lxc' ? 'LXC' : 'KVM'
          })
        } else {
          // Physical server
          list.push({
            id: `server-${s.id}`,
            title: s.name,
            subtitle: s.hostname ? `Hostname: ${s.hostname}` : 'Servidor Físico / Hipervisor',
            category: 'Servidores',
            to: `/servers/${s.id}`,
            icon: Server,
            badge: 'Host Físico'
          })
        }
      }

      // IP Addresses (Hide IPv6)
      for (const ip of ipsRes.data || []) {
        if (ip.address.includes(':')) continue
        const descParts: string[] = []
        if (ip.reverse_dns) descParts.push(`PTR: ${ip.reverse_dns}`)
        else if (ip.purpose) descParts.push(ip.purpose)
        if (ip.label) descParts.push(`Etiqueta: ${ip.label}`)

        list.push({
          id: `ip-${ip.id}`,
          title: ip.address,
          subtitle: descParts.length ? descParts.join(' · ') : 'Dirección IP pública',
          category: 'Direcciones IP',
          to: '/networks',
          icon: Radio,
          badge: 'IP'
        })
      }

      // Domains
      for (const d of domainsRes.data || []) {
        list.push({
          id: `domain-${d.id}`,
          title: d.name,
          subtitle: d.target_ip ? `Apunta a: ${d.target_ip}` : 'Dominio activo',
          category: 'Dominios',
          to: '/domains',
          icon: Globe2,
          badge: d.status === 'active' ? 'Activo' : 'Dominio'
        })
      }

      // Providers
      for (const p of providersRes.data || []) {
        list.push({
          id: `provider-${p.id}`,
          title: p.name,
          subtitle: `Proveedor de infraestructura (${p.provider_type || 'Hosting'})`,
          category: 'Proveedores',
          to: '/providers',
          icon: Tags,
          badge: 'Proveedor'
        })
      }

      setItems(list)
      setLoading(false)
    }

    loadData()
    return () => {
      active = false
    }
  }, [isOpen, workspaceId])

  // Filter items based on query
  const filtered = useMemo(() => {
    if (!query.trim()) {
      // If query is empty, show quick actions and top 8 servers/VPS
      return items.filter(it => it.category === 'Acciones' || it.category === 'Servidores' || it.category === 'VPS / Máquinas').slice(0, 10)
    }
    const q = query.toLowerCase().trim()
    return items.filter(it => {
      const matchTitle = it.title.toLowerCase().includes(q)
      const matchSubtitle = it.subtitle ? it.subtitle.toLowerCase().includes(q) : false
      const matchCat = it.category.toLowerCase().includes(q)
      return matchTitle || matchSubtitle || matchCat
    }).slice(0, 20)
  }, [items, query])

  // Reset selectedIndex on filter change
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => (filtered.length ? (prev + 1) % filtered.length : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const selected = filtered[selectedIndex]
        if (selected) {
          navigate(selected.to)
          onClose()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filtered, selectedIndex, navigate, onClose])

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '80px 16px 24px',
        animation: 'fadeIn 0.15s ease'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '640px',
          background: '#ffffff',
          borderRadius: '14px',
          boxShadow: '0 20px 40px -10px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(15, 23, 42, 0.08)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'min(580px, 85vh)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 18px',
            borderBottom: '1px solid #e2e8f0',
            background: '#ffffff'
          }}
        >
          <Search size={20} color="#64748b" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar servidor, VPS, IP, dominio, proveedor…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              fontSize: '15px',
              fontFamily: 'inherit',
              color: '#0f172a',
              background: 'transparent'
            }}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px', color: '#94a3b8' }}
            >
              <X size={16} />
            </button>
          ) : (
            <span
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                background: '#f1f5f9',
                borderRadius: '4px',
                color: '#64748b',
                fontFamily: 'monospace'
              }}
            >
              ESC
            </span>
          )}
        </div>

        {/* Results list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {loading ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
              Cargando índice de infraestructura…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: '#94a3b8' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                No encontramos resultados para “{query}”
              </div>
              <div style={{ fontSize: '12px' }}>Probá con un nombre de host, IP, número de VM o dominio.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {filtered.map((item, idx) => {
                const isSelected = idx === selectedIndex
                const Icon = item.icon
                return (
                  <div
                    key={item.id}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => {
                      navigate(item.to)
                      onClose()
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      background: isSelected ? '#f1f5f9' : 'transparent',
                      transition: 'background 0.1s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          background: isSelected ? '#e2e8f0' : '#f8fafc',
                          color: '#2563eb',
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0
                        }}
                      >
                        <Icon size={16} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              fontSize: '13px',
                              fontWeight: 600,
                              color: isSelected ? '#0f172a' : '#1e293b',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {item.title}
                          </span>
                          {item.badge && (
                            <span
                              style={{
                                fontSize: '9px',
                                fontWeight: 700,
                                padding: '1px 5px',
                                borderRadius: '4px',
                                background: item.badge.includes('LXC') ? '#ecfeff' : item.badge.includes('KVM') ? '#f0fdf4' : '#f1f5f9',
                                color: item.badge.includes('LXC') ? '#0891b2' : item.badge.includes('KVM') ? '#16a34a' : '#64748b'
                              }}
                            >
                              {item.badge}
                            </span>
                          )}
                        </div>
                        {item.subtitle && (
                          <div
                            style={{
                              fontSize: '11px',
                              color: '#64748b',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              marginTop: '2px'
                            }}
                          >
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 500 }}>
                        {item.category}
                      </span>
                      {isSelected && <ArrowRight size={14} color="#2563eb" />}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer shortcuts */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            borderTop: '1px solid #f1f5f9',
            background: '#fafbfc',
            fontSize: '11px',
            color: '#64748b'
          }}
        >
          <div style={{ display: 'flex', gap: '14px' }}>
            <span>
              <kbd style={{ padding: '1px 5px', background: '#e2e8f0', borderRadius: '3px', fontWeight: 600 }}>↑</kbd>{' '}
              <kbd style={{ padding: '1px 5px', background: '#e2e8f0', borderRadius: '3px', fontWeight: 600 }}>↓</kbd>{' '}
              Navegar
            </span>
            <span>
              <kbd style={{ padding: '1px 5px', background: '#e2e8f0', borderRadius: '3px', fontWeight: 600 }}>↵</kbd>{' '}
              Abrir
            </span>
            <span>
              <kbd style={{ padding: '1px 5px', background: '#e2e8f0', borderRadius: '3px', fontWeight: 600 }}>esc</kbd>{' '}
              Cerrar
            </span>
          </div>
          <span>{filtered.length} coincidencias</span>
        </div>
      </div>
    </div>
  )
}
