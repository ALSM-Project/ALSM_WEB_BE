import { createHash } from 'node:crypto';
import { ContractFinalEvidenceManifest } from './contract-aggregate.types';

/** Stable integrity digest for manifest metadata; this is not a digital signature. */
export function calculateFinalEvidenceManifestSha256(
  manifest: Omit<ContractFinalEvidenceManifest, 'manifestSha256'>,
): string {
  const artifacts = [manifest.signedPdf, ...(manifest.supportingArtifacts ?? [])]
    .map((artifact) => ({
      kind: artifact.kind,
      storageReference: artifact.storageReference,
      fileName: artifact.fileName,
      mimeType: artifact.mimeType,
      sha256: artifact.sha256,
      byteLength: artifact.byteLength,
      encryption: artifact.encryption,
      encryptionKeyVersion: artifact.encryptionKeyVersion,
      archivedAt: artifact.archivedAt.toISOString(),
    }))
    .sort((left, right) => left.kind.localeCompare(right.kind)
      || left.sha256.localeCompare(right.sha256)
      || left.storageReference.localeCompare(right.storageReference));
  return createHash('sha256').update(JSON.stringify({
    contractVersionId: manifest.contractVersionId,
    canonicalDocumentSha256: manifest.canonicalDocumentSha256,
    providerKey: manifest.providerKey,
    providerEnvelopeReference: manifest.providerEnvelopeReference,
    providerCompletionEventReference: manifest.providerCompletionEventReference,
    providerCompletedAt: manifest.providerCompletedAt.toISOString(),
    archivedAt: manifest.archivedAt.toISOString(),
    artifacts,
  })).digest('hex');
}
