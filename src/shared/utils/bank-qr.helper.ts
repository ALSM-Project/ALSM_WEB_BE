import * as QRCode from 'qrcode';

export interface BankQrOptions {
  bankBin: string;
  accountNumber: string;
  accountName?: string;
  amount?: number;
  message?: string;
}

function crc16(str: string): string {
  let crc = 0xffff;
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Builds an EMVCo-compliant payment payload (ISO/IEC 7816 / EMVCo Merchant-Presented Mode)
 * without any VietQR/Napas gateway wrapping or branding.
 */
export function generateEmvcoQrPayload(options: BankQrOptions): string {
  const pad = (id: string, val: string) => `${id}${val.length.toString().padStart(2, '0')}${val}`;
  const sub00 = pad('00', options.bankBin || '970422');
  const sub01 = pad('01', options.accountNumber || '0899886249');
  const tag01 = pad('01', sub00 + sub01);
  const tag00 = pad('00', 'A000000727');
  const tag02 = pad('02', 'QRIBFTTA');
  const tag38 = pad('38', tag00 + tag01 + tag02);

  let payload =
    pad('00', '01') +
    pad('01', options.amount && options.amount > 0 ? '12' : '11') +
    tag38 +
    pad('53', '704');

  if (options.amount && options.amount > 0) {
    payload += pad('54', Math.round(options.amount).toString());
  }

  payload += pad('58', 'VN');

  if (options.message) {
    payload += pad('62', pad('08', options.message.slice(0, 50)));
  }

  const rawWithoutCrc = payload + '6304';
  const crc = crc16(rawWithoutCrc);
  return rawWithoutCrc + crc;
}

/**
 * Generates a pure, clean QR code Data URL (Base64 PNG) containing only the QR matrix,
 * completely free from third-party gateway frames, VietQR logos, or Napas branding.
 */
export async function generateCleanBankQrDataUrl(options: BankQrOptions): Promise<string> {
  const payload = generateEmvcoQrPayload(options);
  return QRCode.toDataURL(payload, {
    width: 320,
    margin: 2,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
    errorCorrectionLevel: 'M',
  });
}
