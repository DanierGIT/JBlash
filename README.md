# LashStudio JB

Sitio de reservas sin registro de cliente, consulta privada de citas y panel para administración y profesional.

## Configuración inicial

1. En Supabase, abre **SQL Editor** y ejecuta `supabase-schema.sql`.
2. En Authentication, crea una cuenta para ti y otra para la profesional. Copia los UUID de ambas cuentas.
3. Asigna los roles en el SQL Editor usando los UUID reales:

   ```sql
   insert into public.perfiles (id, nombre, rol)
   values ('UUID_DE_TU_CUENTA', 'Administradora', 'admin');

   insert into public.perfiles (id, nombre, rol)
   values ('UUID_DE_LA_PROFESIONAL', 'Pastora', 'profesional');
   ```

4. Copia `.env.example` a `.env`. Completa `SUPABASE_SERVICE_ROLE_KEY` con la clave secreta de servicio del proyecto Supabase. Esta clave solo va en el servidor: nunca la publiques ni la pegues en el HTML.
5. Completa `PAYMENT_INSTRUCTIONS` con los medios y datos reales para pagar los $20.000 COP.
6. Ejecuta `npm start` y abre `http://localhost:4000`.

## Flujo de cita

- La clienta no crea cuenta. Para solicitar cita completa nombre, cédula, teléfono, servicio, fecha y hora, y adjunta una imagen JPG, PNG o WEBP de máximo 5 MB.
- El servidor guarda la imagen en el bucket privado `comprobantes-abono` y crea la cita como `pendiente_verificacion`.
- La clienta consulta sus citas ingresando la misma cédula y teléfono.
- La profesional o administración abre el acceso del equipo en el pie de página, revisa el comprobante y marca el abono verificado. Después confirma la cita.
- Al confirmar, el panel abre WhatsApp con un mensaje prellenado con la confirmación y los detalles. Por las restricciones de WhatsApp, la persona del equipo debe pulsar **Enviar** en esa conversación.

## Publicación

Configura las mismas variables de entorno (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYMENT_INSTRUCTIONS` y `PORT`) en el servicio donde se publique el servidor. No incluyas la clave de servicio en archivos públicos.
