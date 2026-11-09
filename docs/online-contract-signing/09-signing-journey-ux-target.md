# Quy trình ký mục tiêu — tham khảo ý tưởng giao diện người dùng

- **Ngày ghi nhận:** 03-11-2026
- **Trạng thái:** `UX REQUIREMENT CAPTURED — PROVIDER / SIGNATURE METHOD PENDING`
- **Phạm vi:** luồng khách hàng ký hợp đồng B2B trong ALSM. Ảnh tham khảo chỉ dùng để lấy ý tưởng về trình tự thao tác; không chọn nhà cung cấp, không sao chép thương hiệu và không xác nhận hiệu lực pháp lý của một phương thức ký.

## Hành trình người ký

1. **Mở hợp đồng đã duyệt:** người ký đăng nhập đúng tài khoản được mời, xem đúng phiên bản hợp đồng và mở PDF canonical. Hiển thị rõ bên ký, phiên bản, nội dung và thông tin cần thiết trước khi ký.
2. **Kiểm tra vùng ký:** hiển thị vị trí chữ ký của đúng bên. Không cho sửa nội dung hoặc thay PDF sau khi phiên ký bắt đầu.
3. **Chọn cách thể hiện chữ ký:** nếu phương thức/provider đã duyệt hỗ trợ, người ký có thể ký trực tiếp trong khung hoặc tải ảnh chữ ký. Ảnh chỉ là phần hiển thị; không mặc định nó tạo chữ ký số hoặc thay thế thao tác ký số của provider.
4. **Xác nhận ý định:** người ký đánh dấu rằng đã xem đúng phiên bản và đồng ý thực hiện giao dịch điện tử. Ghi nhận wording/version, account, thời điểm và hash hợp đồng.
5. **Xác thực người ký:** gửi OTP đến kênh liên hệ đã xác minh hoặc dùng phương thức xác thực do provider đã duyệt. OTP/session phải gắn với signer, hợp đồng và version; giới hạn thời hạn, số lần thử và resend; không lưu OTP dạng rõ.
6. **Xác nhận ký:** sau khi xác thực, gửi yêu cầu ký đến provider. Hiển thị trạng thái đang xử lý; không tự chuyển sang “đã ký” khi mới tick đồng ý hoặc nhập OTP.
7. **Hoàn tất và nhận bản ký:** chỉ báo hoàn tất sau khi provider xác nhận trạng thái authoritative, hệ thống nhận được PDF cuối và evidence cần thiết, kiểm tra tính toàn vẹn/chữ ký rồi lưu vào kho private. Người dùng có thể tải bản hợp đồng đã ký và biên nhận.

## State và bằng chứng

`READY_FOR_SIGNATURE → CUSTOMER_VIEWED → SIGNER_AUTHENTICATION_PENDING → SIGNER_ACTION_PENDING → PROVIDER_PROCESSING → PROVIDER_COMPLETED_EVIDENCE_PENDING → COMPLETED`.

Từ chối, OTP hết hạn, hủy, provider timeout, signer thay đổi hoặc PDF mismatch phải có trạng thái xử lý riêng. Chỉ đặt `COMPLETED` khi tất cả signer bắt buộc hoàn tất, provider xác nhận, đúng version/hash được liên kết và artifacts/evidence được kiểm tra và lưu thành công.

Lưu tối thiểu: contract/version ID, hash PDF canonical, signer/party, provider session/event reference, phiên bản nội dung xác nhận, thời điểm xác nhận, OTP challenge reference (không lưu OTP), provider status, hash artifact và manifest. PII, retention, vị trí dữ liệu và cách kiểm chứng chữ ký phải theo phê duyệt Legal/Security/Privacy.

## Cổng trước khi bật ký

- [ ] Pháp chế phê duyệt phương thức ký cụ thể cho loại hợp đồng và nội dung chấp thuận giao dịch điện tử.
- [ ] Kinh doanh xác nhận người ký, thứ tự signer, thời điểm hiệu lực và quy tắc từ chối/hủy.
- [ ] Chọn provider sau khi đánh giá tài liệu API, sandbox, loại chữ ký và evidence trả về.
- [ ] Security/Privacy duyệt xử lý OTP, số điện thoại, PII, region, subprocessor, retention và callback.
- [ ] Thử nghiệm xác nhận đúng PDF đầu vào, kiểm tra độc lập được chữ ký/evidence đầu ra, xử lý retry/replay và lưu trữ/khôi phục.
- [ ] Xác minh phone/contact nếu phương thức đã duyệt yêu cầu; hiện invitation grant vẫn `UNVERIFIED` và signing eligibility bị chặn.

Cho tới khi đạt các cổng này, giữ `signingAvailable=false`, không tạo OTP giả, không ghép ảnh chữ ký vào PDF để giả lập ký thật và không bật UC-64.
