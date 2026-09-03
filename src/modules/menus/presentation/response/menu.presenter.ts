export class MenuPresenter {
  static toPersonalizedResponse(navigationData: any) {
    return {
      success: true,
      data: navigationData,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
  }

  static toCommandResponse(commands: any[], query?: string) {
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
