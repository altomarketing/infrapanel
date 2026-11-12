-- =============================================================================
-- InfraPanel v0.1.0: Esquema para Supabase / PostgreSQL
-- Ejecutar en Supabase Dashboard -> SQL Editor sobre un proyecto nuevo.
-- Incluye workspaces, inventario, relaciones, auditoria y politicas RLS.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Workspaces y miembros
-- -----------------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner','admin','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function public.add_workspace_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists trg_workspace_owner_member on public.workspaces;
create trigger trg_workspace_owner_member
after insert on public.workspaces
for each row execute function public.add_workspace_owner_as_member();

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner','admin','editor')
  );
$$;

create or replace function public.can_manage_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner','admin')
  );
$$;

-- -----------------------------------------------------------------------------
-- 2. Proveedores y servidores
-- -----------------------------------------------------------------------------
create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  provider_type text not null default 'hosting'
    check (provider_type in ('hosting','cloud','cdn','dns','registrar','datacenter','other')),
  website text,
  panel_url text,
  contact_info text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.servers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_id uuid references public.providers(id) on delete set null,
  name text not null,
  hostname text,
  server_type text not null default 'vps'
    check (server_type in ('vps','dedicated','physical','cloud','virtual_machine','other')),
  operating_system text,
  cpu text,
  ram_gb numeric(10,2) check (ram_gb is null or ram_gb >= 0),
  storage_gb numeric(10,2) check (storage_gb is null or storage_gb >= 0),
  location text,
  status text not null default 'active'
    check (status in ('active','maintenance','inactive','decommissioned')),
  management_url text,
  purchased_at date,
  expires_at date,
  monthly_cost numeric(10,2) default 0.00 check (monthly_cost is null or monthly_cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

-- -----------------------------------------------------------------------------
-- 3. Servicios / aplicaciones
-- -----------------------------------------------------------------------------
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  category text not null default 'application'
    check (category in ('application','database','proxy','container_platform','mail','streaming','monitoring','storage','other')),
  installation_type text not null default 'docker'
    check (installation_type in ('docker','native','virtual_machine','external','managed','other')),
  version text,
  access_url text,
  internal_port integer check (internal_port is null or internal_port between 1 and 65535),
  status text not null default 'active'
    check (status in ('active','maintenance','inactive','decommissioned')),
  description text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.server_services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  deployment_name text,
  deployment_notes text,
  created_at timestamptz not null default now(),
  unique (server_id, service_id)
);

create table if not exists public.service_dependencies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  depends_on_service_id uuid not null references public.services(id) on delete cascade,
  relationship_type text not null default 'depends_on'
    check (relationship_type in ('depends_on','uses','connects_to','routes_through','replicates_to','other')),
  notes text,
  created_at timestamptz not null default now(),
  check (service_id <> depends_on_service_id),
  unique (service_id, depends_on_service_id, relationship_type)
);

-- -----------------------------------------------------------------------------
-- 4. Dominios y rutas
-- -----------------------------------------------------------------------------
create table if not exists public.domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  parent_domain_id uuid references public.domains(id) on delete set null,
  registrar_provider_id uuid references public.providers(id) on delete set null,
  dns_provider_id uuid references public.providers(id) on delete set null,
  target_ip text,
  server_id uuid references public.servers(id) on delete set null,
  monthly_cost numeric(10,2) default 0.00 check (monthly_cost is null or monthly_cost >= 0),
  expires_at date,
  auto_renew boolean,
  status text not null default 'active'
    check (status in ('active','pending','expired','inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.domain_routes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  domain_id uuid not null references public.domains(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  proxy_service_id uuid references public.services(id) on delete set null,
  origin_host text,
  origin_port integer check (origin_port is null or origin_port between 1 and 65535),
  protocol text not null default 'https' check (protocol in ('http','https','tcp','udp','other')),
  path text,
  is_primary boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 5. Redes e IP
-- -----------------------------------------------------------------------------
create table if not exists public.networks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  cidr cidr,
  gateway inet,
  vlan_id integer check (vlan_id is null or vlan_id between 1 and 4094),
  network_type text not null default 'private'
    check (network_type in ('public','private','management','vlan','vpn','other')),
  description text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.ip_addresses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  address inet not null,
  ip_type text not null default 'private' check (ip_type in ('public','private','management','loopback','other')),
  network_id uuid references public.networks(id) on delete set null,
  server_id uuid references public.servers(id) on delete cascade,
  label text,
  gateway inet,
  purpose text,
  reverse_dns text,
  monthly_cost numeric(10,2) default 0.00 check (monthly_cost is null or monthly_cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, server_id, address)
);

create table if not exists public.server_networks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  network_id uuid not null references public.networks(id) on delete cascade,
  interface_name text,
  notes text,
  created_at timestamptz not null default now(),
  unique (server_id, network_id)
);

-- -----------------------------------------------------------------------------
-- 6. Notas, etiquetas e historial
-- -----------------------------------------------------------------------------
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('server','service','domain','network','ip_address','provider')),
  entity_id uuid not null,
  title text,
  body text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.entity_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  entity_type text not null check (entity_type in ('server','service','domain','network','ip_address','provider')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tag_id, entity_type, entity_id)
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('create','update','delete','import','export')),
  entity_type text not null,
  entity_id uuid,
  summary text,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 7. Índices
-- -----------------------------------------------------------------------------
create index if not exists idx_servers_workspace on public.servers(workspace_id);
create index if not exists idx_services_workspace on public.services(workspace_id);
create index if not exists idx_domains_workspace on public.domains(workspace_id);
create index if not exists idx_networks_workspace on public.networks(workspace_id);
create index if not exists idx_ip_workspace on public.ip_addresses(workspace_id);
create index if not exists idx_ip_server on public.ip_addresses(server_id);
create index if not exists idx_server_services_server on public.server_services(server_id);
create index if not exists idx_server_services_service on public.server_services(service_id);
create index if not exists idx_domain_routes_domain on public.domain_routes(domain_id);
create index if not exists idx_domain_routes_service on public.domain_routes(service_id);
create index if not exists idx_dependencies_service on public.service_dependencies(service_id);
create index if not exists idx_dependencies_target on public.service_dependencies(depends_on_service_id);
create index if not exists idx_notes_entity on public.notes(workspace_id, entity_type, entity_id);
create index if not exists idx_activity_workspace_created on public.activity_logs(workspace_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 8. updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['workspaces','providers','servers','services','domains','networks','ip_addresses','notes']
  loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Row Level Security
-- -----------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

drop policy if exists "workspace members can read workspace" on public.workspaces;
create policy "workspace members can read workspace"
on public.workspaces for select
using (public.is_workspace_member(id) or owner_id = auth.uid());

drop policy if exists "authenticated users can create own workspace" on public.workspaces;
create policy "authenticated users can create own workspace"
on public.workspaces for insert
with check (auth.uid() = owner_id);

drop policy if exists "workspace owner can update workspace" on public.workspaces;
create policy "workspace owner can update workspace"
on public.workspaces for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "workspace owner can delete workspace" on public.workspaces;
create policy "workspace owner can delete workspace"
on public.workspaces for delete
using (owner_id = auth.uid());

drop policy if exists "members can read workspace membership" on public.workspace_members;
create policy "members can read workspace membership"
on public.workspace_members for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "admins can add workspace members" on public.workspace_members;
create policy "admins can add workspace members"
on public.workspace_members for insert
with check (public.can_manage_workspace(workspace_id));

drop policy if exists "admins can update workspace members" on public.workspace_members;
create policy "admins can update workspace members"
on public.workspace_members for update
using (public.can_manage_workspace(workspace_id))
with check (public.can_manage_workspace(workspace_id));

drop policy if exists "admins can remove workspace members" on public.workspace_members;
create policy "admins can remove workspace members"
on public.workspace_members for delete
using (public.can_manage_workspace(workspace_id) and role <> 'owner');

-- Políticas comunes para las tablas que contienen workspace_id.
do $$
declare t text;
begin
  foreach t in array array[
    'providers','servers','services','server_services','service_dependencies',
    'domains','domain_routes','networks','ip_addresses','server_networks',
    'notes','tags','entity_tags','activity_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_members', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_editors', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_editors', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_editors', t);
    execute format('create policy %I on public.%I for select using (public.is_workspace_member(workspace_id))', t || '_select_members', t);
    execute format('create policy %I on public.%I for insert with check (public.can_edit_workspace(workspace_id))', t || '_insert_editors', t);
    execute format('create policy %I on public.%I for update using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id))', t || '_update_editors', t);
    execute format('create policy %I on public.%I for delete using (public.can_edit_workspace(workspace_id))', t || '_delete_editors', t);
  end loop;
end;
$$;

-- Permisos para el rol authenticated (RLS filtra las filas).
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.can_edit_workspace(uuid) to authenticated;
grant execute on function public.can_manage_workspace(uuid) to authenticated;
