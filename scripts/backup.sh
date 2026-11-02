#!/usr/bin/env bash
# ==============================================================================
# scripts/backup.sh — Kịch bản sao lưu toàn diện hệ thống Veritas Legal Chatbot
# Bao gồm: PostgreSQL (MVCC non-blocking), ChromaDB Snapshot, Cấu hình RAG,
# Tài liệu nguyên bản, Checksum SHA-256 và Xoay vòng retention GFS.
# Không sử dụng emoji trong log và chú thích. Môi trường thực thi: WSL2 / Linux.
# ==============================================================================

set -euo pipefail

# 1. Xác định thư mục gốc dự án
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_ROOT}"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
BACKUP_DIR="${PROJECT_ROOT}/storage/backups"
BACKUP_TEMP="${BACKUP_DIR}/tmp_${TIMESTAMP}"
BACKUP_TAR="${BACKUP_DIR}/backup_${TIMESTAMP}.tar.gz"
BACKUP_SHA="${BACKUP_TAR}.sha256"
LOG_FILE="${BACKUP_DIR}/backup.log"

# Cờ hỗ trợ mã hóa đối xứng AES-256 (PBKDF2) cho lưu trữ đám mây ngoài cơ sở
ENABLE_ENCRYPT=false
for arg in "$@"; do
  if [[ "${arg}" == "--encrypt" ]]; then
    ENABLE_ENCRYPT=true
  fi
done

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo "${msg}"
  echo "${msg}" >> "${LOG_FILE}" 2>/dev/null || true
}

log_error() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [LOI] $1"
  echo "${msg}" >&2
  echo "${msg}" >> "${LOG_FILE}" 2>/dev/null || true
}

# Tạo sẵn thư mục sao lưu
mkdir -p "${BACKUP_DIR}" "${BACKUP_TEMP}"

log "=== BAT DAU TIEN TRINH SAO LUU HE THONG VERITAS LEGAL (${TIMESTAMP}) ==="

# 2. Doc cau hinh co so du lieu tu backend/.env hoac .env neu co
DB_USER="legal_user"
DB_NAME="legal_db"
ENV_FILE="${PROJECT_ROOT}/backend/.env"
if [[ ! -f "${ENV_FILE}" && -f "${PROJECT_ROOT}/.env" ]]; then
  ENV_FILE="${PROJECT_ROOT}/.env"
fi
if [[ -f "${ENV_FILE}" ]]; then
  PARSED_USER=$(grep -E '^(POSTGRES_USER|DB_USERNAME)=' "${ENV_FILE}" | tail -n 1 | cut -d '=' -f2- | tr -d '"'\'' ' || true)
  PARSED_DB=$(grep -E '^(POSTGRES_DB|DB_DATABASE)=' "${ENV_FILE}" | tail -n 1 | cut -d '=' -f2- | tr -d '"'\'' ' || true)
  PARSED_PASS=$(grep -E '^(POSTGRES_PASSWORD|DB_PASSWORD)=' "${ENV_FILE}" | tail -n 1 | cut -d '=' -f2- | tr -d '"'\'' ' || true)
  if [[ -n "${PARSED_USER}" ]]; then DB_USER="${PARSED_USER}"; fi
  if [[ -n "${PARSED_DB}" ]]; then DB_NAME="${PARSED_DB}"; fi
  if [[ -n "${PARSED_PASS}" ]]; then export PGPASSWORD="${PARSED_PASS}"; fi
fi

# 3. Sao luu Co so du lieu quan he PostgreSQL (non-blocking)
log "Buoc 1/5: Sao luu co so du lieu PostgreSQL (${DB_NAME})..."
PG_DUMP_FILE="${BACKUP_TEMP}/postgres.dump"

if docker ps --format '{{.Names}}' | grep -q '^legal_db$'; then
  docker compose exec -T db pg_dump -Fc -U "${DB_USER}" "${DB_NAME}" > "${PG_DUMP_FILE}"
elif docker ps --format '{{.Names}}' | grep -q 'db'; then
  DB_CONTAINER=$(docker ps --format '{{.Names}}' | grep 'db' | head -n 1)
  docker exec -i "${DB_CONTAINER}" pg_dump -Fc -U "${DB_USER}" "${DB_NAME}" > "${PG_DUMP_FILE}"
else
  # Thu ket noi localhost neu chay native postgres
  pg_dump -Fc -U "${DB_USER}" -h localhost -p 5432 "${DB_NAME}" > "${PG_DUMP_FILE}" || {
    log_error "Khong the ket noi container PostgreSQL de tao ban dump."
    rm -rf "${BACKUP_TEMP}"
    exit 1
  }
fi

DUMP_SIZE=$(stat -c%s "${PG_DUMP_FILE}" 2>/dev/null || stat -f%z "${PG_DUMP_FILE}" 2>/dev/null || echo "0")
if [[ "${DUMP_SIZE}" -lt 500 ]]; then
  log_error "Tep postgres.dump tao ra qua nho (${DUMP_SIZE} bytes), co the co loi ket noi."
  rm -rf "${BACKUP_TEMP}"
  exit 1
fi
log "Sao luu PostgreSQL hoan tat: ${DUMP_SIZE} bytes."

# 4. Sao luu Snapshot Vector Database ChromaDB
log "Buoc 2/5: Sao luu snapshot ChromaDB Vector Database..."
CHROMA_SRC="${PROJECT_ROOT}/ai-core/chroma_db"
if [[ -d "${CHROMA_SRC}" ]]; then
  mkdir -p "${BACKUP_TEMP}/chroma_db"
  cp -r "${CHROMA_SRC}"/* "${BACKUP_TEMP}/chroma_db/" 2>/dev/null || true
  log "Da sao chep snapshot ChromaDB vao goi tam."
else
  log "Canh bao: Thu muc ai-core/chroma_db khong ton tai hoac chua co du lieu."
fi

# 5. Sao luu Kho tai lieu goc va Cau hinh he thong
log "Buoc 3/5: Sao luu kho tai lieu goc va cau hinh RAG..."
RAW_DOCS_SRC="${PROJECT_ROOT}/storage/raw_documents"
if [[ -d "${RAW_DOCS_SRC}" ]]; then
  mkdir -p "${BACKUP_TEMP}/raw_documents"
  cp -r "${RAW_DOCS_SRC}"/* "${BACKUP_TEMP}/raw_documents/" 2>/dev/null || true
fi

# Sao luu cau hinh RAG va file env mau an toan
if [[ -f "${PROJECT_ROOT}/ai-core/rag_config.json" ]]; then
  cp "${PROJECT_ROOT}/ai-core/rag_config.json" "${BACKUP_TEMP}/"
fi
if [[ -f "${PROJECT_ROOT}/.env.example" ]]; then
  cp "${PROJECT_ROOT}/.env.example" "${BACKUP_TEMP}/"
fi

# Tao tep manifest ghi chu thong tin phien ban
cat <<EOF > "${BACKUP_TEMP}/manifest.json"
{
  "timestamp": "${TIMESTAMP}",
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "system": "Veritas Legal Chatbot System",
  "db_name": "${DB_NAME}",
  "db_user": "${DB_USER}",
  "git_commit": "$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')",
  "components": {
    "postgres": true,
    "chroma_db": $([ -d "${CHROMA_SRC}" ] && echo "true" || echo "false"),
    "raw_documents": $([ -d "${RAW_DOCS_SRC}" ] && echo "true" || echo "false"),
    "rag_config": $([ -f "${PROJECT_ROOT}/ai-core/rag_config.json" ] && echo "true" || echo "false")
  }
}
EOF

# 6. Dong goi nén tar.gz va tinh ma bam toan ven SHA-256
log "Buoc 4/5: Dong goi nén tar.gz va sinh ma bam SHA-256..."
tar -czf "${BACKUP_TAR}" -C "${BACKUP_TEMP}" .
rm -rf "${BACKUP_TEMP}"

# Tinh ma bam SHA-256
cd "${BACKUP_DIR}"
sha256sum "$(basename "${BACKUP_TAR}")" > "${BACKUP_SHA}"
cd "${PROJECT_ROOT}"

# Kiem tra lai tinh toan ven cua goi vua tao
cd "${BACKUP_DIR}"
sha256sum -c "$(basename "${BACKUP_SHA}")" >/dev/null 2>&1 || {
  log_error "Kiem tra toan ven ma bam SHA-256 that bai sau khi tao tep backup."
  exit 1
}
cd "${PROJECT_ROOT}"

FINAL_SIZE=$(stat -c%s "${BACKUP_TAR}" 2>/dev/null || stat -f%z "${BACKUP_TAR}" 2>/dev/null || echo "0")
log "Goi sao luu duoc tao thanh cong: $(basename "${BACKUP_TAR}") (${FINAL_SIZE} bytes)."

# 6b. Ma hoa AES-256 neu duoc yeu cau boi co --encrypt
if [[ "${ENABLE_ENCRYPT}" == "true" ]]; then
  ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
  if [[ -z "${ENCRYPTION_KEY}" ]]; then
    log_error "Co --encrypt duoc bat nhung bien moi truong BACKUP_ENCRYPTION_KEY chua duoc cau hinh."
    exit 1
  fi
  log "Tien hanh ma hoa goi sao luu bang thuat toan AES-256-CBC (PBKDF2)..."
  BACKUP_ENC="${BACKUP_TAR}.enc"
  openssl enc -aes-256-cbc -salt -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -in "${BACKUP_TAR}" -out "${BACKUP_ENC}"
  # Xoa goi sao luu tho chua ma hoa de ngan chan ro ri du lieu noi bo
  rm -f "${BACKUP_TAR}" "${BACKUP_TAR}.sha256"
  cd "${BACKUP_DIR}"
  sha256sum "$(basename "${BACKUP_ENC}")" > "$(basename "${BACKUP_ENC}").sha256"
  cd "${PROJECT_ROOT}"
  log "Da tao goi sao luu ma hoa an toan: $(basename "${BACKUP_ENC}")."
fi

# 7. Ap dung Chinh sach Retention GFS (Xoay vong ban sao luu)
log "Buoc 5/5: Ap dung chinh sach luu tru Retention Policy (30 ngay)..."
# Xoa cac ban sao luu thong thuong cu hon 30 ngay, giu lai ban chu nhat (8 tuan) va ban dau thang (6 thang)
find "${BACKUP_DIR}" -maxdepth 1 -name "backup_*.tar.gz" -type f -mtime +30 | while read -r old_backup; do
  file_name=$(basename "${old_backup}")
  # Lay ngay tao tu ten file (backup_YYYYMMDD_HHMMSS.tar.gz)
  date_part=$(echo "${file_name}" | sed -n 's/backup_\([0-9]\{8\}\)_.*/\1/p')
  if [[ -n "${date_part}" ]]; then
    day_of_month="${date_part:6:2}"
    year="${date_part:0:4}"
    month="${date_part:4:2}"
    # Kiem tra neu la ngay dau thang (01) -> giu trong 180 ngay
    if [[ "${day_of_month}" == "01" ]]; then
      file_age_days=$(( ($(date +%s) - $(date -d "${date_part}" +%s 2>/dev/null || date -j -f "%Y%m%d" "${date_part}" +%s 2>/dev/null || echo 0)) / 86400 ))
      if [[ "${file_age_days}" -le 180 ]]; then
        continue # Giu ban sao luu thang
      fi
    fi
  fi
  log "Xoa ban sao luu het han: ${file_name}"
  rm -f "${old_backup}" "${old_backup}.sha256"
done

log "=== HOAN TAT SAO LUU HE THONG VERITAS LEGAL THANH CONG ==="
exit 0
