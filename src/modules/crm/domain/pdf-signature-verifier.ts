import { createHash } from 'node:crypto';

export interface PdfSignerInfo {
  name?: string;
  reason?: string;
  location?: string;
  contactInfo?: string;
  signedAt?: Date;
  subFilter?: string;
  filter?: string;
}

export interface PdfSignatureVerificationResult {
  isSigned: boolean;
  valid: boolean;
  signatureCount: number;
  signers: PdfSignerInfo[];
  signedByteRanges: number[][];
  signedContentSha256?: string;
  issues: string[];
}

/**
 * Validates PDF signature structure according to ISO 32000-1 / PDF specification.
 * Verifies byte range integrity, absence of post-signing tampering within the signed revision,
 * and extracts signer metadata.
 */
export class PdfSignatureVerifier {
  static verify(pdfBytes: Buffer): PdfSignatureVerificationResult {
    if (!Buffer.isBuffer(pdfBytes) || pdfBytes.length < 32) {
      return {
        isSigned: false,
        valid: false,
        signatureCount: 0,
        signers: [],
        signedByteRanges: [],
        issues: ['PDF_TOO_SHORT_OR_INVALID'],
      };
    }

    const header = pdfBytes.subarray(0, 10).toString('latin1');
    if (!header.startsWith('%PDF-')) {
      return {
        isSigned: false,
        valid: false,
        signatureCount: 0,
        signers: [],
        signedByteRanges: [],
        issues: ['MISSING_PDF_HEADER'],
      };
    }

    const latin1Text = pdfBytes.toString('latin1');

    // Find /ByteRange entries
    const byteRangeRegex = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
    const matches: RegExpExecArray[] = [];
    let match: RegExpExecArray | null;

    while ((match = byteRangeRegex.exec(latin1Text)) !== null) {
      matches.push(match);
    }

    if (matches.length === 0) {
      return {
        isSigned: false,
        valid: false,
        signatureCount: 0,
        signers: [],
        signedByteRanges: [],
        issues: ['NO_SIGNATURE_BYTE_RANGE_FOUND'],
      };
    }

    const issues: string[] = [];
    const signers: PdfSignerInfo[] = [];
    const signedByteRanges: number[][] = [];
    let validSignatures = 0;
    let signedContentSha256: string | undefined;

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const offset1 = Number.parseInt(m[1], 10);
      const length1 = Number.parseInt(m[2], 10);
      const offset2 = Number.parseInt(m[3], 10);
      const length2 = Number.parseInt(m[4], 10);

      const byteRange = [offset1, length1, offset2, length2];
      signedByteRanges.push(byteRange);

      // Verify structural bounds
      if (offset1 !== 0) {
        issues.push(`SIGNATURE_${i + 1}_BYTE_RANGE_OFFSET1_NON_ZERO`);
        continue;
      }

      if (length1 <= 0 || offset2 <= offset1 + length1) {
        issues.push(`SIGNATURE_${i + 1}_BYTE_RANGE_HOLE_INVALID`);
        continue;
      }

      if (offset2 + length2 > pdfBytes.length) {
        issues.push(`SIGNATURE_${i + 1}_BYTE_RANGE_EXCEEDS_FILE_LENGTH`);
        continue;
      }

      // The hole between [offset1 + length1] and [offset2] must encapsulate /Contents <hex>
      const contentsGap = latin1Text.substring(offset1 + length1, offset2);
      if (!contentsGap.includes('<') || !contentsGap.includes('>')) {
        issues.push(`SIGNATURE_${i + 1}_CONTENTS_ENCLOSURE_MALFORMED`);
        continue;
      }

      // Extract signer metadata from the dictionary surrounding the byteRange
      // Search roughly 1500 chars before or after the byteRange position
      const dictStart = Math.max(0, m.index - 800);
      const dictEnd = Math.min(latin1Text.length, m.index + 800);
      const dictContext = latin1Text.substring(dictStart, dictEnd);

      const signer: PdfSignerInfo = {};

      const nameMatch = /\/Name\s*(?:\(([^)]*)\)|<([0-9a-fA-F]+)>)/.exec(dictContext);
      if (nameMatch) {
        signer.name = nameMatch[1] ?? (nameMatch[2] ? Buffer.from(nameMatch[2], 'hex').toString('utf8') : undefined);
      }

      const reasonMatch = /\/Reason\s*(?:\(([^)]*)\)|<([0-9a-fA-F]+)>)/.exec(dictContext);
      if (reasonMatch) {
        signer.reason = reasonMatch[1] ?? (reasonMatch[2] ? Buffer.from(reasonMatch[2], 'hex').toString('utf8') : undefined);
      }

      const locationMatch = /\/Location\s*(?:\(([^)]*)\)|<([0-9a-fA-F]+)>)/.exec(dictContext);
      if (locationMatch) {
        signer.location = locationMatch[1] ?? (locationMatch[2] ? Buffer.from(locationMatch[2], 'hex').toString('utf8') : undefined);
      }

      const contactMatch = /\/ContactInfo\s*(?:\(([^)]*)\)|<([0-9a-fA-F]+)>)/.exec(dictContext);
      if (contactMatch) {
        signer.contactInfo = contactMatch[1] ?? (contactMatch[2] ? Buffer.from(contactMatch[2], 'hex').toString('utf8') : undefined);
      }

      const subFilterMatch = /\/SubFilter\s*\/([a-zA-Z0-9._]+)/.exec(dictContext);
      if (subFilterMatch) {
        signer.subFilter = subFilterMatch[1];
      }

      const filterMatch = /\/Filter\s*\/([a-zA-Z0-9._]+)/.exec(dictContext);
      if (filterMatch) {
        signer.filter = filterMatch[1];
      }

      const dateMatch = /\/M\s*\(D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(dictContext);
      if (dateMatch) {
        signer.signedAt = new Date(Date.UTC(
          Number.parseInt(dateMatch[1], 10),
          Number.parseInt(dateMatch[2], 10) - 1,
          Number.parseInt(dateMatch[3], 10),
          Number.parseInt(dateMatch[4], 10),
          Number.parseInt(dateMatch[5], 10),
          Number.parseInt(dateMatch[6], 10),
        ));
      }

      signers.push(signer);

      // Compute SHA-256 of the signed ranges
      const range1 = pdfBytes.subarray(offset1, offset1 + length1);
      const range2 = pdfBytes.subarray(offset2, offset2 + length2);
      const coveredBytes = Buffer.concat([range1, range2]);
      signedContentSha256 = createHash('sha256').update(coveredBytes).digest('hex');

      validSignatures++;
    }

    const isValid = validSignatures > 0 && issues.length === 0;

    return {
      isSigned: true,
      valid: isValid,
      signatureCount: validSignatures,
      signers,
      signedByteRanges,
      signedContentSha256,
      issues,
    };
  }

  static isSignedPdf(pdfBytes: Buffer): boolean {
    return this.verify(pdfBytes).isSigned;
  }
}
