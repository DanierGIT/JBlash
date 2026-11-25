const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '8mb' }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'comprobantes-abono';
const SERVICE_IMAGE_BUCKET = 'servicios-imagenes';
const PORT = Number(process.env.PORT || 4000);
const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SERVICE_ROLE_KEY);
const publicClient = supabaseConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const adminClient = supabaseConfigured ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;

const defaultServices = [
  { id: 'clasicas', name: 'Pestañas clásicas', price: 80000, duration: 90, description: 'Un acabado natural y delicado, pelo a pelo.', icon: 'bi bi-magic', imagen: '', active: true, order: 0 },
  { id: 'hibrido', name: 'Volumen híbrido', price: 100000, duration: 90, description: 'Equilibrio entre definición y volumen.', icon: 'bi bi-magic', imagen: '', active: true, order: 1 },
  { id: 'ruso', name: 'Volumen ruso', price: 120000, duration: 90, description: 'Abanicos ligeros para una mirada intensa.', icon: 'bi bi-magic', imagen: '', active: true, order: 2 },
  { id: 'retoque', name: 'Mantenimiento / retoque', price: 50000, duration: 90, description: 'Renueva y conserva tu diseño.', icon: 'bi bi-magic', imagen: '', active: true, order: 3 },
];
const serviceIcons = ['bi bi-magic','bi bi-layers','bi bi-stars','bi bi-arrow-repeat','bi bi-scissors','bi bi-sparkles','bi bi-heart','bi bi-emoji-heart-eyes'];
function mapService(row){return { id: row.id, name: row.nombre, price: Number(row.precio), duration: Number(row.duracion), description: row.descripcion || '', icon: row.icono || 'bi bi-magic', imagen: row.imagen_url || '', active: row.activo !== false, order: Number(row.orden) || 0 };}
function validImageUrl(value){
  if(!value) return true;
  if(value.startsWith('/') && !value.startsWith('//')) return true;
  try{ return ['http:','https:'].includes(new URL(value).protocol); }catch{ return false; }
}
async function getServices(includeInactive = false){
  if(!adminClient) return defaultServices.filter(item=>includeInactive||item.active);
  const { data, error } = await adminClient.from('servicios').select('*').order('orden',{ascending:true}).order('created_at',{ascending:true});
  if(error || !data || !data.length) return defaultServices.filter(item=>includeInactive||item.active);
  return data.map(mapService).filter(item=>includeInactive||item.active);
}
function validateServicePayload(body){
  const name=String(body?.name||'').trim(), description=String(body?.description||'').trim(), imagen=String(body?.imagen||'').trim();
  const price=Number(body?.price), duration=Number(body?.duration), order=Number(body?.order);
  if(!name||name.length>120||description.length>300||imagen.length>1000||!validImageUrl(imagen)||!Number.isSafeInteger(price)||price<1||!Number.isSafeInteger(duration)||duration<1||duration>600) return null;
  return { nombre:name, descripcion:description, precio:price, duracion:duration, icono:serviceIcons.includes(body?.icon)?body.icon:'bi bi-magic', imagen_url:imagen, orden:Number.isSafeInteger(order)?order:0, activo:body?.active!==false };
}

const SLOT_START_HOUR = 6;
const SLOT_END_HOUR = 20;
const SLOT_STEP_MINUTES = 30;
const SERVICE_DURATION_MINUTES = 90;
const TIME_SLOTS = Array.from({ length: ((SLOT_END_HOUR - SLOT_START_HOUR) * 60) / SLOT_STEP_MINUTES + 1 }, (_, i) => {
  const total = SLOT_START_HOUR * 60 + i * SLOT_STEP_MINUTES;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
});
function minutesOfTime(value){const [h,m]=String(value||'').split(':').map(Number);return (h||0)*60+(m||0)}
function isValidDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value||'') && !Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value}
const WEEKDAY_LABELS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
function isMissingTable(error){return Boolean(error&&(error.code==='42P01'||error.code==='PGRST205'))}
function weekdayOf(fecha){return new Date(`${fecha}T12:00:00Z`).getUTCDay()}
async function weeklySlots(diaSemana){
  const {data,error}=await adminClient.from('horarios_semana').select('hora,activo').eq('dia_semana',diaSemana);
  if(isMissingTable(error)||!error&&(!data||!data.length))return new Set(TIME_SLOTS);
  if(error)throw new Error('No se pudo consultar el horario semanal.');
  return new Set(data.filter(row=>row.activo===true).map(row=>String(row.hora).slice(0,5)));
}
async function availabilityFor(fecha, servicioId, excludeId){
  let services=defaultServices;
  try{services=await getServices(true)}catch(error){console.error('Error consultando servicios para disponibilidad:',error.message)}
  const duration=SERVICE_DURATION_MINUTES;
  let citasQuery=adminClient.from('citas').select('hora,servicio_id').eq('fecha',fecha).neq('estado','cancelada').eq('eliminada',false);
  if(excludeId)citasQuery=citasQuery.neq('id',excludeId);
  const [{data:dias,error:diasError},{data:excepciones,error:excepcionesError},{data:citas,error:citasError},base]=await Promise.all([
    adminClient.from('dias_bloqueados').select('fecha').eq('fecha',fecha),
    adminClient.from('disponibilidad_horas').select('hora,disponible').eq('fecha',fecha),
    citasQuery,
    weeklySlots(weekdayOf(fecha)),
  ]);
  if(citasError||(diasError&&!isMissingTable(diasError))||(excepcionesError&&!isMissingTable(excepcionesError)))throw new Error('No se pudo consultar la disponibilidad.');
  const overrides=new Map((isMissingTable(excepcionesError)?[]:(excepciones||[])).map(row=>[String(row.hora).slice(0,5),row.disponible===true]));
  const disponibles=TIME_SLOTS.filter(hora=>overrides.has(hora)?overrides.get(hora):base.has(hora));
  const horasBloqueadas=TIME_SLOTS.filter(hora=>!disponibles.includes(hora));
  const ocupadas=new Set();
  (citas||[]).forEach(cita=>{
    const start=minutesOfTime(cita.hora);
    const end=start+SERVICE_DURATION_MINUTES;
    TIME_SLOTS.forEach(slot=>{const sm=minutesOfTime(slot);if(sm<end&&start<sm+duration)ocupadas.add(slot)});
  });
  return { diaBloqueado:(isMissingTable(diasError)?[]:(dias||[])).length>0, diaSemana:weekdayOf(fecha), base:[...base], horasBloqueadas, ocupadas:[...ocupadas], disponibles };
}

function requireAdminClient(res) {
  if (!adminClient) {
    res.status(503).json({ error: 'Falta configurar SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY en el servidor.' });
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
  req.staff = { id: authData.user.id, role: profile.rol, nombre: profile.nombre || authData.user.email, email: authData.user.email || null };
  next();
}
function requireAdmin(req, res, next) {
  return requireStaff(req, res, () => {
    if (req.staff.role !== 'admin') return res.status(403).json({ error: 'Solo administración puede realizar esta acción.' });
    next();
  });
}

app.get('/api/config', (_req, res) => res.json({ supabaseUrl: SUPABASE_URL || '', supabaseAnonKey: SUPABASE_ANON_KEY || '', paymentInstructions: process.env.PAYMENT_INSTRUCTIONS || 'Abono de $20.000 COP. Medios de pago: Nequi 3117653423, llave Bre-B @31176534, Daviplata 3117653423, Bancolombia 912-1185-5661. No reembolsable si la clienta no asiste.', horarios: TIME_SLOTS }));
app.get('/api/servicios', async (_req, res) => {try{res.json(await getServices())}catch(error){console.error('Error cargando servicios públicos:',error.message);res.json(defaultServices)}});

app.get('/api/disponibilidad', async (req, res) => {
  if (!requireAdminClient(res)) return;
  const fecha = String(req.query.fecha || '');
  if (!isValidDate(fecha)) return res.status(400).json({ error: 'Fecha inválida.' });
  try {
    const { diaBloqueado, horasBloqueadas, ocupadas } = await availabilityFor(fecha, String(req.query.servicio || ''));
    const ocupadasSet = new Set(ocupadas), bloqueadasSet = new Set(horasBloqueadas);
    res.json({
      diaBloqueado,
      slots: TIME_SLOTS.map(hora => ({
        hora,
        disponible: !diaBloqueado && !ocupadasSet.has(hora) && !bloqueadasSet.has(hora),
        motivo: ocupadasSet.has(hora) ? 'ocupado' : (bloqueadasSet.has(hora) ? 'no disponible' : null)
      }))
    });
  } catch (error) {
    console.error('Error cargando disponibilidad:', error.message);
    res.status(500).json({ error: 'No se pudo cargar la disponibilidad.' });
  }
});

app.get('/api/panel/horario-semana', requireStaff, async (_req, res) => {
  try {
    const { data, error } = await adminClient.from('horarios_semana').select('dia_semana,hora,activo');
    if (error && !isMissingTable(error)) return res.status(500).json({ error: 'No se pudo cargar el horario semanal.' });
    const rows = isMissingTable(error) ? [] : (data || []);
    const dias = Array.from({ length: 7 }, (_, dia) => {
      const activos = rows.filter(r => Number(r.dia_semana) === dia && r.activo === true).map(r => String(r.hora).slice(0, 5));
      return { dia_semana: dia, nombre: WEEKDAY_LABELS[dia], horas: rows.some(r => Number(r.dia_semana) === dia) ? activos : [...TIME_SLOTS] };
    });
    res.json({ horarios: TIME_SLOTS, dias });
  } catch (error) {
    console.error('Error cargando horario semanal:', error.message);
    res.status(500).json({ error: 'No se pudo cargar el horario semanal.' });
  }
});

app.post('/api/panel/horario-semana', requireStaff, async (req, res) => {
  const dia = Number(req.body?.dia_semana);
  if (!Number.isInteger(dia) || dia < 0 || dia > 6) return res.status(400).json({ error: 'Día de la semana inválido.' });
  const horas = Array.isArray(req.body?.horas)
    ? [...new Set(req.body.horas.map(h => String(h).slice(0, 5)).filter(h => TIME_SLOTS.includes(h)))]
    : [];
  try {
    const { error: delError } = await adminClient.from('horarios_semana').delete().eq('dia_semana', dia);
    if (delError) throw delError;
    const rows = TIME_SLOTS.map(hora => ({ dia_semana: dia, hora: `${hora}:00`, activo: horas.includes(hora), actualizado_por: req.staff.id, updated_at: new Date().toISOString() }));
    const { error } = await adminClient.from('horarios_semana').insert(rows);
    if (error) throw error;
    res.json({ exito: true });
  } catch (error) {
    console.error('Error guardando horario semanal:', error.message);
    res.status(500).json({ error: isMissingTable(error) ? 'Falta configurar la disponibilidad: ejecuta supabase-schema.sql en Supabase > SQL Editor.' : 'No se pudo guardar el horario semanal.' });
  }
});

app.get('/api/panel/disponibilidad', requireStaff, async (req, res) => {
  const fecha = String(req.query.fecha || '');
  if (!isValidDate(fecha)) return res.status(400).json({ error: 'Fecha inválida.' });
  try {
    const info = await availabilityFor(fecha, '');
    res.json({ fecha, diaBloqueado: info.diaBloqueado, diaSemana: info.diaSemana, base: info.base, horasBloqueadas: info.horasBloqueadas, ocupadas: info.ocupadas, disponibles: info.disponibles, horarios: TIME_SLOTS });
  } catch (error) {
    console.error('Error cargando disponibilidad del panel:', error.message);
    res.status(500).json({ error: 'No se pudo cargar la disponibilidad.' });
  }
});

app.post('/api/panel/disponibilidad', requireStaff, async (req, res) => {
  const fecha = String(req.body?.fecha || '');
  if (!isValidDate(fecha)) return res.status(400).json({ error: 'Fecha inválida.' });
  const diaBloqueado = req.body?.diaBloqueado === true;
  const horas = Array.isArray(req.body?.horasDisponibles)
    ? [...new Set(req.body.horasDisponibles.map(h => String(h).slice(0, 5)).filter(h => TIME_SLOTS.includes(h)))]
    : [];
  try {
    const { error: delExcError } = await adminClient.from('disponibilidad_horas').delete().eq('fecha', fecha);
    if (delExcError && !isMissingTable(delExcError)) throw delExcError;
    if (diaBloqueado) {
      const { error } = await adminClient.from('dias_bloqueados').upsert({ fecha, creado_por: req.staff.id }, { onConflict: 'fecha' });
      if (error) throw error;
    } else {
      const { error: dayError } = await adminClient.from('dias_bloqueados').delete().eq('fecha', fecha);
      if (dayError && !isMissingTable(dayError)) throw dayError;
      const base = await weeklySlots(weekdayOf(fecha));
      const desired = new Set(horas);
      const overrides = TIME_SLOTS.filter(hora => desired.has(hora) !== base.has(hora))
        .map(hora => ({ fecha, hora: `${hora}:00`, disponible: desired.has(hora), creado_por: req.staff.id }));
      if (overrides.length) {
        const { error } = await adminClient.from('disponibilidad_horas').insert(overrides);
        if (error) throw error;
      }
    }
    res.json({ exito: true });
  } catch (error) {
    console.error('Error guardando disponibilidad:', error.message);
    res.status(500).json({ error: isMissingTable(error) ? 'Falta configurar la disponibilidad: ejecuta supabase-schema.sql en Supabase > SQL Editor.' : 'No se pudo guardar la disponibilidad.' });
  }
});

app.post('/api/panel/servicios/imagen', requireStaff, async (req, res) => {
  const imagen = req.body?.imagen;
  if(!imagen || !/^image\/(jpeg|png|webp)$/.test(imagen.mime || '') || typeof imagen.base64 !== 'string') {
    return res.status(400).json({ error: 'Carga una imagen JPG, PNG o WEBP.' });
  }
  const buffer = Buffer.from(imagen.base64, 'base64');
  if(!buffer.length || buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'La imagen debe pesar máximo 5 MB.' });
  const looksValid = imagen.mime === 'image/jpeg' ? buffer[0] === 0xff && buffer[1] === 0xd8
    : imagen.mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if(!looksValid) return res.status(400).json({ error: 'El archivo no parece ser una imagen válida.' });
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[imagen.mime];
  const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
  try{
    const { error } = await adminClient.storage.from(SERVICE_IMAGE_BUCKET).upload(path, buffer, { contentType: imagen.mime, upsert: false });
    if(error) throw error;
    const { data } = adminClient.storage.from(SERVICE_IMAGE_BUCKET).getPublicUrl(path);
    res.json({ url: data.publicUrl });
  }catch(error){
    console.error('Error subiendo imagen de servicio:', error.message);
    res.status(500).json({ error: 'No se pudo subir la imagen. Ejecuta supabase-schema.sql en Supabase > SQL Editor.' });
  }
});

app.get('/api/panel/servicios', requireStaff, async (_req, res) => {
  try{
    const { data, error } = await adminClient.from('servicios').select('*').order('orden',{ascending:true}).order('created_at',{ascending:true});
    if(error) return res.status(500).json({ error: 'Falta publicar el catálogo: ejecuta supabase-schema.sql en Supabase > SQL Editor.' });
    res.json({ servicios: (data || []).map(mapService) });
  }catch(error){console.error('Error listando servicios:',error.message);res.status(500).json({error:'No se pudieron cargar los servicios.'})}
});
app.post('/api/panel/servicios', requireStaff, async (req, res) => {
  const payload=validateServicePayload(req.body);
  if(!payload) return res.status(400).json({ error: 'Revisa el nombre, precio y duración del servicio.' });
  try{
    const { data, error } = await adminClient.from('servicios').insert({ id:`srv-${crypto.randomUUID().slice(0,8)}`, ...payload, actualizado_por:req.staff.id, updated_at:new Date().toISOString() }).select('*').single();
    if(error) return res.status(500).json({ error: 'No se pudo guardar el servicio. Ejecuta supabase-schema.sql en Supabase > SQL Editor.' });
    res.status(201).json({ servicio:mapService(data) });
  }catch(error){console.error('Error creando servicio:',error.message);res.status(500).json({error:'No se pudo guardar el servicio.'})}
});
app.put('/api/panel/servicios/:id', requireStaff, async (req, res) => {
  const payload=validateServicePayload(req.body);
  if(!payload) return res.status(400).json({ error: 'Revisa el nombre, precio y duración del servicio.' });
  try{
    const { data, error } = await adminClient.from('servicios').update({ ...payload, actualizado_por:req.staff.id, updated_at:new Date().toISOString() }).eq('id',req.params.id).select('*').maybeSingle();
    if(error) return res.status(500).json({ error: 'No se pudo actualizar el servicio.' });
    if(!data) return res.status(404).json({ error: 'No se encontró el servicio.' });
    res.json({ servicio:mapService(data) });
  }catch(error){console.error('Error actualizando servicio:',error.message);res.status(500).json({error:'No se pudo actualizar el servicio.'})}
});

app.post('/api/citas', async (req, res) => {
  if (!requireAdminClient(res)) return;
  const { nombre, cedula, telefono, servicio, fecha, hora, comprobante, aceptaNoReembolso } = req.body || {};
  let allServices=defaultServices;
  try{allServices=await getServices(true)}catch(error){console.error('Error consultando servicios para la cita:',error.message)}
  const service = allServices.find(item => item.id === servicio && item.active);
  const cleanPhone = String(telefono || '').replace(/\D/g, '');
  const cleanCedula = String(cedula || '').trim();
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(fecha || '') ? new Date(`${fecha}T00:00:00Z`) : null;
  const validDate = selectedDate && !Number.isNaN(selectedDate.valueOf()) && selectedDate.toISOString().slice(0, 10) === fecha;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (!nombre?.trim() || nombre.trim().length > 120 || cleanCedula.length > 30 || cleanPhone.length < 7 || cleanPhone.length > 15 || !service || !validDate || fecha < today || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora || '') || aceptaNoReembolso !== true) {
    return res.status(400).json({ error: 'Revisa los datos de la cita e intenta de nuevo.' });
  }
  const bogotaTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  if (fecha === today && hora < bogotaTime) return res.status(400).json({ error: 'La hora seleccionada ya pasó. Elige otra hora.' });
  if (!comprobante || !/^image\/(jpeg|png|webp)$/.test(comprobante.mime || '') || typeof comprobante.base64 !== 'string') {
    return res.status(400).json({ error: 'Carga una imagen JPG, PNG o WEBP del comprobante.' });
  }
  const buffer = Buffer.from(comprobante.base64, 'base64');
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'La imagen debe pesar máximo 5 MB.' });
  const isImage = comprobante.mime === 'image/jpeg' ? buffer[0] === 0xff && buffer[1] === 0xd8 : comprobante.mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!isImage) return res.status(400).json({ error: 'El archivo no parece ser una imagen válida.' });
  const slot = hora.slice(0, 5);
  if (!TIME_SLOTS.includes(slot)) return res.status(400).json({ error: 'Elige una hora de la lista de horarios disponibles.' });
  let availability;
  try { availability = await availabilityFor(fecha, servicio); }
  catch (error) { return res.status(500).json({ error: 'No se pudo validar la disponibilidad de la agenda.' }); }
  if (availability.diaBloqueado) return res.status(409).json({ error: 'Ese día no hay atención. Elige otra fecha.' });
  if (availability.horasBloqueadas.includes(slot)) return res.status(409).json({ error: 'Ese horario no está disponible. Elige otra hora.' });
  if (availability.ocupadas.includes(slot)) return res.status(409).json({ error: 'Ese horario ya está ocupado. Elige otra hora.' });
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[comprobante.mime];
  const receiptPath = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
  try {
    const { error: uploadError } = await adminClient.storage.from(BUCKET).upload(receiptPath, buffer, { contentType: comprobante.mime, upsert: false });
    if (uploadError) throw uploadError;
    const { data, error } = await adminClient.from('citas').insert({
      nombre: nombre.trim(), cedula: cleanCedula || null, telefono: cleanPhone, servicio: service.name,
      servicio_id: service.id, precio: service.price, abono: 20000, fecha, hora: `${slot}:00`,
      comprobante_path: receiptPath, estado: 'pendiente_verificacion', acepta_no_reembolso: true, acepta_no_reembolso_en: new Date().toISOString(),
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
  const telefono = String(req.body?.telefono || '').replace(/\D/g, '');
  if (telefono.length < 7) return res.status(400).json({ error: 'Ingresa el número de celular que usaste al reservar.' });
  const candidates = new Set([telefono]);
  if (telefono.startsWith('57') && telefono.length > 10) candidates.add(telefono.slice(2));
  if (!telefono.startsWith('57')) candidates.add(`57${telefono}`);
  let query = adminClient.from('citas').select('id,servicio,fecha,hora,estado,abono,created_at').eq('eliminada', false);
  const cedula = String(req.body?.cedula || '').trim();
  if (cedula) query = query.eq('cedula', cedula);
  query = candidates.size === 1 ? query.eq('telefono', telefono) : query.in('telefono', [...candidates]);
  const { data, error } = await query.order('fecha', { ascending: true });
  if (error) return res.status(500).json({ error: 'No se pudo consultar la cita.' });
  res.json(data || []);
});

app.get('/api/panel/citas', requireStaff, async (req, res) => {
  const [{ data, error }, { data: profiles, error: profileError }, usersResult] = await Promise.all([
    adminClient.from('citas').select('*').eq('eliminada', false).order('fecha', { ascending: true }).order('hora', { ascending: true }),
    adminClient.from('perfiles').select('id,nombre,rol'),
    adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 }).catch(() => ({ data: { users: [] } })),
  ]);
  if (error || profileError) return res.status(500).json({ error: 'No se pudieron cargar las citas.' });
  const profileNames = new Map((profiles || []).map(profile => [profile.id, profile.nombre]));
  const emailById = new Map(((usersResult?.data?.users) || []).map(user => [user.id, user.email]));
  const equipo = (profiles || []).map(profile => ({ id: profile.id, nombre: profile.nombre, rol: profile.rol, email: emailById.get(profile.id) || null }));
  const rows = await Promise.all((data || []).map(async cita => {
    const staffNames = {
      verificada_por_nombre: profileNames.get(cita.verificada_por) || null,
      confirmada_por_nombre: profileNames.get(cita.confirmada_por) || null,
      atendida_por_nombre: profileNames.get(cita.atendida_por) || null,
      cancelada_por_nombre: profileNames.get(cita.cancelada_por) || null,
      reagendada_por_nombre: profileNames.get(cita.reagendada_por) || null,
    };
    if (!cita.comprobante_path) return { ...cita, ...staffNames, comprobante_url: null };
    const { data: signed } = await adminClient.storage.from(BUCKET).createSignedUrl(cita.comprobante_path, 900);
    return { ...cita, ...staffNames, comprobante_url: signed?.signedUrl || null };
  }));
  res.json({ perfil: req.staff, citas: rows, equipo });
});

app.get('/api/panel/citas/version', requireStaff, async (_req, res) => {
  const { data, error } = await adminClient.from('citas').select('id,estado,fecha,hora,created_at,monto_cobrado,verificada_por,confirmada_por,atendida_por,eliminada').eq('eliminada', false);
  if (error) return res.status(500).json({ error: 'No se pudo verificar la agenda.' });
  const version = (data || [])
    .map(c => [c.id, c.estado, c.fecha, c.hora, c.created_at, c.monto_cobrado, c.verificada_por, c.confirmada_por, c.atendida_por].join('|'))
    .sort()
    .join(';');
  res.json({ version });
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

app.post('/api/panel/citas/:id/atendida', requireStaff, async (req, res) => {
  const amount = Number(req.body?.monto);
  if (!Number.isSafeInteger(amount) || amount < 1) return res.status(400).json({ error: 'Ingresa el valor total cobrado por el servicio.' });
  const { error } = await adminClient.rpc('marcar_cita_atendida', {
    p_cita_id: req.params.id,
    p_staff_id: req.staff.id,
    p_monto: amount,
  });
  if (error) {
    console.error('Error cerrando cita:', error.message);
    return res.status(409).json({ error: 'No se pudo cerrar la cita. Confirma que esté confirmada y que ejecutaste la actualización del esquema.' });
  }
  const { data, error: selectError } = await adminClient.from('citas').select('*').eq('id', req.params.id).single();
  if (selectError) return res.status(500).json({ error: 'La cita se cerró, pero no se pudo actualizar el panel.' });
  res.json({ exito: true, cita: data });
});

app.post('/api/panel/citas/:id/rechazar', requireStaff, async (req, res) => {
  const motivo = String(req.body?.motivo || '').trim().slice(0, 300);
  if (!motivo) return res.status(400).json({ error: 'Indica el motivo del rechazo.' });
  const { data, error } = await adminClient.from('citas')
    .update({ estado: 'cancelada', motivo_cancelacion: `Comprobante rechazado: ${motivo}`, cancelada_por: req.staff.id, cancelada_en: new Date().toISOString() })
    .in('estado', ['pendiente_verificacion', 'verificada']).eq('eliminada', false)
    .eq('id', req.params.id).select('id,estado').maybeSingle();
  if (error) {
    console.error('Error rechazando cita:', error.message);
    return res.status(500).json({ error: isMissingTable(error) ? 'Ejecuta supabase-schema.sql en Supabase > SQL Editor para habilitar esta acción.' : 'No se pudo rechazar el comprobante.' });
  }
  if (!data) return res.status(409).json({ error: 'Solo puedes rechazar citas pendientes o verificadas.' });
  res.json({ exito: true });
});

app.post('/api/panel/citas/:id/cancelar', requireStaff, async (req, res) => {
  const motivo = String(req.body?.motivo || '').trim().slice(0, 300);
  if (!motivo) return res.status(400).json({ error: 'Indica el motivo de la cancelación.' });
  const { data, error } = await adminClient.from('citas')
    .update({ estado: 'cancelada', motivo_cancelacion: motivo, cancelada_por: req.staff.id, cancelada_en: new Date().toISOString() })
    .in('estado', ['pendiente_verificacion', 'verificada', 'confirmada']).eq('eliminada', false)
    .eq('id', req.params.id).select('id,estado').maybeSingle();
  if (error) {
    console.error('Error cancelando cita:', error.message);
    return res.status(500).json({ error: isMissingTable(error) ? 'Ejecuta supabase-schema.sql en Supabase > SQL Editor para habilitar esta acción.' : 'No se pudo cancelar la cita.' });
  }
  if (!data) return res.status(409).json({ error: 'La cita ya fue cancelada o atendida.' });
  res.json({ exito: true });
});

app.post('/api/panel/citas/:id/reagendar', requireStaff, async (req, res) => {
  const fecha = String(req.body?.fecha || '');
  const hora = String(req.body?.hora || '');
  if (!isValidDate(fecha) || !/^\d{2}:\d{2}$/.test(hora.slice(0, 5)) || !TIME_SLOTS.includes(hora.slice(0, 5))) {
    return res.status(400).json({ error: 'Elige una fecha y una hora válidas de la lista.' });
  }
  const { data: cita, error: findError } = await adminClient.from('citas').select('*').eq('id', req.params.id).maybeSingle();
  if (findError || !cita) return res.status(404).json({ error: 'No se encontró la cita.' });
  if (cita.eliminada) return res.status(404).json({ error: 'La cita no existe.' });
  if (['atendida', 'cancelada'].includes(cita.estado)) return res.status(409).json({ error: 'No se puede reagendar una cita atendida o cancelada.' });
  let availability;
  try { availability = await availabilityFor(fecha, cita.servicio_id, cita.id); }
  catch (error) { return res.status(500).json({ error: 'No se pudo validar la disponibilidad de la agenda.' }); }
  const slot = hora.slice(0, 5);
  if (availability.diaBloqueado) return res.status(409).json({ error: 'Ese día no hay atención. Elige otra fecha.' });
  if (availability.horasBloqueadas.includes(slot)) return res.status(409).json({ error: 'Ese horario no está disponible. Elige otra hora.' });
  if (availability.ocupadas.includes(slot)) return res.status(409).json({ error: 'Ese horario ya está ocupado. Elige otra hora.' });
  const update = { fecha, hora: `${slot}:00`, reagendada_desde_fecha: cita.fecha, reagendada_desde_hora: cita.hora, reagendada_por: req.staff.id, reagendada_en: new Date().toISOString() };
  const { data, error } = await adminClient.from('citas').update(update).eq('id', req.params.id).eq('eliminada', false).select('*').maybeSingle();
  if (error) {
    console.error('Error reagendando cita:', error.message);
    return res.status(500).json({ error: isMissingTable(error) || error.code === '42703' ? 'Ejecuta supabase-schema.sql en Supabase > SQL Editor para habilitar esta acción.' : 'No se pudo reagendar la cita.' });
  }
  res.json({ exito: true, cita: data });
});

app.delete('/api/panel/citas/:id', requireAdmin, async (req, res) => {
  const { data: cita, error: findError } = await adminClient.from('citas').select('*').eq('id', req.params.id).maybeSingle();
  if (findError || !cita || cita.eliminada) return res.status(404).json({ error: 'No se encontró la cita.' });
  if (cita.estado === 'atendida') {
    const { error: incomeError } = await adminClient.from('ingresos').delete().eq('cita_id', cita.id);
    if (incomeError) return res.status(500).json({ error: 'No se pudo actualizar la contabilidad al eliminar la cita.' });
  }
  const { error } = await adminClient.from('citas').update({ eliminada: true, eliminada_en: new Date().toISOString() }).eq('id', cita.id).eq('eliminada', false);
  if (error) return res.status(500).json({ error: isMissingTable(error) || error.code === '42703' ? 'Ejecuta supabase-schema.sql en Supabase > SQL Editor para habilitar esta acción.' : 'No se pudo eliminar la cita.' });
  if (cita.comprobante_path) {
    try { await adminClient.storage.from(BUCKET).remove([cita.comprobante_path]); } catch {}
  }
  res.json({ exito: true });
});

app.patch('/api/panel/citas/:id', requireAdmin, async (req, res) => {
  const { data: cita, error: findError } = await adminClient.from('citas').select('*').eq('id', req.params.id).maybeSingle();
  if (findError || !cita || cita.eliminada) return res.status(404).json({ error: 'No se encontró la cita.' });
  const fecha = String(req.body?.fecha ?? cita.fecha).slice(0,10);
  const hora = String(req.body?.hora ?? String(cita.hora).slice(0,5)).slice(0,5);
  const servicioId = String(req.body?.servicio_id ?? cita.servicio_id ?? '').trim();
  const estado = String(req.body?.estado ?? cita.estado).trim();
  const precio = Number(req.body?.precio ?? cita.precio);
  const montoCobradoRaw = req.body?.monto_cobrado;
  const monto_cobrado = (montoCobradoRaw === null || montoCobradoRaw === '' || typeof montoCobradoRaw === 'undefined')
    ? (estado === 'atendida' ? Number(cita.monto_cobrado || precio) : null)
    : Number(montoCobradoRaw);
  const estados = ['pendiente_verificacion','verificada','confirmada','cancelada','atendida'];
  if (!isValidDate(fecha) || !/^\d{2}:\d{2}$/.test(hora) || !TIME_SLOTS.includes(hora)) return res.status(400).json({ error: 'Fecha u hora inválida. Usa intervalos de 30 minutos.' });
  if (!estados.includes(estado)) return res.status(400).json({ error: 'Estado inválido.' });
  if (!Number.isSafeInteger(precio) || precio < 1) return res.status(400).json({ error: 'Precio inválido.' });
  if (estado === 'atendida' && (!Number.isSafeInteger(monto_cobrado) || monto_cobrado < 1)) return res.status(400).json({ error: 'Ingresa un monto cobrado válido para una cita atendida.' });
  if (estado !== 'atendida' && monto_cobrado !== null && (!Number.isSafeInteger(monto_cobrado) || monto_cobrado < 1)) return res.status(400).json({ error: 'Monto cobrado inválido.' });
  let services = defaultServices;
  try { services = await getServices(true); } catch {}
  const service = services.find(s => s.id === servicioId);
  if (!service) return res.status(400).json({ error: 'Servicio inválido.' });
  const slot = hora;
  const changedTime = fecha !== String(cita.fecha).slice(0,10) || slot !== String(cita.hora).slice(0,5);
  if (changedTime && estado !== 'cancelada') {
    let availability;
    try { availability = await availabilityFor(fecha, service.id, cita.id); }
    catch { return res.status(500).json({ error: 'No se pudo validar la disponibilidad.' }); }
    if (availability.diaBloqueado) return res.status(409).json({ error: 'Ese día no hay atención.' });
    if (availability.horasBloqueadas.includes(slot)) return res.status(409).json({ error: 'Ese horario no está disponible.' });
    if (availability.ocupadas.includes(slot)) return res.status(409).json({ error: 'Ese horario ya está ocupado.' });
  }
  const update = {
    fecha,
    hora: `${slot}:00`,
    servicio_id: service.id,
    servicio: service.name,
    precio,
    estado,
    monto_cobrado: estado === 'atendida' ? monto_cobrado : (monto_cobrado ?? null),
  };
  if (estado === 'cancelada') { update.cancelada_en = cita.cancelada_en || new Date().toISOString(); update.cancelada_por = cita.cancelada_por || req.staff.id; }
  if (estado === 'atendida') { update.atendida_por = cita.atendida_por || req.staff.id; }
  if (estado !== 'atendida') { update.atendida_por = null; }
  const { data, error } = await adminClient.from('citas').update(update).eq('id', cita.id).eq('eliminada', false).select('*').maybeSingle();
  if (error) return res.status(500).json({ error: isMissingTable(error) || error.code === '42703' ? 'Ejecuta supabase-schema.sql en Supabase > SQL Editor para habilitar esta acción.' : 'No se pudo actualizar la cita.' });
  if (cita.estado === 'atendida' && estado !== 'atendida') {
    const { error: delIncomeError } = await adminClient.from('ingresos').delete().eq('cita_id', cita.id);
    if (delIncomeError) return res.status(500).json({ error: 'Cita actualizada, pero no se pudo actualizar la contabilidad.' });
  }
  if (estado === 'atendida') {
    const { error: upsertIncomeError } = await adminClient.from('ingresos').upsert({
      cita_id: cita.id,
      descripcion: 'Servicio: ' + service.name,
      monto: monto_cobrado,
      fecha,
      registrado_por: cita.atendida_por || req.staff.id,
    }, { onConflict: 'cita_id' });
    if (upsertIncomeError) return res.status(500).json({ error: 'Cita actualizada, pero no se pudo actualizar la contabilidad.' });
  }
  res.json({ exito: true, cita: data });
});

app.get('/api/panel/finanzas', requireStaff, async (_req, res) => {
  const [{ data: ingresos, error: incomeError }, { data: egresos, error: expenseError }] = await Promise.all([
    adminClient.from('ingresos').select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false }),
    adminClient.from('egresos').select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false }),
  ]);
  if (incomeError || expenseError) return res.status(500).json({ error: 'No se pudo cargar la contabilidad. Verifica que ejecutaste la actualización del esquema.' });
  res.json({ ingresos: ingresos || [], egresos: egresos || [] });
});

app.post('/api/panel/egresos', requireStaff, async (req, res) => {
  const descripcion = String(req.body?.descripcion || '').trim();
  const categoria = String(req.body?.categoria || '');
  const monto = Number(req.body?.monto);
  const fecha = String(req.body?.fecha || '');
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(new Date(`${fecha}T00:00:00Z`).valueOf()) && new Date(`${fecha}T00:00:00Z`).toISOString().slice(0, 10) === fecha;
  if (!descripcion || descripcion.length > 160 || !['insumos', 'arriendo', 'gastos_varios', 'otro'].includes(categoria) || !Number.isSafeInteger(monto) || monto < 1 || !validDate) {
    return res.status(400).json({ error: 'Revisa la descripción, categoría, valor y fecha del egreso.' });
  }
  const { data, error } = await adminClient.from('egresos').insert({ descripcion, categoria, monto, fecha, registrado_por: req.staff.id }).select('*').single();
  if (error) return res.status(500).json({ error: 'No se pudo guardar el egreso.' });
  res.status(201).json({ egreso: data });
});

app.get('/eylen-dm-logo.svg', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('image/svg+xml');
  res.sendFile(path.join(__dirname, 'eylen-dm-logo.svg'));
});
app.get('/', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.listen(PORT, '0.0.0.0', () => console.log(`LashStudio JB disponible en http://localhost:${PORT}`));
