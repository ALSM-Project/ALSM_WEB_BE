# Bước triển khai: PDF review và canonical chưa ký

Trạng thái: **đã có mã nguồn; cần cấu hình local/dev trước khi tải PDF**.

## Phạm vi

- Chỉ tạo PDF sau khi phiên bản hợp đồng đã được duyệt nội bộ (`READY_FOR_SIGNATURE` + `APPROVED`).
- Bản review có dấu `REVIEW COPY — NOT SIGNED — NOT FOR EXECUTION` trên từng trang.
- Bản canonical được ghim một lần vào version, có dấu `UNSIGNED CONTRACT — AWAITING REQUIRED SIGNATURES`, khối người ký và được chuẩn bị làm đúng bytes đầu vào cho signing provider.
- Nội dung lấy từ bản chụp template đã duyệt và phiên bản hợp đồng bất biến.
- File được mã hóa AES-256-GCM trước khi ghi vào `StoragePort`; hash SHA-256 được lưu và xác minh khi tải.
- Tải file yêu cầu đăng nhập. Sales cần quyền Lead tương ứng; khách cần tài khoản xác minh email và grant Lead còn hiệu lực.
- Mọi lần tạo và tải ghi audit. `reviewPdfAvailable`/`canonicalPdfAvailable` chỉ cho biết version đã được duyệt để có thể tải; không có nghĩa hợp đồng đã gửi hoặc đã ký.

## Cấu hình local trên PowerShell

Backend cần ba cấu hình tùy chọn sau để render/tải PDF. Lưu khóa ổn định trong secret manager hoặc cấu hình local không được commit. Không tạo khóa mới mỗi lần khởi động; đổi khóa sẽ cần quy trình mã hóa lại file và cập nhật version khóa.

```powershell
# Chỉ chạy một lần để tạo khóa 32 byte; lưu kết quả vào kho bí mật local của bạn.
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))

# Đặt trong cửa sổ PowerShell dùng để khởi động backend.
$env:CONTRACT_EVIDENCE_ENCRYPTION_KEY = '<base64-32-byte-key-from-secure-storage>'
$env:CONTRACT_PDF_FONT_PATH = 'C:\Windows\Fonts\arial.ttf'
$env:CONTRACT_PDF_FONT_BOLD_PATH = 'C:\Windows\Fonts\arialbd.ttf'
```

Nếu backend chạy trong Docker, đường dẫn font phải tồn tại **bên trong container**; mount font được cấp phép ở chế độ chỉ đọc rồi cấu hình hai biến font theo đường dẫn container. Không dùng path Windows host trực tiếp trong container.

Không đưa khóa vào frontend, Git, log, ticket, ảnh chụp hoặc lịch sử shell được chia sẻ. Dùng cùng một khóa local/dev qua các lần khởi động để file đã mã hóa tiếp tục tải được. Production cần secret manager/KMS và kho file private có retention, backup, access logging và quy trình khôi phục đã phê duyệt; `LocalDiskStorageAdapter` hiện tại chưa phải cấu hình production được chứng nhận.

## Kiểm tra giao diện

1. Dùng Lead đã liên kết với khách có tài khoản ALSM đã xác minh và đã nhận invitation.
2. Tạo hợp đồng từ template đã được phê duyệt, gửi duyệt và duyệt nội bộ.
3. Từ FE2 tải **Download unsigned PDF**; từ FE1 bằng tài khoản khách tải **Download unsigned contract PDF**.
4. Xác nhận PDF đúng template/version, có nhãn chưa ký và các vị trí chữ ký nhưng không chứa chữ ký hoặc chứng cứ provider.
5. Có thể tải bản **review PDF** riêng để xác nhận nhãn không dùng ký.
6. Tải lại để backend xác minh giải mã/hash; thử account không có grant và xác nhận API không cho tải.

## Giới hạn còn lại

Canonical PDF là đầu vào chưa ký cho provider, không phải bằng chứng đã ký. Chức năng hiện tại chưa phát hành envelope, chưa gửi OTP, chưa xác minh danh tính/thẩm quyền đại diện, chưa thu thập chữ ký số và chưa tạo PDF hoàn tất/evidence package. Không dùng các PDF này để kích hoạt UC-64. Tích hợp signing cần tài khoản sandbox, tài liệu API/webhook chính thức, credential, chính sách OTP và quy trình lưu hồ sơ do nhà cung cấp xác nhận.
