# Biblioteca de Causas

App personal del Dr. Facundo Martín Palacio para llevar el estado, los movimientos y los documentos de cada causa.

## Puesta en marcha (una sola vez)
1. Firebase (https://console.firebase.google.com): crear el proyecto `biblioteca-causas` (plan gratuito Spark).
   - Agregar una app web y copiar el `firebaseConfig` en `firebase-config.js`.
   - Authentication > Método de acceso: habilitar **Google**.
   - Authentication > Configuración > Dominios autorizados: agregar `drpalaciof-cell.github.io`.
   - Firestore Database: crear la base (modo producción) y pegar el contenido de `firestore.rules` en la pestaña Reglas.
2. GitHub: subir esta carpeta al repo `drpalaciof-cell/biblioteca-causas` y activar Pages (Settings > Pages > rama `main`, carpeta raíz).
3. Abrir https://drpalaciof-cell.github.io/biblioteca-causas/ , ingresar con Google y tocar **Importar mis causas** y elegir el archivo `causas-inicial.json` que está en tu PC (no se sube a GitHub: tiene datos de clientes).

## Instalar en el celular
Abrir el link en Chrome > menú > "Agregar a la pantalla principal".
