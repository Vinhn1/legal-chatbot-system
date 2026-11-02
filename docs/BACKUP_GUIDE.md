# CẨM NANG VẬN HÀNH SAO LƯU VÀ PHỤC HỒI HỆ THỐNG VERITAS LEGAL
# (Veritas Legal System Disaster Recovery & Backup Runbook)

Tài liệu này quy định chi tiết quy trình kỹ thuật, cấu trúc lưu trữ, cơ chế tự động hóa và các bước xử lý sự cố liên quan đến hệ thống sao lưu (Backup) và phục hồi sau thảm họa (Disaster Recovery) cho toàn bộ nền tảng tra cứu pháp luật Veritas Legal.

---

## 1. TỔNG QUAN KIẾN TRÚC SAO LƯU

Hệ thống Veritas Legal lưu trữ dữ liệu phân tán trên nhiều tầng công nghệ. Một gói sao lưu hợp lệ bắt buộc phải đóng gói đồng bộ toàn bộ các thành phần sau:

1. **Cơ sở dữ liệu quan hệ (PostgreSQL 15):**
   - Lưu trữ toàn bộ siêu dữ liệu văn bản pháp luật (`legal_documents`), chi tiết các đơn vị Điều/Khoản đã bóc tách cấu trúc (`legal_articles`), tài khoản người dùng và quyền hạn (`users`), các thử thách đăng nhập OTP/2FA (`auth_challenges`), phiên tra cứu công khai và lịch sử hội thoại (`conversations`, `chat_history`).
   - Được trích xuất dưới định dạng nén nhị phân tùy biến (`pg_dump -Fc`) hỗ trợ phục hồi linh hoạt, toàn vẹn giao dịch ACID và không gây khóa bảng (Zero-downtime qua MVCC).

2. **Cơ sở dữ liệu Vector ngữ nghĩa (ChromaDB):**
   - Chứa toàn bộ các vector embeddings của các đoạn văn bản pháp luật (`ai-core/chroma_db/`) phục vụ tìm kiếm ngữ nghĩa và tra cứu đối chiếu.

3. **Cấu hình động RAG và hệ thống:**
   - Tệp tham số cấu hình truy xuất `ai-core/rag_config.json` (top_k, ngưỡng similarity_threshold, hybrid alpha).
   - Tệp mẫu môi trường `.env.example`.

4. **Kho tệp nhị phân gốc (Raw Documents):**
   - Thư mục `storage/raw_documents/` lưu trữ các tệp tải lên gốc (PDF, DOCX) được đặt tên theo mã băm SHA-256 nội dung nhằm phục vụ tái kiểm tra và tái lập chỉ mục khi cần thiết.

5. **Tệp kê khai tính toàn vẹn (Manifest):**
   - Tệp `manifest.json` ghi nhận thời điểm tạo, phiên bản hệ thống, thông số bản ghi của các bảng và tổng kiểm tra toàn vẹn.

---

## 2. CẤU TRÚC LƯU TRỮ VÀ CHÍNH SÁCH VÒNG ĐỜI (GFS RETENTION)

### 2.1. Cấu trúc thư mục

```
legal-chatbot-system/
├── scripts/
│   ├── backup.sh                     # Kịch bản đóng gói sao lưu tự động
│   └── restore.sh                    # Kịch bản khôi phục và đối soát dữ liệu
├── storage/
│   ├── backups/                      # Kho lưu trữ các gói sao lưu nén
│   │   ├── backup_YYYYMMDD_HHMMSS.tar.gz
│   │   ├── backup_YYYYMMDD_HHMMSS.tar.gz.sha256
│   │   ├── safety_before_restore_*.tar.gz
│   │   ├── backup.log
│   │   └── restore.log
│   └── raw_documents/                # Kho lưu trữ tệp gốc theo SHA-256
└── docs/
    ├── BACKUP_SYSTEM_PROPOSAL.md     # Đề xuất thiết kế kiến trúc
    └── BACKUP_GUIDE.md               # Cẩm nang vận hành (tài liệu này)
```

### 2.2. Cơ chế xoay vòng và giải phóng dung lượng (Retention Policy)
- **Chu kỳ lưu trữ chuẩn:** Áp dụng chính sách xoay vòng GFS duy trì các bản sao lưu trong vòng 30 ngày gần nhất.
- **Tự động dọn dẹp:** Sau mỗi lần sao lưu thành công, `scripts/backup.sh` tự động quét thư mục `storage/backups/` và xóa các tệp `.tar.gz` cùng tệp `.sha256` có tuổi đời vượt quá 30 ngày.
- **Bảo toàn tính an toàn:** Các tệp chụp trạng thái an toàn trước khi khôi phục (`safety_before_restore_*.tar.gz`) được tạo riêng biệt và chỉ xóa thủ công sau khi hệ thống chạy ổn định.

---

## 3. CƠ CHẾ SAO LƯU TỰ ĐỘNG (AUTOMATED DAILY BACKUP)

Hệ thống được lập lịch chạy ngầm tự động vào lúc 02:00 sáng mỗi ngày thông qua tiện ích Cron của hệ điều hành Linux (WSL2/Ubuntu).

### Cấu hình Cron Job hiện hành:
```bash
0 2 * * * /bin/bash /mnt/d/Workplace/legal-chatbot-system/scripts/backup.sh >> /mnt/d/Workplace/legal-chatbot-system/storage/backups/backup.log 2>&1
```

### Kiểm tra trạng thái lập lịch:
Để kiểm tra danh sách cron job đang hoạt động:
```bash
crontab -l
```

Để theo dõi nhật ký thực thi tự động:
```bash
tail -n 50 /mnt/d/Workplace/legal-chatbot-system/storage/backups/backup.log
```

---

## 4. QUY TRÌNH THAO TÁC SAO LƯU THỦ CÔNG (ON-DEMAND BACKUP)

Người quản trị hệ thống PHẢI thực hiện sao lưu thủ công trong các tình huống sau:
1. Trước khi chạy migration cơ sở dữ liệu (`migrations/*.sql`).
2. Trước khi cập nhật mã nguồn (git pull, triển khai release mới).
3. Trước khi nạp hàng loạt (bulk ingestion) văn bản pháp luật dung lượng lớn.

### Lệnh thực hiện:
```bash
cd /mnt/d/Workplace/legal-chatbot-system
./scripts/backup.sh
```

### Kết quả đầu ra kỳ vọng:
- Sinh ra tệp lưu trữ: `storage/backups/backup_YYYYMMDD_HHMMSS.tar.gz`.
- Sinh ra tệp tổng kiểm tra: `storage/backups/backup_YYYYMMDD_HHMMSS.tar.gz.sha256`.
- Kịch bản tự động xác thực tính toàn vẹn bằng lệnh `sha256sum -c` ngay trước khi kết thúc và trả về mã thoát `0`.

---

## 5. QUY TRÌNH PHỤC HỒI DỮ LIỆU AN TOÀN (SAFE DISASTER RECOVERY)

Quy trình phục hồi được lập trình phòng thủ nhiều tầng qua kịch bản `scripts/restore.sh`, gồm 5 bước tiêu chuẩn:

### 5.1. Lệnh khôi phục

Khôi phục bản sao lưu mới nhất:
```bash
cd /mnt/d/Workplace/legal-chatbot-system
./scripts/restore.sh latest
```

Khôi phục một bản sao lưu chỉ định:
```bash
./scripts/restore.sh storage/backups/backup_20261101_140002.tar.gz
```

### 5.2. Các bước kịch bản tự động thực thi:

1. **Bước 1 - Xác minh toàn vẹn băm SHA-256:**
   - Kịch bản kiểm tra tệp chữ ký `.sha256` tương ứng. Nếu tệp lưu trữ bị hỏng, suy hao bit hoặc bị can thiệp, quá trình phục hồi lập tức dừng lại để bảo vệ hệ thống.

2. **Bước 2 - Tự động tạo ảnh chụp an toàn (Safety Snapshot):**
   - Trước khi ghi đè bất kỳ dữ liệu nào, hệ thống tự động xuất nhanh toàn bộ database và ChromaDB hiện thời thành tệp `storage/backups/safety_before_restore_YYYYMMDD_HHMMSS.tar.gz`. Nếu quản trị viên phục hồi nhầm phiên bản, có thể quay lại trạng thái trước đó ngay lập tức.

3. **Bước 3 - Phục hồi cơ sở dữ liệu PostgreSQL:**
   - Sử dụng lệnh `pg_restore --clean --if-exists` trực tiếp vào container PostgreSQL `db`, làm sạch và tái tạo đầy đủ bảng, chỉ mục và dữ liệu.

4. **Bước 4 - Phục hồi Vector DB và Kho tệp gốc:**
   - Dọn dẹp thư mục `ai-core/chroma_db/` hiện tại và giải nén bản snapshot vector từ gói sao lưu.
   - Đồng bộ lại kho tệp gốc `storage/raw_documents/`.

5. **Bước 5 - Đối soát số lượng bản ghi & Cơ chế cứu hộ khẩn cấp:**
   - Truy vấn trực tiếp PostgreSQL để đếm số lượng bản ghi:
     + `SELECT COUNT(*) FROM legal_documents;`
     + `SELECT COUNT(*) FROM legal_articles;`
     + `SELECT COUNT(*) FROM users;`
   - Kiểm tra tệp cơ sở dữ liệu ChromaDB (`ai-core/chroma_db/chroma.sqlite3`). Nếu phát hiện tệp vector bị mất hoặc lỗi phân đoạn, kịch bản tự động kích hoạt tiến trình cứu hộ `python3 ai-core/scripts/reindex_existing.py` để nhúng lại toàn bộ các Điều/Khoản từ PostgreSQL vào ChromaDB mà không mất dữ liệu.

---

## 6. SỔ TAY XỬ LÝ SỰ CỐ (TROUBLESHOOTING RUNBOOK)

### Tình huống 1: Lỗi sai lệch mã băm (SHA256 Checksum FAILED)
- **Triệu chứng:** `restore.sh` báo lỗi `Tong kiem tra SHA-256 khong hop le!` và thoát với mã lỗi 1.
- **Nguyên nhân:** Tệp sao lưu bị ngắt quãng giữa chừng khi ghi, lỗi đĩa hoặc bị sửa đổi.
- **Cách xử lý:**
  1. Không cố ép phục hồi tệp hỏng.
  2. Kiểm tra danh sách bản sao lưu khả dụng: `ls -la storage/backups/`.
  3. Chọn bản sao lưu liền kề trước đó: `./scripts/restore.sh storage/backups/backup_YYYYMMDD_HHMMSS.tar.gz`.

### Tình huống 2: Vector DB ChromaDB bị hỏng sau phục hồi
- **Triệu chứng:** Khôi phục PostgreSQL thành công nhưng Chatbot không tìm thấy nguồn hoặc API báo lỗi vector database.
- **Cách xử lý:** Chạy thủ công kịch bản tái lập chỉ mục ngữ nghĩa từ cơ sở dữ liệu quan hệ:
  ```bash
  cd /mnt/d/Workplace/legal-chatbot-system
  python3 ai-core/scripts/reindex_existing.py
  ```

### Tình huống 3: Dung lượng ổ đĩa bị đầy (Disk Space Exhaustion)
- **Triệu chứng:** Sao lưu thất bại với lỗi `No space left on device`.
- **Cách xử lý:**
  1. Kiểm tra dung lượng: `df -h`.
  2. Rà soát và xóa các bản sao lưu an toàn cũ không còn cần thiết:
     ```bash
     ls -lh storage/backups/safety_before_restore_*
     rm -f storage/backups/safety_before_restore_YYYYMMDD_*.tar.gz
     ```
  3. Dọn dẹp cache Docker nếu cần: `docker system prune -f`.

### Tình huống 4: Muốn quay lại trạng thái ngay trước khi Restore
- **Triệu chứng:** Quản trị viên phục hồi nhầm một bản backup cũ và muốn hoàn tác về trạng thái của hệ thống cách đây 10 phút.
- **Cách xử lý:**
  Xác định tệp `safety_before_restore_*.tar.gz` mới nhất trong `storage/backups/` và thực hiện phục hồi tệp này:
  ```bash
  ./scripts/restore.sh storage/backups/safety_before_restore_YYYYMMDD_HHMMSS.tar.gz
  ```

---

## 7. BẢNG KIỂM TRA ĐỊNH KỲ DÀNH CHO QUẢN TRỊ VIÊN (MONTHLY CHECKLIST)

| Thời điểm | Hạng mục kiểm tra | Lệnh / Thao tác | Tiêu chí đạt |
| :--- | :--- | :--- | :--- |
| Hằng ngày | Kiểm tra nhật ký backup tự động | `tail -n 20 storage/backups/backup.log` | Không có mã lỗi, báo `HOAN TAT SAO LUU` |
| Hằng tuần | Kiểm tra kích thước và số lượng backup | `ls -lh storage/backups/` | Tệp có kích thước hợp lý (>20MB), đủ cặp `.sha256` |
| Hằng tháng | Diễn tập phục hồi thử nghiệm | Chạy `./scripts/restore.sh latest` trên môi trường staging | Dữ liệu đối soát khớp 100%, Chatbot trả lời chuẩn xác |

---

## 8. QUẢN TRỊ TRÊN GIAO DIỆN WEB VÀ TÍNH NĂNG NÂNG CAO (GIAI ĐOẠN 3)

### 8.1. Tab "Sao lưu & Dữ liệu" trên Cổng Quản trị Admin
Quản trị viên có vai trò `admin` có thể trực tiếp theo dõi và thao tác toàn diện tại đường dẫn `/admin/backups`:
- **4 Thẻ chỉ số thời gian thực:**
  1. *Lịch sao lưu tự động:* Giám sát trạng thái hoạt động của tiến trình Cron (02:00 sáng mỗi ngày).
  2. *Bản sao lưu gần nhất:* Hiển thị tên tệp và thời điểm tạo bản sao lưu mới nhất.
  3. *Dung lượng kho lưu trữ:* Tổng dung lượng và tổng số lượng gói lưu trữ trong hệ thống.
  4. *Toàn vẹn dữ liệu:* Trạng thái kiểm tra mã băm SHA-256 đối soát.
- **Tác vụ 1-Click:**
  - *Sao lưu toàn diện ngay:* Kích hoạt tiến trình sao lưu nền, không chặn giao diện và tự động cập nhật danh sách khi hoàn tất.
  - *Tải về:* Tải tệp `.tar.gz` về máy tính quản trị viên để lưu trữ ngoại tuyến.
  - *Khôi phục an toàn:* Mở hộp thoại cảnh báo rủi ro, yêu cầu nhập chuỗi xác nhận `XAC-NHAN-PHUC-HOI` trước khi thực thi.
  - *Xóa bản sao lưu:* Xóa tệp nén và tệp mã băm tương ứng.
- **Trình xem nhật ký (Logs Viewer):**
  - Chuyển đổi giữa `backup.log` và `restore.log` với chế độ tự động ngắt dòng và font monospace.

### 8.2. Danh mục API Backend (`/admin/backups`)
Mọi endpoint đều được bảo vệ nghiêm ngặt bởi `JwtAuthGuard` và `RolesGuard('admin')`:
- `GET /admin/backups`: Danh sách gói sao lưu và thống kê tổng quan.
- `POST /admin/backups/run`: Kích hoạt sao lưu toàn diện thủ công.
- `GET /admin/backups/download/:filename`: Tải gói sao lưu an toàn.
- `POST /admin/backups/restore`: Khôi phục an toàn (Body: `{ filename, confirmation: "XAC-NHAN-PHUC-HOI" }`).
- `DELETE /admin/backups/:filename`: Xóa bản sao lưu.
- `GET /admin/backups/logs`: Đọc nhật ký vận hành gần nhất.

### 8.3. Mã hóa đối xứng AES-256 (Tùy chọn nâng cao)
Khi lưu trữ các gói sao lưu tại các đám mây công cộng, quản trị viên có thể kích hoạt mã hóa AES-256-CBC:
```bash
export BACKUP_ENCRYPTION_KEY="khoa_bi_mat_an_toan_chuan_enterprise"
./scripts/backup.sh --encrypt
```
Tệp sinh ra có định dạng `backup_YYYYMMDD_HHMMSS.tar.gz.enc` cùng tệp checksum mã hóa tương ứng.

### 8.4. Đồng bộ sao lưu Offsite (Cloudflare R2 / AWS S3)
Kịch bản `scripts/sync_offsite.sh` hỗ trợ đẩy tự động các gói sao lưu và mã SHA-256 lên Cloudflare R2 hoặc AWS S3:
```bash
export OFFSITE_BACKUP_BUCKET="legal-backups"
export OFFSITE_RCLONE_REMOTE="r2"
./scripts/sync_offsite.sh
```
Nếu chưa cài đặt `rclone` hoặc `aws-cli`, kịch bản ghi thông báo hướng dẫn và bảo vệ dữ liệu nguyên vẹn trên đĩa cục bộ.
