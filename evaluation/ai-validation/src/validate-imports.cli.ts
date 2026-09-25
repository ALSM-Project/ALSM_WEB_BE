import { existsSync } from 'fs';
import { join } from 'path';
import { parseNamedArguments, readJson } from './evaluation.io';
import {
  validateImportedCandidateManifest,
  validateImportedReviewManifest,
} from './external-import.validator';

function main(): void {
  const args = parseNamedArguments(process.argv.slice(2), new Set(['candidates', 'reviews']));
  const candidatePath = args.get('candidates');
  const reviewPath = args.get('reviews');
  const paths = candidatePath
    ? [{ candidates: candidatePath, reviews: reviewPath }]
    : ['cobol-javatrans', 'aws-carddemo'].map((source) => ({
        candidates: join('evaluation', 'ai-validation', 'imports', source, 'candidates.json'),
        reviews: join('evaluation', 'ai-validation', 'imports', source, 'review-template.json'),
      }));
  const results = paths.map((pathsForSource) => {
    if (!existsSync(pathsForSource.candidates)) {
      throw new Error(`Candidate manifest not found: ${pathsForSource.candidates}`);
    }
    const candidates = validateImportedCandidateManifest(readJson(pathsForSource.candidates));
    const reviews = pathsForSource.reviews
      ? validateImportedReviewManifest(readJson(pathsForSource.reviews), candidates)
      : undefined;
    return {
      sourceDataset: candidates.sourceDataset,
      licenseStatus: candidates.licenseStatus,
      candidates: candidates.candidateCount,
      reviewEntries: reviews?.reviews.length ?? 0,
      pendingReviews:
        reviews?.reviews.filter((review) => review.reviewStatus === 'PENDING').length ?? 0,
      scorableCandidates: candidates.candidates.filter((candidate) => candidate.scorable).length,
    };
  });
  process.stdout.write(`${JSON.stringify({ valid: true, imports: results }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Import validation failed'}\n`);
  process.exitCode = 1;
}
