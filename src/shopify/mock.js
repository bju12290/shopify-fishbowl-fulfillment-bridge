export class MockShopifyClient {
  constructor({ defaultFulfillmentStatus = 'FULFILLED', logger } = {}) {
    this.defaultFulfillmentStatus = defaultFulfillmentStatus;
    this.log = logger;
  }

  /**
   * Mimics ShopifyClient.getOrderFulfillmentStatus()
   * In demo mode we trust the webhook and return a configured status.
   */
  async getOrderFulfillmentStatus({ orderId, orderGid } = {}) {
    const gid = orderGid ?? (orderId ? `gid://shopify/Order/${orderId}` : null);
    const status = this.defaultFulfillmentStatus;
    const name = orderId ? `#${orderId}` : null;
    this.log?.info?.({ gid, status }, 'Mock Shopify fulfillment status');
    return { gid, name, displayFulfillmentStatus: status };
  }
}
