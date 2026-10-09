# Sincronizar varios teléfonos con una hoja de Google

Con esto, cada ingreso que registra un teléfono se escribe en la hoja (columnas **INGRESADO**, **HORA INGRESO** y **REGISTRADO POR**) y los demás teléfonos lo ven a los pocos segundos. Si la misma persona intenta entrar por dos puertas, el segundo teléfono avisa que ya había ingresado, con la hora y la puerta.

Se instala **una sola vez** por hoja. Lleva unos 5 minutos.

## Antes de empezar

- La lista tiene que ser una **hoja de cálculo de Google** (no un `.xlsx` guardado en Drive). Si es `.xlsx`: abrilo en Drive → *Archivo → Guardar como hoja de cálculo de Google*.
- Tu cuenta de Google tiene que tener permiso de **editor** sobre la hoja (si te la comparten solo para ver, no se puede escribir en ella).
- Los teléfonos necesitan internet en el lugar del evento (datos móviles o Wi‑Fi).

## 1. Instalar el script en la hoja

1. Abrí la hoja. Menú **Extensiones → Apps Script**.
2. Borrá el código que aparece y pegá **todo** el contenido de `Code.gs` (está en esta carpeta).
3. En las primeras líneas cambiá `cambiar-esta-clave` por una clave tuya de 6 caracteres o más (por ejemplo `cata-2026-vinos`). Guardá con el ícono del disquete.
4. Arriba a la derecha: **Implementar → Nueva implementación**. Tocá el engranaje ⚙ y elegí **Aplicación web**.
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier persona**
5. **Implementar**. Google pide autorización: elegí tu cuenta; si aparece «Google no verificó esta app», tocá *Configuración avanzada → Ir a (nombre del proyecto) → Permitir*. Es tu propio script.
6. Copiá la **URL de la aplicación web** (termina en `/exec`).
7. Probala: pegá esa URL en el navegador. Tiene que decir *«Control de Ingreso: el script está publicado y activo»*.

## 2. Conectar cada teléfono

1. En la app: **Menú → Sincronizar con Google Sheets**.
2. Pegá la URL, escribí la clave y un nombre para ese teléfono (por ejemplo *Puerta 1*).
3. **Conectar → Conectar y cargar la lista.** La lista se carga desde la hoja (ya no hace falta importar el Excel).
4. Elegí **qué dato trae el QR** (por ejemplo *Código*) y guardá.
5. Repetí en cada teléfono, con otro nombre (*Puerta 2*, *Mesa de ayuda*…).

Arriba, junto al nombre del evento, aparece **Sincronizado**. Si no hay señal dice cuántos cambios quedan **sin enviar**; se mandan solos al volver la conexión.

## Qué hay que saber

- **Quién gana:** si dos teléfonos registran a la misma persona casi al mismo tiempo, vale el primero que llegó a la hoja; el otro teléfono se corrige y avisa.
- **Sin señal:** el teléfono sigue registrando ingresos y los guarda. No se enteran de los ingresos de otros hasta recuperar la conexión; en ese lapso podría dejar pasar a alguien que ya entró por otra puerta.
- **Desde la hoja:** escribir `SI` en INGRESADO marca a esa persona como ingresada; borrar la celda le quita el ingreso. Cambia en los teléfonos a los pocos segundos.
- **Lista que cambia:** si la otra aplicación agrega personas a la hoja, aparecen solas en la app. **Probalo antes del evento** generando un QR de prueba y verificando que las columnas INGRESADO / HORA INGRESO / REGISTRADO POR no se borran.
- **Títulos:** el script detecta solo la fila de títulos. Si tu hoja tiene varias pestañas, poné el nombre de la que tiene la lista en `HOJA` (arriba en el código).
- **Lo que no se comparte:** los QR **no listados** (los de «Por verificar») y las decisiones de válido/rechazado quedan en cada teléfono.
- **Frecuencia:** por defecto cada 5 segundos. Con 4 o más teléfonos conviene 10 segundos (*Menú → Sincronización → Consultar la hoja cada*).
- **Reiniciar ingresos** en un teléfono sincronizado también borra los ingresos de la hoja y de los otros teléfonos.

## Seguridad

La dirección del script es pública, pero sin la clave no devuelve nada. No la publiques junto con la clave. Si sospechás que se filtró: cambiá la clave en el script y volvé a implementar (*Implementar → Administrar implementaciones → ✏ → Versión: Nueva versión*); la URL no cambia. Para cortar el acceso del todo: *Administrar implementaciones → Archivar*.

## Si cambiás el código del script

Guardá, y en *Implementar → Administrar implementaciones* editá la implementación → **Versión: Nueva versión → Implementar**. Si solo guardás, la aplicación web sigue con el código viejo.

## Problemas frecuentes

| Mensaje en la app | Qué revisar |
|---|---|
| «No se pudo conectar con el script» | La URL tiene que terminar en `/exec`, el acceso debe ser *Cualquier persona* y el teléfono necesita señal. |
| «La clave no coincide» | Es la `CLAVE` del código, sin espacios; si la cambiaste, hay que hacer una *nueva versión*. |
| «En el script todavía está la clave de ejemplo» | Cambiá `cambiar-esta-clave` y volvé a implementar. |
| «El script instalado es de otra versión» | Pegá de nuevo el `Code.gs` de esta versión de la app y hacé una nueva versión. |
| No aparece la lista / otra pestaña | Poné el nombre de la pestaña en `HOJA`. |
