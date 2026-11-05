import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SalesCrmService } from '../src/modules/crm/application/sales-crm.service';

describe('UC-68 sales reports', () => {
  const organizationId = new Types.ObjectId().toString();
  let leadModel: { find: jest.Mock };
  let service: SalesCrmService;

  beforeEach(() => {
    leadModel = { find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) };
    service = new SalesCrmService(
      leadModel as never,
      {} as never,
      { append: jest.fn() } as never,
      { listForSalesMember: jest.fn().mockResolvedValue([]) } as never,
    );
  });

  it('scopes report data to the authorized organization and selected period', async () => {
    await service.getSalesReports(organizationId, '30D');

    const [filter] = leadModel.find.mock.calls[0];
    expect(String(filter.organizationId)).toBe(organizationId);
    expect(filter.createdAt.$gte).toBeInstanceOf(Date);
    expect(filter.createdAt.$gte.getTime()).toBeGreaterThan(Date.now() - 31 * 24 * 60 * 60 * 1000);
  });

  it('rejects malformed organization identifiers before reading data', async () => {
    await expect(service.getSalesReports('not-an-object-id', 'ALL')).rejects.toBeInstanceOf(BadRequestException);
    expect(leadModel.find).not.toHaveBeenCalled();
  });

  it('exports only rows in the same organization and reporting period', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ exec });
    leadModel.find.mockReturnValue({ sort });

    await service.exportSalesReportsCsv(organizationId, 'YTD');

    const [filter] = leadModel.find.mock.calls[0];
    expect(String(filter.organizationId)).toBe(organizationId);
    expect(filter.createdAt.$gte).toEqual(new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)));
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
  });
});
