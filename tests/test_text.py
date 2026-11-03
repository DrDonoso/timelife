import re

import pytest

from timelife.text import normalize_search, search_tokens, slugify


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("  Primer   DIENTE ", "primer diente"),
        ("Ñandú, árbol y CAMIÓN", "nandu, arbol y camion"),
        ("Straße", "strasse"),
        ("ﬁesta\tde\ncumpleaños", "fiesta de cumpleanos"),
        ("", ""),
    ],
)
def test_normalize_search(text: str, expected: str) -> None:
    assert normalize_search(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Lucía", "lucia"),
        ("  María José  ", "maria-jose"),
        ("Ñoño & Peña!!", "nono-pena"),
        ("--already--slugged--", "already-slugged"),
        ("", "child"),
        ("!!!", "child"),
        ("李", "child"),
    ],
)
def test_slugify(text: str, expected: str) -> None:
    assert slugify(text) == expected


def test_slugify_limits_length_without_trailing_dash() -> None:
    slug = slugify("a" * 79 + " b c")
    assert len(slug) <= 80
    assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug)
    assert slugify("x" * 200) == "x" * 80


def test_search_tokens() -> None:
    assert search_tokens("  Primer  DIENTE primer ") == ["primer", "diente"]
    assert search_tokens("Ñandú") == ["nandu"]
    assert search_tokens("   ") == []
    title = normalize_search("El primer diente de Lucía")
    assert all(token in title for token in search_tokens("LUCIA diente"))
