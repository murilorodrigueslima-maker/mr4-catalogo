'use strict';
// Fase A — blindagem do sync: API (timeout/retry/falha parcial), integridade, escrita atômica, idempotência, snapshot e push seguro.
// Tudo local: servidor GestãoClick SIMULADO por injeção de fetch (nenhuma rede, nenhum segredo real).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const S = require('../scripts/sync-produtos.js');
const G = require('../scripts/gerar-paginas.js');
const P = require('../scripts/git-push-seguro.js');

const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const tmpDir = p => fs.mkdtempSync(path.join(os.tmpdir(), p));

/* ───────── API simulada ───────── */
const mkBruto = (n, o) => Object.assign({ id: 1000 + n, codigo_interno: 'MR.' + String(n).padStart(4, '0'), nome: 'Produto Teste ' + n, nome_grupo: n % 2 ? 'Moldura' : 'Led’s interno/externo', valores: [{ valor_venda: 10 + n }], estoque: 5, atributos: [{ atributo: { descricao: 'Marca', conteudo: n % 3 ? 'Tiger' : 'LDCAR' } }], fotos: [] }, o || {});
/** catálogo bruto: paginas × limite itens; `mut(item, n)` altera cada item */
const catalogo = (paginas = 9, limite = 100, mut) => Array.from({ length: paginas * limite }, (_, i) => { const it = mkBruto(i + 1); return mut ? (mut(it, i + 1) || it) : it; });
/** fetch falso: `roteiro[pagina]` = lista de desfechos por tentativa: número = HTTP, 'ok', 'rede', 'timeout', 'json' */
function apiFalsa(itens, o) {
  o = o || {}; const limite = o.limite || 100, roteiro = o.roteiro || {}, meta = o.meta, chamadas = [];
  const total = Math.ceil(itens.length / limite);
  const f = async (url, init) => {
    const pag = Number(new URL(url).searchParams.get('pagina')); const k = (chamadas.filter(c => c === pag).length); chamadas.push(pag);
    const r = (roteiro[pag] || [])[k] || 'ok';
    if (r === 'rede') throw new Error('socket hang up');
    if (r === 'timeout') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    if (r === 'json') return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } };
    if (typeof r === 'number') return { ok: false, status: r, headers: { get: h => (h === 'retry-after' && r === 429 ? '2' : null) }, json: async () => ({}) };
    const data = o.paginasPersonalizadas && o.paginasPersonalizadas[pag] !== undefined ? o.paginasPersonalizadas[pag] : itens.slice((pag - 1) * limite, pag * limite);
    return { ok: true, status: 200, json: async () => ({ meta: Object.assign({ total_paginas: o.totalPaginas || total }, meta || {}), data }) };
  };
  f.chamadas = chamadas; return f;
}
const CFG = { timeoutMs: 40, backoffBaseMs: 1, backoffMaxMs: 2, prazoTotalMs: 60000 };
async function rodar(fetchFn, extra) {
  extra = extra || {};
  const dir = extra.dir || tmpDir('sync-'); const saida = path.join(dir, 'produtos.json');
  if (extra.anterior) fs.writeFileSync(saida, extra.anterior);
  const logs = [], esperas = [];
  const opts = { fetchFn, saida, config: Object.assign({}, CFG, extra.config), env: Object.assign({ GC_ACCESS_TOKEN: 'TOKEN-ACESSO-SECRETO-123', GC_SECRET_ACCESS_TOKEN: 'TOKEN-SEGREDO-SECRETO-456' }, extra.env), log: S.criarLog(Object.assign({ GC_ACCESS_TOKEN: 'TOKEN-ACESSO-SECRETO-123', GC_SECRET_ACCESS_TOKEN: 'TOKEN-SEGREDO-SECRETO-456' }, extra.env), t => logs.push(String(t))), sleep: async ms => { esperas.push(ms); }, rand: () => 0, agora: extra.agora };
  let resultado, erro;
  try { resultado = await S.executarSync(opts); } catch (e) { erro = e; }
  return { resultado, erro, saida, logs, esperas, dir, feed: () => (fs.existsSync(saida) ? JSON.parse(fs.readFileSync(saida, 'utf8')) : null) };
}
const feedAnterior = (n, o) => JSON.stringify({ produtos: Array.from({ length: n }, (_, i) => Object.assign({ id: 1000 + i + 1, ref: 'MR.' + String(i + 1).padStart(4, '0'), name: 'Produto Teste ' + (i + 1), category: 'Moldura', brand: 'Tiger', price: 'R$ 10,00', stock: 5, img: '', desc: '' }, o || {})), total: n, atualizado: '2026-10-01T00:00:00.000Z' });

/* ═════════════ API ═════════════ */
test('1. todas as páginas OK: 9 páginas → feed completo e ordenado', async () => {
  const r = await rodar(apiFalsa(catalogo()));
  assert.equal(r.erro, undefined); assert.equal(r.resultado.estado, 'MUDOU'); assert.equal(r.feed().total, 900); assert.equal(r.feed().produtos.length, 900);
  assert.ok(r.logs.some(l => /total de páginas: 9/.test(l)) && r.logs.some(l => /total bruto: 900/.test(l)) && r.logs.some(l => /total elegível.*anterior: 0/.test(l)));
});
test('2. página 1 com HTTP 500 persistente: 3 tentativas, depois ABORTA (SYNC_ABORTED_API_FAILURE)', async () => {
  const f = apiFalsa(catalogo(), { roteiro: { 1: [500, 500, 500] } });
  const r = await rodar(f, { anterior: feedAnterior(10) });
  assert.equal(r.erro.codigo, 'SYNC_ABORTED_API_FAILURE'); assert.equal(f.chamadas.filter(p => p === 1).length, 3);
  assert.equal(fs.readFileSync(r.saida, 'utf8'), feedAnterior(10));
});
test('3. página INTERMEDIÁRIA com 500 persistente: ABORTA (antes: engolia e publicava parcial)', async () => {
  const f = apiFalsa(catalogo(), { roteiro: { 5: [503, 503, 503, 503] } });
  const r = await rodar(f, { anterior: feedAnterior(10) });
  assert.equal(r.erro.codigo, 'SYNC_ABORTED_API_FAILURE'); assert.match(r.erro.detalhe, /página 5/);
  assert.equal(fs.readFileSync(r.saida, 'utf8'), feedAnterior(10));
});
test('4. ÚLTIMA página com 500 persistente: ABORTA', async () => {
  const r = await rodar(apiFalsa(catalogo(), { roteiro: { 9: [500, 502, 504] } }), { anterior: feedAnterior(10) });
  assert.equal(r.erro.codigo, 'SYNC_ABORTED_API_FAILURE'); assert.equal(fs.readFileSync(r.saida, 'utf8'), feedAnterior(10));
});
test('5. HTTP 429: retry respeitando Retry-After (até o teto); recupera', async () => {
  const r = await rodar(apiFalsa(catalogo(), { roteiro: { 3: [429, 'ok'] } }));
  assert.equal(r.erro, undefined); assert.equal(r.feed().total, 900);
  assert.ok(r.esperas.some(ms => ms >= 2000), 'esperou ao menos o Retry-After de 2 s'); assert.ok(r.esperas.every(ms => ms <= S.CONFIG.retryAfterMaxMs));
});
test('6. timeout: requisição pendurada é abortada (AbortController), 3 tentativas, depois ABORTA', async () => {
  const f = apiFalsa(catalogo(), { roteiro: { 2: ['timeout', 'timeout', 'timeout'] } });
  const r = await rodar(f);
  assert.equal(r.erro.codigo, 'SYNC_ABORTED_API_FAILURE'); assert.match(r.erro.detalhe, /timeout/); assert.equal(f.chamadas.filter(p => p === 2).length, 3);
});
test('7. erro de rede: retry e ABORTA quando esgota', async () => {
  const f = apiFalsa(catalogo(), { roteiro: { 4: ['rede', 'rede', 'rede'] } });
  const r = await rodar(f); assert.equal(r.erro.codigo, 'SYNC_ABORTED_API_FAILURE'); assert.match(r.erro.detalhe, /socket hang up/);
});
test('8. retry recupera falha transitória (500 → ok; rede → ok; timeout → ok; JSON truncado → ok)', async () => {
  const r = await rodar(apiFalsa(catalogo(), { roteiro: { 2: [500, 'ok'], 3: ['rede', 'ok'], 4: ['timeout', 'ok'], 5: ['json', 'ok'] } }));
  assert.equal(r.erro, undefined); assert.equal(r.feed().total, 900); assert.ok(r.logs.some(l => /página 2 recuperada na tentativa 2/.test(l)));
});
test('9. retries esgotados: MAX_ATTEMPTS = 3; erro permanente 4xx NÃO tem retry (1 tentativa); sem tempestade (concorrência ≤ 3)', async () => {
  assert.equal(S.CONFIG.maxTentativas, 3); assert.equal(S.CONFIG.timeoutMs, 20000); assert.equal(S.CONFIG.concorrencia, 3);
  const f = apiFalsa(catalogo(), { roteiro: { 6: [404] } }); const r = await rodar(f);
  assert.equal(r.erro.codigo, 'SYNC_ABORTED_API_FAILURE'); assert.equal(f.chamadas.filter(p => p === 6).length, 1); assert.match(r.erro.detalhe, /sem retry/);
  // simultaneidade máxima observada
  let ativas = 0, pico = 0; const base = apiFalsa(catalogo());
  const f2 = async (u, i) => { ativas++; pico = Math.max(pico, ativas); await new Promise(r => setTimeout(r, 5)); ativas--; return base(u, i); };
  await rodar(f2); assert.ok(pico <= 3, 'pico de requisições simultâneas: ' + pico);
  // backoff cresce e tem teto
  const g = await rodar(apiFalsa(catalogo(), { roteiro: { 2: [500, 500, 500] } }), { config: { backoffBaseMs: 1000, backoffMaxMs: 8000 } });
  assert.deepEqual(g.esperas.slice(0, 2), [1000, 2000]);
});

/* ═════════════ INTEGRIDADE ═════════════ */
test('10. resposta vazia (página 1 sem itens) e meta inválida: ABORTA', async () => {
  let r = await rodar(apiFalsa([], { totalPaginas: 1 }), { anterior: feedAnterior(10) }); assert.equal(r.erro.codigo, 'SYNC_ABORTED_EMPTY_RESPONSE');
  r = await rodar(apiFalsa(catalogo(), { totalPaginas: 'x' }), { anterior: feedAnterior(10) }); assert.equal(r.erro.codigo, 'SYNC_ABORTED_INVALID_STRUCTURE');
  r = await rodar(apiFalsa(catalogo(), { totalPaginas: -1 })); assert.equal(r.erro.codigo, 'SYNC_ABORTED_INVALID_STRUCTURE');
});
test('11. zero produtos elegíveis NUNCA substitui feed saudável (SYNC_ABORTED_ZERO_PRODUCTS)', async () => {
  const r = await rodar(apiFalsa(catalogo(9, 100, it => { it.estoque = 0; })), { anterior: feedAnterior(50) });
  assert.equal(r.erro.codigo, 'SYNC_ABORTED_ZERO_PRODUCTS'); assert.equal(fs.readFileSync(r.saida, 'utf8'), feedAnterior(50));
});
test('12. página inesperadamente vazia ou curta no meio: ABORTA (resposta parcial); IDs duplicados: ABORTA; meta divergente: ABORTA', async () => {
  const its = catalogo();
  let r = await rodar(apiFalsa(its, { paginasPersonalizadas: { 4: [] } })); assert.equal(r.erro.codigo, 'SYNC_ABORTED_PARTIAL_RESPONSE');
  r = await rodar(apiFalsa(its, { paginasPersonalizadas: { 4: its.slice(300, 380) } })); assert.equal(r.erro.codigo, 'SYNC_ABORTED_PARTIAL_RESPONSE'); assert.match(r.erro.detalhe, /página 4 com 80/);
  r = await rodar(apiFalsa(its, { paginasPersonalizadas: { 4: its.slice(200, 300) } })); assert.equal(r.erro.codigo, 'SYNC_ABORTED_PARTIAL_RESPONSE'); assert.match(r.erro.detalhe, /duplicados/);
  r = await rodar(apiFalsa(its, { meta: { total_registros: 950 } })); assert.equal(r.erro.codigo, 'SYNC_ABORTED_PARTIAL_RESPONSE'); assert.match(r.erro.detalhe, /declara 950/);
  r = await rodar(apiFalsa(its, { meta: { total_registros: 900 } })); assert.equal(r.erro, undefined);                // meta coerente passa
});
test('13. produto sem estoque (campo ausente): poucos = omitidos COM aviso (não vira 0 em silêncio)', async () => {
  const r = await rodar(apiFalsa(catalogo(9, 100, (it, n) => { if (n === 7) delete it.estoque; })));
  assert.equal(r.erro, undefined); assert.equal(r.feed().total, 899); assert.ok(!r.feed().produtos.some(p => p.ref === 'MR.0007'));
  assert.ok(r.logs.some(l => /AVISO: 1 produto\(s\) sem "estoque" válido.*omitidos do feed neste ciclo/.test(l)));
});
test('14. MUITOS produtos sem estoque: ABORTA (SYNC_ABORTED_STOCK_FIELD) e o feed atual não vira vazio', async () => {
  for (const tira of [it => { delete it.estoque; }, it => { it.estoque = null; }, it => { it.estoque = ''; }, it => { it.estoque = 'abc'; }]) {
    const r = await rodar(apiFalsa(catalogo(9, 100, it => { tira(it); })), { anterior: feedAnterior(40) });
    assert.equal(r.erro.codigo, 'SYNC_ABORTED_STOCK_FIELD'); assert.equal(fs.readFileSync(r.saida, 'utf8'), feedAnterior(40));
  }
  const r = await rodar(apiFalsa(catalogo(9, 100, (it, n) => { if (n <= 100) delete it.estoque; })), { anterior: feedAnterior(40) });   // 1 página inteira (11 %)
  assert.equal(r.erro.codigo, 'SYNC_ABORTED_STOCK_FIELD');
});
test('15. estrutura de preço AUSENTE (valores quebrado) ≠ preço real vazio: muitos ⇒ ABORTA; poucos ⇒ “Sob consulta” com aviso', async () => {
  let r = await rodar(apiFalsa(catalogo(9, 100, it => { delete it.valores; })), { anterior: feedAnterior(40) });
  assert.equal(r.erro.codigo, 'SYNC_ABORTED_PRICE_STRUCTURE'); assert.equal(fs.readFileSync(r.saida, 'utf8'), feedAnterior(40));
  r = await rodar(apiFalsa(catalogo(9, 100, it => { it.valores = 'quebrado'; })), { anterior: feedAnterior(40) }); assert.equal(r.erro.codigo, 'SYNC_ABORTED_PRICE_STRUCTURE');
  r = await rodar(apiFalsa(catalogo(9, 100, (it, n) => { if (n === 3) delete it.valores; })));
  assert.equal(r.erro, undefined); assert.equal(r.feed().produtos.find(p => p.ref === 'MR.0003').price, 'Sob consulta'); assert.ok(r.logs.some(l => /sem "valores" válido.*Sob consulta/.test(l)));
});
test('16/17. preço REAL zero / vazio / sem tabela de preço (valores = []) segue a regra existente: “Sob consulta”, sem abortar', async () => {
  const r = await rodar(apiFalsa(catalogo(9, 100, (it, n) => { if (n === 1) it.valores = [{ valor_venda: 0 }]; if (n === 2) it.valores = [{ valor_venda: '' }]; if (n === 3) it.valores = [{ valor_venda: null }]; if (n === 4) it.valores = []; if (n === 5) it.valores = [{ valor_venda: '149.9' }]; })));
  assert.equal(r.erro, undefined); const g = ref => r.feed().produtos.find(p => p.ref === ref).price;
  ['MR.0001', 'MR.0002', 'MR.0003', 'MR.0004'].forEach(x => assert.equal(g(x), 'Sob consulta', x)); assert.match(g('MR.0005'), /^R\$\s?149,90$/);
  assert.match(ler('scripts/sync-produtos.js'), /return 'Sob consulta'/); assert.match(ler('scripts/sync-produtos.js'), /todos\.filter\(p => p\.stock > 0\)/);
});
test('18. JSON inválido persistente / corpo não-objeto: ABORTA depois dos retries', async () => {
  let r = await rodar(apiFalsa(catalogo(), { roteiro: { 2: ['json', 'json', 'json'] } })); assert.equal(r.erro.codigo, 'SYNC_ABORTED_API_FAILURE');
  const f = async () => ({ ok: true, status: 200, json: async () => 'texto' }); r = await rodar(f); assert.equal(r.erro.codigo, 'SYNC_ABORTED_API_FAILURE');
  const g = async () => ({ ok: true, status: 200, json: async () => ({ meta: { total_paginas: 1 }, data: 'x' }) }); r = await rodar(g); assert.equal(r.erro.codigo, 'SYNC_ABORTED_INVALID_STRUCTURE');
});

/* ═════════════ PUBLICAÇÃO ═════════════ */
const mockPreload = dir => { const f = path.join(dir, 'mock-api.js'); fs.writeFileSync(f, `
const MODE = process.env.MODE, N = 9, L = 100;
const mk = (p, i) => { const n = (p - 1) * L + i + 1; return { id: 1000 + n, codigo_interno: 'MR.' + String(n).padStart(4, '0'), nome: 'Produto Teste ' + n, nome_grupo: 'Moldura', valores: MODE === 'sempreco' ? undefined : [{ valor_venda: 10 + n }], estoque: MODE === 'semestoque' ? undefined : 5, atributos: [], fotos: [] }; };
global.fetch = async (url) => { const p = Number(new URL(url).searchParams.get('pagina'));
  if (MODE === 'pag4' && p === 4) return { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ meta: { total_paginas: N }, data: Array.from({ length: L }, (_, i) => mk(p, i)) }) }; };
`); return f; };
function projetoGit(dir, produtosAnteriores) {
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true }); fs.mkdirSync(path.join(dir, 'js')); fs.mkdirSync(path.join(dir, 'data'));
  fs.copyFileSync(path.join(RAIZ, 'scripts/sync-produtos.js'), path.join(dir, 'scripts/sync-produtos.js')); fs.copyFileSync(path.join(RAIZ, 'js/catalogo-core.js'), path.join(dir, 'js/catalogo-core.js'));
  fs.writeFileSync(path.join(dir, 'data/produtos.json'), produtosAnteriores);
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '-A'); g('commit', '-q', '-m', 'base'); return g;
}
function cli(dir, mode) {
  const out = path.join(dir, 'gh-output.txt'); fs.writeFileSync(out, '');
  const r = spawnSync('node', ['-r', mockPreload(dir), 'scripts/sync-produtos.js'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, MODE: mode, GC_ACCESS_TOKEN: 'TOKEN-ACESSO-SECRETO-123', GC_SECRET_ACCESS_TOKEN: 'TOKEN-SEGREDO-SECRETO-456', GITHUB_OUTPUT: out } });
  return { status: r.status, saida: r.stdout + r.stderr, gh: fs.readFileSync(out, 'utf8') };
}
test('19/20/21. falha NÃO altera o feed, NÃO gera páginas e NÃO gera commit/alteração no repositório (CLI real, API simulada)', () => {
  const dir = tmpDir('sync-cli-'); const anterior = feedAnterior(25); const g = projetoGit(dir, anterior);
  const r = cli(dir, 'pag4');
  assert.equal(r.status, 1); assert.match(r.saida, /SYNC_ABORTED_API_FAILURE/); assert.match(r.gh, /mudou=false/); assert.doesNotMatch(r.gh, /mudou=true/);
  assert.equal(fs.readFileSync(path.join(dir, 'data/produtos.json'), 'utf8'), anterior);
  assert.equal(g('status', '--porcelain').replace(/.*(mock-api\.js|gh-output\.txt).*\n?/g, '').trim(), '');            // repositório limpo (exceto os arquivos do próprio teste)
  assert.equal(g('rev-list', '--count', 'HEAD').trim(), '1');                                                           // nenhum commit novo
  assert.equal(fs.readdirSync(path.join(dir, 'data')).filter(f => /tmp/.test(f)).length, 0);                            // nenhum temporário sobrando
  assert.ok(!fs.existsSync(path.join(dir, 'produto')) && !fs.existsSync(path.join(dir, 'index.html')));                 // nenhuma página gerada
});
test('S1. catálogo PARCIAL (900 esperados → página intermediária falha → só 800): SYNC_ABORTED, feed intacto, nenhum commit', () => {
  const dir = tmpDir('sync-parcial-'); const anterior = feedAnterior(300); const g = projetoGit(dir, anterior);
  const r = cli(dir, 'pag4');
  assert.equal(r.status, 1); assert.match(r.saida, /SYNC_ABORTED/); assert.doesNotMatch(r.saida, /800 produtos/);
  assert.equal(fs.readFileSync(path.join(dir, 'data/produtos.json'), 'utf8'), anterior); assert.equal(g('rev-list', '--count', 'HEAD').trim(), '1');
});
test('S2. catálogo VAZIO (API sem campo de estoque): SYNC_ABORTED, feed atual NÃO vira vazio', () => {
  const dir = tmpDir('sync-vazio-'); const anterior = feedAnterior(300); projetoGit(dir, anterior);
  const r = cli(dir, 'semestoque');
  assert.equal(r.status, 1); assert.match(r.saida, /SYNC_ABORTED_STOCK_FIELD/); assert.equal(fs.readFileSync(path.join(dir, 'data/produtos.json'), 'utf8'), anterior);
  const q = cli(dir, 'sempreco'); assert.equal(q.status, 1); assert.match(q.saida, /SYNC_ABORTED_PRICE_STRUCTURE/);
});
test('S3. REDUÇÃO LEGÍTIMA (estoque zerado, resposta completa) NÃO é bloqueada; só queda extrema (>70 %) exige confirmação', async () => {
  const anterior = feedAnterior(900);
  let r = await rodar(apiFalsa(catalogo(9, 100, (it, n) => { if (n % 5 < 2) it.estoque = 0; })), { anterior });          // 40 % zerados (venda grande/inventário)
  assert.equal(r.erro, undefined); assert.equal(r.resultado.estado, 'MUDOU'); assert.equal(r.feed().total, 540);
  r = await rodar(apiFalsa(catalogo(9, 100, (it, n) => { if (n % 20 >= 7) it.estoque = 0; })), { anterior });             // 65 % zerados: ainda passa
  assert.equal(r.erro, undefined); assert.equal(r.feed().total, 315);
  r = await rodar(apiFalsa(catalogo(9, 100, (it, n) => { if (n % 10 !== 0) it.estoque = 0; })), { anterior });            // 90 % zerados: pede confirmação
  assert.equal(r.erro.codigo, 'SYNC_ABORTED_LARGE_DROP'); assert.equal(fs.readFileSync(r.saida, 'utf8'), anterior);
  r = await rodar(apiFalsa(catalogo(9, 100, (it, n) => { if (n % 10 !== 0) it.estoque = 0; })), { anterior, env: { SYNC_PERMITIR_QUEDA: '1' } });   // humano confirma
  assert.equal(r.erro, undefined); assert.equal(r.feed().total, 90);
  assert.match(ler('.github/workflows/sync-produtos.yml'), /permitir_queda_grande/);
});
test('escrita ATÔMICA: temporário + validação + rename; falha de escrita preserva o feed e não deixa lixo', async () => {
  assert.match(ler('scripts/sync-produtos.js'), /\.tmp-\$\{process\.pid\}[\s\S]*renameSync/);
  const dir = tmpDir('sync-atomico-'); const alvo = path.join(dir, 'p.json'); fs.writeFileSync(alvo, 'ANTIGO');
  assert.throws(() => S.escreverAtomico(path.join(dir, 'naoexiste', 'p.json'), { produtos: [1], total: 1 }));
  S.escreverAtomico(alvo, { produtos: [{ a: 1 }], total: 1 }); assert.equal(JSON.parse(fs.readFileSync(alvo, 'utf8')).total, 1); assert.deepEqual(fs.readdirSync(dir), ['p.json']);
});

/* snapshot lógico: feed + páginas + Schema + sitemap juntos */
function raizGeracao(feedObj) {
  const dir = tmpDir('snap-'); fs.mkdirSync(path.join(dir, 'data'));
  fs.cpSync(path.join(RAIZ, 'templates'), path.join(dir, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data/produtos.json'), JSON.stringify(feedObj));
  return dir;
}
const feedDe = itens => ({ produtos: itens, total: itens.length, atualizado: '2026-10-03T10:00:00.000Z' });
const prod = (n, o) => Object.assign({ id: String(n), ref: 'MR.' + String(n).padStart(4, '0'), name: 'Produto Teste ' + n, category: 'Moldura', brand: 'Tiger', price: 'R$ ' + (10 + n) + ',00', stock: 5, img: '', desc: '' }, o || {});
const ofertaDe = (dir, ref) => { const m = JSON.parse(fs.readFileSync(path.join(dir, 'produto/manifest.json'), 'utf8')).produtos; const pasta = Object.keys(m).find(k => k.endsWith(ref.toLowerCase().replace('.', '-')) ) ; const h = pasta ? fs.readFileSync(path.join(dir, 'produto', m[pasta], 'index.html'), 'utf8') : ''; const ld = h.match(/application\/ld\+json">([\s\S]*?)<\/script>/); const g = ld ? JSON.parse(ld[1])['@graph'] : []; const p = g.find(n => n['@type'] === 'Product'); return { html: h, offer: p && p.offers, produto: p, existe: !!pasta }; };

test('22. snapshot válido: sync + gerador no MESMO estado — JSON, páginas, Schema/Offer e sitemap coerentes', async () => {
  const dir = tmpDir('snap-run-'); fs.mkdirSync(path.join(dir, 'data'));
  fs.cpSync(path.join(RAIZ, 'templates'), path.join(dir, 'templates'), { recursive: true });
  const r = await rodar(apiFalsa(catalogo(2, 100)), { dir: path.join(dir, 'data') });
  assert.equal(r.resultado.estado, 'MUDOU'); fs.renameSync(path.join(dir, 'data/produtos.json'), path.join(dir, 'data/produtos.json'));
  process.env.SYNC_FEED_VALIDADO = '1'; const g = G.executar(dir); delete process.env.SYNC_FEED_VALIDADO;
  assert.equal(g.saudavel, true); assert.equal(g.produtos, 200);
  const feed = JSON.parse(fs.readFileSync(path.join(dir, 'data/produtos.json'), 'utf8'));
  const sm = fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8'); const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.equal(locs.filter(u => /\/produto\//.test(u)).length, feed.total);                                       // sitemap = feed
  feed.produtos.slice(0, 5).forEach(p => { const o = ofertaDe(dir, p.ref); assert.ok(o.existe && o.offer, p.ref); assert.equal(o.offer.availability, 'https://schema.org/InStock'); });
});
test('23. duas execuções iguais: 2ª NÃO toca o feed (bytes e mtime idênticos), gerador escreve 0 arquivos, git sem diff, IndexNow vazio', async () => {
  const dir = raizGeracao(feedDe([])); const saida = path.join(dir, 'data/produtos.json'); fs.rmSync(saida);
  const f = apiFalsa(catalogo(2, 100));
  const r1 = await rodar(f, { dir: path.join(dir, 'data') }); assert.equal(r1.resultado.estado, 'MUDOU');
  process.env.SYNC_FEED_VALIDADO = '1';
  const g1 = G.executar(dir);
  const b1 = fs.readFileSync(saida, 'utf8'), m1 = fs.statSync(saida).mtimeMs;
  const r2 = await rodar(apiFalsa(catalogo(2, 100)), { dir: path.join(dir, 'data'), agora: () => Date.parse('2030-01-01T00:00:00Z') });   // "outra hora", mesmos dados
  const g2 = G.executar(dir); delete process.env.SYNC_FEED_VALIDADO;
  assert.equal(r2.resultado.estado, 'SEM_MUDANCA'); assert.equal(fs.readFileSync(saida, 'utf8'), b1); assert.equal(fs.statSync(saida).mtimeMs, m1);
  assert.equal(JSON.parse(b1).atualizado.startsWith('2030'), false);                                              // timestamp não mente: nada mudou
  assert.equal(g2.escritos, 0); assert.deepEqual(g2.alteradas, []); assert.ok(r2.logs.some(l => /SYNC_NO_CHANGE/.test(l)));
  const gi = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  gi('init', '-q'); gi('config', 'user.email', 't@t'); gi('config', 'user.name', 't'); gi('add', '-A'); gi('commit', '-q', '-m', 'base'); G.executar(dir); assert.equal(gi('status', '--porcelain').trim(), '');
  assert.ok(g1.escritos > 0);
});
test('24/25/26/27. só PREÇO muda, só ESTOQUE muda, produto ENTRA, produto SAI: cada um gera atualização do feed', async () => {
  const base = catalogo(1, 100); const dir = tmpDir('mud-'); const ant = JSON.stringify(feedDe([]));
  const r0 = await rodar(apiFalsa(base), { dir }); assert.equal(r0.resultado.estado, 'MUDOU');
  const rodarIgual = (itens, agora) => rodar(apiFalsa(itens), { dir, agora });
  let r = await rodarIgual(base); assert.equal(r.resultado.estado, 'SEM_MUDANCA');
  r = await rodarIgual(base.map((it, i) => (i === 10 ? Object.assign({}, it, { valores: [{ valor_venda: 99.9 }] }) : it)), () => Date.parse('2026-11-01T00:00:00Z'));
  assert.equal(r.resultado.estado, 'MUDOU'); assert.match(r.feed().produtos.find(p => p.ref === 'MR.0011').price, /99,90/); assert.equal(r.feed().atualizado, '2026-11-01T00:00:00.000Z');
  r = await rodarIgual(base.map((it, i) => (i === 10 ? Object.assign({}, it, { valores: [{ valor_venda: 99.9 }], estoque: 77 }) : it)));
  assert.equal(r.resultado.estado, 'MUDOU'); assert.equal(r.feed().produtos.find(p => p.ref === 'MR.0011').stock, 77);
  const comNovo = base.concat([mkBruto(101)]); const l = catalogo(1, 101).slice(0, 100);   // (um produto a mais cabe como 2ª página curta)
  r = await rodar(apiFalsa(comNovo), { dir }); assert.equal(r.resultado.estado, 'MUDOU'); assert.equal(r.feed().total, 101);
  r = await rodar(apiFalsa(base), { dir }); assert.equal(r.resultado.estado, 'MUDOU'); assert.equal(r.feed().total, 100);        // saiu
  assert.ok(ant && l);
});
test('28/29. Schema acompanha PREÇO e Offer acompanha DISPONIBILIDADE (preço novo no JSON-LD; produto que sai perde Offer)', () => {
  const dir = raizGeracao(feedDe([prod(1), prod(2), prod(3)]));
  process.env.SYNC_FEED_VALIDADO = '1'; G.executar(dir);
  assert.equal(ofertaDe(dir, 'MR.0002').offer.price, '12.00'); assert.equal(ofertaDe(dir, 'MR.0002').offer.availability, 'https://schema.org/InStock');
  fs.writeFileSync(path.join(dir, 'data/produtos.json'), JSON.stringify(feedDe([prod(1), prod(2, { price: 'R$ 55,50' }), prod(3)]))); G.executar(dir);
  assert.equal(ofertaDe(dir, 'MR.0002').offer.price, '55.50');
  fs.writeFileSync(path.join(dir, 'data/produtos.json'), JSON.stringify(feedDe([prod(1), prod(3)]))); G.executar(dir); delete process.env.SYNC_FEED_VALIDADO;
  const o = ofertaDe(dir, 'MR.0002'); assert.equal(!!o.offer, false); assert.match(o.html, /indispon/i);                    // saiu do feed: sem Offer
  assert.ok(ofertaDe(dir, 'MR.0001').offer && ofertaDe(dir, 'MR.0003').offer);
});
test('30. sitemap continua consistente: só URLs do feed atual + institucionais; produto que saiu sai do sitemap', () => {
  const dir = raizGeracao(feedDe([prod(1), prod(2), prod(3)])); process.env.SYNC_FEED_VALIDADO = '1'; G.executar(dir);
  const locs = () => [...fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.equal(locs().filter(u => /\/produto\//.test(u)).length, 3); assert.ok(locs().some(u => /\/sobre\/$/.test(u)) && locs().some(u => /\/privacidade\/$/.test(u)));
  fs.writeFileSync(path.join(dir, 'data/produtos.json'), JSON.stringify(feedDe([prod(1), prod(3)]))); G.executar(dir); delete process.env.SYNC_FEED_VALIDADO;
  assert.equal(locs().filter(u => /\/produto\//.test(u)).length, 2); assert.equal(new Set(locs()).size, locs().length);
});
test('12/13. ORDEM corrigida: o gerador não recusa mais uma queda legítima (feed validado) e, se recusar, o job falha ANTES do commit', () => {
  const grande = Array.from({ length: 40 }, (_, i) => prod(i + 1)), dir = raizGeracao(feedDe(grande)); process.env.SYNC_FEED_VALIDADO = '1'; G.executar(dir);
  fs.writeFileSync(path.join(dir, 'data/produtos.json'), JSON.stringify(feedDe(grande.slice(0, 12))));                    // queda de 70 % legítima, feed validado
  const r = G.executar(dir); assert.equal(r.saudavel, true); assert.ok(r.escritos > 0);
  delete process.env.SYNC_FEED_VALIDADO;
  fs.writeFileSync(path.join(dir, 'data/produtos.json'), JSON.stringify(feedDe(grande.slice(0, 5))));
  const semConfianca = G.executar(dir); assert.equal(semConfianca.saudavel, false);                                       // sem validação do sync, a guarda de 85 % continua valendo
  assert.match(ler('scripts/gerar-paginas.js'), /GERACAO_ABORTADA[\s\S]*process\.exit\(1\)/);
  const w = ler('.github/workflows/sync-produtos.yml'); assert.ok(w.indexOf('Executar sync') < w.indexOf('Gerar site estático') && w.indexOf('Gerar site estático') < w.indexOf('Commit e push seguro'));
});

/* ═════════════ GIT ═════════════ */
function repos() {
  const base = tmpDir('git-'), bare = path.join(base, 'remoto.git'), a = path.join(base, 'runner'), b = path.join(base, 'humano');
  const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  fs.mkdirSync(bare); run(bare, 'init', '-q', '--bare', '-b', 'main');
  run(base, 'clone', '-q', bare, a); run(a, 'config', 'user.email', 'bot@t'); run(a, 'config', 'user.name', 'bot');
  fs.mkdirSync(path.join(a, 'data')); fs.mkdirSync(path.join(a, 'templates')); fs.mkdirSync(path.join(a, 'tests'));
  fs.writeFileSync(path.join(a, 'data/produtos.json'), '{"v":1}'); fs.writeFileSync(path.join(a, 'templates/t.html'), 'T1'); fs.writeFileSync(path.join(a, 'tests/x.test.js'), '//1');
  run(a, 'add', '-A'); run(a, 'commit', '-q', '-m', 'base'); run(a, 'branch', '-M', 'main'); run(a, 'push', '-q', '-u', 'origin', 'main');
  run(base, 'clone', '-q', bare, b); run(b, 'config', 'user.email', 'humano@t'); run(b, 'config', 'user.name', 'humano');
  const commitBot = txt => { fs.writeFileSync(path.join(a, 'data/produtos.json'), txt); run(a, 'add', '-A'); run(a, 'commit', '-q', '-m', 'sync: bot'); };
  const humano = (arquivo, txt) => { fs.mkdirSync(path.dirname(path.join(b, arquivo)), { recursive: true }); fs.writeFileSync(path.join(b, arquivo), txt); run(b, 'add', '-A'); run(b, 'commit', '-q', '-m', 'humano: ' + arquivo); run(b, 'push', '-q', 'origin', 'main'); };
  return { a, b, bare, run, commitBot, humano };
}
test('31. remoto sem mudança: push normal; sem commit à frente: nada a publicar', () => {
  const R = repos(); R.commitBot('{"v":2}');
  const logs = []; const r = P.publicarSeguro({ cwd: R.a, log: t => logs.push(t) });
  assert.equal(r.estado, 'PUBLICADO'); assert.equal(R.run(R.bare, 'show', 'main:data/produtos.json'), '{"v":2}');
  assert.equal(P.publicarSeguro({ cwd: R.a, log: () => {} }).estado, 'NADA');
});
test('32. remoto mudou durante a execução em arquivo DISJUNTO: rebase seguro, push, e o trabalho humano é preservado', () => {
  const R = repos(); R.commitBot('{"v":2}'); R.humano('tests/y.test.js', '//humano');
  const r = P.publicarSeguro({ cwd: R.a, log: () => {} });
  assert.equal(r.estado, 'PUBLICADO_APOS_REBASE');
  assert.equal(R.run(R.bare, 'show', 'main:data/produtos.json'), '{"v":2}'); assert.equal(R.run(R.bare, 'show', 'main:tests/y.test.js'), '//humano');
  assert.equal(R.run(R.bare, 'log', '--format=%s', '-3').split('\n').filter(s => /humano|sync/.test(s)).length, 2);
});
test('32b. remoto mudou ENTRADAS DO GERADOR (templates/scripts/js): ABORTA sem publicar nada e sem tocar no commit humano', () => {
  const R = repos(); R.commitBot('{"v":2}'); R.humano('templates/t.html', 'T2-humano'); const antes = R.run(R.bare, 'rev-parse', 'main');
  const r = P.publicarSeguro({ cwd: R.a, log: () => {} });
  assert.equal(r.estado, 'ABORTADO'); assert.equal(r.motivo, 'remoto-alterou'); assert.equal(R.run(R.bare, 'rev-parse', 'main'), antes);
  assert.equal(R.run(R.bare, 'show', 'main:templates/t.html'), 'T2-humano'); assert.equal(R.run(R.bare, 'show', 'main:data/produtos.json'), '{"v":1}');
});
test('33. CONFLITO (remoto alterou o mesmo arquivo que o bot): fail-safe, nada descartado, nada sobrescrito', () => {
  const R = repos(); R.commitBot('{"v":2}'); R.humano('data/produtos.json', '{"v":"humano"}'); const antes = R.run(R.bare, 'rev-parse', 'main');
  const r = P.publicarSeguro({ cwd: R.a, log: () => {} });
  assert.equal(r.estado, 'ABORTADO'); assert.equal(R.run(R.bare, 'rev-parse', 'main'), antes); assert.equal(R.run(R.bare, 'show', 'main:data/produtos.json'), '{"v":"humano"}');
  assert.equal(R.run(R.a, 'status', '--porcelain'), '');                                                               // sem rebase pela metade
});
test('34. NUNCA force push: nenhuma chamada git usa --force/-f/+refspec; código e workflow sem force', () => {
  const R = repos(); R.commitBot('{"v":2}'); R.humano('tests/z.test.js', '//z');
  const chamadas = []; const run = (cmd, args, o) => { chamadas.push(args.join(' ')); return require('child_process').spawnSync(cmd, args, o); };
  P.publicarSeguro({ cwd: R.a, run, log: () => {} });
  assert.ok(chamadas.length > 3); chamadas.filter(c => /^push/.test(c)).forEach(c => { assert.doesNotMatch(c, /--force|\s-f\b|\+HEAD|\+main|--force-with-lease/); });
  assert.doesNotMatch(ler('scripts/git-push-seguro.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /--force|force-with-lease|'-f'/);
  assert.doesNotMatch(ler('.github/workflows/sync-produtos.yml'), /--force|force-with-lease|push -f/);
});

/* ═════════════ configuração, logs e escopo ═════════════ */
test('workflow: cron e concurrency preservados; timeout global; push seguro; sem novo secret nem novo scheduler', () => {
  const w = ler('.github/workflows/sync-produtos.yml');
  assert.match(w, /cron: '\*\/30 \* \* \* \*'/); assert.match(w, /group: sync-produtos\s+cancel-in-progress: false/);
  assert.match(w, /^    timeout-minutes: 15\b/m); assert.match(w, /node scripts\/git-push-seguro\.js/); assert.doesNotMatch(w, /^\s+git push\s*$/m);
  const segredos = new Set([...w.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(m => m[1])); assert.deepEqual([...segredos].sort(), ['GC_ACCESS_TOKEN', 'GC_SECRET_ACCESS_TOKEN']);
  ['repository_dispatch'].forEach(x => assert.equal(w.includes(x), false));
  assert.deepEqual(fs.readdirSync(path.join(RAIZ, '.github/workflows')), ['sync-produtos.yml']);
});
test('logs operacionais úteis e SEM segredos (tokens ficam [REDACTED], inclusive se aparecerem em mensagem de erro)', async () => {
  const f = async () => { throw new Error('falha com TOKEN-ACESSO-SECRETO-123 e access-token: TOKEN-ACESSO-SECRETO-123'); };
  const r = await rodar(f); const todo = r.logs.join('\n');
  assert.doesNotMatch(todo, /TOKEN-ACESSO-SECRETO-123|TOKEN-SEGREDO-SECRETO-456/); assert.match(todo, /\[REDACTED\]/); assert.match(todo, /tentativa 1\/3 falhou/); assert.match(todo, /\[sync\] início/); assert.match(todo, /solicitando página 1/);
  const ok = await rodar(apiFalsa(catalogo(2, 100))); assert.doesNotMatch(ok.logs.join('\n'), /TOKEN-/);
  assert.match(ok.logs.join('\n'), /total bruto: 200[\s\S]*total elegível \(estoque > 0\): 200 \| anterior: 0[\s\S]*SYNC_CHANGED/);
  const sem = await rodar(apiFalsa(catalogo()), { env: { GC_ACCESS_TOKEN: '', GC_SECRET_ACCESS_TOKEN: '' }, anterior: undefined });
  assert.ok(sem.erro || sem.resultado);                                                                                 // com fetch injetado não exige credenciais; sem fetch injetado, exige:
  const cred = await S.executarSync({ env: {}, saida: path.join(tmpDir('cred-'), 'p.json'), log: Object.assign(() => {}, { erro() {} }) }).catch(e => e); assert.equal(cred.codigo, 'SYNC_ABORTED_API_FAILURE');
});
