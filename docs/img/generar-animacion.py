"""Animación pixel art de la planta para el README (docs/img/planta.gif).

Uso (necesita Pillow: pip install pillow):
    python docs/img/generar-animacion.py [salida.gif]
"""
import math, random, sys
from pathlib import Path
from PIL import Image, ImageDraw

W, H, ESCALA = 192, 108, 4
FRAMES, CICLO = 60, 20          # 3 ciclos de la línea; la cinta avanza 10 frames y para 10
SALIDA = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).with_name("planta.gif"))

C = dict(
    pared=(52, 61, 82), pared2=(44, 52, 70), zocalo=(34, 40, 55),
    suelo=(120, 124, 130), suelo2=(108, 112, 118), amarillo=(240, 196, 40),
    cielo=(140, 196, 236), cielo2=(176, 216, 244), marco=(30, 34, 46), sol=(255, 230, 120),
    lampara=(70, 74, 86), luz=(255, 244, 190),
    cinta=(38, 40, 46), cinta2=(70, 72, 80), chasis=(150, 156, 166), chasis2=(96, 100, 110),
    pieza=(176, 182, 192), pieza2=(124, 130, 140), soporte=(60, 130, 210), soldadura=(230, 120, 40),
    naranja=(232, 112, 32), naranja2=(170, 76, 20), azul=(52, 104, 180), azul2=(32, 66, 120),
    oscuro=(24, 26, 32), gris=(196, 200, 206), gris2=(150, 154, 162),
    verde=(70, 210, 90), rojo=(230, 60, 50), chispa=(255, 250, 200), chispa2=(255, 190, 60),
    piel=(236, 188, 150), casco=(250, 210, 40), chaleco=(250, 140, 30), pantalon=(40, 56, 100),
    pantalla=(40, 160, 110), refrig=(120, 190, 255), blanco=(240, 240, 240),
)

# Fuente de 3x5 para el letrero
FUENTE = {
    "P": ["111", "101", "111", "100", "100"], "L": ["100", "100", "100", "100", "111"],
    "A": ["010", "101", "111", "101", "101"], "N": ["1001", "1101", "1011", "1001", "1001"],
    "T": ["111", "010", "010", "010", "010"], "1": ["010", "110", "010", "010", "111"],
    " ": ["000"] * 5,
}


def texto(d, x, y, s, color):
    for ch in s:
        for j, fila in enumerate(FUENTE[ch]):
            for i, b in enumerate(fila):
                if b == "1":
                    d.point((x + i, y + j), color)
        x += len(FUENTE[ch][0]) + 1


def rect(d, x0, y0, x1, y1, color):
    d.rectangle((x0, y0, x1, y1), fill=color)


def avance(f):
    """Posición de la cinta: avanza 40 px en 10 frames y se para 10."""
    return 40 * (f // CICLO) + 4 * min(f % CICLO, 10)


def interpola(claves, t):
    """Interpolación lineal entre claves (t, x, y) a lo largo de un ciclo."""
    for (t0, x0, y0), (t1, x1, y1) in zip(claves, claves[1:]):
        if t0 <= t <= t1:
            k = (t - t0) / (t1 - t0) if t1 > t0 else 0
            return x0 + (x1 - x0) * k, y0 + (y1 - y0) * k
    return claves[-1][1:]


def brazo(d, hombro, objetivo, l1, l2, color, sombra):
    """Brazo de dos segmentos (cinemática inversa, codo arriba). Devuelve la punta."""
    sx, sy = hombro
    tx, ty = objetivo
    dist = min(math.hypot(tx - sx, ty - sy), l1 + l2 - 0.01)
    base = math.atan2(ty - sy, tx - sx)
    a = math.acos((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist))
    codos = [(sx + l1 * math.cos(base + s * a), sy + l1 * math.sin(base + s * a)) for s in (1, -1)]
    ex, ey = min(codos, key=lambda p: p[1])
    px, py = sx + dist * math.cos(base), sy + dist * math.sin(base)
    d.line((sx, sy, ex, ey), fill=sombra, width=5)
    d.line((sx, sy, ex, ey), fill=color, width=3)
    d.line((ex, ey, px, py), fill=sombra, width=4)
    d.line((ex, ey, px, py), fill=color, width=2)
    rect(d, sx - 3, sy - 3, sx + 3, sy + 3, sombra)
    rect(d, sx - 1, sy - 1, sx + 1, sy + 1, color)
    rect(d, round(ex) - 1, round(ey) - 1, round(ex) + 1, round(ey) + 1, C["oscuro"])
    return round(px), round(py)


def operario(d, x, pie, paso, mira_derecha=True, tableta=False, f=0):
    """Operario de 7x15 px con casco y chaleco; x es el borde izquierdo."""
    y = pie - 14
    rect(d, x + 2, y, x + 4, y, C["casco"])
    rect(d, x + 1, y + 1, x + 5, y + 1, C["casco"])
    rect(d, x + 2, y + 2, x + 4, y + 4, C["piel"])
    ojo = x + 4 if mira_derecha else x + 2
    d.point((ojo, y + 3), C["oscuro"])
    rect(d, x + 1, y + 5, x + 5, y + 9, C["chaleco"])
    rect(d, x + 1, y + 7, x + 5, y + 7, C["amarillo"])
    if tableta:
        rect(d, x + 5, y + 6, x + 7, y + 8, C["oscuro"])
        d.point((x + 6, y + 7), C["pantalla"] if f % 10 < 7 else C["verde"])
    else:
        brazo_x = x + (5 if paso % 2 else 0)
        rect(d, brazo_x, y + 6, brazo_x + 1, y + 8, C["chaleco"])
    if paso % 4 in (1, 3):
        rect(d, x + 2, y + 10, x + 4, y + 13, C["pantalon"])
        rect(d, x + 2, pie, x + 4, pie, C["oscuro"])
    else:
        izq, der = (x + 1, x + 4) if paso % 4 == 0 else (x + 4, x + 1)
        rect(d, x + 2, y + 10, x + 4, y + 11, C["pantalon"])
        rect(d, izq, y + 12, izq + 1, y + 13, C["pantalon"])
        rect(d, der, y + 12, der + 1, y + 13, C["pantalon"])
        d.point((izq, pie), C["oscuro"])
        d.point((der + 1, pie), C["oscuro"])


def fondo(d):
    rect(d, 0, 0, W, 59, C["pared"])
    for x in range(0, W, 16):
        rect(d, x, 0, x, 57, C["pared2"])
    rect(d, 0, 56, W, 59, C["zocalo"])
    rect(d, 0, 60, W, H, C["suelo"])
    for x in range(0, W, 24):
        d.line((x, 60, x - 10, H), fill=C["suelo2"])
    for y in (68, 84):
        d.line((0, y, W, y), fill=C["suelo2"])
    # Pasillo peatonal
    for x in range(0, W, 8):
        rect(d, x, 89, x + 4, 89, C["amarillo"])
        rect(d, x, 106, x + 4, 106, C["amarillo"])
    # Ventanas con el cielo y el sol
    for i, x in enumerate((64, 104, 144)):
        rect(d, x - 1, 7, x + 24, 27, C["marco"])
        rect(d, x, 8, x + 23, 26, C["cielo"])
        rect(d, x, 8, x + 23, 13, C["cielo2"])
        if i == 2:
            d.ellipse((x + 14, 10, x + 20, 16), fill=C["sol"])
        rect(d, x + 11, 8, x + 12, 26, C["marco"])
        rect(d, x, 17, x + 23, 17, C["marco"])
    # Letrero
    rect(d, 6, 10, 47, 20, C["oscuro"])
    rect(d, 7, 11, 46, 19, C["gris"])
    texto(d, 9, 13, "PLANTA L1", C["oscuro"])
    # Lámparas del techo
    for x in (40, 96, 176):
        d.line((x, 0, x, 2), fill=C["lampara"])
        rect(d, x - 4, 3, x + 4, 4, C["lampara"])
        rect(d, x - 3, 5, x + 3, 5, C["luz"])


def cnc(d, f):
    x0, y0, x1, y1 = 8, 34, 50, 78
    rect(d, x0, y0, x1, y1, C["gris"])
    rect(d, x0, y0, x1, y0 + 2, C["gris2"])
    rect(d, x0, y1 - 3, x1, y1, C["oscuro"])
    for x in range(x0, x1, 4):
        rect(d, x, y1 - 3, x + 1, y1, C["amarillo"])
    # Ventana con el husillo girando y el refrigerante
    rect(d, 12, 40, 34, 66, C["oscuro"])
    rect(d, 13, 41, 33, 65, (30, 44, 56))
    rect(d, 21, 41, 25, 47, C["gris2"])
    trabajando = f % CICLO >= 10
    baja = 4 if trabajando else 0
    for j in range(48, 52 + baja):
        d.point((23, j), C["gris"] if (j + f) % 2 else C["gris2"])
    if trabajando:
        for k in range(3):
            d.point((22 - k + (f % 2), 54 + baja + ((f + 2 * k) % 6)), C["refrig"])
    rect(d, 16, 58, 30, 61, C["chasis2"])
    rect(d, 20, 56, 26, 57, C["pieza"])
    d.line((13, 41, 18, 41), fill=(70, 90, 110))
    # Panel de control
    rect(d, 37, 40, 47, 56, C["oscuro"])
    rect(d, 38, 41, 46, 47, C["pantalla"])
    for j, largo in enumerate((6, 4, 5)):
        largo = (largo + f // 3 + j) % 7 + 1
        rect(d, 39, 42 + 2 * j, 38 + largo, 42 + 2 * j, C["verde"])
    for i, c in enumerate((C["verde"], C["amarillo"], C["rojo"])):
        d.point((39 + 3 * i, 50), c)
    rect(d, 38, 53, 46, 54, C["gris2"])
    # Baliza de estado
    rect(d, 44, 26, 46, 33, C["oscuro"])
    d.point((45, 27), (90, 30, 30))
    d.point((45, 29), (90, 80, 20))
    rect(d, 44, 31, 46, 32, C["verde"])


def cinta(d, f):
    pos = avance(f)
    rect(d, 46, 72, W, 73, C["cinta"])
    for x in range(46 + pos % 8, W, 8):
        rect(d, x, 72, x + 1, 72, C["cinta2"])
    rect(d, 46, 74, W, 77, C["chasis"])
    rect(d, 46, 77, W, 77, C["chasis2"])
    for x in range(56, W, 24):
        rect(d, x, 78, x + 1, 86, C["chasis2"])
        rect(d, x - 1, 87, x + 2, 87, C["oscuro"])


def piezas(d, f):
    pos = avance(f) % 40
    fase = f % CICLO
    for k in range(5):
        x = 50 + pos + 40 * k
        if x > W:
            continue
        rect(d, x, 67, x + 6, 71, C["pieza2"])
        rect(d, x, 67, x + 6, 68, C["pieza"])
        # El robot-01 coloca el soporte; el robot-02 lo suelda
        con_soporte = x > 90 or (x == 90 and fase >= 15)
        soldada = x > 130 or (x == 130 and fase >= 16)
        if con_soporte:
            rect(d, x + 2, 64, x + 4, 66, C["soporte"])
        if soldada:
            d.point((x + 1, 66), C["soldadura"])
            d.point((x + 5, 66), C["soldadura"])


def pedestal(d, x, color, sombra):
    rect(d, x - 6, 69, x + 6, 71, C["oscuro"])
    rect(d, x - 4, 64, x + 4, 68, sombra)
    rect(d, x - 3, 64, x + 3, 67, color)
    rect(d, x - 3, 60, x + 3, 63, sombra)


def robot_manipulador(d, f):
    """robot-01: coge un soporte del alimentador y lo coloca sobre la pieza."""
    base, fase = 84, f % CICLO
    rect(d, 64, 60, 74, 66, C["chasis2"])
    rect(d, 65, 58, 73, 59, C["soporte"])
    claves = [(0, 86, 46), (4, 69, 56), (6, 69, 50), (10, 90, 46),
              (13, 93, 59), (15, 93, 61), (17, 93, 52), (20, 86, 46)]
    punta = interpola(claves, fase)
    px, py = brazo(d, (base, 59), punta, 14, 12, C["naranja"], C["naranja2"])
    rect(d, px - 2, py, px + 2, py, C["oscuro"])
    d.point((px - 2, py + 1), C["oscuro"])
    d.point((px + 2, py + 1), C["oscuro"])
    if 4 <= fase < 15:
        rect(d, px - 1, py + 1, px + 1, py + 3, C["soporte"])


def robot_soldador(d, f):
    """robot-02: suelda la pieza mientras la cinta está parada."""
    base, fase = 124, f % CICLO
    claves = [(0, 126, 46), (10, 126, 46), (12, 133, 60), (16, 135, 60), (18, 128, 48), (20, 126, 46)]
    punta = interpola(claves, fase)
    px, py = brazo(d, (base, 59), punta, 14, 12, C["azul"], C["azul2"])
    d.line((px, py, px + 1, py + 3), fill=C["oscuro"])
    if 12 <= fase <= 16:
        rnd = random.Random(f)
        tip = (px + 1, py + 4)
        d.point(tip, C["blanco"])
        for _ in range(7):
            dx, dy = rnd.randint(-5, 5), rnd.randint(-5, 1)
            d.point((tip[0] + dx, tip[1] + dy), rnd.choice((C["chispa"], C["chispa2"])))


def calidad(d, f):
    """calidad-01: pórtico con cámara; una de cada tres piezas sale NOK."""
    fase = f % CICLO
    nok = (f // CICLO) % 3 == 2
    rect(d, 164, 50, 165, 71, C["gris2"])
    rect(d, 182, 50, 183, 71, C["gris2"])
    rect(d, 164, 48, 183, 51, C["gris"])
    rect(d, 170, 52, 177, 56, C["oscuro"])
    d.point((173, 56), C["rojo"])
    if 11 <= fase <= 15:
        y = 57 + (fase - 11) * 2
        d.line((168, y + 4, 179, y + 4), fill=C["rojo"])
    color = C["rojo"] if nok and fase >= 15 else C["verde"]
    rect(d, 172, 44, 175, 47, C["oscuro"])
    rect(d, 173, 45, 174, 46, color)


def baliza_linea(d):
    rect(d, 186, 40, 188, 71, C["chasis2"])
    rect(d, 185, 34, 189, 39, C["oscuro"])
    rect(d, 186, 37, 188, 38, C["verde"])


def frame(f):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    fondo(d)
    pedestal(d, 84, C["naranja"], C["naranja2"])
    pedestal(d, 124, C["azul"], C["azul2"])
    baliza_linea(d)
    cinta(d, f)
    piezas(d, f)
    cnc(d, f)
    calidad(d, f)
    robot_manipulador(d, f)
    robot_soldador(d, f)
    # Operario que pasea por el pasillo (ida y vuelta en 60 frames)
    t = f / FRAMES
    x = 56 + round(64 * (2 * t if t < 0.5 else 2 - 2 * t))
    operario(d, x, 103, f, mira_derecha=t < 0.5)
    # Operaria con tableta junto al control de calidad
    operario(d, 156, 103, 1, mira_derecha=True, tableta=True, f=f)
    # Técnico junto a la CNC
    operario(d, 28, 103, 1, mira_derecha=False)
    return img.resize((W * ESCALA, H * ESCALA), Image.NEAREST)


imgs = [frame(f).convert("P", palette=Image.ADAPTIVE, colors=64) for f in range(FRAMES)]
imgs[0].save(SALIDA, save_all=True, append_images=imgs[1:], duration=100, loop=0, optimize=True)
print("Animación guardada en", SALIDA)
