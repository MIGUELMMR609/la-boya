const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

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
}

inicializarDatos();

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
    fs.writeFileSync(SOCIOS_FILE, JSON.stringify(data, null, 2), 'utf8');
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
    fs.writeFileSync(SOCIOS_FILE, JSON.stringify(data, null, 2), 'utf8');
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
    fs.writeFileSync(SOCIOS_FILE, JSON.stringify(data, null, 2), 'utf8');
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
    fs.writeFileSync(SOCIOS_FILE, JSON.stringify(data, null, 2), 'utf8');
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
    fs.writeFileSync(SOCIOS_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('Socio eliminado: ' + socio.nombre + ' (id: ' + socio.id + ')');
    res.json({ ok: true });
  } catch (err) {
    console.error('Error eliminando socio:', err);
    res.status(500).json({ error: 'Error al eliminar socio' });
  }
});

app.listen(PORT, () => {
  console.log(`LA BOYA corriendo en puerto ${PORT}`);
  console.log(`Datos en: ${SOCIOS_FILE}`);
});
