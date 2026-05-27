/**
 * B2metrics → GitHub sync (Apps Script)
 *
 * Tahá měsíční obrat ze B2metrics API a pushe je do data.json v GitHub repu.
 * Endpoint /webs/year vrací jen posledních 13 měsíců — ale tento script
 * MERGUJE novou odpověď se stávajícím data.json, takže historie roste.
 *
 * Setup:
 *   1) Otevři script.google.com → Nový projekt
 *   2) Vlož tento soubor jako Code.gs
 *   3) V Project Settings → Script properties přidej:
 *        B2M_TOKEN     = b2m_700c32ea5e5a37a5492b3c9d09361cd05ab46f979cc883a6
 *        B2M_URL       = https://app.b2metrics.com/api/v1/webs/year?webID=195
 *        GH_TOKEN      = ghp_xxx (Personal Access Token s "repo" scope)
 *        GH_OWNER      = ondrejmarikmedia
 *        GH_REPO       = marketing-planner
 *        GH_BRANCH     = main
 *        GH_FILE       = data.json
 *   4) Spusť ručně syncOnce() pro otestování (povolíš oprávnění)
 *   5) Triggers → Add trigger → syncOnce → Time-driven → Day timer → 6am-7am
 */

function syncOnce() {
  const props = PropertiesService.getScriptProperties();
  const cfg = {
    b2mToken: props.getProperty('B2M_TOKEN'),
    b2mUrl:   props.getProperty('B2M_URL'),
    ghToken:  props.getProperty('GH_TOKEN'),
    ghOwner:  props.getProperty('GH_OWNER'),
    ghRepo:   props.getProperty('GH_REPO'),
    ghBranch: props.getProperty('GH_BRANCH') || 'main',
    ghFile:   props.getProperty('GH_FILE') || 'data.json',
  };
  for (const k of ['b2mToken','b2mUrl','ghToken','ghOwner','ghRepo']) {
    if (!cfg[k]) throw new Error('Missing script property: ' + k);
  }

  // 1) Fetch latest from B2metrics
  const apiResp = UrlFetchApp.fetch(cfg.b2mUrl, {
    headers: { Authorization: 'Bearer ' + cfg.b2mToken, Accept: 'application/json' },
    muteHttpExceptions: true,
  });
  if (apiResp.getResponseCode() !== 200) {
    throw new Error('B2metrics HTTP ' + apiResp.getResponseCode() + ': ' + apiResp.getContentText().slice(0, 200));
  }
  const apiPayload = JSON.parse(apiResp.getContentText());
  const newRows = normalizeB2mResponse_(apiPayload); // [{year,month,revenue,orders}]
  if (newRows.length === 0) throw new Error('B2metrics returned no usable rows');

  // 2) Read existing data.json from GitHub (if exists)
  const ghBase = `https://api.github.com/repos/${cfg.ghOwner}/${cfg.ghRepo}/contents/${cfg.ghFile}?ref=${cfg.ghBranch}`;
  const getResp = UrlFetchApp.fetch(ghBase, {
    headers: { Authorization: 'token ' + cfg.ghToken, 'User-Agent': 'b2m-sync', Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true,
  });
  let existingPayload = { shoptet: { monthlyRevenue: [] }, lastSync: null };
  let sha = null;
  if (getResp.getResponseCode() === 200) {
    const meta = JSON.parse(getResp.getContentText());
    sha = meta.sha;
    try {
      const content = Utilities.newBlob(Utilities.base64Decode(meta.content)).getDataAsString();
      existingPayload = JSON.parse(content);
      if (!existingPayload.shoptet) existingPayload.shoptet = { monthlyRevenue: [] };
      if (!Array.isArray(existingPayload.shoptet.monthlyRevenue)) existingPayload.shoptet.monthlyRevenue = [];
    } catch (e) {
      Logger.log('Existing data.json unreadable, starting fresh: ' + e);
    }
  } else if (getResp.getResponseCode() === 404) {
    Logger.log('data.json does not exist yet — will create');
  } else {
    throw new Error('GitHub GET HTTP ' + getResp.getResponseCode() + ': ' + getResp.getContentText().slice(0, 200));
  }

  // 3) Merge: new rows overwrite same (year,month); older rows are preserved
  const map = new Map();
  existingPayload.shoptet.monthlyRevenue.forEach(r => map.set(r.year + '-' + r.month, r));
  newRows.forEach(r => map.set(r.year + '-' + r.month, r));
  const merged = [...map.values()].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

  const updated = {
    shoptet: { monthlyRevenue: merged },
    lastSync: new Date().toISOString(),
    source: 'b2metrics',
  };

  // 4) PUT back to GitHub
  const contentB64 = Utilities.base64Encode(JSON.stringify(updated, null, 2));
  const putBody = {
    message: `b2m sync: ${merged.length} rows (${merged[0].year}-${String(merged[0].month).padStart(2,'0')} → ${merged[merged.length-1].year}-${String(merged[merged.length-1].month).padStart(2,'0')})`,
    content: contentB64,
    branch: cfg.ghBranch,
  };
  if (sha) putBody.sha = sha;
  const putResp = UrlFetchApp.fetch(ghBase.split('?')[0], {
    method: 'put',
    headers: { Authorization: 'token ' + cfg.ghToken, 'User-Agent': 'b2m-sync', Accept: 'application/vnd.github+json' },
    contentType: 'application/json',
    payload: JSON.stringify(putBody),
    muteHttpExceptions: true,
  });
  if (putResp.getResponseCode() < 200 || putResp.getResponseCode() >= 300) {
    throw new Error('GitHub PUT HTTP ' + putResp.getResponseCode() + ': ' + putResp.getContentText().slice(0, 300));
  }

  Logger.log(`✓ Synced ${newRows.length} fresh rows, total ${merged.length} months in data.json`);
  return { freshRows: newRows.length, totalMonths: merged.length };
}

function normalizeB2mResponse_(payload) {
  const out = [];
  const tryPush = (row) => {
    if (!row || typeof row !== 'object') return;
    let year, month;
    const monthStr = row.month || row.period || row.date;
    if (typeof monthStr === 'string') {
      const m = monthStr.match(/^(\d{4})-(\d{1,2})/);
      if (m) { year = +m[1]; month = +m[2]; }
    }
    if ((!year || !month) && row.year && row.month && +row.month >= 1 && +row.month <= 12) {
      year = +row.year; month = +row.month;
    }
    if (!year || !month) return;
    const revenue = +String(row.revenue ?? row.turnover ?? row.amount ?? 0).replace(',', '.');
    const orders = +String(row.orders ?? row.order_count ?? row.count ?? 0).replace(',', '.');
    const cost = +String(row.cost ?? row.naklady ?? row.spend ?? row.ad_cost ?? 0).replace(',', '.');
    if ((revenue > 0 || cost > 0) && year > 0 && month >= 1 && month <= 12) {
      out.push({ year, month, revenue: Math.round(revenue), orders: Math.round(orders), cost: Math.round(cost) });
    }
  };
  const walk = (node, depth) => {
    if (depth > 4) return;
    if (Array.isArray(node)) { node.forEach(tryPush); return; }
    if (node && typeof node === 'object') {
      for (const k of ['items', 'months', 'data', 'result', 'rows']) {
        if (Array.isArray(node[k])) node[k].forEach(tryPush);
        else if (node[k] && typeof node[k] === 'object') walk(node[k], depth + 1);
      }
      if (out.length === 0) Object.values(node).forEach(v => walk(v, depth + 1));
    }
  };
  walk(payload, 0);
  return out;
}
