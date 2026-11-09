# Bước 1 — Phiếu chốt chính sách ký hợp đồng online

- **Phiên bản:** 0.1 — bản dự thảo để Pháp chế, Kinh doanh, Tài chính và Bảo mật phê duyệt
- **Ngày rà soát pháp lý:** 03-11-2026
- **Trạng thái:** `DRAFT — CHƯA ĐƯỢC PHÊ DUYỆT`
- **Phạm vi đang giả định:** hợp đồng dịch vụ ALSM ký giữa pháp nhân ALSM và khách hàng doanh nghiệp tại Việt Nam. Pháp chế phải xác nhận phạm vi này trước khi áp dụng.

## Vì sao cần chốt trước khi bật ký

Luật Giao dịch điện tử điều chỉnh cách thực hiện giao dịch điện tử, nhưng không thay thế quy định về nội dung, điều kiện và hình thức của từng loại giao dịch. Luật hiện hành công nhận thông điệp dữ liệu và hợp đồng điện tử; riêng chữ ký điện tử chuyên dùng bảo đảm an toàn hoặc chữ ký số được quy định có giá trị tương đương chữ ký cá nhân trên văn bản giấy. Do đó, không được mặc định rằng OTP, đăng nhập tài khoản hoặc ảnh chữ ký tự tạo tự nó đáp ứng mục tiêu ký đã chọn. Pháp chế cần duyệt mô hình chữ ký cụ thể của provider và hợp đồng mẫu.

Luật và văn bản cần Pháp chế rà soát trước khi ký production:

- [Luật Giao dịch điện tử hợp nhất 154/2026/VBHN-LQ-VPQH (28-09-2026)](https://congbao.chinhphu.vn/van-ban/van-ban-hop-nhat-so-154-2026-vbhn-lq-vpqh-470651.htm); khi tra cứu bản hợp nhất cần phân biệt nội dung sửa đổi của Luật 20/2026/QH16 có hiệu lực từ 01-03-2027 với quy định đang có hiệu lực tại ngày triển khai. Chú ý Điều 9–13, Điều 22–23 và Điều 34–38.
- [Luật 20/2026/QH16](https://vanban.chinhphu.vn/?classid=1&docid=219488&pageid=27160&typegroupid=3) sửa một số nội dung của Luật Giao dịch điện tử, có hiệu lực 01-03-2027; Pháp chế cần rà lại khi ký sau ngày này.
- [Nghị định 23/2025/NĐ-CP về chữ ký điện tử và dịch vụ tin cậy](https://vanban.chinhphu.vn/?classid=1&docid=212829&pageid=27160), hiệu lực 10-04-2025.
- [Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15](https://vanban.chinhphu.vn/?classid=1&docid=214590&pageid=27160) và [Nghị định 356/2025/NĐ-CP](https://vanban.chinhphu.vn/?classid=1&docid=216387&pageid=27160), hiệu lực 01-01-2026.
- Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân đã hết hiệu lực từ 01-01-2026 theo Nghị định 356/2025/NĐ-CP; không dùng Nghị định 13 như căn cứ hiện hành, trừ nội dung chuyển tiếp được Pháp chế xác nhận.
- Nếu phạm vi bán hàng bao gồm người tiêu dùng hoặc hoạt động thuộc thương mại điện tử, xác định thêm phạm vi áp dụng của [Nghị định 52/2013/NĐ-CP](https://vanban.chinhphu.vn/?classid=1&docid=167457&pageid=27160) và [Nghị định 85/2021/NĐ-CP](https://vanban.chinhphu.vn/default.aspx?docid=204191&pageid=27160).

Đây là phiếu ra quyết định sản phẩm/kỹ thuật, không phải kết luận pháp lý. Pháp chế cần xác nhận văn bản áp dụng và mẫu hợp đồng thực tế.

## Các quyết định cần phê duyệt

Kết quả rà soát tài liệu công khai provider được ghi ở [07 — Provider capability review](07-provider-capability-review.md). Ảnh người dùng cung cấp chỉ là tham khảo ý tưởng giao diện; không lựa chọn nhà cung cấp nào. Provider phải được chọn riêng sau khi so sánh API, sandbox, phương thức ký, evidence, data region và điều khoản xử lý dữ liệu.

| ID | Câu hỏi cần chốt | Đề xuất mặc định để review | Người phê duyệt | Nếu chưa chốt |
|---|---|---|---|---|
| P-01 | Loại giao dịch và phạm vi khách hàng đầu tiên là gì? | Bắt đầu với hợp đồng dịch vụ B2B giữa pháp nhân tại Việt Nam; loại trừ hợp đồng thuộc lĩnh vực có yêu cầu hình thức riêng cho đến khi Pháp chế duyệt. | Pháp chế + Kinh doanh | Chưa thể xác nhận template, provider hay phạm vi pilot. |
| P-02 | Cần loại chữ ký/mức chứng cứ nào cho mỗi bên? | Ưu tiên provider cho phép tạo chữ ký số có thể kiểm tra độc lập nếu mục tiêu là tương đương chữ ký cá nhân trên giấy. Nếu chọn phương thức OTP/e-signature khác, Pháp chế phải duyệt rõ căn cứ, hiệu lực cho loại hợp đồng này và bộ hồ sơ chứng minh. | Pháp chế + Kinh doanh | Không được gọi flow là “chữ ký số”, “đã ký hợp lệ” hoặc bật production. |
| P-03 | Ai có thẩm quyền ký cho ALSM và khách hàng? | Cấu hình danh sách người ký/ủy quyền có thể kiểm tra; lưu căn cứ và thời hạn ủy quyền cần thiết. Tách người soạn, người duyệt và người ký theo chính sách nội bộ. | Pháp chế + chủ thể đại diện ALSM + Kinh doanh | Không phát hành phiên ký cho đến khi xác định được signer manifest hợp lệ. |
| P-04 | Danh tính khách hàng được xác minh ra sao? | Invitation ràng buộc đúng Lead/contact và account; provider thực hiện phương thức xác thực signer được duyệt. Email xác minh và OTP chỉ là yếu tố xác thực theo vai trò đã định, không tự chứng minh thẩm quyền đại diện. | Pháp chế + Bảo mật + Kinh doanh | Hiện grant trong code ghi `phoneVerificationStatus: UNVERIFIED`; signing vẫn phải bị chặn. |
| P-05 | Nhà cung cấp và vùng xử lý dữ liệu nào được chấp nhận? | Chỉ chọn sau khi nhận tài liệu API/sandbox, bằng chứng về mô hình chữ ký, danh sách artifact, xác minh callback, data processing terms, subprocessor, vùng dữ liệu và phương án rời provider. | Kinh doanh + Pháp chế + Bảo mật + Kỹ thuật | Không triển khai adapter production hoặc gửi dữ liệu thật. |
| P-06 | Bên nào ký trước; bao nhiêu signer; khi nào hoàn tất? | Một signer có thẩm quyền mỗi bên, ký tuần tự ALSM trước rồi khách, tất cả signer bắt buộc hoàn tất. Đây chỉ là phương án thiết kế chờ phê duyệt; đổi theo chính sách Legal/Business/provider. | Pháp chế + Kinh doanh | Không đóng state machine hay điều kiện `COMPLETED`. |
| P-07 | Khi nào hợp đồng có hiệu lực và dịch vụ được provision? | Lưu tách `providerCompletedAt` và `effectiveDate`; Pháp chế/Kinh doanh chốt thời điểm hiệu lực theo điều khoản hợp đồng. Tài chính chốt payment/credit/waiver gate trước UC-64. | Pháp chế + Kinh doanh + Tài chính | Không bật UC-64 production. |
| P-08 | Lưu hồ sơ gì, bao lâu và ở đâu? | Lưu PDF đã ký, artifact/chứng thư/audit mà Legal yêu cầu, sự kiện provider đã xác thực, phiên bản PDF đầu vào, hash, mốc thời gian, nguồn tạo và manifest. Dùng kho private mã hóa, backup/restore và retention được duyệt. | Pháp chế + Bảo mật + Kinh doanh | Không đặt `COMPLETED`/`ELIGIBLE` nếu chưa lưu và kiểm tra đủ chứng cứ. |
| P-09 | Dữ liệu cá nhân nào được gửi cho provider và xử lý theo điều kiện nào? | Lập data map; giảm thiểu dữ liệu; xác định vai trò kiểm soát/xử lý, thông báo/mục đích, nhà thầu phụ, chuyển dữ liệu, quyền chủ thể, sự cố và xóa/retention theo đánh giá pháp lý. | Bảo vệ dữ liệu/Privacy + Pháp chế + Bảo mật | Không dùng dữ liệu thật trên sandbox hoặc production cho đến khi phê duyệt. |
| P-10 | Quy tắc hủy, hết hạn, thay signer, sửa nội dung và tranh chấp là gì? | Giữ version cũ bất biến; sửa tạo version mới và hủy/đóng phiên cũ; mọi thao tác có audit, lý do, actor và thời gian. Chốt SLA đối soát/phục hồi khi provider đã ký nhưng tải hồ sơ lỗi. | Pháp chế + Kinh doanh + Kỹ thuật | Không phát hành production flow thiếu khả năng revoke/reconcile. |
| P-11 | Sandbox/demo được tách production thế nào? | Tách credentials, endpoint/callback, dữ liệu, file namespace và nhãn UI; sandbox event không thể gọi UC-64 production; không mô phỏng thành chữ ký thật. | Bảo mật + Kỹ thuật + Kinh doanh | Giữ provider `DISABLED` và các cổng activation fail-closed. |

Quy trình UI theo ý tưởng ảnh (xem hợp đồng → vùng/cách thể hiện chữ ký → xác nhận → xác thực người ký → hoàn tất) được đặc tả tại [09 — quy trình UX mục tiêu](09-signing-journey-ux-target.md). Yêu cầu trải nghiệm này không tự quyết định P-02/P-04/P-05/P-08/P-09 và không phải Legal/Security sign-off.

## Đề xuất về mức chữ ký

Chọn một trong hai nhánh sau bằng quyết định có chữ ký/ghi nhận của Pháp chế:

1. **Nhánh ưu tiên nếu cần tương đương chữ ký tay:** provider hỗ trợ chữ ký số theo mô hình đáp ứng quy định Việt Nam; ALSM kiểm tra được chứng thư/trạng thái và tính toàn vẹn của đúng tài liệu đã ký. Xác minh danh mục dịch vụ/chủ thể cung cấp, tiêu chuẩn kỹ thuật, việc công nhận nếu có yếu tố nước ngoài và khả năng kiểm tra độc lập.
2. **Nhánh e-signature/OTP theo mô hình provider:** chỉ triển khai nếu Pháp chế duyệt cụ thể cách provider gắn chấp thuận với thông điệp dữ liệu, xác minh danh tính/ý chí người ký, bằng chứng audit và mức rủi ro chấp nhận được cho loại hợp đồng ALSM. UI và tài liệu không được mô tả đây là chữ ký số hoặc mức bảo đảm pháp lý cao hơn bằng chứng thực tế.

Trong cả hai nhánh, OTP là một cơ chế xác thực/yếu tố quy trình; hệ thống phải lưu được mối liên hệ giữa signer, hành động chấp thuận, bản hợp đồng/version chính xác và kết quả xác minh của provider.

## Bằng chứng trạng thái trong repository

- Đã có aggregate/version, template approval, invitation, customer review APIs và khung lưu final evidence; xem [README thiết kế](README.md) và [03 trình tự triển khai](03-implementation-sequence.md).
- Ký hiện bị fail-closed: `CONTRACT_SIGNING_PROVIDER` đang dùng `UnconfiguredContractSigningProviderAdapter` trong `src/app.module.ts`; readiness trong `src/modules/crm/application/contract-aggregate.service.ts` đánh dấu danh tính, orchestration và final archive là blocked.
- Invitation/account flow hiện chưa xác minh phone; grant được tạo với `UNVERIFIED` và `BLOCKED_PHONE_UNVERIFIED` trong `src/modules/crm/domain/contract-invitation.types.ts`.
- `VnptEContractClient` tồn tại nhưng hiện chỉ là client HTTP mức thấp; sự tồn tại của class này không có nghĩa VNPT đã được chọn hay đã tích hợp ký.
- FE1 có thay đổi chưa commit trong workspace tại thời điểm lập phiếu; không nên ghi đè các thay đổi đó khi triển khai tiếp.

## Tiêu chí hoàn thành Bước 1

Bước này chỉ đóng khi mỗi mục P-01–P-11 có người phê duyệt, lựa chọn, lý do, ngày và tham chiếu bằng chứng; các quyết định provider, dữ liệu và pháp lý có sign-off tương ứng. Cho đến khi đó, các bước kỹ thuật chỉ được tiếp tục ở nhánh thiết kế/sandbox không có dữ liệu thật; không mở ký production hoặc UC-64 production.

| Vai trò | Người chịu trách nhiệm | Trạng thái | Ngày/biên bản |
|---|---|---|---|
| Pháp chế | Chưa chỉ định | `PENDING` | — |
| Kinh doanh/chủ sản phẩm | Chưa chỉ định | `PENDING` | — |
| Tài chính | Chưa chỉ định | `PENDING` | — |
| Bảo mật/Privacy | Chưa chỉ định | `PENDING` | — |
| Kỹ thuật | ALSM Engineering | `DRAFTED` | 03-11-2026 |
