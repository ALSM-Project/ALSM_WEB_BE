export const MFA_SECURITY = Symbol('MFA_SECURITY');

export interface MfaEnrollmentMaterial {
  encryptedSecret: string;
  otpauthUri: string;
  qrCodeDataUrl: string;
}

export interface BackupCodeMaterial {
  plaintextCodes: string[];
  hashes: string[];
}

export interface MfaSecurityPort {
  createEnrollment(input: {
    issuer: string;
    accountLabel: string;
  }): Promise<MfaEnrollmentMaterial>;
  verifyEncryptedSecret(
    encryptedSecret: string,
    code: string,
  ): Promise<boolean>;
  createBackupCodes(): Promise<BackupCodeMaterial>;
}
