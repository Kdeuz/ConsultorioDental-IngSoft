-- 1. Creamos la base de datos y le decimos a IntelliJ que la use
CREATE DATABASE IF NOT EXISTS consultorio_dental;
USE consultorio_dental;

-- 2. Tabla principal: Pacientes
CREATE TABLE IF NOT EXISTS pacientes (
                                         id_paciente INT AUTO_INCREMENT PRIMARY KEY,
                                         nombre_completo VARCHAR(150) NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    email VARCHAR(100),
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

-- 3. Tabla secundaria: Citas (vinculada a los pacientes)
CREATE TABLE IF NOT EXISTS citas (
                                     id_cita INT AUTO_INCREMENT PRIMARY KEY,
                                     id_paciente INT NOT NULL,
                                     fecha DATE NOT NULL,
                                     hora TIME NOT NULL,
                                     motivo VARCHAR(255) NOT NULL,
    estado VARCHAR(50) DEFAULT 'Programada',
    -- Esto crea la relación: una cita siempre pertenece a un paciente que existe
    FOREIGN KEY (id_paciente) REFERENCES pacientes(id_paciente) ON DELETE CASCADE
    );