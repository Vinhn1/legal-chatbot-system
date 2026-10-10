"""Metadata của chunk pháp luật tương thích ChromaDB và ngày theo chuẩn ISO.

Các trường rỗng được bỏ qua vì ChromaDB không chấp nhận giá trị null.
"""

from datetime import date
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class EffectiveStatus(str, Enum):
    ACTIVE = "active"
    EXPIRED = "expired"
    PARTIALLY_EXPIRED = "partially_expired"
    UNKNOWN = "unknown"


class AccessScope(str, Enum):
    PUBLIC = "public"
    INTERNAL = "internal"


class LegalChunkMetadata(BaseModel):
    """Mô tả định danh, cấp cấu trúc, quyền truy cập và hiệu lực của một chunk."""
    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    doc_id: str
    doc_number: str = Field(min_length=1)
    doc_title: str = Field(min_length=1)
    document_type: str | None = None
    issuing_authority: str | None = None
    issued_date: date | None = None
    # Ngày dữ liệu được lập chỉ mục, dùng cho thống kê cập nhật công khai.
    indexed_at: date | None = None
    content_hash: str | None = None
    chapter: str | None = None
    article_number: str | None = None
    article_title: str | None = None
    clause_number: str | None = None
    point_id: str | None = None
    effective_status: EffectiveStatus = EffectiveStatus.UNKNOWN
    effective_date: date | None = None
    expiry_date: date | None = None
    status_since_date: date | None = None
    source_url: str | None = None
    # Loại nguồn gốc được ghi riêng vì URL tham chiếu không phản ánh định dạng tệp tải lên.
    source_type: Literal["pdf", "docx", "txt", "web"] | None = None
    scope: AccessScope = AccessScope.INTERNAL

    @field_validator("doc_id")
    @classmethod
    def valid_doc_id(cls, value: str) -> str:
        UUID(value)
        return value

    @field_validator("doc_number", "doc_title", "document_type", "issuing_authority", "content_hash", "chapter", "article_number", "article_title", "clause_number", "point_id", "source_url")
    @classmethod
    def no_blank_values(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("metadata text must not be blank")
        return value

    @model_validator(mode="after")
    def valid_date_range(self) -> "LegalChunkMetadata":
        if self.effective_date and self.expiry_date and self.expiry_date < self.effective_date:
            raise ValueError("expiry_date must not precede effective_date")
        if self.effective_date and self.status_since_date and self.status_since_date < self.effective_date:
            raise ValueError("status_since_date must not precede effective_date")
        return self

    def to_chroma_metadata(self) -> dict[str, str | int | float | bool]:
        """Chỉ ghi giá trị nguyên thủy được ChromaDB hỗ trợ và bỏ các trường rỗng."""
        values: dict[str, Any] = self.model_dump(mode="json", exclude_none=True)
        return values
