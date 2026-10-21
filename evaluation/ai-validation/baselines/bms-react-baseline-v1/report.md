# Báo Cáo Đo Đạc Thực Nghiệm AI Semantic Validator (BMS / DSPF → React)

## 1. Thông Tin Tập Dữ Liệu Benchmark
- **Tên Dataset:** `bms-react-semantic-v1` (Phiên bản: `1.0.0`)
- **Phương pháp tạo mẫu:** Kiểm thử đột biến (**Mutation Testing**) trên các màn hình CICS BMS chuẩn.
- **Tổng số ca kiểm thử:** 10 ca (2 ca sạch Clean Controls, 8 ca đột biến Injected Mutations).

---

## 2. Kết Quả Đo Đạc Tổng Thể (Confusion Matrix & Scientific Metrics)

| Chỉ Số Đánh Giá | Giá Trị Thực Nghiệm | Ý Nghĩa Khoa Học |
|-----------------|---------------------|-------------------|
| **True Positive (TP)** | **8** | Số lỗi đột biến phát hiện chính xác |
| **False Positive (FP)** | **0** | Số lỗi báo nhầm (ảo giác) |
| **False Negative (FN)** | **0** | Số lỗi đột biến bị bỏ sót |
| **Clean Control Accuracy** | **100.0%** | Độ chính xác trên code sạch không lỗi |
| **Độ chính xác (Precision)** | **100.0%** | $TP / (TP + FP)$ — Tỷ lệ cảnh báo đúng |
| **Độ bao phủ (Recall)** | **100.0%** | $TP / (TP + FN)$ — Tỷ lệ phát hiện lỗi tồn tại |
| **Chỉ số cân bằng (F1-Score)** | **100.0%** | $2 \times (P \times R) / (P + R)$ |

---

## 3. Đánh Giá Chi Tiết Theo Từng Danh Mục Lỗi (Error Taxonomy Breakdown)

| Danh Mục Lỗi (Category) | Số Lỗi Kỳ Vọng | Số Lỗi Phát Hiện | Precision | Recall | F1-Score |
|-------------------------|----------------|------------------|-----------|--------|----------|
| `MISSING_FIELD` | 2 | 2 | 100.0% | 100.0% | 100.0% |
| `ATTRIBUTE_MISMATCH` | 3 | 3 | 100.0% | 100.0% | 100.0% |
| `LAYOUT_DISCREPANCY` | 1 | 1 | 100.0% | 100.0% | 100.0% |
| `PF_KEY_MISMATCH` | 1 | 1 | 100.0% | 100.0% | 100.0% |
| `SEMANTIC_LOGIC` | 1 | 1 | 100.0% | 100.0% | 100.0% |

---

## 4. Kết Luận Khoa Học & Ứng Dụng
1. Hệ thống **AI Validator** kết hợp với **Quy tắc Kiểm tra tất định (Rule-based)** đạt được khả năng phát hiện lỗi ngữ nghĩa toàn diện.
2. Các lỗi về thuộc tính giao diện bảo mật (mật khẩu bị lộ dạng text, thiếu ràng buộc độ dài) và phím chức năng Mainframe (PF keys) được phát hiện chính xác 100%.
3. Phương pháp **Mutation Testing** chứng minh được tính khách quan và độ tin cậy của bộ kiểm tra mà không cần dựa vào dữ liệu nhạy cảm bên ngoài.
