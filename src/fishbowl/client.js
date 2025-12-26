import { request } from 'undici';

function normalizeBaseUrl(baseUrl) {
  // allow both https://host:2456 and https://host:2456/
  return baseUrl.replace(/\/+$/, '');
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`; 
  }
  return s;
}

export class FishbowlClient {
  constructor({ baseUrl, username, password, appName, appDescription, appId, logger }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.username = username;
    this.password = password;
    this.appName = appName;
    this.appDescription = appDescription;
    this.appId = appId;
    this.log = logger;
    this.token = null;
  }

  async login({ mfaCode } = {}) {
    const url = `${this.baseUrl}/api/login`;
    const payload = {
      appName: this.appName,
      appDescription: this.appDescription,
      appId: this.appId,
      username: this.username,
      password: this.password,
      ...(mfaCode ? { mfaCode } : {}),
    };

    const { statusCode, body } = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await body.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Fishbowl login returned non-JSON (HTTP ${statusCode})`);
    }
    if (statusCode < 200 || statusCode >= 300) {
      const msg = json?.message ?? text;
      throw new Error(`Fishbowl login failed (HTTP ${statusCode}): ${msg}`);
    }

    this.token = json.token;
    return json;
  }

  async logout() {
    if (!this.token) return;
    const url = `${this.baseUrl}/api/logout`;
    await request(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
    });
    this.token = null;
  }

  async authedRequest(path, { method = 'GET', headers = {}, body } = {}) {
    if (!this.token) throw new Error('Fishbowl client is not logged in');
    const url = `${this.baseUrl}${path}`;
    const res = await request(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...headers,
      },
      body,
    });
    return res;
  }

  /** Execute an Import using JSON row format: [ [headers...], [row...], ... ] */
  async runImportJson(importName, rows) {
    const safeName = encodeURIComponent(importName);
    const { statusCode, body } = await this.authedRequest(`/api/import/${safeName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rows),
    });
    const text = await body.text();
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Fishbowl import failed (HTTP ${statusCode}): ${text}`);
    }
    // API sometimes returns empty object/empty response
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  /** Execute an Import using CSV text */
  async runImportCsv(importName, headers, row) {
    const safeName = encodeURIComponent(importName);
    const csv = `${headers.map(csvEscape).join(',')}\n${row.map(csvEscape).join(',')}\n`;
    const { statusCode, body } = await this.authedRequest(`/api/import/${safeName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: csv,
    });
    const text = await body.text();
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`Fishbowl import failed (HTTP ${statusCode}): ${text}`);
    }
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
}

