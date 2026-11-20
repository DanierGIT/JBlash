# LashStudio JB

Sitio de reservas sin registro de cliente, consulta privada de citas y panel para administración y profesional.

## Configurar Supabase desde cero

1. Crea un proyecto nuevo en [supabase.com](https://supabase.com/) e inicia sesión con tu cuenta. Guarda la contraseña de la base de datos que te solicite Supabase.
2. Cuando el proyecto termine de crearse, abre **Project Settings > API** (o **API Keys**). Copia el **Project URL** y la **Publishable key** (`sb_publishable_...`). En el archivo `.env`, se usan como `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
3. En la misma sección crea o copia una **Secret key** (`sb_secret_...`). También puede aparecer como `service_role` en proyectos/interfaz anteriores. Ponla como `SUPABASE_SERVICE_ROLE_KEY`. Esta clave tiene acceso privilegiado: guárdala solo en `.env` del servidor y nunca en `index.html`, Git o una captura pública.
4. En el panel del proyecto, abre **SQL Editor**, crea una consulta nueva, pega todo el contenido de `supabase-schema.sql` y pulsa **Run**. Esto crea las tablas `perfiles`, `citas`, `servicios`, `ingresos` y `egresos`, una función para registrar citas atendidas, activa las reglas de seguridad y crea el bucket privado para comprobantes. Si ejecutaste una versión anterior, vuelve a correr este archivo actualizado; sus cambios de tablas usan `if not exists`.
5. En **Authentication > Users**, crea una cuenta para cada persona del equipo. Copia el UUID de cada usuario. En **SQL Editor**, ejecuta una consulta por persona, sustituyendo los valores:

   ```sql
   insert into public.perfiles (id, nombre, rol)
   values ('UUID_REAL', 'Nombre del equipo', 'admin');
   ```

   Usa `admin` para tu cuenta o `profesional` para la cuenta de quien atiende. El UUID debe corresponder al usuario que acabas de crear. Para agregar a la profesional, crea su usuario en **Authentication > Users**, entrega sus credenciales iniciales en privado y ejecuta el mismo `insert` con rol `profesional`.

6. En la carpeta del proyecto, copia `.env.example` como `.env` y completa los valores:

   ```dotenv
   SUPABASE_URL=https://TU-PROJECT-REF.supabase.co
   SUPABASE_ANON_KEY=sb_publishable_TU_CLAVE
   SUPABASE_SERVICE_ROLE_KEY=sb_secret_TU_CLAVE
   PORT=4000
   PAYMENT_INSTRUCTIONS="Abono de $20.000 COP por Nequi al 3117653423. No reembolsable si la clienta no asiste."
   ```

   Reemplaza los textos de ejemplo por los valores de tu proyecto; no compartas el contenido de `.env`.
7. Ejecuta `npm start` y abre `http://localhost:4000`. Para probar el panel, usa el correo y la contraseña de uno de los usuarios del equipo.

El archivo `.env` está excluido de Git. Si falta alguna de las tres variables de Supabase, el servidor inicia pero las reservas, consultas y el panel responderán que falta configuración.

Si vienes de una versión anterior, vuelve a ejecutar `supabase-schema.sql` en Supabase > SQL Editor: crea o actualiza las tablas `horarios_semana`, `dias_bloqueados` y `disponibilidad_horas`, y agrega a `citas` los campos de cancelación y reagendamiento que usan el panel y la disponibilidad. Es reproducible y no borra datos; hasta que se ejecute, el panel mostrará un aviso al intentar usar estas funciones.

## Roles y funciones

- **Administración:** acceso al panel, agenda completa, comprobantes, estados, citas atendidas, catálogo de servicios e ingresos y egresos. Su resumen muestra la ficha del equipo (nombre, rol y correo) y cada cita indica quién la verificó, confirmó y atendió.
- **Profesional:** al ingresar ve primero **Mi agenda** (citas confirmadas y recordatorios) y un resumen de acceso a todos sus paneles. El botón **Enviar recordatorio(s)** aparece destacado arriba de las citas y cada cita confirmada tiene además su propio botón **Enviar recordatorio**; el mensaje de WhatsApp queda organizado con servicio, fecha y hora. El resto se ordena por importancia: **Nuevas citas**, **Por confirmar**, **Historial de atención**, **Servicios**, **Contabilidad** y **Seguridad**. Cada panel muestra su estado vacío cuando no hay datos.
- La cabecera y el panel indican siempre quién inició sesión y su rol; el botón **Iniciar sesión / Ingresar** desaparece al autenticarse y se reemplaza por la opción **Salir** en la cabecera. Desde el sitio público, el botón de inicio se convierte en una tarjeta de persona con el nombre y el rol de quien está logueado para volver al panel; la misma tarjeta aparece arriba del menú hamburguesa en móvil y dice explícitamente **Mi panel** para no confundirla con una opción de salida; para cerrar sesión se usa el botón de la cabecera, que se oculta mientras el menú hamburguesa está abierto para que no parezca una opción del desplegable.
- **Servicios:** desde la pestaña **Servicios** se editan nombre, precio, duración, descripción, icono, orden e **imagen de presentación** de cada tarjeta, se pueden ocultar o publicar y, con el botón **+ Nuevo servicio** se abre el formulario para agregar servicios nuevos. La imagen se sube desde el panel (JPG, PNG o WEBP de hasta 5 MB) o se pega como URL; si no hay imagen, la tarjeta usa el icono. Al guardar, el landing y el formulario de reserva se actualizan solos.
- **Agenda en vivo:** mientras el panel está abierto, se consulta cada 5 segundos si cambiaron las citas mediante `GET /api/panel/citas/version`. Si hay cambios, se vuelven a dibujar solo las tarjetas, sin recargar la página ni mover el scroll; se conservan los valores escritos en los campos de cobro y el foco. La insignia **En vivo** del encabezado cambia a **Agenda actualizada** unos segundos. No se actualiza mientras el comprobante está abierto ni cuando la pestaña está en segundo plano.
- **Horarios y disponibilidad:** en el formulario público la cliente elige la hora de una lista fija de **6:00 a. m. a 8:00 p. m., en intervalos de 1 hora**; ya no escribe la hora manualmente. Las horas ocupadas por otras citas o deshabilitadas por el estudio aparecen opacas y no se pueden seleccionar. El servidor recalcula la disponibilidad según la duración del servicio elegido (una cita de 2 horas bloquea los intervalos que se cruzan) y vuelve a validarla al recibir la reserva.
  - **Horario semanal (base):** desde **Disponibilidad > Horario base** la profesional define qué horas atiende cada día de la semana; ese horario se repite automáticamente.
  - **Excepciones por fecha:** en **Disponibilidad > Excepción por fecha** puede marcar un día completo como no disponible o ajustar horas puntuales (festivos, vacaciones, cambios de jornada). Las horas que difieren del horario base se señalan como excepción y se puede volver al horario base con un clic. Las horas con citas existentes no se pueden desmarcar.
- **Gestión de citas:** además de verificar, confirmar y marcar atendida, el panel permite **rechazar comprobante** (con motivo), **cancelar** (con motivo) y **reagendar** citas activas validando la disponibilidad del nuevo horario. El motivo y el historial de cambios quedan visibles en la tarjeta.
- **Calendario semanal:** en **Mi agenda** se puede alternar entre vista de **Lista** y **Semana** para ver las citas de la semana en una cuadrícula por horas y días; tocar una cita lleva a su tarjeta.
- **Clientela:** reserva sin cuenta con comprobante obligatorio y consulta de sus citas con cédula y celular.
- Las citas ocupadas se validan teniendo en cuenta la duración del servicio. Al marcar una cita como atendida se registra el total cobrado como ingreso. Insumos, arriendo y otros gastos se registran como egresos.
- WhatsApp abre conversaciones individuales con mensajes preparados. Por ahora la persona del equipo debe revisar y pulsar **Enviar** en cada chat; el sitio no envía mensajes automáticamente.

## Flujo de cita

- La clienta no crea cuenta. Para solicitar cita completa nombre, cédula, teléfono, servicio, fecha y hora, y adjunta una imagen JPG, PNG o WEBP de máximo 5 MB.
- El servidor guarda la imagen en el bucket privado `comprobantes-abono` y crea la cita como `pendiente_verificacion`.
- La clienta consulta sus citas ingresando la misma cédula y teléfono.
- La profesional o administración abre **Iniciar sesión** en la cabecera (también disponible en el pie de página), pulsa **Ver comprobante** para abrir la imagen en una ventana emergente dentro de la misma pestaña (ciérrala con la **X**, haciendo clic fuera o con **Esc**), revisa el comprobante y marca el abono verificado. Después confirma la cita.
- Al confirmar, el panel abre WhatsApp con un mensaje prellenado. La persona del equipo debe pulsar **Enviar** en esa conversación.

## Catálogo de servicios editable

El landing y el selector del formulario de reserva leen `/api/servicios`, que consulta la tabla `public.servicios`. La pestaña **Servicios** del panel usa `/api/panel/servicios` (GET, POST y PUT, siempre con token de sesión) para editar el catálogo. Cada guardado recarga el catálogo público en la misma pantalla, sin recargar manualmente.

Cada servicio puede llevar una imagen de presentación: sube el archivo en su tarjeta (o pega una URL) y se guarda en el bucket público `servicios-imagenes`, creado por la migración. El landing muestra la foto en la tarjeta y, si no hay imagen, conserva el icono.

**Importante:** para que los cambios se guarden es necesario ejecutar `supabase-schema.sql` en **Supabase > SQL Editor**. Ese archivo crea la columna `imagen_url`, la tabla `servicios` con sus cuatro servicios iniciales y el bucket de imágenes; vuelve a ejecutarlo sin borrar nada. Mientras la tabla no exista, el landing sigue mostrando los cuatro servicios iniciales, pero el panel mostrará el aviso *«Falta publicar el catálogo…»* y no habrá edición persistente.

## Publicación

Configura `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYMENT_INSTRUCTIONS` y `PORT` como variables de entorno en el servicio donde publiques el servidor. Mantén la clave secreta únicamente en el servidor.
