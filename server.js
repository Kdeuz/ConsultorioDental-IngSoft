const mysql = require('mysql2');
const express = require('express');
const app = express();

app.use(express.json());
app.use(express.static('public'));

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
// RUTAS DE PACIENTES
// ==========================================
app.get('/api/pacientes', (req, res) => {
    db.query('SELECT * FROM pacientes', (err, resultados) => {
        if (err) return res.status(500).send(err);
        res.json(resultados);
    });
});

app.post('/api/pacientes', (req, res) => {
    const { nombre_completo, telefono, email } = req.body;
    db.query('INSERT INTO pacientes (nombre_completo, telefono, email) VALUES (?, ?, ?)', [nombre_completo, telefono, email], (err) => {
        if (err) return res.status(500).send(err);
        res.json({ mensaje: 'Paciente agregado' });
    });
});

app.put('/api/pacientes/:id', (req, res) => {
    const { id } = req.params;
    const { nombre_completo, telefono, email } = req.body;
    db.query('UPDATE pacientes SET nombre_completo=?, telefono=?, email=? WHERE id_paciente=?', [nombre_completo, telefono, email, id], (err) => {
        if (err) return res.status(500).send(err);
        res.json({ mensaje: 'Paciente modificado' });
    });
});

app.delete('/api/pacientes/:id', (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM pacientes WHERE id_paciente=?', [id], (err) => {
        if (err) return res.status(500).send(err);
        res.json({ mensaje: 'Paciente eliminado' });
    });
});

// ==========================================
// RUTAS DE CITAS (CALENDARIO)
// ==========================================
app.get('/api/citas', (req, res) => {
    // Obtenemos la cita junto con el nombre del paciente
    const sql = `
        SELECT c.id_cita, DATE_FORMAT(c.fecha, '%Y-%m-%d') as fecha, c.hora, c.motivo, p.nombre_completo 
        FROM citas c 
        JOIN pacientes p ON c.id_paciente = p.id_paciente
    `;
    db.query(sql, (err, resultados) => {
        if (err) return res.status(500).send(err);
        res.json(resultados);
    });
});

app.post('/api/citas', (req, res) => {
    const { id_paciente, fecha, hora, motivo } = req.body;
    db.query('INSERT INTO citas (id_paciente, fecha, hora, motivo) VALUES (?, ?, ?, ?)', [id_paciente, fecha, hora, motivo], (err) => {
        if (err) return res.status(500).send(err);
        res.json({ mensaje: 'Cita guardada' });
    });
});

app.listen(3000, () => {
    console.log('🚀 Interfaz disponible en: http://localhost:3000');
});