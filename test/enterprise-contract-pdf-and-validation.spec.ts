import { EnterpriseContractValidator } from '../src/modules/crm/domain/enterprise-contract-validation';
import {
  EnterpriseContractPdfService,
  numberToVietnameseWords,
} from '../src/modules/crm/application/enterprise-contract-pdf.service';
import { STANDARD_LEGAL_ARTICLES, CONTRACT_TITLES } from '../src/modules/crm/domain/enterprise-contract-legal.constants';
import { ConfigService } from '@nestjs/config';

describe('EnterpriseContractValidator', () => {
  const validContract = {
    customer: {
      companyName: 'NGÂN HÀNG THƯƠNG MẠI CỔ PHẦN VIỆT NAM THỊNH VƯỢNG',
      taxId: '0102182292',
      businessAddress: 'Số 89 Láng Hạ, Phường Láng Hạ, Quận Đống Đa, TP. Hà Nội, Việt Nam',
      representativeName: 'Nguyễn Đức Vinh',
      representativeTitle: 'Tổng Giám Đốc',
      contactEmail: 'contact@vpbank.com.vn',
      contactPhone: '+84 24 3928 8888',
    },
    commercialTerms: {
      totalValue: 450000000,
      vatRate: 10,
    },
    effectiveDate: '2026-11-01',
    endDate: '2027-10-31',
    scope: {
      screensQuota: 300,
      programsQuota: 150,
      storageGb: 50,
    },
  };

  it('validates a complete, compliant enterprise contract as READY', () => {
    const result = EnterpriseContractValidator.validate(validContract);
    expect(result.isValid).toBe(true);
    expect(result.canIssueOfficialContract).toBe(true);
    expect(result.status).toBe('READY');
    expect(result.errors).toHaveLength(0);
  });

  it('detects username-like representative name and blocks official contract issuance', () => {
    const invalidContract = {
      ...validContract,
      customer: {
        ...validContract.customer,
        representativeName: 'hoangndhde180637',
      },
    };

    const result = EnterpriseContractValidator.validate(invalidContract);
    expect(result.isValid).toBe(false);
    expect(result.canIssueOfficialContract).toBe(false);
    expect(result.status).toBe('NEEDS_INFORMATION');
    expect(result.errors.some((e) => e.code === 'INVALID_REPRESENTATIVE_NAME_USERNAME')).toBe(true);
  });

  it('detects placeholder terms (N/A, Chưa cập nhật) for legal entity fields', () => {
    const invalidContract = {
      ...validContract,
      customer: {
        ...validContract.customer,
        taxId: 'N/A',
        businessAddress: 'Chưa cập nhật',
        representativeTitle: 'undefined',
      },
    };

    const result = EnterpriseContractValidator.validate(invalidContract);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING_TAX_ID')).toBe(true);
    expect(result.errors.some((e) => e.code === 'MISSING_BUSINESS_ADDRESS')).toBe(true);
    expect(result.errors.some((e) => e.code === 'MISSING_REPRESENTATIVE_TITLE')).toBe(true);
  });

  it('rejects invalid or missing financial and date values', () => {
    const invalidContract = {
      ...validContract,
      commercialTerms: {
        totalValue: -500,
        vatRate: 99,
      },
      effectiveDate: 'invalid-date',
      endDate: '2025-01-01', // End date before effective date
    };

    const result = EnterpriseContractValidator.validate(invalidContract);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === 'INVALID_TOTAL_VALUE')).toBe(true);
    expect(result.errors.some((e) => e.code === 'INVALID_VAT_RATE')).toBe(true);
    expect(result.errors.some((e) => e.code === 'INVALID_EFFECTIVE_DATE')).toBe(true);
  });
});

describe('EnterpriseContractPdfService & Vietnamese Number Words', () => {
  let pdfService: EnterpriseContractPdfService;
  let configService: ConfigService;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'CONTRACT_PDF_FONT_PATH') return 'fonts/times.ttf';
        if (key === 'CONTRACT_PDF_FONT_BOLD_PATH') return 'fonts/timesbd.ttf';
        if (key === 'CONTRACT_PDF_FONT_ITALIC_PATH') return 'fonts/timesi.ttf';
        if (key === 'PROVIDER_LEGAL_NAME') return 'CÔNG TY CỔ PHẦN CÔNG NGHỆ ALSM';
        return undefined;
      }),
    } as unknown as ConfigService;
    pdfService = new EnterpriseContractPdfService(configService);
  });

  it('correctly converts numeric amounts into formal Vietnamese words', () => {
    expect(numberToVietnameseWords(0)).toBe('Không đồng');
    expect(numberToVietnameseWords(150000000)).toBe('Một trăm năm mươi triệu đồng chẵn');
    expect(numberToVietnameseWords(1250000)).toBe('Một triệu hai trăm năm mươi nghìn đồng chẵn');
    expect(numberToVietnameseWords(450500000)).toBe('Bốn trăm năm mươi triệu năm trăm nghìn đồng chẵn');
  });

  it('contains all 15 required standard legal articles in Vietnam legal constants', () => {
    expect(STANDARD_LEGAL_ARTICLES).toHaveLength(15);
    const articleNumbers = STANDARD_LEGAL_ARTICLES.map((a) => a.articleNumber);
    expect(articleNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    const categories = STANDARD_LEGAL_ARTICLES.map((a) => a.category);
    expect(categories).toContain('DEFINITIONS');
    expect(categories).toContain('SCOPE_OF_SERVICES');
    expect(categories).toContain('DELIVERABLES_SPECIFICATION');
    expect(categories).toContain('COMMERCIAL_TERMS');
    expect(categories).toContain('SERVICE_LEVEL_AGREEMENT');
    expect(categories).toContain('CUSTOMER_RESPONSIBILITIES');
    expect(categories).toContain('PROVIDER_RESPONSIBILITIES');
    expect(categories).toContain('INTELLECTUAL_PROPERTY');
    expect(categories).toContain('CONFIDENTIALITY');
    expect(categories).toContain('ACCEPTANCE_SIGN_OFF');
    expect(categories).toContain('WARRANTY_LIABILITY');
    expect(categories).toContain('TERMINATION_SUSPENSION');
    expect(categories).toContain('FORCE_MAJEURE');
    expect(categories).toContain('GOVERNING_LAW_DISPUTES');
    expect(categories).toContain('GENERAL_PROVISIONS');
  });

  it('renders a genuine multi-page binary PDF document buffer with PDF header', async () => {
    const sampleContract = {
      contractNumber: 'ALSM-CTR-2026-VPBK',
      version: 'v1.0',
      title: 'HỢP ĐỒNG DỊCH VỤ TỔNG THỂ HIỆN ĐẠI HÓA HỆ THỐNG PHẦN MỀM',
      serviceMode: 'WE_CONVERT_FOR_YOU',
      contractType: 'ENTERPRISE_HYBRID_MSA',
      lifecycleStatus: 'CUSTOMER_SIGNED',
      effectiveDate: '2026-11-01',
      endDate: '2027-10-31',
      customer: {
        companyName: 'NGÂN HÀNG THƯƠNG MẠI CỔ PHẦN VIỆT NAM THỊNH VƯỢNG',
        taxId: '0102182292',
        businessAddress: 'Số 89 Láng Hạ, Phường Láng Hạ, Quận Đống Đa, TP. Hà Nội',
        representativeName: 'Nguyễn Đức Vinh',
        representativeTitle: 'Tổng Giám Đốc',
        contactEmail: 'contact@vpbank.com.vn',
        contactPhone: '+84 24 3928 8888',
      },
      scope: {
        screensQuota: 300,
        programsQuota: 150,
        storageGb: 50,
        targetTechnology: 'React 19 + TypeScript + Spring Boot 3 Java 21',
        sourceCodeType: 'IBM 3270 BMS & COBOL Logic',
        supportTier: 'Enterprise 24/7 Dedicated Support',
      },
      commercialTerms: {
        subtotal: 500000000,
        discountPercent: 10,
        discountAmount: 50000000,
        vatRate: 10,
        vatAmount: 45000000,
        totalValue: 495000000,
        currency: 'VND',
        bankAccountInfo: 'Vietcombank — 1029384756 (CÔNG TY CỔ PHẦN CÔNG NGHỆ ALSM)',
      },
      signingProcess: {
        providerSigningStatus: 'SIGNED',
        customerSigningStatus: 'SIGNED',
        alsmSigner: {
          name: 'Nguyễn Văn Tiến',
          title: 'Tổng Giám Đốc',
          signedAt: '2026-11-01T09:00:00.000Z',
          certificateReference: 'VNPT-ECA-8891-VERIFIED',
        },
        customerSigner: {
          name: 'Nguyễn Đức Vinh',
          title: 'Tổng Giám Đốc',
          signedAt: '2026-11-01T10:15:00.000Z',
          certificateReference: 'VPBANK-CA-2026-AUTHENTIC',
        },
      },
    };

    const pdfBuffer = await pdfService.renderContractPdf({
      contract: sampleContract,
      kind: 'OFFICIAL_SIGNED',
      locale: 'vi',
    });

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(15000);
    // Standard PDF header signature check
    const headerString = pdfBuffer.subarray(0, 5).toString('ascii');
    expect(headerString).toBe('%PDF-');
  });
});
