from .base import Equipo, EquipoLinea
from .cnc import Cnc
from .compresor import Compresor
from .energia import AnalizadorRed, ContadorGeneral
from .inspeccion import Inspeccion
from .mes import Mes
from .plc_linea import PlcLinea
from .robot import Robot
from .servicios import Ambiente, Climatizacion, Fotovoltaica, Iluminacion

# tipo (en planta.yaml) -> clase. El orden fija en qué orden se calculan los
# servicios: cada uno puede usar los anteriores (los medidores, al final).
TIPOS = {
    "plc_linea": PlcLinea,
    "robot": Robot,
    "cnc": Cnc,
    "inspeccion": Inspeccion,
    "mes": Mes,
    "compresor": Compresor,
    "climatizacion": Climatizacion,
    "ambiente": Ambiente,
    "iluminacion": Iluminacion,
    "fotovoltaica": Fotovoltaica,
    "analizador_red": AnalizadorRed,
    "contador_general": ContadorGeneral,
}
ORDEN = {tipo: i for i, tipo in enumerate(TIPOS)}
