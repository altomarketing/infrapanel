import { useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { Activity, ChevronDown, CircleHelp, Command, Globe2, LayoutDashboard, LogOut, Menu, Network, Search, Server, Settings, ShieldCheck, Tags, X, Boxes } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import type { LucideIcon } from 'lucide-react'
import { useBreadcrumbs } from '../lib/breadcrumbs'

const nav: { label: string; items: { to: string; label: string; icon: LucideIcon; soon?: boolean }[] }[] = [
  { label: 'General', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }, { to: '/servers', label: 'Servidores', icon: Server }] },
  { label: 'Infraestructura', items: [{ to: '/services', label: 'Servicios', icon: Boxes, soon: true }, { to: '/domains', label: 'Dominios', icon: Globe2 }, { to: '/networks', label: 'Redes e IP', icon: Network }, { to: '/providers', label: 'Proveedores', icon: Tags }] },
  { label: 'Sistema', items: [{ to: '/activity', label: 'Actividad', icon: Activity, soon: true }, { to: '/settings', label: 'Configuración', icon: Settings, soon: true }] },
]

export default function Layout({ children, user, onSignOut }: { children: ReactNode; user: User; onSignOut: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { breadcrumbs } = useBreadcrumbs()
  const initials = (user.email || 'IP').slice(0, 2).toUpperCase()

  return (
    <div className="app-shell">
      {mobileOpen && <button className="mobile-scrim" aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">I</div>
          <div>
            <strong>InfraPanel</strong>
            <span>Infrastructure manager</span>
          </div>
          <button className="icon-button close-menu" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú">
            <X size={18} />
          </button>
        </div>

        <div className="workspace-switch">
          <div className="workspace-avatar">
            <Command size={16} />
          </div>
          <div>
            <strong>Mi infraestructura</strong>
            <span>Espacio de trabajo</span>
          </div>
          <ChevronDown size={15} className="muted-icon" />
        </div>

        <nav className="side-nav">
          {nav.map(group => (
            <div className="nav-group" key={group.label}>
              <div className="nav-heading">{group.label}</div>
              {group.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''} ${item.soon ? 'nav-soon' : ''}`}
                >
                  <item.icon size={17} />
                  <span>{item.label}</span>
                  {item.soon && <span className="soon-label">Pronto</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">
              <CircleHelp size={17} />
            </div>
            <strong>¿Necesitás ayuda?</strong>
            <span>Tu infraestructura, organizada en un solo lugar.</span>
          </div>
          <div className="profile-row">
            <div className="profile-avatar">{initials}</div>
            <div className="profile-info">
              <strong>{user.email}</strong>
              <span>Administrador</span>
            </div>
            <button className="icon-button" onClick={onSignOut} title="Cerrar sesión">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Abrir menú">
            <Menu size={20} />
          </button>

          <nav className="breadcrumb" aria-label="Breadcrumb">
            {breadcrumbs.length === 0 ? (
              <span className="breadcrumb-node">
                <strong className="breadcrumb-current">InfraPanel</strong>
              </span>
            ) : (
              breadcrumbs.map((item, idx) => {
                const isLast = idx === breadcrumbs.length - 1
                return (
                  <span key={idx} className="breadcrumb-node">
                    {idx > 0 && <span className="breadcrumb-sep">&gt;</span>}
                    {item.to && !isLast ? (
                      <NavLink to={item.to} className="breadcrumb-link">
                        {item.label}
                      </NavLink>
                    ) : (
                      <strong className="breadcrumb-current">{item.label}</strong>
                    )}
                  </span>
                )
              })
            )}
          </nav>

          <div className="topbar-actions">
            <div className="search-shortcut">
              <Search size={15} />
              <span>Búsqueda</span>
              <kbd>⌘ K</kbd>
            </div>
            <div className="topbar-divider" />
            <div className="secure-label">
              <ShieldCheck size={15} /> Espacio privado
            </div>
          </div>
        </header>

        <div className="page-content">{children}</div>

        <footer className="app-footer">
          <span>InfraPanel <span className="footer-dot">·</span> Infrastructure Management</span>
          <span>v0.1.0</span>
        </footer>
      </main>
    </div>
  )
}
