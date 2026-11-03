"""Export the API contract (OpenAPI JSON) without credentials, a database or network access."""

import argparse
import json
from pathlib import Path

from timelife.app import create_app

OUTPUT = Path(__file__).resolve().parents[1] / "frontend" / "src" / "api" / "openapi.json"


def render() -> str:
    return json.dumps(create_app().openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true", help="fail when the exported contract is out of date"
    )
    args = parser.parse_args()
    rendered = render()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != rendered:
            raise SystemExit("API contract is stale; run: uv run python scripts/export_openapi.py")
        return
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(rendered, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
