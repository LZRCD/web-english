import itertools
import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
from rapidfuzz import fuzz, process
from scipy.optimize import linear_sum_assignment

try:
    from nltk.corpus import cmudict
except ImportError:
    cmudict = None


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPORT_FILE = ROOT / "tmp" / "full-audio-asr-report.json"
DEFAULT_OUTPUT_FILE = ROOT / "tmp" / "audio-remap-proposal.json"
REVIEW_RATE_THRESHOLD = 0.2
ACCEPT_SCORE = 70


def normalize(value: str) -> str:
    normalized = re.sub(r"[^a-z]+", " ", value.lower()).strip()
    return normalized.replace("honour", "honor")


def load_pronunciations():
    if cmudict is None:
        return {}
    try:
        return cmudict.dict()
    except LookupError:
        return {}


def phonetic_codes(value: str, pronunciations: dict) -> list[str]:
    words = normalize(value).split()
    variants_by_word = [pronunciations.get(word, []) for word in words]
    if not variants_by_word or any(not variants for variants in variants_by_word):
        return []
    codes = []
    for parts in itertools.product(*variants_by_word):
        phones = [
            re.sub(r"\d", "", phone)
            for pronunciation in parts
            for phone in pronunciation
        ]
        codes.append(" ".join(phones))
        if len(codes) >= 12:
            break
    return codes


def score_matrix(recognized: list[str], expected: list[str], pronunciations: dict) -> np.ndarray:
    recognized_normalized = [normalize(value).replace(" ", "") for value in recognized]
    expected_normalized = [normalize(value).replace(" ", "") for value in expected]
    lexical = process.cdist(
        recognized_normalized,
        expected_normalized,
        scorer=fuzz.ratio,
        dtype=np.float32,
    )
    recognized_phones = [
        (phonetic_codes(value, pronunciations) or [""])[0]
        for value in recognized
    ]
    expected_phones = [
        (phonetic_codes(value, pronunciations) or [""])[0]
        for value in expected
    ]
    phonetic = process.cdist(
        recognized_phones,
        expected_phones,
        scorer=fuzz.ratio,
        dtype=np.float32,
    )
    missing_phone_rows = np.array([not value for value in recognized_phones])
    missing_phone_columns = np.array([not value for value in expected_phones])
    phonetic[missing_phone_rows, :] = 0
    phonetic[:, missing_phone_columns] = 0
    return np.maximum(lexical, phonetic)


def main() -> None:
    parser = argparse.ArgumentParser(description="根据逐词识别报告生成音频重排方案")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_FILE)
    parser.add_argument("--alternate-report", type=Path, action="append")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_FILE)
    parser.add_argument("--review-threshold", type=float, default=REVIEW_RATE_THRESHOLD)
    args = parser.parse_args()
    args.report = args.report.resolve()
    args.output = args.output.resolve()
    report = json.loads(args.report.read_text(encoding="utf-8"))
    alternate_by_id = {}
    for alternate_path in args.alternate_report or []:
        alternate_path = alternate_path.resolve()
        alternate = json.loads(alternate_path.read_text(encoding="utf-8"))
        alternate_by_id.update({
            item["id"]: item
            for item in alternate["results"]
        })
    grouped = defaultdict(list)
    for item in report["results"]:
        grouped[item["file"]].append(item)
    pronunciations = load_pronunciations()
    proposals = {}
    summaries = {}

    for file, items in sorted(grouped.items()):
        items.sort(key=lambda item: float(item["start"]))
        review_count = sum(item["status"] == "review" for item in items)
        if review_count / len(items) < args.review_threshold:
            continue

        pending_clips = items
        pending_words = items
        primary_matrix = score_matrix(
            [item["recognized"] for item in pending_clips],
            [item["word"] for item in pending_words],
            pronunciations,
        )
        matrix = primary_matrix.copy()
        alternate_matrix = None
        if alternate_by_id:
            alternate_matrix = score_matrix(
                [
                    alternate_by_id.get(item["id"], item)["recognized"]
                    for item in pending_clips
                ],
                [item["word"] for item in pending_words],
                pronunciations,
            )
            matrix = np.maximum(matrix, alternate_matrix)
        # 完全一致的原映射是可靠锚点；近似匹配仍参与全局重排。
        for index, item in enumerate(items):
            alternate_item = alternate_by_id.get(item["id"])
            if item["status"] == "exact" or (
                alternate_item and alternate_item.get("status") == "exact"
            ):
                matrix[index, index] = 110
        row_indices, column_indices = linear_sum_assignment(matrix, maximize=True)
        accepted = []
        rejected = []
        assigned_word_ids = set()
        for row, column in zip(row_indices, column_indices):
            clip = pending_clips[row]
            word = pending_words[column]
            score = float(matrix[row, column])
            recognized = clip["recognized"]
            if (
                alternate_matrix is not None
                and alternate_matrix[row, column] > primary_matrix[row, column]
            ):
                recognized = alternate_by_id[clip["id"]]["recognized"]
            record = {
                "sourceWordId": clip["id"],
                "targetWordId": word["id"],
                "targetWord": word["word"],
                "meaning": word["meaning"],
                "recognized": recognized,
                "score": round(score, 1),
                "file": file,
                "start": clip["start"],
                "end": clip["end"],
            }
            if score >= ACCEPT_SCORE:
                accepted.append(record)
                assigned_word_ids.add(word["id"])
            else:
                rejected.append(record)
        missing_words = [
            {
                "id": item["id"],
                "word": item["word"],
                "meaning": item["meaning"],
            }
            for item in items
            if item["id"] not in assigned_word_ids
        ]
        proposals[file] = {
            "accepted": accepted,
            "rejected": rejected,
            "missingWords": missing_words,
        }
        summaries[file] = {
            "wordCount": len(items),
            "originalReviewCount": review_count,
            "preservedExactCount": sum(item["status"] == "exact" for item in items),
            "acceptedRemapCount": len(accepted),
            "changedMappingCount": sum(
                item["sourceWordId"] != item["targetWordId"]
                for item in accepted
            ),
            "fallbackCount": len(missing_words),
            "rejectedClipCount": len(rejected),
        }

    payload = {
        "metadata": {
            "sourceReport": str(args.report.relative_to(ROOT)).replace("\\", "/"),
            "reviewRateThreshold": args.review_threshold,
            "acceptScore": ACCEPT_SCORE,
            "affectedFileCount": len(proposals),
        },
        "summaries": summaries,
        "files": proposals,
    }
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload["metadata"], ensure_ascii=False, indent=2))
    for file, summary in summaries.items():
        print(file, json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
