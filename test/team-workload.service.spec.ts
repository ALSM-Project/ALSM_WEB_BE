import { ConflictException, ForbiddenException } from '@nestjs/common';
import { GetTeamWorkloadService } from '../src/modules/teams/application/get-team-workload.service';
import { TeamAccessService } from '../src/modules/teams/application/team-access.service';
import { TeamJobAssignmentRepository } from '../src/modules/teams/domain/team-job-assignment.types';
import { ConversionWorkloadPort } from '../src/modules/conversions/domain/conversion-workload.port';
import { ConversionJobStatus } from '../src/modules/conversions/domain/conversion-job.types';
import { ProjectRepository } from '../src/modules/projects/domain/project.types';
import { UserRepository } from '../src/modules/users/domain/user.repository';

function setup() {
  const team = {
    id: 'team',
    name: 'Conversion',
    kind: 'CONVERSION',
    revision: 1,
    memberIds: ['one', 'two'],
    projectAssignments: [{ projectId: 'project', memberIds: ['one', 'two'] }],
  };
  const access = {
    managed: jest.fn().mockResolvedValue({
      team,
      organization: { id: 'org', members: [{ userId: 'one' }, { userId: 'two' }] },
    }),
  };
  const records = ['a', 'b', 'c', 'd'].map((jobId, index) => ({
    id: jobId,
    jobId,
    projectId: 'project',
    memberId: index < 2 ? 'one' : 'two',
  }));
  const assignments = { listActive: jest.fn().mockResolvedValue(records) };
  const jobs = {
    listAssignedJobs: jest.fn().mockResolvedValue([
      { id: 'a', status: ConversionJobStatus.QUEUED },
      { id: 'b', status: ConversionJobStatus.PROCESSING },
      { id: 'c', status: ConversionJobStatus.COMPLETED },
      { id: 'd', status: ConversionJobStatus.FAILED },
      { id: 'c', status: ConversionJobStatus.COMPLETED },
      { id: 'not-assigned', status: ConversionJobStatus.COMPLETED },
    ]),
  };
  const projects = {
    findById: jest.fn().mockResolvedValue({ id: 'project', organizationId: 'org' }),
  };
  const users = {
    findById: jest
      .fn()
      .mockImplementation(async (id) => ({ fullName: `Person ${id}`, isActive: true })),
  };
  const service = new GetTeamWorkloadService(
    access as unknown as TeamAccessService,
    assignments as unknown as TeamJobAssignmentRepository,
    jobs as ConversionWorkloadPort,
    projects as unknown as ProjectRepository,
    users as unknown as UserRepository,
  );
  return { service, access, assignments, records, jobs, projects, users, team };
}
describe('scoped current assigned-job workload', () => {
  it('counts distinct actual assigned jobs and independently expected member totals, never attempts or unassigned creators', async () => {
    const f = setup();
    const result = await f.service.execute('manager', 'org', 'team', 7);
    expect(result.totals).toEqual({
      assignedJobs: 4,
      processingJobs: 1,
      completedJobs: 1,
      failedJobs: 1,
    });
    expect(result.members.map((m) => m.metrics)).toEqual([
      { assignedJobs: 2, processingJobs: 1, completedJobs: 0, failedJobs: 0 },
      { assignedJobs: 2, processingJobs: 0, completedJobs: 1, failedJobs: 1 },
    ]);
    expect(f.jobs.listAssignedJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org',
        projectId: 'project',
        jobIds: ['a', 'b', 'c', 'd'],
      }),
    );
    expect(result.coverage).toBe('EXPLICIT_ASSIGNMENTS_ONLY');
  });
  it('reports a real empty assignment set as zero without counting existing unrelated jobs', async () => {
    const f = setup();
    f.assignments.listActive.mockResolvedValue([]);
    f.jobs.listAssignedJobs.mockResolvedValue([]);
    expect((await f.service.execute('manager', 'org', 'team', 30)).totals.assignedJobs).toBe(0);
    expect(f.jobs.listAssignedJobs).toHaveBeenCalledWith(expect.objectContaining({ jobIds: [] }));
  });
  it('omits inactive staff and deleted/unavailable projects', async () => {
    const f = setup();
    f.users.findById.mockResolvedValue({ isActive: false, fullName: 'inactive' });
    f.projects.findById.mockResolvedValue(null);
    const result = await f.service.execute('manager', 'org', 'team', 7);
    expect(result.members).toEqual([]);
    expect(result.totals.assignedJobs).toBe(0);
    expect(f.jobs.listAssignedJobs).not.toHaveBeenCalled();
  });
  it('does not query jobs when scoped authorization denies', async () => {
    const f = setup();
    f.access.managed.mockRejectedValue(new ForbiddenException());
    await expect(f.service.execute('manager', 'foreign', 'team', 7)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.jobs.listAssignedJobs).not.toHaveBeenCalled();
  });
  it('discards a report if management or assignments change during aggregation', async () => {
    const f = setup();
    f.assignments.listActive.mockResolvedValueOnce(f.records).mockResolvedValueOnce([]);
    await expect(f.service.execute('manager', 'org', 'team', 7)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const g = setup();
    g.access.managed
      .mockResolvedValueOnce({
        team: g.team,
        organization: { id: 'org', members: [{ userId: 'one' }] },
      })
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(g.service.execute('manager', 'org', 'team', 7)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
