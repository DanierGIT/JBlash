const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '8mb' }));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bwlyupsfhjpnqcdaeikx.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_7ZU7E3Q5WjcR84ff-x7EHQ_93BfgExi';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'comprobantes-abono';
const PORT = Number(process.env.PORT || 4000);
const publicClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const adminClient = SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;

const services = [
  { id: 'clasicas', name: 'Pestañas clásicas', price: 80000, duration: 120, description: 'Un acabado natural y delicado, pelo a pelo.' },
  { id: 'hibrido', name: 'Volumen híbrido', price: 100000, duration: 150, description: 'Equilibrio entre definición y volumen.' },
  { id: 'ruso', name: 'Volumen ruso', price: 120000, duration: 180, description: 'Abanicos ligeros para una mirada intensa.' },
  { id: 'retoque', name: 'Mantenimiento / retoque', price: 50000, duration: 90, description: 'Renueva y conserva tu diseño.' },
];

function requireAdminClient(res) {
  if (!adminClient) {
    res.status(503).json({ error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor.' });
    return false;
  }
  return true;
}

async function requireStaff(req, res, next) {
  if (!requireAdminClient(res)) return;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  const { data: authData, error: authError } = await publicClient.auth.getUser(token);
  if (authError || !authData.user) return res.status(401).json({ error: 'Sesión inválida o vencida.' });
  const { data: profile, error } = await adminClient.from('perfiles').select('rol,nombre').eq('id', authData.user.id).single();
  if (error || !profile || !['admin', 'profesional'].includes(profile.rol)) return res.status(403).json({ error: 'Esta cuenta no tiene acceso al panel.' });
  req.staff = { id: authData.user.id, role: profile.rol, name: profile.nombre || authData.user.email };
  next();
}

app.get('/api/config', (_req, res) => res.json({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY, paymentInstructions: process.env.PAYMENT_INSTRUCTIONS || '' }));
app.get('/api/servicios', (_req, res) => res.json(services));

app.post('/api/citas', async (req, res) => {
  if (!requireAdminClient(res)) return;
  const { nombre, cedula, telefono, servicio, fecha, hora, comprobante } = req.body || {};
  const service = services.find(item => item.id === servicio);
  const cleanPhone = String(telefono || '').replace(/\D/g, '');
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(fecha || '') ? new Date(`${fecha}T00:00:00Z`) : null;
  const validDate = selectedDate && !Number.isNaN(selectedDate.valueOf()) && selectedDate.toISOString().slice(0, 10) === fecha;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (!nombre?.trim() || nombre.trim().length > 120 || !cedula?.trim() || cedula.trim().length > 30 || cleanPhone.length < 7 || cleanPhone.length > 15 || !service || !validDate || fecha < today || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora || '')) {
    return res.status(400).json({ error: 'Revisa los datos de la cita e intenta de nuevo.' });
  }
  if (!comprobante || !/^image\/(jpeg|png|webp)$/.test(comprobante.mime || '') || typeof comprobante.base64 !== 'string') {
    return res.status(400).json({ error: 'Carga una imagen JPG, PNG o WEBP del comprobante.' });
  }
  const buffer = Buffer.from(comprobante.base64, 'base64');
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'La imagen debe pesar máximo 5 MB.' });
  const isImage = comprobante.mime === 'image/jpeg' ? buffer[0] === 0xff && buffer[1] === 0xd8 : comprobante.mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!isImage) return res.status(400).json({ error: 'El archivo no parece ser una imagen válida.' });
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[comprobante.mime];
  const receiptPath = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
  try {
    const { error: uploadError } = await adminClient.storage.from(BUCKET).upload(receiptPath, buffer, { contentType: comprobante.mime, upsert: false });
    if (uploadError) throw uploadError;
    const { data, error } = await adminClient.from('citas').insert({
      nombre: nombre.trim(), cedula: cedula.trim(), telefono: cleanPhone, servicio: service.name,
      servicio_id: service.id, precio: service.price, abono: 20000, fecha, hora,
      comprobante_path: receiptPath, estado: 'pendiente_verificacion',
    }).select('id').single();
    if (error) {
      await adminClient.storage.from(BUCKET).remove([receiptPath]);
      throw error;
    }
    res.status(201).json({ exito: true, id_cita: data.id, mensaje: 'Comprobante recibido. Tu cita quedó pendiente de verificación.' });
  } catch (error) {
    console.error('Error creando cita:', error.message);
    res.status(500).json({ error: 'No se pudo guardar la cita. Verifica la configuración e inténtalo de nuevo.' });
  }
});

app.post('/api/citas/consultar', async (req, res) => {
  if (!requireAdminClient(res)) return;
  const cedula = String(req.body?.cedula || '').trim();
  const telefono = String(req.body?.telefono || '').replace(/\D/g, '');
  if (!cedula || telefono.length < 7) return res.status(400).json({ error: 'Ingresa la cédula y el teléfono usado al reservar.' });
  const { data, error } = await adminClient.from('citas').select('id,servicio,fecha,hora,estado,abono,created_at')
    .eq('cedula', cedula).eq('telefono', telefono).order('fecha', { ascending: true });
  if (error) return res.status(500).json({ error: 'No se pudo consultar la cita.' });
  res.json(data || []);
});

app.get('/api/panel/citas', requireStaff, async (_req, res) => {
  const { data, error } = await adminClient.from('citas').select('*').order('fecha', { ascending: true }).order('hora', { ascending: true });
  if (error) return res.status(500).json({ error: 'No se pudieron cargar las citas.' });
  const rows = await Promise.all((data || []).map(async cita => {
    if (!cita.comprobante_path) return cita;
    const { data: signed } = await adminClient.storage.from(BUCKET).createSignedUrl(cita.comprobante_path, 900);
    return { ...cita, comprobante_url: signed?.signedUrl || null };
  }));
  res.json({ perfil: req.staff, citas: rows });
});

app.post('/api/panel/citas/:id/verificar', requireStaff, async (req, res) => {
  const { data, error } = await adminClient.from('citas').update({ estado: 'verificada', verificada_por: req.staff.id })
    .eq('id', req.params.id).eq('estado', 'pendiente_verificacion').select('id,estado').maybeSingle();
  if (error) return res.status(500).json({ error: 'No se pudo verificar el abono.' });
  if (!data) return res.status(409).json({ error: 'La cita ya fue revisada o no está pendiente.' });
  res.json({ exito: true });
});

app.post('/api/panel/citas/:id/confirmar', requireStaff, async (req, res) => {
  const { data, error } = await adminClient.from('citas').update({ estado: 'confirmada', confirmada_por: req.staff.id })
    .eq('id', req.params.id).eq('estado', 'verificada').select('*').maybeSingle();
  if (error) return res.status(500).json({ error: 'No se pudo confirmar la cita.' });
  if (!data) return res.status(409).json({ error: 'Primero verifica el comprobante de abono.' });
  res.json({ exito: true, cita: data });
});

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`LashStudio JB disponible en http://localhost:${PORT}`));
