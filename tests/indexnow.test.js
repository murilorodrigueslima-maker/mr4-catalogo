'use strict';
// IndexNow — só URLs que mudaram; best-effort; chave pública hospedada na raiz
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const G = require('../scripts/gerar-paginas.js');
const IN = require('../scripts/indexnow.js');
const C = require('../js/catalogo-core.js');

const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const CFG = JSON.parse(ler('scripts/indexnow.config.json'));
const TPL = ler('templates/produto.html'), SHELL = ler('templates/catalogo.html');
const HOST = 'catalogo.mr4distribuidora.com.br', ORI = 'https://' + HOST;
const mk = (n, o) => Array.from({ length: n }, (_, i) => Object.assign({ id: String(i + 1), ref: 'R' + (i + 1), name: 'Produto ' + (i + 1), category: 'Cat A', brand: 'Marca A', price: 'R$ 10,00', stock: 5, img: '', desc: '' }, o && o(i)));
const gerar = (b, estado, atualizado, man, existente) => G.planejar(b, TPL, man || null, { shell: SHELL, estado: estado || null, atualizado: atualizado || '2026-10-02T10:00:00Z', existente: existente || (() => null) });
const semelhante = (r, arq) => f => (r.arquivos[f] !== undefined ? r.arquivos[f] : null);

test('chave: formato do protocolo (8–128 chars [A-Za-z0-9-]), arquivo /<chave>.txt na raiz com a chave, host = CNAME', () => {
  assert.match(CFG.key, /^[A-Za-z0-9-]{8,128}$/);
  assert.equal(ler(CFG.key + '.txt'), CFG.key);
  assert.equal(CFG.host, ler('CNAME').trim());
  assert.equal(CFG.keyLocation, `${ORI}/${CFG.key}.txt`);
  assert.equal(CFG.endpoint, 'https://api.indexnow.org/indexnow');
  assert.equal(IN.LIMITE_LOTE, 10000);
});
test('a chave é pública por desenho; não há segredo no repositório relacionado (sem token/senha no script)', () => {
  assert.doesNotMatch(ler('scripts/indexnow.js'), /secrets\.|GC_ACCESS|token|password|senha/i);
  assert.match(ler('scripts/indexnow.js'), /PÚBLICA por desenho/);
});
test('normalização: URLs absolutas https do próprio host, sem query/hash, deduplicadas e ordenadas', () => {
  const l = IN.normalizarUrls([ORI + '/b/', ORI + '/a/', ORI + '/a/', ORI + '/a/?q=1', ORI + '/a/#x', 'http://' + HOST + '/c/', 'https://outro.com/x/', '/relativa/', 'lixo', null, undefined, ORI + '/'], HOST);
  assert.deepEqual(l, [ORI + '/', ORI + '/a/', ORI + '/b/']);
  assert.deepEqual(IN.normalizarUrls([], HOST), []); assert.deepEqual(IN.normalizarUrls(null, HOST), []);
});
test('lotes: respeita o limite de 10.000 do protocolo', () => {
  const u = Array.from({ length: 25000 }, (_, i) => `${ORI}/produto/p${i}/`);
  const l = IN.lotes(u, 99999);
  assert.deepEqual(l.map(x => x.length), [10000, 10000, 5000]);
  assert.deepEqual(IN.lotes(u.slice(0, 3), 2).map(x => x.length), [2, 1]);
  assert.deepEqual(IN.lotes([], 10), []);
});
test('corpo do POST: host, key, keyLocation e urlList (formato oficial)', () => {
  const b = IN.corpo(CFG, [ORI + '/']);
  assert.deepEqual(Object.keys(b), ['host', 'key', 'keyLocation', 'urlList']);
  assert.equal(b.host, HOST); assert.equal(b.key, CFG.key); assert.equal(b.keyLocation, CFG.keyLocation); assert.deepEqual(b.urlList, [ORI + '/']);
});
test('nenhuma URL alterada ⇒ nenhuma chamada de rede', async () => {
  let n = 0; const r = await IN.notificar(CFG, [], { fetch: async () => { n++; return { status: 200 }; } });
  assert.equal(n, 0); assert.equal(r.lotes, 0); assert.equal(r.urls, 0);
});
test('uma URL e várias URLs: 1 POST por lote com JSON correto', async () => {
  const chamadas = [];
  const fetch = async (u, o) => { chamadas.push([u, o.method, JSON.parse(o.body), o.headers['Content-Type']]); return { status: 200 }; };
  let r = await IN.notificar(CFG, [ORI + '/produto/a/'], { fetch });
  assert.equal(chamadas.length, 1); assert.equal(chamadas[0][0], CFG.endpoint); assert.equal(chamadas[0][1], 'POST'); assert.match(chamadas[0][3], /application\/json/);
  assert.deepEqual(chamadas[0][2].urlList, [ORI + '/produto/a/']);
  chamadas.length = 0;
  r = await IN.notificar(CFG, [ORI + '/produto/a/', ORI + '/produto/b/', ORI + '/produto/a/', ORI + '/categoria/x/', ORI + '/marca/y/'], { fetch });
  assert.equal(chamadas.length, 1); assert.deepEqual(chamadas[0][2].urlList, [ORI + '/categoria/x/', ORI + '/marca/y/', ORI + '/produto/a/', ORI + '/produto/b/']);
  assert.equal(r.ok, 1); assert.equal(r.falhas, 0);
  chamadas.length = 0;
  await IN.notificar(CFG, Array.from({ length: 25 }, (_, i) => `${ORI}/produto/p${i}/`), { fetch, lote: 10 });
  assert.deepEqual(chamadas.map(c => c[2].urlList.length), [10, 10, 5]);
});
test('202 Accepted conta como sucesso; 4xx não tem retry (429 = spam); 5xx e rede têm UM retry; nunca lança', async () => {
  const esperar = async () => {};
  let n = 0;
  let r = await IN.enviarLote(CFG, [ORI + '/'], { fetch: async () => { n++; return { status: 202 }; }, esperar });
  assert.equal(r.ok, true); assert.equal(n, 1);
  for (const st of [400, 403, 422, 429]) { n = 0; r = await IN.enviarLote(CFG, [ORI + '/'], { fetch: async () => { n++; return { status: st }; }, esperar }); assert.equal(r.ok, false); assert.equal(r.status, st); assert.equal(n, 1, 'sem retry em ' + st); }
  n = 0; r = await IN.enviarLote(CFG, [ORI + '/'], { fetch: async () => { n++; return { status: 503 }; }, esperar });
  assert.equal(r.ok, false); assert.equal(n, 2); assert.equal(r.tentativas, 2);                                  // 1 retry, sem loop
  n = 0; r = await IN.enviarLote(CFG, [ORI + '/'], { fetch: async () => { n++; if (n === 1) throw new Error('ECONNRESET'); return { status: 200 }; }, esperar });
  assert.equal(r.ok, true); assert.equal(n, 2);
  n = 0; r = await IN.enviarLote(CFG, [ORI + '/'], { fetch: async () => { n++; throw new Error('rede fora'); }, esperar });
  assert.equal(r.ok, false); assert.equal(n, 2); assert.match(r.erro, /rede fora/);
});
test('timeout: requisição que não responde é abortada e vira falha (não trava)', async () => {
  const fetch = (u, o) => new Promise((res, rej) => { o.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
  const t0 = Date.now();
  const r = await IN.enviarLote(CFG, [ORI + '/'], { fetch, timeoutMs: 30, esperar: async () => {} });
  assert.equal(r.ok, false); assert.ok(Date.now() - t0 < 2000);
});
test('aguardarPublicacao: confirma quando a versão nova aparece; desiste no limite sem travar', async () => {
  const hash = h => h;
  let i = 0; const f1 = async () => ({ status: 200, text: async () => (++i < 3 ? 'velha' : 'nova') });
  assert.equal(await IN.aguardarPublicacao(ORI + '/', 'nova', { fetch: f1, hash, esperar: async () => {}, tentativas: 5 }), true); assert.equal(i, 3);
  let j = 0; const f2 = async () => { j++; return { status: 200, text: async () => 'velha' }; };
  assert.equal(await IN.aguardarPublicacao(ORI + '/', 'nova', { fetch: f2, hash, esperar: async () => {}, tentativas: 4 }), false); assert.equal(j, 4);
  assert.equal(await IN.aguardarPublicacao(ORI + '/', 'x', { fetch: async () => { throw new Error('x'); }, hash, esperar: async () => {}, tentativas: 2 }), false);
});
test('FAIL-SAFE: o script nunca falha o sync — arquivo ausente, JSON quebrado ou rede indisponível ⇒ exit 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inow-'));
  const rodar = env => cp.spawnSync(process.execPath, [path.join(RAIZ, 'scripts/indexnow.js')], { env: Object.assign({}, process.env, env), encoding: 'utf8' });
  let r = rodar({ INDEXNOW_URLS_FILE: path.join(tmp, 'nao-existe.json') }); assert.equal(r.status, 0); assert.match(r.stdout, /sem lista/);
  fs.writeFileSync(path.join(tmp, 'ruim.json'), '{quebrado'); r = rodar({ INDEXNOW_URLS_FILE: path.join(tmp, 'ruim.json') }); assert.equal(r.status, 0);
  fs.writeFileSync(path.join(tmp, 'vazia.json'), '[]'); r = rodar({ INDEXNOW_URLS_FILE: path.join(tmp, 'vazia.json') }); assert.equal(r.status, 0); assert.match(r.stdout, /nenhuma URL mudou/);
  fs.writeFileSync(path.join(tmp, 'urls.json'), JSON.stringify([ORI + '/'])); r = rodar({ INDEXNOW_URLS_FILE: path.join(tmp, 'urls.json'), INDEXNOW_DRY_RUN: '1' }); assert.equal(r.status, 0); assert.match(r.stdout, /dry-run/);
  r = rodar({}); assert.equal(r.status, 0);                                                                          // sem variável nenhuma
});
test('workflow: IndexNow depois do push, continue-on-error, timeout; geração entrega a lista; sync não depende dele', () => {
  const w = ler('.github/workflows/sync-produtos.yml');
  const iPush = w.indexOf('git-push-seguro'), iNow = w.indexOf('node scripts/indexnow.js');
  assert.ok(iPush > 0 && iNow > iPush);
  const passo = w.slice(w.indexOf('- name: Notificar IndexNow'));
  assert.match(passo, /continue-on-error: true/); assert.match(passo, /timeout-minutes: \d+/);
  assert.match(w, /INDEXNOW_URLS_FILE: \$\{\{ runner\.temp \}\}\/indexnow-urls\.json[\s\S]*node scripts\/gerar-paginas\.js/);
  assert.equal((w.match(/node scripts\/indexnow\.js/g) || []).length, 1);
  assert.match(w, /git add data\/produtos\.json data\/seo-estado\.json produto\/ categoria\/ marca\/ sobre\/ contato\/ privacidade\/ index\.html sitemap\.xml robots\.txt/);   // o resto do sync intacto
});
test('URLs do diff (reaproveita o gerador): nada mudou ⇒ []; preço de 1 produto ⇒ só a página dele', () => {
  const b = mk(12);
  const r0 = gerar(b), man = JSON.parse(r0.arquivos['produto/manifest.json']);
  const ex0 = semelhante(r0);
  assert.deepEqual(G.urlsAlteradas(gerar(b, r0.estado, '2026-10-03T10:00:00Z', man).arquivos, ex0), []);
  const novo = b.map((p, i) => (i === 3 ? Object.assign({}, p, { price: 'R$ 12,00' }) : p));
  const u = G.urlsAlteradas(gerar(novo, r0.estado, '2026-10-04T10:00:00Z', man).arquivos, ex0);
  assert.deepEqual(u, [ORI + C.prepararCatalogo(b)[3].url]);
  const est = b.map(p => Object.assign({}, p, { stock: p.stock + 3 }));                                       // só número de estoque
  assert.deepEqual(G.urlsAlteradas(gerar(est, r0.estado, '2026-10-05T10:00:00Z', man).arquivos, ex0), []);
});
test('URLs do diff: produto novo (+categoria/marca/home/relacionados que mudam), produto removido, categoria e marca', () => {
  const b = mk(12);
  const r0 = gerar(b), man = JSON.parse(r0.arquivos['produto/manifest.json']), ex0 = semelhante(r0);
  const mais = b.concat(mk(1, () => ({ id: '99', ref: 'NOVO', name: 'Produto Novo', brand: 'Marca B', category: 'Cat B' })));
  const u = G.urlsAlteradas(gerar(mais, r0.estado, '2026-10-04T10:00:00Z', man).arquivos, ex0);
  assert.ok(u.includes(ORI + '/produto/produto-novo--novo/'));                                              // página nova
  assert.ok(u.includes(ORI + '/categoria/cat-b/') && u.includes(ORI + '/marca/marca-b/'));                 // categoria e marca novas
  assert.ok(u.includes(ORI + '/'));                                                                         // home lista a nova categoria/marca
  u.forEach(x => assert.match(x, /^https:\/\/catalogo\.mr4distribuidora\.com\.br\/(|categoria\/[^/]+\/|marca\/[^/]+\/|produto\/[^/]+\/)$/));
  assert.ok(!u.some(x => /sitemap|robots|estado|manifest|\.txt|\.json|\.xml/.test(x)));
  const sem3 = b.filter(p => p.id !== '3');                                                                 // produto sai do feed
  const r1 = G.planejar(sem3, TPL, man, { shell: SHELL, estado: r0.estado, atualizado: '2026-10-04T10:00:00Z', existente: ex0 });
  const u2 = G.urlsAlteradas(r1.arquivos, ex0);
  assert.ok(u2.includes(ORI + C.prepararCatalogo(b)[2].url));                                               // a página do removido mudou (aviso estático)
  const catMudou = b.map((p, i) => (i === 5 ? Object.assign({}, p, { name: 'Produto cinco renomeado' }) : p));
  const u3 = G.urlsAlteradas(gerar(catMudou, r0.estado, '2026-10-05T10:00:00Z', man).arquivos, ex0);
  assert.ok(u3.includes(ORI + '/categoria/cat-a/') && u3.includes(ORI + '/marca/marca-a/'));               // a lista da categoria/marca mudou
});
test('versão de assets (?v=) sozinha não gera notificação; deduplicação e URLs absolutas no diff real', () => {
  const b = mk(8), r0 = gerar(b), man = JSON.parse(r0.arquivos['produto/manifest.json']);
  const shell2 = SHELL.replace(/\?v=[A-Za-z0-9._-]+/g, '?v=zzz9-9'), tpl2 = TPL.replace(/\?v=[A-Za-z0-9._-]+/g, '?v=zzz9-9');
  const r1 = G.planejar(b, tpl2, man, { shell: shell2, estado: r0.estado, atualizado: '2026-10-03T10:00:00Z', existente: () => null });
  assert.notEqual(r1.arquivos['index.html'], r0.arquivos['index.html']);                                     // os arquivos mudam…
  assert.deepEqual(G.urlsAlteradas(r1.arquivos, semelhante(r0)), []);                                       // …mas ninguém é notificado
  const u = G.urlsAlteradas(r0.arquivos, () => null);
  assert.equal(new Set(u).size, u.length); u.forEach(x => assert.match(x, /^https:\/\//));
});
test('gerador: lista de URLs só é gravada quando INDEXNOW_URLS_FILE existe; falha de escrita não derruba o gerador', () => {
  const g = ler('scripts/gerar-paginas.js');
  assert.match(g, /if \(process\.env\.INDEXNOW_URLS_FILE\) \{ try \{ fs\.writeFileSync\(process\.env\.INDEXNOW_URLS_FILE, JSON\.stringify\(r\.alteradas \|\| \[\]\)\); \} catch \(e\) \{/);
});
