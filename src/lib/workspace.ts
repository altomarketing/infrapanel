import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export async function ensureWorkspace(user: User): Promise<string> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data: existing, error: readError } = await supabase
    .from('workspaces').select('id').eq('owner_id', user.id).order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (readError) throw readError
  if (existing?.id) return existing.id

  const { data, error } = await supabase
    .from('workspaces').insert({ name: 'Mi infraestructura', owner_id: user.id }).select('id').single()
  if (error) throw error
  return data.id as string
}
