import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, LockKeyhole, Server, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    const { error: authError } = await supabase!.auth.signInWithPassword({ email: email.trim(), password })
    if (authError) setError(authError.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : authError.message)
    setBusy(false)
  }
  return <div className="login-screen"><div className="login-left"><div className="login-brand"><div className="brand-mark">I</div><strong>InfraPanel</strong></div><div className="login-pitch"><div className="eyebrow"><span className="eyebrow-dot"/> INFRASTRUCTURE MANAGEMENT</div><h1>Toda tu infraestructura.<br/><span>En un solo lugar.</span></h1><p>Organizá servidores, servicios, dominios y redes con una visión clara de cómo se conecta todo.</p><div className="login-features"><div><Server size={17}/> Inventario centralizado</div><div><ShieldCheck size={17}/> Acceso privado y seguro</div></div></div><div className="login-copyright">© {new Date().getFullYear()} InfraPanel</div></div><div className="login-right"><form className="login-card" onSubmit={submit}><div className="login-icon"><LockKeyhole size={21}/></div><h2>Bienvenido</h2><p>Ingresá para administrar tu infraestructura.</p><label className="field-label">Correo electrónico</label><input className="input" type="email" autoComplete="username" placeholder="tu@empresa.com" value={email} onChange={e => setEmail(e.target.value)} required/><label className="field-label">Contraseña</label><input className="input" type="password" autoComplete="current-password" placeholder="Tu contraseña" value={password} onChange={e => setPassword(e.target.value)} required/><div className="login-error">{error}</div><button className="button primary login-submit" disabled={busy}>{busy ? 'Ingresando…' : 'Iniciar sesión'} <ArrowRight size={17}/></button><div className="login-footnote"><ShieldCheck size={14}/> Acceso exclusivo para usuarios autorizados</div></form></div></div>
}
