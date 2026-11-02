#!/usr/bin/env bash
# ==============================================================================
# scripts/sync_offsite.sh — Kịch bản đồng bộ sao lưu offsite sang Cloudflare R2 / S3
# Tự động đẩy các gói sao lưu hoàn chỉnh và mã băm SHA-256 lên kho lưu trữ đám mây.
# Không sử dụng emoji trong log và chú thích. Môi trường thực thi: WSL2 / Linux.
# ==============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/storage/backups"
LOG_FILE="${BACKUP_DIR}/backup.log"

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [OFFSITE] $1"
  echo "${msg}"
  echo "${msg}" >> "${LOG_FILE}" 2>/dev/null || true
}

log_error() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [OFFSITE-LOI] $1"
  echo "${msg}" >&2
  echo "${msg}" >> "${LOG_FILE}" 2>/dev/null || true
}

log "=== BAT DAU TIEN TRINH DONG BO SAO LUU OFFSITE ==="

# 1. Kiem tra thu muc sao luu cuc bo
if [[ ! -d "${BACKUP_DIR}" ]]; then
  log_error "Thu muc sao luu cuc bo ${BACKUP_DIR} khong ton tai."
  exit 1
fi

# 2. Doc bien moi truong cau hinh offsite
# Ho tro cac nha cung cap S3-compatible: Cloudflare R2, AWS S3, MinIO
R2_BUCKET="${OFFSITE_BACKUP_BUCKET:-legal-backups}"
R2_REMOTE="${OFFSITE_RCLONE_REMOTE:-r2}"

# 3. Kiem tra cong cu dong bo
if command -v rclone >/dev/null 2>&1; then
  log "Su dung rclone de dong bo goi du lieu len ${R2_REMOTE}:${R2_BUCKET}..."
  # Chi dong bo cac goi sao luu .tar.gz, .enc va ma bam .sha256
  rclone copy "${BACKUP_DIR}" "${R2_REMOTE}:${R2_BUCKET}" \
    --include "backup_*.tar.gz*" \
    --include "safety_*.tar.gz*" \
    --fast-list \
    --transfers 2 \
    --log-file="${LOG_FILE}" \
    --log-level NOTICE || {
      log_error "Tien trinh rclone copy bao loi. Vui long kiem tra cau hinh remote r2."
      exit 1
    }
  log "Dong bo qua rclone hoan tat thanh cong."
elif command -v aws >/dev/null 2>&1; then
  log "Su dung AWS CLI de dong bo goi du lieu len s3://${R2_BUCKET}..."
  aws s3 sync "${BACKUP_DIR}" "s3://${R2_BUCKET}" \
    --exclude "*" \
    --include "backup_*.tar.gz*" \
    --include "safety_*.tar.gz*" || {
      log_error "Tien trinh aws s3 sync bao loi. Vui long kiem tra AWS credentials."
      exit 1
    }
  log "Dong bo qua AWS CLI hoan tat thanh cong."
else
  log "Thong bao: Chua cai dat rclone hoac aws-cli tren may chu."
  log "Cac goi sao luu van duoc bao ve an toan tren o dia cuc bo tai storage/backups."
  log "De kich hoat dong bo offsite, vui long thiet lap rclone remote '${R2_REMOTE}' hoac AWS CLI."
fi

log "=== HOAN TAT TIEN TRINH DONG BO OFFSITE ==="
exit 0
