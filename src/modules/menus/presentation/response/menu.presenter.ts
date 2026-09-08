export class MenuPresenter {
  static toPersonalizedResponse(navigationData: unknown) {
    return {
      success: true,
      data: navigationData,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
  }

  static toCommandResponse(commands: unknown[], query?: string) {
    return {
      success: true,
      data: commands,
      meta: {
        total: commands.length,
        query: query || '',
      },
    };
  }
}
