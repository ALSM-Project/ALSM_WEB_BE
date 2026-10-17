/* eslint-disable */
// Temporary one-off verification script - NOT part of the repo, deleted after use.
import * as fs from 'fs';
import * as path from 'path';
import { ExportCodeService } from './src/modules/conversions/application/export-code.service';
import { ConversionJobStatus } from './src/modules/conversions/domain/conversion-job.types';
import type { ExportConfiguration } from './src/modules/conversions/domain/export.types';

const SCREENS_DIR =
  'C:\\Users\\ADMIN\\AppData\\Local\\Temp\\claude\\d--ALSM\\28ae00cf-b957-4173-b1c8-e010ec273b2a\\scratchpad\\real-screens';
const OUT_DIR = path.join(__dirname, '..', 'scratch-generated-app');

async function main() {
  const screenFiles = fs.readdirSync(SCREENS_DIR).filter((f) => f.endsWith('.tsx'));
  const screenIds = screenFiles.map((f) => f.replace(/\.tsx$/, ''));
  console.log('Screens:', screenIds);

  const jobs = {
    listByScreen: async (_projectId: string, screenId: string) => [
      {
        id: `job-${screenId}`,
        status: ConversionJobStatus.COMPLETED,
        resultReference: `results/proj/job-${screenId}`,
        completedAt: new Date('2026-01-01'),
        toolVersion: 'convert2fe',
      },
    ],
  };
  const storage = {
    readFiles: async (resultReference: string) => {
      const screenId = resultReference.replace('results/proj/job-', '');
      const content = fs.readFileSync(path.join(SCREENS_DIR, `${screenId}.tsx`));
      return [{ relativePath: `${screenId}.tsx`, content }];
    },
  };
  const organizationContext = { resolve: async () => ({ id: 'org-1' }) };
  const projects = { getForOrganization: async () => ({ id: 'proj-1' }) };

  const service = new ExportCodeService(jobs as any, storage as any, organizationContext as any, projects as any);

  const config: ExportConfiguration = {
    projectId: 'proj-1',
    projectName: 'CardDemo Verification',
    outputOption: 'scaffold',
    frameworkTarget: 'react-19',
    stylingOption: 'tailwind',
    includeTypeScriptStrict: true,
    includeUnitTests: true,
    includeStorybook: false,
    includeDocumentation: true,
    selectedScreenIds: screenIds,
  };

  const { buffer } = await service.generateZipBuffer('user-1', undefined, 'proj-1', config);
  console.log(`Generated zip: ${buffer.length} bytes`);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);

  if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const entries = Object.values(zip.files) as any[];
  for (const entry of entries) {
    if (entry.dir) continue;
    // generateZipBuffer() already adds tree[0].children directly at the zip root (no
    // wrapper folder to strip) - use entry.name exactly as-is.
    const dest = path.join(OUT_DIR, entry.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const content = await entry.async('nodebuffer');
    fs.writeFileSync(dest, content);
  }

  console.log('Wrote generated project to', OUT_DIR);
  console.log('Top-level files:', fs.readdirSync(OUT_DIR).join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
