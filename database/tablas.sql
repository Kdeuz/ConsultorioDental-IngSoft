DROP DATABASE IF EXISTS consultorio_dental;
CREATE DATABASE consultorio_dental;
USE consultorio_dental;

CREATE TABLE medicos (
                         id_medico INT AUTO_INCREMENT PRIMARY KEY,
                         nombre_completo VARCHAR(150) NOT NULL,
                         especialidad VARCHAR(100)
);

CREATE TABLE pacientes (
                           id_paciente INT AUTO_INCREMENT PRIMARY KEY,
                           nombre_completo VARCHAR(150) NOT NULL,
                           telefono VARCHAR(20) NOT NULL,
                           email VARCHAR(100),
                           edad INT,
    -- Representa la clase ExpedienteMedico del Diagrama
                           alergias_antecedentes TEXT,
                           fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE citas (
                       id_cita INT AUTO_INCREMENT PRIMARY KEY,
                       id_paciente INT NOT NULL,
                       id_medico INT NOT NULL DEFAULT 1,
                       fecha DATE NOT NULL,
                       hora TIME NOT NULL,
                       tipo_servicio VARCHAR(100) NOT NULL, -- Ej: 'Limpieza Dental'
                       duracion_min INT NOT NULL,
                       motivo VARCHAR(255),
                       estado VARCHAR(50) DEFAULT 'Programada',
                       google_event_id VARCHAR(255), -- Para la API de Google Calendar
                       FOREIGN KEY (id_paciente) REFERENCES pacientes(id_paciente) ON DELETE CASCADE,
                       FOREIGN KEY (id_medico) REFERENCES medicos(id_medico) ON DELETE CASCADE
);

CREATE TABLE usuarios (
    id_usuario INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    nombre VARCHAR(100),
    rol ENUM('Administrador', 'Dentista', 'Recepcionista') DEFAULT 'Recepcionista'
);

INSERT INTO medicos (nombre_completo, especialidad) VALUES ('Dra. Ana Pajarito', 'Odontología General');
INSERT INTO usuarios (username, password_hash, rol, nombre) VALUES ('admin', 'hash_seguro_aqui', 'Administrador'),('doctora_ana', 'hash_seguro_aqui', 'Dentista');