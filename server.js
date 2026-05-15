require('dotenv').config();
const mysql = require('mysql2/promise');
const express = require('express');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const cron = require('node-cron'); // ✅ Importación vital para que no crashee
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// 1. CONEXIÓN A BASE DE DATOS (MySQL / TiDB)
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    }
});

// 2. CONFIGURACIÓN DE OAUTH2 Y MAILS
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const isProduction = process.env.RENDER_EXTERNAL_URL;
const REDIRECT_URL = isProduction
    ? `${process.env.RENDER_EXTERNAL_URL}/auth/google/callback`
    : 'http://localhost:3000/auth/google/callback';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);
let googleCalendarAutenticado = false;

// Configuración de Mail robusta
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

// --- REGLAS DE HORARIO ---
const esHorarioValido = (fechaHora, duracionMin) => {
    const fecha = new Date(fechaHora);
    const dia = fecha.getDay();
    const horaDecimal = fecha.getHours() + (fecha.getMinutes() / 60);

    if (dia === 0) return { valido: false, msg: "Domingo cerrado." };
    if (dia >= 1 && dia <= 5) {
        if (horaDecimal < 10 || (horaDecimal + duracionMin/60) > 19) return { valido: false, msg: "Fuera de horario (L-V 10am-7pm)" };
        if (horaDecimal < 15 && (horaDecimal + duracionMin/60) > 14) return { valido: false, msg: "Bloqueo por comida (2pm-3pm)" };
    }
    if (dia === 6) {
        if (horaDecimal < 10 || (horaDecimal + duracionMin/60) > 14) return { valido: false, msg: "Sábados solo de 10am a 2pm" };
    }
    return { valido: true };
};

// A. VALIDACIÓN DE TRASLAPES (Módulo 2)
async function verificarTraslape(fecha, hora, duracion, idMedico, idCitaExcluir = 0) {
    const [conflictos] = await db.query(
        `SELECT * FROM citas 
         WHERE id_medico = ? AND fecha = ? AND id_cita != ?
         AND (
            (hora <= ? AND ADDTIME(hora, SEC_TO_TIME(duracion_min * 60)) > ?) OR
            (hora < ADDTIME(?, SEC_TO_TIME(? * 60)) AND ADDTIME(hora, SEC_TO_TIME(duracion_min * 60)) >= ADDTIME(?, SEC_TO_TIME(? * 60)))
         )`,
        [idMedico, fecha, idCitaExcluir, hora, hora, hora, duracion, hora, duracion]
    );
    return conflictos.length > 0;
}

// --- RUTAS DE GOOGLE OAUTH ---
app.get('/auth/google', (req, res) => {
    const url = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: ['https://www.googleapis.com/auth/calendar.events'] });
    res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
    try {
        const { tokens } = await oauth2Client.getToken(req.query.code);
        oauth2Client.setCredentials(tokens);
        googleCalendarAutenticado = true;
        res.redirect('/?conectado=true');
    } catch (error) { res.send('Error con Google: ' + error.message); }
});

app.get('/api/estado-google', (req, res) => res.json({ conectado: googleCalendarAutenticado }));

// ==========================================
// PACIENTES (Con validaciones robustas)
// ==========================================
app.get('/api/pacientes', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM pacientes');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/pacientes', async (req, res) => {
    const { nombre_completo, telefono, email, edad, alergias_antecedentes } = req.body;
    try {
        await db.query('INSERT INTO pacientes (nombre_completo, telefono, email, edad, alergias_antecedentes) VALUES (?, ?, ?, ?, ?)',
            [nombre_completo, telefono, email, edad || null, alergias_antecedentes || '']);
        res.json({ mensaje: 'Paciente registrado.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/pacientes/:id', async (req, res) => {
    const { nombre_completo, telefono, email, edad, alergias_antecedentes } = req.body;
    const { id } = req.params;
    try {
        const [result] = await db.query(
            'UPDATE pacientes SET nombre_completo = ?, telefono = ?, email = ?, edad = ?, alergias_antecedentes = ? WHERE id_paciente = ?',
            [nombre_completo, telefono, email, edad || null, alergias_antecedentes || '', id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: "Paciente no encontrado" });
        res.json({ mensaje: 'Paciente actualizado.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/pacientes/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query('DELETE FROM pacientes WHERE id_paciente = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: "Paciente no encontrado" });
        res.json({ mensaje: 'Paciente eliminado y todas sus citas canceladas.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/pacientes/:id/historial', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM citas WHERE id_paciente = ? ORDER BY fecha DESC, hora DESC", [req.params.id]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// CITAS (Con Google Calendar Update Sincronizado)
// ==========================================
app.post('/api/citas', async (req, res) => {
    const { id_paciente, fecha_hora, tipo_servicio, motivo } = req.body;
    const catalogo = { 'Consulta General': 30, 'Limpieza': 45, 'Extracción': 60, 'Ortodoncia': 30, 'Urgencias': 30 };
    const duracion = catalogo[tipo_servicio] || 30;

    const validacion = esHorarioValido(fecha_hora, duracion);
    if (!validacion.valido) return res.status(400).json({ error: validacion.msg });

    try {
        const [pacientes] = await db.query('SELECT * FROM pacientes WHERE id_paciente = ?', [id_paciente]);
        const paciente = pacientes[0];
        if (!paciente) return res.status(404).json({ error: "Paciente no encontrado" });

        const fecha = fecha_hora.split('T')[0];
        const hora = fecha_hora.split('T')[1]?.substring(0, 5) || '10:00';
        
        const hayTraslape = await verificarTraslape(fecha, hora, duracion, 1);
        if (hayTraslape) return res.status(400).json({ error: "Horario ocupado. Selecciona otro horario." });

        let googleEventId = null;

        if (googleCalendarAutenticado) {
            try {
                const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
                const inicio = new Date(fecha_hora);
                const fin = new Date(inicio.getTime() + duracion * 60000);

                const evento = await calendar.events.insert({
                    calendarId: 'primary',
                    resource: {
                        summary: `${tipo_servicio} - ${paciente.nombre_completo}`,
                        description: `Motivo: ${motivo}`,
                        start: { dateTime: inicio.toISOString().replace(/\.\d+Z$/, ''), timeZone: 'America/Mexico_City' },
                        end: { dateTime: fin.toISOString().replace(/\.\d+Z$/, ''), timeZone: 'America/Mexico_City' },
                    }
                });
                googleEventId = evento.data.id;
            } catch (calErr) { console.error("❌ Error G-Calendar:", calErr.message); }
        }

        await db.query(
            'INSERT INTO citas (id_paciente, fecha, hora, tipo_servicio, duracion_min, motivo, google_event_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id_paciente, fecha, hora, tipo_servicio, duracion, motivo || '', googleEventId]
        );

        if (paciente.email) {
            transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: paciente.email,
                subject: '🦷 Confirmación de Cita',
                text: `Hola ${paciente.nombre_completo}, tu cita para ${tipo_servicio} está confirmada el ${fecha} a las ${hora}.`
            }, (err) => { if (err) console.error("❌ Error Mail:", err.message); });
        }

        res.json({ mensaje: 'Cita agendada exitosamente.' });
    } catch (err) {
        console.error("❌ Error Crítico:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/citas', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT c.*, DATE_FORMAT(c.fecha, '%Y-%m-%d') as fecha_f, p.nombre_completo FROM citas c JOIN pacientes p ON c.id_paciente = p.id_paciente");
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ LA FUSIÓN: Validación de existencia (Claude) + Update en Calendar (Mi código)
app.put('/api/citas/:id', async (req, res) => {
    const { id_paciente, fecha_hora, tipo_servicio, motivo } = req.body;
    const { id } = req.params;
    const catalogo = { 'Consulta General': 30, 'Limpieza': 45, 'Extracción': 60, 'Ortodoncia': 30, 'Urgencias': 30 };
    const duracion = catalogo[tipo_servicio] || 30;

    const validacion = esHorarioValido(fecha_hora, duracion);
    if (!validacion.valido) return res.status(400).json({ error: validacion.msg });

    try {
        const fecha = fecha_hora.split('T')[0];
        const hora = fecha_hora.split('T')[1]?.substring(0, 5) || '10:00';
        
        const hayTraslape = await verificarTraslape(fecha, hora, duracion, 1, id);
        if (hayTraslape) return res.status(400).json({ error: "Horario ocupado. Selecciona otro horario." });

        // Obtenemos los datos originales para saber el ID de Google Calendar
        const [[citaOriginal]] = await db.query('SELECT * FROM citas WHERE id_cita = ?', [id]);
        if (!citaOriginal) return res.status(404).json({ error: "Cita no encontrada" });

        const [pacientes] = await db.query('SELECT * FROM pacientes WHERE id_paciente = ?', [id_paciente]);
        const paciente = pacientes[0];

        let googleEventId = citaOriginal.google_event_id;

        // Actualizamos el evento en Google Calendar si existe
        if (googleCalendarAutenticado && googleEventId) {
            try {
                const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
                const inicio = new Date(fecha_hora);
                const fin = new Date(inicio.getTime() + duracion * 60000);

                await calendar.events.update({
                    calendarId: 'primary',
                    eventId: googleEventId,
                    resource: {
                        summary: `${tipo_servicio} - ${paciente.nombre_completo}`,
                        description: `Motivo: ${motivo}`,
                        start: { dateTime: inicio.toISOString().replace(/\.\d+Z$/, ''), timeZone: 'America/Mexico_City' },
                        end: { dateTime: fin.toISOString().replace(/\.\d+Z$/, ''), timeZone: 'America/Mexico_City' }
                    }
                });
                console.log("✅ Evento actualizado en Google Calendar");
            } catch (calErr) { console.error("⚠️ Error actualizando G-Calendar:", calErr.message); }
        }

        const [result] = await db.query(
            'UPDATE citas SET id_paciente = ?, fecha = ?, hora = ?, tipo_servicio = ?, duracion_min = ?, motivo = ? WHERE id_cita = ?',
            [id_paciente, fecha, hora, tipo_servicio, duracion, motivo || '', id]
        );

        res.json({ mensaje: 'Cita modificada exitosamente en la Base de Datos y Calendar.' });
    } catch (err) {
        console.error("❌ Error al modificar cita:", err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/citas/:id', async (req, res) => {
    try {
        const [[cita]] = await db.query(
            "SELECT c.*, p.email, p.nombre_completo FROM citas c JOIN pacientes p ON c.id_paciente = p.id_paciente WHERE id_cita = ?", 
            [req.params.id]
        );

        if (!cita) return res.status(404).json({ error: "Cita no encontrada" });

        if (cita.google_event_id && googleCalendarAutenticado) {
            try {
                const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
                await calendar.events.delete({ calendarId: 'primary', eventId: cita.google_event_id });
                console.log("✅ Evento eliminado de Google Calendar");
            } catch (calErr) { console.error("⚠️ Error eliminando evento de Google Calendar:", calErr.message); }
        }

        await db.query("DELETE FROM citas WHERE id_cita = ?", [req.params.id]);

        if (cita && cita.email) {
            transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: cita.email,
                subject: '⚠️ Cita Cancelada',
                text: `Hola ${cita.nombre_completo}, te confirmamos que tu cita para ${cita.tipo_servicio} ha sido cancelada.`
            });
        }
        res.json({ mensaje: 'Cita cancelada y paciente notificado.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// D. CRON JOB (Con el try...catch de seguridad)
cron.schedule('0 8 * * *', async () => {
    console.log('--- Ejecutando recordatorios de 24 horas ---');
    try {
        const [citasManana] = await db.query(
            `SELECT c.*, p.email, p.nombre_completo 
             FROM citas c JOIN pacientes p ON c.id_paciente = p.id_paciente 
             WHERE c.fecha = CURDATE() + INTERVAL 1 DAY`
        );

        for (let cita of citasManana) {
            if (cita.email) {
                transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: cita.email,
                    subject: '⏰ Recordatorio: Cita Mañana',
                    text: `Hola ${cita.nombre_completo}, te recordamos tu cita de ${cita.tipo_servicio} para mañana a las ${cita.hora}.`
                });
            }
        }
    } catch (err) {
        console.error("❌ Error en cron job:", err.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor Enterprise escuchando en el puerto ${PORT}`);
});
