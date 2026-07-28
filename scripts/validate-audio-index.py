import argparse
import itertools
import json
import os
import re
import shutil
import subprocess
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
import torch
from transformers import WhisperForConditionalGeneration, WhisperProcessor

try:
    from nltk.corpus import cmudict
except ImportError:
    cmudict = None


ROOT = Path(__file__).resolve().parents[1]
INDEX_FILE = ROOT / "public" / "data" / "audio-index.json"
REDBOOK_FILE = ROOT / "public" / "data" / "redbook.json"
PUBLIC_ROOT = ROOT / "public"
DEFAULT_OUTPUT = ROOT / "tmp" / "full-audio-asr-report.json"
DEFAULT_MODEL_NAME = "openai/whisper-tiny.en"
SAMPLE_RATE = 16000


def find_ffmpeg() -> str:
    configured = os.environ.get("FFMPEG_PATH")
    if configured and Path(configured).is_file():
        return configured
    discovered = shutil.which("ffmpeg")
    if discovered:
        return discovered
    package_root = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    matches = sorted(package_root.glob("Gyan.FFmpeg*/**/bin/ffmpeg.exe"))
    if not matches:
        raise RuntimeError("找不到 FFmpeg")
    return str(matches[-1])


def decode_audio(ffmpeg: str, public_file: str) -> np.ndarray:
    source = PUBLIC_ROOT / public_file.removeprefix("/")
    result = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-ar",
            str(SAMPLE_RATE),
            "-ac",
            "1",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
    )
    return np.frombuffer(result.stdout, dtype=np.float32)


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


def word_phones(word: str, pronunciations: dict) -> list[list[str]]:
    variants = pronunciations.get(word, [])
    return [[re.sub(r"\d", "", phone) for phone in variant] for variant in variants]


def phrase_phone_variants(value: str, pronunciations: dict) -> list[list[str]]:
    words = normalize(value).split()
    choices = [word_phones(word, pronunciations) for word in words]
    if not choices or any(not variants for variants in choices):
        return []
    return [
        list(itertools.chain.from_iterable(parts))
        for parts in itertools.product(*choices)
    ][:24]


def phonetic_similarity(expected: str, recognized: str, pronunciations: dict) -> float:
    expected_variants = phrase_phone_variants(expected, pronunciations)
    recognized_variants = phrase_phone_variants(recognized, pronunciations)
    if not expected_variants or not recognized_variants:
        return 0.0
    return max(
        SequenceMatcher(None, left, right).ratio()
        for left in expected_variants
        for right in recognized_variants
    )


def compare(expected: str, recognized: str, pronunciations: dict) -> tuple[float, float, str]:
    expected_normalized = normalize(expected)
    recognized_normalized = normalize(recognized)
    recognized_tokens = recognized_normalized.split()
    if expected_normalized == recognized_normalized or expected_normalized in recognized_tokens:
        return 1.0, 1.0, "exact"
    lexical_score = SequenceMatcher(
        None,
        expected_normalized.replace(" ", ""),
        recognized_normalized.replace(" ", ""),
    ).ratio()
    phonetic_score = phonetic_similarity(expected_normalized, recognized_normalized, pronunciations)
    if lexical_score >= 0.72:
        return lexical_score, phonetic_score, "lexical"
    if phonetic_score >= 0.65:
        return lexical_score, phonetic_score, "phonetic"
    return lexical_score, phonetic_score, "review"


def save_report(output: Path, metadata: dict, results: dict) -> None:
    ordered_results = sorted(results.values(), key=lambda item: item["id"])
    status_counts = defaultdict(int)
    file_summaries = defaultdict(lambda: defaultdict(int))
    for item in ordered_results:
        status_counts[item["status"]] += 1
        file_summaries[item["file"]][item["status"]] += 1
        file_summaries[item["file"]]["total"] += 1
    payload = {
        "metadata": {
            **metadata,
            "checkedWordCount": len(ordered_results),
            "statusCounts": dict(status_counts),
            "complete": len(ordered_results) == metadata["indexedWordCount"],
        },
        "fileSummaries": {
            file: dict(counts)
            for file, counts in sorted(file_summaries.items())
        },
        "results": ordered_results,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="逐词校验红宝书全部原声音频索引")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--model", default=DEFAULT_MODEL_NAME)
    parser.add_argument("--files-from", type=Path, help="只检查指定重排方案中的文件")
    parser.add_argument("--only-review-from", type=Path, help="只复核指定报告中的低置信词")
    parser.add_argument("--exclude-files-from", type=Path, help="排除指定重排方案中的文件")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--max-files", type=int, default=0, help="仅检查前 N 个文件，0 表示全部")
    parser.add_argument("--fresh", action="store_true", help="忽略现有检查点并重新开始")
    args = parser.parse_args()

    index = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    redbook = json.loads(REDBOOK_FILE.read_text(encoding="utf-8"))
    words_by_id = {str(word["id"]): word for word in redbook["words"]}
    clips_by_file = defaultdict(list)
    for word_id, clip in index["entries"].items():
        word = words_by_id[word_id]
        clips_by_file[clip["file"]].append((word, clip))
    for clips in clips_by_file.values():
        clips.sort(key=lambda item: float(item[1]["start"]))
    if args.files_from:
        proposal = json.loads(args.files_from.read_text(encoding="utf-8"))
        selected_files = set(proposal["files"])
        clips_by_file = defaultdict(
            list,
            {
                file: clips
                for file, clips in clips_by_file.items()
                if file in selected_files
            },
        )
    if args.only_review_from:
        previous_report = json.loads(args.only_review_from.read_text(encoding="utf-8"))
        review_ids = {
            str(item["id"])
            for item in previous_report["results"]
            if item["status"] == "review"
        }
        clips_by_file = defaultdict(
            list,
            {
                file: [
                    (word, clip)
                    for word, clip in clips
                    if str(word["id"]) in review_ids
                ]
                for file, clips in clips_by_file.items()
                if any(str(word["id"]) in review_ids for word, _ in clips)
            },
        )
    if args.exclude_files_from:
        excluded = json.loads(args.exclude_files_from.read_text(encoding="utf-8"))
        excluded_files = set(excluded["files"])
        clips_by_file = defaultdict(
            list,
            {
                file: clips
                for file, clips in clips_by_file.items()
                if file not in excluded_files
            },
        )

    existing_results = {}
    if args.output.exists() and not args.fresh:
        previous = json.loads(args.output.read_text(encoding="utf-8"))
        existing_results = {
            str(item["id"]): item
            for item in previous.get("results", [])
        }

    metadata = {
        "model": args.model,
        "indexedWordCount": sum(len(clips) for clips in clips_by_file.values()),
        "sourceFileCount": len(clips_by_file),
        "comparison": "逐片 Whisper 识别 + 字面相似度 + CMU 音素相似度",
    }
    print(f"加载模型：{args.model}", flush=True)
    processor = WhisperProcessor.from_pretrained(args.model)
    model = WhisperForConditionalGeneration.from_pretrained(args.model)
    model.eval()
    model.generation_config.forced_decoder_ids = processor.get_decoder_prompt_ids(
        language="english",
        task="transcribe",
    )
    pronunciations = load_pronunciations()
    ffmpeg = find_ffmpeg()

    files = sorted(clips_by_file.items())
    if args.max_files > 0:
        files = files[: args.max_files]
    for file_position, (public_file, clips) in enumerate(files, start=1):
        pending = [
            (word, clip)
            for word, clip in clips
            if str(word["id"]) not in existing_results
        ]
        if not pending:
            print(f"[{file_position:02d}/{len(files):02d}] 已检查 {public_file}", flush=True)
            continue
        audio = decode_audio(ffmpeg, public_file)
        file_review_count = 0
        for offset in range(0, len(pending), args.batch_size):
            batch = pending[offset:offset + args.batch_size]
            samples = []
            for _, clip in batch:
                start_sample = max(0, round(float(clip["start"]) * SAMPLE_RATE))
                end_sample = min(len(audio), round(float(clip["end"]) * SAMPLE_RATE))
                samples.append(audio[start_sample:end_sample])
            inputs = processor(samples, sampling_rate=SAMPLE_RATE, return_tensors="pt")
            with torch.inference_mode():
                predicted_ids = model.generate(inputs.input_features, max_new_tokens=16)
            recognized_items = processor.batch_decode(predicted_ids, skip_special_tokens=True)
            for (word, clip), recognized in zip(batch, recognized_items):
                recognized = recognized.strip()
                lexical_score, phonetic_score, status = compare(
                    word["word"],
                    recognized,
                    pronunciations,
                )
                if status == "review":
                    file_review_count += 1
                existing_results[str(word["id"])] = {
                    "id": word["id"],
                    "word": word["word"],
                    "meaning": word["meaning"],
                    "section": word["section"],
                    "unit": word["unit"],
                    "file": public_file,
                    "start": clip["start"],
                    "end": clip["end"],
                    "duration": round(float(clip["end"]) - float(clip["start"]), 3),
                    "recognized": recognized,
                    "lexicalScore": round(lexical_score, 3),
                    "phoneticScore": round(phonetic_score, 3),
                    "status": status,
                }
        save_report(args.output, metadata, existing_results)
        print(
            f"[{file_position:02d}/{len(files):02d}] {public_file}："
            f"{len(pending)} 词，待复核 {file_review_count}",
            flush=True,
        )

    save_report(args.output, metadata, existing_results)
    final = json.loads(args.output.read_text(encoding="utf-8"))
    print(json.dumps(final["metadata"], ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
