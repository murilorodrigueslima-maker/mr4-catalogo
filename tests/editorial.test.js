'use strict';
// Camada editorial (data/editorial.json): validação, aplicação, proteção de preço/estoque/SKU, geração e dados reais.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const C = require('../js/catalogo-core.js');
const G = require('../scripts/gerar-paginas.js');
const RAIZ = path.join(__dirname, '..');
const FEED = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data/produtos.json'), 'utf8'));
const ED = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data/editorial.json'), 'utf8'));

const prod = (id, o) => Object.assign({ id: String(id), ref: 'R' + id, name: 'PRODUTO TESTE ' + id, category: 'Moldura', brand: '', price: 'R$ 10,00', stock: 5, img: '', desc: '' }, o || {});
const ed = (produtos, extra) => Object.assign({ versao: 1, produtos }, extra || {});
const ok = o => Object.assign({ motivo: 'teste' }, o);

test('validação: arquivo correto passa; ausência de editorial = ERP puro', () => {
  assert.deepEqual(C.validarEditorial(null, [prod(1)]), { erros: [], avisos: [] });
  const v = C.validarEditorial(ed({ 1: ok({ brand: 'LDCAR' }) }), [prod(1)]);
  assert.deepEqual(v, { erros: [], avisos: [] });
});
test('validação: preço, estoque, SKU, ID, imagem NUNCA podem ser sobrescritos (erro)', () => {
  ['price', 'stock', 'ref', 'sku', 'id', 'img', 'estoque', 'preco', 'gtin', 'mpn'].forEach(k => {
    const v = C.validarEditorial(ed({ 1: ok({ brand: 'X', [k]: 'qualquer' }) }), [prod(1)]);
    assert.ok(v.erros.some(e => /NUNCA pode ser sobrescrito/.test(e)), k);
  });
});
test('validação: estrutura (versão, chave numérica, campo desconhecido, motivo obrigatório, tipos)', () => {
  const e = (o, f) => C.validarEditorial(o, f || [prod(1)]).erros.join('|');
  assert.match(e({ versao: 2, produtos: {} }), /versao/);
  assert.match(e({ versao: 1 }), /produtos/);
  assert.match(e(ed({ abc: ok({ brand: 'X' }) })), /ID numérico/);
  assert.match(e(ed({ 1: { brand: 'X' } })), /motivo/);
  assert.match(e(ed({ 1: ok({ foo: 1, brand: 'X' }) })), /desconhecido/);
  assert.match(e(ed({ 1: ok({}) })), /nenhum campo editorial/);
  assert.match(e(ed({ 1: ok({ brand: '' }) })), /texto não vazio/);
  assert.match(e(ed({ 1: ok({ brand: 5 }) })), /texto não vazio/);
  assert.match(e(ed({ 1: ok({ brand: 'Soquete' }) })), /tipo de produto, não marca/);
  assert.match(e(ed({ 1: ok({ title: 'x'.repeat(101) }) })), /> 100/);
  assert.match(e(ed({ 1: ok({ title: 'Compre em https://x.com' }) })), /URL/);
  assert.match(e([]), /objeto/);
});
test('validação: descrição editorial recusa preço, telefone, URL, NCM, HTML, afirmação não comprovada, texto curto', () => {
  const casos = { 'Produto por R$ 19,90 com frete': /preço/, 'Ligue (85) 99609-8520 agora para o pedido do item': /telefone/, 'Veja em www.exemplo.com.br as especificações do produto automotivo': /URL/, 'Produto automotivo com NCM 8512.20.00 e CST 000 informado': /fiscal/, '<b>Produto</b> automotivo com instalação simples e rápida': /HTML/, 'Produto automotivo com garantia de fábrica e o mais vendido do mercado': /não comprovada/, 'Curto demais': /curta/ };
  Object.entries(casos).forEach(([d, re]) => assert.match(C.validarEditorial(ed({ 1: ok({ desc: d }) }), [prod(1)]).erros.join('|'), re, d));
  assert.deepEqual(C.validarEditorial(ed({ 1: ok({ desc: 'Lâmpada LED H7 12V para farol, encaixe tipo H7, uso automotivo geral.' }) }), [prod(1)]).erros, []);
});
test('validação: ID órfão e categoria inexistente = AVISO (não bloqueia o sync); redirecionamentos validados', () => {
  const v = C.validarEditorial(ed({ 99: ok({ brand: 'LDCAR' }), 1: ok({ category: 'Inexistente' }) }), [prod(1)]);
  assert.deepEqual(v.erros, []); assert.equal(v.avisos.length, 2);
  assert.ok(v.avisos.some(a => /órfão/.test(a)) && v.avisos.some(a => /categoria "Inexistente"/.test(a)));
  const r = red => C.validarEditorial(ed({ 1: ok({ brand: 'X' }) }, { redirecionamentos: red }), [prod(1)]).erros.join('|');
  assert.equal(r({ '/marca/a/': '/marca/b/' }), '');
  assert.match(r({ '/marca/a/': '/categoria/b/' }), /mesmo tipo/);
  assert.match(r({ '/marca/a/': '/marca/a/' }), /origem = destino/);
  assert.match(r({ 'http://x': '/marca/b/' }), /\/marca\/<slug>\//);
  assert.match(r([]), /objeto/);
});

test('aplicação: produto sem override e produto novo passam INTACTOS (mesmo objeto); entrada não é mutada', () => {
  const a = prod(1), b = prod(2), c = prod(3, { brand: 'Tiger' });
  const snap = JSON.stringify([a, b, c]);
  const r = C.aplicarEditorial([a, b, c], ed({ 2: ok({ brand: 'LDCAR' }) }));
  assert.equal(r[0], a); assert.equal(r[2], c);
  assert.notEqual(r[1], b); assert.equal(JSON.stringify([a, b, c]), snap);
  assert.equal(C.aplicarEditorial([a], null)[0], a);
  assert.equal(C.aplicarEditorial([a], { versao: 1 })[0], a);
});
test('aplicação: preço, estoque, SKU, ID e imagem do ERP NUNCA mudam; o valor ERP original fica em p.erp', () => {
  const base = prod(7, { brand: 'Faimon', category: 'Geral', name: 'ESPELHO XYZ', price: 'R$ 99,90', stock: 12, img: 'https://x/y.png' });
  const r = C.aplicarEditorial([base], ed({ 7: ok({ brand: 'Fiamon', category: 'Geral', title: 'Espelho XYZ - LADO DIREITO' }) }))[0];
  ['id', 'ref', 'price', 'stock', 'img'].forEach(k => assert.equal(r[k], base[k], k));
  assert.equal(r.brand, 'Fiamon'); assert.equal(r.name, 'Espelho XYZ - LADO DIREITO');
  assert.deepEqual(r.erp, { brand: 'Faimon', name: 'ESPELHO XYZ' });                 // category igual: nada a registrar
  assert.deepEqual(r.editado.sort(), ['brand', 'name']);
});
test('aplicação: categoria só vai para categoria que já existe no feed; override igual ao ERP não conta como edição', () => {
  const lista = [prod(1, { category: 'Geral' }), prod(2, { category: 'Interruptores' })];
  const r = C.aplicarEditorial(lista, ed({ 1: ok({ category: 'Interruptores' }), 2: ok({ category: 'Nova categoria' }) }));
  assert.equal(r[0].category, 'Interruptores'); assert.equal(r[1].category, 'Interruptores'); assert.equal(r[1].editado, undefined);
});
test('descrição: ERP válida vence; editorial só preenche vazia/curta; "substituir" é explícito', () => {
  const longa = 'Descrição técnica do ERP com mais de quarenta caracteres úteis.';
  const mk = (desc, o) => C.aplicarEditorial([prod(1, { desc })], ed({ 1: ok(Object.assign({ desc: 'Texto editorial aprovado com mais de quarenta caracteres.' }, o)) }))[0].desc;
  assert.equal(mk(''), 'Texto editorial aprovado com mais de quarenta caracteres.');
  assert.equal(mk('curta'), 'Texto editorial aprovado com mais de quarenta caracteres.');
  assert.equal(mk(longa), longa);
  assert.equal(mk(longa, { descModo: 'substituir' }), 'Texto editorial aprovado com mais de quarenta caracteres.');
});
test('prepararCatalogo(editorial): marca/categoria/título editoriais alimentam slug, taxonomia e normalização; sem 2º argumento = ERP', () => {
  const lista = [prod(1, { brand: 'Faimon', category: 'Geral' }), prod(2, { brand: 'Fiamon' })];
  const sem = C.prepararCatalogo(lista);
  assert.deepEqual(sem.map(e => e.marca), ['Faimon', 'Fiamon']);
  const com = C.prepararCatalogo(lista, ed({ 1: ok({ brand: 'Fiamon', category: 'Moldura' }) }));
  assert.deepEqual(com.map(e => e.marca), ['Fiamon', 'Fiamon']); assert.equal(com[0].catChave, 'Moldura'); assert.equal(new Set(com.map(e => e.marcaSlug)).size, 1);
  const valor = C.prepararCatalogo([prod(3, { brand: 'FITTO/JPKER' })], ed({ 3: ok({ brand: 'Tiger' }) }))[0];
  assert.equal(valor.marca, 'Tiger');
});

/* ───── geração ───── */
function raizTemp(feed, editorial, extras) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-'));
  fs.mkdirSync(path.join(d, 'data')); fs.cpSync(path.join(RAIZ, 'templates'), path.join(d, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(d, 'data/produtos.json'), JSON.stringify({ produtos: feed, total: feed.length, atualizado: '2026-10-03T10:00:00.000Z' }));
  if (editorial !== undefined) fs.writeFileSync(path.join(d, 'data/editorial.json'), typeof editorial === 'string' ? editorial : JSON.stringify(editorial));
  return d;
}
const gerar = d => { process.env.SYNC_FEED_VALIDADO = '1'; try { return G.executar(d); } finally { delete process.env.SYNC_FEED_VALIDADO; } };
const lerD = (d, rel) => fs.readFileSync(path.join(d, rel), 'utf8');
const feed3 = () => [prod(1, { brand: 'Faimon', name: 'MOLDURA 9 UM', ref: 'A1' }), prod(2, { brand: 'Fiamon', name: 'MOLDURA 9 DOIS', ref: 'A2' }), prod(3, { brand: 'Fiamon', name: 'MOLDURA 9 TRES', ref: 'A3' })];

test('geração: sem editorial.json o resultado é o do ERP; com editorial a marca corrigida unifica a página de marca', () => {
  const d0 = raizTemp(feed3()); const r0 = gerar(d0);
  assert.equal(r0.saudavel, true); assert.ok(fs.existsSync(path.join(d0, 'marca/faimon/index.html')));
  const d1 = raizTemp(feed3(), ed({ 1: ok({ brand: 'Fiamon' }) }, { redirecionamentos: { '/marca/faimon/': '/marca/fiamon/' } }));
  // 1ª geração com a marca antiga já "existindo": simula o estado anterior copiando a saída sem editorial
  fs.cpSync(d0, d1, { recursive: true, filter: s => !/data[\\/](produtos|editorial)\.json$/.test(s) });
  gerar(d1);
  const stub = lerD(d1, 'marca/faimon/index.html');
  assert.match(stub, /http-equiv="refresh" content="0; url=\/marca\/fiamon\/"/); assert.match(stub, /Esta marca mudou de endereço/);
  assert.doesNotMatch(lerD(d1, 'sitemap.xml'), /marca\/faimon/); assert.match(lerD(d1, 'sitemap.xml'), /marca\/fiamon/);
  assert.equal(JSON.parse(lerD(d1, 'data/seo-estado.json')).taxonomias['/marca/faimon/'], undefined);
  assert.match(lerD(d1, 'marca/fiamon/index.html'), /MOLDURA 9 UM/);
  const pg = Object.keys(JSON.parse(lerD(d1, 'produto/manifest.json')).produtos).length; assert.equal(pg, 3);
});
test('geração: redirecionamento só vale se o destino existe e a origem ficou sem produtos', () => {
  const d = raizTemp(feed3(), ed({ 1: ok({ brand: 'Fiamon' }) }, { redirecionamentos: { '/marca/antiga/': '/marca/naoexiste/', '/marca/fiamon/': '/marca/faimon/' } }));
  gerar(d);
  assert.ok(!fs.existsSync(path.join(d, 'marca/antiga/index.html')));          // destino inexistente: sem redirecionamento
  assert.doesNotMatch(lerD(d, 'marca/fiamon/index.html'), /http-equiv="refresh"/);        // origem viva não é sobrescrita
});
test('geração: editorial INVÁLIDO bloqueia (nada é escrito); JSON ilegível bloqueia; ID órfão não bloqueia', () => {
  const d = raizTemp(feed3(), ed({ 1: ok({ brand: 'X', price: 'R$ 1,00' }) }));
  assert.throws(() => gerar(d), /EDITORIAL_INVALIDO/); assert.ok(!fs.existsSync(path.join(d, 'index.html')) && !fs.existsSync(path.join(d, 'produto')));
  const d2 = raizTemp(feed3(), '{ quebrado'); assert.throws(() => gerar(d2), /EDITORIAL_INVALIDO.*ilegível/);
  const d3 = raizTemp(feed3(), ed({ 999: ok({ brand: 'Fiamon' }) })); const r = gerar(d3); assert.equal(r.saudavel, true);
});
test('geração: CLI sai com código 1 e mensagem clara quando o editorial é inválido', () => {
  const d = raizTemp(feed3(), ed({ 1: { brand: 'X' } }));
  fs.mkdirSync(path.join(d, 'scripts')); fs.mkdirSync(path.join(d, 'js'));
  ['gerar-paginas.js', 'jsonld.js', 'entidade.js', 'institucional.js'].forEach(f => fs.copyFileSync(path.join(RAIZ, 'scripts', f), path.join(d, 'scripts', f)));
  fs.copyFileSync(path.join(RAIZ, 'js/catalogo-core.js'), path.join(d, 'js/catalogo-core.js'));
  const r = spawnSync('node', ['scripts/gerar-paginas.js'], { cwd: d, encoding: 'utf8', env: { PATH: process.env.PATH, SYNC_FEED_VALIDADO: '1' } });
  assert.equal(r.status, 1); assert.match(r.stderr, /EDITORIAL_INVALIDO/); assert.match(r.stderr, /motivo/);
});
test('geração: título editorial muda H1/title/slug e o endereço antigo vira redirecionamento permanente; preço do Schema = ERP', () => {
  const f = [prod(1, { name: 'FAROL AVULSO X', ref: '0205008E', brand: 'Tiger', price: 'R$ 139,79' }), prod(2, { name: 'FAROL AVULSO X', ref: '0205008D', brand: 'Tiger', price: 'R$ 139,79' })];
  const d = raizTemp(f); gerar(d);
  const antigo = Object.values(JSON.parse(lerD(d, 'produto/manifest.json')).produtos)[0];
  fs.writeFileSync(path.join(d, 'data/editorial.json'), JSON.stringify(ed({ 1: ok({ title: 'FAROL AVULSO X - LADO ESQUERDO' }), 2: ok({ title: 'FAROL AVULSO X - LADO DIREITO' }) }))); gerar(d);
  const man = JSON.parse(lerD(d, 'produto/manifest.json')).produtos;
  const dirE = man['0205008e'];
  assert.match(dirE, /lado-esquerdo--0205008e/); assert.match(lerD(d, 'produto/' + dirE + '/index.html'), /<h1[^>]*>FAROL AVULSO X - LADO ESQUERDO/);
  assert.match(lerD(d, 'produto/' + dirE + '/index.html'), /"price":"139\.79"/);
  assert.match(lerD(d, 'produto/' + antigo + '/index.html'), /http-equiv="refresh"/);
});

/* ───── dados reais do repositório ───── */
test('DADOS REAIS: data/editorial.json é válido contra o feed atual (0 erros); todas as entradas têm motivo e evidência', () => {
  const v = C.validarEditorial(ED, FEED.produtos);
  assert.deepEqual(v.erros, []);
  Object.entries(ED.produtos).forEach(([id, o]) => { assert.ok(o.motivo && o.evidencia, id); assert.ok(Object.keys(o).every(k => ['brand', 'category', 'title', 'desc', 'descModo', 'motivo', 'evidencia', 'status'].includes(k)), id); });
  const cli = spawnSync('node', ['scripts/validar-editorial.js'], { cwd: RAIZ, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
});
test('DADOS REAIS: aplicar o editorial NÃO altera preço, estoque, SKU, ID nem imagem de nenhum produto (PRICE/STOCK/SKU_DIFFS=0)', () => {
  const ef = C.aplicarEditorial(FEED.produtos, ED);
  assert.equal(ef.length, FEED.produtos.length);
  ef.forEach((p, i) => { const o = FEED.produtos[i]; ['id', 'ref', 'price', 'stock', 'img'].forEach(k => assert.equal(p[k], o[k], o.ref + ' ' + k)); });
  const mudou = ef.filter(p => p.editado).length;
  assert.ok(mudou <= Object.keys(ED.produtos).length);
});
test('DADOS REAIS: nenhuma categoria nova é criada e nenhuma marca é inventada (só marcas/categorias que já existem no ERP)', () => {
  const marcasErp = new Set(FEED.produtos.map(p => C.marcaNormalizada(p.brand)).filter(Boolean)), catsErp = new Set(FEED.produtos.map(p => p.category));
  Object.entries(ED.produtos).forEach(([id, o]) => {
    if (o.brand) assert.ok(marcasErp.has(C.marcaNormalizada(o.brand)), id + ' marca ' + o.brand);
    if (o.category) assert.ok(catsErp.has(o.category), id + ' categoria ' + o.category);
  });
});
test('DADOS REAIS: Fitto/Joker NÃO é tocado pelo editorial (decisão humana pendente)', () => {
  Object.values(ED.produtos).forEach(o => { if (o.brand) assert.doesNotMatch(o.brand, /fitto|joker/i); });
  assert.equal(Object.keys(ED.redirecionamentos || {}).filter(k => /fitto|joker/i.test(k) || /fitto|joker/i.test(ED.redirecionamentos[k])).length, 0);
});

test('push seguro: mudança remota em data/editorial.json conta como entrada do gerador (snapshot gerado ficaria velho)', () => {
  const P = require('../scripts/git-push-seguro.js');
  assert.ok(P.ENTRADAS_DO_GERADOR.test('data/editorial.json') && P.ENTRADAS_DO_GERADOR.test('templates/produto.html') && P.ENTRADAS_DO_GERADOR.test('js/catalogo-core.js'));
  assert.ok(!P.ENTRADAS_DO_GERADOR.test('data/produtos.json') && !P.ENTRADAS_DO_GERADOR.test('tests/x.test.js') && !P.ENTRADAS_DO_GERADOR.test('data/editorial.json.bak'));
});
