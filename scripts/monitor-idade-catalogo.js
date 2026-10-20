#!/usr/bin/env node
'use strict';
/**
 * Monitor de IDADE/INTEGRIDADE do catálogo (workflow horário). Mede o RESULTADO (o que o cliente vê), não o processo:
 * última sincronização concluída (marcador), feed público íntegro, site = repositório. Um alerta (Issue) por incidente + aviso de recuperação.
 * Sai com 0 mesmo havendo incidente (o alerta é a Issue); sai com 1 só se o PRÓPRIO monitor não conseguir consultar o GitHub (falha visível).
 */
const fs = require('fs');
const path = require('path');
const { criarGithub } = require('./lib/github-api');
const M = require('./lib/monitor-catalogo');

async function lerFeedSite(url, fetchFn, agora) {
  for (let t = 0; t < 3; t++) {
    try {
      const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 20000);
      try {
        const r = await fetchFn(`${url.replace(/\/$/, '')}/data/produtos.json?_=${agora}`, { signal: ac.signal, headers: { 'cache-control': 'no-cache' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return { ok: true, feed: await r.json() };
      } finally { clearTimeout(tm); }
    } catch (e) { if (t === 2) return { ok: false, erro: String(e && e.message || e).replace(/https?:\/\/\S+/g, '[url]').slice(0, 80) }; await new Promise(r => setTimeout(r, 1500)); }
  }
}
async function executar({ env = process.env, fetchFn = fetch, github = null, agora = Date.now(), lerRepoFeed = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../data/produtos.json'), 'utf8')), log = console.log } = {}) {
  const gh = github || criarGithub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, fetchFn });
  const workflow = env.SYNC_WORKFLOW || 'sync-produtos.yml';
  const runs = await gh.runsConcluidos(workflow, 30);
  const jobsPorRun = {}; let achou = null;
  for (const r of runs.slice(0, 12)) { if (r.conclusion !== 'success') continue; jobsPorRun[r.id] = await gh.jobsDoRun(r.id); achou = M.ultimoSyncConcluido([r], jobsPorRun); if (achou) break; }
  const site = await lerFeedSite(env.CATALOGO_URL || 'https://catalogo.mr4distribuidora.com.br', fetchFn, agora);
  let repoFeed = null; try { repoFeed = lerRepoFeed(); } catch (e) { repoFeed = null; }
  const incidentes = M.avaliar({ agora, sync: achou, site, repoFeed });
  const acoes = await M.reconciliar({ incidentes, github: gh, agora, escopo: M.TIPOS.filter(t => t !== 'MONITOR_PARADO') });
  log(JSON.stringify({ evento: 'monitor_catalogo', incidentes: incidentes.map(i => i.tipo), ultimoSyncConcluidoEm: achou && achou.concluidoEm, acoes }));
  return { incidentes, acoes };
}
module.exports = { executar, lerFeedSite };
if (require.main === module) executar().catch(e => { console.error(`MONITOR_FALHOU: ${e.message}`); process.exit(1); });
