/**
 * VNPT eContract API V2.0.0 request & response types.
 *
 * Mapped according to VNPT eContract developer integration documentation.
 * Sensitive fields (credentials, tokens, personal identification) must never be logged.
 */

export interface VnptCreateContractRequest {
  tenHopDong: string;
  soHopDong: string;
  ngayKy?: string;
  ngayHieuLuc?: string;
  ngayHetHan?: string;
  ghiChu?: string;
  hinhThucKy?: number;
  danhSachFileId?: number[];
}

export interface VnptCreateContractResponse {
  message?: string;
  status?: string;
  statusCode?: number;
  object?: {
    hopDongId?: number;
    soHopDong?: string;
    trangThai?: number;
  };
}

export interface VnptSignerConfigRequest {
  hopDongId: number;
  nguoiKy: Array<{
    stt: number;
    hoVaTen: string;
    email: string;
    soDienThoai?: string;
    loaiNguoiKy?: number; // 1: Cá nhân, 2: Doanh nghiệp
    hinhThucKy?: number;  // 1: OTP SMS, 2: OTP Email, 3: SmartCA, 4: USB Token
    thuTuKy?: number;
    viTriKy?: Array<{
      fileId: number;
      page: number;
      x: number;
      y: number;
      width?: number;
      height?: number;
    }>;
  }>;
}

export interface VnptContractDetailResponse {
  message?: string;
  status?: string;
  statusCode?: number;
  object?: {
    hopDongId?: number;
    tenHopDong?: string;
    soHopDong?: string;
    trangThai?: number; // 0: Nháp, 1: Chờ ký, 2: Đang ký, 3: Đã ký hoàn tất, 4: Từ chối, 5: Hủy, 6: Hết hạn
    ngayTao?: string;
    ngayHoanThanh?: string;
    danhSachFile?: Array<{
      fileId: number;
      tenFile: string;
      loaiFile?: number;
      trangThaiFile?: number;
    }>;
    danhSachNguoiKy?: Array<{
      nguoiKyId?: number;
      hoVaTen: string;
      email: string;
      soDienThoai?: string;
      trangThaiKy: number; // 0: Chưa ký, 1: Đã ký, 2: Từ chối ký
      thoiGianKy?: string;
    }>;
  };
}

export interface VnptCancelContractRequest {
  hopDongId: number;
  lyDoHuy: string;
}

export interface VnptGeneralResponse {
  message?: string;
  status?: string;
  statusCode?: number;
}

