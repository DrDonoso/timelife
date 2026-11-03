"""Demo data for local development: the children Lucía and Mateo with avatars and about 80
milestones (March 2024 to October 2026) with generated photos.

``python -m timelife.demo [--reset] [--events N]`` reads the same settings as the app (environment
or ``.env``), refuses to run unless ALLOW_INSECURE_LOCAL_LOGIN is enabled (local development
only) and seeds the default categories first. Idempotent: nothing happens while the demo children
exist, unless ``--reset``, which first deletes EVERY event and child with their images.
Deterministic: the same milestones and pictures on every run. Pictures go through the upload
pipeline (``media.process_upload``/``store_files``) and events through ``events.insert_event``,
so demo data obeys the same rules as data entered in the app."""

import argparse
import asyncio
import colorsys
import datetime as dt
import io
import math
import os
import random
import shutil
import sys
import uuid
from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from zoneinfo import ZoneInfo

from PIL import Image as Pillow
from PIL import ImageChops, ImageDraw, ImageFilter
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from . import media
from .categories import next_position
from .children import attach_avatar, new_slug
from .config import Settings
from .contracts import ChildIn, EventImageIn, EventIn
from .db import Category, Child, Event, Image, create_db_engine, utcnow
from .events import insert_event
from .seed import seed

SEED = 20240310
LOCAL_TIME = ZoneInfo("Europe/Madrid")
JPEG_QUALITY = 85
AVATAR_SIDE = 800
# Colour grades ("light" of the moment) given to photos: golden, rose, teal, lavender, mint,
# peach and sky.
GRADES = (
    (255, 190, 110),
    (255, 160, 185),
    (110, 205, 215),
    (185, 165, 255),
    (160, 230, 175),
    (255, 205, 160),
    (140, 185, 255),
)
# Photo sizes at scale 1 (landscape, portrait, square) and how often each is drawn.
PHOTO_SIZES = (
    ((1600, 1200), 3),
    ((1500, 1000), 2),
    ((1600, 900), 2),
    ((1200, 1600), 3),
    ((1000, 1500), 2),
    ((1200, 1200), 3),
)

Color = tuple[int, int, int]
Size = tuple[int, int]


# Content ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class DemoChild:
    slug: str
    name: str
    birth_date: dt.date
    background: tuple[str, str]
    hair: str
    shirt: str
    pigtails: bool


@dataclass(frozen=True)
class Milestone:
    date: dt.date
    children: tuple[str, ...]  # child slugs
    title: str
    categories: tuple[str, ...]  # category keys, the primary one first
    scene: str
    photos: int
    notes: str = ""
    location: str | None = None
    captions: tuple[str, ...] = ()


CHILDREN = (
    DemoChild(
        "lucia", "Lucía", dt.date(2024, 3, 10), ("#fbcfe8", "#fde68a"), "#5b3a29", "#f472b6", True
    ),
    DemoChild(
        "mateo", "Mateo", dt.date(2025, 9, 18), ("#bae6fd", "#bbf7d0"), "#a0703c", "#60a5fa", False
    ),
)
L, M, BOTH = ("lucia",), ("mateo",), ("lucia", "mateo")
HOSPITAL = "Hospital Materno-Infantil, Madrid"
GRANDPARENTS = "Casa de los abuelos, Segovia"
NURSERY = "Escuela Infantil El Jardín, Madrid"
RETIRO = "Parque del Retiro, Madrid"


def day(value: str) -> dt.date:
    return dt.date.fromisoformat(value)


MILESTONES: tuple[Milestone, ...] = (
    Milestone(day("2024-03-10"), L, "¡Bienvenida, Lucía!", ("general", "social-emotional"),
              "home", 4, "Nació a las 7:42 de la mañana, con 3,2 kg y 49 cm. ¡Por fin estás aquí!",
              HOSPITAL, ("Recién nacida", "Primer abrazo", "Con mamá")),
    Milestone(day("2024-03-13"), L, "Primer día en casa", ("general",), "home", 3,
              "Le enseñamos su habitación y se durmió en el primer minuto.", None,
              ("Llegando a casa", "En su cuna")),
    Milestone(day("2024-03-24"), L, "Primer baño", ("self-care",), "home", 2,
              "Al principio lloró, pero enseguida le encantó el agua calentita.", None,
              ("En la bañera", "Envuelta en la toalla")),
    Milestone(day("2024-04-14"), L, "Primera sonrisa", ("social-emotional",), "home", 3,
              "Una sonrisa de verdad, mirando a papá mientras le cantaba.", None,
              ("La sonrisa", "Mirando a papá")),
    Milestone(day("2024-05-02"), L, "Levanta la cabeza boca abajo", ("gross-motor",), "play", 2,
              "Aguanta unos segundos con la cabeza bien alta en la alfombra de actividades."),
    Milestone(day("2024-05-20"), L, "Primeras carcajadas", ("social-emotional", "language"),
              "home", 1, "Le hacemos pedorretas en la tripa y se parte de risa.", None,
              ("Muerta de risa",)),
    Milestone(day("2024-06-08"), L, "Primer viaje a la playa", ("general",), "beach", 5,
              "Primer viaje largo en coche. Durmió casi todo el camino.",
              "Playa de la Concha, San Sebastián", ("Mirando el mar", "Con el gorrito")),
    Milestone(day("2024-06-15"), L, "Se da la vuelta sola", ("gross-motor",), "play", 1,
              "De boca arriba a boca abajo, ¡y se quedó sorprendidísima!"),
    Milestone(day("2024-06-28"), L, "Agarra el sonajero", ("fine-motor",), "play", 2),
    Milestone(day("2024-07-10"), L, "Duerme toda la noche", ("sleep",), "night", 0,
              "De nueve a siete del tirón. Los papás no se lo creían."),
    Milestone(day("2024-07-22"), L, "Balbucea «ba-ba-ba»", ("language",), "home", 1,
              "Se pasa la mañana charlando con sus peluches."),
    Milestone(day("2024-08-15"), L, "Primer chapuzón en la piscina", ("gross-motor", "general"),
              "beach", 4, "Con manguitos y sin soltar la mano de mamá.", GRANDPARENTS),
    Milestone(day("2024-09-05"), L, "Primera papilla de frutas", ("feeding",), "meal", 4,
              "Plátano, pera y naranja. La cara de la primera cucharada no tiene precio.", None,
              ("La primera cucharada", "Cara de sorpresa")),
    Milestone(day("2024-09-21"), L, "Se sienta sin apoyo", ("gross-motor",), "play", 2),
    Milestone(day("2024-10-02"), L, "Primer diente", ("teething",), "home", 1,
              "Ha salido el incisivo inferior después de unas noches movidas.", None,
              ("El primer diente",)),
    Milestone(day("2024-10-02"), L, "Primera noche en su habitación", ("sleep",), "night", 0,
              "Con el vigilabebés encendido y los papás asomándose cada media hora."),
    Milestone(day("2024-10-15"), L, "Hace la pinza con los dedos", ("fine-motor",), "meal", 2,
              "Coge los guisantes uno a uno con el pulgar y el índice."),
    Milestone(day("2024-10-31"), L, "Primer disfraz", ("social-emotional",), "party", 3,
              "Disfrazada de calabaza para la fiesta del barrio.", None,
              ("La calabaza más bonita",)),
    Milestone(day("2024-11-08"), L, "Gatea por primera vez", ("gross-motor",), "play", 3,
              "Primero hacia atrás y después hacia delante. ¡Ya no hay quien la pare!"),
    Milestone(day("2024-11-20"), L, "Reconoce su nombre", ("cognitive", "language"), "home", 0,
              "Gira la cabeza en cuanto la llamamos, aunque esté jugando."),
    Milestone(day("2024-12-06"), L, "Segundo y tercer diente", ("teething",), "home", 0),
    Milestone(day("2024-12-24"), L, "Primera Nochebuena", ("general", "social-emotional"),
              "christmas", 6, "Toda la familia junta. Se durmió antes del postre.", GRANDPARENTS,
              ("El árbol de Navidad", "Con los abuelos", "La cena")),
    Milestone(day("2025-01-05"), L, "Primeros Reyes Magos", ("general",), "christmas", 4,
              "Le gustó más el papel de regalo que los regalos.", None, ("Abriendo regalos",)),
    Milestone(day("2025-01-18"), L, "Se pone de pie agarrada al sofá", ("gross-motor",), "play",
              2),
    Milestone(day("2025-02-14"), L, "Primera palabra: «mamá»", ("language",), "home", 2,
              "Clarísimo y mirando a mamá. Papá sigue esperando su turno."),
    Milestone(day("2025-02-14"), L, "Aplaude", ("fine-motor", "social-emotional"), "play", 1,
              "Aplaude cada vez que suena su canción favorita."),
    Milestone(day("2025-03-03"), L, "Primer día de guardería", ("academic", "social-emotional"),
              "school", 4,
              "Entró de la mano de la profe sin mirar atrás. Los que lloramos fuimos nosotros.",
              NURSERY, ("La mochila nueva", "En la puerta")),
    Milestone(day("2025-03-10"), L, "¡Primer cumpleaños!", ("general", "social-emotional"),
              "party", 6, "Fiesta con los abuelos, los tíos y los primos.", None,
              ("Soplando la vela", "Con los globos")),
    Milestone(day("2025-03-10"), L, "Primera tarta", ("feeding",), "party", 2,
              "Tarta de zanahoria sin azúcar. Acabó con nata hasta en las cejas."),
    Milestone(day("2025-03-22"), L, "Primeros pasos", ("gross-motor",), "park", 5,
              "Tres pasos solita hasta los brazos de papá.", RETIRO,
              ("¡Primeros pasos!", "De la mano")),
    Milestone(day("2025-04-05"), L, "Come sola con los dedos", ("feeding", "fine-motor"), "meal",
              2),
    Milestone(day("2025-04-19"), L, "Señala lo que quiere", ("cognitive", "language"), "home", 0,
              "Señala el agua, los libros y la puerta de la calle."),
    Milestone(day("2025-05-03"), L, "Primera vez en el columpio",
              ("gross-motor", "social-emotional"), "park", 3, "No quería bajarse.", RETIRO),
    Milestone(day("2025-05-17"), L, "Encaja las figuras", ("cognitive", "fine-motor"), "play", 2,
              "El círculo y el cuadrado a la primera; el triángulo se le resiste."),
    Milestone(day("2025-06-07"), L, "Dice «agua» y «pan»", ("language",), "meal", 1),
    Milestone(day("2025-06-21"), L, "Primera noche con los abuelos",
              ("sleep", "social-emotional"), "night", 2,
              "Durmió de maravilla. Los abuelos, no tanto.", GRANDPARENTS),
    Milestone(day("2025-07-12"), L, "Vacaciones en la playa", ("general",), "beach", 6,
              "Una semana de arena, olas y siestas a la sombra.",
              "Playa de la Malvarrosa, Valencia", ("Castillos de arena", "En la orilla")),
    Milestone(day("2025-07-26"), L, "Deja el chupete", ("sleep", "self-care"), "night", 0,
              "Se lo dio a los Reyes Magos para otro bebé. Dos noches regulares y listo."),
    Milestone(day("2025-08-23"), L, "Primer helado", ("feeding",), "park", 3,
              "De fresa. Pidió más con la mano."),
    Milestone(day("2025-09-08"), L, "Vuelta a la guardería", ("academic",), "school", 2,
              "", NURSERY),
    Milestone(day("2025-09-18"), M, "¡Bienvenido, Mateo!", ("general", "social-emotional"),
              "home", 4, "Nació a las 16:05 con 3,5 kg y 51 cm. Tranquilo y muy dormilón.",
              HOSPITAL, ("Recién nacido", "Primer abrazo")),
    Milestone(day("2025-09-19"), BOTH, "Primer encuentro entre hermanos", ("social-emotional",),
              "home", 5, "Lucía le dio un beso en la cabeza y dijo «bebé». Momento para enmarcar.",
              HOSPITAL, ("Hermanos", "El primer beso")),
    Milestone(day("2025-09-22"), M, "Primer día en casa", ("general",), "home", 3,
              "Lucía le enseñó todos sus juguetes, uno por uno."),
    Milestone(day("2025-10-04"), L, "Come sola con cuchara",
              ("feeding", "self-care", "fine-motor"), "meal", 2,
              "Sopa incluida: media en la boca y media en el babero."),
    Milestone(day("2025-10-05"), M, "Primer baño", ("self-care",), "home", 2),
    Milestone(day("2025-10-24"), M, "Primera sonrisa", ("social-emotional",), "home", 2,
              "Para su hermana, que no paraba de hacerle muecas."),
    Milestone(day("2025-10-25"), L, "Frases de dos palabras", ("language",), "home", 0,
              "«Más agua», «papá ven», «bebé llora»."),
    Milestone(day("2025-11-08"), L, "Garabatea con ceras", ("fine-motor", "cognitive"), "school",
              2, "Su primera obra de arte ya está en la nevera."),
    Milestone(day("2025-11-15"), M, "Sigue los objetos con la mirada", ("cognitive",), "play", 1),
    Milestone(day("2025-11-29"), M, "Levanta la cabeza", ("gross-motor",), "play", 1),
    Milestone(day("2025-12-13"), L, "Función de Navidad de la guardería",
              ("academic", "social-emotional"), "christmas", 4,
              "Vestida de estrella. Saludó al público durante toda la canción.", NURSERY),
    Milestone(day("2025-12-20"), M, "Primeras carcajadas", ("social-emotional",), "home", 2),
    Milestone(day("2025-12-24"), BOTH, "Navidad en familia", ("general", "social-emotional"),
              "christmas", 6, "Primera Navidad de los cuatro.", GRANDPARENTS,
              ("Los dos con el árbol", "La cena de Nochebuena")),
    Milestone(day("2026-01-05"), BOTH, "Reyes Magos", ("general",), "christmas", 5,
              "Lucía ayudó a Mateo a abrir sus regalos (y alguno más)."),
    Milestone(day("2026-01-17"), M, "Se da la vuelta", ("gross-motor",), "play", 1),
    Milestone(day("2026-02-07"), L, "Cuenta hasta tres", ("cognitive",), "play", 0,
              "Uno, dos… ¡tres! Y vuelta a empezar."),
    Milestone(day("2026-02-07"), M, "Agarra los juguetes", ("fine-motor",), "play", 2),
    Milestone(day("2026-02-21"), L, "Primer corte de pelo", ("self-care",), "home", 3,
              "Muy quieta mientras le enseñaban dibujos.", "Peluquería del barrio, Madrid"),
    Milestone(day("2026-02-28"), M, "Duerme toda la noche", ("sleep",), "night", 0,
              "¡Por fin! Doce horas seguidas."),
    Milestone(day("2026-03-10"), L, "¡Dos años!", ("general", "social-emotional"), "party", 5,
              "Tarta de chocolate y una corona de cartón que no se quitó en todo el día."),
    Milestone(day("2026-03-14"), M, "Balbucea sin parar", ("language",), "home", 0),
    Milestone(day("2026-03-21"), M, "Primera papilla", ("feeding",), "meal", 3,
              "De verduras. Le gustó más que a su hermana."),
    Milestone(day("2026-03-28"), L, "Salta con los dos pies", ("gross-motor",), "park", 2),
    Milestone(day("2026-04-04"), M, "Se sienta solo", ("gross-motor",), "play", 2),
    Milestone(day("2026-04-18"), M, "Primer diente", ("teething",), "home", 1,
              "Abajo, en el centro, como su hermana."),
    Milestone(day("2026-04-25"), L, "Deja el pañal de día", ("self-care",), "home", 0,
              "Una semana sin escapes. ¡Campeona!"),
    Milestone(day("2026-05-09"), BOTH, "Primera excursión al zoo", ("general", "cognitive"),
              "park", 6, "A Lucía le encantaron las jirafas; Mateo se durmió en los pingüinos.",
              "Zoo Aquarium de Madrid", ("Las jirafas", "Los pingüinos")),
    Milestone(day("2026-05-30"), M, "Gatea", ("gross-motor",), "play", 2,
              "Directo hacia los juguetes de su hermana."),
    Milestone(day("2026-06-20"), L, "Hace un puzle de seis piezas", ("cognitive", "fine-motor"),
              "play", 2),
    Milestone(day("2026-06-27"), BOTH, "Vacaciones en familia", ("general",), "beach", 6,
              "Dos semanas de playa. Mateo probó la arena (literalmente).",
              "Playa de Zahara de los Atunes, Cádiz", ("Los hermanos en la orilla",)),
    Milestone(day("2026-07-18"), L, "Nada con churro", ("gross-motor",), "beach", 2,
              "", "Piscina municipal, Madrid"),
    Milestone(day("2026-07-25"), M, "Primera palabra: «papá»", ("language",), "home", 1,
              "Papá ya tiene su turno."),
    Milestone(day("2026-08-08"), L, "Duerme en cama de mayores", ("sleep",), "night", 1),
    Milestone(day("2026-08-29"), M, "Hace la pinza con los dedos", ("fine-motor",), "meal", 0),
    Milestone(day("2026-09-01"), M, "Primer día de guardería", ("academic", "social-emotional"),
              "school", 3, "En la misma escuela que su hermana, que le enseñó dónde colgar el "
              "abrigo.", NURSERY),
    Milestone(day("2026-09-07"), L, "Vuelta a la escuela infantil", ("academic",), "school", 2,
              "", NURSERY),
    Milestone(day("2026-09-18"), M, "¡Primer cumpleaños!", ("general", "social-emotional"),
              "party", 5, "Lucía sopló la vela por él.", None, ("Con los globos",)),
    Milestone(day("2026-09-18"), M, "Primera tarta", ("feeding",), "party", 2),
    Milestone(day("2026-09-19"), L, "Se viste sola", ("self-care",), "home", 1,
              "Los zapatos al revés, pero sola."),
    Milestone(day("2026-10-03"), BOTH, "Lucía le cuenta un cuento a Mateo",
              ("language", "social-emotional"), "home", 2,
              "Se inventa la mitad del cuento y Mateo la escucha embobado."),
    Milestone(day("2026-10-10"), M, "Primeros pasos", ("gross-motor",), "park", 4,
              "Cuatro pasos hasta su hermana, que lo celebró más que nadie.", RETIRO),
    Milestone(day("2026-10-17"), L, "Monta en triciclo", ("gross-motor",), "park", 3, "", RETIRO),
)

# Generic photo names per scene (after a milestone's own captions).
CAPTIONS: dict[str, tuple[str, ...]] = {
    "park": ("En el parque", "Paseo de la tarde", "Bajo los árboles", "Tarde de sol",
             "Jugando al aire libre", "Con papá", "Con mamá"),
    "beach": ("En la playa", "Mirando el mar", "En la orilla", "Castillos de arena", "Atardecer",
              "Con el cubo y la pala"),
    "home": ("En casa", "En el salón", "Con mamá", "Con papá", "En brazos", "Un rato tranquilo",
             "Mirando a cámara"),
    "party": ("La fiesta", "Con los globos", "Con los abuelos", "Los regalos", "Toda la familia",
              "Sonrisas"),
    "night": ("Dulces sueños", "Hora de dormir", "Con su peluche", "Buenas noches",
              "Después del baño"),
    "meal": ("En la trona", "¡Qué rico!", "Con las manos", "La merienda", "Cara de sorpresa",
             "Todo el plato"),
    "school": ("La mochila", "En la puerta", "Con su clase", "El primer dibujo", "A la salida",
               "En el patio"),
    "play": ("Jugando", "Con sus juguetes", "En la alfombra", "Bloques de colores", "¡Mira!",
             "Toda la tarde jugando"),
    "christmas": ("El árbol de Navidad", "Luces de Navidad", "Con los abuelos",
                  "Abriendo regalos", "En familia", "La cena"),
}


# Plan ---------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Photo:
    name: str
    scene: str
    size: Size
    seed: int


@dataclass(frozen=True)
class PlannedEvent:
    milestone: Milestone
    photos: tuple[Photo, ...]
    cover: int  # index of the cover photo (the first one unless chosen otherwise)
    recorded: dt.datetime  # created_at: the evening it was written down


def photo_names(milestone: Milestone, rng: random.Random) -> list[str]:
    """``milestone.photos`` distinct names: its own captions first, then generic ones."""
    generic = list(CAPTIONS[milestone.scene])
    rng.shuffle(generic)
    names = list(dict.fromkeys([*milestone.captions, *generic]))
    while len(names) < milestone.photos:
        names.append(f"{milestone.title} {len(names) + 1}")
    return names[: milestone.photos]


def plan(milestones: Sequence[Milestone] = MILESTONES) -> list[PlannedEvent]:
    """Deterministic photos, cover and recording time of every milestone."""
    rng = random.Random(SEED)
    sizes = [size for size, weight in PHOTO_SIZES for _ in range(weight)]
    planned: list[PlannedEvent] = []
    for milestone in milestones:
        photos = tuple(
            Photo(name, milestone.scene, rng.choice(sizes), rng.getrandbits(32))
            for name in photo_names(milestone, rng)
        )
        cover = rng.randrange(len(photos)) if len(photos) > 1 and rng.random() < 0.3 else 0
        written = dt.datetime.combine(
            milestone.date + dt.timedelta(days=rng.choice((0, 0, 0, 1, 2))),
            dt.time(rng.randint(19, 22), rng.randint(0, 59), rng.randint(0, 59)),
            LOCAL_TIME,
        )
        planned.append(PlannedEvent(milestone, photos, cover, written.astimezone(dt.UTC)))
    return planned


def spread(items: Sequence[PlannedEvent], count: int | None) -> list[PlannedEvent]:
    """``count`` items evenly spread over ``items`` (all of them when None or too many)."""
    if count is None or count >= len(items):
        return list(items)
    if count <= 1:
        return list(items[: max(count, 0)])
    picks = sorted({round(index * (len(items) - 1) / (count - 1)) for index in range(count)})
    return [items[index] for index in picks]


# Painting -----------------------------------------------------------------------------------


def rgb(value: str) -> Color:
    return (int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16))


def tone(value: str, hue: float = 0.0, light: float = 0.0, saturation: float = 0.0) -> Color:
    """``value`` (#rrggbb) with its hue rotated and its lightness/saturation shifted."""
    red, green, blue = (channel / 255 for channel in rgb(value))
    h, lightness, s = colorsys.rgb_to_hls(red, green, blue)
    red, green, blue = colorsys.hls_to_rgb(
        (h + hue) % 1.0,
        min(1.0, max(0.0, lightness + light)),
        min(1.0, max(0.0, s + saturation)),
    )
    return (round(red * 255), round(green * 255), round(blue * 255))


def alpha(color: Color, opacity: int) -> tuple[int, int, int, int]:
    return (*color, opacity)


def vertical(size: Size, top: Color, bottom: Color) -> Pillow.Image:
    mask = Pillow.linear_gradient("L").resize(size, Pillow.Resampling.BICUBIC)
    return Pillow.composite(Pillow.new("RGB", size, bottom), Pillow.new("RGB", size, top), mask)


def glow(
    image: Pillow.Image, center: tuple[float, float], radius: float, color: Color, strength: float
) -> None:
    """Soft round light: ``strength`` (0..1) at ``center``, nothing beyond ``radius``."""
    side = max(2, int(radius * 2))
    # radial_gradient is 0 at the centre and 181 on the inscribed circle (255 in the corners).
    mask = (
        Pillow.radial_gradient("L")
        .resize((side, side), Pillow.Resampling.BICUBIC)
        .point(lambda value: int(max(0.0, 1 - value / 181) ** 1.6 * 255 * strength))
    )
    image.paste(Pillow.new("RGB", (side, side), color), (int(center[0] - radius),
                int(center[1] - radius)), mask)


def wave(
    width: int, base: float, amplitude: float, rng: random.Random, steps: int = 48
) -> list[tuple[float, float]]:
    """Points of a smooth random curve across the picture around height ``base``."""
    phases = [rng.uniform(0, math.tau) for _ in range(3)]
    frequencies = [rng.uniform(0.6, 1.4), rng.uniform(1.8, 3.2), rng.uniform(4.0, 6.0)]
    weights = [1.0, 0.35, 0.12]
    points = []
    for step in range(steps + 1):
        x = width * step / steps
        offset = sum(
            weight * math.sin(frequency * math.tau * step / steps + phase)
            for weight, frequency, phase in zip(weights, frequencies, phases, strict=True)
        )
        points.append((x, base + amplitude * offset))
    return points


def fill_below(
    image: Pillow.Image, curve: list[tuple[float, float]], top: Color, bottom: Color
) -> None:
    """Fill the area under ``curve`` with a vertical gradient."""
    width, height = image.size
    mask = Pillow.new("L", image.size, 0)
    ImageDraw.Draw(mask).polygon([(0, height), *curve, (width, height)], fill=255)
    image.paste(vertical(image.size, top, bottom), (0, 0), mask)


def soft_layer(
    image: Pillow.Image, draw: Callable[[ImageDraw.ImageDraw], None], blur: float
) -> Pillow.Image:
    """``image`` with shapes drawn on a transparent layer that is blurred first (bokeh, light).
    The blur runs on premultiplied alpha, so edges fade out instead of darkening."""
    layer = Pillow.new("RGBA", image.size, (0, 0, 0, 0))
    draw(ImageDraw.Draw(layer))
    layer = layer.convert("RGBa").filter(ImageFilter.GaussianBlur(blur)).convert("RGBA")
    return Pillow.alpha_composite(image.convert("RGBA"), layer).convert("RGB")


def bokeh(
    image: Pillow.Image, rng: random.Random, colors: Sequence[Color], count: int, unit: float
) -> Pillow.Image:
    width, height = image.size

    def circles(draw: ImageDraw.ImageDraw) -> None:
        for _ in range(count):
            radius = unit * rng.uniform(0.02, 0.07)
            x, y = rng.uniform(0, width), rng.uniform(0, height)
            draw.ellipse(
                (x - radius, y - radius, x + radius, y + radius),
                fill=alpha(rng.choice(colors), rng.randint(50, 120)),
            )

    return soft_layer(image, circles, unit * 0.008)


def tree(draw: ImageDraw.ImageDraw, x: float, ground: float, unit: float, leaves: Color) -> None:
    trunk = unit * 0.018
    height = unit * 0.12
    draw.rounded_rectangle(
        (x - trunk, ground - height, x + trunk, ground + unit * 0.02),
        radius=trunk,
        fill=(120, 84, 60),
    )
    for dx, dy, size in ((0, -0.05, 0.075), (-0.045, 0.0, 0.055), (0.045, -0.01, 0.06)):
        cx, cy, radius = x + dx * unit, ground - height + dy * unit, size * unit
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=leaves)
    highlight = tuple(min(255, channel + 28) for channel in leaves)
    cx, cy, radius = x - unit * 0.02, ground - height - unit * 0.075, unit * 0.03
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=highlight)


def paint_park(rng: random.Random, size: Size, hue: float) -> Pillow.Image:
    width, height = size
    unit = min(size)
    image = vertical(size, tone("#7cc4f5", hue), tone("#fde9c9", hue / 3))
    sun = (width * rng.uniform(0.15, 0.85), height * rng.uniform(0.1, 0.3))
    glow(image, sun, unit * 0.45, tone("#fff3b0", hue / 4), 0.8)
    draw = ImageDraw.Draw(image, "RGBA")
    radius = unit * 0.065
    draw.ellipse((sun[0] - radius, sun[1] - radius, sun[0] + radius, sun[1] + radius),
                 fill=tone("#ffe27a", hue / 4))
    for _ in range(rng.randint(2, 4)):
        cx, cy = rng.uniform(0, width), height * rng.uniform(0.08, 0.35)
        for _ in range(4):
            rx, ry = unit * rng.uniform(0.05, 0.1), unit * rng.uniform(0.03, 0.05)
            ox = rng.uniform(-0.08, 0.08) * unit
            draw.ellipse((cx + ox - rx, cy - ry, cx + ox + rx, cy + ry),
                         fill=(255, 255, 255, 190))
    for layer in range(3):
        green = tone("#9fd67f", hue, light=-0.07 * layer)
        curve = wave(width, height * (0.55 + 0.12 * layer), height * 0.045, rng)
        fill_below(image, curve, green, tone("#6fae5a", hue, light=-0.07 * layer))
        draw = ImageDraw.Draw(image, "RGBA")
        if layer == 1:
            for _ in range(rng.randint(1, 3)):
                index = rng.randrange(4, len(curve) - 4)
                tree(draw, curve[index][0], curve[index][1], unit, tone("#4f9a4a", hue))
    for _ in range(int(40 * width / 1000)):
        x, y = rng.uniform(0, width), height * rng.uniform(0.86, 0.99)
        petal = unit * rng.uniform(0.006, 0.012)
        draw.ellipse((x - petal, y - petal, x + petal, y + petal),
                     fill=rng.choice(((255, 255, 255), (255, 214, 102), (255, 160, 190))))
    return image


def paint_beach(rng: random.Random, size: Size, hue: float) -> Pillow.Image:
    width, height = size
    unit = min(size)
    horizon = height * rng.uniform(0.45, 0.55)
    image = vertical(size, tone("#8fd3fe", hue), tone("#ffd9c2", hue / 2))
    sun = (width * rng.uniform(0.2, 0.8), horizon - unit * rng.uniform(0.08, 0.2))
    glow(image, sun, unit * 0.5, tone("#fff1c1", hue / 3), 0.85)
    draw = ImageDraw.Draw(image, "RGBA")
    radius = unit * 0.06
    draw.ellipse((sun[0] - radius, sun[1] - radius, sun[0] + radius, sun[1] + radius),
                 fill=tone("#ffe7a0", hue / 3))
    sea = Pillow.new("L", size, 0)
    ImageDraw.Draw(sea).rectangle((0, horizon, width, height), fill=255)
    image.paste(vertical(size, tone("#2f8fce", hue), tone("#5fd0d0", hue)), (0, 0), sea)
    draw = ImageDraw.Draw(image, "RGBA")
    for row in range(10):
        y = horizon + (row + 1) * unit * 0.018
        half = unit * (0.02 + 0.012 * row) * rng.uniform(0.7, 1.3)
        draw.ellipse((sun[0] - half, y - unit * 0.003, sun[0] + half, y + unit * 0.003),
                     fill=(255, 244, 214, 150))
    shore = wave(width, height * rng.uniform(0.72, 0.8), height * 0.02, rng)
    draw.line(shore, fill=(255, 255, 255, 200), width=max(2, int(unit * 0.012)))
    fill_below(image, [(x, y + unit * 0.01) for x, y in shore], tone("#f6deb0", hue / 4),
               tone("#e8c48a", hue / 4))
    draw = ImageDraw.Draw(image, "RGBA")
    if rng.random() < 0.6:
        x, ground = width * rng.uniform(0.15, 0.85), height * 0.93
        top = ground - unit * 0.3
        span = unit * 0.17
        draw.line((x, top, x, ground), fill=(250, 250, 250), width=max(2, int(unit * 0.008)))
        colors = (tone("#ef6f6c", hue), (255, 255, 255))
        for index in range(6):
            draw.pieslice((x - span, top - span * 0.55, x + span, top + span * 0.55),
                          180 + index * 30, 210 + index * 30, fill=colors[index % 2])
    return image


def teddy(draw: ImageDraw.ImageDraw, x: float, y: float, unit: float, fur: Color) -> None:
    def disc(cx: float, cy: float, radius: float, color: Color | tuple[int, ...]) -> None:
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=color)

    disc(x, y, unit * 0.11, fur)
    disc(x, y - unit * 0.15, unit * 0.075, fur)
    for side in (-1, 1):
        disc(x + side * unit * 0.06, y - unit * 0.21, unit * 0.03, fur)
        disc(x + side * unit * 0.1, y - unit * 0.02, unit * 0.04, fur)
        disc(x + side * unit * 0.025, y - unit * 0.165, unit * 0.008, (60, 40, 30))
    disc(x, y - unit * 0.13, unit * 0.028, tuple(min(255, c + 45) for c in fur))
    disc(x, y - unit * 0.138, unit * 0.009, (60, 40, 30))


def paint_home(rng: random.Random, size: Size, hue: float) -> Pillow.Image:
    width, height = size
    unit = min(size)
    floor = height * rng.uniform(0.66, 0.74)
    image = vertical(size, tone("#fbe7d3", hue), tone("#f1c9a8", hue))
    draw = ImageDraw.Draw(image, "RGBA")
    left = width * rng.uniform(0.5, 0.62)
    window = (left, height * 0.12, left + width * 0.28, floor - height * 0.16)
    inside = Pillow.new("L", size, 0)
    ImageDraw.Draw(inside).rectangle(window, fill=255)
    image.paste(vertical(size, tone("#a5d8ff", hue / 3), tone("#fff4d6", hue / 3)), (0, 0),
                inside)
    draw = ImageDraw.Draw(image, "RGBA")
    frame = max(3, int(unit * 0.014))
    draw.rectangle(window, outline=(255, 255, 255), width=frame)
    middle = (window[0] + window[2]) / 2, (window[1] + window[3]) / 2
    draw.line((middle[0], window[1], middle[0], window[3]), fill=(255, 255, 255), width=frame)
    draw.line((window[0], middle[1], window[2], middle[1]), fill=(255, 255, 255), width=frame)
    image = soft_layer(
        image,
        lambda layer: layer.polygon(
            [(window[0], window[3]), (window[2], window[3]),
             (window[2] - width * 0.1, height), (window[0] - width * 0.25, height)],
            fill=(255, 250, 230, 70),
        ),
        unit * 0.03,
    )
    fill_below(image, [(0, floor), (width, floor)], tone("#c99a6e", hue / 3),
               tone("#a8764c", hue / 3))
    draw = ImageDraw.Draw(image, "RGBA")
    for index in range(1, 6):
        y = floor + (height - floor) * (index / 6) ** 1.4
        draw.line((0, y, width, y), fill=(90, 60, 40, 60), width=max(1, int(unit * 0.003)))
    rug = tone("#f4a6b8", hue * 2)
    cx = width * rng.uniform(0.3, 0.45)
    draw.ellipse((cx - width * 0.28, floor + (height - floor) * 0.25, cx + width * 0.28,
                  height * 0.98), fill=rug)
    teddy(draw, cx, floor + (height - floor) * 0.35, unit, tone("#c68b59", hue / 4))
    return bokeh(image, rng, [(255, 244, 214), (255, 255, 255)], 8, unit)


def paint_party(rng: random.Random, size: Size, hue: float) -> Pillow.Image:
    width, height = size
    unit = min(size)
    image = vertical(size, tone("#fbcfe8", hue), tone("#e9d5ff", hue))
    draw = ImageDraw.Draw(image, "RGBA")
    palette = [tone("#f87171", hue + shift) for shift in (0, 0.12, 0.3, 0.5, 0.62, 0.8)]
    garland = wave(width, height * 0.1, height * 0.025, rng, steps=12)
    draw.line(garland, fill=(255, 255, 255, 220), width=max(2, int(unit * 0.005)))
    for index, (x, y) in enumerate(garland[:-1]):
        nx, ny = garland[index + 1]
        draw.polygon([(x, y), (nx, ny), ((x + nx) / 2, (y + ny) / 2 + unit * 0.09)],
                     fill=palette[index % len(palette)])
    for _ in range(rng.randint(4, 7)):
        rx = unit * rng.uniform(0.06, 0.09)
        x, y = rng.uniform(rx, width - rx), height * rng.uniform(0.3, 0.6)
        color = rng.choice(palette)
        string = [(x, y + rx * 1.25)]
        for step in range(1, 6):
            string.append((x + math.sin(step * 1.3) * unit * 0.015,
                           y + rx * 1.25 + step * (height - y) / 5))
        draw.line(string, fill=(255, 255, 255, 200), width=max(1, int(unit * 0.003)))
        draw.ellipse((x - rx, y - rx * 1.2, x + rx, y + rx * 1.2), fill=color)
        draw.polygon([(x - rx * 0.12, y + rx * 1.3), (x + rx * 0.12, y + rx * 1.3),
                      (x, y + rx * 1.15)], fill=color)
        draw.ellipse((x - rx * 0.55, y - rx * 0.85, x - rx * 0.2, y - rx * 0.35),
                     fill=(255, 255, 255, 120))
    for _ in range(int(90 * width / 1000)):
        x, y = rng.uniform(0, width), rng.uniform(0, height)
        piece = unit * rng.uniform(0.004, 0.009)
        draw.rectangle((x - piece, y - piece * 0.6, x + piece, y + piece * 0.6),
                       fill=alpha(rng.choice(palette), 220))
    return bokeh(image, rng, [(255, 255, 255), *palette], 10, unit)


def paint_night(rng: random.Random, size: Size, hue: float) -> Pillow.Image:
    width, height = size
    unit = min(size)
    image = vertical(size, tone("#13205a", hue), tone("#5a3a8a", hue))
    draw = ImageDraw.Draw(image, "RGBA")
    for _ in range(int(120 * width * height / 1_000_000) + 30):
        x, y = rng.uniform(0, width), rng.uniform(0, height * 0.75)
        radius = unit * rng.uniform(0.001, 0.0035)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius),
                     fill=(255, 250, 220, rng.randint(120, 255)))
    moon = (width * rng.uniform(0.2, 0.8), height * rng.uniform(0.15, 0.3))
    radius = unit * 0.09
    glow(image, moon, unit * 0.35, (255, 240, 200), 0.35)
    disc = Pillow.new("L", size, 0)
    ImageDraw.Draw(disc).ellipse(
        (moon[0] - radius, moon[1] - radius, moon[0] + radius, moon[1] + radius), fill=255
    )
    bite = Pillow.new("L", size, 0)
    offset = radius * 0.55
    ImageDraw.Draw(bite).ellipse(
        (moon[0] - radius + offset, moon[1] - radius - offset * 0.3, moon[0] + radius + offset,
         moon[1] + radius - offset * 0.3),
        fill=255,
    )
    image.paste(Pillow.new("RGB", size, (255, 236, 179)), (0, 0), ImageChops.subtract(disc, bite))
    fill_below(image, wave(width, height * 0.82, height * 0.03, rng), tone("#241a4a", hue),
               tone("#120d2a", hue))
    draw = ImageDraw.Draw(image, "RGBA")
    x, ground = width * rng.uniform(0.2, 0.8), height * 0.86
    side = unit * 0.12
    draw.rectangle((x - side, ground - side, x + side, ground + side * 0.4), fill=(40, 30, 70))
    draw.polygon([(x - side * 1.25, ground - side), (x + side * 1.25, ground - side),
                  (x, ground - side * 2)], fill=(52, 38, 86))
    draw.rectangle((x - side * 0.45, ground - side * 0.6, x - side * 0.05, ground - side * 0.2),
                   fill=(255, 214, 120))
    glow(image, (x - side * 0.25, ground - side * 0.4), side * 1.2, (255, 214, 120), 0.35)
    return image


def paint_meal(rng: random.Random, size: Size, hue: float) -> Pillow.Image:
    width, height = size
    unit = min(size)
    table = height * rng.uniform(0.35, 0.45)
    image = vertical(size, tone("#fff4e0", hue / 3), tone("#ffe1c4", hue / 3))
    cloth = tone("#f28b82", hue)
    fill_below(image, [(0, table), (width, table)], cloth, tone("#e0675e", hue))
    draw = ImageDraw.Draw(image, "RGBA")
    stripe = unit * 0.06
    for index in range(int(width / stripe) + 1):
        if index % 2 == 0:
            draw.rectangle((index * stripe, table, (index + 1) * stripe, height),
                           fill=(255, 255, 255, 70))
    for index in range(int((height - table) / stripe) + 1):
        if index % 2 == 0:
            top = table + index * stripe
            draw.rectangle((0, top, width, top + stripe), fill=(255, 255, 255, 70))
    cx, cy = width * rng.uniform(0.4, 0.6), table + (height - table) * 0.5
    plate = unit * 0.26
    draw.ellipse((cx - plate, cy - plate * 0.62, cx + plate, cy + plate * 0.62),
                 fill=(250, 250, 250))
    draw.ellipse((cx - plate * 0.72, cy - plate * 0.45, cx + plate * 0.72, cy + plate * 0.45),
                 fill=(236, 236, 240))
    puree = rng.choice((tone("#f9a03f", hue / 4), tone("#9ccc65", hue / 4),
                        tone("#ffd54f", hue / 4)))
    draw.ellipse((cx - plate * 0.5, cy - plate * 0.3, cx + plate * 0.5, cy + plate * 0.3),
                 fill=puree)
    spoon = (cx + plate * 0.85, cy - plate * 0.1)
    draw.line((spoon[0], spoon[1], spoon[0] + plate * 0.9, spoon[1] - plate * 0.5),
              fill=(200, 200, 210), width=max(3, int(unit * 0.018)))
    draw.ellipse((spoon[0] - plate * 0.14, spoon[1] - plate * 0.1, spoon[0] + plate * 0.14,
                  spoon[1] + plate * 0.1), fill=(210, 210, 220))
    for _ in range(rng.randint(4, 8)):
        x = rng.uniform(0.05, 0.95) * width
        y = rng.uniform(table + unit * 0.05, height - unit * 0.05)
        if abs(x - cx) < plate * 1.1 and abs(y - cy) < plate * 0.8:
            continue
        radius = unit * rng.uniform(0.02, 0.04)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius),
                     fill=rng.choice(((229, 57, 53), (124, 179, 66), (255, 202, 40))))
    return bokeh(image, rng, [(255, 255, 255)], 6, unit)


def paint_school(rng: random.Random, size: Size, hue: float) -> Pillow.Image:
    width, height = size
    unit = min(size)
    image = vertical(size, tone("#fdf6e3", hue / 3), tone("#d9f2e6", hue / 3))
    draw = ImageDraw.Draw(image, "RGBA")
    board = (width * 0.1, height * 0.1, width * 0.9, height * 0.6)
    draw.rounded_rectangle(board, radius=unit * 0.02, fill=(166, 124, 82))
    inset = unit * 0.025
    draw.rectangle((board[0] + inset, board[1] + inset, board[2] - inset, board[3] - inset),
                   fill=tone("#2f5d50", hue / 4))
    chalk = (240, 240, 230, 220)
    line = max(2, int(unit * 0.006))
    sx, sy, sr = board[0] + width * 0.15, board[1] + height * 0.15, unit * 0.05
    draw.ellipse((sx - sr, sy - sr, sx + sr, sy + sr), outline=chalk, width=line)
    for ray in range(8):
        angle = ray * math.tau / 8
        draw.line((sx + math.cos(angle) * sr * 1.3, sy + math.sin(angle) * sr * 1.3,
                   sx + math.cos(angle) * sr * 1.8, sy + math.sin(angle) * sr * 1.8),
                  fill=chalk, width=line)
    hx, hy, hs = board[0] + width * 0.45, board[3] - height * 0.08, unit * 0.09
    draw.rectangle((hx - hs, hy - hs, hx + hs, hy), outline=chalk, width=line)
    draw.line([(hx - hs * 1.2, hy - hs), (hx, hy - hs * 1.9), (hx + hs * 1.2, hy - hs)],
              fill=chalk, width=line)
    scribble = wave(int(width * 0.3), board[1] + height * 0.12, height * 0.02, rng, 16)
    draw.line([(x + board[0] + width * 0.42, y) for x, y in scribble],
              fill=(255, 214, 102, 220), width=line)
    colors = [tone("#ef4444", hue + shift) for shift in (0, 0.1, 0.3, 0.55, 0.75)]
    for index in range(rng.randint(4, 6)):
        x = width * (0.14 + index * 0.14) + rng.uniform(-0.02, 0.02) * width
        y = height * rng.uniform(0.74, 0.88)
        length, thick = unit * 0.16, unit * 0.022
        angle = rng.uniform(-0.6, 0.6)
        dx, dy = math.cos(angle) * length / 2, math.sin(angle) * length / 2
        draw.line((x - dx, y - dy, x + dx, y + dy), fill=colors[index % len(colors)],
                  width=int(thick))
    return image


def paint_play(rng: random.Random, size: Size, hue: float) -> Pillow.Image:
    width, height = size
    unit = min(size)
    floor = height * 0.68
    image = vertical(size, tone("#e0f2fe", hue / 2), tone("#fef3c7", hue / 2))
    fill_below(image, [(0, floor), (width, floor)], tone("#a7d3a0", hue / 2),
               tone("#86b97f", hue / 2))
    draw = ImageDraw.Draw(image, "RGBA")
    colors = [tone("#f87171", hue + shift) for shift in (0, 0.15, 0.33, 0.55, 0.7)]
    block = unit * 0.11
    x = width * rng.uniform(0.15, 0.3)
    first = rng.randrange(len(colors))
    for level in range(rng.randint(3, 5)):
        bx = x + rng.uniform(-0.15, 0.15) * block
        top = floor + unit * 0.05 - (level + 1) * block
        draw.rounded_rectangle((bx - block / 2, top, bx + block / 2, top + block),
                               radius=block * 0.12, fill=colors[(first + level) % len(colors)])
        draw.rounded_rectangle((bx - block * 0.3, top + block * 0.2, bx + block * 0.3,
                                top + block * 0.8), radius=block * 0.08,
                               fill=(255, 255, 255, 70))
    rx, base = width * rng.uniform(0.44, 0.52), floor + unit * 0.06
    draw.rounded_rectangle((rx - unit * 0.012, base - unit * 0.28, rx + unit * 0.012, base),
                           radius=unit * 0.01, fill=(222, 184, 135))
    for level in range(4):
        ring = unit * (0.085 - level * 0.014)
        y = base - level * unit * 0.05
        draw.ellipse((rx - ring, y - unit * 0.05, rx + ring, y),
                     fill=colors[(first + level + 2) % len(colors)])
    bx, by, radius = width * rng.uniform(0.72, 0.82), floor + unit * 0.04, unit * 0.09
    for index in range(6):
        draw.pieslice((bx - radius, by - radius, bx + radius, by + radius), index * 60,
                      index * 60 + 60, fill=colors[index % len(colors)])
    draw.ellipse((bx - radius * 0.6, by - radius * 0.7, bx - radius * 0.2, by - radius * 0.35),
                 fill=(255, 255, 255, 110))
    return bokeh(image, rng, [(255, 255, 255)], 6, unit)


def paint_christmas(rng: random.Random, size: Size, hue: float) -> Pillow.Image:
    width, height = size
    unit = min(size)
    image = vertical(size, tone("#16324f", hue / 3), tone("#4a1d2f", hue / 3))
    image = bokeh(image, rng, [(255, 214, 120), (255, 120, 100), (160, 230, 160)], 40, unit * 1.6)
    draw = ImageDraw.Draw(image, "RGBA")
    cx, base = width * rng.uniform(0.35, 0.65), height * 0.88
    for tier in range(3):
        half = unit * (0.28 - tier * 0.065)
        bottom = base - tier * unit * 0.15
        draw.polygon(
            [(cx - half, bottom), (cx + half, bottom), (cx, bottom - unit * 0.26)],
            fill=tone("#2e7d4f", hue / 4, light=0.04 * tier),
        )
    draw.rectangle((cx - unit * 0.03, base, cx + unit * 0.03, base + unit * 0.06),
                   fill=(110, 70, 50))
    for _ in range(14):
        level = rng.uniform(0.05, 0.95)
        y = base - level * unit * 0.55
        half = unit * 0.25 * (1 - level * 0.85)
        x = cx + rng.uniform(-half, half) * 0.8
        radius = unit * 0.014
        draw.ellipse((x - radius, y - radius, x + radius, y + radius),
                     fill=rng.choice(((229, 57, 53), (255, 202, 40), (255, 255, 255))))
    top = (cx, base - unit * 0.56)
    glow(image, top, unit * 0.12, (255, 225, 140), 0.7)
    draw = ImageDraw.Draw(image, "RGBA")
    star = []
    for point in range(10):
        radius = unit * (0.04 if point % 2 == 0 else 0.017)
        angle = -math.pi / 2 + point * math.pi / 5
        star.append((top[0] + math.cos(angle) * radius, top[1] + math.sin(angle) * radius))
    draw.polygon(star, fill=(255, 214, 90))
    for index in range(rng.randint(2, 3)):
        side = unit * rng.uniform(0.06, 0.09)
        gx = cx + (index - 1) * unit * 0.2 + unit * 0.05
        draw.rectangle((gx - side, base + unit * 0.06 - side * 1.2, gx + side,
                        base + unit * 0.06), fill=rng.choice(((229, 57, 53), (66, 133, 244),
                                                              (255, 202, 40))))
        draw.rectangle((gx - side * 0.15, base + unit * 0.06 - side * 1.2, gx + side * 0.15,
                        base + unit * 0.06), fill=(255, 255, 255, 220))
    return image


PAINTERS: dict[str, Callable[[random.Random, Size, float], Pillow.Image]] = {
    "park": paint_park,
    "beach": paint_beach,
    "home": paint_home,
    "party": paint_party,
    "night": paint_night,
    "meal": paint_meal,
    "school": paint_school,
    "play": paint_play,
    "christmas": paint_christmas,
}


def photographic(image: Pillow.Image, rng: random.Random, grade: bool = True) -> Pillow.Image:
    """Soft focus, a colour grade of its own, vignette and a little grain, so that drawings look
    more like photos (and photos of one scene still differ in colour)."""
    unit = min(image.size)
    image = image.filter(ImageFilter.GaussianBlur(unit / 700))
    if grade:
        tint = Pillow.new("RGB", image.size, rng.choice(GRADES))
        image = Pillow.blend(image, ImageChops.soft_light(image, tint), rng.uniform(0.45, 0.8))
    vignette = (
        Pillow.radial_gradient("L")
        .resize(image.size, Pillow.Resampling.BICUBIC)
        .point(lambda value: int(max(0, value - 120) * 0.7))
    )
    image = Pillow.composite(Pillow.new("RGB", image.size, (40, 30, 35)), image, vignette)
    # Zero-mean grain from the photo's own random generator (effect_noise is not seeded):
    # values around 128 added with an offset of -128 keep the colours.
    grain = (
        Pillow.frombytes("L", image.size, rng.randbytes(image.width * image.height))
        .point(lambda value: int(128 + (value - 128) * 0.04))
        .convert("RGB")
    )
    return ImageChops.add(image, grain, scale=1.0, offset=-128)


def jpeg(image: Pillow.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return buffer.getvalue()


def render_photo(photo: Photo, scale: float = 1.0) -> bytes:
    rng = random.Random(photo.seed)
    size = (max(16, round(photo.size[0] * scale)), max(16, round(photo.size[1] * scale)))
    hue = rng.uniform(-0.07, 0.07) if photo.scene in ("park", "beach") else rng.uniform(-0.2, 0.2)
    return jpeg(photographic(PAINTERS[photo.scene](rng, size, hue), rng))


def render_avatar(child: DemoChild, scale: float = 1.0) -> bytes:
    side = max(32, round(AVATAR_SIDE * scale))
    image = vertical((side, side), rgb(child.background[0]), rgb(child.background[1]))
    glow(image, (side * 0.5, side * 0.45), side * 0.55, (255, 255, 255), 0.5)
    draw = ImageDraw.Draw(image, "RGBA")
    unit = side / 100
    skin, hair, cheek = (246, 212, 186), rgb(child.hair), (244, 143, 160, 110)

    def box(left: float, top: float, right: float, bottom: float) -> tuple[float, ...]:
        return (left * unit, top * unit, right * unit, bottom * unit)

    draw.ellipse(box(14, 76, 86, 130), fill=rgb(child.shirt))
    draw.rounded_rectangle(box(44, 64, 56, 80), radius=4 * unit, fill=skin)
    if child.pigtails:
        for left in (14, 70):
            draw.ellipse(box(left, 30, left + 16, 48), fill=hair)
            draw.polygon([(c * unit, r * unit) for c, r in (
                (left + 8, 33), (left + 2, 27), (left + 2, 37))], fill=(244, 114, 182))
    for left in (23, 69):
        draw.ellipse(box(left, 44, left + 8, 56), fill=skin)
    draw.ellipse(box(27, 22, 73, 72), fill=skin)
    draw.chord(box(25, 18, 75, 62), 180, 360, fill=hair)
    if child.pigtails:
        draw.pieslice(box(30, 28, 52, 48), 180, 300, fill=hair)
    else:
        draw.ellipse(box(44, 14, 56, 24), fill=hair)
        draw.ellipse(box(50, 12, 60, 21), fill=hair)
    for left in (37, 56):
        draw.ellipse(box(left, 46, left + 7, 54), fill=(62, 44, 40))
        draw.ellipse(box(left + 1.5, 47.5, left + 3.5, 49.5), fill=(255, 255, 255))
        draw.ellipse(box(left - 4, 55, left + 5, 61), fill=cheek)
    draw.arc(box(42, 52, 58, 64), 25, 155, fill=(170, 80, 80), width=max(2, round(1.5 * unit)))
    return jpeg(photographic(image, random.Random(child.slug), grade=False))


# Storage ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Stored:
    """An image processed by the upload pipeline and stored in ``media_dir/<id>/``."""

    id: uuid.UUID
    filename: str
    extension: str
    content_type: str
    byte_size: int
    width: int
    height: int
    dominant_color: str


def store(media_dir: Path, filename: str, data: bytes, max_bytes: int) -> Stored:
    """Exactly what an upload does with the file: process it, then write its folder."""
    processed = media.process_upload(io.BytesIO(data), max_bytes)
    image_id = uuid.uuid4()
    media.store_files(media_dir / str(image_id), io.BytesIO(data), processed)
    return Stored(
        id=image_id,
        filename=filename,
        extension=processed.extension,
        content_type=processed.content_type,
        byte_size=processed.byte_size,
        width=processed.width,
        height=processed.height,
        dominant_color=processed.dominant_color,
    )


def pending_row(stored: Stored, purpose: media.ImagePurpose, now: dt.datetime) -> Image:
    """The row of a pending upload (attached by ``attach_pending`` like any upload)."""
    return Image(
        id=stored.id,
        purpose=purpose,
        name=media.image_name(stored.filename),
        original_filename=media.original_filename(stored.filename, stored.extension),
        original_ext=stored.extension,
        content_type=stored.content_type,
        byte_size=stored.byte_size,
        width=stored.width,
        height=stored.height,
        dominant_color=stored.dominant_color,
        position=0,
        uploaded_by_id=None,
        created_at=now,
        expires_at=now + media.PENDING_LIFETIME,
    )


def remove_folders(media_dir: Path, ids: Iterable[uuid.UUID]) -> None:
    for image_id in ids:
        shutil.rmtree(media_dir / str(image_id), ignore_errors=True)


# Loading ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Summary:
    loaded: bool
    children: int = 0
    events: int = 0
    images: int = 0
    deleted_events: int = 0
    deleted_children: int = 0

    def __str__(self) -> str:
        if not self.loaded:
            return (
                "Demo data already loaded (a child with the slug 'lucia' or 'mateo' exists); "
                "use --reset to delete all events and children and load it again."
            )
        reset = (
            f" after deleting {self.deleted_events} events and {self.deleted_children} children"
            if self.deleted_events or self.deleted_children
            else ""
        )
        return (
            f"Timelife demo data loaded{reset}: {self.children} children, "
            f"{self.events} events, {self.images} event images."
        )


async def demo_exists(db: AsyncSession) -> bool:
    slugs = [child.slug for child in CHILDREN]
    found = await db.scalar(select(func.count()).select_from(Child).where(Child.slug.in_(slugs)))
    return bool(found)


async def wipe(db: AsyncSession, media_dir: Path) -> tuple[int, int]:
    """Delete every event and child with their images (folders once committed); returns how
    many events and children there were. Pending uploads are left to expire."""
    events = await db.scalar(select(func.count()).select_from(Event)) or 0
    children = await db.scalar(select(func.count()).select_from(Child)) or 0
    avatars = select(Child.avatar_image_id).where(Child.avatar_image_id.is_not(None))
    images = await db.scalars(
        select(Image).where(Image.event_id.is_not(None) | Image.id.in_(avatars))
    )
    await media.delete_images(db, list(images), media_dir)
    await db.execute(delete(Event), execution_options={"synchronize_session": False})
    await db.execute(delete(Child), execution_options={"synchronize_session": False})
    return events, children


Job = tuple[str, Callable[[], bytes]]  # (file name, renderer)


def render_jobs(planned: Sequence[PlannedEvent], scale: float) -> list[Job]:
    """The children's avatars first, then every photo in plan order."""
    jobs: list[Job] = [
        (f"{child.name}.jpg", partial(render_avatar, child, scale)) for child in CHILDREN
    ]
    for item in planned:
        jobs.extend(
            (f"{photo.name}.jpg", partial(render_photo, photo, scale)) for photo in item.photos
        )
    return jobs


def render_all(
    media_dir: Path, jobs: Sequence[Job], max_bytes: int, created: list[uuid.UUID]
) -> list[Stored]:
    """Render and store every job in worker threads (results in job order); the id of each
    folder written is appended to ``created`` as soon as it exists."""

    def run_job(job: Job) -> Stored:
        filename, renderer = job
        stored = store(media_dir, filename, renderer(), max_bytes)
        created.append(stored.id)
        return stored

    with ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 2)) as pool:
        return list(pool.map(run_job, jobs))


async def add_children(
    db: AsyncSession, avatars: Sequence[Stored], now: dt.datetime
) -> dict[str, int]:
    """Create the demo children with their avatars (pending rows already added); slug → id."""
    ids: dict[str, int] = {}
    for child, avatar in zip(CHILDREN, avatars, strict=True):
        body = ChildIn(name=child.name, birth_date=child.birth_date, avatar_image_id=avatar.id)
        await attach_avatar(db, body.avatar_image_id)
        row = Child(
            name=body.name,
            slug=await new_slug(db, body.name),
            birth_date=body.birth_date,
            avatar_image_id=body.avatar_image_id,
            sort_order=await next_position(db, Child.sort_order),
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        await db.flush()
        ids[child.slug] = row.id
    return ids


async def add_events(
    db: AsyncSession,
    planned: Sequence[PlannedEvent],
    photos: Sequence[Stored],
    children: dict[str, int],
    media_dir: Path,
    now: dt.datetime,
) -> None:
    """Create the planned events through ``insert_event`` (pending photo rows already added)."""
    categories: dict[str, int] = {}
    for key, category_id in await db.execute(
        select(Category.key, Category.id).order_by(Category.sort_order, Category.id)
    ):
        categories.setdefault(key or "", category_id)
    if not categories:
        raise RuntimeError("No categories: run 'python -m timelife.seed' first")
    # Defaults an administrator deleted are skipped; an event left without any gets the first.
    fallback = next(iter(categories.values()))
    remaining = iter(photos)
    for item in planned:
        stored = [next(remaining) for _ in item.photos]
        milestone = item.milestone
        body = EventIn(
            title=milestone.title,
            date=milestone.date,
            notes=milestone.notes,
            location=milestone.location,
            child_ids=[children[slug] for slug in milestone.children],
            category_ids=[categories[key] for key in milestone.categories if key in categories]
            or [fallback],
            images=[
                EventImageIn(id=image.id, name=photo.name)
                for image, photo in zip(stored, item.photos, strict=True)
            ],
            cover_image_id=stored[item.cover].id if stored else None,
        )
        await insert_event(
            db, body, user_id=None, media_dir=media_dir, now=min(item.recorded, now)
        )


async def load(
    db: AsyncSession,
    media_dir: Path,
    *,
    reset: bool = False,
    events: Sequence[PlannedEvent] | None = None,
    scale: float = 1.0,
    max_bytes: int = 30 * 1024 * 1024,
) -> Summary:
    """Load the demo children and ``events`` (default: every milestone) in one transaction,
    after deleting every event and child when ``reset``. The default categories must exist
    (``seed``). Pictures are rendered and stored before the transaction starts; if anything
    fails, the folders written are removed again."""
    exists = await demo_exists(db)
    # End the read transaction: SQLite would keep other writers waiting while pictures render.
    await db.rollback()
    if exists and not reset:
        return Summary(loaded=False)
    planned = plan() if events is None else list(events)
    media_dir.mkdir(parents=True, exist_ok=True)
    created: list[uuid.UUID] = []
    try:
        stored = await asyncio.to_thread(
            render_all, media_dir, render_jobs(planned, scale), max_bytes, created
        )
        avatars, photos = stored[: len(CHILDREN)], stored[len(CHILDREN) :]
        deleted = await wipe(db, media_dir) if reset else (0, 0)
        now = utcnow()
        db.add_all(pending_row(image, "avatar", now) for image in avatars)
        db.add_all(pending_row(image, "event", now) for image in photos)
        await db.flush()
        children = await add_children(db, avatars, now)
        await add_events(db, planned, photos, children, media_dir, now)
        await db.commit()
    except BaseException:
        await db.rollback()
        remove_folders(media_dir, created)
        raise
    return Summary(
        loaded=True,
        children=len(children),
        events=len(planned),
        images=len(photos),
        deleted_events=deleted[0],
        deleted_children=deleted[1],
    )


async def run(config: Settings, *, reset: bool = False, count: int | None = None) -> Summary:
    engine = create_db_engine(config.database_url)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            await seed(db)
            return await load(
                db,
                config.media_dir,
                reset=reset,
                events=spread(plan(), count),
                max_bytes=config.max_upload_bytes,
            )
    finally:
        await engine.dispose()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m timelife.demo",
        description="Load demo children, milestones and photos (local development only).",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="first delete ALL events and children with their images",
    )
    parser.add_argument(
        "--events",
        type=int,
        metavar="N",
        help="load only N milestones spread over the whole period (quicker)",
    )
    args = parser.parse_args(argv)
    if args.events is not None and args.events < 1:
        parser.error("--events must be at least 1")
    config = Settings()
    if not config.allow_insecure_local_login:
        print(
            "Refusing to load demo data: it is meant for local development only. "
            "Set ALLOW_INSECURE_LOCAL_LOGIN=true (loopback origins) to use it.",
            file=sys.stderr,
        )
        return 1
    print(asyncio.run(run(config, reset=args.reset, count=args.events)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
