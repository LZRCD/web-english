import argparse
import json
import os
import re
import shutil
import subprocess
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
import torch
from transformers import (
    WhisperForConditionalGeneration,
    WhisperProcessor,
    pipeline,
)


ROOT = Path(__file__).resolve().parents[1]
AUDIO_FILE = ROOT / "public" / "audio" / "redbook" / "required-unit-15.mp3"
INDEX_FILE = ROOT / "public" / "data" / "audio-index.json"
REDBOOK_FILE = ROOT / "public" / "data" / "redbook.json"
DEFAULT_OUTPUT = ROOT / "tmp" / "unit15-asr-report.json"
MODEL_NAME = "openai/whisper-tiny.en"


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


def decode_audio(ffmpeg: str) -> np.ndarray:
    result = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(AUDIO_FILE),
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
    )
    return np.frombuffer(result.stdout, dtype=np.float32)


def normalize(value: str) -> str:
    # 统一英美拼写，避免 honour / honor 被误判为不同发音。
    normalized = re.sub(r"[^a-z]+", " ", value.lower()).strip()
    return normalized.replace("honour", "honor")


def compare(expected: str, recognized: str) -> tuple[float, str]:
    expected_normalized = normalize(expected)
    recognized_normalized = normalize(recognized)
    recognized_tokens = recognized_normalized.split()
    if expected_normalized == recognized_normalized or expected_normalized in recognized_tokens:
        return 1.0, "pass"
    score = SequenceMatcher(None, expected_normalized, recognized_normalized.replace(" ", "")).ratio()
    return score, "pass" if score >= 0.72 else "review"


def main() -> None:
    parser = argparse.ArgumentParser(description="用 Whisper 校验必考词 Unit 15 的自动音频切片")
    parser.add_argument("--limit", type=int, default=0, help="只检查前 N 个词，0 表示全部")
    parser.add_argument("--full-transcript", action="store_true", help="输出整段音频的词级时间戳")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    index = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    redbook = json.loads(REDBOOK_FILE.read_text(encoding="utf-8"))
    words = [
        word
        for word in redbook["words"]
        if word["section"] == "必考词" and int(word["unit"]) == 15
    ]
    if args.limit > 0:
        words = words[: args.limit]

    print(f"加载语音识别模型：{MODEL_NAME}", flush=True)
    processor = WhisperProcessor.from_pretrained(MODEL_NAME)
    model = WhisperForConditionalGeneration.from_pretrained(MODEL_NAME)
    model.eval()
    model.generation_config.forced_decoder_ids = processor.get_decoder_prompt_ids(
        language="english",
        task="transcribe",
    )

    audio = decode_audio(find_ffmpeg())
    if args.full_transcript:
        recognizer = pipeline(
            "automatic-speech-recognition",
            model=model,
            tokenizer=processor.tokenizer,
            feature_extractor=processor.feature_extractor,
            device=-1,
        )
        transcript = recognizer(
            {"array": audio, "sampling_rate": 16000},
            chunk_length_s=30,
            stride_length_s=(4, 2),
            return_timestamps="word",
        )
        payload = {
            "model": MODEL_NAME,
            "text": transcript["text"],
            "chunks": transcript["chunks"],
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        for chunk in transcript["chunks"]:
            print(f"{chunk['timestamp']}: {chunk['text']}", flush=True)
        return

    results = []
    for position, word in enumerate(words, start=1):
        clip = index["entries"].get(str(word["id"]))
        if not clip:
            results.append({
                "position": position,
                "id": word["id"],
                "word": word["word"],
                "meaning": word["meaning"],
                "recognized": "",
                "matchScore": 0,
                "status": "missing",
            })
            continue
        start_sample = max(0, round(float(clip["start"]) * 16000))
        end_sample = min(len(audio), round(float(clip["end"]) * 16000))
        samples = audio[start_sample:end_sample]
        inputs = processor(samples, sampling_rate=16000, return_tensors="pt")
        with torch.inference_mode():
            predicted_ids = model.generate(inputs.input_features, max_new_tokens=16)
        recognized = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0].strip()
        score, status = compare(word["word"], recognized)
        result = {
            "position": position,
            "id": word["id"],
            "word": word["word"],
            "meaning": word["meaning"],
            "recognized": recognized,
            "matchScore": round(score, 3),
            "status": status,
            "start": clip["start"],
            "end": clip["end"],
            "duration": round(float(clip["end"]) - float(clip["start"]), 3),
        }
        results.append(result)
        print(
            f"[{position:02d}/{len(words):02d}] {word['word']:<18} -> "
            f"{recognized or '∅':<24} {status} ({score:.2f})",
            flush=True,
        )

    summary = {
        "model": MODEL_NAME,
        "wordCount": len(results),
        "passed": sum(item["status"] == "pass" for item in results),
        "review": sum(item["status"] == "review" for item in results),
        "missing": sum(item["status"] == "missing" for item in results),
    }
    payload = {"summary": summary, "results": results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
