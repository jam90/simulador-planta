# Formato de los datos del simulador

Este documento describe todo lo que genera el simulador: telemetría, eventos, inspecciones de calidad, órdenes de fabricación, textos, curva de carga y logs. Es también la **interfaz con los módulos 4 y 5** del curso «Interroga a tu fábrica»: qué datos hay, con qué estructura y dónde están.

Todos los datos son sintéticos. La tarifa eléctrica y los precios son ficticios.

## Dónde está cada cosa

| Canal | Fichero (histórico y vivo) | Topic MQTT (solo vivo) | Formato |
|---|---|---|---|
| Telemetría | `datos/<linea>/<equipo>/telemetria/AAAA-MM-DD.jsonl` | `fabrica/<linea>/<equipo>/telemetria` | JSON, un mensaje por equipo y muestra |
| Eventos | `datos/<linea>/<equipo>/eventos/AAAA-MM-DD.jsonl` | `fabrica/<linea>/<equipo>/eventos` | JSON, un mensaje por suceso |
| Inspecciones | `datos/L1/calidad-01/inspecciones/AAAA-MM-DD.jsonl` | `fabrica/L1/calidad-01/inspecciones` | JSON **anidado**, un mensaje por pieza |
| Órdenes de fabricación | `datos/L1/mes/ordenes/AAAA-MM-DD.jsonl` | `fabrica/L1/mes/ordenes` | JSON **anidado**, un mensaje por orden al cerrarse |
| Textos | `datos/<linea>/textos/AAAA-MM-DD.jsonl` | `fabrica/<linea>/textos` | JSON con un campo `texto` en lenguaje natural |
| Curva de carga | `datos/energia/curva-cuartohoraria-AAAA-MM-DD.csv` | `fabrica/energia/curva` | CSV «a la española» (fichero) / JSON (MQTT) |
| Logs | `datos/logs/<equipo>.log` | — | Texto plano, un formato por tipo de equipo |

- Cada equipo tiene **su propia carpeta**, que copia su topic MQTT: lo que llega a `fabrica/L1/cnc-01/telemetria` se guarda en `datos/L1/cnc-01/telemetria/`. Así se puede trabajar con un solo equipo, como si cada dato viniera de un sitio distinto (igual que en una planta real). Para leerlo todo junto, basta un comodín: `datos/*/*/telemetria/*.jsonl`.
- Solo tienen carpeta `eventos` los equipos que generan eventos (ver [Eventos](#eventos)).
- Con `salidas.jsonl.agrupar: canal` en `planta.yaml`, los ficheros se agrupan como antes, todos los equipos juntos: `datos/telemetria/`, `datos/eventos/`, `datos/inspecciones/`, `datos/ordenes/` y `datos/textos/`.

- Los ficheros **JSON Lines** (`.jsonl`) tienen un objeto JSON completo en cada línea.
- El nombre del fichero usa la **fecha local** (Europe/Madrid). Los `ts` de dentro están en **UTC**: un mensaje de las 01:00 del 9 de octubre (hora local) lleva `ts` `2026-10-08T23:00:00Z` y va en el fichero `2026-10-09.jsonl`.
- Muestreo: cada **5 s** en modo vivo y cada **60 s** en el histórico (se cambia en `config/planta.yaml`).

## Telemetría

Todos los equipos publican la misma estructura:

```json
{"ts": "2026-09-15T08:30:00.000Z", "planta": "demo", "linea": "L1", "equipo": "robot-01",
 "tipo": "robot", "estado": "PRODUCCION",
 "valores": {"programa": "PRG-B200", "modo": "AUTO", "servo_activo": true, "override_pct": 100,
             "ciclo_s": 41.649, "ciclos_total": 10384, "corriente_eje1_a": 2.563, "...": "...",
             "temp_motor_eje1_c": 33.536, "...": "...", "pinza_cerrada": false, "potencia_kw": 2.545}}
```

| Campo | Significado |
|---|---|
| `ts` | Instante de la muestra, ISO 8601 en UTC con milisegundos |
| `planta`, `linea`, `equipo`, `tipo` | Identificación. Buenas candidatas a `keyword` en Elasticsearch |
| `estado` | Estado del equipo (ver tablas) |
| `valores` | Variables medidas. El nombre acaba en la unidad: `_c` °C, `_kw` kW, `_a` amperios, `_pct` %, `_s` segundos… |

### Estados de la línea

El PLC (`plc-l1`) muestra el estado de la línea. Los robots, la CNC y la estación de calidad muestran el mismo estado, salvo `ESPERA`.

| Estado | Significado |
|---|---|
| `PARADA` | Fuera de turno, descanso o fin de semana |
| `ARRANQUE` | Puesta en marcha: 8–15 min al empezar el turno o tras una parada o avería de más de 1 h; 1–3 min tras una parada corta |
| `PRODUCCION` | Fabricando |
| `MICROPARADA` | Parada corta (30 s – 4 min), por ejemplo, una pieza mal posicionada |
| `AVERIA` | Avería; dura lo que tarda la reparación |
| `MANTENIMIENTO` | Mantenimiento preventivo planificado (viernes de 12:00 a 13:00) |
| `CAMBIO_FORMATO` | Cambio de referencia (15–40 min) |
| `ESPERA` | Solo en robots, CNC y estación de calidad: la línea está parada por otro equipo |

### Variables por equipo

**`plc-l1` (`plc_linea`)**

| Variable | Unidad | Notas |
|---|---|---|
| `modo` | — | `AUTO` / `MANUAL` (en avería y mantenimiento) |
| `turno` | — | `manana`, `tarde` o `sin_turno` |
| `referencia` | — | Producto en fabricación (`REF-A100`, `REF-B200`, `REF-C300`) |
| `piezas_ok_total`, `piezas_nok_total` | piezas | Contadores acumulados desde el inicio de la simulación |
| `velocidad_cinta_m_min` | m/min | 12 en producción, 6 en arranque, 0 parada |
| `temp_armario_c` | °C | Temperatura del armario eléctrico |
| `paro_emergencia` | bool | `true` mientras dura una microparada por paro de emergencia |
| `presion_neumatica_bar` | bar | Presión de aire en la línea (viene del compresor) |
| `codigo_alarma` | — | **Solo aparece** en `MICROPARADA` o `AVERIA` |
| `potencia_kw` | kW | |

**`robot-01` y `robot-02` (`robot`)**

| Variable | Unidad | Notas |
|---|---|---|
| `programa` | — | Depende de la referencia (`PRG-A100`…) |
| `modo` | — | `AUTO` / `MANUAL` |
| `servo_activo` | bool | Motores con par (el robot puede moverse) |
| `override_pct` | % | Velocidad programada: 100 (50 en arranque) |
| `ciclo_s` | s | Duración del último ciclo |
| `ciclos_total` | ciclos | Contador acumulado |
| `corriente_eje1_a` … `corriente_eje6_a` | A | 0 con los servos apagados |
| `temp_motor_eje1_c` … `temp_motor_eje6_c` | °C | Suben despacio en producción y se enfrían en las paradas |
| `pinza_cerrada` | bool | **Solo en `robot-01`**. Cambia unas 160 veces por hora en producción |
| `potencia_kw` | kW | |

En `robot-02` (soldadura), la **corriente del eje 3 crece un 3 % al día**. Al llegar a 1,4 veces el valor nominal, provoca la avería `E-260`. Con ella también suben la temperatura del motor del eje 3, el tiempo de ciclo, el consumo y el porcentaje de piezas defectuosas. Tras la reparación vuelve al valor normal.

**`cnc-01` (`cnc`)**

| Variable | Unidad | Notas |
|---|---|---|
| `programa`, `herramienta_id` | — | `herramienta_id` cambia en cada cambio de herramienta (`H-0001`, `H-0002`…) |
| `rpm_husillo` | rpm | ~8000 mientras mecaniza, 0 si no |
| `carga_husillo_pct` | % | Sube con el desgaste de la herramienta |
| `vibracion_mm_s` | mm/s | Valor eficaz (RMS); sube con el desgaste |
| `temp_husillo_c` | °C | |
| `desgaste_herramienta_pct` | % | Crece con cada pieza; se cambia la herramienta al llegar al 92–100 % |
| `nivel_refrigerante_pct` | % | Baja despacio; se repone al 20 % y en el mantenimiento preventivo |
| `potencia_kw` | kW | |

Con el desgaste por encima del 80 % aumentan las piezas defectuosas.

**`calidad-01` (`inspeccion`).** Estación de inspección al final de la línea. Muestra el estado de la línea, como los robots. Las medidas de cada pieza van aparte, en el canal [Inspecciones](#inspecciones-de-calidad).

| Variable | Unidad | Notas |
|---|---|---|
| `piezas_inspeccionadas_total` | piezas | Contador acumulado. Coincide con `piezas_ok_total` + `piezas_nok_total` del PLC |
| `piezas_nok_total` | piezas | Contador acumulado. Coincide con `piezas_nok_total` del PLC |

**`compresor-01` (`compresor`).** Estado: `CARGA`, `VACIO` o `PARADO`.

| Variable | Unidad | Notas |
|---|---|---|
| `presion_bar` | bar | Oscila entre 6,5 y 7,5 bar |
| `caudal_m3_min` | m³/min | Consumo de aire de la planta (incluye fugas) |
| `temp_aceite_c` | °C | |
| `horas_marcha` | h | Contador acumulado |
| `potencia_kw` | kW | ~22 en carga, ~6,6 en vacío, 0 parado |

**`climatizacion-01` (`climatizacion`).** Estado: `CALOR`, `FRIO`, `VENTILACION` o `APAGADO` (fuera de turno). Variables: `consigna_c` y `potencia_kw`.

**`iluminacion-01` (`iluminacion`).** Estado: `ENCENDIDA` o `EMERGENCIA`. Variables: `nivel_pct` (baja con la luz natural) y `potencia_kw`.

**`ambiente-01` (`ambiente`).** Variables: `temp_nave_c`, `humedad_nave_pct`, `temp_exterior_c` y `humedad_exterior_pct`.

**`fv-01` (`fotovoltaica`).** Estado: `PRODUCIENDO`, `ESPERA` (de noche) o `FALLO`.

| Variable | Unidad | Notas |
|---|---|---|
| `irradiancia_w_m2` | W/m² | Sol según hora y día del año, con días despejados, nubosos y cubiertos |
| `potencia_generada_kw` | kW | Instalación de 100 kWp |
| `energia_generada_kwh` | kWh | Contador acumulado (empieza con la lectura de una instalación con años) |
| `temp_panel_c` | °C | |
| `estado_inversor` | — | `OK` / `FALLO` |

### Energía

Los contadores forman una jerarquía:

```
contador-general (acometida)
├── red-l1  -> plc-l1, robot-01, robot-02, cnc-01
├── red-sg  -> compresor-01, climatizacion-01, iluminacion-01
└── (resta la generación de fv-01)
```

Cada analizador suma lo que mide más un 1,5 % de pérdidas. Por eso, en incrementos, se cumple: importada − exportada ≈ (`red-l1` + `red-sg`) − fotovoltaica.

**`red-l1`, `red-sg` (`analizador_red`)**

| Variable | Unidad |
|---|---|
| `tension_l1_v`, `tension_l2_v`, `tension_l3_v` | V (fase-neutro) |
| `corriente_l1_a`, `corriente_l2_a`, `corriente_l3_a` | A |
| `frecuencia_hz` | Hz |
| `thd_tension_pct`, `thd_corriente_pct` | % (distorsión armónica) |
| `factor_potencia` | — |
| `potencia_activa_kw`, `potencia_reactiva_kvar`, `potencia_aparente_kva` | kW, kvar, kVA |
| `energia_activa_kwh`, `energia_reactiva_kvarh` | Contadores acumulados desde el inicio de la simulación |

**`contador-general` (`contador_general`)**: las mismas magnitudes eléctricas, más estas:

| Variable | Unidad | Notas |
|---|---|---|
| `potencia_activa_kw` | kW | **Neta**: positiva si importa de la red, negativa si exporta |
| `potencia_importada_kw`, `potencia_exportada_kw` | kW | Siempre ≥ 0 |
| `energia_importada_kwh`, `energia_exportada_kwh` | kWh | Contadores acumulados (empiezan con una lectura alta, como un contador real) |
| `energia_reactiva_kvarh` | kvarh | Contador acumulado |
| `periodo_tarifario` | — | `P1` … `P6` (horarios ficticios, en `planta.yaml`) |
| `precio_eur_kwh` | €/kWh | Ficticio |
| `coste_acumulado_eur` | € | Coste de la energía importada **desde el inicio de la simulación** |
| `ingresos_excedentes_eur` | € | Valor de la energía exportada |
| `potencia_media_15min_kw` | kW | Media del último cuarto de hora cerrado |
| `maximetro_kw` | kW | Máxima potencia cuartohoraria del mes |
| `potencia_contratada_kw` | kW | Según el periodo |

Con mucho sol y poco consumo, la planta exporta y el `factor_potencia` del contador general baja mucho. Es lo que ocurre de verdad en plantas con autoconsumo.

**Cálculos que no da el simulador y pueden hacer los alumnos:** energía por pieza, OEE, coste por línea o por turno, consumo fuera de turno.

## Eventos

```json
{"ts": "2026-09-23T04:13:22.701Z", "planta": "demo", "linea": "L1", "equipo": "robot-02", "tipo": "robot",
 "tipo_evento": "averia_inicio", "severidad": "error", "codigo": "E-260",
 "mensaje": "robot-02: Sobrecorriente en el eje 3",
 "datos": {"descripcion": "Sobrecorriente en el eje 3", "referencia": "REF-B200"}}
```

| `tipo_evento` | Equipo | Contenido de `datos` |
|---|---|---|
| `cambio_estado` | `plc-l1` | `anterior`, `nuevo`, `causa` (equipo), `duracion_prevista_s` |
| `alarma` | línea, compresor | `descripcion`, `duracion_prevista_s` (microparadas) o `presion_bar` |
| `averia_inicio` | línea, `fv-01` | `descripcion`, `referencia` |
| `averia_fin` | línea, `fv-01` | `descripcion`, `accion`, `inicio`, `duracion_min` |
| `cambio_referencia` | `plc-l1` | `anterior`, `nueva` |
| `cambio_herramienta` | `cnc-01` | `anterior`, `nueva` |
| `reposicion_refrigerante` | `cnc-01` | — |
| `cambio_senal` | `robot-01` | `senal` (`pinza_cerrada`), `valor` |
| `exceso_potencia` | `contador-general` | `potencia_media_kw`, `contratada_kw`, `periodo` |

`severidad`: `info`, `aviso` o `error`. Primera letra del código: `I` información, `W` aviso, `E` avería. La lista completa de códigos está en `simulador/catalogo.py`. Cada robot tiene las averías y microparadas comunes más las de su herramienta (`herramienta` en `planta.yaml`): `robot-01` las de pinza (W-210, W-211, E-214) y `robot-02` las de soldadura (W-220, W-221, E-245, E-246).

`cambio_senal` registra la hora exacta de cada cambio de la pinza, aunque el muestreo de la telemetría sea más lento.

## Inspecciones de calidad

La estación `calidad-01` mide **todas las piezas** y publica un mensaje por pieza, con un array de medidas:

```json
{"ts": "2026-09-23T07:13:29.590Z", "planta": "demo", "linea": "L1", "equipo": "calidad-01", "tipo": "inspeccion",
 "pieza_id": "L1-20260923-00001", "orden_id": "OF-2026-0047", "referencia": "REF-B200", "turno": "manana", "resultado": "OK",
 "medidas": [
   {"cota": "diametro_agujero", "valor": 13.994, "nominal": 14.0, "tol_min": -0.02, "tol_max": 0.02,
    "desviacion": -0.006, "unidad": "mm", "resultado": "OK"},
   {"cota": "longitud", "valor": 149.957, "nominal": 150.0, "tol_min": -0.1, "tol_max": 0.1,
    "desviacion": -0.043, "unidad": "mm", "resultado": "OK"},
   {"cota": "garganta_soldadura", "valor": 3.97, "nominal": 4.0, "tol_min": -0.3, "tol_max": 0.3,
    "desviacion": -0.03, "unidad": "mm", "resultado": "OK"},
   {"cota": "dureza_soldadura", "valor": 199.0, "nominal": 200, "tol_min": -25, "tol_max": 25,
    "desviacion": -1.0, "unidad": "HV", "resultado": "OK"}]}
```

| Campo | Significado |
|---|---|
| `pieza_id` | `<linea>-<AAAAMMDD>-<número>`; el número vuelve a 1 cada día (fecha local). Único |
| `orden_id` | Orden de fabricación a la que pertenece la pieza (ver [Órdenes de fabricación](#órdenes-de-fabricación)) |
| `referencia`, `turno` | Producto y turno en el momento de la inspección |
| `resultado` | `OK` o `NOK`. Es `NOK` si **alguna** medida es `NOK` |
| `medidas[].cota` | Qué se mide (ver tabla) |
| `medidas[].valor`, `nominal` | Valor medido y valor teórico |
| `medidas[].tol_min`, `tol_max` | Tolerancia respecto al nominal: la cota es buena si `tol_min ≤ desviacion ≤ tol_max` |
| `medidas[].desviacion` | `valor − nominal` |
| `medidas[].unidad` | `mm` o `HV` (dureza Vickers) |
| `medidas[].resultado` | `OK` o `NOK` |

| Cota | Nominal | Tolerancia | Equipo que la estropea |
|---|---|---|---|
| `diametro_agujero` | 12 / 14 / 16 mm (`REF-A100` / `B200` / `C300`) | ± 0,02 mm | `cnc-01` |
| `longitud` | 120 / 150 / 180 mm | ± 0,1 mm | `cnc-01` |
| `garganta_soldadura` | 4 mm | ± 0,3 mm | `robot-02` |
| `dureza_soldadura` | 200 HV | ± 25 HV | `robot-02` |

**Relación con el resto de la planta:**

- **Coincide con el PLC:** cada pieza que el PLC cuenta en `piezas_ok_total` o `piezas_nok_total` tiene su inspección con el mismo resultado.
- **Defectos con causa:** si una pieza es defectuosa, falla al menos una cota (a veces dos). Si la herramienta de la CNC está gastada (`desgaste_herramienta_pct` > 80), fallan sobre todo el diámetro y la longitud. Si `robot-02` está degradado, fallan sobre todo las de soldadura.
- **Deriva visible en las piezas buenas:** con el desgaste de la herramienta, el diámetro se va acercando al límite inferior; con la degradación de `robot-02`, la garganta de soldadura se acerca al superior.

**Para qué sirve en los cursos:**

- **InfluxDB** (no aplica: no hay curso de InfluxDB; se deja como referencia): buenas candidatas a *tag*: `linea`, `referencia`, `cota`, `resultado`, `unidad`. A *field*: `valor`, `desviacion`. `pieza_id` debe ser field, no tag: hay un valor distinto por pieza (cardinalidad alta). `orden_id` es un término medio (unas pocas órdenes al día): como tag permite comparar órdenes. Hay que «aplanar» el mensaje y escribir un punto por cota.
- **Elasticsearch:** `medidas` es un array de objetos. Si no se declara como `nested`, Elasticsearch mezcla los campos de las distintas medidas. Una búsqueda de `cota: diametro_agujero` y `resultado: NOK` devuelve también las piezas con el diámetro bien y otra cota mal. En 30 días de histórico hay 200 piezas con el diámetro mal y 524 que saldrían por error.

## Órdenes de fabricación

Las publica el **MES** de la línea (`mes`), que es un origen de datos más, no una máquina: no tiene telemetría. Cada orden fabrica una cantidad de piezas de una referencia y se publica **al cerrarse**:

- `completada`: se han fabricado las piezas planificadas (entre 200 y 600, en múltiplos de 50).
- `cambio_referencia`: la línea cambia de referencia antes de completarla.

```json
{"ts": "2026-09-01T08:34:11.025Z", "planta": "demo", "linea": "L1", "equipo": "mes", "tipo": "orden_fabricacion",
 "orden_id": "OF-2026-0001", "referencia": "REF-A100", "estado": "CERRADA", "motivo_cierre": "completada",
 "inicio": "2026-09-01T04:09:04.589Z", "fin": "2026-09-01T08:34:11.025Z",
 "cantidad_planificada": 300, "piezas_ok": 293, "piezas_nok": 7,
 "materiales": [
   {"material": "barra_acero_s275", "cantidad_prevista": 234.0, "cantidad_real": 240.6, "unidad": "kg", "lotes": ["AC-2609-01"]},
   {"material": "tornillo_m8x20", "cantidad_prevista": 1200, "cantidad_real": 1212, "unidad": "ud", "lotes": ["TO-2609-01"]},
   {"material": "hilo_soldadura", "cantidad_prevista": 7.2, "cantidad_real": 8.6, "unidad": "kg", "lotes": ["HS-2609-01"]},
   {"material": "gas_proteccion", "cantidad_prevista": 1080, "cantidad_real": 1301, "unidad": "L", "lotes": ["GP-2609-01"]}]}
```

| Campo | Significado |
|---|---|
| `orden_id` | `OF-<año>-<número>`. Único |
| `referencia` | Producto de la orden |
| `estado` | Siempre `CERRADA` (solo se publican al cerrarse) |
| `motivo_cierre` | `completada` o `cambio_referencia` |
| `inicio`, `fin` | Primera pieza y cierre, en UTC. `fin` coincide con `ts` |
| `cantidad_planificada` | Piezas que debía fabricar |
| `piezas_ok`, `piezas_nok` | Piezas fabricadas. Coinciden con las inspecciones de esa `orden_id` |
| `materiales[].material` | Material consumido (ver tabla) |
| `materiales[].cantidad_prevista` | Consumo estándar según la lista de materiales × piezas fabricadas |
| `materiales[].cantidad_real` | Consumo real: el estándar más mermas |
| `materiales[].unidad` | `kg`, `ud` (unidades) o `L` (litros) |
| `materiales[].lotes` | Lotes del proveedor usados en la orden (uno o varios) |

| Material | Unidad | Consumo estándar por pieza | Notas |
|---|---|---|---|
| `barra_acero_s275` | kg | 0,78 / 0,95 / 1,2 (`REF-A100` / `B200` / `C300`) | |
| `tornillo_m8x20` | ud | 4 | |
| `hilo_soldadura` | kg | 0,024 | Con `robot-02` degradado se gasta más |
| `gas_proteccion` | L | 3,6 | Con `robot-02` degradado se gasta más |

**Relación con el resto de la planta:**

- **Piezas:** las de cada orden coinciden con las inspecciones que llevan su `orden_id`. Con el PLC cuadran en el total, no por orden.
- **Trazabilidad:** pieza (`pieza_id`) → orden (`orden_id`) → lotes de material.
- **Ritmo:** 30 días de histórico dan 63 órdenes. La orden en curso al terminar la simulación no se publica, así que sus piezas tienen un `orden_id` que no aparece en las órdenes.
- **Cálculos que pueden hacer los alumnos:** desviación de consumo (real − prevista) por orden o material, rechazo por orden, y si las órdenes con más desviación coinciden con la degradación de `robot-02`.

**Para qué sirve en los cursos (Elasticsearch):** es el caso de la receta. Cada material tiene su cantidad y su unidad, y solo tienen sentido juntos. Sin `nested`, Elasticsearch guarda por separado la lista de materiales, la de cantidades y la de unidades. Una búsqueda de `material: hilo_soldadura` y `cantidad_real > 100` devuelve 62 de las 63 órdenes (porque los tornillos o el gas superan 100), aunque el hilo nunca pasa de unos pocos kg. Con `nested` en el mapping y en la consulta, no devuelve ninguna.

## Textos en lenguaje natural

Se generan con plantillas (`simulador/textos/plantillas.yaml`) **a partir de los eventos**, así que siempre coinciden con la telemetría. Hay dos tipos:

- **`parte_mantenimiento`**: uno por cada avería, al terminar la reparación.
- **`nota_turno`**: uno por línea al terminar cada turno.

```json
{"ts": "2026-09-23T07:00:52.637Z", "planta": "demo", "linea": "L1", "tipo_texto": "parte_mantenimiento",
 "texto": "Parte de mantenimiento 00014. Aviso a mantenimiento por la alarma E-260 en robot-02 a las 06:13 del 23/09/2026. Diagnóstico: sobrecorriente en el eje 3. Se realiza: sustitución del reductor del eje 3. Fin de la intervención a las 09:00 (168 min). El operario comenta que el robot llevaba unos días algo más lento y con el motor del eje 3 más caliente de lo normal.",
 "equipo": "robot-02", "codigo": "E-260", "turno": "manana",
 "datos": {"inicio": "...", "fin": "...", "duracion_min": 167.5, "descripcion": "...", "accion": "..."}}
```

```json
{"ts": "2026-09-23T12:00:00.000Z", "planta": "demo", "linea": "L1", "tipo_texto": "nota_turno", "turno": "manana",
 "texto": "Nota del turno de mañana del 23/09/2026 (línea L1). Producción: 304 piezas OK y 7 NOK, un 2,3 % de rechazo. Referencia en fabricación: REF-B200. Se registraron estas averías: robot-02 (E-260, sobrecorriente en el eje 3, 168 min). Microparadas: 15 (unos 34 min en total). La causa más frecuente fue «Viruta acumulada en la zona de trabajo». Cambios de herramienta en la CNC: 1. Consumo eléctrico de la planta: 323 kWh (1,06 kWh por pieza buena); la fotovoltaica generó 156 kWh. La línea queda preparada para el siguiente turno.",
 "datos": {"inicio": "...", "fin": "...", "piezas_ok": 304, "piezas_nok": 7, "averias": 1, "microparadas": 15,
           "consumo_kwh": 323.0, "fv_kwh": 156.2}}
```

En los textos, las horas son **locales**; el `ts` está en UTC. El campo `datos` repite las cifras del texto de forma estructurada, para poder comprobar las respuestas.

## Curva de carga cuartohoraria (CSV)

Imita el fichero que facilita la distribuidora: separador `;`, **coma decimal**, fecha `dd/mm/aaaa` y hora local.

```
fecha;hora_inicio;hora_fin;periodo;energia_importada_kwh;energia_exportada_kwh;potencia_media_kw;coste_eur
10/09/2026;00:00;00:15;P6;2,884;0,0;11,53;0,2595
10/09/2026;10:00;10:15;P3;0,694;0,914;2,78;0,1041
```

`potencia_media_kw` = energía importada en el cuarto × 4. Por MQTT llega lo mismo en JSON, con `ts_inicio`/`ts_fin` en UTC y punto decimal.

En el modo vivo, si el simulador arranca a mitad de un cuarto de hora, ese primer cuarto incompleto no se publica.

## Logs de texto

Un fichero por equipo con eventos. Cada tipo de equipo usa un formato distinto y la **hora local sin zona horaria**, como los equipos reales. No incluyen los cambios de la pinza.

```
plc-l1.log            2026-09-01 08:27:17.190 | WARN  | L1 | W-100 | Paro de emergencia pulsado
robot-02.log          02/09/2026 16:32:22 ROBOT-02 [FAULT] E-246: Atasco del hilo en el alimentador
cnc-01.log            [2026-09-01T07:32:53+02:00] CNC-01 WARNING code=W-312 msg="Viruta acumulada en la zona de trabajo"
contador-general.log  (mismo formato que el PLC)
```

## Dato sucio

Desactivado por defecto. Se activa en `planta.yaml` (`dato_sucio.activo: true`), desde la web o usando `config/planta-sucio.yaml`, que es igual que `planta.yaml` pero con el dato sucio activado (`--config config/planta-sucio.yaml --salida datos-sucios`). Solo cambia lo que se publica, no la simulación.

| Defecto | Qué se ve |
|---|---|
| Nulo | Una variable con valor `null` |
| Atípico | Un valor ×10, negativo o `99999.0` |
| Duplicado | El mismo mensaje dos veces |
| Formato de fecha | `ts` como `"15/09/2026 10:30:00"` (hora local, sin zona). En ficheros va a `fecha-desconocida.jsonl` dentro de la carpeta del equipo |
| Reinicio de contador | Un contador acumulado vuelve a 0 y sigue contando desde ahí |
| Rebote | En `cambio_senal`, dos cambios extra a pocos milisegundos |
