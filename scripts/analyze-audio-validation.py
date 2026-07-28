import json
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPORT_FILE = ROOT / "tmp" / "full-audio-asr-report.json"


def normalize(value: str) -> str:
    return re.sub(r"[^a-z]+", " ", value.lower()).strip().replace("honour", "honor")


def longest_review_run(items: list[dict]) -> int:
    longest = 0
    current = 0
    for item in items:
        if item["status"] == "review":
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    return longest


def main() -> None:
    report = json.loads(REPORT_FILE.read_text(encoding="utf-8"))
    grouped = defaultdict(list)
    for item in report["results"]:
        grouped[item["file"]].append(item)
    analysis = []
    for file, items in grouped.items():
        items.sort(key=lambda item: float(item["start"]))
        expected_positions = defaultdict(list)
        for index, item in enumerate(items):
            expected_positions[normalize(item["word"])].append(index)
        offsets = Counter()
        anchors = []
        for index, item in enumerate(items):
            recognized = normalize(item["recognized"])
            candidates = {recognized, *recognized.split()}
            matches = {
                position
                for candidate in candidates
                if len(candidate) >= 3
                for position in expected_positions.get(candidate, [])
            }
            if len(matches) == 1:
                position = matches.pop()
                offset = position - index
                offsets[offset] += 1
                anchors.append({
                    "clipPosition": index + 1,
                    "recognized": item["recognized"],
                    "matchedWord": items[position]["word"],
                    "expectedPosition": position + 1,
                    "offset": offset,
                })
        review_count = sum(item["status"] == "review" for item in items)
        analysis.append({
            "file": file,
            "wordCount": len(items),
            "reviewCount": review_count,
            "reviewRate": round(review_count / len(items), 3),
            "longestReviewRun": longest_review_run(items),
            "topOffsets": offsets.most_common(5),
            "anchors": anchors,
        })
    analysis.sort(key=lambda item: (item["reviewRate"], item["longestReviewRun"]), reverse=True)
    for item in analysis:
        if item["reviewRate"] < 0.2:
            continue
        print(
            f"{item['file']}: review={item['reviewCount']}/{item['wordCount']} "
            f"run={item['longestReviewRun']} offsets={item['topOffsets']}"
        )


if __name__ == "__main__":
    main()
