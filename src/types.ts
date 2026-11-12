export type ServerStatus = 'active' | 'maintenance' | 'inactive' | 'decommissioned'
export type ServerType = 'vps' | 'dedicated' | 'physical' | 'cloud' | 'virtual_machine' | 'other'

export interface Server {
  id: string
  workspace_id: string
  provider_id: string | null
  name: string
  hostname: string | null
  server_type: ServerType
  operating_system: string | null
  cpu: string | null
  ram_gb: number | null
  storage_gb: number | null
  location: string | null
  status: ServerStatus
  management_url: string | null
  purchased_at: string | null
  expires_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  providers?: { name: string } | null
}

export interface Provider {
  id: string
  name: string
}

export interface IPAddress {
  id: string
  workspace_id: string
  server_id: string | null
  address: string
  ip_type: 'public' | 'private' | 'management' | 'loopback' | 'other'
  network_id?: string | null
  label: string | null
  purpose: string | null // Reverse DNS (PTR)
  notes: string | null
  created_at: string
  updated_at?: string
}
