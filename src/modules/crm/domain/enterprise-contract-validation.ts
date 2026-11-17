/**
 * Enterprise Contract Data Integrity & Legal Validation Engine
 * 
 * Verifies that all statutory and commercial fields are complete,
 * accurate, and compliant before an official contract can be published or signed.
 */

export interface ContractValidationError {
  field: string;
  code: string;
  messageVi: string;
  messageEn: string;
}

export interface ContractValidationResult {
  isValid: boolean;
  canIssueOfficialContract: boolean;
  status: 'READY' | 'NEEDS_INFORMATION' | 'NEEDS_REVIEW';
  errors: ContractValidationError[];
  warnings: ContractValidationError[];
  summaryVi: string;
  summaryEn: string;
}

const USERNAME_LIKE_REGEX = /^[a-z0-9_]{3,25}$/i;
const DIGIT_HEAVY_REGEX = /\d{4,}/;
const PLACEHOLDER_TERMS = ['n/a', 'na', 'none', 'chưa cập nhật', 'đang cập nhật', 'updating', 'placeholder', 'undefined', 'null'];

export class EnterpriseContractValidator {
  static validate(contract: any): ContractValidationResult {
    const errors: ContractValidationError[] = [];
    const warnings: ContractValidationError[] = [];

    // 1. Legal Representative Checks
    const repName = (contract?.customer?.representativeName || contract?.parties?.customer?.signatoryName || '').trim();
    if (!repName) {
      errors.push({
        field: 'customer.representativeName',
        code: 'MISSING_REPRESENTATIVE_NAME',
        messageVi: 'Tên người đại diện pháp luật của Bên Khách hàng không được để trống.',
        messageEn: 'Customer authorized legal representative name is required.',
      });
    } else {
      const lower = repName.toLowerCase();
      if (PLACEHOLDER_TERMS.includes(lower)) {
        errors.push({
          field: 'customer.representativeName',
          code: 'PLACEHOLDER_REPRESENTATIVE_NAME',
          messageVi: 'Tên người đại diện pháp luật không được là giá trị giữ chỗ (placeholder/N/A).',
          messageEn: 'Representative name cannot be a placeholder term.',
        });
      } else if (USERNAME_LIKE_REGEX.test(repName) && (DIGIT_HEAVY_REGEX.test(repName) || !repName.includes(' '))) {
        // Suspected username or system account ID like "hoangndhde180637"
        errors.push({
          field: 'customer.representativeName',
          code: 'INVALID_REPRESENTATIVE_NAME_USERNAME',
          messageVi: `Tên người đại diện ("${repName}") có định dạng tên đăng nhập/tài khoản hệ thống. Phải cung cấp họ tên pháp lý đầy đủ.`,
          messageEn: `Representative name ("${repName}") resembles a system username or user ID. Legal full name is required.`,
        });
      } else if (repName.length < 3) {
        errors.push({
          field: 'customer.representativeName',
          code: 'REPRESENTATIVE_NAME_TOO_SHORT',
          messageVi: 'Họ tên người đại diện pháp luật quá ngắn (tối thiểu 3 ký tự).',
          messageEn: 'Representative name is too short (minimum 3 characters).',
        });
      }
    }

    const repTitle = (contract?.customer?.representativeTitle || contract?.parties?.customer?.signatoryTitle || '').trim();
    if (!repTitle || PLACEHOLDER_TERMS.includes(repTitle.toLowerCase())) {
      errors.push({
        field: 'customer.representativeTitle',
        code: 'MISSING_REPRESENTATIVE_TITLE',
        messageVi: 'Chức danh người đại diện (ví dụ: Tổng Giám Đốc, Giám Đốc, Đại diện theo ủy quyền) không được để trống.',
        messageEn: 'Customer representative title (e.g. General Director, Authorized Representative) is required.',
      });
    }

    // 2. Customer Legal Entity & Tax ID
    const companyName = (contract?.customer?.companyName || contract?.organizationName || '').trim();
    if (!companyName || PLACEHOLDER_TERMS.includes(companyName.toLowerCase())) {
      errors.push({
        field: 'customer.companyName',
        code: 'MISSING_COMPANY_NAME',
        messageVi: 'Tên pháp nhân đầy đủ của Khách hàng theo Đăng ký kinh doanh là bắt buộc.',
        messageEn: 'Full registered legal entity name of Customer is required.',
      });
    }

    const taxId = (contract?.customer?.taxId || contract?.parties?.customer?.taxId || '').trim();
    if (!taxId || PLACEHOLDER_TERMS.includes(taxId.toLowerCase())) {
      errors.push({
        field: 'customer.taxId',
        code: 'MISSING_TAX_ID',
        messageVi: 'Mã số thuế doanh nghiệp (Tax ID / Enterprise Code) của Khách hàng là bắt buộc.',
        messageEn: 'Customer Tax Identification Number (TIN / Enterprise Code) is required.',
      });
    } else if (!/^[0-9A-Z-]{8,20}$/i.test(taxId)) {
      errors.push({
        field: 'customer.taxId',
        code: 'INVALID_TAX_ID_FORMAT',
        messageVi: 'Mã số thuế không đúng định dạng chuẩn (8–20 ký tự số hoặc chữ hoa).',
        messageEn: 'Customer Tax ID format is invalid (expected 8-20 alphanumeric characters).',
      });
    }

    // 3. Registered Address
    const address = (contract?.customer?.businessAddress || contract?.parties?.customer?.businessAddress || '').trim();
    if (!address || PLACEHOLDER_TERMS.includes(address.toLowerCase()) || address.length < 10) {
      errors.push({
        field: 'customer.businessAddress',
        code: 'MISSING_BUSINESS_ADDRESS',
        messageVi: 'Địa chỉ trụ sở đăng ký kinh doanh chính thức của Khách hàng là bắt buộc (tối thiểu 10 ký tự).',
        messageEn: 'Customer official registered business address is required (minimum 10 characters).',
      });
    }

    // 4. Contact Email
    const email = (contract?.customer?.contactEmail || contract?.parties?.customer?.contactEmail || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({
        field: 'customer.contactEmail',
        code: 'INVALID_CONTACT_EMAIL',
        messageVi: 'Email chính thức nhận hợp đồng và ký số không hợp lệ.',
        messageEn: 'Official contractual notice email is invalid or missing.',
      });
    }

    // 5. Commercial Terms & Pricing
    const totalValue = contract?.totalValue ?? contract?.commercialTerms?.totalValue;
    if (typeof totalValue !== 'number' || totalValue <= 0 || isNaN(totalValue)) {
      errors.push({
        field: 'commercialTerms.totalValue',
        code: 'INVALID_TOTAL_VALUE',
        messageVi: 'Tổng giá trị hợp đồng phải là một số dương hợp lệ.',
        messageEn: 'Total contract value must be a positive number.',
      });
    }

    const vatRate = contract?.commercialTerms?.vatRate;
    if (vatRate === undefined || vatRate === null || typeof vatRate !== 'number' || vatRate < 0 || vatRate > 50) {
      errors.push({
        field: 'commercialTerms.vatRate',
        code: 'INVALID_VAT_RATE',
        messageVi: 'Thuế suất GTGT phải được cấu hình chính xác theo quy định (từ 0% đến 50%).',
        messageEn: 'VAT rate must be explicitly configured between 0% and 50%.',
      });
    }

    // 6. Dates
    const effDate = contract?.effectiveDate;
    if (!effDate || !/^\d{4}-\d{2}-\d{2}/.test(effDate) || isNaN(new Date(effDate).getTime())) {
      errors.push({
        field: 'effectiveDate',
        code: 'INVALID_EFFECTIVE_DATE',
        messageVi: 'Ngày có hiệu lực của hợp đồng không hợp lệ.',
        messageEn: 'Contract effective date is invalid.',
      });
    }

    const endDate = contract?.endDate;
    if (endDate && !isNaN(new Date(endDate).getTime()) && effDate && !isNaN(new Date(effDate).getTime())) {
      if (new Date(endDate) <= new Date(effDate)) {
        errors.push({
          field: 'endDate',
          code: 'END_DATE_BEFORE_EFFECTIVE_DATE',
          messageVi: 'Ngày kết thúc hợp đồng phải sau ngày có hiệu lực.',
          messageEn: 'Contract end date must be after effective date.',
        });
      }
    }

    // 7. Scope
    const screensQuota = contract?.scope?.screensQuota ?? contract?.maxScreens;
    if (typeof screensQuota !== 'number' || screensQuota <= 0) {
      warnings.push({
        field: 'scope.screensQuota',
        code: 'ZERO_SCREENS_QUOTA',
        messageVi: 'Hạn ngạch số lượng màn hình chuyển đổi chưa được thiết lập.',
        messageEn: 'Screen capacity quota is not established.',
      });
    }

    // Determine final status
    const isValid = errors.length === 0;
    const canIssueOfficialContract = isValid;
    let status: 'READY' | 'NEEDS_INFORMATION' | 'NEEDS_REVIEW' = 'READY';

    if (!isValid) {
      const hasMissingInfo = errors.some((e) =>
        [
          'MISSING_REPRESENTATIVE_NAME',
          'PLACEHOLDER_REPRESENTATIVE_NAME',
          'INVALID_REPRESENTATIVE_NAME_USERNAME',
          'MISSING_REPRESENTATIVE_TITLE',
          'MISSING_COMPANY_NAME',
          'MISSING_TAX_ID',
          'MISSING_BUSINESS_ADDRESS',
          'INVALID_CONTACT_EMAIL',
        ].includes(e.code),
      );
      status = hasMissingInfo ? 'NEEDS_INFORMATION' : 'NEEDS_REVIEW';
    }

    return {
      isValid,
      canIssueOfficialContract,
      status,
      errors,
      warnings,
      summaryVi: isValid
        ? 'Dữ liệu pháp nhân và thương mại đầy đủ, hợp lệ để phát hành hợp đồng chính thức.'
        : `Còn ${errors.length} lỗi thông tin pháp lý cần hoàn thiện trước khi phát hành hợp đồng chính thức.`,
      summaryEn: isValid
        ? 'Contract data is complete and validated for official legal issuance.'
        : `${errors.length} legal data validation error(s) must be rectified before official contract issuance.`,
    };
  }
}
