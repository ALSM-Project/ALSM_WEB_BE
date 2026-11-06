import { PdfSignatureVerifier } from '../src/modules/crm/domain/pdf-signature-verifier';

describe('PdfSignatureVerifier', () => {
  it('rejects buffers that are too small or not a PDF', () => {
    const invalid = Buffer.from('not a pdf');
    const result = PdfSignatureVerifier.verify(invalid);
    expect(result.isSigned).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('PDF_TOO_SHORT_OR_INVALID');
  });

  it('rejects buffers missing %PDF- header', () => {
    const invalid = Buffer.alloc(50, 0);
    const result = PdfSignatureVerifier.verify(invalid);
    expect(result.isSigned).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('MISSING_PDF_HEADER');
  });

  it('detects unsigned standard PDF', () => {
    const unsignedPdf = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n%%EOF',
    );
    const result = PdfSignatureVerifier.verify(unsignedPdf);
    expect(result.isSigned).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('NO_SIGNATURE_BYTE_RANGE_FOUND');
  });

  it('validates a properly structured PDF with digital signature dictionary and extracts signers', () => {
    const part1BeforeByteRange = '%PDF-1.7\n1 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Name (Nguyen Van A) /Reason (Approved Contract) /M (D:20261106120000Z) ';
    const gap = '<< /Contents <308201...00> >>\nendobj\n';
    const part2 = '%%EOF\n';

    const placeholder = '/ByteRange [ 0000000000 0000000000 0000000000 0000000000 ]\n';
    const totalPart1Len = Buffer.byteLength(part1BeforeByteRange) + Buffer.byteLength(placeholder);
    const gapLen = Buffer.byteLength(gap);
    const part2Len = Buffer.byteLength(part2);

    const offset1 = 0;
    const length1 = totalPart1Len;
    const offset2 = totalPart1Len + gapLen;
    const length2 = part2Len;

    const actualRange = `/ByteRange [ ${String(offset1).padStart(10, '0')} ${String(length1).padStart(10, '0')} ${String(offset2).padStart(10, '0')} ${String(length2).padStart(10, '0')} ]\n`;
    expect(Buffer.byteLength(actualRange)).toBe(Buffer.byteLength(placeholder));

    const part1 = Buffer.from(part1BeforeByteRange + actualRange);
    const fullPdf = Buffer.concat([part1, Buffer.from(gap), Buffer.from(part2)]);

    const result = PdfSignatureVerifier.verify(fullPdf);
    expect(result.isSigned).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.signatureCount).toBe(1);
    expect(result.signers[0].name).toBe('Nguyen Van A');
    expect(result.signers[0].reason).toBe('Approved Contract');
    expect(result.signers[0].subFilter).toBe('adbe.pkcs7.detached');
    expect(result.signers[0].signedAt).toBeInstanceOf(Date);
    expect(result.signedContentSha256).toBeDefined();
    expect(result.issues).toHaveLength(0);
  });

  it('flags byte range bounds exceeding file size as invalid', () => {
    const fakePdf = Buffer.from(
      '%PDF-1.7\n<< /Type /Sig /ByteRange [0 50 100 500] /Contents <aabb>> >>\n%%EOF',
    );
    const result = PdfSignatureVerifier.verify(fakePdf);
    expect(result.isSigned).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('SIGNATURE_1_BYTE_RANGE_EXCEEDS_FILE_LENGTH');
  });
});
