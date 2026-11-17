module.exports = {
  ScheduleModule: {
    forRoot: () => ({ module: class FakeScheduleModule {}, providers: [] }),
  },
  Cron: () => () => {},
  CronExpression: {
    EVERY_HOUR: '0 * * * *',
    EVERY_MINUTE: '* * * * *',
    EVERY_DAY_AT_MIDNIGHT: '0 0 * * *',
  },
};
