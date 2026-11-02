"""Benchmark truy xuất trên Chroma tạm với embedding xác định và corpus giả lập."""

import argparse
import hashlib
import json
import statistics
import sys
import tempfile
import time
import tracemalloc
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "ai-core"), str(ROOT / "ai-core/tests")]

import chromadb
from legal.retrieval import LegalRetriever
from test_legal_e2e_suite import BenchmarkEmbedding


def run(size):
    """Đo cold/warm riêng, kiểm tra Recall@5 và bộ nhớ Python trong cùng lượt."""
    with tempfile.TemporaryDirectory() as directory:
        collection = chromadb.PersistentClient(path=directory).get_or_create_collection("benchmark_scale", embedding_function=BenchmarkEmbedding())
        documents = ["Điều 1. Người dùng có quyền xem hồ sơ công khai."] + [f"Điều {i + 1}. Nghĩa vụ mẫu quản lý tài liệu số {i}." for i in range(1, size)]
        metadata = [{"doc_number": "01/2026/QH", "article_number": str(i + 1), "document_type": "law",
                     "scope": "public", "effective_status": "active", "effective_date": "2026-01-01"} for i in range(size)]
        for start in range(0, size, 500):
            collection.add(ids=[f"chunk-{i}" for i in range(start, min(start + 500, size))], documents=documents[start:start + 500], metadatas=metadata[start:start + 500])
        retriever = LegalRetriever(collection)
        tracemalloc.start()
        durations, recalls = [], []
        for question in ["quyền xem hồ sơ công khai", "Điều 1 Luật số 01/2026/QH"] * 6:
            started = time.perf_counter()
            result = retriever.search(question, limit=5, as_of=date(2026, 10, 24))
            durations.append((time.perf_counter() - started) * 1000)
            recalls.append(int(any(item.chunk_id == "chunk-0" for item in result)))
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        return {"chunks": size, "cold_ms": durations[0], "warm_median_ms": statistics.median(durations[2:]),
                "p95_ms": sorted(durations)[int(len(durations) * .95)], "peak_python_bytes": peak,
                "recall_at_5": sum(recalls) / len(recalls), "queries": len(durations),
                "corpus_sha256": hashlib.sha256(json.dumps(documents, ensure_ascii=False).encode()).hexdigest()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    arguments = parser.parse_args()
    result = {"kind": "synthetic_retrieval_only", "generation_ms": None, "sizes": [run(size) for size in [100, 1000, 5000]]}
    Path(arguments.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    sys.exit(0 if all(row["recall_at_5"] == 1 for row in result["sizes"]) else 1)
