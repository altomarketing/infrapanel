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
  monthly_cost?: number | null
  notes: string | null
  created_at: string
  updated_at: string
  providers?: { name: string } | null
}

export type ProviderType = 'hosting' | 'cloud' | 'cdn' | 'dns' | 'registrar' | 'datacenter' | 'other'

export interface Provider {
  id: string
  workspace_id: string
  name: string
  provider_type: ProviderType
  website: string | null
  panel_url: string | null
  contact_info: string | null
  notes: string | null
  created_at: string
  updated_at?: string
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
  reverse_dns?: string | null
  monthly_cost?: number | null
  notes: string | null
  created_at: string
  updated_at?: string
}

export type DomainStatus = 'active' | 'pending' | 'expired' | 'inactive'

export interface Domain {
  id: string
  workspace_id: string
  name: string
  parent_domain_id?: string | null
  registrar_provider_id: string | null
  dns_provider_id: string | null
  target_ip?: string | null
  server_id?: string | null
  monthly_cost?: number | null
  expires_at: string | null
  auto_renew: boolean | null
  status: DomainStatus
  notes: string | null
  created_at: string
  updated_at: string
  registrar_provider?: { name: string } | null
  dns_provider?: { name: string } | null
  servers?: { name: string; hostname: string | null } | null
}
