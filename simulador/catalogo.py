"""Catálogo de códigos de alarma y averías (inventados, con fines didácticos).

Formato del código: letra de severidad + número.
  I = información, W = aviso (warning), E = error/avería.
"""

MICROPARADAS = {
    "plc_linea": [
        ("W-101", "Pieza mal posicionada en la cinta"),
        ("W-102", "Atasco en la cinta de entrada"),
        ("W-105", "Barrera de seguridad interrumpida"),
        ("W-100", "Paro de emergencia pulsado"),
    ],
    "robot": [                      # comunes a todos los robots (más las de su herramienta)
        ("W-215", "Zona de trabajo ocupada"),
    ],
    "cnc": [
        ("W-310", "Puerta de la máquina abierta"),
        ("W-312", "Viruta acumulada en la zona de trabajo"),
        ("W-315", "Pieza no amarrada correctamente"),
    ],
}

# (código, descripción, acción de reparación)
AVERIAS = {
    "plc_linea": [
        ("E-120", "Fallo del variador de la cinta", "Rearme y revisión del variador de la cinta"),
        ("E-125", "Sensor de entrada sucio o desalineado", "Limpieza y ajuste del sensor de entrada"),
    ],
    "robot": [                      # comunes a todos los robots (más las de su herramienta)
        ("E-230", "Error de comunicación con el controlador", "Reinicio del controlador y revisión del cable de comunicación"),
        ("E-241", "Colisión detectada", "Inspección de la herramienta y recalibración del punto de trabajo"),
    ],
    "cnc": [
        ("E-320", "Alarma de lubricación del husillo", "Reposición de lubricante y purga del circuito"),
        ("E-331", "Fallo del cambiador de herramienta", "Ajuste del cambiador de herramienta"),
        ("E-340", "Sobretemperatura del husillo", "Limpieza del circuito de refrigeración del husillo"),
    ],
    "fotovoltaica": [
        ("E-510", "Fallo del inversor", "Rearme del inversor y revisión de protecciones"),
    ],
}

# Según la herramienta del robot (parámetro `herramienta` en planta.yaml)
MICROPARADAS_HERRAMIENTA = {
    "pinza": [
        ("W-210", "Pieza no detectada en la pinza"),
        ("W-211", "Reintento de agarre"),
    ],
    "soldadura": [
        ("W-220", "Fallo de encendido del arco"),
        ("W-221", "Limpieza automática de la antorcha"),
    ],
}
AVERIAS_HERRAMIENTA = {
    "pinza": [
        ("E-214", "Fallo de pinza: sensor de presencia", "Sustitución del sensor de presencia de la pinza"),
    ],
    "soldadura": [
        ("E-245", "Boquilla de la antorcha obstruida", "Limpieza y sustitución de la boquilla de la antorcha"),
        ("E-246", "Atasco del hilo en el alimentador", "Desatasco del alimentador y sustitución de la sirga"),
    ],
}

DEGRADACION = {
    "corriente_eje": ("E-260", "Sobrecorriente en el eje {eje}", "Sustitución del reductor del eje {eje}"),
}

CAMBIO_HERRAMIENTA = ("I-350", "Cambio de herramienta por desgaste")
ROTURA_HERRAMIENTA = ("E-351", "Rotura de herramienta", "Sustitución de la herramienta rota y revisión de la pieza")
PRESION_BAJA = ("W-410", "Presión de la red de aire por debajo del mínimo")
EXCESO_POTENCIA = ("W-600", "Potencia media cuartohoraria superior a la contratada")
