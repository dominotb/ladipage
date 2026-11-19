const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const env = require('../config/env');

let client = null;
let seededPromise = null;

// Prefixed table names to isolate Landing Page CMS from other apps in the same Supabase project
const T = {
  admins: 'ladi_admins',
  leads: 'ladi_leads',
  events: 'ladi_conversion_events',
  settings: 'ladi_site_settings',
  overrides: 'ladi_cms_overrides',
  revisions: 'ladi_cms_revisions',
  media: 'ladi_media_assets',
  audit: 'ladi_audit_logs',
};

const DEFAULT_SETTINGS = {
  fb_pixel_id: '',
  fb_capi_token: '',
  fb_test_event_code: '',
  fb_pixel_enabled: '0',
  fb_capi_enabled: '0',
  fb_lead_value: '0',
  fb_currency: 'VND',
  site_title: 'DOMINO - Tủ bếp INOX cánh kính tại Thái Bình',
  site_description:
    'DOMINO Thái Bình - Tủ bếp INOX cánh kính thiết kế, sản xuất tại xưởng riêng và thi công trọn gói từ năm 2015. Tư vấn vật liệu, cấu tạo và giải pháp bếp bền đẹp theo thời gian.',
  og_image: '',
};

function getClient() {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

async function ensureSeeded() {
  if (!seededPromise) {
    seededPromise = (async () => {
      const sb = getClient();
      const { count, error } = await sb
        .from(T.admins)
        .select('id', { count: 'exact', head: true });
      if (error) {
        console.error('[Supabase Seed Check Error]', error.message);
        return;
      }
      if (!count || count === 0) {
        const hash = bcrypt.hashSync(env.adminPassword, 12);
        await sb.from(T.admins).insert({
          username: env.adminUsername,
          password_hash: hash,
          role: 'superadmin',
        });
      }
      const rows = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value }));
      await sb.from(T.settings).upsert(rows, { onConflict: 'key', ignoreDuplicates: true });
    })().catch((err) => {
      seededPromise = null;
      console.error('[Supabase Seed Error]', err.message);
    });
  }
  await seededPromise;
}

function throwIfError(error, ctx) {
  if (error) {
    const e = new Error(error.message || `Supabase error (${ctx})`);
    e.code = error.code;
    throw e;
  }
}

module.exports = {
  driver: 'supabase',

  async init() {
    await ensureSeeded();
  },

  // ---------- ADMINS ----------
  async findAdminByUsername(username) {
    await ensureSeeded();
    const { data, error } = await getClient()
      .from(T.admins)
      .select('*')
      .eq('username', username)
      .maybeSingle();
    throwIfError(error, 'findAdminByUsername');
    return data || null;
  },

  async findAdminById(id) {
    await ensureSeeded();
    const { data, error } = await getClient()
      .from(T.admins)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    throwIfError(error, 'findAdminById');
    return data || null;
  },

  async updateAdminLoginFailure(id, failedAttempts, lockedUntil) {
    const { error } = await getClient()
      .from(T.admins)
      .update({
        failed_attempts: failedAttempts,
        locked_until: lockedUntil,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    throwIfError(error, 'updateAdminLoginFailure');
  },

  async updateAdminLoginSuccess(id) {
    const { error } = await getClient()
      .from(T.admins)
      .update({
        failed_attempts: 0,
        locked_until: null,
        last_login_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    throwIfError(error, 'updateAdminLoginSuccess');
  },

  async updateAdminPassword(id, passwordHash) {
    const { error } = await getClient()
      .from(T.admins)
      .update({
        password_hash: passwordHash,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    throwIfError(error, 'updateAdminPassword');
  },

  // ---------- LEADS ----------
  async findLeadByPhoneE164(phoneE164) {
    const { data, error } = await getClient()
      .from(T.leads)
      .select('id, created_at')
      .eq('phone_e164', phoneE164)
      .maybeSingle();
    throwIfError(error, 'findLeadByPhoneE164');
    return data || null;
  },

  async findLeadById(id) {
    const { data, error } = await getClient()
      .from(T.leads)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    throwIfError(error, 'findLeadById');
    return data || null;
  },

  async createLead(lead) {
    const { data, error } = await getClient()
      .from(T.leads)
      .insert(lead)
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') {
        const dup = new Error('DUPLICATE_PHONE');
        dup.code = 'DUPLICATE_PHONE';
        throw dup;
      }
      throwIfError(error, 'createLead');
    }
    return Number(data.id);
  },

  async updateLeadCapiStatus(id, status, responseText) {
    const { error } = await getClient()
      .from(T.leads)
      .update({
        fb_capi_status: status,
        fb_capi_response: String(responseText || '').slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    throwIfError(error, 'updateLeadCapiStatus');
  },

  async updateLead(id, { status, notes }) {
    const { error } = await getClient()
      .from(T.leads)
      .update({
        status,
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    throwIfError(error, 'updateLead');
  },

  async deleteLead(id) {
    const { error } = await getClient().from(T.leads).delete().eq('id', id);
    throwIfError(error, 'deleteLead');
  },

  async listLeads({ search = '', status = '', source = '', page = 1, limit = 25 }) {
    const sb = getClient();
    let q = sb.from(T.leads).select('*', { count: 'exact' });

    if (search) {
      // Strictly strip all PostgREST filter DSL control characters to prevent filter injection
      const safe = search.replace(/[,%*()."\\':;]/g, ' ').replace(/\s+/g, ' ').trim();
      if (safe) {
        q = q.or(
          `name.ilike.%${safe}%,phone_e164.ilike.%${safe}%,phone_raw.ilike.%${safe}%,area.ilike.%${safe}%,need.ilike.%${safe}%`
        );
      }
    }
    if (status) {
      q = q.eq('status', status);
    }
    if (source === 'facebook') {
      q = q.or('fbclid.neq.,utm_source.ilike.%fb%,utm_source.ilike.%facebook%');
    } else if (source === 'direct') {
      q = q.eq('fbclid', '').eq('utm_source', '');
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const { data, count, error } = await q.order('id', { ascending: false }).range(from, to);
    throwIfError(error, 'listLeads');
    return { total: count || 0, leads: data || [] };
  },

  async getAllLeadsForExport() {
    const { data, error } = await getClient()
      .from(T.leads)
      .select('*')
      .order('id', { ascending: false })
      .limit(10000);
    throwIfError(error, 'getAllLeadsForExport');
    return data || [];
  },

  async getOverview() {
    await ensureSeeded();
    const sb = getClient();
    const todayIso = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';

    const [
      totalLeadsRes,
      todayLeadsRes,
      fbLeadsRes,
      capiSentRes,
      capiTotalRes,
      overridesRes,
      recentLeadsRes,
      allLeadsMetaRes,
    ] = await Promise.all([
      sb.from(T.leads).select('id', { count: 'exact', head: true }),
      sb.from(T.leads).select('id', { count: 'exact', head: true }).gte('created_at', todayIso),
      sb
        .from(T.leads)
        .select('id', { count: 'exact', head: true })
        .or('fbclid.neq.,utm_source.ilike.%fb%,utm_source.ilike.%facebook%'),
      sb.from(T.events).select('id', { count: 'exact', head: true }).eq('capi_status', 'sent'),
      sb.from(T.events).select('id', { count: 'exact', head: true }),
      sb.from(T.overrides).select('cms_key', { count: 'exact', head: true }),
      sb
        .from(T.leads)
        .select(
          'id, name, phone_e164, phone_national, country_iso, stage, area, status, utm_source, fb_capi_status, created_at'
        )
        .order('id', { ascending: false })
        .limit(8),
      sb.from(T.leads).select('status, utm_source, fbclid').limit(5000),
    ]);

    const statusCounts = new Map();
    const sourceCounts = new Map();
    for (const row of allLeadsMetaRes.data || []) {
      statusCounts.set(row.status, (statusCounts.get(row.status) || 0) + 1);
      const src = row.utm_source
        ? row.utm_source
        : row.fbclid
        ? 'facebook (fbclid)'
        : 'direct / organic';
      sourceCounts.set(src, (sourceCounts.get(src) || 0) + 1);
    }

    const byStatus = Array.from(statusCounts.entries()).map(([status, cnt]) => ({ status, cnt }));
    const bySource = Array.from(sourceCounts.entries())
      .map(([source, cnt]) => ({ source, cnt }))
      .sort((a, b) => b.cnt - a.cnt)
      .slice(0, 8);

    return {
      stats: {
        totalLeads: totalLeadsRes.count || 0,
        todayLeads: todayLeadsRes.count || 0,
        fbLeads: fbLeadsRes.count || 0,
        capiSent: capiSentRes.count || 0,
        capiTotal: capiTotalRes.count || 0,
        overridesCount: overridesRes.count || 0,
      },
      byStatus,
      bySource,
      recentLeads: recentLeadsRes.data || [],
    };
  },

  // ---------- CONVERSION EVENTS ----------
  async createConversionEvent(ev) {
    try {
      await getClient().from(T.events).insert(ev);
    } catch {
      // non-fatal
    }
  },

  async listConversionEvents(limit = 100) {
    const { data, error } = await getClient()
      .from(T.events)
      .select('*')
      .order('id', { ascending: false })
      .limit(limit);
    throwIfError(error, 'listConversionEvents');
    return data || [];
  },

  // ---------- SETTINGS ----------
  async getAllSettings() {
    await ensureSeeded();
    const { data, error } = await getClient().from(T.settings).select('key, value');
    throwIfError(error, 'getAllSettings');
    const obj = { ...DEFAULT_SETTINGS };
    for (const row of data || []) {
      obj[row.key] = row.value;
    }
    return obj;
  },

  async setSettings(pairs) {
    const now = new Date().toISOString();
    const rows = Object.entries(pairs).map(([key, value]) => ({
      key,
      value: String(value ?? ''),
      updated_at: now,
    }));
    if (!rows.length) return;
    const { error } = await getClient().from(T.settings).upsert(rows, { onConflict: 'key' });
    throwIfError(error, 'setSettings');
  },

  // ---------- CMS OVERRIDES & REVISIONS ----------
  async getAllCmsOverrides() {
    const { data, error } = await getClient()
      .from(T.overrides)
      .select('cms_key, cms_type, value_json, updated_at');
    throwIfError(error, 'getAllCmsOverrides');
    const map = {};
    for (const row of data || []) {
      try {
        map[row.cms_key] = {
          type: row.cms_type,
          value: JSON.parse(row.value_json),
          updatedAt: row.updated_at,
        };
      } catch {
        // skip
      }
    }
    return map;
  },

  async saveCmsOverrides(entries, updatedBy) {
    if (!entries.length) return;
    const now = new Date().toISOString();
    const rows = entries.map((e) => ({
      cms_key: e.key,
      cms_type: e.type,
      value_json: JSON.stringify(e.value),
      updated_by: updatedBy,
      updated_at: now,
    }));
    const { error } = await getClient().from(T.overrides).upsert(rows, { onConflict: 'cms_key' });
    throwIfError(error, 'saveCmsOverrides');
  },

  async deleteCmsOverride(key) {
    const { error } = await getClient().from(T.overrides).delete().eq('cms_key', key);
    throwIfError(error, 'deleteCmsOverride');
  },

  async clearAllCmsOverrides() {
    const { error } = await getClient().from(T.overrides).delete().neq('cms_key', '');
    throwIfError(error, 'clearAllCmsOverrides');
  },

  async createCmsRevision(snapshotObj, note, createdBy) {
    const { error } = await getClient().from(T.revisions).insert({
      snapshot_json: JSON.stringify(snapshotObj),
      note,
      created_by: createdBy,
    });
    throwIfError(error, 'createCmsRevision');
  },

  async listCmsRevisions(limit = 20) {
    const { data, error } = await getClient()
      .from(T.revisions)
      .select('id, note, created_by, created_at')
      .order('id', { ascending: false })
      .limit(limit);
    throwIfError(error, 'listCmsRevisions');
    return data || [];
  },

  async getCmsRevisionById(id) {
    const { data, error } = await getClient()
      .from(T.revisions)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    throwIfError(error, 'getCmsRevisionById');
    return data || null;
  },

  // ---------- MEDIA LIBRARY & SUPABASE STORAGE ----------
  async uploadImageToStorage(filename, buffer, mimeType) {
    const sb = getClient();
    const bucket = env.supabaseBucket;
    const { error } = await sb.storage.from(bucket).upload(filename, buffer, {
      contentType: mimeType,
      upsert: false,
      cacheControl: '31536000',
    });
    throwIfError(error, 'uploadImageToStorage');
    const { data } = sb.storage.from(bucket).getPublicUrl(filename);
    return data.publicUrl;
  },

  async deleteImageFromStorage(filename) {
    try {
      await getClient().storage.from(env.supabaseBucket).remove([filename]);
    } catch {
      // non-fatal
    }
  },

  async createMediaAsset(asset) {
    const { data, error } = await getClient().from(T.media).insert(asset).select('*').single();
    throwIfError(error, 'createMediaAsset');
    return data;
  },

  async listMediaAssets(limit = 100) {
    const { data, error } = await getClient()
      .from(T.media)
      .select('*')
      .order('id', { ascending: false })
      .limit(limit);
    throwIfError(error, 'listMediaAssets');
    return data || [];
  },

  async findMediaAssetById(id) {
    const { data, error } = await getClient()
      .from(T.media)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    throwIfError(error, 'findMediaAssetById');
    return data || null;
  },

  async deleteMediaAsset(id) {
    const { error } = await getClient().from(T.media).delete().eq('id', id);
    throwIfError(error, 'deleteMediaAsset');
  },

  // ---------- AUDIT LOGS & BACKUP ----------
  async logAudit(actor, action, target = '', detail = '', ipAddress = '') {
    try {
      await getClient().from(T.audit).insert({
        actor,
        action,
        target,
        detail: String(detail).slice(0, 1000),
        ip_address: ipAddress,
      });
    } catch {
      // non-fatal
    }
  },

  async listAuditLogs(limit = 100) {
    const { data, error } = await getClient()
      .from(T.audit)
      .select('*')
      .order('id', { ascending: false })
      .limit(limit);
    throwIfError(error, 'listAuditLogs');
    return data || [];
  },

  async exportFullBackupJson() {
    const sb = getClient();
    const [leads, settings, overrides, events, media] = await Promise.all([
      sb.from(T.leads).select('*').order('id', { ascending: false }),
      sb.from(T.settings).select('*'),
      sb.from(T.overrides).select('*'),
      sb.from(T.events).select('*').order('id', { ascending: false }).limit(2000),
      sb.from(T.media).select('*').order('id', { ascending: false }),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      driver: 'supabase',
      leads: leads.data || [],
      site_settings: settings.data || [],
      cms_overrides: overrides.data || [],
      conversion_events: events.data || [],
      media_assets: media.data || [],
    };
  },
};
