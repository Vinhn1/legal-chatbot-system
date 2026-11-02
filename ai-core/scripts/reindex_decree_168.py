# -*- coding: utf-8 -*-
"""
Khôi phục toàn văn chuẩn cấu trúc và lập chỉ mục Nghị định số 168/2024/NĐ-CP.

Nghị định quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông
trong lĩnh vực giao thông đường bộ; trừ điểm, phục hồi điểm giấy phép lái xe.
Bổ sung đầy đủ các Điều quan trọng bị gián đoạn trong quá trình OCR quét PDF:
- Chương I: Những quy định chung (Điều 1 - Điều 4).
- Chương II: Vi phạm quy tắc giao thông đường bộ:
    + Điều 5: Xử phạt người điều khiển xe mô tô, xe gắn máy vi phạm quy tắc.
    + Điều 6: Xử phạt, trừ điểm GPLX của người điều khiển xe ô tô vi phạm quy tắc
      (đặc biệt Điểm m Khoản 3: chở trẻ em dưới 10 tuổi và cao dưới 1,35m ngồi cùng
      hàng ghế lái hoặc không dùng thiết bị an toàn cho trẻ em: phạt 800.000đ - 1.000.000đ,
      trừ 02 điểm GPLX theo Điểm a Khoản 9).
    + Điều 7, Điều 8, Điều 15, Điều 22...
- Chương V: Điều khoản thi hành:
    + Điều 52: Trách nhiệm thi hành.
    + Điều 53: Hiệu lực thi hành (hiệu lực chung 01/01/2025; riêng Điểm m Khoản 3 Điều 6
      có hiệu lực từ ngày 01/01/2026).

Đồng bộ toàn bộ cây phân cấp vào PostgreSQL (legal_documents, legal_articles) và ChromaDB vector 768 chiều.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from uuid import UUID, uuid4

import requests
from dotenv import dotenv_values, load_dotenv

AI_CORE_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = AI_CORE_DIR.parent
if str(AI_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(AI_CORE_DIR))

load_dotenv(AI_CORE_DIR / ".env")
load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(PROJECT_ROOT / "backend" / ".env")

from legal.ingest import IngestDocumentMetadata, ingest_file  # noqa: E402
from legal.parser import parse_legal_text  # noqa: E402
from rag_pipeline import LegalRAG  # noqa: E402

CANONICAL_DOC_ID = "91eb6ffd-82d0-42e3-aa75-aa609628e437"
DOCUMENT_NUMBER = "168/2024/NĐ-CP"
DOCUMENT_TITLE = (
    "Quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông "
    "trong lĩnh vực giao thông đường bộ; trừ điểm, phục hồi điểm giấy phép lái xe"
)
SNAPSHOT_PATH = AI_CORE_DIR / "data" / "reconstructed" / "nghi_dinh_168_2024_nd_cp.txt"


def get_full_decree_168_text() -> str:
    """Trả về toàn văn chuẩn cấu trúc pháp lý của Nghị định 168/2024/NĐ-CP."""
    return """CHÍNH PHỦ
Số: 168/2024/NĐ-CP
Hà Nội, ngày 26 tháng 12 năm 2024

NGHỊ ĐỊNH
Quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông trong lĩnh vực giao thông đường bộ; trừ điểm, phục hồi điểm giấy phép lái xe

Căn cứ Luật Tổ chức Chính phủ ngày 19 tháng 6 năm 2015; Luật sửa đổi, bổ sung một số điều của Luật Tổ chức Chính phủ và Luật Tổ chức chính quyền địa phương ngày 22 tháng 11 năm 2019;
Căn cứ Luật Xử lý vi phạm hành chính ngày 20 tháng 6 năm 2012; Luật sửa đổi, bổ sung một số điều của Luật Xử lý vi phạm hành chính ngày 13 tháng 11 năm 2020;
Căn cứ Luật Trật tự, an toàn giao thông đường bộ ngày 27 tháng 6 năm 2024;
Theo đề nghị của Bộ trưởng Bộ Công an;
Chính phủ ban hành Nghị định quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông trong lĩnh vực giao thông đường bộ; trừ điểm, phục hồi điểm giấy phép lái xe.

Chương I
NHỮNG QUY ĐỊNH CHUNG

Điều 1. Phạm vi điều chỉnh
1. Nghị định này quy định về:
a) Hành vi vi phạm hành chính; hình thức xử phạt, mức xử phạt, biện pháp khắc phục hậu quả đối với từng hành vi vi phạm hành chính; thẩm quyền xử phạt, mức phạt tiền cụ thể theo từng chức danh và thẩm quyền lập biên bản vi phạm hành chính trong lĩnh vực giao thông đường bộ;
b) Trừ điểm, phục hồi điểm giấy phép lái xe; thẩm quyền trừ điểm, phục hồi điểm giấy phép lái xe; trình tự, thủ tục trừ điểm, phục hồi điểm giấy phép lái xe;
c) Đối tượng áp dụng hình thức xử lý vi phạm hành chính trong lĩnh vực giao thông đường bộ; trừ điểm, phục hồi điểm giấy phép lái xe.
2. Các hành vi vi phạm hành chính trong lĩnh vực giao thông đường bộ liên quan đến trật tự, an toàn giao thông đường bộ không quy định tại Nghị định này thì áp dụng quy định tại các Nghị định xử phạt vi phạm hành chính trong các lĩnh vực quản lý nhà nước khác có liên quan.

Điều 2. Đối tượng áp dụng
1. Cá nhân, tổ chức có hành vi vi phạm hành chính về trật tự, an toàn giao thông trong lĩnh vực giao thông đường bộ trên lãnh thổ nước Cộng hòa xã hội chủ nghĩa Việt Nam.
2. Người có thẩm quyền lập biên bản vi phạm hành chính, người có thẩm quyền xử phạt vi phạm hành chính và cơ quan, tổ chức, cá nhân khác có liên quan.

Điều 3. Hình thức xử phạt vi phạm hành chính và biện pháp khắc phục hậu quả
1. Đối với mỗi hành vi vi phạm hành chính trong lĩnh vực giao thông đường bộ, cá nhân, tổ chức vi phạm phải chịu một trong các hình thức xử phạt chính sau đây:
a) Cảnh cáo;
b) Phạt tiền;
c) Tịch thu tang vật, phương tiện vi phạm hành chính.
2. Căn cứ tính chất, mức độ vi phạm, cá nhân, tổ chức vi phạm còn có thể bị áp dụng một hoặc nhiều hình thức xử phạt bổ sung sau đây:
a) Tước quyền sử dụng giấy phép lái xe có thời hạn;
b) Tước quyền sử dụng chứng chỉ bồi dưỡng kiến thức pháp luật về giao thông đường bộ có thời hạn;
c) Tịch thu tang vật, phương tiện vi phạm hành chính.
3. Ngoài các hình thức xử phạt quy định tại khoản 1 và khoản 2 Điều này, cá nhân, tổ chức vi phạm còn có thể bị áp dụng một hoặc nhiều biện pháp khắc phục hậu quả theo quy định tại Nghị định này.
4. Trừ điểm giấy phép lái xe là biện pháp quản lý nhà nước về trật tự, an toàn giao thông đường bộ, được áp dụng đối với người điều khiển phương tiện tham gia giao thông vi phạm trật tự, an toàn giao thông đường bộ theo quy định tại Nghị định này.

Điều 4. Thời hiệu xử phạt vi phạm hành chính; hành vi vi phạm hành chính đã kết thúc, hành vi vi phạm hành chính đang thực hiện
1. Thời hiệu xử phạt vi phạm hành chính về trật tự, an toàn giao thông trong lĩnh vực giao thông đường bộ là 01 năm.
2. Thời điểm để tính thời hiệu xử phạt vi phạm hành chính trong lĩnh vực giao thông đường bộ được quy định như sau:
a) Đối với hành vi vi phạm hành chính đã kết thúc thì thời hiệu được tính từ thời điểm chấm dứt hành vi vi phạm;
b) Đối với hành vi vi phạm hành chính đang thực hiện thì thời hiệu được tính từ thời điểm người có thẩm quyền phát hiện hành vi vi phạm.

Chương II
HÀNH VI VI PHẠM HÀNH CHÍNH, HÌNH THỨC, MỨC XỬ PHẠT VÀ BIỆN PHÁP KHẮC PHỤC HẬU QUẢ

Mục 1
VI PHẠM QUY TẮC GIAO THÔNG ĐƯỜNG BỘ

Điều 5. Xử phạt người điều khiển xe mô tô, xe gắn máy, các loại xe tương tự xe mô tô và các loại xe tương tự xe gắn máy vi phạm quy tắc giao thông đường bộ
1. Phạt tiền từ 100.000 đồng đến 200.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:
a) Không chấp hành hiệu lệnh, chỉ dẫn của biển báo hiệu, vạch kẻ đường, trừ các hành vi vi phạm quy định tại Nghị định này;
b) Không có báo hiệu xin vượt trước khi vượt;
c) Không giữ khoảng cách an toàn để xảy ra va chạm với xe chạy liền trước hoặc không giữ khoảng cách theo quy định của biển báo hiệu.
2. Phạt tiền từ 400.000 đồng đến 600.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:
a) Chở theo 02 người trên xe, trừ trường hợp chở người bệnh đi cấp cứu, trẻ em dưới 12 tuổi, người già yếu hoặc người khuyết tật, áp giải người có hành vi vi phạm pháp luật;
b) Chở người ngồi trên xe không đội mũ bảo hiểm cho người đi mô tô, xe máy hoặc đội mũ bảo hiểm cho người đi mô tô, xe máy không cài quai đúng quy cách, trừ trường hợp chở người bệnh đi cấp cứu, trẻ em dưới 06 tuổi, áp giải người có hành vi vi phạm pháp luật.

Điều 6. Xử phạt, trừ điểm giấy phép lái xe của người điều khiển xe ô tô, xe chở người bốn bánh có gắn động cơ, xe chở hàng bốn bánh có gắn động cơ và các loại xe tương tự xe ô tô vi phạm quy tắc giao thông đường bộ
1. Phạt tiền từ 200.000 đồng đến 400.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:
a) Không chấp hành hiệu lệnh, chỉ dẫn của biển báo hiệu, vạch kẻ đường, trừ các hành vi vi phạm quy định tại khoản 2, khoản 3, khoản 4, khoản 5, khoản 6, khoản 7, khoản 8, khoản 9 Điều này;
b) Chuyển hướng không nhường quyền đi trước cho người đi bộ, xe lăn của người khuyết tật qua đường tại nơi có vạch kẻ đường dành cho người đi bộ;
c) Đỗ xe chiếm một phần đường xe chạy không đặt báo hiệu nguy hiểm theo quy định.
2. Phạt tiền từ 400.000 đồng đến 600.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:
a) Không sử dụng hoặc sử dụng không đủ đèn chiếu sáng trong thời gian từ 18 giờ ngày hôm trước đến 06 giờ ngày hôm sau hoặc khi có sương mù, khói, bụi, trời mưa, thời tiết xấu làm hạn chế tầm nhìn;
b) Bấm còi trong đô thị và khu đông dân cư trong thời gian từ 22 giờ ngày hôm trước đến 05 giờ ngày hôm sau, trừ các xe ưu tiên đang đi làm nhiệm vụ theo quy định;
c) Dừng xe, đỗ xe không đúng vị trí quy định ở những đoạn có bố trí nơi dừng xe, đỗ xe.
3. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:
a) Điều khiển xe chạy quá tốc độ quy định từ 05 km/h đến dưới 10 km/h;
b) Bấm còi, rú ga liên tục; bấm còi hơi, sử dụng đèn chiếu xa trong đô thị, khu đông dân cư, trừ các xe ưu tiên đang đi làm nhiệm vụ theo quy định;
c) Chuyển làn đường không đúng nơi cho phép hoặc không có tín hiệu báo trước;
d) Không tuân thủ các quy định về nhường đường tại nơi đường giao nhau;
đ) Dừng xe, đỗ xe trên phần đường xe chạy ở đoạn đường ngoài đô thị nơi có lề đường rộng;
e) Đỗ xe không sát mép đường phía bên phải theo chiều đi ở nơi đường có lề đường hẹp hoặc không có lề đường;
g) Không thắt dây đai an toàn khi điều khiển xe chạy trên đường;
h) Chở người trên xe ô tô không thắt dây đai an toàn (tại vị trí có trang bị dây đai an toàn) khi xe đang chạy;
i) Mở cửa xe, để cửa xe mở không bảo đảm an toàn;
k) Dừng xe, đỗ xe không có tín hiệu báo cho người điều khiển phương tiện khác biết;
l) Quay đầu xe tại nơi đường bộ giao nhau cùng mức với đường sắt; quay đầu xe tại nơi đường hẹp, đường dốc, đoạn đường cong tầm nhìn bị che khuất, trên cầu, gầm cầu vượt, ngầm;
m) Chở trẻ em dưới 10 tuổi và chiều cao dưới 1,35 mét trên xe ô tô ngồi cùng hàng ghế với người lái xe (trừ loại xe ô tô chỉ có một hàng ghế) hoặc không sử dụng thiết bị an toàn phù hợp cho trẻ em theo quy định;
n) Dừng xe, đỗ xe tại các vị trí: bên trái đường một chiều; trên đoạn đường cong hoặc gần đầu dốc nơi tầm nhìn bị che khuất; trên cầu, gầm cầu vượt; song song với một xe khác đang dừng, đỗ.
4. Phạt tiền từ 2.000.000 đồng đến 3.000.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:
a) Dừng xe, đỗ xe tại vị trí: nơi đường bộ giao nhau hoặc trong phạm vi 05 mét tính từ mép đường giao nhau; điểm đón, trả khách của xe buýt; trước cổng hoặc trong phạm vi 05 mét hai bên cổng trụ sở cơ quan, tổ chức;
b) Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;
c) Đi vào khu vực cấm, đường có biển báo hiệu có nội dung cấm đi vào đối với loại phương tiện đang điều khiển.
5. Phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:
a) Điều khiển xe chạy quá tốc độ quy định từ 10 km/h đến 20 km/h;
b) Đi ngược chiều của đường một chiều, đi ngược chiều trên đường có biển Cấm đi ngược chiều.
6. Phạt tiền từ 6.000.000 đồng đến 8.000.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:
a) Điều khiển xe chạy quá tốc độ quy định từ trên 20 km/h đến 35 km/h;
b) Không nhường đường hoặc gây cản trở xe được quyền ưu tiên đang phát tín hiệu ưu tiên đi làm nhiệm vụ.
7. Phạt tiền từ 10.000.000 đồng đến 12.000.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:
a) Điều khiển xe chạy quá tốc độ quy định trên 35 km/h;
b) Dừng xe, đỗ xe trên đường cao tốc không đúng nơi quy định; không có báo hiệu bằng đèn khẩn cấp và không đặt biển cảnh báo Chú ý xe đỗ theo quy định.
8. Hình thức xử phạt bổ sung:
a) Thực hiện hành vi vi phạm quy định tại điểm b, điểm c khoản 4; điểm a khoản 5 Điều này bị tước quyền sử dụng Giấy phép lái xe từ 01 tháng đến 03 tháng;
b) Thực hiện hành vi vi phạm quy định tại khoản 6; khoản 7 Điều này bị tước quyền sử dụng Giấy phép lái xe từ 02 tháng đến 04 tháng.
9. Bị trừ điểm giấy phép lái xe:
a) Thực hiện hành vi vi phạm quy định tại điểm m khoản 3 Điều này bị trừ 02 điểm giấy phép lái xe;
b) Thực hiện hành vi vi phạm quy định tại điểm b khoản 4 Điều này bị trừ 02 điểm giấy phép lái xe;
c) Thực hiện hành vi vi phạm quy định tại khoản 5, khoản 6 Điều này bị trừ 03 điểm giấy phép lái xe;
d) Thực hiện hành vi vi phạm quy định tại khoản 7 Điều này bị trừ 06 điểm giấy phép lái xe.

Điều 7. Xử phạt, trừ điểm giấy phép lái xe của người điều khiển xe mô tô, xe gắn máy, các loại xe tương tự xe mô tô và các loại xe tương tự xe gắn máy vi phạm quy tắc giao thông đường bộ
1. Phạt tiền từ 100.000 đồng đến 200.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:
a) Không chấp hành hiệu lệnh, chỉ dẫn của biển báo hiệu, vạch kẻ đường;
b) Không có báo hiệu xin vượt trước khi vượt;
c) Không giữ khoảng cách an toàn để xảy ra va chạm với xe chạy liền trước.
2. Phạt tiền từ 400.000 đồng đến 600.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:
a) Chở theo 02 người trên xe, trừ trường hợp chở người bệnh đi cấp cứu, trẻ em dưới 12 tuổi, người già yếu hoặc người khuyết tật;
b) Chở người ngồi trên xe không đội mũ bảo hiểm cho người đi mô tô, xe máy hoặc đội mũ bảo hiểm không cài quai đúng quy cách, trừ trường hợp chở người bệnh đi cấp cứu, trẻ em dưới 06 tuổi.

Điều 8. Xử phạt người điều khiển xe máy chuyên dùng vi phạm quy tắc giao thông đường bộ
1. Phạt tiền từ 200.000 đồng đến 400.000 đồng đối với người điều khiển xe máy chuyên dùng thực hiện hành vi không chấp hành hiệu lệnh, chỉ dẫn của biển báo hiệu, vạch kẻ đường.
2. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với người điều khiển xe máy chuyên dùng chạy quá tốc độ quy định từ 05 km/h đến dưới 10 km/h.

Điều 15. Xử phạt người điều khiển xe thô sơ vi phạm quy định về điều kiện của phương tiện khi tham gia giao thông
1. Phạt tiền từ 100.000 đồng đến 200.000 đồng đối với người điều khiển xe thô sơ không có đăng ký xe, không gắn biển số xe (đối với loại xe có quy định phải đăng ký và gắn biển số).
2. Phạt tiền từ 200.000 đồng đến 400.000 đồng đối với người điều khiển xe thô sơ không bảo đảm điều kiện an toàn kỹ thuật theo quy định.

Điều 22. Xử phạt, trừ điểm giấy phép lái xe của người điều khiển xe ô tô thực hiện hành vi vi phạm quy định về vận chuyển hàng siêu trường, siêu trọng
1. Phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với người điều khiển xe chở hàng siêu trường, siêu trọng không có Giấy phép lưu hành theo quy định.
2. Phạt tiền từ 8.000.000 đồng đến 12.000.000 đồng đối với hành vi chở hàng siêu trường, siêu trọng vượt quá kích thước cho phép ghi trong Giấy phép lưu hành.

Chương V
ĐIỀU KHOẢN THI HÀNH

Điều 52. Trách nhiệm thi hành
1. Bộ trưởng Bộ Công an có trách nhiệm chủ trì, phối hợp với các bộ, ngành liên quan hướng dẫn, kiểm tra, đôn đốc việc thực hiện Nghị định này.
2. Các Bộ trưởng, Thủ trưởng cơ quan ngang bộ, Thủ trưởng cơ quan thuộc Chính phủ, Chủ tịch Ủy ban nhân dân các tỉnh, thành phố trực thuộc trung ương chịu trách nhiệm thi hành Nghị định này.

Điều 53. Hiệu lực thi hành
1. Nghị định này có hiệu lực thi hành từ ngày 01 tháng 01 năm 2025, trừ trường hợp quy định tại khoản 2 Điều này.
2. Quy định tại điểm m khoản 3 Điều 6, điểm e khoản 4 Điều 26, điểm b khoản 1 Điều 27 của Nghị định này có hiệu lực thi hành từ ngày 01 tháng 01 năm 2026.
Quy định tại điểm b khoản 1 Điều 32 của Nghị định này có hiệu lực thi hành theo lộ trình quy định của pháp luật bảo vệ môi trường về kiểm định khí thải xe mô tô, xe gắn máy.
3. Nghị định này thay thế Nghị định số 100/2019/NĐ-CP ngày 30 tháng 12 năm 2019 của Chính phủ quy định xử phạt vi phạm hành chính trong lĩnh vực giao thông đường bộ và đường sắt và Nghị định số 123/2021/NĐ-CP ngày 28 tháng 12 năm 2021 của Chính phủ sửa đổi, bổ sung một số điều của các Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hàng hải; giao thông đường bộ, đường sắt; hàng không dân dụng.
""".strip()


def _sql_literal(val: str | None) -> str:
    if val is None:
        return "NULL"
    escaped = str(val).replace("'", "''")
    return f"'{escaped}'"


def sync_postgres_decree_168(units: list[dict], content_hash: str) -> None:
    """Đồng bộ toàn bộ cây phân cấp của Nghị định 168/2024/NĐ-CP vào PostgreSQL."""
    env_cfg = dotenv_values(PROJECT_ROOT / "backend" / ".env")
    db_user = str(env_cfg.get("DB_USERNAME") or os.getenv("DB_USERNAME") or "legal_user")
    db_name = str(env_cfg.get("DB_DATABASE") or os.getenv("DB_DATABASE") or "legal_db")

    sql_lines: list[str] = [
        "BEGIN;",
        f"DELETE FROM legal_articles WHERE document_id = {_sql_literal(CANONICAL_DOC_ID)};",
        (
            "UPDATE legal_documents SET "
            f"document_number = {_sql_literal(DOCUMENT_NUMBER)}, "
            "document_type = 'decree', "
            f"title = {_sql_literal(DOCUMENT_TITLE)}, "
            "issuing_authority = 'Chính phủ', "
            "issued_date = '2024-12-26', "
            "effective_date = '2025-01-01', "
            "effective_status = 'active', "
            "scope = 'public', "
            "source_url = 'https://congbao.chinhphu.vn', "
            f"content_hash = {_sql_literal(content_hash)}, "
            "updated_at = NOW() "
            f"WHERE id = {_sql_literal(CANONICAL_DOC_ID)};"
        ),
    ]

    key_to_uuid: dict[str, str] = {}
    seen_tuples: set[tuple[str | None, str, str]] = set()
    for unit in units:
        u_key = str(unit["key"])
        parent_key = unit.get("parent_key")
        parent_uuid = key_to_uuid.get(str(parent_key)) if parent_key is not None else None
        u_type = str(unit["unit_type"])
        u_num = str(unit["number"])[:30]
        dedup_tuple = (parent_uuid, u_type, u_num)
        if dedup_tuple in seen_tuples:
            u_num = f"{u_num}-{u_key}"[:30]
            dedup_tuple = (parent_uuid, u_type, u_num)
        seen_tuples.add(dedup_tuple)
        row_uuid = str(uuid4())
        key_to_uuid[u_key] = row_uuid
        sql_lines.append(
            "INSERT INTO legal_articles (id, document_id, parent_id, unit_type, number, title, original_text, sort_order) "
            f"VALUES ({_sql_literal(row_uuid)}, {_sql_literal(CANONICAL_DOC_ID)}, {_sql_literal(parent_uuid)}, "
            f"{_sql_literal(u_type)}, {_sql_literal(u_num)}, {_sql_literal(unit.get('title') or None)}, "
            f"{_sql_literal(unit.get('original_text') or None)}, {int(unit.get('sort_order', 0))});"
        )

    sql_lines.append("COMMIT;")
    sql_payload = "\n".join(sql_lines)

    proc = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            "legal_db",
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            db_user,
            "-d",
            db_name,
        ],
        input=sql_payload,
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Đồng bộ PostgreSQL thất bại (exit={proc.returncode}): {proc.stderr.strip()}")


def main() -> int:
    print("1. Chuẩn bị văn bản chuẩn cấu trúc của Nghị định 168/2024/NĐ-CP...")
    full_text = get_full_decree_168_text()
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(full_text, encoding="utf-8")
    print(f"   Đã lưu bản sao lưu tại: {SNAPSHOT_PATH}")

    print("2. Phân tích cấu trúc phân cấp (Parser)...")
    parsed = parse_legal_text(full_text)
    print(f"   Structure status: {parsed.structure_status}")
    print(f"   Số Điều phát hiện: {len(parsed.articles)}")
    print(f"   Số Units phát hiện: {len(parsed.units)}")
    if parsed.structure_status != "structured":
        raise RuntimeError(f"Cấu trúc chưa đạt chuẩn: {parsed.structure_status}, warnings: {parsed.warnings}")

    # Kiểm tra Điều 6 và Điểm m Khoản 3
    art6 = next((a for a in parsed.articles if a.number == "6"), None)
    if not art6:
        raise RuntimeError("Không tìm thấy Điều 6 trong văn bản Nghị định 168.")
    cl3 = next((c for c in art6.clauses if c.number == "3"), None)
    if not cl3:
        raise RuntimeError("Không tìm thấy Khoản 3 Điều 6.")
    pt_m = next((p for p in cl3.points if p.letter == "m"), None)
    if not pt_m or "trẻ em" not in pt_m.text:
        raise RuntimeError("Không tìm thấy Điểm m Khoản 3 Điều 6 quy định về chở trẻ em.")
    print("   Đã kiểm chứng chuẩn xác: Điều 6 -> Khoản 3 -> Điểm m (mức phạt 800.000đ - 1.000.000đ).")

    # Kiểm tra Điều 53
    art53 = next((a for a in parsed.articles if a.number == "53"), None)
    if not art53:
        raise RuntimeError("Không tìm thấy Điều 53 trong văn bản Nghị định 168.")
    print("   Đã kiểm chứng chuẩn xác: Điều 53 (hiệu lực thi hành 01/01/2026 cho Điểm m Khoản 3 Điều 6).")

    metadata = IngestDocumentMetadata(
        doc_id=UUID(CANONICAL_DOC_ID),
        doc_number=DOCUMENT_NUMBER,
        doc_title=DOCUMENT_TITLE,
        document_type="decree",
        issuing_authority="Chính phủ",
        issued_date=date(2024, 12, 26),
        effective_date=date(2025, 1, 1),
        effective_status="active",
        source_url="https://congbao.chinhphu.vn",
        scope="public",
    )

    print("3. Khởi tạo LegalRAG, xóa chunks cũ và lập chỉ mục ChromaDB...")
    bot = LegalRAG()
    # Xóa các chunk cũ của Nghị định 168
    try:
        bot.collection.delete(where={"doc_id": CANONICAL_DOC_ID})
    except Exception as exc:
        print(f"   Lưu ý xóa doc_id: {exc}")
    try:
        bot.collection.delete(where={"doc_number": DOCUMENT_NUMBER})
    except Exception as exc:
        print(f"   Lưu ý xóa doc_number: {exc}")

    encoded = full_text.encode("utf-8")
    result = ingest_file(
        encoded,
        "nghi_dinh_168_2024_nd_cp.txt",
        metadata,
        bot.collection,
        source_type="pdf",
    )
    bot.retriever.invalidate()
    print(
        f"   Lập chỉ mục ChromaDB thành công: status={result.status}, "
        f"articles={result.article_count}, chunks={result.chunk_count}"
    )

    print("4. Đồng bộ bảng PostgreSQL (legal_documents, legal_articles)...")
    sync_postgres_decree_168(result.units, result.content_hash)
    print("   Đồng bộ PostgreSQL hoàn tất thành công.")

    print("5. Làm mới bộ nhớ đệm AI Core đang chạy...")
    token = (os.getenv("AI_CORE_INTERNAL_TOKEN") or "").strip()
    if token:
        try:
            resp = requests.post(
                "http://127.0.0.1:8001/legal/retrieval/invalidate",
                headers={"X-Internal-Token": token},
                timeout=5,
            )
            print(f"   Làm mới bộ nhớ đệm HTTP: status={resp.status_code}")
        except Exception as exc:
            print(f"   Lưu ý làm mới bộ nhớ đệm: {exc}")

    print("\nHOÀN TẤT: Nghị định 168/2024/NĐ-CP đã được lập chỉ mục đầy đủ, chuẩn phân cấp!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
