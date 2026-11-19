const bcrypt = require('bcryptjs');
const env = require('../config/env');

// Zero-dependency emergency fallback when SUPABASE_URL is not configured
// and node:sqlite is unavailable (e.g. Vercel Node 20 before env vars are set).
const DEFAULT_SETTINGS = {
  fb_pixel_id: '1116316424615775',
  fb_capi_token: '',
  fb_test_event_code: '',
  fb_pixel_enabled: '1',
  fb_capi_enabled: '0',
  fb_lead_value: '0',
  fb_currency: 'VND',
  site_title: 'DOMINO - Tủ bếp INOX cánh kính tại Thái Bình',
  site_description:
    'DOMINO Thái Bình - Tủ bếp INOX cánh kính thiết kế, sản xuất tại xưởng riêng và thi công trọn gói từ năm 2015.',
  og_image: '',
};

const mem = {
  admins: [
    {
      id: 1,
      username: env.adminUsername,
      password_hash: bcrypt.hashSync(env.adminPassword, 10),
      role: 'superadmin',
      failed_attempts: 0,
      locked_until: null,
      last_login_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  leads: [],
  conversion_events: [],
  site_settings: { ...DEFAULT_SETTINGS },
  cms_overrides: {},
  cms_revisions: [],
  media_assets: [],
  audit_logs: [],
  seq: { leads: 1, events: 1, revisions: 1, media: 1, audit: 1 },
};

module.exports = {
  driver: 'memory',

  async init() {},

  async findAdminByUsername(username) {
    return mem.admins.find((a) => a.username === username) || null;
  },
  async findAdminById(id) {
    return mem.admins.find((a) => a.id === id) || null;
  },
  async updateAdminLoginFailure(id, failedAttempts, lockedUntil) {
    const a = mem.admins.find((x) => x.id === id);
    if (a) {
      a.failed_attempts = failedAttempts;
      a.locked_until = lockedUntil;
    }
  },
  async updateAdminLoginSuccess(id) {
    const a = mem.admins.find((x) => x.id === id);
    if (a) {
      a.failed_attempts = 0;
      a.locked_until = null;
      a.last_login_at = new Date().toISOString();
    }
  },
  async updateAdminPassword(id, passwordHash) {
    const a = mem.admins.find((x) => x.id === id);
    if (a) a.password_hash = passwordHash;
  },

  async findLeadByPhoneE164(phoneE164) {
    return mem.leads.find((l) => l.phone_e164 === phoneE164) || null;
  },
  async findLeadById(id) {
    return mem.leads.find((l) => l.id === id) || null;
  },
  async createLead(lead) {
    if (mem.leads.some((l) => l.phone_e164 === lead.phone_e164)) {
      const err = new Error('DUPLICATE_PHONE');
      err.code = 'DUPLICATE_PHONE';
      throw err;
    }
    const id = mem.seq.leads++;
    const now = new Date().toISOString();
    mem.leads.unshift({ id, ...lead, created_at: now, updated_at: now });
    return id;
  },
  async updateLeadCapiStatus(id, status, responseText) {
    const l = mem.leads.find((x) => x.id === id);
    if (l) {
      l.fb_capi_status = status;
      l.fb_capi_response = String(responseText || '').slice(0, 1000);
    }
  },
  async updateLead(id, { status, notes }) {
    const l = mem.leads.find((x) => x.id === id);
    if (l) {
      l.status = status;
      l.notes = notes;
      l.updated_at = new Date().toISOString();
    }
  },
  async deleteLead(id) {
    mem.leads = mem.leads.filter((x) => x.id !== id);
  },
  async listLeads({ search = '', status = '', source = '', page = 1, limit = 25 }) {
    const q = search.toLowerCase();
    const filtered = mem.leads.filter((l) => {
      if (status && l.status !== status) return false;
      if (source === 'facebook' && !l.fbclid && !(l.utm_source || '').toLowerCase().includes('fb'))
        return false;
      if (source === 'direct' && (l.fbclid || l.utm_source)) return false;
      if (q) {
        const hay = `${l.name} ${l.phone_e164} ${l.area} ${l.need}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const start = (page - 1) * limit;
    return { total: filtered.length, leads: filtered.slice(start, start + limit) };
  },
  async getAllLeadsForExport() {
    return mem.leads;
  },
  async getOverview() {
    const today = new Date().toISOString().slice(0, 10);
    return {
      stats: {
        totalLeads: mem.leads.length,
        todayLeads: mem.leads.filter((l) => (l.created_at || '').startsWith(today)).length,
        fbLeads: mem.leads.filter((l) => l.fbclid || (l.utm_source || '').toLowerCase().includes('fb'))
          .length,
        capiSent: mem.conversion_events.filter((e) => e.capi_status === 'sent').length,
        capiTotal: mem.conversion_events.length,
        overridesCount: Object.keys(mem.cms_overrides).length,
      },
      byStatus: [],
      bySource: [],
      recentLeads: mem.leads.slice(0, 8),
    };
  },

  async createConversionEvent(ev) {
    mem.conversion_events.unshift({
      id: mem.seq.events++,
      ...ev,
      created_at: new Date().toISOString(),
    });
  },
  async listConversionEvents(limit = 100) {
    return mem.conversion_events.slice(0, limit);
  },

  async getAllSettings() {
    return { ...mem.site_settings };
  },
  async setSettings(pairs) {
    Object.assign(mem.site_settings, pairs);
  },

  async getAllCmsOverrides() {
    return { ...mem.cms_overrides };
  },
  async saveCmsOverrides(entries) {
    const now = new Date().toISOString();
    for (const e of entries) {
      mem.cms_overrides[e.key] = { type: e.type, value: e.value, updatedAt: now };
    }
  },
  async deleteCmsOverride(key) {
    delete mem.cms_overrides[key];
  },
  async clearAllCmsOverrides() {
    mem.cms_overrides = {};
  },
  async createCmsRevision(snapshotObj, note, createdBy) {
    mem.cms_revisions.unshift({
      id: mem.seq.revisions++,
      snapshot_json: JSON.stringify(snapshotObj),
      note,
      created_by: createdBy,
      created_at: new Date().toISOString(),
    });
  },
  async listCmsRevisions(limit = 20) {
    return mem.cms_revisions.slice(0, limit);
  },
  async getCmsRevisionById(id) {
    return mem.cms_revisions.find((r) => r.id === id) || null;
  },

  async uploadImageToStorage(_filename, buffer, mimeType) {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  },
  async deleteImageFromStorage() {},
  async createMediaAsset(asset) {
    const item = { id: mem.seq.media++, ...asset, created_at: new Date().toISOString() };
    mem.media_assets.unshift(item);
    return item;
  },
  async listMediaAssets(limit = 100) {
    return mem.media_assets.slice(0, limit);
  },
  async findMediaAssetById(id) {
    return mem.media_assets.find((m) => m.id === id) || null;
  },
  async deleteMediaAsset(id) {
    mem.media_assets = mem.media_assets.filter((m) => m.id !== id);
  },

  async logAudit(actor, action, target = '', detail = '', ipAddress = '') {
    mem.audit_logs.unshift({
      id: mem.seq.audit++,
      actor,
      action,
      target,
      detail,
      ip_address: ipAddress,
      created_at: new Date().toISOString(),
    });
  },
  async listAuditLogs(limit = 100) {
    return mem.audit_logs.slice(0, limit);
  },
  async exportFullBackupJson() {
    return {
      exportedAt: new Date().toISOString(),
      driver: 'memory',
      leads: mem.leads,
      site_settings: mem.site_settings,
      cms_overrides: mem.cms_overrides,
    };
  },
};

