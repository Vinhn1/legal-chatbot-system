"""Đọc và ghi cấu hình nghiệp vụ đã kiểm tra, không làm lộ trường bí mật cũ."""

import hashlib
import json
import os
import tempfile
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from legal.prompts import SYSTEM_PROMPT
from legal.security import detect_prompt_injection


class RuntimeConfig(BaseModel):
    """Giới hạn tham số thống nhất cho các nhà cung cấp được hỗ trợ."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    system_prompt: str = Field(default="", max_length=10000)
    temperature: float = Field(default=0, ge=0, le=1)
    top_p: float = Field(default=0.9, gt=0, le=1)
    max_tokens: int = Field(default=1024, ge=256, le=4096, strict=True)

    @property
    def version(self):
        """Nhận diện cấu hình không lưu lại nội dung chỉ dẫn trong lịch sử."""
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()[:16]

    @property
    def prompt(self):
        """Giữ quy tắc nguồn và JSON ở phần bắt buộc ngoài vùng tùy chỉnh."""
        if detect_prompt_injection(self.system_prompt):
            raise ValueError("Chỉ dẫn nghiệp vụ chứa yêu cầu thay đổi quy tắc an toàn.")
        return SYSTEM_PROMPT + "\nTùy chỉnh cách trình bày:\n" + self.system_prompt + "\nQuy tắc bắt buộc ưu tiên:\n" + SYSTEM_PROMPT


def config_path():
    """Cho phép cấu hình thư mục ghi nguyên tử trong container và đường dẫn test riêng."""
    return Path(os.getenv("RAG_CONFIG_PATH") or Path(__file__).resolve().parents[1] / "rag_config.json")


def load_config(path=None):
    """Thiếu file dùng mặc định; file hỏng phải báo lỗi thay vì âm thầm đổi hành vi."""
    target = Path(path) if path else config_path()
    if not target.exists():
        return RuntimeConfig()
    data = json.loads(target.read_text(encoding="utf-8"))
    config = RuntimeConfig.model_validate({key: value for key, value in data.items() if key in RuntimeConfig.model_fields})
    config.prompt
    return config


def save_config(config, path=None):
    """Thay file nguyên tử trên cùng filesystem, giữ bản cũ nếu ghi thất bại."""
    config.prompt
    target = Path(path) if path else config_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=target.parent, prefix=".rag-", suffix=".tmp")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(config.model_dump_json(indent=2))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
