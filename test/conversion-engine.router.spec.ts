import { ConversionEngineRouter } from '../src/modules/conversions/infrastructure/conversion-engine.router';
import { BmsDspfConversionAdapter } from '../src/modules/conversions/infrastructure/bms-dspf-conversion.adapter';
import { CobolJavaConversionAdapter } from '../src/modules/conversions/infrastructure/cobol-java-conversion.adapter';
import { ConversionType } from '../src/modules/projects/domain/project.types';

describe('ConversionEngineRouter', () => {
  const bmsDspfAdapter = { execute: jest.fn() };
  const cobolJavaAdapter = { execute: jest.fn() };
  const router = new ConversionEngineRouter(
    bmsDspfAdapter as unknown as BmsDspfConversionAdapter,
    cobolJavaAdapter as unknown as CobolJavaConversionAdapter,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates BMS_DSPF_TO_FRONTEND jobs to the BMS/DSPF adapter', async () => {
    bmsDspfAdapter.execute.mockResolvedValue({ resultReference: 'ref-1' });
    const input = {
      conversionJobId: 'job-1',
      organizationId: 'org-1',
      projectId: 'p1',
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
    };

    const output = await router.execute(input);

    expect(output).toEqual({ resultReference: 'ref-1' });
    expect(bmsDspfAdapter.execute).toHaveBeenCalledWith(input);
    expect(cobolJavaAdapter.execute).not.toHaveBeenCalled();
  });

  it('delegates COBOL_TO_JAVA jobs to the COBOL/Java adapter', async () => {
    cobolJavaAdapter.execute.mockResolvedValue({ resultReference: 'ref-2' });
    const input = {
      conversionJobId: 'job-2',
      organizationId: 'org-1',
      projectId: 'p1',
      conversionType: ConversionType.COBOL_TO_JAVA,
    };

    const output = await router.execute(input);

    expect(output).toEqual({ resultReference: 'ref-2' });
    expect(cobolJavaAdapter.execute).toHaveBeenCalledWith(input);
    expect(bmsDspfAdapter.execute).not.toHaveBeenCalled();
  });

  it('rejects an unknown conversionType instead of silently picking an adapter', async () => {
    const input = {
      conversionJobId: 'job-3',
      organizationId: 'org-1',
      projectId: 'p1',
      conversionType: 'UNKNOWN' as ConversionType,
    };

    await expect(router.execute(input)).rejects.toThrow(/No conversion adapter configured/);
  });
});
