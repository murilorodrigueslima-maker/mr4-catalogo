#!/usr/bin/env node
'use strict';
/**
 * IndexNow (https://www.indexnow.org/documentation) — notifica Bing e demais buscadores participantes SÓ das URLs que mudaram.
 *  - A chave é PÚBLICA por desenho do protocolo: o arquivo /<chave>.txt na raiz comprova a posse do host. Não é segredo.
 *  - As URLs vêm de gerar-paginas.js (INDEXNOW_URLS_FILE): páginas indexáveis cujo HTML (sem ?v=) realmente mudou, ou que são novas.
 *    Produto que sai do feed muda de página (aviso + noindex depois) e entra na lista; sitemap/robots/estado nunca entram.
 *  - BEST-EFFORT: qualquer falha (rede, timeout, HTTP ≠ 2xx, arquivo ausente) só gera log. O processo SEMPRE termina com código 0.
 *  - Nada de reenvio em massa: lote ≤ 10.000 (limite do protocolo), deduplicado, 1 retry só para erro de rede/5xx, nenhum retry para 4xx/429.
 */
const fs = require('fs');
const path = require('path');

const LIMITE_LOTE = 10000;
const TIMEOUT_MS = 10000;

function normalizarUrls(urls, host) {
  const vistos = new Set(), out = [];
  (urls || []).forEach(u => {
    let x; try { x = new URL(String(u)); } catch (e) { return; }
    if (x.protocol !== 'https:' || x.host !== host || x.search || x.hash) return;     // só URLs canônicas, absolutas, do próprio host
    if (!vistos.has(x.href)) { vistos.add(x.href); out.push(x.href); }
  });
  return out.sort();
}
function lotes(urls, max) {
  const n = Math.max(1, Math.min(max || LIMITE_LOTE, LIMITE_LOTE)), out = [];
  for (let i = 0; i < urls.length; i += n) out.push(urls.slice(i, i + n));
  return out;
}
const corpo = (cfg, lista) => ({ host: cfg.host, key: cfg.key, keyLocation: cfg.keyLocation, urlList: lista });

/** envia UM lote; nunca lança. Retorna { ok, status, tentativas, erro? } */
async function enviarLote(cfg, lista, env) {
  const f = (env && env.fetch) || fetch, esperar = (env && env.esperar) || (ms => new Promise(r => setTimeout(r, ms)));
  let ultimo = { ok: false, status: 0, tentativas: 0, erro: 'não enviado' };
  for (let t = 1; t <= 2; t++) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), (env && env.timeoutMs) || TIMEOUT_MS) : null;
    try {
      const r = await f(cfg.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(corpo(cfg, lista)), signal: ctl ? ctl.signal : undefined });
      if (timer) clearTimeout(timer);
      ultimo = { ok: r.status >= 200 && r.status < 300, status: r.status, tentativas: t };
      if (ultimo.ok) return ultimo;
      if (r.status < 500) return ultimo;                                         // 4xx (400/403/422/429): reenviar não ajuda e 429 = spam
    } catch (e) {
      if (timer) clearTimeout(timer);
      ultimo = { ok: false, status: 0, tentativas: t, erro: String((e && e.message) || e).slice(0, 120) };
    }
    if (t < 2) await esperar(3000);                                             // um único retry (rede/5xx)
  }
  return ultimo;
}

/** espera (limitada) o Pages servir a versão nova da 1ª URL antes de notificar; nunca bloqueia indefinidamente */
async function aguardarPublicacao(url, esperadoHash, env) {
  const f = (env && env.fetch) || fetch, esperar = (env && env.esperar) || (ms => new Promise(r => setTimeout(r, ms)));
  const tentativas = (env && env.tentativas) || 6, passo = (env && env.passoMs) || 45000;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await f(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
      if (r.status === 200 && env.hash(await r.text()) === esperadoHash) return true;
    } catch (e) { /* tenta de novo */ }
    await esperar(passo);
  }
  return false;
}

async function notificar(cfg, urlsBrutas, env) {
  const urls = normalizarUrls(urlsBrutas, cfg.host);
  const res = { urls: urls.length, lotes: 0, ok: 0, falhas: 0, detalhes: [] };
  if (!urls.length) return res;                                                  // nada mudou ⇒ nenhuma chamada
  for (const l of lotes(urls, env && env.lote)) {
    const r = await enviarLote(cfg, l, env);
    res.lotes++; if (r.ok) res.ok++; else res.falhas++;
    res.detalhes.push({ n: l.length, status: r.status, tentativas: r.tentativas, erro: r.erro });
  }
  return res;
}

async function main() {
  try {
    const raiz = path.join(__dirname, '..');
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'indexnow.config.json'), 'utf8'));
    const arq = process.env.INDEXNOW_URLS_FILE;
    let urls = [];
    try { urls = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (e) { console.log('IndexNow: sem lista de URLs (ok, nada a fazer).'); return; }
    if (!urls.length) { console.log('IndexNow: nenhuma URL mudou — nenhuma notificação.'); return; }
    if (process.env.INDEXNOW_DRY_RUN) { console.log(`IndexNow (dry-run): ${urls.length} URL(s): ${urls.slice(0, 5).join(', ')}${urls.length > 5 ? ' …' : ''}`); return; }
    if (process.env.INDEXNOW_AGUARDAR) {                                          // pós-push: dá tempo ao GitHub Pages
      const crypto = require('crypto');
      const u0 = normalizarUrls(urls, cfg.host)[0];
      const rel = u0 && (new URL(u0).pathname === '/' ? 'index.html' : new URL(u0).pathname.slice(1) + 'index.html');
      const norm = h => crypto.createHash('sha1').update(h.replace(/\?v=[A-Za-z0-9._-]+/g, '')).digest('hex');
      try { const local = fs.readFileSync(path.join(raiz, rel), 'utf8'); const ok = await aguardarPublicacao(u0, norm(local), { hash: norm }); console.log(`IndexNow: publicação ${ok ? 'confirmada' : 'não confirmada a tempo (notificando mesmo assim)'}.`); } catch (e) { /* segue */ }
    }
    const r = await notificar(cfg, urls, {});
    console.log(`IndexNow: ${r.urls} URL(s) em ${r.lotes} lote(s) — ${r.ok} ok, ${r.falhas} falha(s) ${JSON.stringify(r.detalhes)}`);
  } catch (e) {
    console.log('IndexNow: erro ignorado (best-effort):', String((e && e.message) || e).slice(0, 160));
  }
}

module.exports = { normalizarUrls, lotes, corpo, enviarLote, aguardarPublicacao, notificar, LIMITE_LOTE };
if (require.main === module) main().then(() => process.exit(0), () => process.exit(0));
