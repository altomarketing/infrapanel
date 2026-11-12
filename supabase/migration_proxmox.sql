-- InfraPanel Migration: Proxmox & VPS Support
-- Ejecutar en Supabase -> SQL Editor

alter table public.servers 
  add column if not exists parent_id uuid references public.servers(id) on delete cascade,
  add column if not exists vm_id text,
  add column if not exists vm_type text default 'qemu',
  add column if not exists role text,
  add column if not exists proxmox_api_url text,
  add column if not exists proxmox_api_token_id text,
  add column if not exists proxmox_api_token_secret text;

alter table public.ip_addresses
  add column if not exists assigned_vps_id uuid references public.servers(id) on delete set null;

create index if not exists idx_servers_parent_id on public.servers(parent_id);
create index if not exists idx_ip_addresses_assigned_vps on public.ip_addresses(assigned_vps_id);
