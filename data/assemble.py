#!/usr/bin/env python3
"""Assemble all digitized TOEIC data into the app's js/data.js."""
import json, os

import pathlib
S = str(pathlib.Path(__file__).parent / "source")
OUT = str(pathlib.Path(__file__).parent.parent / "js" / "data.js")

def load(name):
    with open(os.path.join(S, name)) as f:
        return json.load(f)

timings = load("timings.json")
p12 = load("key-listening-p12.json")["answers"]
p3key = load("key-listening-p3.json")
p4key = load("key-listening-p4.json")
m3key = load("key-m3-reading.json")["answers"]
m5key = load("key-m5-reading.json")["answers"]

m5p3 = load("m5-part3.json"); m5p4 = load("m5-part4.json")
m3p5 = load("m3-part5.json"); m3p6 = load("m3-part6.json"); m3p7 = load("m3-part7.json")
m5p5 = load("m5-part5.json"); m5p6 = load("m5-part6.json"); m5p7 = load("m5-part7.json")

def qseg(n):
    q = timings["questions"].get(str(n))
    return {"start": q["start"], "end": q["end"]} if q else None

def block_for(n):
    for b in timings["blocks"]:
        if n in b["questions"]:
            return b
    return None

GRAPHIC_IMG = {62: "assets/img/g-tile.jpg", 65: "assets/img/g-rooms.jpg", 68: "assets/img/g-reviews.jpg",
               95: "assets/img/g-patterns.jpg", 98: "assets/img/g-packages.jpg"}

def listening_part12():
    part1 = {"part": 1, "directions": "Nghe 4 câu mô tả về bức ảnh và chọn câu mô tả đúng nhất. Câu hỏi và đáp án chỉ có trong audio, không in trên đề.", "items": []}
    part2 = {"part": 2, "directions": "Nghe 1 câu hỏi/câu nói và 3 câu đáp, chọn câu đáp phù hợp nhất. Tất cả chỉ có trong audio.", "items": []}
    for n in range(1, 7):
        k = p12[str(n)]
        part1["items"].append({
            "n": n, "question": "", "image": f"assets/img/p1-q{n}.jpg",
            "choices": {"A": "", "B": "", "C": "", "D": ""},
            "answer": k["answer"], "explanation": k["explanation"],
            "spoken": k.get("spoken"), "audio": qseg(n),
            "uncertain": k.get("uncertain", False),
        })
    for n in range(7, 32):
        k = p12[str(n)]
        part2["items"].append({
            "n": n, "question": "", "choices": {"A": "", "B": "", "C": ""},
            "answer": k["answer"], "explanation": k["explanation"],
            "spoken": k.get("spoken"), "audio": qseg(n),
            "uncertain": k.get("uncertain", False),
        })
    return [part1, part2]

def listening_part34(src, key, partnum, directions):
    answers = key["answers"]
    transcripts = {tuple(t["questions"]): t["text"] for t in key.get("transcripts", [])}
    qmap = {q["number"]: q for q in src["questions"]}
    gmap = {g["id"]: g for g in src.get("graphics", [])}
    part = {"part": partnum, "directions": directions, "items": []}
    blocks = [b for b in timings["blocks"] if b["questions"][0] in qmap]
    for b in blocks:
        qs = []
        for n in b["questions"]:
            q = qmap[n]; k = answers[str(n)]
            qs.append({
                "n": n, "question": q["question"], "choices": q["choices"],
                "answer": k["answer"], "explanation": k["explanation"],
                "uncertain": k.get("uncertain", False),
            })
        item = {
            "questions": qs,
            "audio": {"start": b["start"], "end": b["end"]},
            "transcript": transcripts.get(tuple(b["questions"]), ""),
        }
        gimg = GRAPHIC_IMG.get(b["questions"][0])
        if gimg:
            item["graphicImg"] = gimg
        part["items"].append(item)
    return part

def reading_part5(src, key):
    part = {"part": 5, "directions": "Chọn từ/cụm từ đúng nhất để hoàn thành câu.", "items": []}
    for q in src["questions"]:
        k = key[str(q["number"])]
        part["items"].append({
            "n": q["number"], "question": q["question"], "choices": q["choices"],
            "answer": k["answer"], "explanation": k["explanation"],
            "uncertain": k.get("uncertain", False),
        })
    return part

def load_passage_imgs():
    """{test: {firstQuestionNumber(str): imgPath}} from data/source/passage-imgs-*.json"""
    out = {}
    for f in (pathlib.Path(__file__).parent / "source").glob("passage-imgs-*.json"):
        d = json.load(open(f))
        out.setdefault(d["test"], {}).update(d["map"])
    return out

PASSAGE_IMGS = None  # lazy

def reading_part67(src, key, partnum, directions):
    global PASSAGE_IMGS
    if PASSAGE_IMGS is None:
        PASSAGE_IMGS = load_passage_imgs()
    part = {"part": partnum, "directions": directions, "items": []}
    for p in src["passages"]:
        qs = []
        for q in p["questions"]:
            k = key[str(q["number"])]
            qs.append({
                "n": q["number"], "question": q.get("question", ""), "choices": q["choices"],
                "answer": k["answer"], "explanation": k["explanation"],
                "uncertain": k.get("uncertain", False),
            })
        item = {
            "ptype": p.get("type", ""), "title": p.get("title", ""), "text": p["text"],
            "questions": qs,
        }
        img = PASSAGE_IMGS.get(src["test"], {}).get(str(qs[0]["n"]))
        if img:
            item["img"] = img
        part["items"].append(item)
    return part

P6_DIR = "Đọc đoạn văn có 4 chỗ trống, chọn từ/cụm từ/câu phù hợp nhất cho mỗi chỗ trống [số câu]."
P7_DIR = "Đọc đoạn văn và trả lời các câu hỏi."

tests = {
    "m5-listening": {
        "id": "m5-listening", "kind": "listening",
        "title": "Mock Test 5 — Listening",
        "desc": "Đủ 100 câu Part 1–4, làm theo audio gốc ~46 phút",
        "audioSrc": "assets/audio/mock5.mp3",
        "timings": timings,
        "parts": listening_part12() + [
            listening_part34(m5p3, p3key, 3, "Nghe đoạn hội thoại và trả lời 3 câu hỏi. Hội thoại chỉ nghe được 1 lần trong chế độ thi."),
            listening_part34(m5p4, p4key, 4, "Nghe bài nói ngắn và trả lời 3 câu hỏi."),
        ],
    },
    "m5-reading": {
        "id": "m5-reading", "kind": "reading", "timerMin": 50,
        "title": "Mock Test 5 — Reading",
        "desc": "Part 5–7, câu 101–163 (PDF gốc thiếu câu 164–200)",
        "parts": [
            reading_part5(m5p5, m5key),
            reading_part67(m5p6, m5key, 6, P6_DIR),
            reading_part67(m5p7, m5key, 7, P7_DIR),
        ],
    },
    "m3-reading": {
        "id": "m3-reading", "kind": "reading", "timerMin": 55,
        "title": "Mock Test 3 — Reading",
        "desc": "Part 5–7, câu 101–168 (PDF gốc thiếu câu 169–200)",
        "parts": [
            reading_part5(m3p5, m3key),
            reading_part67(m3p6, m3key, 6, P6_DIR),
            reading_part67(m3p7, m3key, 7, P7_DIR),
        ],
    },
}

# ---- learning extras: per-line transcript segments, Vietnamese translations, vocabulary ----
SRC_DIR = pathlib.Path(__file__).parent / "source"

def load_if(name):
    p = SRC_DIR / name
    if p.exists():
        try:
            return json.load(open(p))
        except Exception as e:
            print(f"WARN {name}: {e}")
    return None

seg_map = load_if("transcript-segments.json") or {}
vi_map = load_if("translations-m5-listening.json") or {}
for part in tests["m5-listening"]["parts"]:
    for it in part["items"]:
        first_q = it["questions"][0]["n"] if "questions" in it else it["n"]
        key = str(first_q)
        if key in seg_map and seg_map[key]:
            it["segs"] = seg_map[key]
        if key in vi_map:
            it["viText"] = vi_map[key]
print("listening extras: segs groups =", len(seg_map), "| vi groups =", len(vi_map))

vocab = []
for v in (load_if("vocab-m5-listening.json") or []):
    item = dict(v)
    item["testId"] = "m5-listening"
    q = v.get("firstQ")
    seg = None
    if q is not None:
        if str(q) in timings["questions"] and q <= 31:
            s = timings["questions"][str(q)]
            seg = {"start": s["start"], "end": s["end"]}
        else:
            for b in timings["blocks"]:
                if b["questions"][0] == q:
                    seg = {"start": b["start"], "end": b["end"]}
                    break
    if seg:
        item["audio"] = seg
    vocab.append(item)
vocab.extend(load_if("vocab-reading.json") or [])
seen_words = set()
vocab = [v for v in vocab if not (v["word"].lower() in seen_words or seen_words.add(v["word"].lower()))]
for i, v in enumerate(vocab):
    v["id"] = f"w{i}"
print("vocab items:", len(vocab))

# merge custom (uploaded) tests: every data/custom/*.json is one complete test object
CUSTOM_DIR = pathlib.Path(__file__).parent / "custom"
if CUSTOM_DIR.is_dir():
    for cf in sorted(CUSTOM_DIR.glob("*.json")):
        try:
            ct = json.load(open(cf))
        except Exception as e:
            print(f"SKIP {cf.name}: invalid JSON ({e})")
            continue
        need = {"id", "kind", "title", "parts"}
        if not need.issubset(ct):
            print(f"SKIP {cf.name}: missing keys {need - set(ct)}")
            continue
        if ct["kind"] == "listening" and not ct.get("audioSrc"):
            print(f"SKIP {cf.name}: listening test without audioSrc")
            continue
        ct.setdefault("custom", True)
        tests[ct["id"]] = ct
        print(f"custom test loaded: {ct['id']} ({cf.name})")

data = {"tests": tests, "vocab": vocab}
with open(OUT, "w") as f:
    f.write("window.TOEIC_DATA = ")
    json.dump(data, f, ensure_ascii=False)
    f.write(";\n")

# sanity checks
total = 0
for tid, t in tests.items():
    n = sum(len(it.get("questions", [it])) if "questions" in it else 1 for p in t["parts"] for it in p["items"])
    nums = []
    for p in t["parts"]:
        for it in p["items"]:
            for q in (it["questions"] if "questions" in it else [it]):
                nums.append(q["n"])
                assert q["answer"] in q["choices"], f"{tid} q{q['n']} answer {q['answer']} not in choices"
    print(tid, len(nums), "questions", "| range", min(nums), "-", max(nums), "| dupes:", len(nums) != len(set(nums)))
    total += len(nums)
print("TOTAL", total, "| data.js size:", os.path.getsize(OUT), "bytes")
