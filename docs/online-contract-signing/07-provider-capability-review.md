# Bước 2 — Rà soát năng lực provider từ tài liệu công khai

- **Phiên bản:** 0.1 — phân tích tài liệu công khai, chưa phải lựa chọn nhà cung cấp
- **Ngày rà soát:** 03-11-2026
- **Trạng thái:** `VNPT ECONTRACT SANDBOX EVALUATION AUTHORIZED — PRODUCTION NOT SELECTED`

## Kết luận điều hành

Người dùng đã chọn VNPT eContract để đánh giá sandbox. Đây là ủy quyền chuẩn bị/tích hợp thử nghiệm, không phải lựa chọn nhà cung cấp production hoặc phê duyệt phương thức ký. Chưa có sandbox credentials; cần VNPT xác nhận hostname/version, capabilities và callback security. Chưa có phê duyệt gửi dữ liệu thật hay Legal/Security.

Người dùng đã xác nhận ảnh chỉ là **tham khảo ý tưởng trình tự giao diện**, không chọn Mắt Bão/Matbao-Sign và không yêu cầu họ cung cấp dịch vụ. Ảnh không chọn provider; VNPT được chọn sau đó riêng cho đánh giá sandbox. Mắt Bão trong bảng dưới là phương án tham khảo, không được chọn. Quyết định production vẫn mở.

Mắt Bão công khai rằng Matbao-Sign cung cấp remote signing dạng PAdES và REST API; điều khoản dịch vụ của Mắt Bão nêu giấy phép 396/GP-BTTTT cho dịch vụ ký số từ xa, thời hạn tới 27-12-2034. Báo cáo công khai của NEAC cũng liệt kê MATBAO-CA và giấy phép này. Đây là bằng chứng sơ bộ về đơn vị/dịch vụ, không thay cho xác minh tình trạng giấy phép tại ngày ký, API spec, capability của đúng gói dịch vụ hoặc phê duyệt xử lý dữ liệu.

Ảnh tham khảo gợi ý trình tự **xem hợp đồng → vùng/cách thể hiện chữ ký → xác nhận → OTP → hoàn tất**. Đây là yêu cầu trải nghiệm, không phải quyết định phương thức ký hay nhà cung cấp. Xem [09 — quy trình UX mục tiêu](09-signing-journey-ux-target.md).

Chưa có provider nào được chọn, bật hoặc phê duyệt để gửi hợp đồng thật.

## So sánh theo bằng chứng đang có

| Tiêu chí | Mắt Bão / Matbao-Sign | VNPT eContract |
|---|---|---|
| Tích hợp contract API công khai | Matbao-Sign quảng bá REST API cho tích hợp ERP/CRM; MB-eContract quảng bá tích hợp đa nền tảng. Chưa tìm thấy OpenAPI/SDK/schema contract signing công khai. | Có tài liệu developer/API công khai; tạo hợp đồng, gửi ký, cấu hình signer, upload/download và hủy. |
| Phương thức ký được mô tả | Matbao-Sign quảng bá remote digital signing/PAdES. Hướng dẫn hồ sơ trực tuyến riêng mô tả ảnh chữ ký + OTP; cần xác định hai luồng có cùng cryptographic signing output hay không. | API liệt kê SMS OTP, Email OTP, OTP + eKYC, SmartCA app/HSM, VNPT ký số và USB Token. Phải chọn đúng method và kiểm tra certificate/output. |
| Callback / trạng thái | Chưa tìm thấy tài liệu callback/webhook/API contract signing công khai. Cần schema xác thực, replay, ordering, retry và status reconciliation. | Có callback POST khi hợp đồng đổi trạng thái; cần làm rõ xác thực chữ ký, replay, ordering, retry và status reconciliation. |
| Hồ sơ sau ký | Mắt Bão công bố PAdES/audit trail ở mức sản phẩm. Cần API export, signed PDF, certificate chain/status, timestamp/audit và phương án verify độc lập. | API tải file hợp đồng và bundle được mô tả. Cần xác nhận signed PDF, certificate, audit trail, timestamp và cách kiểm tra độc lập. |
| Kết luận | Chưa chọn. Cần tài liệu API, sandbox, xác nhận PAdES/evidence và data/security review trước khi quyết định. | Được chọn để đánh giá sandbox; chưa phải lựa chọn production. Cần credentials, xác nhận API/endpoint/method, artifact/evidence và data/security review. |

Nguồn: [Matbao-Sign](https://matbao.in/kysodienthoai), [điều khoản Matbao-Sign](https://www.matbao.net/thong-tin/thoa-thuan-su-dung-dich-vu-matbao-sign), [NEAC — báo cáo tình hình phát triển 2024](https://storage-new.neac.gov.vn/Data/2025/04/24/bc-tinh-hinh-phat-trien-2024-tiengviet-giao-in-638810995679249022.pdf), [Mắt Bão — hướng dẫn hồ sơ online](https://wiki.matbao.net/huong-dan-hoan-tat-ho-so-truc-tuyen-qua-link-tai-email/), [MB-eContract](https://matbao.in/hop-dong-dien-tu), [VNPT — tích hợp eContract](https://doitac-smartca.vnpt.vn/tich-hop-econtract), [VNPT — tài liệu API](https://doitac-smartca.vnpt.vn/help/assets/files/API_VNPT_eContract_VNPT-5a9b8c1fb5c66f7ab294d8023bd2babf.pdf).

## Quy trình trải nghiệm đích

Các bước UI độc lập nhà cung cấp được ghi nhận ở [09 — quy trình UX mục tiêu](09-signing-journey-ux-target.md). Không suy ra provider hoặc phương thức ký từ ảnh tham khảo.

## Findings quan trọng về VNPT API

1. Tài liệu VNPT phân biệt nhiều loại ký: SMS/Email OTP, OTP kèm eKYC, SmartCA và VNPT ký số. Không được gom thành một capability “ký điện tử” duy nhất. Đặc biệt, API OTP có tham số ký hiển thị/chữ ký dạng ảnh; nếu mục tiêu là chữ ký số/chữ ký tương đương chữ ký tay theo yêu cầu Legal, cần xác nhận dùng SmartCA/chữ ký số và kiểm chứng chứng thư/chữ ký trên PDF cuối.
2. Tài liệu nêu API tạo hợp đồng, upload/tài liệu đính kèm, cấu hình danh sách signer, thứ tự/tuần tự, API gửi ký và API hủy hợp đồng. Cần kiểm tra giới hạn API, idempotency, race giữa hủy và ký, cũng như việc provider có thể nhận đúng bytes PDF canonical đã hash hay không.
3. Tài liệu nêu API tải file và bundle hợp đồng. Chưa đủ bằng chứng từ tài liệu công khai để xác nhận artifact cuối luôn gồm certificate chain, audit trail đầy đủ, dấu thời gian tin cậy và cách xác minh chữ ký bằng công cụ độc lập.
4. Callback trạng thái sử dụng `X-APP-CB-KEY` và `X-APP-CB-SECRET`; payload nêu `hopDongId`, `trangThai`, danh sách signer và thời gian xử lý. Phần callback chưa mô tả chữ ký HMAC trên raw body, timestamp/nonce, delivery retry hoặc thứ tự sự kiện. Tài liệu có API riêng `GET /hopdong/chitiet/{idHopDong}` để lấy chi tiết hợp đồng; cần VNPT xác nhận API đó trả status/signer state authoritative cho reconciliation. Phải coi callback chỉ là trigger cho tới khi auth/replay và reconciliation được xác nhận/test.
5. Tài liệu developer hiện công khai hướng dẫn API V2.0.0, còn client trong code đang chọn host `gateway-bus-econtract-v2-poc.vnpt.vn` cho sandbox và có API upload/download riêng. Cần xác nhận hostname/môi trường và version nào được hỗ trợ chính thức; không coi endpoint trong code hiện tại là đã tương thích spec mới.
6. Tài liệu tài khoản tích hợp yêu cầu đăng ký nhà phát triển/tích hợp và cấp client credentials test theo quy trình. Không lấy credential từ ví dụ trong PDF hoặc dùng account dữ liệu mẫu trong tài liệu.

## Câu hỏi cần VNPT trả lời trước khi triển khai adapter

### Pháp lý và loại chữ ký

- Với đúng gói dịch vụ và phương thức ký đề xuất, pháp nhân nào phát hành/chứng thực chữ ký số; có tên trong danh sách/chứng nhận hiện hành nào của cơ quan có thẩm quyền?
- OTP, OTP+eKYC, SmartCA app và ký số HSM tạo ra loại chữ ký nào trên tài liệu? PDF đầu ra có chữ ký số nhúng được kiểm chứng độc lập không? Xin cung cấp mẫu file đã ký và hướng dẫn kiểm chứng.
- Có certificate chain, trạng thái chứng thư tại thời điểm ký, timestamp, signer identity/eKYC result và audit evidence nào được trả về? Artifact nào được đảm bảo có trong gói dịch vụ?
- Có thể cấu hình signer ALSM ký số trước, khách ký sau, đúng pháp nhân và đúng người đại diện/ủy quyền không?

### API và an toàn callback

- Gửi bộ OpenAPI/Postman chính thức, changelog hiện hành, hostname sandbox/production, rate limits, timeout, idempotency, error codes và quy tắc retry.
- `APP_CB_KEY`/`APP_CB_SECRET` được xác thực thế nào? Có HMAC/chữ ký theo raw body, timestamp, nonce hoặc event ID chống replay không? Nếu không, provider hỗ trợ IP allowlist, xác nhận delivery, event query và cơ chế rotate secret ra sao?
- Event có đảm bảo duy nhất và đúng thứ tự không? Cách lấy trạng thái authoritative khi callback mất/trùng/đến sai thứ tự là API nào?
- Hủy có hiệu lực tức thời không? Race giữa khách ký và hủy trả trạng thái nào? Có thể thay signer/revoke pending signer không?
- API tải file trả signed PDF hay file trung gian? Cách lấy bộ hồ sơ đầy đủ sau khi tất cả bên ký hoàn tất là gì?

### Dữ liệu, lưu trữ và thương mại

- Data center/region, subprocessors, encryption, backup, retention và quy trình export/delete sau chấm dứt dịch vụ?
- VNPT là controller/processor theo vai trò nào; có DPA, SLA, breach notice, support escalation và phương án lấy lại hợp đồng/evidence độc lập không?
- Dữ liệu eKYC/CCCD/selfie nào được thu thập; mục đích, căn cứ xử lý, thời hạn lưu và cơ chế xóa?
- Chi phí API, OTP/eKYC/SmartCA, lưu trữ, hạn mức, phí phát sinh, SLA và hỗ trợ production?

Mapping từng operation với `ContractSigningProviderPort`, gồm gaps về signer sessions, callback event IDs và hash canonical, nằm tại [08 — Provider port mapping](08-provider-port-mapping.md).

## Các điều chỉnh kỹ thuật cần làm nếu provider được duyệt

- Không nối `VnptEContractClient` hiện tại trực tiếp vào domain service. Tạo adapter implement `ContractSigningProviderPort`, map API/status một cách tường minh và fail-closed khi thiếu capability.
- Chốt API upload cho đúng canonical PDF; sau upload, đọc lại/so sánh metadata hoặc file bytes theo khả năng provider trước khi gửi ký.
- Xử lý webhook như tín hiệu chưa tin cậy: kiểm tra secret constant-time, schema và contract mapping; chống replay/idempotency; sau đó query trạng thái provider và xác minh artifact/chữ ký trước khi ghi completion.
- Ghi provider envelope reference, file detail IDs, signer IDs, version ID, hash canonical và các mốc trạng thái trong DB; không ghi token, OTP, callback secret, PII thừa hoặc URL download có chữ ký vào log.
- Chỉ `finalizeVerifiedProviderCompletion` sau khi file đã tải, kiểm tra chữ ký/evidence và lưu thành công; callback không gọi UC-64 trực tiếp.
- Tách sandbox/production credentials, endpoints, callback URLs và file namespace; chặn mọi sandbox event khỏi UC-64 production.

## Cổng quyết định

- [ ] Mắt Bão xác nhận Matbao-Sign là sản phẩm/API dùng cho luồng ký hợp đồng này và cấp OpenAPI/SDK, sandbox cùng tài liệu cấu hình an toàn.
- [ ] Pháp chế duyệt phương thức ký cụ thể (không chỉ duyệt tên sản phẩm).
- [ ] Bảo mật/Privacy duyệt dữ liệu gửi, vùng xử lý, callback model và DPA trước khi có dữ liệu thật.
- [ ] Mắt Bão cấp sandbox credentials và artifact mẫu qua kênh bảo mật.
- [ ] Kỹ thuật xác nhận PAdES/certificate validation, signer order, OTP/session, callback authentication và reconciliation qua sandbox.
- [ ] Nếu Matbao-Sign không hỗ trợ các capability/evidence cần thiết, Kinh doanh quyết định provider thay thế; VNPT là ứng viên đối chiếu.

Khi các ô trên còn mở, D-01 vẫn `OPEN`; không bật ký thật và không kích hoạt UC-64 từ provider sandbox.
