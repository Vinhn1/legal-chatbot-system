"""Lưu kết quả đánh giá logic RAG tái lập; không công bố độ chính xác pháp lý."""

import argparse
import hashlib
import json
import os
import platform
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "ai-core"), str(ROOT / "ai-core/tests")]
os.environ["PYTHON_DOTENV_DISABLED"] = "1"

from test_legal_e2e_suite import LegalE2ESuite, DATASET
from legal.runtime_config import RuntimeConfig


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    arguments = parser.parse_args()
    outcome = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(LegalE2ESuite))
    metrics = LegalE2ESuite.metrics
    durations = sorted(metrics.get("duration", []))
    report = {"timestamp_utc": datetime.now(timezone.utc).isoformat(), "python": platform.python_version(),
              "source_sha256": hashlib.sha256(b''.join((ROOT / 'ai-core' / name).read_bytes() for name in [
                  'rag_pipeline.py', 'legal/retrieval.py', 'legal/citations.py', 'legal/runtime_config.py', 'legal/corpus_revision.py'])).hexdigest(),
              "dataset_sha256": hashlib.sha256(DATASET.read_bytes()).hexdigest(),
              "corpus_sha256": hashlib.sha256(json.dumps(LegalE2ESuite.samples, ensure_ascii=False).encode()).hexdigest(),
              "config_version": RuntimeConfig().version, "model": "fixture", "embedding": "benchmark_legal_embedding",
              "generation_mode": "mocked", "legal_review": "pending", "passed": outcome.wasSuccessful(),
              "tests_run": outcome.testsRun, "thresholds": {"exact_recall_at_1": 1, "semantic_recall_at_1": 1, "safety": 1},
              "metrics": {key: sum(values) / len(values) for key, values in metrics.items() if values and key != "duration"},
              "retrieval_p95_ms": durations[min(len(durations) - 1, int(len(durations) * .95))] if durations else None,
              "generation_latency_ms": None}
    Path(arguments.output).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    sys.exit(0 if outcome.wasSuccessful() else 1)
