const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
var TelegramBot = null;
try { TelegramBot = require('node-telegram-bot-api'); } catch(e) { console.log('node-telegram-bot-api no disponible'); }

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());

// Configurar Cloudinary
var cloudinaryOk = false;
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  cloudinaryOk = true;
  console.log('Cloudinary configurado correctamente');
} else {
  if (!process.env.CLOUDINARY_CLOUD_NAME) console.log('Falta variable CLOUDINARY_CLOUD_NAME');
  if (!process.env.CLOUDINARY_API_KEY) console.log('Falta variable CLOUDINARY_API_KEY');
  if (!process.env.CLOUDINARY_API_SECRET) console.log('Falta variable CLOUDINARY_API_SECRET');
}

// Configurar Multer (memoria, max 10MB, solo imágenes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    if (/^image\/(jpeg|jpg|png|webp|heic)$/.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (jpg, png, webp, heic)'));
    }
  }
});

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rutas de datos
const EN_RENDER = fs.existsSync('/app/data');
const DATA_DIR = EN_RENDER ? '/app/data' : path.join(__dirname, 'data');
const SOCIOS_FILE = path.join(DATA_DIR, 'socios.json');
const SEED_FILE = path.join(__dirname, 'data', 'socios.json');
const EVENTOS_FILE = path.join(DATA_DIR, 'eventos.json');
const EVENTOS_SEED_FILE = path.join(__dirname, 'data', 'eventos.json');

// === BLINDAJE DE DATOS: backup antes de escribir + bloqueo de vaciados ===
function backupAntesDeEscribir(rutaArchivo, etiqueta) {
  try {
    if (!fs.existsSync(rutaArchivo)) return;
    var contenido = fs.readFileSync(rutaArchivo, 'utf8');
    var datos = JSON.parse(contenido);
    if (!Array.isArray(datos) || datos.length === 0) return;
    var nombreArchivo = path.basename(rutaArchivo, '.json');
    var dir = path.dirname(rutaArchivo);
    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    var backupPath = path.join(dir, nombreArchivo + '.backup.' + ts + '.' + etiqueta + '.json');
    fs.writeFileSync(backupPath, contenido);
  } catch (err) {
    console.error('Error creando backup ' + etiqueta + ':', err.message);
  }
}

function guardarDatosSeguro(rutaArchivo, datos, etiqueta, opts) {
  if (!Array.isArray(datos)) {
    console.error('Intento de escribir no-array en ' + rutaArchivo + '. Cancelado.');
    throw new Error('Datos invalidos al guardar ' + etiqueta + ': no es un array');
  }
  if (datos.length === 0 && fs.existsSync(rutaArchivo)) {
    try {
      var actual = JSON.parse(fs.readFileSync(rutaArchivo, 'utf8'));
      if (Array.isArray(actual) && actual.length > 0 && !(opts && opts.permitirVaciado)) {
        console.error('BLOQUEADO: intento de vaciar ' + rutaArchivo + ' (tenia ' + actual.length + ' items). ' + etiqueta);
        throw new Error('BLOQUEADO: no se puede vaciar archivo con datos. Origen: ' + etiqueta);
      }
    } catch (err) {
      if (err.message.startsWith('BLOQUEADO')) throw err;
    }
  }
  backupAntesDeEscribir(rutaArchivo, etiqueta);
  fs.writeFileSync(rutaArchivo, JSON.stringify(datos, null, 2), 'utf8');
}

// Inicializar datos: si el disco persistente está vacío, copiar seed del repo
function inicializarDatos() {
  console.log('Ruta de datos: ' + SOCIOS_FILE);
  console.log('En Render: ' + EN_RENDER);

  // Asegurar que el archivo existe
  if (!fs.existsSync(SOCIOS_FILE)) {
    fs.writeFileSync(SOCIOS_FILE, '[]', 'utf8');
  }

  // Leer contenido actual
  var contenido = [];
  try {
    contenido = JSON.parse(fs.readFileSync(SOCIOS_FILE, 'utf8'));
  } catch (e) {
    contenido = [];
  }

  // Si está vacío y hay seed disponible, copiar seed
  if (contenido.length === 0 && EN_RENDER && fs.existsSync(SEED_FILE)) {
    try {
      var seed = fs.readFileSync(SEED_FILE, 'utf8');
      var seedData = JSON.parse(seed);
      if (seedData.length > 0) {
        fs.writeFileSync(SOCIOS_FILE, seed, 'utf8');
        console.log('Inicializando datos desde seed... ' + seedData.length + ' socios copiados');
        contenido = seedData;
      }
    } catch (e) {
      console.error('Error leyendo seed:', e);
    }
  }

  console.log('Socios cargados: ' + contenido.length);

  // Backup antes de migrar
  if (contenido.length > 0) {
    var now = new Date();
    var ts = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + '-' + String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0');
    var backupFile = path.join(DATA_DIR, 'socios.backup.' + ts + '.json');
    if (!fs.existsSync(backupFile)) {
      fs.writeFileSync(backupFile, JSON.stringify(contenido, null, 2), 'utf8');
      console.log('Backup creado: socios.backup.' + ts + '.json');
    }
  }

  // Migración: añadir campo telefono si no existe
  var migrados = 0;
  for (var m = 0; m < contenido.length; m++) {
    if (contenido[m].telefono === undefined) {
      contenido[m].telefono = '';
      migrados++;
    }
  }
  if (migrados > 0) {
    guardarDatosSeguro(SOCIOS_FILE, contenido, 'migracion-telefono');
    console.log('Migracion: campo telefono a\u00f1adido a ' + migrados + ' socios');
  }

  // Migración: canal_preferido y telegram_chat_id
  var migCanal = 0;
  for (var mc = 0; mc < contenido.length; mc++) {
    if (contenido[mc].canal_preferido === undefined) { contenido[mc].canal_preferido = 'whatsapp'; migCanal++; }
    if (contenido[mc].telegram_chat_id === undefined) { contenido[mc].telegram_chat_id = null; migCanal++; }
  }
  if (migCanal > 0) {
    guardarDatosSeguro(SOCIOS_FILE, contenido, 'migracion-canal');
    console.log('Migracion canal_preferido/telegram: ' + migCanal + ' campos actualizados');
  }

  // Verificar fotos preservadas
  var conFoto = contenido.filter(function(s) { return s.foto_url && s.foto_url !== ''; }).length;
  console.log('Socios con foto tras migracion: ' + conFoto + '/' + contenido.length);

  // Inicializar eventos
  if (!fs.existsSync(EVENTOS_FILE)) {
    if (EN_RENDER && fs.existsSync(EVENTOS_SEED_FILE)) {
      fs.copyFileSync(EVENTOS_SEED_FILE, EVENTOS_FILE);
      console.log('Eventos: seed copiado');
    } else {
      fs.writeFileSync(EVENTOS_FILE, '[]', 'utf8');
    }
  }
  try {
    var evts = JSON.parse(fs.readFileSync(EVENTOS_FILE, 'utf8'));
    console.log('Eventos cargados: ' + evts.length);
    // Backup de arranque si hay datos
    if (evts.length > 0) {
      backupAntesDeEscribir(EVENTOS_FILE, 'arranque');
    } else {
      console.log('eventos.json esta vacio al arrancar');
    }
  } catch (e) {
    console.error('Error leyendo eventos.json:', e.message);
    if (!fs.existsSync(EVENTOS_FILE)) {
      fs.writeFileSync(EVENTOS_FILE, '[]', 'utf8');
      console.log('eventos.json no existia, inicializado vacio');
    }
  }
}

inicializarDatos();

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Página pública de confirmación
app.get('/c/:token/:num_socio', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'confirmacion.html'));
});
app.get('/c/:token', (req, res) => {
  res.status(400).send('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LA BOYA</title></head><body style="font-family:system-ui;text-align:center;padding:40px 20px;color:#333"><h2>Enlace incompleto</h2><p>Falta el codigo del socio en el enlace. Pidele a la directiva un nuevo enlace.</p></body></html>');
});

// API: lista de socios
app.get('/api/socios', (req, res) => {
  try {
    const data = fs.readFileSync(SOCIOS_FILE, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    console.error('Error leyendo socios:', err);
    res.status(500).json({ error: 'Error al leer los datos' });
  }
});

// Función auxiliar: fecha actual YYYY-MM-DD
function fechaHoy() {
  return new Date().toISOString().split('T')[0];
}

// API: actualizar asiduidad de un socio
app.put('/api/socios/:id/asiduidad', (req, res) => {
  try {
    const { asiduidad } = req.body;
    if (![1, 2, 3].includes(asiduidad)) {
      return res.status(400).json({ error: 'Asiduidad debe ser 1, 2 o 3' });
    }
    const data = JSON.parse(fs.readFileSync(SOCIOS_FILE, 'utf8'));
    const idx = data.findIndex(s => s.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Socio no encontrado' });
    }
    data[idx].asiduidad = asiduidad;
    data[idx].fecha_modificacion = fechaHoy();
    guardarDatosSeguro(SOCIOS_FILE, data, 'socio-asiduidad');
    res.json(data[idx]);
  } catch (err) {
    console.error('Error actualizando asiduidad:', err);
    res.status(500).json({ error: 'Error al actualizar asiduidad' });
  }
});

// API: actualizar notas de un socio
app.put('/api/socios/:id/notas', (req, res) => {
  try {
    const notas = req.body.notas != null ? String(req.body.notas) : '';
    const data = JSON.parse(fs.readFileSync(SOCIOS_FILE, 'utf8'));
    const idx = data.findIndex(s => s.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Socio no encontrado' });
    }
    data[idx].notas = notas;
    data[idx].notas_editado = fechaHoy();
    data[idx].fecha_modificacion = fechaHoy();
    guardarDatosSeguro(SOCIOS_FILE, data, 'socio-notas');
    res.json(data[idx]);
  } catch (err) {
    console.error('Error actualizando notas:', err);
    res.status(500).json({ error: 'Error al actualizar notas' });
  }
});

// Paleta de colores para avatares sin foto
const AVATAR_COLORS = ['#AFA9EC','#F0997B','#5DCAA5','#85B7EB','#ED93B1','#EF9F27','#97C459','#F7C1C1'];

// Subir buffer a Cloudinary (devuelve promesa)
function subirFotoCloudinary(buffer, publicId) {
  return new Promise(function(resolve, reject) {
    var stream = cloudinary.uploader.upload_stream(
      {
        folder: 'la_boya/socios',
        public_id: publicId,
        transformation: [{ width: 500, height: 500, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
        overwrite: true
      },
      function(err, result) {
        if (err) reject(err);
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

// API: crear socio
app.post('/api/socios', upload.single('foto'), async (req, res) => {
  try {
    var nombre = (req.body.nombre || '').trim();
    var apellidos = (req.body.apellidos || '').trim();
    var numSocio = parseInt(req.body.num_socio, 10);

    if (!nombre || !apellidos) {
      return res.status(400).json({ error: 'Nombre y apellidos son obligatorios' });
    }
    if (isNaN(numSocio)) {
      return res.status(400).json({ error: 'N\u00famero de socio debe ser num\u00e9rico' });
    }

    var data = JSON.parse(fs.readFileSync(SOCIOS_FILE, 'utf8'));

    // Generar ID siguiente
    var maxId = 0;
    for (var i = 0; i < data.length; i++) {
      var n = parseInt(data[i].id, 10);
      if (n > maxId) maxId = n;
    }
    var newId = String(maxId + 1).padStart(3, '0');

    var asiduidad = parseInt(req.body.asiduidad, 10);
    if (![1, 2, 3].includes(asiduidad)) asiduidad = 2;

    var notas = req.body.notas || '';
    var hoy = fechaHoy();

    var socio = {
      id: newId,
      nombre: nombre,
      apellidos: apellidos,
      foto_url: '',
      foto_public_id: '',
      num_socio: numSocio,
      antiguedad_años: parseInt(req.body.antiguedad_años, 10) || 0,
      telefono: (req.body.telefono || '').trim(),
      asiduidad: asiduidad,
      notas: notas,
      notas_editado: notas ? hoy : '',
      fecha_creacion: hoy,
      fecha_modificacion: hoy,
      avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]
    };

    // Subir foto si viene
    if (req.file && cloudinaryOk) {
      console.log('Subiendo foto a Cloudinary...');
      try {
        var result = await subirFotoCloudinary(req.file.buffer, 'socio_' + newId);
        socio.foto_url = result.secure_url;
        socio.foto_public_id = result.public_id;
        console.log('Foto subida: ' + result.secure_url);
      } catch (cloudErr) {
        console.error('Error Cloudinary:', cloudErr.message);
      }
    }

    data.push(socio);
    guardarDatosSeguro(SOCIOS_FILE, data, 'socio-crear');
    console.log('Socio creado: ' + nombre + ' ' + apellidos + ' (id: ' + newId + ')');
    res.status(201).json(socio);
  } catch (err) {
    console.error('Error creando socio:', err);
    res.status(500).json({ error: 'Error al crear socio' });
  }
});

// API: editar socio completo
app.put('/api/socios/:id', upload.single('foto'), async (req, res) => {
  try {
    var data = JSON.parse(fs.readFileSync(SOCIOS_FILE, 'utf8'));
    var idx = data.findIndex(s => s.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Socio no encontrado' });
    }

    var socio = data[idx];

    if (req.body.nombre !== undefined) socio.nombre = req.body.nombre.trim();
    if (req.body.apellidos !== undefined) socio.apellidos = req.body.apellidos.trim();
    if (req.body.num_socio !== undefined) socio.num_socio = parseInt(req.body.num_socio, 10);
    if (req.body.antiguedad_años !== undefined) socio.antiguedad_años = parseInt(req.body.antiguedad_años, 10) || 0;
    if (req.body.telefono !== undefined) socio.telefono = req.body.telefono.trim();
    if (req.body.asiduidad !== undefined) {
      var asid = parseInt(req.body.asiduidad, 10);
      if ([1, 2, 3].includes(asid)) socio.asiduidad = asid;
    }
    if (req.body.notas !== undefined) {
      socio.notas = req.body.notas;
      socio.notas_editado = fechaHoy();
    }

    // Subir foto nueva si viene
    if (req.file && cloudinaryOk) {
      // Borrar foto anterior si existe
      if (socio.foto_public_id) {
        try { await cloudinary.uploader.destroy(socio.foto_public_id); } catch (e) { /* ignorar */ }
      }
      console.log('Subiendo foto a Cloudinary...');
      try {
        var result = await subirFotoCloudinary(req.file.buffer, 'socio_' + socio.id);
        socio.foto_url = result.secure_url;
        socio.foto_public_id = result.public_id;
        console.log('Foto subida: ' + result.secure_url);
      } catch (cloudErr) {
        console.error('Error Cloudinary:', cloudErr.message);
      }
    }

    socio.fecha_modificacion = fechaHoy();
    data[idx] = socio;
    guardarDatosSeguro(SOCIOS_FILE, data, 'socio-editar');
    res.json(socio);
  } catch (err) {
    console.error('Error editando socio:', err);
    res.status(500).json({ error: 'Error al editar socio' });
  }
});

// API: eliminar socio
app.delete('/api/socios/:id', async (req, res) => {
  try {
    var data = JSON.parse(fs.readFileSync(SOCIOS_FILE, 'utf8'));
    var idx = data.findIndex(s => s.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Socio no encontrado' });
    }

    var socio = data[idx];

    // Borrar foto de Cloudinary si existe
    if (socio.foto_public_id && cloudinaryOk) {
      try { await cloudinary.uploader.destroy(socio.foto_public_id); } catch (e) { /* ignorar */ }
    }

    data.splice(idx, 1);
    backupAntesDeEscribir(SOCIOS_FILE, 'socio-eliminar');
    fs.writeFileSync(SOCIOS_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('Socio eliminado: ' + socio.nombre + ' (id: ' + socio.id + ')');
    res.json({ ok: true });
  } catch (err) {
    console.error('Error eliminando socio:', err);
    res.status(500).json({ error: 'Error al eliminar socio' });
  }
});

// Helper leer socios
function leerSocios() {
  try { return JSON.parse(fs.readFileSync(SOCIOS_FILE, 'utf8')); }
  catch(e) { return []; }
}

// === EVENTOS ===
const MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
var FECHA_SUFFIX_RE = /\s*-\s*\d{1,2}\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+\d{4}$/i;

function formatFechaES(fechaStr) {
  var parts = fechaStr.split('-');
  return parseInt(parts[2], 10) + ' ' + MESES_ES[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
}

function generarNombreComida(fechaStr) {
  return 'Comida social - ' + formatFechaES(fechaStr);
}

function generarNombreEvento(nombreBase, fechaStr) {
  var base = nombreBase.replace(FECHA_SUFFIX_RE, '').trim();
  return base + ' - ' + formatFechaES(fechaStr);
}

function extraerNombreBase(nombre) {
  return nombre.replace(FECHA_SUFFIX_RE, '').trim();
}

function leerEventos() {
  try {
    var data = JSON.parse(fs.readFileSync(EVENTOS_FILE, 'utf8'));
    var migrado = false;
    for (var i = 0; i < data.length; i++) {
      if (!data[i].invitados_boya) { data[i].invitados_boya = []; migrado = true; }
      if (data[i].confirmacion_token === undefined) { data[i].confirmacion_token = null; migrado = true; }
      if (!data[i].respuestas_confirmacion) { data[i].respuestas_confirmacion = {}; migrado = true; }
    }
    if (migrado && data.length > 0) {
      guardarDatosSeguro(EVENTOS_FILE, data, 'migracion-confirmacion-token');
      console.log('Migracion confirmacion-token: ' + data.length + ' eventos actualizados');
    }
    return data;
  } catch (e) { return []; }
}

function guardarEventos(data, etiqueta) {
  guardarDatosSeguro(EVENTOS_FILE, data, etiqueta || 'evento');
}

// GET /api/eventos
app.get('/api/eventos', (req, res) => {
  try {
    var data = leerEventos();
    data.sort(function(a, b) { return b.fecha.localeCompare(a.fecha); });
    res.json(data);
  } catch (err) {
    console.error('Error leyendo eventos:', err);
    res.status(500).json({ error: 'Error al leer eventos' });
  }
});

// GET /api/eventos/:id
app.get('/api/eventos/:id', (req, res) => {
  var data = leerEventos();
  var evt = data.find(e => e.id === req.params.id);
  if (!evt) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json(evt);
});

// POST /api/eventos
app.post('/api/eventos', (req, res) => {
  try {
    var tipo = req.body.tipo;
    var fecha = req.body.fecha;

    if (!tipo || !['comida_social', 'evento', 'evento_gratis'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo debe ser comida_social, evento o evento_gratis' });
    }
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Fecha requerida en formato YYYY-MM-DD' });
    }

    var nombre = (req.body.nombre || '').trim();
    var modoCalculo = req.body.modo_calculo || null;
    var precioPorPersona = req.body.precio_por_persona != null ? parseFloat(req.body.precio_por_persona) : null;
    var costeTotal = req.body.coste_total != null ? parseFloat(req.body.coste_total) : null;

    if (tipo === 'comida_social') {
      nombre = nombre || generarNombreComida(fecha);
      modoCalculo = 'precio_fijo';
      if (precioPorPersona == null || isNaN(precioPorPersona)) precioPorPersona = 25;
      costeTotal = null;
    } else if (tipo === 'evento_gratis') {
      if (!nombre) return res.status(400).json({ error: 'Nombre requerido para eventos gratis' });
      nombre = generarNombreEvento(nombre, fecha);
      modoCalculo = 'gratis';
      precioPorPersona = 0;
      costeTotal = null;
    } else {
      if (!nombre) return res.status(400).json({ error: 'Nombre requerido para eventos' });
      nombre = generarNombreEvento(nombre, fecha);
      // Evento genérico: coste puede ser null (se asigna después)
      if (modoCalculo && ['precio_fijo', 'total_dividido'].includes(modoCalculo)) {
        if (modoCalculo === 'precio_fijo') {
          if (precioPorPersona == null || isNaN(precioPorPersona) || precioPorPersona <= 0) {
            return res.status(400).json({ error: 'precio_por_persona debe ser mayor que 0' });
          }
          costeTotal = null;
        } else {
          if (costeTotal == null || isNaN(costeTotal) || costeTotal <= 0) {
            return res.status(400).json({ error: 'coste_total debe ser mayor que 0' });
          }
          precioPorPersona = null;
        }
      } else {
        modoCalculo = null;
        precioPorPersona = null;
        costeTotal = null;
      }
    }

    var data = leerEventos();
    var maxNum = 0;
    for (var i = 0; i < data.length; i++) {
      var num = parseInt(data[i].id.replace('evt_', ''), 10);
      if (num > maxNum) maxNum = num;
    }
    var newId = 'evt_' + String(maxNum + 1).padStart(3, '0');
    var hoy = fechaHoy();

    var evento = {
      id: newId,
      tipo: tipo,
      nombre: nombre,
      fecha: fecha,
      estado: 'abierto',
      precio_por_persona: precioPorPersona,
      coste_total: costeTotal,
      modo_calculo: modoCalculo,
      cocineros: [],
      asistentes: [],
      invitados_boya: [],
      confirmacion_token: null,
      respuestas_confirmacion: {},
      notas: req.body.notas || '',
      fecha_creacion: hoy,
      fecha_modificacion: hoy
    };

    data.push(evento);
    guardarEventos(data, 'crear');
    console.log('Evento creado: ' + nombre + ' (id: ' + newId + ')');
    res.status(201).json(evento);
  } catch (err) {
    console.error('Error creando evento:', err);
    res.status(500).json({ error: 'Error al crear evento' });
  }
});

// PUT /api/eventos/:id
app.put('/api/eventos/:id', (req, res) => {
  try {
    var data = leerEventos();
    var idx = data.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Evento no encontrado' });

    var evt = data[idx];
    if (req.body.fecha !== undefined) {
      evt.fecha = req.body.fecha;
      if (evt.tipo === 'comida_social') {
        evt.nombre = generarNombreComida(evt.fecha);
      } else {
        evt.nombre = generarNombreEvento(extraerNombreBase(evt.nombre), evt.fecha);
      }
    }
    if (req.body.nombre !== undefined && (evt.tipo === 'evento' || evt.tipo === 'evento_gratis')) {
      evt.nombre = generarNombreEvento(req.body.nombre.trim(), evt.fecha);
    }
    if (req.body.estado !== undefined) evt.estado = req.body.estado;
    if (req.body.precio_por_persona !== undefined) evt.precio_por_persona = req.body.precio_por_persona != null ? parseFloat(req.body.precio_por_persona) : null;
    if (req.body.coste_total !== undefined) evt.coste_total = req.body.coste_total != null ? parseFloat(req.body.coste_total) : null;
    if (req.body.modo_calculo !== undefined) evt.modo_calculo = req.body.modo_calculo;
    if (req.body.notas !== undefined) evt.notas = req.body.notas;
    if (req.body.cocineros !== undefined) evt.cocineros = req.body.cocineros;
    if (req.body.asistentes !== undefined) evt.asistentes = req.body.asistentes;

    evt.fecha_modificacion = fechaHoy();
    data[idx] = evt;
    guardarEventos(data, 'editar');
    console.log('Evento actualizado: ' + evt.id);
    res.json(evt);
  } catch (err) {
    console.error('Error editando evento:', err);
    res.status(500).json({ error: 'Error al editar evento' });
  }
});

// DELETE /api/eventos/:id
app.delete('/api/eventos/:id', (req, res) => {
  try {
    var data = leerEventos();
    var idx = data.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Evento no encontrado' });
    var evtId = data[idx].id;
    data.splice(idx, 1);
    backupAntesDeEscribir(EVENTOS_FILE, 'eliminar');
    fs.writeFileSync(EVENTOS_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('Evento eliminado: ' + evtId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error eliminando evento:', err);
    res.status(500).json({ error: 'Error al eliminar evento' });
  }
});

// PUT /api/eventos/:id/cocineros
app.put('/api/eventos/:id/cocineros', (req, res) => {
  try {
    var data = leerEventos();
    var idx = data.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Evento no encontrado' });
    var evt = data[idx];
    var cocineros = req.body.cocineros || [];
    evt.cocineros = cocineros;
    // Auto-añadir cocineros a asistentes si no están
    for (var i = 0; i < cocineros.length; i++) {
      var ya = evt.asistentes.find(function(a) { return a.socio_id === cocineros[i]; });
      if (!ya) {
        evt.asistentes.push({ socio_id: cocineros[i], invitados: 0, pagado: false });
      }
    }
    evt.fecha_modificacion = fechaHoy();
    data[idx] = evt;
    guardarEventos(data, 'cocineros');
    console.log('Cocineros actualizados evento ' + evt.id);
    res.json(evt);
  } catch (err) {
    console.error('Error actualizando cocineros:', err);
    res.status(500).json({ error: 'Error al actualizar cocineros' });
  }
});

// PUT /api/eventos/:id/asistentes
app.put('/api/eventos/:id/asistentes', (req, res) => {
  try {
    var data = leerEventos();
    var idx = data.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Evento no encontrado' });
    var evt = data[idx];
    var nuevos = req.body.asistentes || [];
    // Mantener invitados/pagado de asistentes existentes
    var prevMap = {};
    for (var p = 0; p < evt.asistentes.length; p++) {
      prevMap[evt.asistentes[p].socio_id] = evt.asistentes[p];
    }
    var resultado = [];
    for (var n = 0; n < nuevos.length; n++) {
      var sid = nuevos[n].socio_id || nuevos[n];
      var prev = prevMap[sid];
      resultado.push({
        socio_id: sid,
        invitados: prev ? prev.invitados : 0,
        pagado: prev ? prev.pagado : false
      });
    }
    evt.asistentes = resultado;
    evt.fecha_modificacion = fechaHoy();
    data[idx] = evt;
    guardarEventos(data, 'asistentes');
    console.log('Asistentes actualizados evento ' + evt.id + ': ' + resultado.length);
    res.json(evt);
  } catch (err) {
    console.error('Error actualizando asistentes:', err);
    res.status(500).json({ error: 'Error al actualizar asistentes' });
  }
});

// PUT /api/eventos/:id/asistente/:socio_id
app.put('/api/eventos/:id/asistente/:socio_id', (req, res) => {
  try {
    var data = leerEventos();
    var idx = data.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Evento no encontrado' });
    var evt = data[idx];
    var asist = evt.asistentes.find(function(a) { return a.socio_id === req.params.socio_id; });
    if (!asist) return res.status(404).json({ error: 'Asistente no encontrado' });
    if (req.body.invitados !== undefined) asist.invitados = parseInt(req.body.invitados, 10) || 0;
    if (req.body.pagado !== undefined) asist.pagado = !!req.body.pagado;
    evt.fecha_modificacion = fechaHoy();
    data[idx] = evt;
    guardarEventos(data, 'pagado');
    res.json(evt);
  } catch (err) {
    console.error('Error actualizando asistente:', err);
    res.status(500).json({ error: 'Error al actualizar asistente' });
  }
});

// PUT /api/eventos/:id/estado
app.put('/api/eventos/:id/estado', (req, res) => {
  try {
    var data = leerEventos();
    var idx = data.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Evento no encontrado' });
    var evt = data[idx];
    var estado = req.body.estado;
    if (!['abierto', 'finalizado'].includes(estado)) {
      return res.status(400).json({ error: 'Estado debe ser abierto o finalizado' });
    }
    evt.estado = estado;
    evt.fecha_modificacion = fechaHoy();
    data[idx] = evt;
    guardarEventos(data, 'estado');
    console.log('Estado evento ' + evt.id + ': ' + estado);
    res.json(evt);
  } catch (err) {
    console.error('Error actualizando estado:', err);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

// POST /api/eventos/:id/invitados-boya
app.post('/api/eventos/:id/invitados-boya', (req, res) => {
  try {
    var data = leerEventos();
    var idx = data.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Evento no encontrado' });
    if (data[idx].tipo === 'evento_gratis') return res.status(400).json({ error: 'Este tipo de evento no permite invitados BOYA' });
    var nombre = (req.body.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    var inv = { id: 'inv_' + Math.random().toString(36).substr(2, 9), nombre: nombre };
    data[idx].invitados_boya.push(inv);
    data[idx].fecha_modificacion = fechaHoy();
    guardarEventos(data, 'invitado-boya-crear');
    console.log('Invitado BOYA creado: ' + nombre + ' en evento ' + data[idx].id);
    res.status(201).json(data[idx]);
  } catch (err) {
    console.error('Error creando invitado BOYA:', err);
    res.status(500).json({ error: 'Error al crear invitado BOYA' });
  }
});

// DELETE /api/eventos/:id/invitados-boya/:invitado_id
app.delete('/api/eventos/:id/invitados-boya/:invitado_id', (req, res) => {
  try {
    var data = leerEventos();
    var idx = data.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Evento no encontrado' });
    var evt = data[idx];
    var invIdx = evt.invitados_boya.findIndex(function(i) { return i.id === req.params.invitado_id; });
    if (invIdx === -1) return res.status(404).json({ error: 'Invitado no encontrado' });
    evt.invitados_boya.splice(invIdx, 1);
    evt.fecha_modificacion = fechaHoy();
    guardarEventos(data, 'invitado-boya-eliminar');
    res.json(evt);
  } catch (err) {
    console.error('Error eliminando invitado BOYA:', err);
    res.status(500).json({ error: 'Error al eliminar invitado BOYA' });
  }
});

// PUT /api/eventos/:id/invitados-boya/:invitado_id
app.put('/api/eventos/:id/invitados-boya/:invitado_id', (req, res) => {
  try {
    var data = leerEventos();
    var idx = data.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Evento no encontrado' });
    var inv = data[idx].invitados_boya.find(function(i) { return i.id === req.params.invitado_id; });
    if (!inv) return res.status(404).json({ error: 'Invitado no encontrado' });
    var nombre = (req.body.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    inv.nombre = nombre;
    data[idx].fecha_modificacion = fechaHoy();
    guardarEventos(data, 'invitado-boya-editar');
    res.json(data[idx]);
  } catch (err) {
    console.error('Error editando invitado BOYA:', err);
    res.status(500).json({ error: 'Error al editar invitado BOYA' });
  }
});

// === ADMIN: Importar socios oficiales ===
const CLAVE_IMPORT = 'Rb7xNpWq3mKs9YvTfJd2Lc6Ae';
const SOCIOS_OFICIALES_FILE = path.join(__dirname, 'data', 'socios_oficiales.json');

app.post('/api/admin/importar-socios-oficiales', async (req, res) => {
  try {
    // Verificar clave
    if (req.query.clave !== CLAVE_IMPORT) {
      return res.status(403).json({ error: 'Clave incorrecta' });
    }

    // Leer socios actuales
    var sociosActuales = [];
    try {
      sociosActuales = JSON.parse(fs.readFileSync(SOCIOS_FILE, 'utf8'));
    } catch (e) {
      sociosActuales = [];
    }

    // Borrar fotos de Cloudinary de los socios actuales
    var eliminados = sociosActuales.length;
    if (cloudinaryOk) {
      for (var i = 0; i < sociosActuales.length; i++) {
        if (sociosActuales[i].foto_public_id) {
          try {
            await cloudinary.uploader.destroy(sociosActuales[i].foto_public_id);
            console.log('Foto borrada: ' + sociosActuales[i].foto_public_id);
          } catch (e) {
            console.error('Error borrando foto ' + sociosActuales[i].foto_public_id + ':', e.message);
          }
        }
      }
    }

    // Leer seed oficiales
    var seed = JSON.parse(fs.readFileSync(SOCIOS_OFICIALES_FILE, 'utf8'));
    var hoy = fechaHoy();
    var PALETA = ['#AFA9EC','#F0997B','#5DCAA5','#85B7EB','#ED93B1','#EF9F27','#97C459','#F7C1C1'];

    // Crear socios completos
    var nuevos = [];
    for (var j = 0; j < seed.length; j++) {
      nuevos.push({
        id: String(j + 1).padStart(3, '0'),
        nombre: seed[j].nombre,
        apellidos: seed[j].apellidos,
        num_socio: seed[j].num_socio,
        antiguedad_años: 0,
        asiduidad: 2,
        foto_url: '',
        foto_public_id: null,
        avatar_color: PALETA[Math.floor(Math.random() * PALETA.length)],
        notas: '',
        notas_editado: null,
        fecha_creacion: hoy,
        fecha_modificacion: hoy
      });
    }

    // Escribir
    backupAntesDeEscribir(SOCIOS_FILE, 'import-oficiales');
    fs.writeFileSync(SOCIOS_FILE, JSON.stringify(nuevos, null, 2), 'utf8');
    console.log('Importacion completada: ' + nuevos.length + ' socios oficiales cargados, ' + eliminados + ' anteriores eliminados');

    res.json({
      ok: true,
      eliminados: eliminados,
      creados: nuevos.length,
      ejemplo: nuevos[0]
    });
  } catch (err) {
    console.error('Error en importacion:', err);
    res.status(500).json({ error: 'Error en la importacion: ' + err.message });
  }
});

// === ADMIN: Importar teléfonos masivo ===
const CLAVE_IMPORT_TELEFONOS = 'Xm4pLw8rNk2vQs6Tj9Yd3Bf7';

app.post('/api/admin/importar-telefonos', (req, res) => {
  try {
    if (req.query.clave !== CLAVE_IMPORT_TELEFONOS) {
      return res.status(403).json({ error: 'Clave incorrecta' });
    }
    var telefonos = req.body.telefonos || [];
    var data = JSON.parse(fs.readFileSync(SOCIOS_FILE, 'utf8'));
    var actualizados = 0;
    var noEncontrados = [];
    for (var t = 0; t < telefonos.length; t++) {
      var entry = telefonos[t];
      var soc = data.find(function(s) { return s.num_socio === entry.num_socio; });
      if (soc) {
        soc.telefono = (entry.telefono || '').trim();
        actualizados++;
      } else {
        noEncontrados.push(entry.num_socio);
      }
    }
    guardarDatosSeguro(SOCIOS_FILE, data, 'import-telefonos');
    var conFoto = data.filter(function(s) { return s.foto_url && s.foto_url !== ''; }).length;
    console.log('Telefonos importados: ' + actualizados + ', no encontrados: ' + noEncontrados.length + ', fotos preservadas: ' + conFoto);
    res.json({ ok: true, actualizados: actualizados, no_encontrados: noEncontrados, fotos_preservadas: conFoto + '/' + data.length });
  } catch (err) {
    console.error('Error importando telefonos:', err);
    res.status(500).json({ error: 'Error en la importacion' });
  }
});

// === ADMIN: Listar backups ===
const CLAVE_ADMIN = 'Rb7xNpWq3mKs9YvTfJd2Lc6Ae';

app.get('/api/admin/listar-backups', (req, res) => {
  if (req.query.clave !== CLAVE_ADMIN) return res.status(403).json({ error: 'Clave incorrecta' });
  try {
    var files = fs.readdirSync(DATA_DIR);
    var backupsEventos = [];
    var backupsSocios = [];
    files.forEach(function(f) {
      if (f.startsWith('eventos.backup.')) {
        try {
          var content = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
          var stat = fs.statSync(path.join(DATA_DIR, f));
          backupsEventos.push({ archivo: f, bytes: stat.size, eventos_contenidos: content.length });
        } catch (e) { backupsEventos.push({ archivo: f, error: e.message }); }
      }
      if (f.startsWith('socios.backup.')) {
        try {
          var content2 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
          var stat2 = fs.statSync(path.join(DATA_DIR, f));
          backupsSocios.push({ archivo: f, bytes: stat2.size, socios_contenidos: content2.length });
        } catch (e) { backupsSocios.push({ archivo: f, error: e.message }); }
      }
    });
    backupsEventos.sort(function(a, b) { return b.archivo.localeCompare(a.archivo); });
    backupsSocios.sort(function(a, b) { return b.archivo.localeCompare(a.archivo); });
    // Estado actual
    var evtActual = []; try { evtActual = JSON.parse(fs.readFileSync(EVENTOS_FILE, 'utf8')); } catch(e){}
    res.json({ ok: true, eventos_actual: evtActual.length, backups_eventos: backupsEventos, backups_socios: backupsSocios });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === ADMIN: Restaurar backup de eventos ===
app.post('/api/admin/restaurar-eventos', (req, res) => {
  if (req.query.clave !== CLAVE_ADMIN) return res.status(403).json({ error: 'Clave incorrecta' });
  try {
    var archivo = req.body.archivo_backup;
    if (!archivo || !archivo.startsWith('eventos.backup.')) return res.status(400).json({ error: 'Archivo invalido' });
    var backupPath = path.join(DATA_DIR, archivo);
    if (!fs.existsSync(backupPath)) return res.status(404).json({ error: 'Archivo no encontrado' });

    // Backup del estado actual antes de restaurar
    var now = new Date();
    var ts = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + '-' + String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0');
    var beforeRestore = path.join(DATA_DIR, 'eventos.before-restore.' + ts + '.json');
    try { fs.copyFileSync(EVENTOS_FILE, beforeRestore); } catch(e) {}

    // Restaurar
    var backupContent = fs.readFileSync(backupPath, 'utf8');
    var parsed = JSON.parse(backupContent);
    fs.writeFileSync(EVENTOS_FILE, backupContent, 'utf8');
    console.log('Restauracion de eventos: ' + archivo + ' -> eventos.json, ' + parsed.length + ' eventos recuperados');
    res.json({ ok: true, restaurados: parsed.length, archivo_restaurado_desde: archivo });
  } catch (err) {
    console.error('Error restaurando:', err);
    res.status(500).json({ error: err.message });
  }
});

// === ADMIN: Health datos ===
app.get('/api/admin/health-datos', (req, res) => {
  if (req.query.clave !== CLAVE_ADMIN) return res.status(403).json({ error: 'Clave incorrecta' });
  function infoArchivo(ruta, tipo) {
    var result = { archivo_existe: false, cuenta: 0, archivo_bytes: 0, backups: 0, backup_mas_reciente: null };
    try {
      if (fs.existsSync(ruta)) {
        result.archivo_existe = true;
        var stat = fs.statSync(ruta);
        result.archivo_bytes = stat.size;
        result.ultimo_cambio = stat.mtime.toISOString();
        result.cuenta = JSON.parse(fs.readFileSync(ruta, 'utf8')).length;
      }
    } catch(e) { result.error = e.message; }
    try {
      var files = fs.readdirSync(DATA_DIR).filter(function(f) { return f.startsWith(tipo + '.backup.'); });
      result.backups = files.length;
      files.sort().reverse();
      if (files.length > 0) result.backup_mas_reciente = files[0];
    } catch(e) {}
    return result;
  }
  res.json({
    ok: true,
    fecha_consulta: new Date().toISOString(),
    socios: infoArchivo(SOCIOS_FILE, 'socios'),
    eventos: infoArchivo(EVENTOS_FILE, 'eventos')
  });
});

// === CONFIRMACIÓN POR ENLACE — Admin ===

function generarToken() {
  var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var token = '';
  for (var i = 0; i < 12; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
}

// POST /api/eventos/:id/generar-token
app.post('/api/eventos/:id/generar-token', (req, res) => {
  try {
    var data = leerEventos();
    var idx = data.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Evento no encontrado' });
    var token = generarToken();
    data[idx].confirmacion_token = token;
    data[idx].fecha_modificacion = fechaHoy();
    guardarEventos(data, 'generar-token');
    console.log('Token generado para evento ' + data[idx].id + ': ' + token);
    res.json({ ok: true, token: token, url_base: '/c/' + token });
  } catch (err) {
    console.error('Error generando token:', err);
    res.status(500).json({ error: 'Error al generar token' });
  }
});

// DELETE /api/eventos/:id/token
app.delete('/api/eventos/:id/token', (req, res) => {
  try {
    var data = leerEventos();
    var idx = data.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Evento no encontrado' });
    data[idx].confirmacion_token = null;
    data[idx].fecha_modificacion = fechaHoy();
    guardarEventos(data, 'invalidar-token');
    console.log('Token invalidado para evento ' + data[idx].id);
    res.json(data[idx]);
  } catch (err) {
    console.error('Error invalidando token:', err);
    res.status(500).json({ error: 'Error al invalidar token' });
  }
});

// === CONFIRMACIÓN POR ENLACE — Público (sin auth) ===

function buscarEventoPorToken(token) {
  if (!token || token.length !== 12 || !/^[a-zA-Z0-9]+$/.test(token)) return null;
  var data = leerEventos();
  return data.find(function(e) { return e.confirmacion_token === token; }) || null;
}

function buscarSocioPorNumSocio(numSocio) {
  var num = parseInt(numSocio, 10);
  if (isNaN(num)) return null;
  try {
    var socios = JSON.parse(fs.readFileSync(SOCIOS_FILE, 'utf8'));
    return socios.find(function(s) { return s.num_socio === num; }) || null;
  } catch (e) { return null; }
}

// GET /api/publico/confirmacion/:token/:num_socio
app.get('/api/publico/confirmacion/:token/:num_socio', (req, res) => {
  try {
    var evt = buscarEventoPorToken(req.params.token);
    if (!evt) return res.status(404).json({ error: 'Enlace no valido o caducado' });
    var soc = buscarSocioPorNumSocio(req.params.num_socio);
    if (!soc) return res.status(404).json({ error: 'Socio no encontrado' });

    console.log('GET confirmacion: token ' + req.params.token + ', socio ' + soc.num_socio + ', nombre ' + soc.nombre);

    var dp = evt.fecha.split('-');
    var dObj = new Date(parseInt(dp[0],10), parseInt(dp[1],10)-1, parseInt(dp[2],10));
    var dias = ['domingo','lunes','martes','mi\u00e9rcoles','jueves','viernes','s\u00e1bado'];
    var fechaFormateada = dias[dObj.getDay()] + ', ' + parseInt(dp[2],10) + ' de ' + MESES_ES[parseInt(dp[1],10)-1] + ' de ' + dp[0];

    var respActual = (evt.respuestas_confirmacion && evt.respuestas_confirmacion[String(soc.num_socio)]) || null;

    res.json({
      evento: {
        tipo: evt.tipo,
        nombre: evt.nombre,
        fecha: evt.fecha,
        fecha_formateada: fechaFormateada,
        precio_por_persona: evt.precio_por_persona,
        modo_calculo: evt.modo_calculo,
        estado: evt.estado,
        notas: evt.notas || ''
      },
      socio: {
        nombre: soc.nombre.split(' ')[0],
        nombre_completo: soc.nombre + ' ' + soc.apellidos,
        telegram_vinculado: !!soc.telegram_chat_id
      },
      respuesta_actual: respActual
    });
  } catch (err) {
    console.error('Error GET confirmacion:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/publico/confirmacion/:token/:num_socio
app.post('/api/publico/confirmacion/:token/:num_socio', (req, res) => {
  try {
    var data = leerEventos();
    var evtIdx = -1;
    for (var i = 0; i < data.length; i++) {
      if (data[i].confirmacion_token === req.params.token) { evtIdx = i; break; }
    }
    if (evtIdx === -1) return res.status(404).json({ error: 'Enlace no valido o caducado' });
    var evt = data[evtIdx];

    var soc = buscarSocioPorNumSocio(req.params.num_socio);
    if (!soc) return res.status(404).json({ error: 'Socio no encontrado' });

    if (evt.estado === 'finalizado') return res.status(403).json({ error: 'Este evento ya esta cerrado' });

    var respuesta = req.body.respuesta;
    if (!['si', 'no'].includes(respuesta)) return res.status(400).json({ error: 'Respuesta debe ser si o no' });

    var invitados = respuesta === 'si' ? (parseInt(req.body.invitados, 10) || 0) : 0;
    if (invitados < 0) invitados = 0;

    // Guardar respuesta
    if (!evt.respuestas_confirmacion) evt.respuestas_confirmacion = {};
    evt.respuestas_confirmacion[String(soc.num_socio)] = {
      respuesta: respuesta,
      invitados: invitados,
      fecha_respuesta: new Date().toISOString()
    };

    // Sincronizar con asistentes
    var socId = soc.id;
    var asistIdx = evt.asistentes.findIndex(function(a) { return a.socio_id === socId; });

    if (respuesta === 'si') {
      if (asistIdx === -1) {
        evt.asistentes.push({ socio_id: socId, invitados: invitados, pagado: false });
      } else {
        evt.asistentes[asistIdx].invitados = invitados;
      }
    } else {
      if (asistIdx !== -1) {
        // No quitar si es cocinero
        if ((evt.cocineros || []).indexOf(socId) === -1) {
          evt.asistentes.splice(asistIdx, 1);
        }
      }
    }

    evt.fecha_modificacion = fechaHoy();
    data[evtIdx] = evt;
    guardarEventos(data, 'confirmacion-publica-socio-' + soc.num_socio);

    var nombrePila = soc.nombre.split(' ')[0];
    console.log('POST confirmacion: token ' + req.params.token + ', socio ' + soc.num_socio + ' (' + nombrePila + ') respondio: ' + respuesta + ', invitados: ' + invitados);

    res.json({ ok: true, mensaje: 'Gracias ' + nombrePila + ', tu respuesta ha sido registrada.' });
  } catch (err) {
    console.error('Error POST confirmacion:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// === CANAL PREFERIDO ===
app.put('/api/socios/:id/canal', (req, res) => {
  try {
    var canal = req.body.canal_preferido;
    if (!['whatsapp', 'telegram', 'ambos', null].includes(canal)) return res.status(400).json({ error: 'Canal invalido' });
    var data = leerSocios();
    var idx = data.findIndex(function(s) { return s.id === req.params.id; });
    if (idx === -1) return res.status(404).json({ error: 'Socio no encontrado' });
    data[idx].canal_preferido = canal;
    data[idx].fecha_modificacion = fechaHoy();
    guardarDatosSeguro(SOCIOS_FILE, data, 'canal-preferido');
    res.json(data[idx]);
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

// === TELEGRAM BOT ===
var bot = null;
if (TelegramBot && process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  console.log('Bot Telegram inicializado');

  bot.onText(/\/start(?:\s+(\d+))?/, function(msg, match) {
    var chatId = msg.chat.id;
    var numSocio = match[1] ? parseInt(match[1]) : null;
    if (numSocio) {
      var data = leerSocios();
      var soc = data.find(function(s) { return s.num_socio === numSocio; });
      if (soc) {
        soc.telegram_chat_id = chatId;
        if (!soc.canal_preferido || soc.canal_preferido === 'whatsapp') soc.canal_preferido = 'ambos';
        guardarDatosSeguro(SOCIOS_FILE, data, 'telegram-vinculacion');
        bot.sendMessage(chatId, 'Hola ' + soc.nombre.split(' ')[0] + '! Ya estas vinculado a LA BOYA.\n\nDesde ahora recibiras las confirmaciones de eventos aqui.\nTu numero de socio: ' + numSocio);
        console.log('Telegram vinculado: socio ' + numSocio + ' -> chat_id ' + chatId);
      } else {
        bot.sendMessage(chatId, 'No he encontrado el socio con numero ' + numSocio + '. Vuelve a la web de LA BOYA y prueba de nuevo.');
      }
    } else {
      bot.sendMessage(chatId, 'Hola, soy el bot de LA BOYA.\n\nPara vincular tu cuenta, pulsa el boton "Activar Telegram" en la web de confirmacion de asistencia.');
    }
  });

  bot.on('callback_query', function(query) {
    var chatId = query.message.chat.id;
    var messageId = query.message.message_id;
    var matchCb = query.data.match(/^confirm_(.+)_(\d+)_(si|no)$/);
    if (!matchCb) return;
    var eventoId = matchCb[1]; var numSocio = matchCb[2]; var respuesta = matchCb[3];
    try {
      var eventos = leerEventos();
      var evento = eventos.find(function(e) { return e.id === eventoId; });
      if (!evento) { bot.answerCallbackQuery(query.id, { text: 'Evento no encontrado', show_alert: true }); return; }
      if (evento.estado === 'finalizado') { bot.answerCallbackQuery(query.id, { text: 'Evento ya cerrado', show_alert: true }); return; }

      if (!evento.respuestas_confirmacion) evento.respuestas_confirmacion = {};
      var prevInv = (evento.respuestas_confirmacion[numSocio] && evento.respuestas_confirmacion[numSocio].invitados) || 0;
      evento.respuestas_confirmacion[numSocio] = { respuesta: respuesta, invitados: respuesta === 'si' ? prevInv : 0, fecha_respuesta: new Date().toISOString() };

      var socData = leerSocios();
      var soc = socData.find(function(s) { return s.num_socio === parseInt(numSocio); });
      var socId = soc ? soc.id : numSocio;

      if (respuesta === 'si') {
        if (!evento.asistentes.some(function(a) { return a.socio_id === socId; })) {
          evento.asistentes.push({ socio_id: socId, invitados: prevInv, pagado: false });
        }
      } else {
        var cocIdx = (evento.cocineros || []).indexOf(socId);
        if (cocIdx === -1) evento.asistentes = evento.asistentes.filter(function(a) { return a.socio_id !== socId; });
      }

      evento.fecha_modificacion = fechaHoy();
      guardarDatosSeguro(EVENTOS_FILE, eventos, 'telegram-confirm-' + numSocio);

      var nombre = soc ? soc.nombre.split(' ')[0] : 'amigo';
      var msgConf = respuesta === 'si' ? 'Gracias ' + nombre + ', tu asistencia esta confirmada.' : 'Gracias ' + nombre + ', hemos registrado que no puedes ir.';
      bot.editMessageText(query.message.text + '\n\n' + msgConf, { chat_id: chatId, message_id: messageId }).catch(function() {});
      bot.answerCallbackQuery(query.id, { text: msgConf });
      console.log('Telegram callback: evento ' + eventoId + ', socio ' + numSocio + ' -> ' + respuesta);
    } catch (err) {
      console.error('Error callback Telegram:', err);
      bot.answerCallbackQuery(query.id, { text: 'Error, intentalo de nuevo', show_alert: true });
    }
  });

  bot.on('polling_error', function(err) { console.error('Telegram polling error:', err.code); });
} else {
  console.log('TELEGRAM_BOT_TOKEN no definido. Telegram deshabilitado.');
}

// POST /api/eventos/:id/enviar-telegram
app.post('/api/eventos/:id/enviar-telegram', function(req, res) {
  if (!bot) return res.status(503).json({ error: 'Telegram no configurado' });
  try {
    var data = leerEventos();
    var evt = data.find(function(e) { return e.id === req.params.id; });
    if (!evt) return res.status(404).json({ error: 'Evento no encontrado' });
    var destinatarios = req.body.socios || [];
    var plantilla = req.body.mensaje_plantilla || '';
    var enviados = 0; var fallidos = 0; var detalles = [];

    function enviarUno(i) {
      if (i >= destinatarios.length) {
        console.log('Telegram enviados: ' + enviados + ', fallidos: ' + fallidos + ' para evento ' + evt.id);
        return res.json({ ok: true, enviados: enviados, fallidos: fallidos, detalles: detalles });
      }
      var d = destinatarios[i];
      if (!d.chat_id) { fallidos++; detalles.push({ num_socio: d.num_socio, error: 'sin chat_id' }); enviarUno(i + 1); return; }
      var msg = plantilla.replace(/\{NOMBRE\}/g, d.nombre_pila || 'Socio');
      var keyboard = { inline_keyboard: [
        [{ text: '\u2713 SI CONFIRMO', callback_data: 'confirm_' + evt.id + '_' + d.num_socio + '_si' }],
        [{ text: '\u2717 NO PUEDO IR', callback_data: 'confirm_' + evt.id + '_' + d.num_socio + '_no' }]
      ]};
      bot.sendMessage(d.chat_id, msg, { reply_markup: keyboard })
        .then(function() { enviados++; detalles.push({ num_socio: d.num_socio, ok: true }); enviarUno(i + 1); })
        .catch(function(err) { fallidos++; detalles.push({ num_socio: d.num_socio, error: err.message }); enviarUno(i + 1); });
    }
    enviarUno(0);
  } catch (err) {
    console.error('Error enviar Telegram:', err);
    res.status(500).json({ error: 'Error al enviar' });
  }
});

app.listen(PORT, () => {
  console.log(`LA BOYA corriendo en puerto ${PORT}`);
  console.log(`Datos en: ${SOCIOS_FILE}`);
  console.log('Clave admin backups/restore: ' + CLAVE_ADMIN);
});
