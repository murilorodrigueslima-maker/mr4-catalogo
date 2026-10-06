'use strict';
// Páginas de produto que saem do feed (estoque zero): integridade com DADOS REAIS e fronteira da carência de 7 dias.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../js/catalogo-core.js');
const G = require('../scripts/gerar-paginas.js');

const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const locs = x => [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const ORIGEM = 'https://catalogo.mr4distribuidora.com.br';

test('DADOS REAIS: feed × sitemap × pastas × stubs — nenhuma página de produto "meio regenerada"', () => {
  const feed = JSON.parse(ler('data/produtos.json')).produtos;
  const estado = JSON.parse(ler('data/seo-estado.json'));
  const sm = locs(ler('sitemap.xml')).filter(u => u.includes('/produto/'));
  assert.equal(sm.length, feed.length, 'URLs de produto no sitemap = produtos do feed');
  assert.equal(estado.ativos, feed.length, 'seo-estado.ativos = produtos do feed');
  const noSitemap = new Set(sm.map(u => u.slice(ORIGEM.length)));
  const pastas = fs.readdirSync(path.join(RAIZ, 'produto'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  const stubs = new Map(), offFeed = [];
  pastas.forEach(p => {
    const url = '/produto/' + p + '/', h = ler('produto/' + p + '/index.html');
    if (noSitemap.has(url)) return;                                                // ativo
    if (/http-equiv="refresh"/.test(h)) {                                          // stub de redirecionamento
      assert.match(h, /name="robots" content="noindex/, url + ' stub sem noindex');
      const can = (h.match(/rel="canonical" href="([^"]+)"/) || [])[1];
      assert.ok(can && can.startsWith(ORIGEM + '/produto/'), url + ' stub sem canonical para produto');
      stubs.set(url, can.slice(ORIGEM.length));
    } else offFeed.push([url, h]);
  });
  offFeed.forEach(([url, h]) => {                                                  // off-feed: aviso, sem oferta, registrado em `ausentes`
    assert.match(h, /data-estado="indisponivel"/, url + ' fora do sitemap sem ser stub nem indisponível');
    assert.doesNotMatch(h, /"@type":\s*"(Product|Offer)"|availability/, url + ' off-feed não pode ter Product/Offer');
  });
  assert.equal(offFeed.length, Object.keys(estado.ausentes).length, 'cada off-feed tem registro em ausentes (e vice-versa)');
  stubs.forEach((dest, url) => {                                                   // stub: destino existe, está no sitemap e não é outro stub (sem cadeia)
    assert.ok(noSitemap.has(dest), url + ' → ' + dest + ' (destino fora do sitemap)');
    assert.ok(!stubs.has(dest), url + ' → cadeia de redirecionamento');
  });
});

const mk = (id, o) => Object.assign({ id: String(id), ref: 'R' + id, name: 'Produto ' + id, category: 'Cat A', brand: 'Marca A', price: 'R$ 10,00', stock: 5, img: '', desc: '' }, o || {});
const TPL = ler('templates/produto.html'), SHELL = ler('templates/catalogo.html');
const D = d => '2026-10-' + String(d).padStart(2, '0') + 'T10:00:00Z';
function passo(brutos, prev, dia) {                                                // uma geração do sync (tempo do feed = dia)
  const man = prev ? JSON.parse(prev.arquivos['produto/manifest.json']) : null;
  const r = G.planejar(brutos, TPL, man, { shell: SHELL, estado: prev ? prev.estado : null, atualizado: D(dia), existente: f => (prev && prev.todos[f]) || null });
  r.todos = Object.assign({}, prev ? prev.todos : {}, r.arquivos);
  return r;
}
const rel = () => 'produto/' + C.prepararCatalogo([mk(3)])[0].url.replace('/produto/', '') + 'index.html';
const NOINDEX = /<meta name="robots" content="noindex,follow">/;

test('carência: noindex só quando a ausência contínua chega a 7 dias (6 → não, 7 → sim)', () => {
  const todos = [1, 2, 3, 4, 5, 6, 7].map(i => mk(i)), sem3 = todos.filter(p => p.id !== '3');
  let r = passo(todos, null, 1); r = passo(sem3, r, 2);                           // ausente desde o dia 2
  assert.doesNotMatch(r.arquivos[rel()], NOINDEX);
  const d8 = passo(sem3, r, 8), d9 = passo(sem3, r, 9);                           // 6 e 7 dias de ausência
  assert.doesNotMatch(d8.arquivos[rel()] || d8.todos[rel()], NOINDEX, '6 dias: ainda indexável');
  assert.match(d9.arquivos[rel()] || d9.todos[rel()], NOINDEX, '7 dias: noindex');
});
test('carência: voltar ao feed zera a contagem; nova ausência recomeça do zero', () => {
  const todos = [1, 2, 3, 4, 5, 6, 7].map(i => mk(i)), sem3 = todos.filter(p => p.id !== '3');
  let r = passo(todos, null, 1); r = passo(sem3, r, 2);                           // ausente dia 2
  r = passo(todos, r, 5); assert.ok(!r.estado.ausentes.r3, 'voltou: sai de ausentes');
  r = passo(sem3, r, 7);                                                           // nova ausência começa no dia 7
  assert.equal(r.estado.ausentes.r3, '2026-10-07');
  const d13 = passo(sem3, r, 13), d14 = passo(sem3, r, 14);                        // 6 e 7 dias desde o dia 7
  assert.doesNotMatch(d13.arquivos[rel()] || d13.todos[rel()], NOINDEX, 'a ausência antiga não conta');
  assert.match(d14.arquivos[rel()] || d14.todos[rel()], NOINDEX);
});

const urlDe = p => ORIGEM + C.prepararCatalogo([p])[0].url;
const relDe = p => 'produto/' + C.prepararCatalogo([p])[0].url.replace('/produto/', '') + 'index.html';
const alteradas = (r, prev) => G.urlsAlteradas(r.arquivos, f => (prev && prev.todos[f]) || null);

test('retorno sob novo nome: a página antiga vira stub (noindex + canonical p/ a nova), sai de ausentes e só a URL nova fica no sitemap', () => {
  const base = [1, 2, 4, 5, 6, 7].map(i => mk(i)), velho = mk(3), novo = mk(3, { name: 'Produto Renomeado 3' });
  let r = passo(base.concat(velho), null, 1); r = passo(base, r, 2);                // ausente desde o dia 2 (página "indisponível")
  assert.match(r.todos[relDe(velho)], /data-estado="indisponivel"/);
  r = passo(base.concat(novo), r, 4);                                              // volta com outro nome
  assert.notEqual(relDe(velho), relDe(novo));
  const stub = r.todos[relDe(velho)];
  assert.match(stub, /http-equiv="refresh"/); assert.match(stub, /name="robots" content="noindex/);
  assert.ok(stub.includes('rel="canonical" href="' + urlDe(novo) + '"'), 'canonical do stub = URL nova');
  assert.ok(!r.estado.ausentes.r3, 'código fora de ausentes');
  const sm = locs(r.arquivos['sitemap.xml']);
  assert.ok(sm.includes(urlDe(novo))); assert.ok(!sm.includes(urlDe(velho)));
  assert.doesNotMatch(r.todos[relDe(novo)], /name="robots"|indisponivel/);
});
test('renomeado ENQUANTO ausente: nenhum stub é criado para produto que não está no feed (a página antiga segue como aviso)', () => {
  const base = [1, 2, 4, 5, 6, 7].map(i => mk(i)), velho = mk(3);
  let r = passo(base.concat(velho), null, 1); r = passo(base, r, 2);
  const antes = r.todos[relDe(velho)];
  r = passo(base, r, 3);
  assert.match(r.todos[relDe(velho)], /data-estado="indisponivel"/); assert.doesNotMatch(r.todos[relDe(velho)], /http-equiv="refresh"/);
  assert.equal(r.todos[relDe(velho)], antes);
});
test('IndexNow nas viradas de estado: entra na saída do feed, na virada p/ noindex (7 dias) e no retorno; NÃO entra na repetição idempotente nem em sitemap/estado', () => {
  const todos = [1, 2, 3, 4, 5, 6, 7].map(i => mk(i)), sem3 = todos.filter(p => p.id !== '3'), u3 = urlDe(mk(3));
  let r = passo(todos, null, 1);
  let prev = r; r = passo(sem3, prev, 2);
  assert.ok(alteradas(r, prev).includes(u3), 'saída do feed (aviso) é avisada');
  prev = r; r = passo(sem3, prev, 5);
  assert.ok(!alteradas(r, prev).includes(u3), 'dentro da carência, sem mudança: não reenvia');
  prev = r; r = passo(sem3, prev, 9);
  assert.ok(alteradas(r, prev).includes(u3), 'virada para noindex é avisada (Bing/Yandex reprocessam)');
  prev = r; r = passo(sem3, prev, 10);
  assert.deepEqual(alteradas(r, prev).filter(u => u === u3), [], 'repetição idempotente: nada');
  prev = r; r = passo(todos, prev, 12);
  assert.ok(alteradas(r, prev).includes(u3), 'retorno ao feed é avisado');
  assert.ok(!alteradas(r, prev).some(u => /sitemap|seo-estado|robots|manifest/.test(u)));
});
