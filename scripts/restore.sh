#!/usr/bin/env bash
# ==============================================================================
# scripts/restore.sh — Kịch bản khôi phục an toàn hệ thống Veritas Legal Chatbot
# Kiểm tra checksum SHA-256 -> Chụp Safety Snapshot dự phòng -> Phục hồi
# PostgreSQL -> Phục hồi ChromaDB -> Fallback Reindex -> Đối soát dữ liệu.
# Không sử dụng emoji trong log và chú thích. Môi trường thực thi: WSL2 / Linux.
# ==============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_ROOT}"

BACKUP_DIR="${PROJECT_ROOT}/storage/backups"
LOG_FILE="${BACKUP_DIR}/restore.log"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"

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

# 1. Xac dinh goi sao luu can phuc hoi
TARGET_BACKUP="${1:-latest}"

if [[ "${TARGET_BACKUP}" == "latest" ]]; then
  LATEST_FILE=$(ls -t "${BACKUP_DIR}"/backup_*.tar.gz 2>/dev/null | head -n 1 || true)
  if [[ -z "${LATEST_FILE}" ]]; then
    log_error "Khong tim thay ban sao luu nao trong ${BACKUP_DIR}."
    exit 1
  fi
  TARGET_BACKUP="${LATEST_FILE}"
elif [[ ! -f "${TARGET_BACKUP}" ]]; then
  if [[ -f "${BACKUP_DIR}/${TARGET_BACKUP}" ]]; then
    TARGET_BACKUP="${BACKUP_DIR}/${TARGET_BACKUP}"
  else
    log_error "Tep sao luu khong ton tai: ${TARGET_BACKUP}"
    exit 1
  fi
fi

log "=== BAT DAU TIEN TRINH PHUC HOI DU LIEU VERITAS LEGAL (${TIMESTAMP}) ==="
log "Tep sao luu nguon: $(basename "${TARGET_BACKUP}")"

# 2. Buoc 1/5: Kiem tra toan ven ma bam SHA-256
log "Buoc 1/5: Kiem tra toan ven ma bam SHA-256 cua tep sao luu..."
SHA_FILE="${TARGET_BACKUP}.sha256"
if [[ -f "${SHA_FILE}" ]]; then
  cd "$(dirname "${TARGET_BACKUP}")"
  if sha256sum -c "$(basename "${SHA_FILE}")" >/dev/null 2>&1; then
    log "Ma bam SHA-256 hop le. Tep sao luu toan ven 100%."
  else
    log_error "Kiem tra SHA-256 that bai! Tep sao luu co the bi hong hoac sai lech du lieu."
    exit 1
  fi
  cd "${PROJECT_ROOT}"
else
  log "Canh bao: Khong tim thay tep .sha256 tuong ung, tiep tuc voi kiem tra cau truc tar..."
  if ! tar -tzf "${TARGET_BACKUP}" >/dev/null 2>&1; then
    log_error "Tep tar.gz bi loi cau truc khong the giai nen."
    exit 1
  fi
fi

# 3. Buoc 2/5: Tao ban chup an toan hien tai (Safety Snapshot) truoc khi ghi de
log "Buoc 2/5: Tao ban chup an toan (Safety Snapshot) du lieu hien tai truoc khi ghi de..."
SAFETY_TAR="${BACKUP_DIR}/safety_before_restore_${TIMESTAMP}.tar.gz"
SAFETY_TEMP="${BACKUP_DIR}/tmp_safety_${TIMESTAMP}"
mkdir -p "${SAFETY_TEMP}"

# Doc thong tin database hien tai tu backend/.env hoac .env
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

if docker ps --format '{{.Names}}' | grep -q '^legal_db$'; then
  docker compose exec -T db pg_dump -Fc -U "${DB_USER}" "${DB_NAME}" > "${SAFETY_TEMP}/postgres.dump" 2>/dev/null || true
fi
if [[ -d "${PROJECT_ROOT}/ai-core/chroma_db" ]]; then
  mkdir -p "${SAFETY_TEMP}/chroma_db"
  cp -r "${PROJECT_ROOT}/ai-core/chroma_db"/* "${SAFETY_TEMP}/chroma_db/" 2>/dev/null || true
fi
tar -czf "${SAFETY_TAR}" -C "${SAFETY_TEMP}" . 2>/dev/null || true
rm -rf "${SAFETY_TEMP}"
log "Ban chup an toan duoc luu tai: $(basename "${SAFETY_TAR}")"

# 4. Giai nen tep sao luu vao thu muc tam
RESTORE_TEMP="${BACKUP_DIR}/tmp_restore_${TIMESTAMP}"
mkdir -p "${RESTORE_TEMP}"
log "Giai nen tep sao luu vao vung dem tam..."
tar -xzf "${TARGET_BACKUP}" -C "${RESTORE_TEMP}"

# 5. Buoc 3/5: Phuc hoi Co so du lieu quan he PostgreSQL
log "Buoc 3/5: Phuc hoi co so du lieu PostgreSQL (${DB_NAME})..."
PG_DUMP_FILE="${RESTORE_TEMP}/postgres.dump"

if [[ -f "${PG_DUMP_FILE}" ]]; then
  if docker ps --format '{{.Names}}' | grep -q '^legal_db$'; then
    # Su dung pg_restore voi tuy chon --clean --if-exists de lam sach bang cu truoc khi nap
    RESTORE_EXIT=0
    docker compose exec -T db pg_restore --clean --if-exists --no-owner --no-acl -U "${DB_USER}" -d "${DB_NAME}" < "${PG_DUMP_FILE}" || RESTORE_EXIT=$?
    if [[ ${RESTORE_EXIT} -gt 1 ]]; then
      log_error "Loi nghiem trong khi thuc thi pg_restore (exit code ${RESTORE_EXIT})."
      rm -rf "${RESTORE_TEMP}"
      exit 1
    fi
    log "Da nap ban dump PostgreSQL thanh cong vao container legal_db."
  else
    log_error "Container legal_db khong chay. Vui long khoi dong container bang 'docker compose up -d db'."
    rm -rf "${RESTORE_TEMP}"
    exit 1
  fi
else
  log_error "Khong tim thay postgres.dump trong ban sao luu."
  rm -rf "${RESTORE_TEMP}"
  exit 1
fi

# 6. Buoc 4/5: Phuc hoi ChromaDB Vector Database va Tai lieu goc
log "Buoc 4/5: Phuc hoi ChromaDB Vector Database va kho tai lieu goc..."
if [[ -d "${RESTORE_TEMP}/chroma_db" ]]; then
  mkdir -p "${PROJECT_ROOT}/ai-core/chroma_db"
  # Sao chep de snapshot vector
  cp -r "${RESTORE_TEMP}/chroma_db"/* "${PROJECT_ROOT}/ai-core/chroma_db/" 2>/dev/null || true
  log "Da phuc hoi snapshot ChromaDB."
fi

if [[ -d "${RESTORE_TEMP}/raw_documents" ]]; then
  mkdir -p "${PROJECT_ROOT}/storage/raw_documents"
  cp -r "${RESTORE_TEMP}/raw_documents"/* "${PROJECT_ROOT}/storage/raw_documents/" 2>/dev/null || true
  log "Da phuc hoi kho tai lieu goc."
fi

if [[ -f "${RESTORE_TEMP}/rag_config.json" ]]; then
  cp "${RESTORE_TEMP}/rag_config.json" "${PROJECT_ROOT}/ai-core/rag_config.json"
  log "Da phuc hoi cau hinh RAG."
fi

# 7. Buoc 5/5: Kiem tra doi soat du lieu va Co che cuu ho Fallback
log "Buoc 5/5: Kiem tra doi soat tinh toan ven va so luong ban ghi..."
DOC_COUNT=$(docker compose exec -T db psql -U "${DB_USER}" -d "${DB_NAME}" -t -A -c "SELECT COUNT(*) FROM legal_documents;" 2>/dev/null || echo "0")
ARTICLE_COUNT=$(docker compose exec -T db psql -U "${DB_USER}" -d "${DB_NAME}" -t -A -c "SELECT COUNT(*) FROM legal_articles;" 2>/dev/null || echo "0")
USER_COUNT=$(docker compose exec -T db psql -U "${DB_USER}" -d "${DB_NAME}" -t -A -c "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "0")

log "Ket qua doi soat PostgreSQL sau phuc hoi:"
log "  - So van ban phap luat (legal_documents): ${DOC_COUNT}"
log "  - So don vi Dieu/Khoan (legal_articles): ${ARTICLE_COUNT}"
log "  - So tai khoan nguoi dung (users): ${USER_COUNT}"

# Kiem tra ChromaDB co mo duoc khong
CHROMA_SQLITE="${PROJECT_ROOT}/ai-core/chroma_db/chroma.sqlite3"
if [[ ! -f "${CHROMA_SQLITE}" || $(stat -c%s "${CHROMA_SQLITE}" 2>/dev/null || echo "0") -lt 1000 ]]; then
  log "Canh bao: ChromaDB khong ton tai hoac bi loi phan doan. Kich hoat che do cuu ho Reindexing..."
  if [[ -f "${PROJECT_ROOT}/ai-core/scripts/reindex_existing.py" ]]; then
    python3 "${PROJECT_ROOT}/ai-core/scripts/reindex_existing.py" || {
      log_error "Kich hoat reindex_existing.py that bai."
    }
    log "Reindexing hoan tat thanh cong tu co so du lieu PostgreSQL."
  fi
fi

# Don dep thu muc tam
rm -rf "${RESTORE_TEMP}"

log "=== HOAN TAT PHUC HOI HE THONG VERITAS LEGAL THANH CONG ==="
exit 0
