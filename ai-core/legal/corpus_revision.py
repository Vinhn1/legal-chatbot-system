"""Đánh dấu phiên bản corpus trên filesystem dùng chung giữa các worker AI Core."""

import os
import tempfile
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4


@contextmanager
def corpus_mutation(retriever):
    """Vô hiệu cache cả trước và sau ghi/xóa, kể cả khi thao tác ném lỗi."""
    invalidate = getattr(retriever, "invalidate", None)
    if callable(invalidate):
        invalidate()
    try:
        yield
    finally:
        if callable(invalidate):
            invalidate()


def revision(path):
    """Đọc marker nhỏ; không đọc toàn corpus để phát hiện thay đổi từ worker khác."""
    if not path:
        return "local"
    try:
        return Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return "initial"


def bump_revision(path):
    """Mỗi thay đổi có UUID mới, ghi nguyên tử không làm mất sự kiện khi chạy đồng thời."""
    if not path:
        return
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=target.parent, prefix=".revision-")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(str(uuid4()))
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
