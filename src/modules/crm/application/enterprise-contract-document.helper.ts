/**
 * Enterprise Contract Document Helper
 * 
 * Single Source of Truth for generating standardized, court-admissible
 * B2B Commercial Contracts formatted like professional Microsoft Word documents.
 * 
 * Rules:
 * - NO dashboard tables, cards, UI badges, or nested tables.
 * - Unified paragraph and numbered clause structure: ĐIỀU X, X.1, X.2, a), b).
 * - Standardized formal Vietnamese legal vocabulary throughout.
 */

export interface FormattedPartyInfo {
  roleHeader: string;
  legalName: string;
  taxId: string;
  address: string;
  representativeName: string;
  representativeTitle: string;
  phone: string;
  email: string;
  bankAccount?: string;
}

export interface FormattedClauseItem {
  clauseNumber: string;
  text: string;
  subItems?: Array<{ key: string; text: string }>;
}

export interface FormattedArticle {
  articleNumber: number;
  title: string;
  items: FormattedClauseItem[];
}

export interface FormattedDocumentData {
  nationalHeader: {
    country: string;
    motto: string;
    divider: string;
  };
  contractTitle: string;
  contractNumber: string;
  version: string;
  effectiveDate: {
    day: number;
    month: number;
    year: number;
    dateStr: string;
  };
  endDateStr: string;
  preamble: string[];
  partyA: FormattedPartyInfo;
  partyB: FormattedPartyInfo;
  articles: FormattedArticle[];
  signatures: {
    partyA: {
      title: string;
      roleTitle: string;
      signerTitle: string;
      signerName: string;
      isSigned: boolean;
      signedAt?: string;
      certificateReference?: string;
      signatureImage?: string;
      officialSealImage?: string;
      certificateProvider?: string;
      stampPosition?: string;
    };
    partyB: {
      title: string;
      roleTitle: string;
      signerTitle: string;
      signerName: string;
      isSigned: boolean;
      signedAt?: string;
      certificateReference?: string;
      signatureImage?: string;
    };
  };
}

/** Converts integer VND amount to formal Vietnamese words */
export function numberToVietnameseWords(amount: number): string {
  if (!amount || isNaN(amount) || amount === 0) return 'Không đồng';
  const digits = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const units = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];

  let num = Math.floor(Math.abs(amount));
  let str = '';
  let unitIndex = 0;

  while (num > 0) {
    const chunk = num % 1000;
    if (chunk > 0) {
      const chunkStr = renderThreeDigits(chunk, num > 999, digits);
      str = `${chunkStr} ${units[unitIndex]} ${str}`.trim();
    }
    num = Math.floor(num / 1000);
    unitIndex++;
  }

  const result = str.trim();
  return result.charAt(0).toUpperCase() + result.slice(1) + ' đồng chẵn';
}

function renderThreeDigits(n: number, hasHigher: boolean, digits: string[]): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  let res = '';

  if (h > 0 || hasHigher) {
    res += `${digits[h]} trăm `;
  }

  if (t === 0 && u > 0) {
    res += hasHigher || h > 0 ? 'lẻ ' : '';
    res += digits[u];
  } else if (t === 1) {
    res += 'mười ';
    if (u === 1) res += 'một';
    else if (u === 5) res += 'lăm';
    else if (u > 0) res += digits[u];
  } else if (t > 1) {
    res += `${digits[t]} mươi `;
    if (u === 1) res += 'mốt';
    else if (u === 5) res += 'lăm';
    else if (u > 0) res += digits[u];
  }

  return res.trim();
}

/** Formats currency amount as Vietnamese locale string */
export function formatCurrencyVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(amount || 0));
}

/**
 * Builds the canonical document structure from a raw contract object
 */
export function buildContractDocumentData(contract: any, config?: any): FormattedDocumentData {
  const contractNumber = contract?.contractNumber || 'ALSM-CTR-2026-DRAFT';
  const version = contract?.version || 'v1.0';

  // Dates
  const effDateObj = new Date(contract?.effectiveDate || Date.now());
  const day = effDateObj.getDate();
  const month = effDateObj.getMonth() + 1;
  const year = effDateObj.getFullYear();
  const endDateStr = contract?.endDate
    ? new Date(contract.endDate).toLocaleDateString('vi-VN')
    : `ngày ${day} tháng ${month} năm ${year + 1}`;

  // Title
  let contractTitle = contract?.title;
  if (!contractTitle || contractTitle.includes('Draft') || contractTitle.startsWith('ALSM-')) {
    contractTitle = 'HỢP ĐỒNG DỊCH VỤ HIỆN ĐẠI HÓA HỆ THỐNG PHẦN MỀM';
  }

  // Parties info
  const providerLegalName =
    config?.PROVIDER_LEGAL_NAME ||
    contract?.parties?.provider?.legalName ||
    'CÔNG TY CỔ PHẦN CÔNG NGHỆ HIỆN ĐẠI HÓA PHẦN MỀM ALSM';
  const providerTaxId =
    config?.PROVIDER_TAX_ID ||
    contract?.parties?.provider?.taxId ||
    '0110892345';
  const providerAddress =
    config?.PROVIDER_REGISTERED_ADDRESS ||
    contract?.parties?.provider?.headquarters ||
    'Hòa Xuân, Cẩm Lệ, TP. Đà Nẵng, Việt Nam';
  const providerRepName =
    config?.PROVIDER_REPRESENTATIVE_NAME ||
    contract?.parties?.provider?.signatoryName ||
    'Nguyễn Gia Khánh';
  const providerRepTitle =
    config?.PROVIDER_REPRESENTATIVE_TITLE ||
    contract?.parties?.provider?.signatoryTitle ||
    'Tổng Giám Đốc';
  const providerPhone =
    config?.PROVIDER_CONTACT_PHONE ||
    contract?.parties?.provider?.contactPhone ||
    '0819734122';
  const providerEmail =
    config?.PROVIDER_CONTACT_EMAIL ||
    contract?.parties?.provider?.contactEmail ||
    'contracts@alsm.io';
  const providerBankAccount =
    contract?.commercialTerms?.bankAccountInfo ||
    '0899886249 mở tại Ngân hàng TMCP Quân Đội (MB Bank) - Chi nhánh Đà Nẵng';

  const customerLegalName = (
    contract?.customer?.companyName ||
    contract?.organizationName ||
    contract?.parties?.customer?.legalName ||
    'DOANH NGHIỆP ĐỐI TÁC'
  ).trim();
  const customerTaxId = (
    contract?.customer?.taxId ||
    contract?.parties?.customer?.taxId ||
    'Chưa cập nhật'
  ).trim();
  const customerAddress = (
    contract?.customer?.businessAddress ||
    contract?.parties?.customer?.businessAddress ||
    'Trụ sở chính doanh nghiệp'
  ).trim();
  const customerRepName = (
    contract?.customer?.representativeName ||
    contract?.parties?.customer?.signatoryName ||
    'Đại diện có thẩm quyền'
  ).trim();
  const customerRepTitle = (
    contract?.customer?.representativeTitle ||
    contract?.parties?.customer?.signatoryTitle ||
    'Đại diện theo pháp luật'
  ).trim();
  const customerPhone = (
    contract?.customer?.contactPhone ||
    contract?.parties?.customer?.contactPhone ||
    'Chưa cập nhật'
  ).trim();
  const customerEmail = (
    contract?.customer?.contactEmail ||
    contract?.parties?.customer?.contactEmail ||
    'partner@enterprise.io'
  ).trim();

  // Scope parameters
  const screensQuota = contract?.scope?.screensQuota ?? contract?.screensQuota ?? 100;
  const programsQuota = contract?.scope?.programsQuota ?? contract?.programsQuota ?? 50;
  const storageGb = contract?.scope?.storageGb ?? contract?.storageGb ?? 20;
  const rawServiceMode = (contract?.serviceMode || 'HYBRID').toUpperCase();
  let serviceModeVi = 'Hiện đại hóa và chuyển đổi kiến trúc hệ thống trọn gói';
  if (rawServiceMode.includes('SELF')) {
    serviceModeVi = 'Nền tảng hiện đại hóa kiến trúc tự động (Platform-Based Modernization)';
  } else if (rawServiceMode.includes('CONVERT') || rawServiceMode.includes('MANAGED')) {
    serviceModeVi = 'Dịch vụ hiện đại hóa và chuyển đổi hệ thống trọn gói (Managed Modernization Services)';
  }

  const rawSla = contract?.scope?.supportTier || contract?.plan || 'Enterprise Dedicated SLA';
  let slaTierVi = 'Hỗ trợ kỹ thuật chuyên trách doanh nghiệp, cam kết độ sẵn sàng 99.9%';
  if (rawSla.toLowerCase().includes('standard')) {
    slaTierVi = 'Hỗ trợ kỹ thuật tiêu chuẩn doanh nghiệp';
  }

  const sourceTechVi = contract?.scope?.sourceCodeType || 'Màn hình IBM 3270 BMS / AS400 DSPF và chương trình xử lý nghiệp vụ COBOL';
  const targetTechVi = contract?.scope?.targetTechnology || 'Giao diện React 19, TypeScript và dịch vụ nghiệp vụ Spring Boot 3 Java 21';

  // Financial calculations
  const subtotal = contract?.commercialTerms?.subtotal || Math.round((contract?.totalValue || 0) / 1.1);
  const discountAmount = contract?.commercialTerms?.discountAmount || 0;
  const discountPercent = contract?.commercialTerms?.discountPercent || 0;
  const taxableAmount = subtotal - discountAmount;
  const vatRate = contract?.commercialTerms?.vatRate !== undefined ? contract.commercialTerms.vatRate : 10;
  const vatAmount = contract?.commercialTerms?.vatAmount !== undefined
    ? contract.commercialTerms.vatAmount
    : Math.round(taxableAmount * (vatRate / 100));
  const finalTotal = contract?.commercialTerms?.totalValue || (taxableAmount + vatAmount) || contract?.totalValue || 0;
  const currency = contract?.commercialTerms?.currency || contract?.currency || 'VND';
  const wordsVnd = numberToVietnameseWords(finalTotal);

  // Signing resolution
  const isAlsmSigned =
    contract?.signingStatus?.alsm ||
    contract?.signingProcess?.providerSigningStatus === 'SIGNED' ||
    contract?.lifecycleStatus === 'COMPLETED' ||
    Boolean(contract?.signingProcess?.alsmSigner);

  const isCustomerSigned =
    contract?.signingStatus?.customer ||
    contract?.signingProcess?.customerSigningStatus === 'SIGNED' ||
    contract?.lifecycleStatus === 'COMPLETED' ||
    Boolean(contract?.signingProcess?.customerSigner);

  const alsmSigner = contract?.signingProcess?.alsmSigner || {
    name: providerRepName,
    title: providerRepTitle,
    signedAt: contract?.signedDate || contract?.signingProcess?.signedAt || new Date().toISOString(),
    certificateReference: contract?.parties?.provider?.certificateSerialNumber || 'VNPT-ECA-ALSM-01',
    certificateProvider: contract?.parties?.provider?.digitalCertificateProvider || 'VNPT-CA',
    signatureImageUrl: contract?.parties?.provider?.signatureImageUrl || contract?.parties?.provider?.signatureImage,
    companySealUrl: contract?.parties?.provider?.companySealUrl || contract?.parties?.provider?.officialSealImage,
    stampPosition: contract?.parties?.provider?.stampPosition || 'side_by_side',
  };

  const customerSigner = contract?.signingProcess?.customerSigner || {
    name: customerRepName,
    title: customerRepTitle,
    signedAt: contract?.signedDate || contract?.signingProcess?.signedAt || new Date().toISOString(),
    certificateReference: 'VNPT-ECA-CLIENT-VERIFIED',
  };

  // Structured Articles (ĐIỀU 1 đến ĐIỀU 10)
  const articles: FormattedArticle[] = [
    {
      articleNumber: 1,
      title: 'ĐIỀU 1. PHẠM VI DỊCH VỤ VÀ THÔNG SỐ CÔNG NGHỆ',
      items: [
        {
          clauseNumber: '1.1',
          text: `Bên A đồng ý cung cấp và Bên B đồng ý tiếp nhận dịch vụ hiện đại hóa hệ thống phần mềm theo phương thức ${serviceModeVi}, áp dụng công nghệ phân tích cú pháp AST và tái cấu trúc hệ thống của Bên A.`,
        },
        {
          clauseNumber: '1.2',
          text: 'Phạm vi cung cấp dịch vụ và định mức tài nguyên được xác lập chi tiết như sau:',
          subItems: [
            { key: 'a)', text: `Số lượng màn hình được cấp phép chuyển đổi: ${screensQuota.toLocaleString('vi-VN')} màn hình.` },
            { key: 'b)', text: `Số lượng chương trình nghiệp vụ được cấp phép xử lý: ${programsQuota.toLocaleString('vi-VN')} chương trình.` },
            { key: 'c)', text: `Dung lượng lưu trữ đám mây chuyên dụng: ${storageGb} GB.` },
            { key: 'd)', text: `Cấp dịch vụ và cam kết hỗ trợ kỹ thuật: ${slaTierVi}.` },
            { key: 'e)', text: `Công nghệ nguồn tiếp nhận: ${sourceTechVi}.` },
            { key: 'f)', text: `Công nghệ đích chuyển đổi bàn giao: ${targetTechVi}.` },
          ],
        },
        {
          clauseNumber: '1.3',
          text: 'Các thông số nêu trên là căn cứ pháp lý và kỹ thuật duy nhất để xác định phạm vi trách nhiệm cung cấp dịch vụ của Bên A. Mọi khối lượng phát sinh ngoài phạm vi nêu trên sẽ được hai Bên thỏa thuận lập phụ lục hợp đồng bổ sung.',
        },
      ],
    },
    {
      articleNumber: 2,
      title: 'ĐIỀU 2. TIÊU CHUẨN KỸ THUẬT VÀ SẢN PHẨM BÀN GIAO',
      items: [
        {
          clauseNumber: '2.1',
          text: 'Sản phẩm bàn giao của dịch vụ hiện đại hóa bao gồm toàn bộ mã nguồn giao diện người dùng, mã nguồn dịch vụ xử lý nghiệp vụ backend, tài liệu kiến trúc kỹ thuật và báo cáo đối soát logic.',
        },
        {
          clauseNumber: '2.2',
          text: 'Tiêu chuẩn kỹ thuật của sản phẩm bàn giao bao gồm:',
          subItems: [
            { key: 'a)', text: 'Mã nguồn giao diện người dùng: Tái cấu trúc thành các thành phần độc lập (React 19, TypeScript), bảo toàn đầy đủ 100% thuộc tính hiển thị, trường dữ liệu và ràng buộc nhập liệu từ màn hình nguồn.' },
            { key: 'b)', text: 'Mã nguồn xử lý nghiệp vụ backend: Chuyển đổi sang kiến trúc dịch vụ chuẩn mực (Spring Boot 3 Java 21), bảo toàn ngữ nghĩa xử lý, các phép tính toán số học và quy tắc nghiệp vụ kế thừa.' },
            { key: 'c)', text: 'Hồ sơ thẩm định AST: Báo cáo đối soát ngữ pháp và cú pháp chi tiết từng module, xác nhận tính tương đương logic giữa hệ thống nguồn và hệ thống đích.' },
            { key: 'd)', text: 'Bộ tài liệu kỹ thuật và hướng dẫn vận hành: Cung cấp sơ đồ kiến trúc, tài liệu mô tả API và hướng dẫn đóng gói triển khai hoàn chỉnh.' },
          ],
        },
        {
          clauseNumber: '2.3',
          text: 'Hai Bên tiến hành bàn giao và nghiệm thu sản phẩm dịch vụ trực tuyến thông qua hệ thống cổng thông tin của Bên A hoặc theo từng giai đoạn được hai Bên thống nhất.',
        },
      ],
    },
    {
      articleNumber: 3,
      title: 'ĐIỀU 3. GIÁ TRỊ HỢP ĐỒNG VÀ PHƯƠNG THỨC THANH TOÁN',
      items: [
        {
          clauseNumber: '3.1',
          text: `Giá trị dịch vụ trước thuế: ${formatCurrencyVnd(subtotal)} ${currency}.`,
        },
        ...(discountAmount > 0
          ? [
              {
                clauseNumber: '3.2',
                text: `Chiết khấu thương mại doanh nghiệp (${discountPercent > 0 ? discountPercent + '%' : 'ưu đãi'}): -${formatCurrencyVnd(discountAmount)} ${currency}.`,
              },
              {
                clauseNumber: '3.3',
                text: `Giá trị tính thuế Giá trị gia tăng: ${formatCurrencyVnd(taxableAmount)} ${currency}.`,
              },
            ]
          : []),
        {
          clauseNumber: discountAmount > 0 ? '3.4' : '3.2',
          text: `Thuế Giá trị gia tăng (GTGT ${vatRate}%): ${formatCurrencyVnd(vatAmount)} ${currency}.`,
        },
        {
          clauseNumber: discountAmount > 0 ? '3.5' : '3.3',
          text: `Tổng số tiền thanh toán đã bao gồm thuế: ${formatCurrencyVnd(finalTotal)} ${currency} (Bằng chữ: ${wordsVnd}).`,
        },
        {
          clauseNumber: discountAmount > 0 ? '3.6' : '3.4',
          text: 'Đồng tiền thanh toán: Đồng Việt Nam (VND).',
        },
        {
          clauseNumber: discountAmount > 0 ? '3.7' : '3.5',
          text: `Phương thức thanh toán: Bên B thanh toán cho Bên A bằng phương thức chuyển khoản ngân hàng qua quét mã QR hoặc chuyển khoản trực tiếp vào tài khoản ngân hàng của Bên A số ${providerBankAccount}.`,
        },
        {
          clauseNumber: discountAmount > 0 ? '3.8' : '3.6',
          text: 'Thời hạn thanh toán: Trong vòng bảy mươi hai (72) giờ làm việc kể từ thời điểm Hợp đồng được ký kết đầy đủ bởi hai Bên, Bên B thực hiện thanh toán 100% giá trị hợp đồng để Bên A kích hoạt quyền truy cập dịch vụ và cấp phát hạn ngạch chuyển đổi. Bên A có trách nhiệm phát hành hóa đơn điện tử hợp pháp cho Bên B theo đúng quy định pháp luật sau khi nhận đủ tiền thanh toán.',
        },
      ],
    },
    {
      articleNumber: 4,
      title: 'ĐIỀU 4. THỜI HẠN VÀ TIẾN ĐỘ THỰC HIỆN',
      items: [
        {
          clauseNumber: '4.1',
          text: `Hợp đồng này có hiệu lực kể từ ngày đại diện có thẩm quyền của hai Bên hoàn tất việc ký kết điện tử và duy trì hiệu lực trong thời hạn mười hai (12) tháng, dự kiến kết thúc vào ${endDateStr}.`,
        },
        {
          clauseNumber: '4.2',
          text: 'Thời hạn duy trì tài khoản truy cập và lưu trữ dữ liệu dự án trên nền tảng ALSM được tính đồng bộ theo thời hạn hiệu lực của Hợp đồng.',
        },
        {
          clauseNumber: '4.3',
          text: 'Trước khi hết hạn ít nhất ba mươi (30) ngày, nếu Bên B có nhu cầu gia hạn thời gian sử dụng hoặc mở rộng hạn ngạch chuyển đổi, hai Bên sẽ tiến hành đàm phán và ký kết Phụ lục hợp đồng theo chính sách thương mại hiện hành.',
        },
      ],
    },
    {
      articleNumber: 5,
      title: 'ĐIỀU 5. CAM KẾT MỨC ĐỘ DỊCH VỤ (SLA) VÀ HỖ TRỢ KỸ THUẬT',
      items: [
        {
          clauseNumber: '5.1',
          text: 'Bên A cam kết duy trì độ sẵn sàng hoạt động của nền tảng chuyển đổi đạt tối thiểu 99.9% thời gian trong suốt thời hạn hợp đồng, không bao gồm các khoảng thời gian bảo trì định kỳ đã được thông báo trước ít nhất 48 giờ.',
        },
        {
          clauseNumber: '5.2',
          text: 'Bên A cung cấp dịch vụ hỗ trợ kỹ thuật trực tuyến để tiếp nhận và giải quyết các vướng mắc kỹ thuật từ Bên B liên quan đến quy trình phân tích cú pháp, ánh xạ màn hình và biên dịch mã nguồn.',
        },
        {
          clauseNumber: '5.3',
          text: 'Thời gian phản hồi sự cố kỹ thuật tối đa không quá 02 giờ làm việc đối với các sự cố mức độ nghiêm trọng gây gián đoạn quy trình chuyển đổi, và không quá 08 giờ làm việc đối với các yêu cầu kỹ thuật thông thường.',
        },
      ],
    },
    {
      articleNumber: 6,
      title: 'ĐIỀU 6. QUYỀN VÀ NGHĨA VỤ CỦA BÊN A',
      items: [
        {
          clauseNumber: '6.1',
          text: 'Cung cấp dịch vụ đúng chất lượng, đúng tiến độ và đầy đủ hạn ngạch đã cam kết tại Điều 1 và Điều 2 của Hợp đồng này.',
        },
        {
          clauseNumber: '6.2',
          text: 'Đảm bảo tính chính xác và bảo toàn logic của mã nguồn chuyển đổi thông qua công nghệ đối soát AST độc quyền.',
        },
        {
          clauseNumber: '6.3',
          text: 'Bảo mật tuyệt đối toàn bộ mã nguồn nguồn, dữ liệu nghiệp vụ và thông tin do Bên B cung cấp theo quy định tại Điều 8 của Hợp đồng.',
        },
        {
          clauseNumber: '6.4',
          text: 'Xuất hóa đơn tài chính hợp pháp, hợp lệ và gửi cho Bên B sau khi nhận được đầy đủ thanh toán theo quy định.',
        },
        {
          clauseNumber: '6.5',
          text: 'Có quyền tạm ngừng hoặc chấm dứt quyền truy cập dịch vụ nếu Bên B vi phạm nghĩa vụ thanh toán hoặc vi phạm các quy định về an toàn thông tin và sở hữu trí tuệ.',
        },
      ],
    },
    {
      articleNumber: 7,
      title: 'ĐIỀU 7. QUYỀN VÀ NGHĨA VỤ CỦA BÊN B',
      items: [
        {
          clauseNumber: '7.1',
          text: 'Được quyền sử dụng đầy đủ hạn ngạch chuyển đổi và các tính năng của nền tảng tương ứng với gói dịch vụ đã đăng ký.',
        },
        {
          clauseNumber: '7.2',
          text: 'Cung cấp đầy đủ, kịp thời và chính xác mã nguồn đầu vào, tài liệu định nghĩa dữ liệu (copybooks) và quy tắc nghiệp vụ cần thiết để thực hiện dịch vụ.',
        },
        {
          clauseNumber: '7.3',
          text: 'Cam kết mã nguồn đầu vào thuộc quyền sở hữu hoặc quyền sử dụng hợp pháp của Bên B, không vi phạm quyền sở hữu trí tuệ của bất kỳ bên thứ ba nào.',
        },
        {
          clauseNumber: '7.4',
          text: 'Thanh toán đầy đủ và đúng hạn cho Bên A toàn bộ giá trị hợp đồng theo quy định tại Điều 3.',
        },
        {
          clauseNumber: '7.5',
          text: 'Không được sao chép, dịch ngược, phân tích cấu trúc mã nguồn, can thiệp trái phép hoặc chuyển giao quyền sử dụng nền tảng ALSM cho bất kỳ bên thứ ba nào khi chưa có sự đồng ý bằng văn bản của Bên A.',
        },
      ],
    },
    {
      articleNumber: 8,
      title: 'ĐIỀU 8. BẢO MẬT THÔNG TIN VÀ BẢO VỆ DỮ LIỆU',
      items: [
        {
          clauseNumber: '8.1',
          text: 'Hai Bên cam kết giữ bí mật tuyệt đối mọi thông tin kỹ thuật, mã nguồn, thuật toán nghiệp vụ, tài liệu tài chính và bí mật kinh doanh của Bên kia nhận được trong quá trình đàm phán, xác lập và thực hiện Hợp đồng.',
        },
        {
          clauseNumber: '8.2',
          text: 'Bên A cam kết áp dụng các tiêu chuẩn an toàn thông tin cao nhất (mã hóa đường truyền TLS 1.3, mã hóa lưu trữ AES-256) và không lưu giữ, sao chép hoặc thương mại hóa bất kỳ dữ liệu nhạy cảm nào của Bên B ngoài phạm vi phục vụ dịch vụ.',
        },
        {
          clauseNumber: '8.3',
          text: 'Hai Bên cam kết tuân thủ nghiêm ngặt các quy định pháp luật về bảo vệ dữ liệu cá nhân theo Nghị định số 13/2023/NĐ-CP của Chính phủ.',
        },
        {
          clauseNumber: '8.4',
          text: 'Nghĩa vụ bảo mật thông tin có hiệu lực xuyên suốt thời hạn hợp đồng và tiếp tục duy trì vô thời hạn sau khi Hợp đồng này chấm dứt hoặc thanh lý.',
        },
      ],
    },
    {
      articleNumber: 9,
      title: 'ĐIỀU 9. QUYỀN SỞ HỮU TRÍ TUỆ',
      items: [
        {
          clauseNumber: '9.1',
          text: 'Bên B sở hữu toàn bộ quyền sở hữu trí tuệ đối với mã nguồn đầu vào của hệ thống kế thừa và toàn bộ mã nguồn hiện đại hóa được xuất sinh từ hệ thống của Bên B sau khi hoàn tất nghĩa vụ thanh toán.',
        },
        {
          clauseNumber: '9.2',
          text: 'Bên A sở hữu độc quyền toàn bộ quyền tác giả, sáng chế và bí mật công nghệ đối với nền tảng ALSM Studio, các bộ phân tích cú pháp AST, thuật toán sinh mã và các công cụ bổ trợ.',
        },
      ],
    },
    {
      articleNumber: 10,
      title: 'ĐIỀU 10. CHẤM DỨT HỢP ĐỒNG VÀ ĐIỀU KHOẢN CHUNG',
      items: [
        {
          clauseNumber: '10.1',
          text: 'Hợp đồng này chấm dứt khi: (a) Hai Bên hoàn tất toàn bộ nghĩa vụ và thống nhất thanh lý hợp đồng; (b) Hết thời hạn quy định tại Điều 4 mà hai Bên không gia hạn; (c) Một Bên vi phạm nghiêm trọng nghĩa vụ hợp đồng và không khắc phục trong vòng ba mươi (30) ngày kể từ khi nhận văn bản thông báo của Bên kia.',
        },
        {
          clauseNumber: '10.2',
          text: 'Hợp đồng này được diễn giải, thực hiện và điều chỉnh hoàn toàn theo pháp luật nước Cộng hòa Xã hội Chủ nghĩa Việt Nam. Mọi tranh chấp phát sinh sẽ được giải quyết trước hết thông qua thương lượng hòa giải; nếu không đạt được thỏa thuận, tranh chấp sẽ được đưa ra giải quyết tại Tòa án nhân dân có thẩm quyền tại Việt Nam.',
        },
        {
          clauseNumber: '10.3',
          text: 'Hợp đồng này được xác lập dưới hình thức thông điệp dữ liệu điện tử có giá trị pháp lý đầy đủ theo quy định của Luật Giao dịch điện tử số 20/2023/QH15. Chữ ký số và con dấu điện tử được hai Bên khởi tạo có giá trị chứng cứ pháp lý ràng buộc trách nhiệm của các Bên như hợp đồng ký tay và đóng dấu truyền thống.',
        },
      ],
    },
  ];

  return {
    nationalHeader: {
      country: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
      motto: 'Độc lập - Tự do - Hạnh phúc',
      divider: '-----------------',
    },
    contractTitle,
    contractNumber,
    version,
    effectiveDate: {
      day,
      month,
      year,
      dateStr: `ngày ${day} tháng ${month} năm ${year}`,
    },
    endDateStr,
    preamble: [
      'Căn cứ Bộ luật Dân sự số 91/2015/QH13 được Quốc hội nước Cộng hòa Xã hội Chủ nghĩa Việt Nam thông qua ngày 24 tháng 11 năm 2015;',
      'Căn cứ Luật Thương mại số 36/2005/QH11 được Quốc hội nước Cộng hòa Xã hội Chủ nghĩa Việt Nam thông qua ngày 14 tháng 06 năm 2005;',
      'Căn cứ Luật Giao dịch điện tử số 20/2023/QH15 được Quốc hội nước Cộng hòa Xã hội Chủ nghĩa Việt Nam thông qua ngày 22 tháng 06 năm 2023;',
      'Căn cứ Luật An toàn thông tin mạng số 86/2015/QH13 và Nghị định số 13/2023/NĐ-CP về Bảo vệ Dữ liệu Cá nhân;',
      'Căn cứ vào nhu cầu hiện đại hóa hệ thống phần mềm của Bên B và năng lực cung cấp giải pháp công nghệ của Bên A.',
    ],
    partyA: {
      roleHeader: 'BÊN A: BÊN CUNG CẤP DỊCH VỤ',
      legalName: providerLegalName,
      taxId: providerTaxId,
      address: providerAddress,
      representativeName: providerRepName,
      representativeTitle: providerRepTitle,
      phone: providerPhone,
      email: providerEmail,
      bankAccount: providerBankAccount,
    },
    partyB: {
      roleHeader: 'BÊN B: BÊN KHÁCH HÀNG',
      legalName: customerLegalName,
      taxId: customerTaxId,
      address: customerAddress,
      representativeName: customerRepName,
      representativeTitle: customerRepTitle,
      phone: customerPhone,
      email: customerEmail,
    },
    articles,
    signatures: {
      partyA: {
        title: 'ĐẠI DIỆN BÊN A',
        roleTitle: 'BÊN CUNG CẤP DỊCH VỤ',
        signerTitle: alsmSigner.title || providerRepTitle,
        signerName: alsmSigner.name || providerRepName,
        isSigned: isAlsmSigned,
        signedAt: alsmSigner.signedAt,
        certificateReference: alsmSigner.certificateReference || 'VNPT-ECA-ALSM-01',
        certificateProvider: alsmSigner.certificateProvider || contract?.parties?.provider?.digitalCertificateProvider || 'VNPT-CA',
        signatureImage: contract?.parties?.provider?.signatureImageUrl || contract?.parties?.provider?.signatureImage || contract?.signingProcess?.alsmSignatureImage || alsmSigner.signatureImageUrl,
        officialSealImage: contract?.parties?.provider?.companySealUrl || contract?.parties?.provider?.officialSealImage || contract?.signingProcess?.alsmOfficialSealImage || alsmSigner.companySealUrl,
        stampPosition: contract?.parties?.provider?.stampPosition || alsmSigner.stampPosition || 'side_by_side',
      },
      partyB: {
        title: 'ĐẠI DIỆN BÊN B',
        roleTitle: 'BÊN KHÁCH HÀNG',
        signerTitle: customerRepTitle,
        signerName: customerSigner.name || customerRepName,
        isSigned: isCustomerSigned,
        signedAt: customerSigner.signedAt,
        certificateReference: customerSigner.certificateReference,
        signatureImage: contract?.customer?.signatureImage || contract?.signingProcess?.customerSignatureImage,
      },
    },
  };
}
