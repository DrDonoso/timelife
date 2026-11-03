import re
import unicodedata

SLUG_MAX_LENGTH = 80


def normalize_search(text: str) -> str:
    """Accent/case-insensitive search form: NFKD, no combining marks, casefold, single spaces."""
    decomposed = unicodedata.normalize("NFKD", text)
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(without_marks.casefold().split())


def slugify(text: str) -> str:
    """ASCII slug matching ``^[a-z0-9]+(-[a-z0-9]+)*$``, at most 80 characters ('child' if empty)."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    return slug[:SLUG_MAX_LENGTH].rstrip("-") or "child"


def search_tokens(q: str) -> list[str]:
    """Distinct normalized tokens; an event matches when its title_search contains all of them."""
    return list(dict.fromkeys(normalize_search(q).split()))
