export async function registerHealthRoutes(app) {
  app.get('/health', async () => {
    return { ok: true, version: app.buildVersion };
  });
}
