/**
 * Sync de produtos — MR4 Distribuidora (Fase A: blindagem).
 * Busca todos os produtos do GestãoClick e atualiza data/produtos.json — SOMENTE se o resultado for completo, íntegro e diferente do atual.
 *
 * Princípios:
 *  - FAIL-SAFE: qualquer página que falhe de forma definitiva, resposta estruturalmente incompleta/estranha ou catálogo vazio ABORTA o sync
 *    (exit 1, marcador SYNC_ABORTED_*). O feed anterior permanece intacto; nada é gerado, commitado ou publicado.
 *  - Escrita ATÔMICA: o novo conteúdo é validado e só então substitui o arquivo (temporário + rename).
 *  - IDEMPOTENTE: se produtos/preços/estoques são os mesmos, o arquivo não é tocado (zero commit). `atualizado` = última MUDANÇA real dos dados.
 *  - Rede: timeout por tentativa, retry com backoff+jitter só para falhas transitórias (timeout, rede, 429, 5xx), concorrência limitada.
 *  - Logs sem segredos. Rodado pelo GitHub Actions (hoje a cada 30 min; o gatilho é outra fase).
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const Core = require('../js/catalogo-core.js');   // higiene de exibição (resíduo fiscal) — mesma lógica do navegador

const API_BASE    = 'https://api.gestaoclick.com';
const OUTPUT_PATH = path.join(__dirname, '../data/produtos.json');
const LIMITE      = 100;

/** parâmetros operacionais (observado em produção: página 1 ≈ 1,2 s; demais ≈ 1 s) */
const CONFIG = {
  timeoutMs: 20000,          // por tentativa (≈ 16× o normal; evita pendurar sem abortar cedo demais)
  maxTentativas: 3,          // 1 original + 2 retries
  backoffBaseMs: 1000,       // 1 s, 2 s (× 2 por tentativa) + jitter até 25 %; teto 8 s
  backoffMaxMs: 8000,
  retryAfterMaxMs: 10000,    // HTTP 429: respeita Retry-After até este teto
  concorrencia: 3,           // páginas 2..N: no máximo 3 requisições simultâneas (antes: todas de uma vez)
  prazoTotalMs: 240000,      // teto de tempo da coleta inteira (4 min): depois disso aborta
  maxPaginas: 200,           // sanidade de meta.total_paginas
  toleranciaCampos: 0.02,    // até 2 % (mín. 3 itens) com campo estrutural ausente é tolerado e registrado; acima disso ABORTA
  minToleranciaItens: 3,
  quedaElegivelMax: 0.70,    // queda > 70 % dos itens elegíveis exige confirmação humana (SYNC_PERMITIR_QUEDA=1)
  quedaMinBase: 20           // só avalia queda quando o feed anterior tinha ≥ 20 itens
};

class SyncAbort extends Error {
  constructor(codigo, detalhe) { super(detalhe || codigo); this.codigo = codigo; this.detalhe = detalhe || ''; }
}

/* ───────── logs sem segredos ───────── */
function criarLog(env, escrever) {
  const segredos = [env.GC_ACCESS_TOKEN, env.GC_SECRET_ACCESS_TOKEN].filter(s => s && String(s).length >= 4).map(String);
  const limpar = t => segredos.reduce((s, x) => s.split(x).join('[REDACTED]'), String(t)).replace(/(access-token|secret-access-token|authorization)[:=]\s*\S+/gi, '$1: [REDACTED]');
  const out = escrever || (t => console.log(t));
  const log = t => out(limpar(t));
  log.erro = t => (escrever ? out : console.error)(limpar(t));
  log.limpar = limpar;
  return log;
}

const dormir = ms => new Promise(r => setTimeout(r, ms));

/** uma página do GestãoClick: timeout por tentativa + retry só em falha transitória */
async function buscarPagina(url, deps) {
  const { fetchFn, headers, cfg, log, sleep, rand, rotulo } = deps;
  let ultimo = 'erro desconhecido';
  for (let t = 1; t <= cfg.maxTentativas; t++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
    let transitorio = true, esperaExtra = 0;
    try {
      const res = await fetchFn(url, { headers, signal: ac.signal });
      if (res.ok) {
        const json = await res.json();                                   // o corpo também está sob o timeout
        clearTimeout(timer);
        if (json === null || typeof json !== 'object') throw new Error('corpo JSON inesperado');
        if (t > 1) log(`[sync] ${rotulo} recuperada na tentativa ${t}`);
        return json;
      }
      ultimo = `HTTP ${res.status}`;
      if (res.status === 429) {
        const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
        if (isFinite(ra) && ra > 0) esperaExtra = Math.min(ra * 1000, cfg.retryAfterMaxMs);
      } else if (res.status < 500) transitorio = false;                  // 4xx (≠ 429): permanente, sem retry
    } catch (e) {
      ultimo = ac.signal.aborted ? `timeout ${cfg.timeoutMs} ms` : String(e && e.message ? e.message : e).slice(0, 120);
    } finally { clearTimeout(timer); }
    log(`[sync] ${rotulo} tentativa ${t}/${cfg.maxTentativas} falhou: ${ultimo}`);
    if (!transitorio) throw new SyncAbort('SYNC_ABORTED_API_FAILURE', `${rotulo}: ${ultimo} (erro permanente, sem retry)`);
    if (t < cfg.maxTentativas) {
      const exp = Math.min(cfg.backoffMaxMs, cfg.backoffBaseMs * Math.pow(2, t - 1));
      await sleep(Math.max(esperaExtra, exp + Math.floor(exp * 0.25 * rand())));
    }
  }
  throw new SyncAbort('SYNC_ABORTED_API_FAILURE', `${rotulo}: ${ultimo} após ${cfg.maxTentativas} tentativas`);
}

/** todas as páginas, ou aborta. Retorna { paginas: [lista...], totalPaginas, meta } */
async function coletarPaginas(deps) {
  const { cfg, log, agora } = deps;
  const inicio = agora();
  const prazo = () => { if (agora() - inicio > cfg.prazoTotalMs) throw new SyncAbort('SYNC_ABORTED_API_FAILURE', `prazo total de ${cfg.prazoTotalMs} ms excedido`); };
  const urlPag = p => `${API_BASE}/produtos?pagina=${p}&limite=${LIMITE}`;
  log('[sync] solicitando página 1');
  const primeira = await buscarPagina(urlPag(1), Object.assign({}, deps, { rotulo: 'página 1' }));
  const meta = primeira.meta || {};
  const totalPaginas = Number(meta.total_paginas);
  if (!Number.isInteger(totalPaginas) || totalPaginas < 1 || totalPaginas > cfg.maxPaginas) throw new SyncAbort('SYNC_ABORTED_INVALID_STRUCTURE', `meta.total_paginas inválido (${JSON.stringify(meta.total_paginas)})`);
  if (!Array.isArray(primeira.data)) throw new SyncAbort('SYNC_ABORTED_INVALID_STRUCTURE', 'página 1 sem lista "data"');
  log(`[sync] total de páginas: ${totalPaginas}`);
  const paginas = new Array(totalPaginas);
  paginas[0] = primeira.data;
  const fila = []; for (let p = 2; p <= totalPaginas; p++) fila.push(p);
  let falha = null;
  const operario = async () => {
    while (fila.length && !falha) {
      const p = fila.shift();
      try {
        prazo();
        log(`[sync] solicitando página ${p}`);
        const j = await buscarPagina(urlPag(p), Object.assign({}, deps, { rotulo: `página ${p}` }));
        if (!Array.isArray(j.data)) throw new SyncAbort('SYNC_ABORTED_INVALID_STRUCTURE', `página ${p} sem lista "data"`);
        paginas[p - 1] = j.data;
      } catch (e) { falha = falha || e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(cfg.concorrencia, Math.max(1, totalPaginas - 1)) }, operario));
  if (falha) throw falha instanceof SyncAbort ? falha : new SyncAbort('SYNC_ABORTED_API_FAILURE', String(falha.message || falha));
  return { paginas, totalPaginas, meta };
}

/** a resposta COMPLETA é estruturalmente coerente? (protege contra resposta parcial sem confundir com queda comercial) */
function validarCompletude({ paginas, totalPaginas, meta }) {
  const L1 = paginas[0].length;
  if (L1 === 0) throw new SyncAbort('SYNC_ABORTED_EMPTY_RESPONSE', 'página 1 vazia');
  paginas.forEach((pg, i) => {
    const ultima = i === paginas.length - 1;
    if (pg.length === 0) throw new SyncAbort('SYNC_ABORTED_PARTIAL_RESPONSE', `página ${i + 1} vazia`);
    if (!ultima && pg.length !== L1) throw new SyncAbort('SYNC_ABORTED_PARTIAL_RESPONSE', `página ${i + 1} com ${pg.length} itens (esperado ${L1})`);
    if (ultima && pg.length > L1) throw new SyncAbort('SYNC_ABORTED_PARTIAL_RESPONSE', `última página com ${pg.length} itens (> ${L1})`);
  });
  const bruto = paginas.reduce((s, p) => s + p.length, 0);
  const declarado = [meta.total_registros, meta.total, meta.registros].map(Number).find(n => isFinite(n) && n > 0);
  if (declarado !== undefined && declarado !== bruto) throw new SyncAbort('SYNC_ABORTED_PARTIAL_RESPONSE', `meta declara ${declarado} itens, recebidos ${bruto}`);
  const ids = new Set();
  paginas.forEach(pg => pg.forEach(p => { const id = p && (p.id != null ? p.id : p.codigo_interno); if (id != null) { if (ids.has(String(id))) throw new SyncAbort('SYNC_ABORTED_PARTIAL_RESPONSE', 'IDs duplicados entre páginas (catálogo mudou durante a leitura)'); ids.add(String(id)); } }));
  return bruto;
}

const campoPresente = v => v !== undefined && v !== null && v !== '' && isFinite(Number(v));

/** estrutura mínima de cada produto; campo ausente NUNCA vira 0 em silêncio: poucos itens = omitidos/“Sob consulta” com registro; muitos = ABORTA */
function analisarCampos(brutos, cfg, log) {
  const n = brutos.length, tol = Math.max(cfg.minToleranciaItens, Math.ceil(n * cfg.toleranciaCampos));
  const sem = { id: 0, nome: 0, estoque: 0, valores: 0 };
  brutos.forEach(p => {
    if (!p || typeof p !== 'object') { sem.id++; sem.nome++; sem.estoque++; sem.valores++; return; }
    if (p.id == null && p.codigo_interno == null && p.codigo == null) sem.id++;
    if (typeof p.nome !== 'string' || !p.nome.trim()) sem.nome++;
    if (!campoPresente(p.estoque)) sem.estoque++;
    if (!Array.isArray(p.valores)) sem.valores++;                           // estrutura de preço ausente ≠ preço real zero/vazio
  });
  const regra = [['id', 'SYNC_ABORTED_INVALID_STRUCTURE'], ['nome', 'SYNC_ABORTED_INVALID_STRUCTURE'], ['estoque', 'SYNC_ABORTED_STOCK_FIELD'], ['valores', 'SYNC_ABORTED_PRICE_STRUCTURE']];
  regra.forEach(([k, cod]) => { if (sem[k] > tol) throw new SyncAbort(cod, `campo "${k}" ausente/inválido em ${sem[k]} de ${n} produtos (tolerância ${tol})`); });
  Object.keys(sem).forEach(k => { if (sem[k]) log(`[sync] AVISO: ${sem[k]} produto(s) sem "${k}" válido (dentro da tolerância ${tol}); ${k === 'estoque' ? 'omitidos do feed neste ciclo' : k === 'valores' ? 'publicados como "Sob consulta"' : 'tratados com valor padrão'}`); });
  return sem;
}

function extraiMarca(p) {
  // Atributos do GestãoClick: [{atributo: {descricao, conteudo}}]
  const atribs = p.atributos || [];
  if (Array.isArray(atribs)) {
    const m = atribs.find(a => a.atributo && /^marca$/i.test((a.atributo.descricao || '').trim()));
    if (m) return (m.atributo.conteudo || '').trim();
  }
  return '';
}

function normalizaProdutos(lista) {
  return lista.map(p => {
    const valores = p.valores || [];
    const preco   = valores.length > 0 ? (valores[0].valor_venda || 0) : 0;
    const fotos   = p.fotos || [];
    const img     = fotos.length > 0 ? fotos[0] : '';
    return {
      id:       p.id || p.codigo_interno,
      ref:      p.codigo_interno || p.codigo || '—',
      name:     Core.limparNome(p.nome || '—'),
      category: (p.nome_grupo || p.grupo || p.categoria || 'Geral').trim(),
      brand:    extraiMarca(p),
      price:    formatPrice(preco),
      stock:    campoPresente(p.estoque) ? Number(p.estoque) : 0,          // ausência é tratada ANTES (analisarCampos); aqui só sobra tolerância
      stockOk:  campoPresente(p.estoque),
      img:      img,
      desc:     Core.limparDescricao(p.descricao || p.observacoes || ''),   // só a versão publicada; o ERP não é alterado
    };
  });
}

function formatPrice(valor) {
  if (!valor || valor === 0) return 'Sob consulta';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor));
}

/** ordenação comercial definida pela MR4 (inalterada) */
function ordenarProdutos(comEstoque) {
  // Ordem de categorias definida pela MR4 (apóstrofo curvo exato do GestãoClick)
  const ORDEM_CATEGORIAS = [
    "Led\u2019s interno/externo", "Lâmpada de led", "Lâmpada de led ",
    "Lâmpadas Halógenas", "Câmera", "Multimídia", "Rádio",
    "Sensor estacionamento", "Alto-Falantes", "Chave", "Farol de milha",
    "Fusíveis", "Terminais", "Chicotes", "Soquetes", "Antenas",
    "Palheta", "Bateria", "Travas", "Diversos", "PRODUTOS SEM GRUPO", "Moldura", "Geral",
  ];
  const normCat = s => (s||'').trim().toLowerCase().replace(/[\u2018\u2019\u02bc']/g, "'");
  const CAT_LED_KIT = "lâmpada de led";
  const CAT_LED_INT = "led's interno/externo";
  const prioridade = cat => {
    const nc = normCat(cat);
    const idx = ORDEM_CATEGORIAS.findIndex(c => normCat(c) === nc);
    return idx >= 0 ? idx : ORDEM_CATEGORIAS.length - 3;
  };
  const precoNum = p => {
    const s = (p.price||'').replace(/[^\d,]/g,'').replace(',','.');
    return parseFloat(s)||0;
  };
  const ENCAIXE_ORDER = ['H1','H3','H4','H7','H8','H11','H16','H27','HB3','HB4','D1','D2','D3','D4','D5','T5','T10','T15','T20'];
  const encaixePrio = nome => {
    const n = (nome||'').toUpperCase();
    for (let i = 0; i < ENCAIXE_ORDER.length; i++) {
      if (n.includes(' '+ENCAIXE_ORDER[i]+' ') || n.includes(' '+ENCAIXE_ORDER[i]+'/') || n.endsWith(' '+ENCAIXE_ORDER[i])) return i;
    }
    return 999;
  };
  const LINHAS_CONHECIDAS = ['V10','Y3','NANO','SKY','ULTRA','FENIX','FÊNIX','P17'];
  const linhaLed = nome => {
    const n = (nome||'').toUpperCase();
    if(n.includes('V10'))  return 'V10';
    if(n.includes('Y3'))   return 'Y3';
    if(n.includes('NANO')) return 'NANO';
    if(n.includes('SKY'))  return 'SKY';
    if(n.includes('ULTRA'))return 'ULTRA';
    if(n.includes('FENIX')||n.includes('FÊNIX')) return 'FENIX';
    if(n.includes('P17'))  return 'P17';
    return n.split(' ')[0]||'ZZZ';
  };
  const isLinhaConhecida = nome => LINHAS_CONHECIDAS.some(l => (nome||'').toUpperCase().includes(l));
  const INTERNO_TIPOS = ['T5','T10','T15','T20','1 POLO','2 POLO','2 POLOS','TORPEDO','PLACA'];
  const internoPrio = nome => {
    const n = (nome||'').toUpperCase();
    for(let i=0;i<INTERNO_TIPOS.length;i++) if(n.includes(INTERNO_TIPOS[i])) return i;
    return 999;
  };
  // Menor preço por linha de LED kit (só linhas conhecidas)
  const linhaMinPreco = {};
  comEstoque.filter(p=>normCat(p.category)===CAT_LED_KIT && isLinhaConhecida(p.name)).forEach(p=>{
    const l=linhaLed(p.name), pr=precoNum(p);
    if(pr>0 && (!linhaMinPreco[l]||pr<linhaMinPreco[l])) linhaMinPreco[l]=pr;
  });

  comEstoque.sort((a, b) => {
    const pa = prioridade(a.category), pb = prioridade(b.category);
    if (pa !== pb) return pa - pb;
    const catA = normCat(a.category), catB = normCat(b.category);
    // Lâmpada de led: linhas conhecidas primeiro (V10,Y3,NANO...) → por menor preço → encaixe → preço
    if (catA === CAT_LED_KIT) {
      const ka=isLinhaConhecida(a.name), kb=isLinhaConhecida(b.name);
      if(ka!==kb) return ka?-1:1; // linhas conhecidas antes de produtos genéricos
      const la=linhaLed(a.name), lb=linhaLed(b.name);
      if(la!==lb) return (linhaMinPreco[la]||9999)-(linhaMinPreco[lb]||9999);
      const ea=encaixePrio(a.name), eb=encaixePrio(b.name);
      if(ea!==eb) return ea-eb;
      return precoNum(a)-precoNum(b);
    }
    // Led's interno/externo: tipo (T10,T20...) → preço
    if (catA === CAT_LED_INT) {
      const ia=internoPrio(a.name), ib=internoPrio(b.name);
      if(ia!==ib) return ia-ib;
      return precoNum(a)-precoNum(b);
    }
      // Lâmpadas Halógenas: marca → encaixe → preço
    if(normCat(a.category)==='lâmpadas halógenas'){
      const ba=(a.brand||'').toLowerCase(),bb=(b.brand||'').toLowerCase();
      if(ba!==bb) return ba<bb?-1:1;
      const ea=encaixePrio(a.name),eb=encaixePrio(b.name);
      if(ea!==eb) return ea-eb;
      return precoNum(a)-precoNum(b);
    }
    // Alto-Falantes: marca → tamanho → preço
    if(normCat(a.category)==='alto-falantes'){
      const tsz=n=>{const nu=(n||'').toUpperCase();if(/\b4["´]|\b4\s+POL/.test(nu))return 0;if(/\b5["´]|\b5\s+POL/.test(nu))return 1;if(/\b6["´]|\b6\s+POL/.test(nu))return 2;if(/\b6\s*[Xx]\s*9\b/.test(nu))return 3;if(/\b8["´]|\b8\s+POL/.test(nu))return 4;if(/\b10["´]|\b10\s+POL/.test(nu))return 5;if(/\b12["´]|\b12\s+POL/.test(nu))return 6;return 999;};
      const ba=(a.brand||'').toLowerCase(),bb=(b.brand||'').toLowerCase();
      if(ba!==bb) return ba<bb?-1:1;
      const ta=tsz(a.name),tb=tsz(b.name);
      if(ta!==tb) return ta-tb;
      return precoNum(a)-precoNum(b);
    }
    // Fusíveis: tipo → amperagem → preço
    if(normCat(a.category)==='fusíveis'){
      const FTIPOS=['LAMINA','NORMAL','PADRÃO','MAX','MINI'];
      const tFus=n=>{const nu=(n||'').toUpperCase();for(let i=0;i<FTIPOS.length;i++)if(nu.includes(FTIPOS[i]))return i;return 999;};
      const aAmp=n=>{const m=(n||'').match(/\b(\d+)\s*A\b/i);return m?parseInt(m[1]):999;};
      const ta=tFus(a.name),tb=tFus(b.name);
      if(ta!==tb) return ta-tb;
      const aa=aAmp(a.name),ab=aAmp(b.name);
      if(aa!==ab) return aa-ab;
      return precoNum(a)-precoNum(b);
    }
    // Multimídia e Rádio: marca → tipo → tela → preço
    if(['multimídia','rádio'].includes(normCat(a.category))){
      const ba=(a.brand||'').toLowerCase(),bb=(b.brand||'').toLowerCase();
      if(ba!==bb) return ba<bb?-1:1;
      const tMid=n=>{const nu=(n||'').toUpperCase();if(nu.includes('MP3'))return 0;if(nu.includes('MP5'))return 1;if(nu.includes('ANDROID'))return 2;return 3;};
      const tTela=n=>{const m=(n||'').match(/\b(\d+)["'\s]*POL|\b(\d+)["]/i);return m?parseInt(m[1]||m[2]):999;};
      const ta=tMid(a.name),tb=tMid(b.name);
      if(ta!==tb) return ta-tb;
      const sa=tTela(a.name),sb=tTela(b.name);
      if(sa!==sb) return sa-sb;
      return precoNum(a)-precoNum(b);
    }
    // Chave e Farol: marca do carro → preço
    if(['chave','farol de milha'].includes(normCat(a.category))){
      const CARROS=['VOLKSWAGEN','VW','GM','CHEVROLET','FIAT','FORD','TOYOTA','HYUNDAI','HONDA','RENAULT'];
      const mCar=n=>{const nu=(n||'').toUpperCase();for(let i=0;i<CARROS.length;i++)if(nu.includes(CARROS[i]))return i;return 999;};
      const ba=(a.brand||'').toLowerCase(),bb=(b.brand||'').toLowerCase();
      if(ba!==bb) return ba<bb?-1:1;
      const ma=mCar(a.name),mb=mCar(b.name);
      if(ma!==mb) return ma-mb;
      return precoNum(a)-precoNum(b);
    }
    // Demais: marca → preço crescente
    const ba=(a.brand||'').toLowerCase(),bb=(b.brand||'').toLowerCase();
    if(ba!==bb) return ba<bb?-1:1;
    return precoNum(a)-precoNum(b);
  });
  return comEstoque;
}

/** identidade comercial do feed (independe da ordem): se igual, não há o que publicar */
function assinatura(lista) {
  return (lista || []).map(p => JSON.stringify([p.id, p.ref, p.name, p.category, p.brand, p.price, p.stock, p.img, p.desc])).sort().join('\n');
}

function lerAnterior(arquivo) {
  try { const d = JSON.parse(fs.readFileSync(arquivo, 'utf8')); return d && Array.isArray(d.produtos) ? d : null; } catch (e) { return null; }
}

/** escrita atômica: temporário no mesmo diretório + validação de leitura + rename */
function escreverAtomico(arquivo, objeto) {
  const tmp = `${arquivo}.tmp-${process.pid}`;
  const texto = JSON.stringify(objeto);
  fs.writeFileSync(tmp, texto, 'utf8');
  try {
    const lido = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    if (!Array.isArray(lido.produtos) || lido.produtos.length !== objeto.produtos.length) throw new Error('validação pós-escrita falhou');
    fs.renameSync(tmp, arquivo);
  } catch (e) { try { fs.unlinkSync(tmp); } catch (x) {} throw new SyncAbort('SYNC_ABORTED_WRITE_FAILURE', String(e.message || e)); }
}

/** núcleo testável: devolve { estado: 'MUDOU' | 'SEM_MUDANCA', ... } ou lança SyncAbort */
async function executarSync(opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const cfg = Object.assign({}, CONFIG, opts.config || {});
  const log = opts.log || criarLog(env);
  const saida = opts.saida || OUTPUT_PATH;
  const agora = opts.agora || Date.now;
  const fetchFn = opts.fetchFn || fetch;
  const headers = { 'access-token': env.GC_ACCESS_TOKEN, 'secret-access-token': env.GC_SECRET_ACCESS_TOKEN, 'Content-Type': 'application/json' };
  if (!opts.fetchFn && (!env.GC_ACCESS_TOKEN || !env.GC_SECRET_ACCESS_TOKEN)) throw new SyncAbort('SYNC_ABORTED_API_FAILURE', 'credenciais do GestãoClick ausentes no ambiente');
  const deps = { fetchFn, headers, cfg, log, sleep: opts.sleep || dormir, rand: opts.rand || Math.random, agora };

  log('[sync] início');
  const coleta = await coletarPaginas(deps);
  const bruto = validarCompletude(coleta);
  const brutos = [].concat(...coleta.paginas);
  const sem = analisarCampos(brutos, cfg, log);
  log(`[sync] total bruto: ${bruto} produtos em ${coleta.totalPaginas} páginas`);

  const todos = normalizaProdutos(brutos);
  const comEstoque = todos.filter(p => p.stock > 0).map(p => { const { stockOk, ...resto } = p; return resto; });   // só produtos com estoque (estoque desconhecido já virou 0 e fica de fora)
  ordenarProdutos(comEstoque);
  const anterior = lerAnterior(saida);
  const nAnt = anterior ? anterior.produtos.length : 0;
  log(`[sync] total elegível (estoque > 0): ${comEstoque.length} | anterior: ${nAnt}`);

  if (comEstoque.length === 0 && nAnt > 0) throw new SyncAbort('SYNC_ABORTED_ZERO_PRODUCTS', `nenhum produto elegível (anterior: ${nAnt})`);
  if (nAnt >= cfg.quedaMinBase && comEstoque.length < nAnt * (1 - cfg.quedaElegivelMax) && !(env.SYNC_PERMITIR_QUEDA === '1' || env.SYNC_PERMITIR_QUEDA === 'true'))
    throw new SyncAbort('SYNC_ABORTED_LARGE_DROP', `elegíveis ${nAnt} → ${comEstoque.length} (queda > ${Math.round(cfg.quedaElegivelMax * 100)} % numa resposta estruturalmente completa; confirme manualmente com SYNC_PERMITIR_QUEDA=1)`);

  const mudou = !anterior || assinatura(anterior.produtos) !== assinatura(comEstoque);
  if (!mudou) { log('[sync] SYNC_NO_CHANGE: nenhuma mudança comercial; feed mantido (sem commit)'); return { estado: 'SEM_MUDANCA', bruto, elegiveis: comEstoque.length, anterior: nAnt, ignorados: sem }; }

  const output = { produtos: comEstoque, total: comEstoque.length, atualizado: new Date(agora()).toISOString() };   // `atualizado` = última MUDANÇA real dos dados
  escreverAtomico(saida, output);
  log(`[sync] SYNC_CHANGED: ${comEstoque.length} produtos gravados (anterior ${nAnt})`);
  return { estado: 'MUDOU', bruto, elegiveis: comEstoque.length, anterior: nAnt, ignorados: sem };
}

function publicarSaidaActions(env, pares) {
  if (!env.GITHUB_OUTPUT) return;
  try { fs.appendFileSync(env.GITHUB_OUTPUT, Object.keys(pares).map(k => `${k}=${pares[k]}`).join('\n') + '\n'); } catch (e) {}
}

module.exports = { CONFIG, SyncAbort, executarSync, buscarPagina, coletarPaginas, validarCompletude, analisarCampos, normalizaProdutos, formatPrice, ordenarProdutos, assinatura, escreverAtomico, criarLog, extraiMarca };

if (require.main === module) {
  const log = criarLog(process.env);
  executarSync().then(r => {
    publicarSaidaActions(process.env, { estado: r.estado, mudou: r.estado === 'MUDOU' ? 'true' : 'false', elegiveis: r.elegiveis });
    log(`✅ Sync ${r.estado === 'MUDOU' ? 'atualizou o feed' : 'sem mudança'}: ${r.elegiveis} produtos elegíveis`);
  }).catch(err => {
    const codigo = err instanceof SyncAbort ? err.codigo : 'SYNC_ABORTED_UNEXPECTED';
    log.erro(`❌ ${codigo}: ${err.detalhe || err.message} — feed anterior mantido; nada será gerado, commitado ou publicado`);
    publicarSaidaActions(process.env, { estado: codigo, mudou: 'false' });
    process.exit(1);
  });
}
