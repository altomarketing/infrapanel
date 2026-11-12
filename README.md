# InfraPanel

Panel privado de inventario manual de infraestructura, construido con React, TypeScript, Vite y Supabase.

## Requisitos
- Node.js 20 o superior
- Proyecto Supabase con el esquema SQL de InfraPanel ejecutado
- Un usuario creado en Supabase Authentication

## Configuración local

1. Instalar dependencias:

   ```bash
   npm install
   ```

2. Copiar `.env.example` a `.env.local`.
3. Completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` con el Project URL y la clave `sb_publishable_` de Supabase.
4. Iniciar:

   ```bash
   npm run dev
   ```

5. Abrir la URL local que muestra Vite.

## Primer acceso

Por seguridad, el frontend no ofrece registro público. Creá el usuario desde Supabase Dashboard → Authentication → Users → Add user. Luego iniciá sesión con ese correo y contraseña. En el primer acceso, InfraPanel crea el workspace "Mi infraestructura" y el trigger SQL agrega al usuario como propietario.

## Build y publicación

```bash
npm run build
```

El resultado queda en `dist/`. Publicá el contenido de esa carpeta en Bunny Storage configurado como sitio estático detrás de Bunny CDN. Configurá fallback de rutas SPA a `index.html` para que funcionen las rutas internas.

## Seguridad
- La clave `sb_publishable_` está diseñada para usarse en el cliente, pero la seguridad depende de RLS.
- Nunca agregues `service_role` ni la contraseña de PostgreSQL a variables `VITE_*`.
- Mantené el repositorio privado si contiene configuraciones internas.
- Verificá las políticas RLS antes de cargar datos reales.

## Alcance inicial
- Login con email y contraseña.
- Creación automática del workspace del propietario.
- Dashboard con contadores de servidores, servicios, dominios y redes.
- CRUD de servidores y selección de proveedor.
- Servicios, dominios, redes, proveedores y mapa visual aparecen como módulos próximos; todavía no tienen formularios funcionales.
