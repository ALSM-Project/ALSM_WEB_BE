# [UC-43] Create Online Meeting Room — Báo cáo triển khai & Hướng dẫn kiểm thử

Tài liệu này tổng hợp toàn bộ các thành phần đã hoàn thiện cho tính năng **UC-43: Create Online Meeting Room** trên cả hai phân hệ **Backend (`ALSM_WEB_BE`)** và **Frontend Enterprise (`ALSM_WEB_FE_2`)**, cùng hướng dẫn chi tiết cách chạy kiểm thử tự động và kiểm thử thủ công (manual test).

---

## 1. Tổng quan các thành phần đã triển khai

### 🔹 A. Backend (`ALSM_WEB_BE`)

| Thành phần | Đường dẫn file | Mô tả chi tiết |
| :--- | :--- | :--- |
| **Domain Interface** | `src/modules/meetings/domain/meeting.types.ts` | Bổ sung phương thức `findDuplicate(hostUserId, title, scheduledStartTime)` vào `MeetingRepository`. |
| **Repository Implementation** | `src/modules/meetings/infrastructure/mongo-meeting.repository.ts` | Truy vấn MongoDB tìm cuộc họp trùng tiêu đề, cùng host và thời gian bắt đầu (sai số cho phép $\pm 60$ giây). |
| **Application Service** | `src/modules/meetings/application/create-meeting.service.ts` | Xử lý toàn diện luồng nghiệp vụ tạo cuộc họp với quy tắc **bắt buộc đầy đủ tất cả các trường dữ liệu, không được thiếu bất kỳ phần nào**:<br>• **Tiêu đề (Title):** Bắt buộc, tối thiểu 3 ký tự (`MEETING_TITLE_REQUIRED`).<br>• **Mô tả/Chương trình họp (Description/Agenda):** Bắt buộc, tối thiểu 5 ký tự (`MEETING_DESCRIPTION_REQUIRED`).<br>• **Mã dự án (Project ID):** Bắt buộc, kiểm tra tồn tại trong DB qua `ProjectRepository` (`PROJECT_ID_REQUIRED`, `PROJECT_NOT_FOUND`).<br>• **Người tham dự (Attendees):** Bắt buộc có ít nhất 1 email người tham dự (`ATTENDEES_REQUIRED`) và đúng định dạng (`INVALID_ATTENDEE_EMAIL`).<br>• **Thời gian (Schedule):** Bắt buộc, thời gian bắt đầu không được ở quá khứ (`START_TIME_IN_PAST`), thời gian kết thúc phải sau bắt đầu (`INVALID_TIME_RANGE`).<br>• **Chống trùng lịch:** Ngăn chặn tạo cuộc họp trùng lặp cùng host, tiêu đề và giờ bắt đầu (`DUPLICATE_MEETING`).<br>• **Google Meet URL:** Tự sinh link chuẩn 3-4-3 hoặc kiểm tra link hợp lệ (`INVALID_MEET_URL`).<br>• **Audit Log:** Tự động ghi nhật ký hệ thống qua `AuditRepository` (`MEETING_ROOM_CREATED`). |
| **Dependency Injection** | `src/app.module.ts` | Cung cấp và liên kết các Repository (`PROJECT_REPOSITORY`, `MEETING_REPOSITORY`, `AUDIT_REPOSITORY`) vào `CreateMeetingService`. |
| **Unit Tests** | `test/meeting.service.spec.ts` | **19 ca kiểm thử tự động** bao phủ tất cả các trường hợp lỗi validation bắt buộc cho từng trường, thành công, ghi log và phân trang. |

---

### 🔹 B. Frontend Enterprise (`ALSM_WEB_FE_2`)

| Thành phần | Đường dẫn file | Mô tả chi tiết |
| :--- | :--- | :--- |
| **API Client** | `src/features/meetings/api/meetings.api.ts` | Gọi API `POST /meetings` (tạo phòng) và `GET /meetings` (lấy danh sách có phân trang và lọc theo trạng thái). |
| **React Query Hooks** | `src/features/meetings/hooks/useMeetings.ts` | Custom hooks `useMeetingsList` và `useCreateMeeting` hỗ trợ caching và tự động invalidate cache sau khi tạo mới. |
| **MeetingCard Component** | `src/features/meetings/components/MeetingCard.tsx` | Thẻ hiển thị cuộc họp trực quan với badge trạng thái, mã phòng họp, định dạng ngày giờ thân thiện, host/người tham dự, nút Sao chép link và nút Tham gia họp ngay. |
| **MeetingsListPage** | `src/features/meetings/pages/MeetingsListPage.tsx` | Trang danh sách cuộc họp:<br>• 3 thẻ KPI tổng quan (Tổng số cuộc họp, Đang diễn ra, Đã lên lịch).<br>• Tabs lọc trạng thái (`All`, `Scheduled`, `In Progress`, `Completed`, `Cancelled`).<br>• Trạng thái Skeleton loading, Empty state và Error state có nút Thử lại (Retry).<br>• Nút "+ Create Meeting Room" trên Header. |
| **CreateMeetingRoomPage** | `src/features/meetings/pages/CreateMeetingRoomPage.tsx` | Form tạo phòng họp thiết kế **2 cột toàn màn hình (`max-w-7xl`)** kiểm soát chặt chẽ toàn bộ các trường bắt buộc:<br>• **Bắt buộc đầy đủ mọi trường:** Tiêu đề *, Mô tả/Agenda *, Mã dự án *, Ít nhất 1 người tham dự *, Thời gian bắt đầu/kết thúc *.<br>• **Inline Error Display:** Hiển thị trực tiếp thông báo lỗi màu đỏ ngay dưới từng trường bị thiếu khi bấm Create Room.<br>• **Cột phải:** Thẻ **Live Preview** cập nhật lời mời họp thời gian thực, quản lý danh sách email người tham dự dạng chip tag.<br>• **Màn hình thành công:** Hiển thị link Meet, nút Copy Link và nút Join Now. |
| **Routing & Menu** | `src/app/router.tsx`<br>`src/components/Sidebar/Sidebar.tsx` | Cập nhật menu **Online Meeting** trên Sidebar trỏ về `/enterprise/meetings`. Hỗ trợ các route `/enterprise/meetings`, `/enterprise/meetings/create`, `/meetings`. |
| **Test Setup & Vitest** | `src/test/setup.ts`<br>`vite.config.ts`<br>`tsconfig.app.json` | Cấu hình Vitest với môi trường `jsdom`, hỗ trợ đầy đủ `@testing-library/jest-dom`. |
| **Frontend Tests** | `src/features/meetings/api/meetings.api.test.ts`<br>`src/features/meetings/pages/CreateMeetingRoomPage.test.tsx`<br>`src/features/meetings/pages/MeetingsListPage.test.tsx` | **16 ca kiểm thử tự động** bao phủ API client, render component, chặn tạo phòng khi thiếu bất kỳ trường nào, filter tab, clipboard copy và điều hướng. |

---

## 2. Hướng dẫn chạy kiểm thử tự động (Automated Testing)

### 1. Kiểm thử Backend (`ALSM_WEB_BE`)

Mở terminal tại thư mục backend và chạy:

```bash
cd d:\ALSM\ALSM_WEB_BE
npx jest test/meeting.service.spec.ts
```

> **Kết quả kỳ vọng:** Đạt `16 passed, 16 total` (100%).

---

### 2. Kiểm thử Frontend (`ALSM_WEB_FE_2`)

Mở terminal tại thư mục frontend Enterprise và chạy:

```bash
cd d:\ALSM\ALSM_WEB_FE_2
npx vitest run src/features/meetings
```

> **Kết quả kỳ vọng:** Đạt `15 passed, 15 total` qua 3 file test:
> - `meetings.api.test.ts` (2 tests)
> - `MeetingsListPage.test.tsx` (7 tests)
> - `CreateMeetingRoomPage.test.tsx` (6 tests)

---

### 3. Kiểm thử TypeCheck & Build Frontend

```bash
cd d:\ALSM\ALSM_WEB_FE_2
npm run build
```

> **Kết quả kỳ vọng:** Biên dịch TypeScript và đóng gói Vite thành công (`built in ~2.5s`, không có lỗi TS).

---

## 3. Hướng dẫn kiểm thử thủ công qua giao diện (Manual Testing)

Đảm bảo cả 2 dịch vụ đang chạy:
- **Backend:** `http://localhost:3000` (hoặc cổng cấu hình của BE)
- **Frontend Enterprise:** `http://localhost:3002`

### Kịch bản 1: Truy cập trang Danh sách phòng họp
1. Mở trình duyệt truy cập: `http://localhost:3002/enterprise/meetings`.
2. Kiểm tra menu bên trái: Mục **Online Meeting** được active và có biểu tượng camera màu xanh.
3. Kiểm tra các thành phần trên trang:
   - Tiêu đề **Online Meeting Rooms**.
   - 3 thẻ chỉ số KPI: Total Meetings, Scheduled, In Progress.
   - Các tab lọc trạng thái: *All Meetings*, *Scheduled*, *In Progress*, *Completed*, *Cancelled*.
   - Nút **Refresh** và nút **+ Create Meeting Room**.

---

### Kịch bản 2: Kiểm tra Form và Validation tạo phòng họp
1. Nhấp nút **Create Meeting Room** trên header (hoặc truy cập `http://localhost:3002/enterprise/meetings/create`).
2. Quan sát giao diện:
   - Form hiển thị rộng toàn màn hình (`max-w-7xl`), chia 2 cột chuyên nghiệp, không còn khoảng trắng lãng phí ở hai bên.
   - Cột phải có thẻ **Live Preview** cập nhật theo dữ liệu nhập.
3. **Kiểm tra Validation lỗi:**
   - Để trống tiêu đề hoặc nhập ít hơn 3 ký tự (ví dụ: `AB`) $\rightarrow$ Bấm *Create Meeting Room* $\rightarrow$ Hiển thị lỗi: `"Meeting title must be at least 3 characters"`.
   - Chọn *End Time* trước *Start Time* $\rightarrow$ Bấm *Create Meeting Room* $\rightarrow$ Hiển thị lỗi: `"End time must be after start time"`.
   - Nhập email người tham dự sai định dạng (ví dụ: `abc`) $\rightarrow$ Bấm *Add* $\rightarrow$ Hiển thị lỗi: `"Invalid email address"`.
   - Chuyển sang chế độ **Use existing link**, nhập link không hợp lệ (ví dụ: `https://zoom.us/123`) $\rightarrow$ Bấm *Create Meeting Room* $\rightarrow$ Hiển thị lỗi: `"Must be a valid Google Meet link"`.

---

### Kịch bản 3: Sử dụng các tính năng thông minh trên Form
1. Bấm nút preset **Now + 30m** hoặc **Now + 60m**:
   - Trường *Start Time* và *End Time* tự động cập nhật thời gian chính xác.
   - Badge hiển thị thời lượng cuộc họp tự tính toán (ví dụ: `30 mins` hoặc `60 mins`).
2. Nhập email hợp lệ vào ô Invite Attendees (ví dụ: `client@company.com`) rồi bấm **Add** (hoặc nhấn phím **Enter**):
   - Email xuất hiện dưới dạng chip tag màu xanh có nút `X` để xoá.
   - Thẻ Live Preview bên phải tăng số lượng người tham dự tương ứng.
3. Nhập tiêu đề cuộc họp (ví dụ: `"Kickoff Sprint 14 — Core Modernization"`):
   - Thẻ Live Preview bên phải đổi tiêu đề ngay lập tức.

---

### Kịch bản 4: Tạo phòng họp thành công & Tương tác phòng họp
1. Điền đầy đủ thông tin hợp lệ và bấm **Create Meeting Room**.
2. Màn hình thông báo thành công xuất hiện:
   - Biểu tượng Google Meet với gradient đặc trưng.
   - Tiêu đề: `"Meeting Room Created!"`.
   - Hiển thị đường link Google Meet tự động sinh (ví dụ: `https://meet.google.com/abc-defg-hij`).
3. Bấm nút **Copy Link**:
   - Nút chuyển trạng thái thành `Copied!` màu xanh, link được sao chép vào Clipboard của máy.
4. Bấm nút **Join Now**:
   - Trình duyệt mở tab mới dẫn trực tiếp vào phòng Google Meet.
5. Bấm liên kết **View all meetings →**:
   - Điều hướng quay trở lại trang danh sách `/enterprise/meetings`. Phòng họp vừa tạo sẽ hiển thị trong danh sách.

---

## 4. Lưu ý quan trọng: Lỗi "Hãy kiểm tra mã cuộc họp" trên Google Meet & Giải pháp

### Nguyên nhân:
- Khi chọn chế độ **Auto-generate link**: Do máy chủ hiện tại chưa tích hợp tài khoản doanh nghiệp Google Workspace Service Account (có quyền Domain-Wide Delegation), hệ thống sinh mã phòng ngẫu nhiên dạng `xxx-yyyy-zzz`.
- Mã ngẫu nhiên này **chưa từng được đăng ký tạo phòng trên máy chủ của Google**, do đó khi nhấp vào link, Google Meet sẽ báo lỗi: *"Hãy kiểm tra mã cuộc họp của bạn. Đảm bảo bạn đã nhập đúng mã cuộc họp vào URL"*.

### Giải pháp (Đã tích hợp trực tiếp trên giao diện FE):
1. Tại mục **Google Meet Configuration**, chọn tab **Use existing link**.
2. Nhấp nút màu xanh **"Tạo phòng Meet thật ngay"** (Hệ thống sẽ mở `https://meet.google.com/new` trên Google Meet chính thức).
3. Google Meet tự động sinh phòng họp thật 100%. Bạn chỉ cần sao chép link (ví dụ: `https://meet.google.com/abc-defg-hij`) và dán vào ô Google Meet Link.
4. Bấm **Create Room**:
   - Cuộc họp được lưu trữ an toàn trong MongoDB.
   - Hệ thống tự động gửi email thư mời kèm đường link Meet thật 100% đến tất cả người tham gia qua SMTP.
   - Bất kỳ ai (Host hoặc người nhận mail) bấm vào link đều tham gia phòng họp Google Meet thật thành công ngay lập tức!

