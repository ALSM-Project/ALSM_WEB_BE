/**
 * ALSM Enterprise Contract Legal Terms & Clause Library
 * 
 * Professional B2B Legal Template Specifications complying with:
 * - Vietnam Civil Code (Law No. 91/2015/QH13)
 * - Vietnam Commercial Law (Law No. 36/2005/QH11)
 * - Vietnam Law on Electronic Transactions (Law No. 20/2023/QH15)
 * - Vietnam Law on Intellectual Property (Law No. 50/2005/QH11 as amended)
 * - Decree No. 13/2023/ND-CP on Personal Data Protection
 */

export interface LegalClauseDefinition {
  articleNumber: number;
  category: string;
  titleVi: string;
  titleEn: string;
  contentVi: string;
  contentEn: string;
  legalReference?: string;
  isMandatory: boolean;
}

export interface ContractTitleMapping {
  titleVi: string;
  titleEn: string;
  documentTypeVi: string;
  documentTypeEn: string;
}

export const CONTRACT_TITLES: Record<string, ContractTitleMapping> = {
  ENTERPRISE_HYBRID_MSA: {
    titleVi: 'HỢP ĐỒNG DỊCH VỤ TỔNG THỂ HIỆN ĐẠI HÓA HỆ THỐNG PHẦN MỀM',
    titleEn: 'ENTERPRISE SOFTWARE SYSTEM MODERNIZATION MASTER SERVICES AGREEMENT',
    documentTypeVi: 'Hợp Đồng Dịch Vụ Doanh Nghiệp (MSA)',
    documentTypeEn: 'Master Services Agreement (MSA)',
  },
  MANAGED_CONVERSION_SOW: {
    titleVi: 'HỢP ĐỒNG DỊCH VỤ HIỆN ĐẠI HÓA VÀ CHUYỂN ĐỔI HỆ THỐNG (MANAGED SERVICES)',
    titleEn: 'MANAGED MODERNIZATION SERVICES STATEMENT OF WORK',
    documentTypeVi: 'Hợp Đồng Dịch Vụ Hiện Đại Hóa Trọn Gói (Managed Services)',
    documentTypeEn: 'Managed Modernization Services Agreement',
  },
  SELF_SERVICE_SUBSCRIPTION: {
    titleVi: 'HỢP ĐỒNG THUÊ BAO NỀN TẢNG HIỆN ĐẠI HÓA PHẦN MỀM',
    titleEn: 'PLATFORM-BASED SOFTWARE MODERNIZATION SUBSCRIPTION AGREEMENT',
    documentTypeVi: 'Hợp Đồng Nền Tảng Hiện Đại Hóa (Platform-Based)',
    documentTypeEn: 'Platform-Based Modernization Agreement',
  },
  NON_DISCLOSURE_AGREEMENT: {
    titleVi: 'THỎA THUẬN BẢO MẬT THÔNG TIN VÀ BẢO VỆ DỮ LIỆU DOANH NGHIỆP',
    titleEn: 'ENTERPRISE MUTUAL NON-DISCLOSURE AND DATA PROTECTION AGREEMENT',
    documentTypeVi: 'Thỏa Thuận Bảo Mật Song Phương (NDA)',
    documentTypeEn: 'Mutual Non-Disclosure Agreement (NDA)',
  },
  ORDER_FORM: {
    titleVi: 'ĐƠN ĐẶT HÀNG DỊCH VỤ HIỆN ĐẠI HÓA PHẦN MỀM',
    titleEn: 'SOFTWARE MODERNIZATION SERVICES ORDER FORM',
    documentTypeVi: 'Đơn Đặt Hàng Dịch Vụ (Order Form)',
    documentTypeEn: 'Services Order Form',
  },
  CONTRACT_AMENDMENT: {
    titleVi: 'PHỤ LỤC SỬA ĐỔI, BỔ SUNG HỢP ĐỒNG DỊCH VỤ HIỆN ĐẠI HÓA PHẦN MỀM',
    titleEn: 'AMENDMENT TO SOFTWARE MODERNIZATION SERVICES AGREEMENT',
    documentTypeVi: 'Phụ Lục Hợp Đồng (Amendment)',
    documentTypeEn: 'Contract Amendment',
  },
};

export const SERVICE_MODE_EXPLANATIONS: Record<string, { vi: string; en: string }> = {
  SELF_SERVICE_CONVERSION: {
    vi: 'Dịch vụ Hiện đại hóa Dựa trên Nền tảng (Platform-Based Modernization): Khách hàng được cấp quyền truy cập công cụ ALSM Studio để chủ động thực hiện phân tích cú pháp (parsing), ánh xạ màn hình BMS/DSPF và xuất mã nguồn hiện đại hóa trong phạm vi hạn ngạch được thỏa thuận.',
    en: 'Platform-Based Modernization License: Customer is granted access to the ALSM Studio workspace to independently ingest, parse, map, and synthesize modernized artifacts within the authorized capacity quota.',
  },
  SELF_SERVICE: {
    vi: 'Dịch vụ Hiện đại hóa Dựa trên Nền tảng (Platform-Based Modernization): Khách hàng được cấp quyền truy cập công cụ ALSM Studio để chủ động thực hiện phân tích cú pháp (parsing), ánh xạ màn hình BMS/DSPF và xuất mã nguồn hiện đại hóa trong phạm vi hạn ngạch được thỏa thuận.',
    en: 'Platform-Based Modernization License: Customer is granted access to the ALSM Studio workspace to independently ingest, parse, map, and synthesize modernized artifacts within the authorized capacity quota.',
  },
  WE_CONVERT_FOR_YOU: {
    vi: 'Dịch vụ Hiện đại hóa Chuyên biệt Được Quản lý (Managed Modernization Services): Đội ngũ kỹ sư giải pháp ALSM trực tiếp tiếp nhận tài liệu nguồn, thiết lập quy trình chuyển đổi chuyên biệt, kiểm định quy tắc AST và bàn giao toàn bộ sản phẩm hoàn thiện theo từng giai đoạn nghiệm thu.',
    en: 'Managed Modernization Services: ALSM dedicated modernization engineering team directly receives customer source materials, executes end-to-end AST synthesis pipelines, validates semantic equivalence, and delivers verified packages through formal acceptance gates.',
  },
  HYBRID: {
    vi: 'Mô hình Hỗn hợp (Hybrid): Kết hợp giữa Hiện đại hóa Dựa trên Nền tảng (Platform-Based Modernization) và Dịch vụ Hiện đại hóa Chuyên biệt Được Quản lý (Managed Modernization Services) cùng kiểm định AST từ các chuyên gia kiến trúc phần mềm ALSM.',
    en: 'Enterprise Hybrid Modernization Model: Combines autonomous Platform-Based Modernization workspace access with dedicated Managed Modernization Services advisory, bespoke AST parser extensions, and co-managed milestone delivery.',
  },
};

/**
 * Standard 15 Comprehensive Articles for ALSM Enterprise Software Modernization Agreement
 */
export const STANDARD_LEGAL_ARTICLES: LegalClauseDefinition[] = [
  {
    articleNumber: 1,
    category: 'DEFINITIONS',
    titleVi: 'ĐIỀU 1: ĐỊNH NGHĨA VÀ GIẢI THÍCH THUẬT NGỮ',
    titleEn: 'ARTICLE 1: DEFINITIONS AND INTERPRETATION',
    contentVi: `Trong Hợp đồng này, trừ khi ngữ cảnh có yêu cầu khác, các thuật ngữ viết hoa dưới đây được hiểu và định nghĩa như sau:
1.1. "Hợp đồng" (Agreement): Có nghĩa là Hợp đồng dịch vụ này, bao gồm phần nội dung chính, các Phụ lục đính kèm và các văn bản sửa đổi, bổ sung hợp lệ được các Bên ký kết bằng văn bản hoặc xác nhận điện tử theo quy định.
1.2. "Bên Cung Cấp" (Provider): Là CÔNG TY CỔ PHẦN CÔNG NGHỆ ALSM được xác định tại phần thông tin các Bên.
1.3. "Khách hàng" (Customer): Là cơ quan, tổ chức, doanh nghiệp được xác định tại phần thông tin các Bên và đứng tên trên Hợp đồng này.
1.4. "Dịch vụ" (Services): Là toàn bộ các giải pháp, công cụ phần mềm, nền tảng phân tích và hỗ trợ kỹ thuật hiện đại hóa hệ thống kế thừa do Bên Cung Cấp cung cấp cho Khách hàng theo phạm vi quy định tại Điều 2.
1.5. "Dự án Hiện đại hóa" (Modernization Project): Là toàn bộ lộ trình và công việc chuyển đổi hệ thống phần mềm kế thừa sang kiến trúc công nghệ hiện đại được thỏa thuận giữa hai Bên.
1.6. "Hệ thống Kế thừa" (Legacy System): Là hệ thống công nghệ thông tin hiện hữu của Khách hàng, bao gồm nhưng không giới hạn ở các màn hình IBM 3270 BMS, AS/400 DSPF, và các chương trình xử lý nghiệp vụ viết bằng ngôn ngữ COBOL hoặc tương đương.
1.7. "Tài liệu Nguồn" (Source Materials): Bao gồm toàn bộ tệp tin mã nguồn, bản đồ màn hình (BMS/DSPF maps), tệp định nghĩa dữ liệu (copybooks), tài liệu nghiệp vụ do Khách hàng cung cấp cho Bên Cung Cấp để thực hiện Dịch vụ.
1.8. "Sản phẩm Bàn giao" (Deliverables): Là các thành phần phần mềm, mã nguồn hiện đại hóa (React TypeScript, Spring Boot Java, JPA entities, DTOs), tài liệu kỹ thuật và báo cáo kiểm định do Bên Cung Cấp tổng hợp và bàn giao cho Khách hàng.
1.9. "Chuyển đổi" (Conversion): Là quy trình dịch chuyển và tái cấu trúc giao diện cùng logic nghiệp vụ từ Hệ thống Kế thừa sang nền tảng công nghệ đích hiện đại thông qua công nghệ phân tích AST.
1.10. "Thẩm định AST" (AST Validation): Là phương pháp kiểm định dựa trên Cây Cú pháp Trừu tượng (Abstract Syntax Tree) nhằm chứng minh tính tương đương logic, tính chính xác số học (packed decimal sang BigDecimal) và bảo toàn tính toàn vẹn cú pháp mà không gây sai lệch ngẫu nhiên.
1.11. "Nghiệm thu" (Acceptance): Là việc Khách hàng xác nhận Sản phẩm Bàn giao đạt tiêu chuẩn kỹ thuật và đáp ứng các tiêu chí quy định tại Điều 10 của Hợp đồng.
1.12. "Ngày Làm việc" (Business Day): Là bất kỳ ngày nào từ thứ Hai đến thứ Sáu, không bao gồm các ngày thứ Bảy, Chủ nhật và các ngày nghỉ lễ, Tết theo quy định của pháp luật Việt Nam.
1.13. "Cam kết Mức Dịch vụ" (SLA): Là các chỉ số cam kết về độ sẵn sàng của hệ thống, thời gian phản hồi hỗ trợ kỹ thuật và thời gian khắc phục sự cố được quy định tại Điều 5 và Phụ lục C.
1.14. "Tổ chức" (Organization): Là thực thể doanh nghiệp được định danh trên nền tảng ALSM đại diện cho Khách hàng.
1.15. "Hạn ngạch" (Quota): Là giới hạn khối lượng tối đa về số lượng màn hình, chương trình logic hoặc dung lượng lưu trữ mà Khách hàng được phép chuyển đổi theo thỏa thuận thương mại.
1.16. "Quyền Sở hữu Trí tuệ" (Intellectual Property Rights): Có nghĩa là toàn bộ các quyền sáng chế, quyền tác giả, nhãn hiệu, bí mật kinh doanh và các quyền sở hữu công nghiệp khác theo quy định của pháp luật sở hữu trí tuệ.`,
    contentEn: `In this Agreement, unless the context otherwise requires, capitalized terms shall have the following meanings:
1.1. "Agreement": Means this Enterprise Services Agreement, including its recitals, schedules, appendices, and any formally executed amendments or electronic sign-offs.
1.2. "Provider": Means ALSM TECHNOLOGY SOLUTIONS JOINT STOCK COMPANY as identified in the recitals.
1.3. "Customer": Means the legal entity identified in the recitals and executing this Agreement.
1.4. "Services": Means the software modernization platform, automated conversion tooling, and professional technical services provided by Provider as set forth in Article 2.
1.5. "Modernization Project": Means the project covering the migration and transformation of Customer legacy software assets into modern target architectures.
1.6. "Legacy System": Means Customer existing software environment, including without limitation IBM 3270 BMS maps, AS/400 DSPF displays, and COBOL business logic programs.
1.7. "Source Materials": Means all legacy source code, screen layout definitions, data structures (copybooks), and technical documentation supplied by Customer to Provider for performing the Services.
1.8. "Deliverables": Means modernized software artifacts synthesized by Provider, including React TypeScript components, Spring Boot Java microservices, JPA repositories, DTOs, and validation dossiers.
1.9. "Conversion": Means the systematic transformation of legacy user interfaces and procedural business logic into modern target architectures via AST-based processing.
1.10. "AST Validation": Means the Abstract Syntax Tree deterministic verification verifying mathematical precision, field-level parity, and syntactic equivalence without probabilistic hallucinations.
1.11. "Acceptance": Means the formal written or agreed electronic sign-off by Customer confirming that Deliverables satisfy the technical acceptance criteria set forth in Article 10.
1.12. "Business Day": Means any day other than a Saturday, Sunday, or official public holiday recognized under the laws of the Socialist Republic of Vietnam.
1.13. "Service Level Agreement" (SLA): Means the availability standards, support response windows, and operational commitments described in Article 5 and Appendix C.
1.14. "Organization": Means the enterprise tenant account provisioned on the ALSM Platform representing Customer.
1.15. "Quota": Means the agreed numeric volume limits governing screens, procedural programs, or cloud storage allocated to Customer.
1.16. "Intellectual Property Rights": Means all patents, copyrights, trade secrets, trademarks, moral rights, and proprietary rights recognized under intellectual property legislation.`,
    legalReference: 'Bộ luật Dân sự 2015 (Điều 398–401) / Civil Code of Vietnam (Articles 398–401)',
    isMandatory: true,
  },
  {
    articleNumber: 2,
    category: 'SCOPE_OF_SERVICES',
    titleVi: 'ĐIỀU 2: PHẠM VI DỊCH VỤ VÀ NĂNG LỰC CÔNG NGHỆ',
    titleEn: 'ARTICLE 2: SCOPE OF SERVICES AND TECHNICAL METHODOLOGY',
    contentVi: `2.1. Căn cứ vào mô hình dịch vụ được thống nhất, Bên Cung Cấp cung cấp cho Khách hàng dịch vụ hiện đại hóa phần mềm với các nội dung chi tiết:
a) Phân tích và trích xuất cấu trúc: Phân tích cú pháp tệp nguồn màn hình (IBM BMS / AS/400 DSPF) và mã nguồn COBOL thông qua bộ tiền xử lý chuyên dụng của ALSM.
b) Chuyển đổi giao diện người dùng: Tổng hợp tự động các màn hình kế thừa thành các thành phần giao diện React 19 (TypeScript) tương thích thiết kế Tailwind CSS, đảm bảo đầy đủ thuộc tính trường, quy tắc định dạng và thông báo trạng thái.
c) Tái cấu trúc logic nghiệp vụ: Chuyển đổi các khối logic COBOL sang các dịch vụ Spring Boot 3 Java 21, chuyển hóa cấu trúc dữ liệu sang DTOs và JPA entities với độ chính xác số học bảo đảm.
d) Thẩm định cú pháp và logic: Thực hiện quy trình đối soát AST nhằm phát hiện và ngăn chặn mọi sai lệch cú pháp trước khi đóng gói sản phẩm.
2.2. Hạn ngạch dịch vụ thỏa thuận:
- Số lượng màn hình tối đa: Được xác định cụ thể tại Phần Thông tin Hợp đồng.
- Số lượng chương trình logic tối đa: Được xác định cụ thể tại Phần Thông tin Hợp đồng.
- Dung lượng lưu trữ bảo mật: Được xác định cụ thể tại Phần Thông tin Hợp đồng.
2.3. Các công việc nằm ngoài phạm vi dịch vụ (Out of Scope):
Trừ khi có thỏa thuận bằng văn bản riêng biệt kèm chi phí bổ sung, Dịch vụ không bao gồm:
- Mua sắm, thiết lập hoặc bảo trì phần cứng, máy chủ cơ sở dữ liệu vật lý tại cơ sở của Khách hàng.
- Can thiệp hoặc chỉnh sửa mã nguồn Hệ thống Kế thừa đang vận hành trên môi trường thực tế (production) của Khách hàng.
- Nâng cấp hoặc khắc phục các lỗi nghiệp vụ vốn đã tồn tại sẵn trong mã nguồn gốc do Khách hàng cung cấp.
- Đảm bảo tính tương thích với các trình duyệt web hoặc phiên bản phần mềm đã bị nhà sản xuất ngừng hỗ trợ (end-of-life).`,
    contentEn: `2.1. In accordance with the agreed service model, Provider shall deliver software modernization capabilities as detailed herein:
a) Structure Ingestion & Parsing: Parsing legacy screen definition files (IBM BMS / AS/400 DSPF) and COBOL business logic via ALSM proprietary syntax engines.
b) User Interface Synthesis: Deterministic generation of legacy screens into modular React 19 TypeScript components styled with Tailwind CSS, preserving field coordinates, data attributes, and validation rules.
c) Business Logic Modernization: Transformation of procedural COBOL routines into Spring Boot 3 Java 21 microservices, synthesizing DTO contracts, and JPA repository abstractions.
d) Deterministic AST Verification: Automated cross-compilation validation to verify semantic parity and prevent syntax regressions prior to artifact packaging.
2.2. Agreed Capacity Quotas:
- Maximum Screen Allocation: As specified in the Contract Identification and Scope schedule.
- Maximum Program Allocation: As specified in the Contract Identification and Scope schedule.
- Secure Cloud Storage Allocation: As specified in the Contract Identification and Scope schedule.
2.3. Excluded Scope (Out of Scope):
Unless expressly agreed under a separate bilateral Statement of Work, the Services do not include:
- Procurement, configuration, or physical maintenance of on-premise hardware or third-party database engines.
- Direct live maintenance, modification, or hot-patching of Customer production mainframe environments.
- Rectifying pre-existing business logic errors or defects inherent in the original legacy source code.
- Supporting legacy web browsers or operating systems that have reached formal end-of-life support.`,
    legalReference: 'Luật Thương mại 2005 (Điều 74–77) / Commercial Law of Vietnam (Articles 74–77)',
    isMandatory: true,
  },
  {
    articleNumber: 3,
    category: 'DELIVERABLES_SPECIFICATION',
    titleVi: 'ĐIỀU 3: SẢN PHẨM BÀN GIAO VÀ TIÊU CHUẨN KỸ THUẬT',
    titleEn: 'ARTICLE 3: DELIVERABLES AND TECHNICAL SPECIFICATIONS',
    contentVi: `3.1. Danh mục Sản phẩm Bàn giao chính thức của Hợp đồng bao gồm:
a) Gói mã nguồn giao diện người dùng: Các components React 19 viết bằng TypeScript sạch, tuân thủ nguyên tắc component-driven, đi kèm các tệp CSS/Tailwind hoàn chỉnh.
b) Gói mã nguồn dịch vụ phía máy chủ: Dự án Spring Boot 3 Java 21 biên dịch hoàn chỉnh, bao gồm REST Controllers, Service Implementations, DTOs, và các JPA Entities tương thích cơ sở dữ liệu hiện đại.
c) Hồ sơ Kiểm định Cú pháp AST (AST Validation Dossier): Báo cáo chi tiết chứng thực tỷ lệ bảo toàn logic, bảng đối chiếu ánh xạ thuộc tính trường và kết quả kiểm tra cú pháp tự động.
d) Tài liệu Kỹ thuật và Hướng dẫn Triển khai: Tài liệu mô tả kiến trúc tổng thể, sơ đồ ánh xạ thực thể và hướng dẫn đóng gói triển khai (Docker/Kubernetes runbook).
3.2. Phương thức Bàn giao:
Toàn bộ Sản phẩm Bàn giao được chuyển giao thông qua Cổng Doanh nghiệp ALSM bảo mật bằng kênh truyền mã hóa TLS 1.3 hoặc bàn giao theo hình thức mã hóa bất đối xứng được hai Bên thống nhất.
3.3. Tiêu chuẩn Kỹ thuật:
Mã nguồn bàn giao phải đảm bảo biên dịch thành công (clean build), không chứa mã độc, tuân thủ chuẩn định dạng mã nguồn doanh nghiệp và vượt qua toàn bộ các bài kiểm tra cú pháp AST cơ bản của ALSM.`,
    contentEn: `3.1. Official Deliverables under this Agreement comprise:
a) Modernized Frontend Artifacts: Clean, modular React 19 TypeScript components conforming to modern UI standards, complete with CSS/Tailwind stylesheets.
b) Backend Services Architecture: Compiled, standard-compliant Spring Boot 3 Java 21 project containing REST endpoints, Service layers, Data Transfer Objects, and JPA Entity definitions.
c) AST Semantic Equivalence Dossier: Formal automated report documenting logic preservation ratios, field attribute mappings, and syntax verification matrices.
d) Technical Specifications & Runbook: Architecture overview diagrams, data entity relation maps, and container deployment guidance (Docker/Kubernetes).
3.2. Delivery Mechanism:
All Deliverables shall be transmitted through the secure ALSM Enterprise Portal via TLS 1.3 encrypted channels or delivered as cryptographically sealed packages as agreed by the Parties.
3.3. Technical Acceptance Standards:
Synthesized source code must achieve clean compilation, remain free of identified malicious code, comply with established enterprise styling standards, and satisfy all automated AST syntax gates.`,
    legalReference: 'Luật Giao dịch Điện tử 2023 / Law on Electronic Transactions (Law No. 20/2023/QH15)',
    isMandatory: true,
  },
  {
    articleNumber: 4,
    category: 'COMMERCIAL_TERMS',
    titleVi: 'ĐIỀU 4: GIÁ TRỊ HỢP ĐỒNG VÀ ĐIỀU KHOẢN THANH TOÁN',
    titleEn: 'ARTICLE 4: CONTRACT VALUE AND PAYMENT TERMS',
    contentVi: `4.1. Cơ cấu Tài chính của Hợp đồng:
Tổng giá trị của Hợp đồng này được xác định căn cứ theo báo giá thương mại chính thức được hai Bên phê duyệt, bao gồm:
- Giá dịch vụ trước thuế (Base Service Fee): Theo bảng tính toán chi tiết.
- Chiết khấu thương mại (Discount): Được áp dụng theo chính sách doanh nghiệp nếu có.
- Giá trị tính thuế (Taxable Amount): Giá dịch vụ sau khi trừ chiết khấu.
- Thuế Giá trị Gia tăng (VAT): Được áp dụng theo tỷ lệ thuế suất quy định của pháp luật thuế hiện hành tại thời điểm xuất hóa đơn (phù hợp với quy định về dịch vụ phần mềm theo Thông tư 219/2013/TT-BTC hoặc quy định sửa đổi tương đương).
- Tổng Giá trị Hợp đồng Đã bao gồm Thuế: Số tiền thanh toán cuối cùng bằng đồng Việt Nam (VND).
4.2. Phương thức Thanh toán:
Thanh toán được thực hiện bằng hình thức chuyển khoản ngân hàng vào tài khoản định danh hợp pháp của Bên Cung Cấp:
- Tên chủ tài khoản: Theo thông tin chính thức của Bên Cung Cấp.
- Số tài khoản: Được ghi nhận rõ tại Phần Thông tin Hợp đồng.
- Ngân hàng thụ hưởng: Ngân hàng thương mại được cấp phép hoạt động tại Việt Nam.
4.3. Tiến độ Thanh toán:
Thanh toán được thực hiện theo các đợt gắn liền với mốc nghiệm thu hoặc kỳ thanh toán thuê bao được quy định cụ thể tại Phụ lục B.
4.4. Thời hạn Thanh toán:
Khách hàng có trách nhiệm thanh toán đầy đủ từng đợt trong vòng 15 (mười lăm) Ngày Làm việc kể từ ngày nhận được hóa đơn điện tử hợp lệ kèm biên bản đề nghị thanh toán từ Bên Cung Cấp.
4.5. Xử lý Chậm Thanh toán:
Trường hợp Khách hàng chậm thanh toán quá thời hạn mà không có lý do chính đáng được Bên Cung Cấp chấp thuận bằng văn bản, Bên Cung Cấp có quyền áp dụng mức lãi suất chậm thanh toán bằng 0,05%/ngày trên số tiền chậm trả, tính từ ngày đến hạn thanh toán cho đến ngày thực thanh toán, nhưng tổng tiền phạt không vượt quá giới hạn tối đa cho phép theo Luật Thương mại Việt Nam. Nếu chậm thanh toán quá 30 (ba mươi) ngày, Bên Cung Cấp có quyền tạm ngừng cung cấp Dịch vụ sau khi đã gửi thông báo trước 05 (năm) Ngày Làm việc.`,
    contentEn: `4.1. Financial Breakdown of Contract Value:
The total commercial consideration payable under this Agreement is established based on the formal commercial schedule approved by both Parties, comprising:
- Base Service Consideration: Pre-tax service charges calculated on scope and quotas.
- Commercial Discount: Contractual discounts approved under enterprise commercial programs.
- Net Taxable Consideration: Subtotal after deducting applicable discounts.
- Value Added Tax (VAT): Calculated strictly in compliance with applicable Vietnamese tax regulations at the time of invoicing (including circulars governing software and IT services).
- Total Contract Value (Inclusive of Applicable Tax): The final gross amount payable in Vietnamese Dong (VND).
4.2. Payment Channel:
All disbursements shall be effected by corporate bank wire transfer into Provider designated authorized bank account:
- Account Holder Name: As formally registered by Provider.
- Account Number: Explicitly stated in the Contract Recitals and commercial schedule.
- Receiving Bank: Authorized commercial banking institution operating in Vietnam.
4.3. Billing & Milestone Schedule:
Payments shall be processed in accordance with milestone acceptance gates or subscription billing intervals detailed in Appendix B.
4.4. Payment Due Window:
Customer shall disburse all invoiced sums within fifteen (15) Business Days from receipt of an official, valid electronic Value-Added Tax (VAT) invoice together with relevant milestone completion evidence.
4.5. Late Disbursement Remedies:
If Customer fails to disburse invoiced amounts within the due window without prior written agreement from Provider, Provider reserves the right to accrue late interest at 0.05% per day on overdue balances, calculated from the due date until full settlement, subject to maximum statutory limits under Vietnamese commercial law. If delinquency extends beyond thirty (30) consecutive calendar days, Provider may suspend service access upon five (5) Business Days written notice.`,
    legalReference: 'Luật Thương mại 2005 (Điều 50, 306) & Luật Thuế GTGT / Commercial Law (Articles 50, 306)',
    isMandatory: true,
  },
  {
    articleNumber: 5,
    category: 'SERVICE_LEVEL_AGREEMENT',
    titleVi: 'ĐIỀU 5: CAM KẾT MỨC DỊCH VỤ VÀ HỖ TRỢ KỸ THUẬT (SLA)',
    titleEn: 'ARTICLE 5: SERVICE LEVEL AGREEMENT AND TECHNICAL SUPPORT',
    contentVi: `5.1. Độ Sẵn sàng của Nền tảng (Platform Availability):
Trường hợp Hợp đồng có cấu hình SLA, Bên Cung Cấp cam kết duy trì độ sẵn sàng vận hành của hệ thống hạ tầng chuyển đổi ALSM ở mức tối thiểu 99,5% (hoặc mức cam kết cao hơn theo gói dịch vụ) được tính toán theo từng tháng dương lịch.
5.2. Công thức Tính toán Độ Sẵn sàng:
Tỷ lệ sẵn sàng (%) = [ (Tổng số phút trong tháng - Số phút bảo trì loại trừ - Số phút gián đoạn không theo kế hoạch) / (Tổng số phút trong tháng - Số phút bảo trì loại trừ) ] * 100.
5.3. Thời gian Gián đoạn Loại trừ (Excluded Downtime):
Không tính vào thời gian gián đoạn hệ thống đối với:
a) Lịch bảo trì định kỳ có thông báo trước tối thiểu 48 (bốn mươi tám) giờ cho Khách hàng;
b) Các bản vá bảo mật khẩn cấp nhằm bảo vệ toàn vẹn hệ thống;
c) Sự cố phát sinh do hạ tầng mạng, đường truyền Internet hoặc thiết bị đầu cuối của Khách hàng;
d) Sự kiện Bất khả kháng theo quy định tại Điều 13.
5.4. Phân loại Mức độ Sự cố và Thời gian Phản hồi:
- Mức 1 (Khẩn cấp - Critical): Nền tảng chuyển đổi ngừng hoạt động hoàn toàn hoặc chặn toàn bộ tiến trình tổng hợp AST. Thời gian phản hồi tiếp nhận: trong vòng 02–04 giờ làm việc.
- Mức 2 (Nghiêm trọng - Major): Tính năng cốt lõi bị suy giảm hiệu năng nghiêm trọng nhưng vẫn có giải pháp khắc phục tạm thời. Thời gian phản hồi tiếp nhận: trong vòng 04–08 giờ làm việc.
- Mức 3 (Bình thường - Minor): Yêu cầu hỗ trợ kỹ thuật, hướng dẫn cấu hình hoặc lỗi hiển thị nhỏ không ảnh hưởng tiến độ tổng hợp. Thời gian phản hồi tiếp nhận: trong vòng 01–02 Ngày Làm việc.
5.5. Khung Giờ Hỗ trợ Kỹ thuật:
Hỗ trợ kỹ thuật tiêu chuẩn được cung cấp trong các Ngày Làm việc từ 08:30 đến 17:30 (GMT+7). Các yêu cầu khẩn cấp ngoài giờ được xử lý theo kênh hotline ưu tiên dành cho khách hàng Enterprise.`,
    contentEn: `5.1. Platform Availability Commitment:
Where an SLA tier is active under this Agreement, Provider commits to maintain monthly operational availability of the ALSM conversion infrastructure at or above 99.5% (or higher tier as agreed) calculated on a monthly calendar basis.
5.2. Availability Computation Formula:
Uptime Percentage (%) = [ (Total Calendar Minutes - Excluded Downtime - Unscheduled Outage Minutes) / (Total Calendar Minutes - Excluded Downtime) ] * 100.
5.3. Excluded Downtime:
Availability metrics shall exclude downtime attributable to:
a) Scheduled maintenance windows communicated to Customer with at least forty-eight (48) hours advance notice;
b) Critical emergency security hotfixes deployed to preserve infrastructure integrity;
c) Network, telecommunication, or hardware failures within Customer internal infrastructure;
d) Force Majeure events under Article 13.
5.4. Incident Severity Classification & Response Windows:
- Severity 1 (Critical): Total platform outage or complete block of AST conversion pipelines. Initial engineering response within two to four (2–4) business hours.
- Severity 2 (Major): Core features severely impaired without immediate workaround. Initial response within four to eight (4–8) business hours.
- Severity 3 (Minor): Technical inquiries, configuration assistance, or cosmetic UI defects. Initial response within one to two (1–2) Business Days.
5.5. Standard Operational Support Hours:
Standard engineering support operates on Business Days from 08:30 to 17:30 (GMT+7). Critical escalation pathways are accessible via enterprise hotline facilities.`,
    legalReference: 'Tiêu chuẩn Dịch vụ Công nghệ Thông tin / Enterprise IT Service Management Standards',
    isMandatory: false,
  },
  {
    articleNumber: 6,
    category: 'CUSTOMER_RESPONSIBILITIES',
    titleVi: 'ĐIỀU 6: TRÁCH NHIỆM VÀ NGHĨA VỤ CỦA KHÁCH HÀNG',
    titleEn: 'ARTICLE 6: CUSTOMER RESPONSIBILITIES AND OBLIGATIONS',
    contentVi: `Khách hàng cam kết và chịu trách nhiệm thực hiện đầy đủ các nghĩa vụ sau:
6.1. Cung cấp Tài liệu Nguồn Hợp lệ: Bàn giao các tệp mã nguồn kế thừa (BMS maps, DSPF definitions, COBOL programs) ở trạng thái nguyên vẹn, không bị lỗi tệp tin và đúng định dạng kỹ thuật mà hai Bên đã thống nhất.
6.2. Tính Hợp pháp và Quyền Sở hữu: Cam kết rằng Khách hàng có đầy đủ quyền sở hữu, bản quyền hoặc quyền sử dụng hợp pháp đối với toàn bộ Tài liệu Nguồn cung cấp cho Bên Cung Cấp; bảo đảm việc chuyển đổi không xâm phạm bất kỳ quyền sở hữu trí tuệ hoặc thỏa thuận bảo mật nào với bên thứ ba.
6.3. Bố trí Nhân sự Đầu mối Kỹ thuật: Cử đại diện kỹ thuật có đủ năng lực chuyên môn và thẩm quyền để phối hợp giải đáp các thắc mắc về logic nghiệp vụ, xác thực thuộc tính trường và tham gia quá trình nghiệm thu.
6.4. Phối hợp Nghiệm thu: Tiến hành kiểm thử, rà soát Sản phẩm Bàn giao và phản hồi kết quả nghiệm thu đúng thời hạn quy định tại Điều 10.
6.5. Nghĩa vụ Thanh toán: Thực hiện thanh toán đầy đủ, đúng hạn giá trị hợp đồng theo các quy định tại Điều 4.
6.6. Bảo mật Tài khoản và Môi trường Sử dụng: Bảo vệ an toàn thông tin đăng nhập, khóa bảo mật (API keys, cryptographic certificates) được cấp để truy cập hệ thống ALSM; không chuyển nhượng hoặc chia sẻ quyền truy cập cho bất kỳ bên thứ ba nào khi chưa có sự đồng ý của Bên Cung Cấp.`,
    contentEn: `Customer represents, warrants, and covenants to fulfill the following obligations:
6.1. Valid Source Code Submission: Transmit uncorrupted legacy source files (BMS maps, DSPF displays, COBOL logic) matching technical format specifications agreed between the Parties.
6.2. Authority & Intellectual Property Warranty: Warrant that Customer holds full legal title, license, or authority to possess, decompile, and modernize all submitted Source Materials; ensure that modernizing such materials does not infringe third-party intellectual property or violate external restrictive covenants.
6.3. Technical Focal Point: Designate qualified technical and business domain representatives empowered to provide timely clarifications regarding legacy business logic and participate in acceptance reviews.
6.4. Timely Inspection & Sign-off: Inspect Deliverables and communicate acceptance results strictly within the inspection windows specified in Article 10.
6.5. Payment Compliance: Execute all payment disbursements strictly according to the amounts, schedules, and terms set forth in Article 4.
6.6. Account & Credential Security: Safeguard login credentials, API secrets, and cryptographic keys provisioned for platform access; refrain from sharing or sublicensing access to unauthorized third parties.`,
    legalReference: 'Bộ luật Dân sự 2015 (Điều 517–518) / Civil Code of Vietnam (Articles 517–518)',
    isMandatory: true,
  },
  {
    articleNumber: 7,
    category: 'PROVIDER_RESPONSIBILITIES',
    titleVi: 'ĐIỀU 7: TRÁCH NHIỆM VÀ NGHĨA VỤ CỦA BÊN CUNG CẤP ALSM',
    titleEn: 'ARTICLE 7: PROVIDER RESPONSIBILITIES AND OBLIGATIONS',
    contentVi: `Bên Cung Cấp cam kết và chịu trách nhiệm thực hiện đầy đủ các nghĩa vụ sau:
7.1. Cung cấp Dịch vụ Đúng Phạm vi: Triển khai các dịch vụ hiện đại hóa phần mềm với sự cẩn trọng nghề nghiệp cao nhất, tuân thủ đúng phạm vi, tiêu chuẩn kỹ thuật và tiến độ đã thỏa thuận trong Hợp đồng.
7.2. Bảo vệ Tuyệt đối Dữ liệu Khách hàng: Áp dụng các giải pháp kỹ thuật và tổ chức cần thiết (mã hóa đường truyền TLS 1.3, mã hóa lưu trữ AES-256, kiểm soát truy cập theo vai trò) nhằm bảo vệ Tài liệu Nguồn và dữ liệu của Khách hàng khỏi việc mất mát, truy cập trái phép hoặc phát tán ra bên ngoài.
7.3. Bàn giao Đầy đủ Sản phẩm: Cung cấp đầy đủ Sản phẩm Bàn giao, hồ sơ đối chiếu AST và tài liệu hướng dẫn kỹ thuật theo quy định tại Điều 3.
7.4. Hỗ trợ Kỹ thuật và Khắc phục Sự cố: Duy trì đội ngũ kỹ sư hỗ trợ kỹ thuật, phản hồi và xử lý các sự cố phát sinh trong phạm vi cam kết SLA quy định tại Điều 5.
7.5. Thông báo Kịp thời: Kịp thời thông báo bằng văn bản cho Khách hàng nếu phát hiện các bất thường về cấu trúc tệp nguồn kế thừa hoặc các yếu tố kỹ thuật khách quan có thể ảnh hưởng đến chất lượng hoặc tiến độ bàn giao.
7.6. Không Khai thác Trái phép Dữ liệu Nghiệp vụ: Cam kết không sử dụng mã nguồn hoặc dữ liệu logic nghiệp vụ riêng của Khách hàng cho bất kỳ mục đích nào ngoài việc thực hiện Dịch vụ theo Hợp đồng này; tuyệt đối không sử dụng dữ liệu độc quyền của Khách hàng để huấn luyện các mô hình AI công cộng bên thứ ba.`,
    contentEn: `Provider represents, warrants, and covenants to fulfill the following obligations:
7.1. Professional Service Execution: Execute modernization capabilities with reasonable professional skill and diligence, conforming to the scope, milestones, and technical specifications agreed herein.
7.2. Enterprise Data Protection: Implement industry-standard technological and organizational safeguards (TLS 1.3 in transit, AES-256 at rest, strict RBAC) to safeguard Customer materials against unauthorized access, leakage, or loss.
7.3. Deliverables Provision: Furnish all agreed Deliverables, AST validation dossiers, and architecture runbooks as stipulated in Article 3.
7.4. SLA Technical Support: Maintain qualified technical personnel to remediate platform defects and fulfill support commitments set forth in Article 5.
7.5. Impediment Notification: Promptly notify Customer in writing upon detecting corrupted source files, AST mapping bottlenecks, or technical factors impacting agreed milestone schedules.
7.6. Data Exclusivity & Non-Exploitation: Covenant that Customer proprietary business logic and codebases shall be utilized solely to perform the Services hereunder, and shall never be utilized to train public, unauthorized third-party artificial intelligence models.`,
    legalReference: 'Bộ luật Dân sự 2015 (Điều 515–516) / Civil Code of Vietnam (Articles 515–516)',
    isMandatory: true,
  },
  {
    articleNumber: 8,
    category: 'INTELLECTUAL_PROPERTY',
    titleVi: 'ĐIỀU 8: QUYỀN SỞ HỮU TRÍ TUỆ VÀ CHUYỂN GIAO QUYỀN',
    titleEn: 'ARTICLE 8: INTELLECTUAL PROPERTY RIGHTS AND ALLOCATION',
    contentVi: `8.1. Quyền Sở hữu Trí tuệ Nền tảng của Khách hàng (Customer Background IP):
Khách hàng giữ quyền sở hữu tuyệt đối và duy nhất đối với toàn bộ Tài liệu Nguồn kế thừa, quy trình nghiệp vụ, cơ sở dữ liệu và bí mật kinh doanh đã tồn tại trước ngày có hiệu lực của Hợp đồng này. Bên Cung Cấp không có bất kỳ quyền sở hữu hoặc quyền phái sinh nào đối với logic nghiệp vụ riêng của Khách hàng.
8.2. Quyền Sở hữu Trí tuệ Nền tảng của Bên Cung Cấp (Provider Background IP):
Bên Cung Cấp giữ quyền sở hữu độc quyền đối với toàn bộ công nghệ lõi ALSM, bao gồm: các thuật toán phân tích cú pháp AST, công cụ tổng hợp mã nguồn, thư viện mẫu, quy tắc chuyển đổi ngữ nghĩa, mã định tuyến nền tảng và các bí quyết kỹ thuật (know-how). Hợp đồng này không cấu thành việc chuyển nhượng quyền sở hữu công nghệ lõi của Bên Cung Cấp cho Khách hàng.
8.3. Sản phẩm Bàn giao của Dự án (Project Deliverables):
Sau khi Khách hàng hoàn tất đầy đủ 100% nghĩa vụ thanh toán của từng giai đoạn tương ứng theo Điều 4, Bên Cung Cấp chuyển giao toàn bộ quyền tác giả và quyền tài sản đối với các tệp mã nguồn hiện đại hóa được tổng hợp chuyên biệt cho Khách hàng (bao gồm các components React, Spring Boot Java services, DTOs và JPA entities). Khách hàng có toàn quyền sở hữu, sử dụng, chỉnh sửa, phát triển tiếp và triển khai vận hành các sản phẩm bàn giao này.
8.4. Thành phần Phần mềm Nguồn mở và Bên thứ Ba (Third-Party & Open Source):
Các thành phần nguồn mở tiêu chuẩn (như React, Tailwind CSS, Spring Boot, OpenJDK) chịu sự điều chỉnh theo các giấy phép nguồn mở tương ứng (MIT, Apache 2.0, v.v.). Các Bên có trách nhiệm tuân thủ các điều khoản giấy phép mã nguồn mở theo đúng thông lệ quốc tế.`,
    contentEn: `8.1. Customer Background Intellectual Property:
Customer retains exclusive ownership of all pre-existing Legacy Systems, Source Materials, business workflows, proprietary formulas, and underlying trade secrets. Nothing in this Agreement transfers any proprietary rights in Customer business logic to Provider.
8.2. Provider Core Background Intellectual Property:
Provider retains exclusive ownership of all pre-existing and independently developed technologies, including ALSM AST parsing engines, grammar definition matrices, synthesis compilers, and generic utility frameworks. Customer acquires no ownership rights in Provider underlying core tooling.
8.3. Modernized Project Deliverables:
Subject to Customer full settlement of all invoiced fees associated with the applicable milestone under Article 4, Provider assigns and transfers to Customer all right, title, and copyright in the tailored synthesized application source code (including customized React components, Spring Boot microservices, DTOs, and JPA schemas). Customer enjoys unencumbered rights to operate, modify, enhance, and deploy such synthesized artifacts.
8.4. Open-Source & Third-Party Dependencies:
Standard open-source libraries incorporated into synthesized Deliverables (e.g., React, Tailwind CSS, Spring Boot) remain licensed under their respective open-source licenses (such as MIT or Apache 2.0). Both Parties covenant to respect standard open-source attribution requirements.`,
    legalReference: 'Luật Sở hữu Trí tuệ 2005 (sửa đổi, bổ sung 2022) / Vietnam IP Law (Law No. 50/2005/QH11 as amended)',
    isMandatory: true,
  },
  {
    articleNumber: 9,
    category: 'CONFIDENTIALITY',
    titleVi: 'ĐIỀU 9: BẢO MẬT THÔNG TIN VÀ AN TOÀN DỮ LIỆU',
    titleEn: 'ARTICLE 9: CONFIDENTIALITY AND DATA PROTECTION',
    contentVi: `9.1. Định nghĩa Thông tin Bảo mật:
"Thông tin Bảo mật" bao gồm toàn bộ các thông tin kỹ thuật, tài chính, kinh doanh, sơ đồ cấu trúc, mã nguồn, tài liệu thiết kế và dữ liệu khách hàng được một Bên (Bên Tiết lộ) cung cấp cho Bên kia (Bên Nhận) dưới bất kỳ hình thức nào.
9.2. Nghĩa vụ Bảo mật:
Bên Nhận cam kết:
a) Giữ bí mật tuyệt đối toàn bộ Thông tin Bảo mật của Bên Tiết lộ với sự cẩn trọng tối thiểu ngang bằng mức độ bảo vệ thông tin mật của chính mình nhưng không thấp hơn mức độ cẩn trọng hợp lý;
b) Chỉ sử dụng Thông tin Bảo mật duy nhất cho mục đích thực hiện các quyền và nghĩa vụ theo Hợp đồng này;
c) Chỉ tiết lộ Thông tin Bảo mật cho những nhân viên, cố vấn chuyên môn trực tiếp tham gia dự án và đã ký cam kết bảo mật có giá trị tương đương.
9.3. Biện pháp Kỹ thuật và An toàn Dữ liệu:
Bên Cung Cấp cam kết triển khai các biện pháp kỹ thuật nghiêm ngặt nhằm bảo đảm an toàn dữ liệu: mã hóa dữ liệu trong quá trình truyền tải bằng giao thức TLS 1.3 và mã hóa dữ liệu lưu trữ bằng thuật toán AES-256; thực hiện kiểm soát quyền truy cập định danh nghiêm ngặt.
9.4. Thời hạn Lưu trữ và Hủy bỏ Dữ liệu:
Khi hoàn thành toàn bộ Dịch vụ hoặc theo yêu cầu bằng văn bản của Khách hàng, Bên Cung Cấp sẽ thực hiện việc thu hồi hoặc xóa bỏ an toàn toàn bộ Tài liệu Nguồn của Khách hàng khỏi môi trường xử lý trong vòng 30 (ba mươi) Ngày Làm việc, trừ trường hợp pháp luật yêu cầu phải lưu trữ tài liệu chứng từ kế toán, kiểm toán.
9.5. Thời hạn Hiệu lực của Nghĩa vụ Bảo mật:
Nghĩa vụ bảo mật theo Điều này vẫn duy trì hiệu lực và ràng buộc các Bên trong thời hạn 03 (ba) năm kể từ ngày Hợp đồng này chấm dứt hoặc thanh lý.`,
    contentEn: `9.1. Definition of Confidential Information:
"Confidential Information" encompasses all technical, commercial, financial, architectural, source code, data dictionaries, and operational materials disclosed by one Party ("Disclosing Party") to the other ("Receiving Party") in connection with this Agreement.
9.2. Non-Disclosure Covenants:
The Receiving Party covenants to:
a) Maintain strict confidentiality of Disclosing Party materials with at least the degree of care it accords its own sensitive assets, but in no event less than reasonable care;
b) Utilize Confidential Information solely to discharge rights and obligations under this Agreement;
c) Restrict disclosure strictly to personnel and authorized advisors with a legitimate need-to-know who are bound by confidentiality covenants no less stringent than those herein.
9.3. Security Measures:
Provider implements rigorous enterprise data security controls, including TLS 1.3 encryption for data in transit, AES-256 encryption for data at rest, and role-based access management.
9.4. Data Retention & Secure Sanitization:
Upon completion of the Services or upon written request from Customer, Provider shall return or permanently sanitize Customer Source Materials from active processing environments within thirty (30) Business Days, save for archival copies required by mandatory statutory retention mandates.
9.5. Survival Period:
Confidentiality obligations under this Article shall survive for a period of three (3) years following the termination or expiration of this Agreement.`,
    legalReference: 'Nghị định 13/2023/NĐ-CP & Luật An toàn Thông tin Mạng / Decree 13/2023/ND-CP & Cyber Security Law',
    isMandatory: true,
  },
  {
    articleNumber: 10,
    category: 'ACCEPTANCE_SIGN_OFF',
    titleVi: 'ĐIỀU 10: QUY TRÌNH KIỂM ĐỊNH VÀ NGHIỆM THU BÀN GIAO',
    titleEn: 'ARTICLE 10: ACCEPTANCE TESTING AND FORMAL SIGN-OFF PROTOCOL',
    contentVi: `10.1. Thông báo Bàn giao Sản phẩm:
Khi hoàn thành một đợt bàn giao hoặc mốc tiến độ theo thỏa thuận, Bên Cung Cấp sẽ phát hành thông báo bàn giao chính thức kèm hồ sơ kiểm định AST và hướng dẫn truy cập mã nguồn trên Cổng Doanh nghiệp ALSM.
10.2. Thời hạn Kiểm định của Khách hàng:
Khách hàng có thời hạn 10 (mười) Ngày Làm việc (hoặc số ngày được quy định cụ thể tại Báo giá/Hợp đồng) kể từ ngày nhận thông báo bàn giao để tiến hành kiểm tra, xác thực Sản phẩm Bàn giao theo Tiêu chí Nghiệm thu quy định tại Khoản 10.3.
10.3. Tiêu chí Nghiệm thu:
Sản phẩm Bàn giao được coi là đạt tiêu chuẩn nghiệm thu khi thỏa mãn:
a) Mã nguồn React và Spring Boot biên dịch thành công không phát sinh lỗi nghiêm trọng;
b) Hồ sơ kiểm định AST chứng minh các quy tắc logic nghiệp vụ và phép toán số học đã được bảo toàn chính xác;
c) Giao diện người dùng thể hiện đầy đủ các trường dữ liệu và thuộc tính tương ứng với bản đồ màn hình kế thừa gốc.
10.4. Phân loại Lỗi và Quy trình Khắc phục:
Trường hợp phát hiện sai sót, Khách hàng gửi bằng văn bản bảng thống kê chi tiết các lỗi cần chỉnh sửa:
- Lỗi Nghiêm trọng (Critical Defect): Ngăn cản quá trình biên dịch hoặc làm sai lệch kết quả tính toán số học cốt lõi. Bên Cung Cấp có trách nhiệm khắc phục trong vòng 05–07 Ngày Làm việc.
- Lỗi Nhỏ (Minor Defect): Sai lệch nhỏ về hiển thị hoặc khoảng cách giao diện. Bên Cung Cấp khắc phục trong vòng 03–05 Ngày Làm việc.
Sau khi khắc phục xong, Bên Cung Cấp bàn giao lại để Khách hàng tái kiểm tra trong vòng 05 (năm) Ngày Làm việc.
10.5. Xác nhận Nghiệm thu Chính thức:
Khi Sản phẩm Bàn giao đạt tiêu chuẩn, hai Bên sẽ ký Biên bản Nghiệm thu chính thức bằng văn bản hoặc thực hiện xác nhận điện tử thông qua tính năng Ký Nghiệm thu trên Cổng Doanh nghiệp ALSM. Việc xác nhận nghiệm thu điện tử trên Cổng ALSM là phương thức xác nhận hợp pháp được hai Bên thỏa thuận áp dụng, không làm mất hiệu lực của các hình thức lập biên bản truyền thống nếu có yêu cầu bổ sung.
10.6. Nghiệm thu Mặc nhiên (Deemed Acceptance):
Trường hợp hết Thời hạn Kiểm định mà Khách hàng không gửi văn bản thông báo lỗi cụ thể và cũng không ký biên bản nghiệm thu mà không có lý do chính đáng, hoặc Khách hàng đã đưa Sản phẩm Bàn giao vào vận hành thực tế (production), Sản phẩm Bàn giao đó được coi là đã được Khách hàng nghiệm thu mặc nhiên và đầy đủ.`,
    contentEn: `10.1. Handover Submission Notice:
Upon reaching an agreed delivery milestone, Provider shall dispatch a formal delivery notice accompanied by the AST validation dossier and secure download access on the ALSM Enterprise Portal.
10.2. Customer Inspection Period:
Customer shall have ten (10) Business Days (or specific period defined in the commercial schedule) from delivery notice to conduct technical inspection against the Acceptance Criteria set forth in Section 10.3.
10.3. Objective Acceptance Criteria:
Deliverables shall be deemed acceptable when:
a) React frontend and Spring Boot backend code compile cleanly without critical build failures;
b) AST dossiers demonstrate exact preservation of procedural calculation logic and data mappings;
c) Screen field layouts accurately reflect legacy definitions with active attribute bindings.
10.4. Defect Remediation Cycle:
If Deliverables fail acceptance criteria, Customer shall submit a written itemized punch list:
- Critical Defects: Build blockers or arithmetic computation discrepancies. Provider remediates within five to seven (5–7) Business Days.
- Minor Defects: Stylistic or cosmetic layout adjustments. Provider remediates within three to five (3–5) Business Days.
Following remediation, Customer shall re-inspect within five (5) Business Days.
10.5. Formal Acceptance Execution:
Upon satisfying acceptance criteria, the Parties shall execute a formal Acceptance Certificate in writing or complete mutual electronic sign-off on the ALSM Enterprise Portal. Electronic sign-off on the portal constitutes an agreed legally binding confirmation method without prejudice to physical execution where required.
10.6. Deemed Acceptance:
If the inspection period lapses without Customer delivering an itemized defect notice or signing the certificate, or if Customer deploys the Deliverables into live commercial production, Deliverables shall be deemed accepted in full.`,
    legalReference: 'Bộ luật Dân sự 2015 (Điều 519) / Civil Code of Vietnam (Article 519 on Handover & Acceptance)',
    isMandatory: true,
  },
  {
    articleNumber: 11,
    category: 'WARRANTY_LIABILITY',
    titleVi: 'ĐIỀU 11: CAM KẾT BẢO HÀNH VÀ GIỚI HẠN TRÁCH NHIỆM',
    titleEn: 'ARTICLE 11: WARRANTY AND LIMITATION OF LIABILITY',
    contentVi: `11.1. Phạm vi và Thời hạn Bảo hành:
Bên Cung Cấp bảo hành Sản phẩm Bàn giao trong thời hạn 90 (chín mươi) ngày kể từ ngày ký Biên bản Nghiệm thu chính thức. Trong thời gian bảo hành, Bên Cung Cấp chịu trách nhiệm khắc phục miễn phí các lỗi kỹ thuật phát sinh từ quy trình chuyển đổi cú pháp AST của ALSM.
11.2. Loại trừ Bảo hành:
Bảo hành không áp dụng đối với:
a) Các lỗi phát sinh do Khách hàng hoặc bên thứ ba tự ý sửa đổi, can thiệp vào cấu trúc mã nguồn đã bàn giao;
b) Các lỗi xuất phát từ mã nguồn gốc kế thừa do Khách hàng cung cấp;
c) Các lỗi do môi trường vận hành máy chủ, cơ sở dữ liệu của Khách hàng không đáp ứng đúng cấu hình kỹ thuật khuyến nghị.
11.3. Giới hạn Trách nhiệm Tài chính (Cap on Liability):
Trong mọi trường hợp được pháp luật cho phép, tổng mức bồi thường thiệt hại tối đa của một Bên đối với Bên kia phát sinh từ hoặc liên quan đến Hợp đồng này (cho dù theo hợp đồng hay ngoài hợp đồng) không vượt quá 100% tổng giá trị thực tế mà Khách hàng đã thanh toán cho Bên Cung Cấp theo Hợp đồng này trong vòng 12 (mười hai) tháng liền trước thời điểm phát sinh sự kiện yêu cầu bồi thường.
11.4. Loại trừ Thiệt hại Gián tiếp:
Không Bên nào phải chịu trách nhiệm đối với bất kỳ thiệt hại gián tiếp, thiệt hại do mất cơ hội kinh doanh, giảm sút uy tín thương mại, mất mát doanh thu hoặc lợi nhuận kỳ vọng của Bên kia.
11.5. Ngoại lệ đối với Giới hạn Trách nhiệm:
Giới hạn trách nhiệm tại Khoản 11.3 không áp dụng đối với các trường hợp: vi phạm nghĩa vụ bảo mật thông tin (Điều 9), xâm phạm quyền sở hữu trí tuệ (Điều 8), hoặc hành vi cố ý vi phạm pháp luật.`,
    contentEn: `11.1. Warranty Scope & Period:
Provider warrants synthesized Deliverables for ninety (90) calendar days from formal Acceptance against reproducible syntax and translation bugs originating directly from ALSM conversion engines. Remedial fixes shall be provided without additional cost.
11.2. Warranty Exclusions:
Warranty commitments do not apply to:
a) Alterations or customizations made to Deliverables by Customer or third parties;
b) Underlying defects or illogical procedures inherent in Customer original Source Materials;
c) Environment failures resulting from Customer hosting or database infrastructure not meeting documented requirements.
11.3. Monetary Cap on Liability:
To the maximum extent permitted by applicable law, the aggregate liability of either Party arising out of or related to this Agreement (whether in contract, tort, or otherwise) shall not exceed 100% of the total fees actually disbursed by Customer to Provider under this Agreement during the twelve (12) month period immediately preceding the triggering event.
11.4. Exclusion of Indirect Damages:
Neither Party shall be liable for indirect, consequential, special, or punitive damages, including loss of profits, commercial reputation, or anticipated savings.
11.5. Exceptions to Limitation:
The limitations in Section 11.3 shall not apply to breaches of confidentiality obligations (Article 9), intellectual property infringement (Article 8), or willful misconduct.`,
    legalReference: 'Bộ luật Dân sự 2015 (Điều 360, 444–448) / Civil Code of Vietnam (Articles 360, 444–448)',
    isMandatory: true,
  },
  {
    articleNumber: 12,
    category: 'TERMINATION_SUSPENSION',
    titleVi: 'ĐIỀU 12: THỜI HẠN, TẠM NGỪNG VÀ CHẤM DỨT HỢP ĐỒNG',
    titleEn: 'ARTICLE 12: TERM, SUSPENSION AND TERMINATION',
    contentVi: `12.1. Thời hạn Hợp đồng:
Hợp đồng có hiệu lực kể từ Ngày Có hiệu lực và tiếp tục duy trì hiệu lực cho đến khi các Bên hoàn thành toàn bộ nghĩa vụ công việc và nghĩa vụ tài chính, hoặc cho đến khi bị chấm dứt theo quy định của Hợp đồng này.
12.2. Chấm dứt theo Thỏa thuận Song phương:
Hợp đồng có thể được chấm dứt bất kỳ lúc nào khi có văn bản thỏa thuận đồng thuận giữa hai Bên.
12.3. Chấm dứt do Vi phạm Cơ bản:
Mỗi Bên có quyền đơn phương chấm dứt Hợp đồng nếu Bên kia vi phạm nghiêm trọng bất kỳ điều khoản cốt lõi nào của Hợp đồng mà không khắc phục được trong thời hạn 30 (ba mươi) ngày kể từ ngày nhận được thông báo yêu cầu khắc phục bằng văn bản.
12.4. Quyền Tạm ngừng Dịch vụ:
Bên Cung Cấp có quyền tạm ngừng cung cấp quyền truy cập nền tảng nếu Khách hàng chậm thanh toán quá 15 (mười lăm) Ngày Làm việc hoặc vi phạm nghiêm trọng chính sách an toàn bảo mật.
12.5. Hậu quả của việc Chấm dứt:
Khi Hợp đồng chấm dứt:
a) Khách hàng có nghĩa vụ thanh toán đầy đủ cho Bên Cung Cấp toàn bộ khối lượng công việc và Sản phẩm Bàn giao đã hoàn thành và được nghiệm thu tính đến ngày chấm dứt;
b) Bên Cung Cấp thực hiện bàn giao Sản phẩm Bàn giao tương ứng với phần chi phí Khách hàng đã thanh toán;
c) Các Bên tiến hành đối chiếu công nợ và hoàn trả hoặc tiêu hủy Thông tin Bảo mật theo quy định tại Điều 9;
d) Các điều khoản về Sở hữu Trí tuệ (Điều 8), Bảo mật Thông tin (Điều 9), Giới hạn Trách nhiệm (Điều 11) và Giải quyết Tranh chấp (Điều 14) vẫn tiếp tục có hiệu lực sau khi Hợp đồng chấm dứt.`,
    contentEn: `12.1. Term of Agreement:
This Agreement commences on the Effective Date and remains in full force until all technical milestones and financial obligations are concluded, or until terminated in accordance with this Article.
12.2. Mutual Termination:
This Agreement may be terminated at any time upon bilateral written agreement executed by authorized representatives of both Parties.
12.3. Termination for Material Breach:
Either Party may terminate this Agreement immediately upon written notice if the other Party commits a material breach and fails to cure such breach within thirty (30) calendar days from receipt of detailed written notice.
12.4. Service Suspension Rights:
Provider may suspend platform services if Customer payments remain delinquent beyond fifteen (15) Business Days or in the event of documented security threats.
12.5. Consequences of Termination:
Upon termination:
a) Customer shall settle outstanding amounts for all milestone Deliverables satisfactorily delivered and accepted up to the effective termination date;
b) Provider shall transmit all Deliverables corresponding to settled payments;
c) Both Parties shall sanitize or return Confidential Information pursuant to Article 9;
d) Provisions regarding Intellectual Property (Article 8), Confidentiality (Article 9), Limitation of Liability (Article 11), and Dispute Resolution (Article 14) shall survive termination.`,
    legalReference: 'Bộ luật Dân sự 2015 (Điều 422–428) / Civil Code of Vietnam (Articles 422–428 on Termination)',
    isMandatory: true,
  },
  {
    articleNumber: 13,
    category: 'FORCE_MAJEURE',
    titleVi: 'ĐIỀU 13: TRƯỜNG HỢP BẤT KHẢ KHÁNG (FORCE MAJEURE)',
    titleEn: 'ARTICLE 13: FORCE MAJEURE',
    contentVi: `13.1. Định nghĩa Sự kiện Bất khả kháng:
Sự kiện Bất khả kháng là sự kiện xảy ra một cách khách quan, không thể lường trước được và không thể khắc phục được mặc dù đã áp dụng mọi biện pháp cần thiết và khả năng cho phép, bao gồm nhưng không giới hạn ở: thiên tai, dịch bệnh, hỏa hoạn, lũ lụt, chiến tranh, bạo loạn, sự cố mạng viễn thông quốc gia trên diện rộng, hoặc các quyết định cấm vận, hạn chế của cơ quan Nhà nước có thẩm quyền.
13.2. Nghĩa vụ Thông báo và Giảm thiểu Thiệt hại:
Bên bị ảnh hưởng bởi Sự kiện Bất khả kháng phải thông báo bằng văn bản cho Bên kia trong vòng 07 (bảy) Ngày Làm việc kể từ khi sự kiện xảy ra, nêu rõ tính chất sự kiện, mức độ ảnh hưởng dự kiến và các biện pháp khắc phục đang được áp dụng. Bên bị ảnh hưởng có nghĩa vụ thực hiện mọi nỗ lực hợp lý để giảm thiểu thiệt hại.
13.3. Tạm hoãn Thực hiện Nghĩa vụ:
Nghĩa vụ của Bên bị ảnh hưởng được tạm hoãn thực hiện trong suốt thời gian diễn ra Sự kiện Bất khả kháng và thời gian thực hiện Hợp đồng sẽ được kéo dài tương ứng.
13.4. Quyền Chấm dứt Hợp đồng khi Kéo dài:
Nếu Sự kiện Bất khả kháng tiếp diễn liên tục quá 60 (sáu mươi) ngày mà các Bên không đạt được thỏa thuận giải pháp thay thế, mỗi Bên có quyền chấm dứt Hợp đồng bằng thông báo văn bản trước 15 (mười lăm) Ngày Làm việc mà không phải chịu trách nhiệm bồi thường thiệt hại.`,
    contentEn: `13.1. Definition of Force Majeure:
A "Force Majeure Event" means an extraordinary event beyond the reasonable control of the affected Party that could not have been foreseen or prevented with reasonable diligence, including natural catastrophes, epidemic emergencies, war, civil strife, nationwide telecommunications carrier grid failures, or binding regulatory restrictions.
13.2. Notification & Mitigation Duties:
The affected Party shall provide written notice within seven (7) Business Days of the event inception, detailing its nature, anticipated duration, and remedial actions underway. The affected Party must employ reasonable commercial efforts to mitigate impact.
13.3. Suspension of Performance:
Affected performance deadlines shall be tolled for the duration of the Force Majeure Event, extending project milestones proportionally.
13.4. Extended Impairment Termination:
If a Force Majeure Event persists continuously for more than sixty (60) calendar days, either Party may terminate this Agreement upon fifteen (15) Business Days written notice without incurring compensatory liability.`,
    legalReference: 'Bộ luật Dân sự 2015 (Điều 156, 351) / Civil Code of Vietnam (Articles 156, 351)',
    isMandatory: true,
  },
  {
    articleNumber: 14,
    category: 'GOVERNING_LAW_DISPUTES',
    titleVi: 'ĐIỀU 14: LUẬT ĐIỀU CHỈNH VÀ GIẢI QUYẾT TRANH CHẤP',
    titleEn: 'ARTICLE 14: GOVERNING LAW AND DISPUTE RESOLUTION',
    contentVi: `14.1. Luật Điều chỉnh:
Hợp đồng này được diễn giải, thực hiện và điều chỉnh hoàn toàn theo quy định của pháp luật nước Cộng hòa Xã hội Chủ nghĩa Việt Nam.
14.2. Thương lượng và Hòa giải Thân thiện:
Mọi tranh chấp, bất đồng phát sinh từ hoặc liên quan đến Hợp đồng này trước hết phải được giải quyết thông qua thương lượng hòa giải thiện chí giữa đại diện có thẩm quyền của hai Bên trong thời hạn 30 (ba mươi) ngày kể từ ngày một Bên nhận được văn bản yêu cầu thương lượng của Bên kia.
14.3. Cơ quan Giải quyết Tranh chấp:
Trường hợp hòa giải không thành sau thời hạn nêu trên, tranh chấp sẽ được đưa ra giải quyết tại Tòa án nhân dân có thẩm quyền tại Thành phố Hà Nội (hoặc Trung tâm Trọng tài Quốc tế Việt Nam - VIAC nếu được hai Bên chấp thuận bổ sung thỏa thuận trọng tài bằng văn bản).
14.4. Chi phí Tố tụng:
Án phí và các chi phí pháp lý hợp lý khác sẽ do Bên thua kiện chịu, trừ khi có phán quyết khác của cơ quan xét xử. Trong quá trình giải quyết tranh chấp, các Bên vẫn có nghĩa vụ tiếp tục thực hiện các điều khoản khác của Hợp đồng không liên quan đến vấn đề đang tranh chấp.`,
    contentEn: `14.1. Governing Law:
This Agreement shall be governed by, construed, and enforced in accordance with the substantive laws of the Socialist Republic of Vietnam.
14.2. Amicable Dispute Resolution:
The Parties covenant to endeavor to resolve any controversy or claim arising under this Agreement through good-faith amicable negotiations between authorized executive representatives within thirty (30) calendar days from receipt of formal notice of dispute.
14.3. Adjudication Forum:
If negotiations fail within the prescribed period, the dispute shall be submitted to the exclusive jurisdiction of the competent People's Court in Hanoi, Vietnam (or the Vietnam International Arbitration Centre - VIAC if an arbitration rider is formally executed).
14.4. Litigation Costs:
All court fees and reasonable documented legal expenses shall be borne by the non-prevailing Party, unless decreed otherwise in the final judicial judgment.`,
    legalReference: 'Bộ luật Tố tụng Dân sự 2015 / Civil Procedure Code of Vietnam 2015',
    isMandatory: true,
  },
  {
    articleNumber: 15,
    category: 'GENERAL_PROVISIONS',
    titleVi: 'ĐIỀU 15: ĐIỀU KHOẢN CHUNG VÀ HIỆU LỰC HỢP ĐỒNG',
    titleEn: 'ARTICLE 15: GENERAL PROVISIONS AND EFFECTIVENESS',
    contentVi: `15.1. Tính Toàn vẹn của Thỏa thuận (Entire Agreement):
Hợp đồng này cùng các Phụ lục đính kèm cấu thành toàn bộ thỏa thuận giữa hai Bên liên quan đến đối tượng của Hợp đồng, và thay thế toàn bộ các thỏa thuận, trao đổi, thư điện tử hoặc biên bản ghi nhớ trước đó có cùng nội dung.
15.2. Sửa đổi, Bổ sung:
Mọi sửa đổi, bổ sung Hợp đồng chỉ có giá trị pháp lý khi được lập thành Phụ lục văn bản có chữ ký của đại diện có thẩm quyền của cả hai Bên hoặc được xác nhận điện tử thông qua quy trình sửa đổi chính thức trên Cổng Doanh nghiệp ALSM.
15.3. Tính Độc lập của các Điều khoản (Severability):
Trường hợp bất kỳ điều khoản nào của Hợp đồng này bị cơ quan Nhà nước có thẩm quyền tuyên bố là vô hiệu hoặc không thể thi hành, các điều khoản còn lại vẫn giữ nguyên giá trị pháp lý và hiệu lực thi hành.
15.4. Không Từ bỏ Quyền (No Waiver):
Việc một Bên không thực hiện hoặc chậm trễ thực hiện bất kỳ quyền nào của mình theo Hợp đồng này sẽ không cấu thành việc từ bỏ quyền đó.
15.5. Thông báo Pháp lý (Notices):
Mọi thông báo, yêu cầu hoặc trao đổi chính thức giữa các Bên phải được lập thành văn bản và gửi đến địa chỉ trụ sở hoặc hộp thư điện tử chính thức của người đại diện được nêu tại Phần Thông tin Hợp đồng.
15.6. Hiệu lực của Chữ ký Điện tử:
Các Bên đồng thuận rằng chữ ký điện tử, chữ ký số được ký thông qua nhà cung cấp dịch vụ chứng thực chữ ký số hoặc được xác thực bằng mật mã trên Cổng ALSM có giá trị pháp lý ràng buộc tương đương với chữ ký tay và con dấu vật lý, phù hợp với Luật Giao dịch Điện tử Việt Nam.
15.7. Số lượng Bản và Ngôn ngữ:
Hợp đồng này được lập thành 02 (hai) bản gốc bằng tiếng Việt (hoặc bản song ngữ tiếng Việt - tiếng Anh tương ứng). Trường hợp có sự khác biệt giữa hai bản ngôn ngữ đối với hợp đồng song ngữ, bản tiếng Việt sẽ là căn cứ ưu tiên áp dụng.`,
    contentEn: `15.1. Entire Agreement:
This Agreement, including all schedules and appendices, constitutes the final and entire agreement between the Parties with respect to the subject matter hereof, superseding all prior communications, proposals, and understandings.
15.2. Formal Amendments:
No amendment, waiver, or modification of this Agreement shall be binding unless executed in writing by authorized representatives of both Parties or authenticated via the formal amendment workflow on the ALSM Enterprise Portal.
15.3. Severability:
If any provision of this Agreement is held invalid, illegal, or unenforceable by a court of competent jurisdiction, the validity of the remaining provisions shall remain fully unaffected.
15.4. No Waiver:
Failure or delay by either Party to enforce any right under this Agreement shall not operate as a waiver of that or any subsequent right.
15.5. Official Contractual Notices:
All notices, formal demands, and legal correspondence shall be in writing and delivered to the registered addresses or official notice emails specified in the Contract Recitals.
15.6. Validity of Electronic Execution:
The Parties agree that electronic signatures, digital certificates, and cryptographically verified executions completed via authorized signing channels hold equal legal validity and enforceability as handwritten signatures and physical corporate seals under the Vietnam Law on Electronic Transactions.
15.7. Counterparts & Language:
This Agreement is executed in counterparts in Vietnamese (or bilingual Vietnamese-English). In the event of linguistic discrepancy in bilingual executions, the Vietnamese text shall prevail.`,
    legalReference: 'Luật Giao dịch Điện tử 2023 & Bộ luật Dân sự 2015 / Law on Electronic Transactions & Civil Code',
    isMandatory: true,
  },
];

export const CONTRACT_APPENDICES = [
  {
    id: 'APPENDIX_A',
    titleVi: 'PHỤ LỤC A: ĐẶC TẢ DỊCH VỤ VÀ QUY TRÌNH CHUYỂN ĐỔI KỸ THUẬT',
    titleEn: 'APPENDIX A: SERVICE SPECIFICATIONS AND CONVERSION METHODOLOGY',
    summaryVi: 'Mô tả chi tiết kiến trúc phân tích AST, ánh xạ trường BMS/DSPF và quy chuẩn tổng hợp React 19/Spring Boot 3.',
    summaryEn: 'Detailed specifications of AST ingestion, BMS/DSPF screen bindings, and React 19 / Spring Boot 3 synthesis standards.',
  },
  {
    id: 'APPENDIX_B',
    titleVi: 'PHỤ LỤC B: BẢNG GIÁ CHI TIẾT VÀ TIẾN ĐỘ THANH TOÁN',
    titleEn: 'APPENDIX B: PRICING BREAKDOWN AND MILESTONE PAYMENT SCHEDULE',
    summaryVi: 'Bảng phân bổ chi phí dịch vụ, hạn ngạch màn hình/chương trình, thuế suất GTGT và các mốc thanh toán.',
    summaryEn: 'Comprehensive breakdown of service costs, quotas, VAT configuration, and milestone disbursement gates.',
  },
  {
    id: 'APPENDIX_C',
    titleVi: 'PHỤ LỤC C: CAM KẾT MỨC DỊCH VỤ (SLA) VÀ HỖ TRỢ KỸ THUẬT',
    titleEn: 'APPENDIX C: SERVICE LEVEL AGREEMENT (SLA) & INCIDENT ESCALATION',
    summaryVi: 'Chỉ số thời gian hoạt động hệ thống, bảng phân loại mức độ sự cố và thời gian đáp ứng hỗ trợ chuyên trách.',
    summaryEn: 'Availability metrics, incident priority matrices, and dedicated enterprise engineering escalation pathways.',
  },
  {
    id: 'APPENDIX_D',
    titleVi: 'PHỤ LỤC D: ĐIỀU KHOẢN BẢO VỆ DỮ LIỆU VÀ AN TOÀN THÔNG TIN',
    titleEn: 'APPENDIX D: DATA PROTECTION AND INFORMATION SECURITY SCHEDULE',
    summaryVi: 'Quy chuẩn an toàn dữ liệu, mã hóa lưu trữ AES-256, truyền tải TLS 1.3 và cam kết tuân thủ Nghị định 13/2023/NĐ-CP.',
    summaryEn: 'Data processing safeguards, AES-256 storage encryption, TLS 1.3 transit security, and Decree 13/2023/ND-CP compliance.',
  },
];
