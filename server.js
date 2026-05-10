require('dotenv').config();
const mysql = require('mysql2/promise');
const express = require('express');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// 1. CONEXIÓN A BASE DE DATOS
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
// Usar la URL de Render en producción o localhost en tu PC
const isProduction = process.env.RENDER_EXTERNAL_URL; // Render nos da esta variable automáticamente
const REDIRECT_URL = isProduction
    ? `${process.env.RENDER_EXTERNAL_URL}/auth/google/callback`
    : 'http://localhost:3000/auth/google/callback';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);
let googleCalendarAutenticado = false;

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // false para 587
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

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

// ==========================================
// PACIENTES (Crear, Leer, Modificar, Borrar)
// ==========================================
app.get('/api/pacientes', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM pacientes');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/citas', async (req, res) => {
    const { id_paciente, fecha_hora, tipo_servicio, motivo } = req.body;

    // 1. Definir catálogo y duración
    const catalogo = { 'Consulta General': 30, 'Limpieza': 45, 'Extracción': 60, 'Ortodoncia': 30, 'Urgencias': 30 };
    const duracion = catalogo[tipo_servicio] || 30;

    // 2. Validar horario
    const validacion = esHorarioValido(fecha_hora, duracion);
    if (!validacion.valido) return res.status(400).json({ error: validacion.msg });

    try {
        // 3. Obtener datos del paciente
        const [pacientes] = await db.query('SELECT * FROM pacientes WHERE id_paciente = ?', [id_paciente]);
        const paciente = pacientes[0];

        if (!paciente) return res.status(404).json({ error: "Paciente no encontrado" });

        // Separar fecha y hora para la DB
        const [fechaStr, horaStr] = fecha_hora.split('T');
        let googleEventId = null;

        // 4. Lógica de Google Calendar (CORREGIDA PARA GMT-6)
        if (googleCalendarAutenticado) {
            try {
                const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

                // IMPORTANTE: Ajuste de desfase horario para México
                const inicio = new Date(fecha_hora);
                const fin = new Date(inicio.getTime() + duracion * 60000);

                const evento = await calendar.events.insert({
                    calendarId: 'primary',
                    resource: {
                        summary: `${tipo_servicio} - ${paciente.nombre_completo}`,
                        description: `Motivo: ${motivo}\nTeléfono: ${paciente.telefono}`,
                        start: {
                            dateTime: inicio.toISOString().replace(/\.\d+Z$/, ''), // Limpia el formato para Google
                            timeZone: 'America/Mexico_City'
                        },
                        end: {
                            dateTime: fin.toISOString().replace(/\.\d+Z$/, ''),
                            timeZone: 'America/Mexico_City'
                        },
                    }
                });
                googleEventId = evento.data.id;
                console.log("✅ Evento creado en Google Calendar");
            } catch (calErr) {
                console.error("❌ Error G-Calendar:", calErr.message);
                // No detenemos el proceso si falla el calendario
            }
        }

        // 5. Guardar en Base de Datos (Esto es lo que dices que no se guarda)
        await db.query(
            'INSERT INTO citas (id_paciente, fecha, hora, tipo_servicio, duracion_min, motivo, google_event_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id_paciente, fechaStr, horaStr, tipo_servicio, duracion, motivo || '', googleEventId]
        );
        console.log("✅ Cita guardada en la base de datos");

        // 6. Envío de Mail (Con manejo de errores para que no trabe el servidor)
        if (paciente.email && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: paciente.email,
                subject: '🦷 Confirmación de Cita - Consultorio Dental',
                text: `Hola ${paciente.nombre_completo}, tu cita para ${tipo_servicio} está confirmada el ${fechaStr} a las ${horaStr}.`
            }, (err, info) => {
                if (err) console.error("❌ Error enviando mail:", err.message);
                else console.log("✅ Mail enviado:", info.response);
            });
        }

        res.json({ mensaje: 'Cita agendada exitosamente.' });

    } catch (err) {
        console.error("❌ Error Crítico en el proceso:", err);
        res.status(500).json({ error: "Error interno al procesar la cita." });
    }
});

app.put('/api/pacientes/:id', async (req, res) => {
    const { nombre_completo, telefono, email, edad, alergias_antecedentes } = req.body;
    try {
        await db.query('UPDATE pacientes SET nombre_completo=?, telefono=?, email=?, edad=?, alergias_antecedentes=? WHERE id_paciente=?',
            [nombre_completo, telefono, email, edad || null, alergias_antecedentes || '', req.params.id]);
        res.json({ mensaje: 'Datos del paciente actualizados.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/pacientes/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM pacientes WHERE id_paciente=?', [req.params.id]);
        res.json({ mensaje: 'Paciente y citas eliminados.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// CITAS Y GOOGLE CALENDAR
// ==========================================
app.get('/api/citas', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT c.*, DATE_FORMAT(c.fecha, '%Y-%m-%d') as fecha_f, p.nombre_completo FROM citas c JOIN pacientes p ON c.id_paciente = p.id_paciente");
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/citas', async (req, res) => {
    const { id_paciente, fecha_hora, tipo_servicio, motivo } = req.body;
    const catalogo = { 'Consulta General': 30, 'Limpieza': 45, 'Extracción': 60, 'Ortodoncia': 30, 'Urgencias': 30 };
    const duracion = catalogo[tipo_servicio] || 30;

    const validacion = esHorarioValido(fecha_hora, duracion);
    if (!validacion.valido) return res.status(400).json({ error: validacion.msg });

    try {
        const [pacientes] = await db.query('SELECT * FROM pacientes WHERE id_paciente = ?', [id_paciente]);
        const paciente = pacientes[0];
        const [fechaStr, horaStr] = fecha_hora.split('T');
        let googleEventId = null;

        if (googleCalendarAutenticado) {
            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
            const fechaInicio = new Date(fecha_hora);
            const fechaFin = new Date(fechaInicio.getTime() + duracion * 60000);
            try {
                const evento = await calendar.events.insert({
                    calendarId: 'primary',
                    resource: {
                        summary: `${tipo_servicio} - ${paciente.nombre_completo}`,
                        description: `Motivo: ${motivo}\nTeléfono: ${paciente.telefono}`,
                        start: { dateTime: fechaInicio.toISOString(), timeZone: 'America/Mexico_City' },
                        end: { dateTime: fechaFin.toISOString(), timeZone: 'America/Mexico_City' },
                    }
                });
                googleEventId = evento.data.id;
            } catch (calErr) { console.error("Error G-Calendar:", calErr.message); }
        }

        await db.query('INSERT INTO citas (id_paciente, fecha, hora, tipo_servicio, duracion_min, motivo, google_event_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id_paciente, fechaStr, horaStr, tipo_servicio, duracion, motivo || '', googleEventId]);

        if (paciente.email) {
            transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: paciente.email,
                subject: '🦷 Confirmación de Cita',
                text: `Hola ${paciente.nombre_completo}, tu cita para ${tipo_servicio} está confirmada el ${fechaStr} a las ${horaStr}.`
            }).catch(e => console.error("Error enviando mail:", e));
        }

        res.json({ mensaje: 'Cita agendada exitosamente.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ¡NUEVO! MODIFICAR CITA
app.put('/api/citas/:id', async (req, res) => {
    const { id_paciente, fecha_hora, tipo_servicio, motivo } = req.body;
    const catalogo = { 'Consulta General': 30, 'Limpieza': 45, 'Extracción': 60, 'Ortodoncia': 30, 'Urgencias': 30 };
    const duracion = catalogo[tipo_servicio] || 30;

    const validacion = esHorarioValido(fecha_hora, duracion);
    if (!validacion.valido) return res.status(400).json({ error: validacion.msg });

    try {
        const [citas] = await db.query('SELECT google_event_id FROM citas WHERE id_cita = ?', [req.params.id]);
        const googleEventId = citas[0]?.google_event_id;
        const [fechaStr, horaStr] = fecha_hora.split('T');

        if (googleCalendarAutenticado && googleEventId) {
            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
            const fechaInicio = new Date(fecha_hora);
            const fechaFin = new Date(fechaInicio.getTime() + duracion * 60000);
            await calendar.events.update({
                calendarId: 'primary',
                eventId: googleEventId,
                resource: {
                    summary: `${tipo_servicio} (Reprogramada)`,
                    description: `Motivo: ${motivo}`,
                    start: { dateTime: fechaInicio.toISOString(), timeZone: 'America/Mexico_City' },
                    end: { dateTime: fechaFin.toISOString(), timeZone: 'America/Mexico_City' },
                }
            });
        }

        await db.query('UPDATE citas SET id_paciente=?, fecha=?, hora=?, tipo_servicio=?, duracion_min=?, motivo=? WHERE id_cita=?',
            [id_paciente, fechaStr, horaStr, tipo_servicio, duracion, motivo || '', req.params.id]);

        res.json({ mensaje: 'Cita modificada exitosamente en sistema y Google Calendar.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ¡NUEVO! BORRAR CITA
app.delete('/api/citas/:id', async (req, res) => {
    try {
        const [citas] = await db.query('SELECT google_event_id FROM citas WHERE id_cita = ?', [req.params.id]);
        const googleEventId = citas[0]?.google_event_id;

        if (googleCalendarAutenticado && googleEventId) {
            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
            await calendar.events.delete({ calendarId: 'primary', eventId: googleEventId });
        }

        await db.query('DELETE FROM citas WHERE id_cita = ?', [req.params.id]);
        res.json({ mensaje: 'Cita cancelada y eliminada de Google Calendar.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor Enterprise escuchando en el puerto ${PORT}`);
});