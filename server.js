const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());

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

app.listen(PORT, () => {
  console.log(`LA BOYA corriendo en puerto ${PORT}`);
  console.log(`Datos en: ${SOCIOS_FILE}`);
});
