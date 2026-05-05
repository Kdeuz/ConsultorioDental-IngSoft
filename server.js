const mysql = require('mysql2');
const express = require('express');
const app = express();

app.use(express.json());
// ESTO ES NUEVO: Le dice al servidor que muestre la página web de la carpeta 'public'
app.use(express.static('public'));

// Configuración de la base de datos
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Test123/', // <--- PON TU CONTRASEÑA REAL AQUÍ
    database: 'consultorio_dental'
});

db.connect(error => {
    if (error) console.error('❌ Error BD:', error.message);
    else console.log('✅ Conexión exitosa a la base de datos');
});

// ==========================================
// RUTAS CRUD (Para cumplir con la actividad)
// ==========================================

// 1. LEER (Mostrar datos)
app.get('/api/pacientes', (req, res) => {
    db.query('SELECT * FROM pacientes', (err, resultados) => {
        if (err) return res.status(500).send(err);
        res.json(resultados);
    });
});

// 2. AGREGAR (Crear)
app.post('/api/pacientes', (req, res) => {
    const { nombre_completo, telefono, email } = req.body;
    const sql = 'INSERT INTO pacientes (nombre_completo, telefono, email) VALUES (?, ?, ?)';
    db.query(sql, [nombre_completo, telefono, email], (err, resultado) => {
        if (err) return res.status(500).send(err);
        res.json({ mensaje: 'Paciente agregado' });
    });
});

// 3. MODIFICAR (Actualizar)
app.put('/api/pacientes/:id', (req, res) => {
    const { id } = req.params;
    const { nombre_completo, telefono, email } = req.body;
    const sql = 'UPDATE pacientes SET nombre_completo=?, telefono=?, email=? WHERE id_paciente=?';
    db.query(sql, [nombre_completo, telefono, email, id], (err, resultado) => {
        if (err) return res.status(500).send(err);
        res.json({ mensaje: 'Paciente modificado' });
    });
});

// 4. ELIMINAR
app.delete('/api/pacientes/:id', (req, res) => {
    const { id } = req.params;
    const sql = 'DELETE FROM pacientes WHERE id_paciente=?';
    db.query(sql, [id], (err, resultado) => {
        if (err) return res.status(500).send(err);
        res.json({ mensaje: 'Paciente eliminado' });
    });
});

app.listen(3000, () => {
    console.log('🚀 Interfaz disponible en: http://localhost:3000');
});