import { useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { Navigate, Route, Routes } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import { ensureWorkspace } from './lib/workspace'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Servers from './pages/Servers'
import Providers from './pages/Providers'
import Domains from './pages/Domains'
import Networks from './pages/Networks'
import Layout from './components/Layout'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [workspaceError, setWorkspaceError] = useState('')

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session)
    }).finally(() => { if (mounted) setLoading(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    let active = true
    async function loadWorkspace(user: User) {
      try {
        setWorkspaceError('')
        const id = await ensureWorkspace(user)
        if (active) setWorkspaceId(id)
      } catch (error) {
        if (active) setWorkspaceError(error instanceof Error ? error.message : 'No se pudo cargar el espacio de trabajo.')
      }
    }
    if (session?.user) loadWorkspace(session.user)
    else setWorkspaceId(null)
    return () => { active = false }
  }, [session?.user?.id])

  if (!isSupabaseConfigured) return <div className="setup-screen"><div className="setup-card"><div className="brand-mark">I</div><h1>Configurá InfraPanel</h1><p>Copiá <code>.env.example</code> como <code>.env.local</code> y agregá tu clave publishable de Supabase.</p><p className="muted">Project URL: https://uqqmeqmswtsxiarexsup.supabase.co</p></div></div>
  if (loading) return <div className="loading-screen"><div className="spinner" />Cargando InfraPanel…</div>
  if (!session) return <Login />
  if (workspaceError) return <div className="setup-screen"><div className="setup-card"><h2>No pudimos preparar tu espacio</h2><p>{workspaceError}</p><p className="muted">Verificá que el SQL de InfraPanel se haya ejecutado completo y que RLS esté activo.</p><button className="button secondary" onClick={() => window.location.reload()}>Reintentar</button></div></div>
  if (!workspaceId) return <div className="loading-screen"><div className="spinner" />Preparando tu espacio…</div>

  return <Layout user={session.user} onSignOut={() => supabase?.auth.signOut()}>
    <Routes>
      <Route path="/" element={<Dashboard workspaceId={workspaceId} />} />
      <Route path="/servers" element={<Servers workspaceId={workspaceId} />} />
      <Route path="/providers" element={<Providers workspaceId={workspaceId} />} />
      <Route path="/domains" element={<Domains workspaceId={workspaceId} />} />
      <Route path="/networks" element={<Networks workspaceId={workspaceId} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </Layout>
}
