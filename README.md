# SOAZ · Módulo de Inspección de Calidad (Papaya)

PWA industrial para inspección de calidad en una línea de reempaque de papaya.
Optimizada para iPad, tablets Android y computadoras. Funciona con **HTML5 + CSS3 + JavaScript nativo** (sin frameworks) y usa **Google Apps Script + Google Sheets** como backend.

---

## 1. Archivos

| Archivo | Descripción |
|---|---|
| `index.html` | Frontend completo (UI + lógica). No contiene la contraseña. |
| `manifest.json` | Manifiesto PWA. |
| `sw.js` | Service Worker (caché offline del shell). |
| `Codigo.gs` | Backend Google Apps Script (auth, tokens, hojas, alertas). |
| `abrir-app.bat` | Lanza el servidor local en Windows y abre la app. |
| `servidor.ps1` | Servidor HTTP estático en PowerShell (PC + iPad por Wi-Fi). |
| `README.md` | Este documento. |

---

## 2. Puesta en marcha del backend (Google Apps Script)

1. Crea una hoja nueva en Google Sheets.
2. En el menú **Extensiones → Apps Script**, borra el contenido y pega **`Codigo.gs`** completo.
3. Edita la sección `CONFIG` en `Codigo.gs`:
   - `SPREADSHEET_ID`: el ID de tu hoja (parte de la URL entre `/d/` y `/edit`).
   - `ALERT_EMAILS`: correos que reciben la alerta de 3 errores.
   - `APP_PASSWORD`: contraseña del turno (por defecto `Chula2025`).
4. **Implementar → Nueva implementación → Aplicación web**
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier persona**
5. Copia la URL `/exec` y pégala en `index.html` (constante `CONFIG.apiBaseUrl`).

Las hojas se crean solas la primera vez que se usan:
`Inspecciones Simples`, `Inspecciones Detalladas`, `Empacadores`, `Alertas`,
`Log`, `Resumen Empacadores`, `Sesiones`.

---

## 3. Ejecutar la app

### Opción A · Servidor local (Windows, PC + iPad)
1. Doble clic en **`abrir-app.bat`**.
2. En la PC se abre `http://127.0.0.1:8080/`.
3. En el iPad/tablet (misma Wi-Fi) abre `http://TU_IP:8080/` (la IP aparece en la ventana).

> No abras `index.html` con doble clic (`file://`): el backend no responde bajo ese protocolo.

### Opción B · GitHub Pages / servidor web
Sube los archivos a un repositorio y activa **GitHub Pages**. La app funcionará desde la URL pública.

---

## 4. Seguridad (simple)

- La contraseña vive **solo** en `Codigo.gs` (`APP_PASSWORD`), nunca en `index.html`.
- Al iniciar sesión, el backend valida la contraseña y devuelve un **token** (`session_...`).
- El token se guarda en `localStorage` y se envía en **todas** las acciones protegidas.
- Cada acción protegida verifica que el token exista y no esté expirado (12 h).
- Si el token es inválido/expira, el backend responde `{ ok:false, error:"Sesión inválida o expirada" }` y la app regresa a la pantalla de inicio.

Acciones públicas: `authenticate`.
Acciones protegidas: `list_packers`, `upsert_packer`, `delete_packer`, `register_simple_inspection`, `register_detailed_inspection`, `send_alert`, `open_shift`, `close_shift`.

---

## 5. Flujo de uso

1. **Inicio de turno**: supervisor + contraseña + interruptor **Detailed Mode** (encendido por defecto). El modo queda fijado para el turno.
2. **Empacadores**: catálogo compartido; marca quién trabaja, agrega, activa/desactiva, elimina o sincroniza.
3. **Modo simple** (toggle apagado): tablero de defectos con rutas → empacador → guarda en `Inspecciones Simples`. Cada inspección suma **1 error**.
4. **Modo detallado** (toggle encendido):
   - **Count** (5–20): total de papayas en la caja.
   - **Defectos**: lista táctil (Pudrición, Tallones, Calibre Revuelto, Colores Mixtos, Mal Acomodo, Mal Envuelto, Mal Pesado). En cada defecto solo se elige **la cantidad** de papayas afectadas; asignación exclusiva (una papaya, un defecto). **Mal Pesado** es a nivel caja (Peso ↑/↓) y no consume Count.
   - Las papayas restantes se calculan automáticamente como buenas.
   - **Submit** → empacador → guarda en `Inspecciones Detalladas` (**1 fila por caja**, con una columna por cada defecto) → vuelve a **Count**.
   - Una auditoría con ≥1 defecto suma **1 error**; sin defectos suma **0** y se registra como `Sin defectos`.

### Formato de `Inspecciones Detalladas`

Columnas visibles:

`Audit ID | Timestamp | Código empacador | Nombre empacador | Count | Papayas con defecto | Papayas buenas | Tallones | Mal Acomodo | Pudrición | Mal Envuelto | Colores Mixtos | Calibre Revuelto | Mal Pesado`

- **1 fila = 1 caja** (ya no se repite una fila por cada defecto).
- Supervisor e inicio de turno aparecen en la **fila amarilla** de cambio de turno.
- Cada defecto muestra su cantidad (`0` si no hubo).
- `Mal Pesado` guarda `Peso ↑` o `Peso ↓`.
- Si existía el formato viejo (columna `Defecto`), se renombra a `Inspecciones Detalladas (historial)` y se crea una hoja limpia.
5. **Alerta de 3 errores**: al tercer registro con error de un empacador, muestra modal y envía email (una vez por turno y empacador).
6. **Cerrar Turno**: limpia contadores, borrador y token local; regresa al inicio.

---

## 6. Día operativo

- Hora de corte configurable (`operationalDayStartHour` en `index.html`, `16:00` por defecto).
- Un turno que cruza medianoche pertenece al día inicial.
- Los marcadores `—— CAMBIO DE TURNO ——` aparecen en la hoja del modo correspondiente.

---

## 7. Estado local y cola offline

Si falla Google Sheets, los registros se guardan en una **cola local** con opción de reintentar o vaciar. Se persisten: token, turno, supervisor, modo, empacadores, Count/auditoría actual, contadores de error, cola pendiente y preferencia de búsqueda.
