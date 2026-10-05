'use strict';
/**
 * Guard de NÚMEROS em descrições editoriais (data/editorial.json).
 *
 * Regra base (inalterada): todo número da descrição precisa estar no cadastro do ERP (nome, marca, código).
 * Exceção ESTREITA (autorizada pelo proprietário em 05/10/2026): número que NÃO está no ERP só passa se o item trouxer
 * `fonteNumeros` rastreável e TODOS os critérios abaixo valerem. Qualquer falha ⇒ o número não passa (o teste reprova).
 *
 *   fonteNumeros: { url, skuTrecho, trechos: [ "<trecho literal da página oficial do SKU>", ... ] }
 *
 *  1. url https de domínio OFICIAL da marca efetiva do produto (lista fechada abaixo — não é "qualquer site");
 *  2. skuTrecho: trecho literal da página que contém o código EXATO do ERP (ref) — a fonte é do produto/SKU exato;
 *  3. cada número externo da descrição aparece literalmente em algum `trechos` (especificação do fabricante);
 *  4. trechos NÃO podem vir de lista de embalagem/conteúdo, nem citar preço/promoção/garantia;
 *  5. a descrição NÃO pode conter preço/promoção/garantia, nem quantidade de embalagem/conteúdo ("acompanha N …", "N unidades");
 *  6. o ERP tem precedência: número com unidade (mm, cm, m, polegada, GB, Hz, W, V, ohm, dB…) que contradiz valor de mesma
 *     unidade presente no nome do ERP ⇒ CONFLITO ⇒ reprova.
 */
const OFICIAIS = { 'KX3': ['kx3.com.br'], 'Permak': ['permak.com.br'], 'Bomber': ['bomber.com.br'], 'Tragial': ['tragial.com.br'], 'ASX': ['asx.com.br'] };

const tok = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/(\d)\.(\d)/g, '$1$2').replace(/(\d),(\d)/g, '$1$2').replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
  .split(/[^a-z0-9]+/).filter(Boolean);

const UNIDADES = [['mm', /^mm$/], ['cm', /^cm$/], ['m', /^(m|metros?)$/], ['pol', /^(polegadas?|pol|["″”']{1,2})$/], ['gb', /^gb$/],
  ['khz', /^khz$/], ['hz', /^hz$/], ['kg', /^kg$/], ['w', /^(w|watts?|wrms)$/], ['v', /^(v|volts?)$/], ['ohm', /^ohms?$/], ['db', /^db$/]];
function pares(texto) {
  const t = String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const out = [], re = /(\d+(?:[.,]\d+)?)\s*(mm|cm|metros?|polegadas?|pol\b|["″”']{1,2}|gb|khz|hz|kg|wrms|watts?|ohms?|db|w\b|v\b|m\b)/g;
  let m;
  while ((m = re.exec(t))) { const u = UNIDADES.find(x => x[1].test(m[2])); if (u) out.push([m[1].replace(/[.,]/g, ''), u[0]]); }
  return out;
}

/** @param {{desc:string, erp:{name:string,brand?:string,ref:string}, marca:string, extras?:string[], fonte?:object}} x
 *  @returns {{ok:boolean, externos:string[], problemas:string[]}} */
function verificarNumeros(x) {
  const desc = String(x.desc || ''), erp = x.erp || {};
  const cad = new Set(tok([erp.name, erp.brand, erp.ref, x.marca].concat(x.extras || []).join(' ')));
  const externos = [...new Set(tok(desc).filter(t => /\d/.test(t) && !cad.has(t)))];
  const problemas = [];
  if (!externos.length) return { ok: true, externos, problemas };
  const f = x.fonte;
  if (!f || typeof f !== 'object') return { ok: false, externos, problemas: ['número fora do cadastro sem fonteNumeros: ' + externos.join(',')] };

  let host = '';
  try { const u = new URL(f.url); if (u.protocol === 'https:') host = u.hostname.toLowerCase(); } catch (e) { /* url inválida */ }
  const dom = OFICIAIS[x.marca];
  if (!host || !dom || !dom.some(d => host === d || host.endsWith('.' + d))) problemas.push('fonte não é domínio oficial da marca (' + (x.marca || 'sem marca') + ')');

  const trechos = Array.isArray(f.trechos) ? f.trechos.filter(s => typeof s === 'string' && s.trim()) : [];
  if (!trechos.length) problemas.push('fonteNumeros sem trechos');
  const sku = tok(erp.ref), skuT = typeof f.skuTrecho === 'string' ? tok(f.skuTrecho) : [];
  const contem = sku.length && skuT.some((_, i) => sku.every((t, j) => skuT[i + j] === t));
  if (!contem) problemas.push('skuTrecho não contém o código exato do ERP (' + erp.ref + ')');

  trechos.concat(typeof f.skuTrecho === 'string' ? [f.skuTrecho] : []).forEach(s => {
    if (/embalagem|conte[uú]do d|garanti|promo|desconto|R\$/i.test(s)) problemas.push('trecho de embalagem/garantia/preço não vale como evidência: "' + s.slice(0, 40) + '"');
  });
  const naFonte = new Set(tok(trechos.join(' ')));
  externos.forEach(t => { if (!naFonte.has(t)) problemas.push('número "' + t + '" não está literalmente nos trechos da fonte'); });

  if (/R\$|%|garanti|promo|desconto|frete|gr[aá]tis|oferta/i.test(desc)) problemas.push('descrição cita preço/promoção/garantia/condição de venda');
  if (/\b\d+\s*(unidades?|un\b|pe[cç]as?|p[cç]s|pacotes?|caixas?|embalagens?|cartelas?|pares?|kits?)\b/i.test(desc)
    || /\b(acompanha|acompanham|inclui|incluem|cont[eé]m|vem com)\b[^.;]*\d/i.test(desc)) problemas.push('quantidade de embalagem/conteúdo na descrição');

  const pe = pares(erp.name || '');
  pares(desc).forEach(([n, u]) => {
    const doErp = pe.filter(p => p[1] === u).map(p => p[0]);
    if (doErp.length && !doErp.includes(n)) problemas.push('CONFLITO com ERP: ' + n + ' ' + u + ' × ERP ' + doErp.join('/') + ' ' + u);
  });
  return { ok: problemas.length === 0, externos, problemas };
}

module.exports = { verificarNumeros, OFICIAIS, tok, pares };
