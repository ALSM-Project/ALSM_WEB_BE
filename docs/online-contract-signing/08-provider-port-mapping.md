# Bước 2.1 — Mapping provider port với VNPT eContract API

- **Trạng thái:** `VNPT SANDBOX EVALUATION AUTHORIZED — CREDENTIALS / METHOD / SECURITY PENDING`
- **Ngày:** 03-11-2026
- **Mục đích:** xác định chính xác adapter còn thiếu gì trước khi sửa code; không tạo request giả và không bật provider.

## Kết luận

VNPT API có endpoint tương ứng với phần lớn vòng đời envelope, nhưng `VnptEContractClient` hiện mới làm login, upload file và download file/bundle. Client chưa tạo contract, cấu hình signer, gửi ký, hủy, đối soát, map callback hay verify artifact. Ứng dụng vẫn bind `UnconfiguredContractSigningProviderAdapter` nên ký hiện bị khóa.

Không nên viết adapter để quảng bá readiness trước khi sandbox xác nhận ba điểm: **mode chữ ký được duyệt**, **callback/status reconciliation đáp ứng security policy**, và **artifact cuối kiểm chứng được**. Bản mapping dưới đây là nền để implement ngay sau các sign-off/credentials; phục vụ đánh giá sandbox VNPT đã được người dùng xác nhận; không phải quyết định production.

## Mapping API với `ContractSigningProviderPort`

| Port ALSM | Khả năng/endpoint VNPT trong tài liệu | Code hiện có | Việc còn thiếu / điều kiện qua |
|---|---|---|---|
| `createEnvelope(input)` | Login → upload file (`POST /hopdong/upload-multi-files`) → tạo contract (`POST /hopdong`) → tạo/cập nhật signer + vị trí ký → gửi hợp đồng (`POST /hopdong/gui-hop-dong`). | Login, upload PDF. | Typed response; contract ID + file detail IDs; tạo contract và signer; preserve idempotency mapping ALSM request↔VNPT ID; cấu hình signer method/order; gửi ký; xử lý timeout/replay an toàn. Chốt hostname/version qua VNPT. |
| `SigningProviderEnvelopeResult` | Tạo contract trả `HOPDONG_ID` và `CHITIET`; callback có trạng thái signer, trong ví dụ có `maTruycap`. | Chưa map response. | Chốt `providerEnvelopeReference` (dùng contract ID), signer references/session behavior và expiry. Không đưa URL/mã signer nhạy cảm vào log. |
| `verifyWebhook(input)` | Callback POST cấu hình trước, header `X-APP-CB-KEY`, `X-APP-CB-SECRET`; body gồm `hopDongId`, `trangThai`, signer list. | Chưa có route/handler. | Raw-body route; constant-time secret compare nếu Security chấp nhận; rate limit/size limits; idempotency; xác nhận chính sách signature/timestamp/replay với VNPT. Callback chỉ kích hoạt query trạng thái authoritative trước khi tiến state. |
| `getEnvelopeStatus(ref)` | `GET /hopdong/chitiet/{idHopDong}` mô tả xem chi tiết hợp đồng. | Chưa có method. | Map status code và từng signer state theo bảng do VNPT cấp; lưu mapping/versioned enum; unknown status phải fail closed; reconciliation worker có retry/backoff. |
| `downloadArtifacts(ref)` | `GET /hopdong/{hopDongId}/tai-file/{hopDongChiTietId}` và bundle ZIP `GET /hopdong/tai-bo-hopdong?hopDongId=...`. | Download contract file/bundle theo ID. | Parse bundle/file manifest an toàn; xác định signed PDF và evidence loại nào; malware/size/content checks; independent PDF signature/certificate validation; archive trước khi completion. |
| `cancelEnvelope(ref, reason)` | `PUT /hopdong/huy-hop-dong` nhận `hopDongId`. | Chưa có method. | Xác nhận quyền/hạn hủy, kết quả đồng thời khi signer đã ký, phản hồi idempotent và status cuối. Lưu reason/audit và reconciliation. |
| `SigningProviderCapabilities` | Docs nêu signer sequence, OTP, SmartCA và hủy; callback và query API hiện thấy. | DI vẫn unconfigured; readiness false. | Capability chỉ true khi API thực tế, callback verification, signer method và artifact validation đều qua sandbox/security review. |

Nguồn API: [VNPT integration guide PDF](https://doitac-smartca.vnpt.vn/help/assets/files/API_VNPT_eContract_VNPT-5a9b8c1fb5c66f7ab294d8023bd2babf.pdf), các mục upload files, chi tiết hợp đồng, tải file, gửi hợp đồng, callback, hủy và cấu hình người ký.

## Khoảng cách trong model hiện tại

1. `StartSigningEnvelopeInput` chưa có trường `signatureMethod`/`authenticationMethod`; VNPT yêu cầu chọn một hoặc nhiều `p_ht_ky` (SMS OTP, Email OTP, SmartCA, VNPT ký số, USB Token, OTP+eKYC). Không thêm/đặt default trước khi Legal và Security chọn method.
2. `createEnvelope` đang gộp upload, tạo hợp đồng, signer configuration và send thành một thao tác. VNPT API có nhiều bước có thể lỗi giữa chừng; cần persistence của staged provider IDs và saga/retry/reconcile thay vì gửi lại tạo hợp đồng mù.
3. `SigningProviderEnvelopeResult.signerSessions` giả định provider có URL phiên ký trả về. VNPT API đang rà soát không chứng minh rõ API create trả URL hợp lệ để nhúng vào FE1, đặc biệt nếu khách phải đăng nhập ALSM trước. Phải chốt OTP signing chạy qua server hay redirect/widget/portal và có cách bind đúng ALSM account.
4. `VerifiedSigningProviderEvent` yêu cầu event reference và timestamp. Callback schema công khai chưa cho thấy ID sự kiện riêng hoặc timestamp tổng thể; hiện có timestamp từng signer. Cần VNPT xác nhận event identifier/schema hoặc dựa callback làm wake-up rồi query contract detail, tạo reconciliation event idempotent theo trạng thái authoritative.
5. `SigningProviderArtifact` chỉ hỗ trợ PDF, JSON, text. Nếu provider trả ZIP bundle, certificate/OCSP/timestamp hoặc nhiều tài liệu, adapter phải kiểm tra loại file/manifest và map artifact được Legal yêu cầu trước khi gọi `finalizeVerifiedProviderCompletion`.
6. `canonicalPdfSha256` gửi vào port không xuất hiện rõ trong API create contract fields đang đọc. Phải xác định provider có giữ đúng bytes/hash; nếu không, tải lại tài liệu unsigned từ VNPT trước khi gửi hoặc dùng phương thức upload khác và so sánh nội dung trước khi ký.

## Trình tự implement sau khi qua cổng

1. Thêm DTO/config validation theo API version/host được VNPT cấp chính thức; provider vẫn `DISABLED` nếu thiếu đủ credentials/callback secrets.
2. Mở rộng port theo method chữ ký đã phê duyệt; định nghĩa provider stage record/outbox cho upload → create → configure signer → send.
3. Thêm typed VNPT API methods và error/status mapping; persist provider contract/file/signer IDs atomically hoặc qua idempotent saga.
4. Thêm callback route riêng với raw body, auth, replay/idempotency, minimal logging và query reconciliation.
5. Thêm final artifact downloader/validator/archive worker; chỉ worker gọi `finalizeVerifiedProviderCompletion` sau khi signed PDF/evidence đã được xác minh và lưu.
6. Chỉ công bố readiness `READY` trong sandbox khi từng capability được chứng minh; production thêm feature gate riêng sau Legal/Security/UAT sign-off.

## Điều kiện trước khi bắt đầu code adapter

- [ ] Người có thẩm quyền chấp thuận VNPT vào sandbox; D-01 chưa được coi là provider đã chọn.
- [ ] Pháp chế phê duyệt method chữ ký cụ thể và artifact cần lưu.
- [ ] VNPT xác nhận API version, environment host, auth fields, callback replay controls, signer session/OTP model, status mapping và final bundle.
- [ ] Sandbox credentials được cấp qua kênh bí mật; không copy ví dụ credentials trong spec.
- [ ] Security/Privacy duyệt PII test scope, callback design và processor terms.

Cho tới khi đạt các điều kiện trên, tiếp tục giữ provider `Unconfigured` và `signingAvailable=false`.
