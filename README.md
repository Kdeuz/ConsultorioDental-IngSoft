# 🦷 Sistema de Gestión Dental Inteligente (Enterprise Edition)

Este software es una solución integral para la administración de consultorios dentales, desarrollada siguiendo los lineamientos de la **Propuesta Final** y los diagramas de arquitectura del proyecto (Clases, Objetos y Componentes).

## 🌟 Funcionalidades Implementadas

### 📋 1. Gestión de Pacientes y Expedientes
- **Registro Completo:** Permite capturar nombre, teléfono, email, edad y notas médicas (alergias/antecedentes).
- **Control de Expedientes:** Visualización dinámica y edición de datos del paciente desde una interfaz intuitiva.
- **Eliminación Segura:** Implementa borrado en cascada (Cascade Delete) en MySQL para mantener la integridad de la base de datos al eliminar registros.

### 📅 2. Agenda de Citas Inteligente
- **Catálogo de Servicios Automatizado:** El sistema asigna duraciones automáticas según el procedimiento:
  - **Consulta General:** 30 min.
  - **Limpieza:** 45 min.
  - **Extracción:** 60 min.
  - **Ortodoncia:** 30 min.
  - **Urgencias:** 30 min.
- **Interfaz Interactiva:** Calendario gráfico (FullCalendar) con soporte para arrastrar, soltar y hacer clic para editar/eliminar citas.

### ⚖️ 3. Reglas de Negocio y Validación de Horarios
El sistema valida rigurosamente la disponibilidad antes de agendar:
- **Horario de Operación:** Lunes a Viernes (10:00 AM - 7:00 PM) y Sábados (10:00 AM - 2:00 PM).
- **Días Inhábiles:** Bloqueo automático de agendamiento los domingos.
- **Horas de Comida:** Restricción fija de 2:00 PM a 3:00 PM entre semana.

### ☁️ 4. Integraciones y Automatización
- **Google Calendar API:** Sincronización en tiempo real mediante OAuth 2.0. Las citas se crean, modifican o eliminan automáticamente en la cuenta de Google del dentista.
- **Notificaciones por Correo:** Envío automático de confirmaciones mediante protocolo SMTP (Nodemailer) al momento de agendar.

### 🔒 5. Seguridad y Arquitectura
- **Capa de Notificaciones:** Uso de servicios externos vía API/SMTP.
- **Variables de Entorno:** Protección de credenciales críticas (DB, API Keys, Passwords) mediante el uso de un archivo `.env` (Bóveda de seguridad).

## 🛠️ Stack Tecnológico
- **Frontend:** HTML5, CSS3, JavaScript (ES6+), FullCalendar.js.
- **Backend:** Node.js con Express.
- **Base de Datos:** MySQL (Sistema relacional).
- **Dependencias Clave:** `googleapis`, `nodemailer`, `mysql2`, `dotenv`.

## ⚙️ Configuración del Proyecto

### 1. Preparación de la Base de Datos
Ejecuta el script SQL ubicado en `database/tablas.sql` para generar la estructura de tablas (`pacientes`, `citas`, `medicos`) con sus relaciones de llave foránea.

### 2. Instalación de Dependencias
Abre tu terminal en la carpeta del proyecto y ejecuta:
```bash
npm install express mysql2 googleapis nodemailer dotenv
```

### 3. Configuración de Seguridad (.env)
Crea un archivo `.env` en la raíz del proyecto (asegúrate de que esté listado en tu `.gitignore`) con el siguiente contenido:
```env
DB_PASSWORD=tu_contraseña_mysql
EMAIL_USER=tu_correo@gmail.com
EMAIL_PASS=tu_contraseña_de_aplicacion_gmail
GOOGLE_CLIENT_ID=tu_client_id_de_google_cloud
GOOGLE_CLIENT_SECRET=tu_secreto_de_google_cloud
```

## 🚀 Cómo Ejecutar el Sistema

1. Inicia el servidor de Node.js:
```bash
node server.js
```

2. Abre tu navegador web e ingresa a: `http://localhost:3000`
3. Haz clic en **"Conectar mi Google Calendar"** para habilitar la sincronización en la nube.
4. Registra un paciente y agenda su primera cita para comprobar la sincronización y la alerta por correo.
