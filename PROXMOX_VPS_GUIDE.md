# Guía de Arquitectura y Uso: Proxmox VE, VPS y Gestión de IPs en InfraPanel

Documento técnico de referencia para la gestión de infraestructura física, hipervisores Proxmox VE, máquinas virtuales (VPS / KVM / LXC), enrutamiento de bloques failover y resolución de Reverse DNS (PTR).

---

## 1. Arquitectura General y Jerarquía de Servidores

InfraPanel modela la infraestructura de servidores mediante una **jerarquía unificada Padre-Hijo** en la misma entidad de base de datos (`public.servers`), distinguiendo el rol de cada equipo:

```
[Hipervisor Físico / Bare Metal] (ej. ns559079.superCwp)
  ├── IP Primaria Host (ej. 54.39.104.54)
  ├── Pool de IPs Failover OVH (ej. 198.50.231.232/29 - 8 IPs utilizables)
  │     ├── 198.50.231.236 ──> Asignada a VM 101 (mate.altomarketing.net)
  │     ├── 198.50.231.232 ──> Asignada a VM 100 (radio13.altomarketing.net)
  │     └── 198.50.231.234 ──> Asignada a VM 200 (radio15.servidorderadio.net)
  │
  └── VPS / Máquinas Virtuales Hijas (Proxmox VE 8.x)
        ├── [VM 100] radio13.altomarketing.net (Radio Streaming | Debian 12 | 4 vCPU | 8 GB RAM)
        ├── [VM 101] mate.altomarketing.net    (CWP Web Hosting | AlmaLinux 8 | 4 vCPU | 8 GB RAM)
        ├── [VM 200] radio15.servidorderadio.net (Radio Nube | Ubuntu 22.04 | 2 vCPU | 4 GB RAM)
        └── [VM 201] radio02.servidorderadio.net (Streaming Backup | Debian 12 | 2 vCPU | 4 GB RAM)
```

### Ventajas de este modelo:
1. **Facturación y Costeo Exacto**: El costo del servidor físico dedicado y el de los bloques de IPs adicionales se registran en el host padre (tal como factura OVHcloud), mientras que los VPS pueden llevar un costo interno o de reventa.
2. **Navegación 100% In-Window**: Sin popups ni modales oscuros. Todo el flujo usa URLs limpias y rutas de navegación (Breadcrumbs):
   * Lista general: `/servers`
   * Hipervisor Proxmox: `/servers/0fe6833c-23f0-4c25-af3c-e08558b87af8`
   * VPS hijo: `/servers/f23bc35a-8d01-405b-8559-4f4e8b28a77b` (Breadcrumb: `Servidores > ns559079.superCwp > [101] mate.altomarketing.net`)
3. **Control de Capacidad**: En la ficha del Proxmox se calcula automáticamente la suma de vCPUs y memoria RAM asignada a las VMs frente a la capacidad física real del servidor (ej. 128 GB RAM).

---

## 2. Script de Migración SQL (Supabase)

Para inicializar las columnas de soporte Proxmox y vinculación de VPS, ejecutar el siguiente script en **Supabase → SQL Editor**:

```sql
-- InfraPanel: Soporte para Proxmox VE y VPS Hijos
-- Archivo: supabase/migration_proxmox.sql

-- 1. Soporte de jerarquía y metadatos Proxmox en servidores
alter table public.servers 
  add column if not exists parent_id uuid references public.servers(id) on delete cascade,
  add column if not exists vm_id text,
  add column if not exists vm_type text default 'qemu',
  add column if not exists role text,
  add column if not exists proxmox_api_url text,
  add column if not exists proxmox_api_token_id text,
  add column if not exists proxmox_api_token_secret text;

-- 2. Asignación de IP failover a una VM específica
alter table public.ip_addresses
  add column if not exists assigned_vps_id uuid references public.servers(id) on delete set null;

-- 3. Índices de consulta rápida
create index if not exists idx_servers_parent_id on public.servers(parent_id);
create index if not exists idx_ip_addresses_assigned_vps on public.ip_addresses(assigned_vps_id);
```

---

## 3. Guía de Operaciones Frecuentes

### A. Cómo dar de alta un nuevo VPS en un nodo Proxmox

1. Ingresar en InfraPanel a **Servidores** y hacer clic en el servidor físico (ej. `ns559079.superCwp`).
2. En la pestaña **"Máquinas Virtuales / VPS"**, presionar el botón **"+ Nuevo VPS / VM"**.
3. Completar el formulario integrado:
   * **Nombre**: Nombre FQDN del VPS (ej. `mate.altomarketing.net`).
   * **VM ID**: Número de VM en Proxmox (ej. `101`).
   * **Tipo**: `QEMU / KVM` (para VM completa) o `LXC` (para contenedor ligero).
   * **Función / Rol**: Propósito del VPS (ej. *Radio Streaming*, *CWP Web*, *Base de datos*).
   * **Asignar IP Failover**: Seleccionar la IP del bloque del servidor que usará este VPS.
   * **Recursos**: vCPUs, RAM (GB), Disco (GB) y Sistema Operativo.
4. Presionar **"Crear VPS"**. La máquina quedará registrada bajo el Proxmox y su IP quedará inmediatamente vinculada.

---

### B. Cómo sincronizar masivamente VMs desde Proxmox (CLI o JSON)

Para no cargar las máquinas una por una:

1. En tu servidor Proxmox, abrir la terminal / SSH y ejecutar:
   ```bash
   qm list
   ```
   *(o `pct list` si usas contenedores LXC).*
2. Copiar la salida generada (incluyendo encabezados o solo líneas de datos):
   ```
   VMID NAME                       STATUS     MEM(MB)    BOOTDISK(GB) PID
    100 radio13.altomarketing.net  running    8192       50.00        1234
    101 mate.altomarketing.net     running    4096       40.00        5678
    200 radio15.servidorderadio.net running   4096       30.00        9012
   ```
3. En InfraPanel, dentro de la pestaña **"Máquinas Virtuales / VPS"**, hacer clic en **"Sincronizar Proxmox"**.
4. Pegar el texto en el cuadro y presionar **"Procesar e Importar VMs"**.
5. El sistema procesará los IDs, nombres y recursos y creará o actualizará todas las instancias en la base de datos automáticamente.

---

### C. Cómo asignar o reasignar una IP Failover a un VPS

1. Dentro de la ficha del servidor físico Proxmox, ir a la pestaña **"Direcciones IP y Reverse DNS"**.
2. En la fila de la IP deseada (ej. `198.50.231.236`):
   * Hacer clic en el icono de **Editar (lápiz)**.
   * En la columna **"Asignada a VPS"**, elegir en el selector la VM de destino (ej. `VM 101: mate.altomarketing.net`).
   * Si es necesario actualizar el PTR, hacer clic en **"Resolver DoH"** o escribirlo manualmente.
   * Presionar **"Guardar"**.
3. A partir de ese momento, tanto en el listado del servidor como al entrar a la ficha individual del VPS, figurará esa IP asignada.

---

### D. Acceso directo a la consola web de Proxmox (:8006)

* En la ficha del **Servidor Físico**:
  El botón **"Proxmox Web"** abre `https://<hostname-o-ip>:8006` en una pestaña nueva.
* En la ficha individual del **VPS**:
  El botón **"Proxmox Console"** abre directamente la consola de la máquina virtual específica:  
  `https://<host-proxmox>:8006/#v1:0:=qemu/<vmid>`.

---

## 4. Referencia de URLs y Entornos

| Componente | Dirección / Enlace | Notas |
| :--- | :--- | :--- |
| **InfraPanel Producción** | [https://infrapanel.pages.dev](https://infrapanel.pages.dev) | Desplegado en Cloudflare Pages |
| **Repositorio GitHub** | [altomarketing/infrapanel](https://github.com/altomarketing/infrapanel) | Rama `main` con CI/CD automático |
| **Base de Datos** | Supabase PostgreSQL (`uqqmeqmswtsxiarexsup`) | Auth + RLS activo |
| **Usuario Administrador** | `diego@altomarketing.com` | Acceso con workspace propietario |
| **Reverse DNS Lookup** | Google DoH + Cloudflare DoH | Consulta en tiempo real sin backend |
