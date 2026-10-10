# Control de Ingreso — PWA

Registra el ingreso a un evento leyendo códigos QR y comparándolos con la lista de asistentes que cargues desde Excel. Mobile first, funciona sin conexión y se instala en Android y iPhone.

Está hecha con la misma base técnica que *Grupos de Viaje* (JS puro, sin framework, service worker, SheetJS, jsPDF y html2canvas locales).

## Publicar en GitHub Pages

1. Creá un repositorio nuevo (por ejemplo `control-ingreso`).
2. Subí **todo el contenido de esta carpeta** a la raíz (incluido el archivo oculto `.nojekyll`).
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
4. En 1–2 minutos queda en `https://TU-USUARIO.github.io/control-ingreso/`.

> La cámara solo funciona desde `https://` (GitHub Pages lo cumple). Abrí la app una vez con conexión: después funciona sin internet.
>
> **Privacidad:** el repositorio no contiene ningún dato de asistentes. La lista se importa desde el propio teléfono y queda guardada **solo en ese dispositivo**. Podés dejar el repositorio público sin exponer nombres. Si necesitás probar, la carpeta `ejemplo/` trae una lista y QR de prueba (borrala antes de publicar si no la querés).

## Instalar en el celular

- **Android (Chrome):** menú ⋮ → *Instalar la app*.
- **iPhone (Safari):** botón *Compartir* → *Agregar a inicio*. En iPhone, la app instalada y Safari guardan los datos por separado: usá siempre el ícono instalado.

## Cómo se usa

1. **Datos del evento:** tocá el título (arriba) → nombre, fecha y lugar.
2. **Importar la lista:** menú ⚙ → *Importar lista de asistentes* y elegí el `.xlsx` (o `.csv`) que genera la otra aplicación.
   - Detecta sola la fila de títulos y propone qué columnas forman el nombre.
   - **¿Qué dato trae el QR?** Si lo sabés (por ejemplo *Código* o *DNI*), elegí esa columna: es lo más preciso. En *Automático* prueba con todas las columnas.
3. **Escanear QR:** botón grande. Cada lectura da una respuesta inmediata con color, sonido y vibración:
   - **Verde — Ingreso registrado:** marca a la persona como presente y guarda la hora. Tiene botón *Deshacer*.
   - **Ámbar — Ya había ingresado:** muestra la hora del primer ingreso; no duplica nada.
   - **Rojo — No figura en la lista:** el dato leído queda guardado y la app te pide decidir: **Dar por válido**, **Rechazar** o **Decidir después**. Lo pendiente se resuelve cuando quieras desde la pestaña *Por verificar* (y se puede cambiar la decisión).
   - Si la cámara falla: *Escribir código* o *Desde foto* (lee un QR de una imagen o captura).
4. **Resumen en vivo:** total de la lista, presentes, faltan, por verificar y avance. Los *ingresos válidos fuera de lista* se cuentan aparte.
5. **Pestañas:** *Lista* (buscar, filtrar presentes/faltan, tocar a una persona para ver sus datos o registrar/quitar el ingreso a mano), *Por verificar* y *Registro* (todo movimiento con su hora).

### Cómo decide si un QR coincide

Funciona con QR de texto simple (un código, un DNI), JSON (`{"id":"CATA-0001"}`), enlaces con parámetros (`…?code=CATA-0001`) y listas separadas por `|`, `;` o `,`. Compara sin distinguir mayúsculas, tildes ni separadores (`CATA 0001` = `cata-0001`).

Es **conservadora a propósito**: un dato suelto y común (un nombre de pila, «Socio», «Mesa 2») nunca alcanza para dar por válida a una persona. Se acepta un código/DNI único, o nombre y apellido juntos en cualquier orden. Ante la duda, el QR va a *Por verificar*. Si dos personas coinciden por igual, la app te pide elegir. En menú → *Columnas y coincidencia* hay un probador: pegás el contenido de un QR y ves a quién corresponde, sin registrar nada.

### Actualizar la lista durante el evento

Si la otra aplicación agrega asistentes, volvé a importar el Excel y elegí **Actualizar conservando los ingresos** (disponible cuando las columnas son las mismas): suma los nuevos y respeta quién ya ingresó.

## Sincronizar varios teléfonos (opcional)

Si la lista está en una **hoja de Google**, varios teléfonos pueden compartir en vivo quién ya ingresó: cada ingreso se escribe en las columnas INGRESADO / HORA INGRESO / REGISTRADO POR de la hoja y los demás teléfonos lo ven a los pocos segundos. Si una persona intenta entrar por dos puertas, el segundo teléfono avisa que ya había ingresado.

Hace falta instalar una vez el script de `apps-script/Code.gs` en la hoja (no hay servidor ni cuentas extra: corre en tu cuenta de Google). **Guía paso a paso: [`apps-script/LEEME.md`](apps-script/LEEME.md).** Después, en cada teléfono: *Menú → Sincronizar con Google Sheets*.

- Sin conexión la app sigue registrando y envía lo pendiente al volver la señal.
- Los QR que no figuran en la lista se anotan en la pestaña **«No listados»** de la misma hoja (con estado Por verificar / Válido / Rechazado, hora y teléfono) y se comparten entre todos los teléfonos. La lista original no se modifica.
- Sin sincronización la app funciona igual que antes, todo en el dispositivo.

## Apariencia

Menú → *Colores y fondo*:

- **Paletas (13):** Vino tinto, **Negro y oro**, Azul cerúleo, Laca carminada, Verde botella, Ciruela, Azul de Prusia, Siena tostada, Grafito, Salvia, Rosa antiguo, Azul niebla y Lino y arena. Tema automático, claro u oscuro.
- **Contraste:** *Suave* (por defecto: tonos cálidos, sin negros ni blancos extremos) o *Intenso* (más marcado). Todas las combinaciones mantienen texto legible (mínimo 4,5:1).
- **Imagen de fondo (opcional):** se achica y guarda en el dispositivo. Con *Intensidad* y *Desenfoque* la dejás tan sutil como quieras, para que el texto siempre se lea bien.
- **Sonido y vibración:** tonos distintos para ingreso válido, ya ingresó, no figura y rechazado. Se puede silenciar desde el escáner. La vibración funciona en Android.

## Exportar

Botón de exportar (arriba a la derecha), con *Descargar* o *Compartir*:

| Formato | Contenido |
|---|---|
| **PDF** | Informe con resumen, presentes (con hora), faltantes y no listados con su estado |
| **Imagen (PNG)** | Resumen para compartir (las listas largas se acortan) |
| **Excel (.xlsx)** | Hojas *Resumen*, *Lista* (columnas originales + estado + hora), *No listados* y *Registro* |
| **CSV** | Tabla simple (separador `;`, abre bien en Excel de Argentina) |

También: *Copia de seguridad* (guarda/recupera todo en un `.json`, útil para pasar el evento a otro teléfono), *Reiniciar ingresos* y *Borrar todo el evento*.

## Estructura

```
index.html              App (una sola página)
css/styles.css          Estilos mobile first, claro/oscuro
js/palettes.js          Paletas de color (se carga primero para evitar parpadeo)
js/app.js               Lógica de la app
sw.js                   Service Worker (cache offline)
apps-script/Code.gs     Script para pegar en la hoja de Google (sincronización)
apps-script/LEEME.md    Guía de instalación del script
manifest.webmanifest    Manifest PWA
lib/                    SheetJS, jsPDF, html2canvas, jsQR (locales, para uso offline)
icons/                  Íconos de la app
ejemplo/                Lista de prueba (.xlsx) y QR de prueba
```

## Actualizar la app ya publicada

Cuando cambies archivos, subí también un `sw.js` con otra `VERSION` (por ejemplo `v1.2.1`) y cambiá `APP_VERSION` en `js/app.js`. Los dispositivos verán el aviso **«Hay una nueva versión disponible — Actualizar»**. Los datos guardados no se pierden. En el menú también están *Buscar actualización* y *Forzar actualización*.

## Probar antes del evento

1. Importá `ejemplo/lista-ejemplo.xlsx`.
2. Escaneá (o usá *Desde foto* con) los PNG de `ejemplo/qr/`: tres son de asistentes, uno es de alguien **no listado** (`INV-9999`) y otro trae el dato en formato JSON.

## Licencias de terceros

SheetJS Community Edition (Apache 2.0), jsPDF (MIT), html2canvas (MIT), jsQR (Apache 2.0).
