#!/usr/bin/env python3
"""Assemble all digitized TOEIC data into the app's js/data.js."""
import json, os, re

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
        for p in ct.get("parts", []):
            if p.get("part") in (6, 7):
                for it in p.get("items", []):
                    if not it.get("questions"):
                        continue
                    first_q = it["questions"][0]["n"]
                    img = it.get("img")
                    if not img:
                        raise AssertionError(f"{ct['id']} part {p['part']} q{first_q}: missing passage snapshot img")
                    if not (pathlib.Path(__file__).parent.parent / img).is_file():
                        raise AssertionError(f"{ct['id']} part {p['part']} q{first_q}: missing image file {img}")
        ct.setdefault("custom", True)
        tests[ct["id"]] = ct
        print(f"custom test loaded: {ct['id']} ({cf.name})")


# ---- auto vocabulary from uploaded/custom tests ----
# Keep this list curated. We only create cards for terms with a reviewed Vietnamese meaning,
# so uploaded tests gain useful vocabulary without noisy token extraction.
AUTO_VOCAB_BANK = [
    {"word": "be responsible for", "type": "phr", "meaning": "chịu trách nhiệm về", "family": "responsibility", "variants": ["responsible for"]},
    {"word": "purchase", "type": "v/n", "meaning": "mua; giao dịch mua", "family": "buying", "variants": ["purchase", "purchases", "purchasing", "purchased"]},
    {"word": "office supplies", "type": "n", "meaning": "văn phòng phẩm", "family": "office", "variants": ["office supply", "office supplies"]},
    {"word": "approval", "type": "n", "meaning": "sự chấp thuận, phê duyệt", "family": "approval", "variants": ["approval", "approvals"]},
    {"word": "present", "type": "v", "meaning": "trình bày, giới thiệu", "family": "presentation", "variants": ["present", "presents", "presented", "presenting"]},
    {"word": "research", "type": "n/v", "meaning": "nghiên cứu; tìm hiểu", "family": "research", "variants": ["research", "researches", "researched", "researching"]},
    {"word": "marketing team", "type": "n", "meaning": "nhóm/bộ phận tiếp thị", "family": "marketing", "variants": ["marketing team", "marketing department"]},
    {"word": "available", "type": "adj", "meaning": "có sẵn, còn trống, sẵn dùng", "family": "availability", "variants": ["available", "availability"]},
    {"word": "ship", "type": "v", "meaning": "gửi hàng, vận chuyển", "family": "shipping", "variants": ["ship", "ships", "shipped", "shipping"]},
    {"word": "branch", "type": "n", "meaning": "chi nhánh", "family": "branch", "variants": ["branch", "branches"]},
    {"word": "quality assurance", "type": "n", "meaning": "đảm bảo/kiểm định chất lượng", "family": "quality", "variants": ["quality assurance", "QA", "quality control"]},
    {"word": "product testing", "type": "n", "meaning": "việc thử nghiệm sản phẩm", "family": "quality", "variants": ["product testing", "testing products", "test products"]},
    {"word": "delivery van", "type": "n", "meaning": "xe tải/xe van giao hàng", "family": "delivery", "variants": ["delivery van", "delivery vehicle"]},
    {"word": "graphic design", "type": "n", "meaning": "thiết kế đồ họa", "family": "design", "variants": ["graphic design", "graphic designs", "graphics"]},
    {"word": "sample", "type": "n/adj", "meaning": "mẫu, bản mẫu", "family": "sample", "variants": ["sample", "samples"]},
    {"word": "require", "type": "v", "meaning": "yêu cầu, cần", "family": "requirement", "variants": ["require", "requires", "required", "requiring", "requirement", "requirements"]},
    {"word": "maintenance", "type": "n", "meaning": "bảo trì, chăm sóc duy trì", "family": "maintenance", "variants": ["maintenance", "maintain"]},
    {"word": "paperwork", "type": "n", "meaning": "giấy tờ, hồ sơ", "family": "documentation", "variants": ["paperwork"]},
    {"word": "mobile app", "type": "n", "meaning": "ứng dụng điện thoại", "family": "technology", "variants": ["mobile app", "app"]},
    {"word": "recognize", "type": "v", "meaning": "nhận ra, nhận diện", "family": "recognition", "variants": ["recognize", "recognizes", "recognized", "recognition"]},
    {"word": "experiment", "type": "n", "meaning": "thí nghiệm, thử nghiệm", "family": "research", "variants": ["experiment", "experiments"]},
    {"word": "speed up", "type": "phr", "meaning": "đẩy nhanh, tăng tốc", "family": "process", "variants": ["speed up", "speeding up", "sped up"]},
    {"word": "process", "type": "n/v", "meaning": "quy trình; xử lý", "family": "process", "variants": ["process", "processes", "processed", "processing"]},
    {"word": "upgrade", "type": "v/n", "meaning": "nâng cấp; sự nâng cấp", "family": "improvement", "variants": ["upgrade", "upgrades", "upgraded", "upgrading"]},
    {"word": "shuttle bus", "type": "n", "meaning": "xe buýt đưa đón", "family": "transportation", "variants": ["shuttle bus", "shuttle"]},
    {"word": "staff website", "type": "n", "meaning": "trang web nội bộ của nhân viên", "family": "office", "variants": ["staff website"]},
    {"word": "symptom", "type": "n", "meaning": "triệu chứng", "family": "health", "variants": ["symptom", "symptoms"]},
    {"word": "apply", "type": "v", "meaning": "bôi/thoa; nộp đơn; áp dụng", "family": "application", "variants": ["apply", "applies", "applied", "applying"]},
    {"word": "market conditions", "type": "n", "meaning": "điều kiện/tình hình thị trường", "family": "business", "variants": ["market condition", "market conditions"]},
    {"word": "assorted", "type": "adj", "meaning": "nhiều loại, tổng hợp", "family": "product", "variants": ["assorted"]},
    {"word": "discount", "type": "n/v", "meaning": "giảm giá; khoản giảm giá", "family": "pricing", "variants": ["discount", "discounts", "discounted"]},
    {"word": "undergraduate", "type": "n/adj", "meaning": "sinh viên đại học; bậc đại học", "family": "education", "variants": ["undergraduate", "undergraduates"]},
    {"word": "major in", "type": "phr", "meaning": "học/chuyên ngành", "family": "education", "variants": ["majoring in", "major in", "majored in"]},
    {"word": "specially trained", "type": "phr", "meaning": "được đào tạo chuyên biệt", "family": "training", "variants": ["specially trained", "special training"]},
    {"word": "contract", "type": "n", "meaning": "hợp đồng", "family": "contract", "variants": ["contract", "contracts"]},
    {"word": "technician", "type": "n", "meaning": "kỹ thuật viên", "family": "job", "variants": ["technician", "technicians"]},
    {"word": "manufacturer", "type": "n", "meaning": "nhà sản xuất", "family": "manufacturing", "variants": ["manufacturer", "manufacturers"]},
    {"word": "raw materials", "type": "n", "meaning": "nguyên vật liệu thô", "family": "manufacturing", "variants": ["raw material", "raw materials"]},
    {"word": "distributor", "type": "n", "meaning": "nhà phân phối", "family": "sales", "variants": ["distributor", "distributors"]},
    {"word": "consumer", "type": "n", "meaning": "người tiêu dùng", "family": "sales", "variants": ["consumer", "consumers"]},
    {"word": "memo", "type": "n", "meaning": "bản ghi nhớ, thông báo nội bộ", "family": "office", "variants": ["memo", "memorandum"]},
    {"word": "break room", "type": "n", "meaning": "phòng nghỉ của nhân viên", "family": "office", "variants": ["break room"]},
    {"word": "customer", "type": "n", "meaning": "khách hàng", "family": "customer", "variants": ["customer", "customers"]},
    {"word": "misunderstanding", "type": "n", "meaning": "sự hiểu nhầm", "family": "communication", "variants": ["misunderstanding", "misunderstandings"]},
    {"word": "make it up to", "type": "phr", "meaning": "bù đắp cho ai", "family": "customer", "variants": ["make it up to", "make up for"]},
    {"word": "rental contract", "type": "n", "meaning": "hợp đồng thuê", "family": "contract", "variants": ["rental contract", "lease"]},
    {"word": "audition", "type": "n/v", "meaning": "buổi thử giọng; thử giọng", "family": "recruitment", "variants": ["audition", "auditions", "auditioning"]},
    {"word": "candidate", "type": "n", "meaning": "ứng viên", "family": "recruitment", "variants": ["candidate", "candidates"]},
    {"word": "cycling trail", "type": "n", "meaning": "đường mòn/đường dành cho xe đạp", "family": "travel", "variants": ["cycling trail", "bike trail"]},
    {"word": "fund", "type": "v/n", "meaning": "tài trợ; quỹ", "family": "finance", "variants": ["fund", "funds", "funded", "funding"]},
    {"word": "proposal", "type": "n", "meaning": "đề xuất, bản đề xuất", "family": "planning", "variants": ["proposal", "proposals"]},
    {"word": "persuasive", "type": "adj", "meaning": "có sức thuyết phục", "family": "communication", "variants": ["persuasive", "persuade"]},
    {"word": "reimbursement", "type": "n", "meaning": "sự hoàn tiền/hoàn chi phí", "family": "finance", "variants": ["reimbursement", "reimburse", "reimbursed"]},
    {"word": "business trip", "type": "n", "meaning": "chuyến công tác", "family": "travel", "variants": ["business trip", "business trips"]},
    {"word": "client", "type": "n", "meaning": "khách hàng, khách hàng doanh nghiệp", "family": "customer", "variants": ["client", "clients"]},
    {"word": "guidebook", "type": "n", "meaning": "sổ/sách hướng dẫn", "family": "documentation", "variants": ["guidebook", "guidebooks"]},
    {"word": "vendor", "type": "n", "meaning": "nhà cung cấp", "family": "sales", "variants": ["vendor", "vendors"]},
    {"word": "messenger service", "type": "n", "meaning": "dịch vụ chuyển phát/nội bộ", "family": "delivery", "variants": ["messenger service"]},
    {"word": "urgent", "type": "adj", "meaning": "khẩn cấp, gấp", "family": "priority", "variants": ["urgent", "urgency"]},
    {"word": "prioritize", "type": "v", "meaning": "ưu tiên", "family": "priority", "variants": ["prioritize", "prioritise", "priority", "priorities"]},
    {"word": "visitor", "type": "n", "meaning": "khách tham quan", "family": "visitor", "variants": ["visitor", "visitors"]},
    {"word": "presence", "type": "n", "meaning": "sự hiện diện", "family": "presence", "variants": ["presence"]},
    {"word": "specialist", "type": "n", "meaning": "chuyên viên, chuyên gia", "family": "job", "variants": ["specialist", "specialists"]},
    {"word": "screening", "type": "n", "meaning": "sàng lọc; buổi chiếu", "family": "recruitment", "variants": ["screening", "screenings"]},
    {"word": "application", "type": "n", "meaning": "đơn ứng tuyển; sự đăng ký/ứng dụng", "family": "application", "variants": ["application", "applications"]},
    {"word": "reduced prices", "type": "n", "meaning": "giá giảm, giá ưu đãi", "family": "pricing", "variants": ["reduced price", "reduced prices"]},
    {"word": "guidelines", "type": "n", "meaning": "hướng dẫn, quy định", "family": "policy", "variants": ["guideline", "guidelines"]},
    {"word": "absence", "type": "n", "meaning": "sự vắng mặt", "family": "attendance", "variants": ["absence", "absences", "absent"]},
    {"word": "firmly sealed", "type": "phr", "meaning": "được đóng kín chắc chắn", "family": "packaging", "variants": ["firmly sealed", "sealed firmly"]},
    {"word": "vital", "type": "adj", "meaning": "rất quan trọng, thiết yếu", "family": "importance", "variants": ["vital"]},
    {"word": "assess", "type": "v", "meaning": "đánh giá, thẩm định", "family": "evaluation", "variants": ["assess", "assesses", "assessed", "assessment"]},
    {"word": "relocation", "type": "n", "meaning": "việc chuyển địa điểm/di dời", "family": "relocation", "variants": ["relocation", "relocate", "relocated"]},
    {"word": "promptly", "type": "adv", "meaning": "nhanh chóng, ngay lập tức", "family": "speed", "variants": ["promptly"]},
    {"word": "inspection", "type": "n", "meaning": "sự kiểm tra, thanh tra", "family": "quality", "variants": ["inspection", "inspections"]},
    {"word": "agreement", "type": "n", "meaning": "thỏa thuận, hợp đồng", "family": "contract", "variants": ["agreement", "agreements"]},
    {"word": "commuter", "type": "n", "meaning": "người đi làm hằng ngày", "family": "transportation", "variants": ["commuter", "commuters"]},
    {"word": "floor space", "type": "n", "meaning": "diện tích mặt sàn", "family": "real_estate", "variants": ["floor space"]},
    {"word": "compatible", "type": "adj", "meaning": "tương thích, phù hợp", "family": "technology", "variants": ["compatible", "compatibility"]},
    {"word": "package", "type": "v/n", "meaning": "đóng gói; gói hàng", "family": "packaging", "variants": ["package", "packages", "packaging", "packaged"]},
    {"word": "come across", "type": "phr", "meaning": "tình cờ gặp/tìm thấy", "family": "discovery", "variants": ["come across", "came across"]},
    {"word": "anonymity", "type": "n", "meaning": "sự ẩn danh", "family": "privacy", "variants": ["anonymity", "anonymous"]},
    {"word": "forum", "type": "n", "meaning": "diễn đàn, buổi thảo luận", "family": "communication", "variants": ["forum", "forums"]},
    {"word": "shorthand", "type": "n", "meaning": "cách viết tắt, ký hiệu viết tắt", "family": "communication", "variants": ["shorthand"]},
    {"word": "pantry", "type": "n", "meaning": "phòng/khu để đồ ăn, phòng ăn nhỏ", "family": "office", "variants": ["pantry", "pantries"]},
    {"word": "current affairs", "type": "n", "meaning": "thời sự, các vấn đề hiện tại", "family": "media", "variants": ["current affairs"]},
    {"word": "interviewee", "type": "n", "meaning": "người được phỏng vấn", "family": "interview", "variants": ["interviewee", "interviewees"]},
    {"word": "backyard barbecue", "type": "n", "meaning": "tiệc nướng ở sân sau", "family": "event", "variants": ["backyard barbecue", "backyard barbecues"]},
    {"word": "pool party", "type": "n", "meaning": "tiệc bên hồ bơi", "family": "event", "variants": ["pool party", "pool parties"]},
    {"word": "model home", "type": "n", "meaning": "nhà mẫu", "family": "real_estate", "variants": ["model home", "model homes"]},
    {"word": "stain removal", "type": "n", "meaning": "dịch vụ/việc tẩy vết bẩn", "family": "service", "variants": ["stain removal", "remove stains"]},
    {"word": "complimentary", "type": "adj", "meaning": "miễn phí, được tặng kèm", "family": "pricing", "variants": ["complimentary"]},
    {"word": "internship program", "type": "n", "meaning": "chương trình thực tập", "family": "recruitment", "variants": ["internship program", "internship"]},
    {"word": "alumni", "type": "n", "meaning": "cựu sinh viên", "family": "education", "variants": ["alumni", "alumnus", "alumna"]},
    {"word": "workshop", "type": "n", "meaning": "buổi hội thảo/lớp thực hành", "family": "training", "variants": ["workshop", "workshops"]},
    {"word": "participant", "type": "n", "meaning": "người tham dự", "family": "event", "variants": ["participant", "participants"]},
]


def clean_text(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def term_pattern(term):
    return re.compile(r"(?<![A-Za-z])" + re.escape(term).replace(r"\ ", r"\s+") + r"(?![A-Za-z])", re.I)


def source_sentence(text, terms):
    text = clean_text(text)
    if not text:
        return ""
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    pats = [term_pattern(t) for t in terms if t]
    for sent in parts:
        sent = clean_text(sent)
        if sent and any(p.search(sent) for p in pats):
            return sent[:260]
    return text[:260]


def iter_vocab_sources(test):
    for part in test.get("parts", []):
        for it in part.get("items", []):
            qlist = it.get("questions") or [it]
            first_q = qlist[0].get("n") if qlist else it.get("n")
            pieces = [it.get("ptype"), it.get("title"), it.get("text"), it.get("transcript"), it.get("viText")]
            for q in qlist:
                pieces.extend([q.get("question"), q.get("explanation")])
                pieces.extend((q.get("choices") or {}).values())
                spoken = q.get("spoken") or {}
                pieces.append(spoken.get("question"))
                pieces.extend((spoken.get("choices") or {}).values())
            text = clean_text(" ".join(clean_text(x) for x in pieces if x))
            if text:
                yield {
                    "text": text,
                    "testId": test.get("id"),
                    "testTitle": test.get("title"),
                    "custom": bool(test.get("custom")),
                    "sourceKind": test.get("kind"),
                    "firstQ": first_q,
                    "audio": it.get("audio") if test.get("kind") == "listening" else None,
                }


def build_auto_vocab_items(tests, existing_words):
    items = []
    used = set(existing_words)
    sources = []
    for t in tests.values():
        if not t.get("custom"):
            continue
        sources.extend(iter_vocab_sources(t))
    for entry in AUTO_VOCAB_BANK:
        word_key = entry["word"].lower()
        if word_key in used:
            continue
        variants = entry.get("variants") or [entry["word"]]
        pats = [term_pattern(v) for v in variants]
        for src in sources:
            if not any(p.search(src["text"]) for p in pats):
                continue
            item = {
                "word": entry["word"],
                "type": entry.get("type", ""),
                "meaning": entry["meaning"],
                "example": source_sentence(src["text"], variants),
                "exampleVi": "",
                "testId": src["testId"],
                "testTitle": src["testTitle"],
                "firstQ": src["firstQ"],
                "custom": src["custom"],
                "sourceKind": src["sourceKind"],
                "family": entry.get("family", "general"),
                "studyMode": "phrase" if entry.get("type") == "phr" or " " in entry["word"].strip() else "word",
                "auto": True,
            }
            if src.get("audio"):
                item["audio"] = src["audio"]
            items.append(item)
            used.add(word_key)
            break
    return items


def enrich_vocab_items(items):
    deduped = []
    seen = set()
    for raw in items:
        if not raw.get("word") or not raw.get("meaning"):
            continue
        item = dict(raw)
        key = item["word"].lower().strip()
        if key in seen:
            continue
        seen.add(key)
        item.setdefault("studyMode", "phrase" if item.get("type") == "phr" or " " in item["word"].strip() else "word")
        item.setdefault("family", item.get("studyMode", "word"))
        item.setdefault("sourceKind", "listening" if item.get("testId") == "m5-listening" else "reading")
        deduped.append(item)
    by_family = {}
    for item in deduped:
        by_family.setdefault(item.get("family") or "general", []).append(item["word"])
    for item in deduped:
        fam = by_family.get(item.get("family") or "general", [])
        item["related"] = [w for w in fam if w.lower() != item["word"].lower()][:5]
    for i, item in enumerate(deduped):
        item["id"] = f"w{i}"
    return deduped

_existing_vocab_words = {v["word"].lower().strip() for v in vocab if v.get("word")}
auto_vocab = build_auto_vocab_items(tests, _existing_vocab_words)
vocab.extend(auto_vocab)
vocab = enrich_vocab_items(vocab)
print("auto vocab from uploads:", len(auto_vocab), "| vocab items:", len(vocab))

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
