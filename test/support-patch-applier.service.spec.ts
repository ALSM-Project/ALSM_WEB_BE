import {
  SUPPORT_PATCH_REPORT_FILE,
  SupportPatchApplier,
} from '../src/modules/conversions/application/support-patch-applier.service';
import { ConversionType } from '../src/modules/projects/domain/project.types';

const INPUT = {
  conversionJobId: 'job-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  screenId: 'scr-1',
  conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
};
const SCREEN_TSX = "type formOutput = {\n  acsttus?: any;\n}\nconst x = <span>{receivedData.acsttus ?? ''}</span>;\n";
const OTHER_TSX = "type formOutput = {\n  acsttus?: any;\n}\n";

function files() {
  return [
    { relativePath: 'COACTVW.tsx', content: Buffer.from(SCREEN_TSX) },
    { relativePath: 'COACTUP.tsx', content: Buffer.from(OTHER_TSX) },
    { relativePath: 'bmsRoutes.tsx', content: Buffer.from('routes') },
  ];
}

describe('SupportPatchApplier', () => {
  const patches = { listByJob: jest.fn() };
  const screens = { findById: jest.fn() };
  const applier = new SupportPatchApplier(patches as never, screens as never);

  beforeEach(() => {
    jest.clearAllMocks();
    screens.findById.mockResolvedValue({ id: 'scr-1', name: 'COACTVW.bms' });
    patches.listByJob.mockResolvedValue([
      {
        id: 'patch-2',
        rules: [
          { sourceField: 'ACSTTUS', targetProperty: 'accountStatus', dataType: 'string' },
          { sourceField: 'NOSUCH', targetProperty: 'x', dataType: 'string' },
        ],
      },
    ]);
  });

  it("patches only the job's own screen and adds a report of what was applied", async () => {
    const out = await applier.applyToScreenOutput(INPUT, files());

    const byName = new Map(out.map((f) => [f.relativePath, f.content.toString('utf8')]));
    expect(byName.get('COACTVW.tsx')).toContain('accountStatus?: string;');
    expect(byName.get('COACTUP.tsx')).toBe(OTHER_TSX);
    expect(byName.get('bmsRoutes.tsx')).toBe('routes');
    const report = JSON.parse(byName.get(SUPPORT_PATCH_REPORT_FILE) ?? '{}');
    expect(report).toMatchObject({
      patchId: 'patch-2',
      screen: 'COACTVW.bms',
      file: 'COACTVW.tsx',
      applied: ['ACSTTUS -> accountStatus: string'],
      skipped: [{ sourceField: 'NOSUCH', reason: 'The field does not exist on this screen' }],
    });
    expect(patches.listByJob).toHaveBeenCalledWith('job-1', 'org-1');
  });

  it('leaves the output untouched when the job has no patch', async () => {
    patches.listByJob.mockResolvedValue([]);
    const original = files();
    expect(await applier.applyToScreenOutput(INPUT, original)).toBe(original);
  });

  it("reports every rule as skipped when the screen's component is missing", async () => {
    screens.findById.mockResolvedValue({ id: 'scr-1', name: 'MISSING.bms' });
    const out = await applier.applyToScreenOutput(INPUT, files());

    const report = JSON.parse(out.find((f) => f.relativePath === SUPPORT_PATCH_REPORT_FILE)!.content.toString());
    expect(report.applied).toEqual([]);
    expect(report.skipped).toHaveLength(2);
    expect(out.find((f) => f.relativePath === 'COACTVW.tsx')!.content.toString()).toBe(SCREEN_TSX);
  });
});
