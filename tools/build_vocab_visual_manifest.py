#!/usr/bin/env python3
"""Build the production queue for contextual vocabulary visuals.

The app should only show vocabulary visuals that have been reviewed and mapped
in data/source/vocab-visuals.json. This script creates a complete queue for the
remaining cards so image generation can be done in controlled batches.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_JS = ROOT / "js" / "data.js"
VISUALS_JSON = ROOT / "data" / "source" / "vocab-visuals.json"
OUT = ROOT / "data" / "source" / "vocab-visual-manifest.json"
GENERATED_DIR = ROOT / "assets" / "img" / "vocab" / "generated"


def load_app_data() -> dict:
    raw = DATA_JS.read_text(encoding="utf-8")
    prefix = "window.TOEIC_DATA = "
    suffix = ";\n"
    if not raw.startswith(prefix):
        raise ValueError(f"{DATA_JS} does not start with {prefix!r}")
    if raw.endswith(suffix):
        raw = raw[len(prefix) : -len(suffix)]
    else:
        raw = raw[len(prefix) :].rstrip("; \n")
    return json.loads(raw)


def load_visuals() -> dict:
    if not VISUALS_JSON.exists():
        return {}
    return json.loads(VISUALS_JSON.read_text(encoding="utf-8"))


def clean_text(value: object, max_len: int = 260) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def visual_key(word: str) -> str:
    return re.sub(r"\s+", " ", (word or "").strip().lower())


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "vocab"


def item_prompt(v: dict) -> str:
    word = clean_text(v.get("word"), 80)
    meaning = clean_text(v.get("meaning"), 120)
    example = clean_text(v.get("example"), 220)
    example_vi = clean_text(v.get("exampleVi"), 220)
    kind = "a phrase/collocation" if (v.get("studyMode") == "phrase" or " " in word) else "a single vocabulary word"
    source = "a TOEIC Listening context" if v.get("sourceKind") == "listening" else "a TOEIC Reading business context"
    vi_clause = f'Vietnamese context: "{example_vi}" ' if example_vi else ""
    return (
        f"Create one realistic educational illustration for {source}. "
        f"Target vocabulary: {word} ({kind}). Vietnamese meaning: {meaning}. "
        f"Represent the meaning through a clear real-world scene, object, or human action. "
        f"Use this example context as the scene brief: \"{example}\" "
        f"{vi_clause}"
        "Horizontal 16:9 composition, bright neutral background, no text labels, no logos, no watermark, "
        "not a diagram, not abstract icon art. The image must be easy to understand at thumbnail size."
    )


def build_manifest() -> dict:
    data = load_app_data()
    visuals = load_visuals()
    items = []
    for idx, v in enumerate(data.get("vocab", [])):
        word = clean_text(v.get("word"), 80)
        key = visual_key(word)
        slug = f"{idx + 1:03d}-{slugify(word)}"
        exact = visuals.get(key) or {}
        exact_img = exact.get("img")
        asset = f"assets/img/vocab/generated/{slug}.png"
        existing_path = ROOT / exact_img if exact_img else None
        target_path = ROOT / asset
        status = "ready" if exact_img and existing_path and existing_path.exists() else "pending"
        if target_path.exists() and status != "ready":
            status = "generated-unmapped"
        items.append(
            {
                "id": v.get("id") or f"w{idx}",
                "word": word,
                "type": clean_text(v.get("type"), 30),
                "studyMode": v.get("studyMode") or ("phrase" if " " in word else "word"),
                "sourceKind": v.get("sourceKind") or "",
                "custom": bool(v.get("custom")),
                "meaning": clean_text(v.get("meaning"), 180),
                "example": clean_text(v.get("example"), 320),
                "exampleVi": clean_text(v.get("exampleVi"), 320),
                "testId": v.get("testId") or "",
                "testTitle": v.get("testTitle") or "",
                "firstQ": v.get("firstQ"),
                "synonyms": [clean_text(x, 80) for x in (v.get("synonyms") or v.get("related") or [])],
                "slug": slug,
                "targetAsset": asset,
                "mappedAsset": exact_img or "",
                "status": status,
                "prompt": item_prompt(v),
            }
        )

    summary = {
        "total": len(items),
        "ready": sum(1 for x in items if x["status"] == "ready"),
        "generatedUnmapped": sum(1 for x in items if x["status"] == "generated-unmapped"),
        "pending": sum(1 for x in items if x["status"] == "pending"),
        "uploaded": sum(1 for x in items if x["custom"]),
        "listening": sum(1 for x in items if x["sourceKind"] == "listening"),
        "reading": sum(1 for x in items if x["sourceKind"] == "reading"),
    }
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "imagePolicy": {
            "showOnlyExactReviewedVisuals": True,
            "assetDirectory": "assets/img/vocab/generated/",
            "mappingFile": "data/source/vocab-visuals.json",
            "notes": "Do not map generic/concept fallback images. Each ready item needs a context-specific asset reviewed against its example.",
        },
        "summary": summary,
        "items": items,
    }


def main() -> None:
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    manifest = build_manifest()
    OUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest["summary"], ensure_ascii=False, indent=2))
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
