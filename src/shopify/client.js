import { request } from 'undici';

export class ShopifyClient {
  constructor({ shopDomain, accessToken, apiVersion = '2025-10', logger }) {
    this.shopDomain = shopDomain;
    this.accessToken = accessToken;
    this.apiVersion = apiVersion;
    this.log = logger;
  }

  async graphql(query, variables) {
    const url = `https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`;
    const body = JSON.stringify({ query, variables });
    const { statusCode, body: resBody, headers } = await request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.accessToken,
      },
      body,
    });

    const text = await resBody.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Shopify GraphQL returned non-JSON (HTTP ${statusCode})`);
    }

    if (statusCode < 200 || statusCode >= 300) {
      const msg = json?.errors?.[0]?.message ?? text;
      throw new Error(`Shopify GraphQL HTTP ${statusCode}: ${msg}`);
    }
    if (json.errors?.length) {
      throw new Error(`Shopify GraphQL error: ${json.errors[0].message}`);
    }
    return json.data;
  }

  /**
   * Returns display fulfillment status for an order.
   * Accepts either a numeric orderId or a gid.
   */
  async getOrderFulfillmentStatus({ orderId, orderGid }) {
    const gid = orderGid ?? `gid://shopify/Order/${orderId}`;
    const query = /* GraphQL */ `
      query ($id: ID!) {
        order(id: $id) {
          id
          name
          displayFulfillmentStatus
        }
      }
    `;
    const data = await this.graphql(query, { id: gid });
    if (!data?.order) return { gid, name: null, displayFulfillmentStatus: null };
    return {
      gid: data.order.id,
      name: data.order.name,
      displayFulfillmentStatus: data.order.displayFulfillmentStatus,
    };
  }
}

