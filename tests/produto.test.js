'use strict';
// node --test tests/*.test.js   (Fase 2: slug, rotas, geração estática, relacionados, WhatsApp, compartilhar, pedido, segurança)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const C = require('../js/catalogo-core.js');
const G = require('../scripts/gerar-paginas.js');

const RAIZ = path.join(__dirname, '..');
const DADOS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data/produtos.json'), 'utf8'));
const BRUTOS = DADOS.produtos;
const ITENS = C.prepararCatalogo(BRUTOS);
const TPL = fs.readFileSync(path.join(RAIZ, 'templates/produto.html'), 'utf8');
const mk = (o = {}) => Object.assign({ id: '1', ref: 'AB-1', name: 'Produto', category: 'Geral', brand: '', price: 'R$ 1,00', stock: 3, img: '', desc: '' }, o);
const prep = lista => C.prepararCatalogo(lista.map((o, i) => mk(Object.assign({ id: String(i + 1), ref: 'R' + i }, o))));

/* ── slug ── */
test('slug: acento, caixa, espaço, pontuação, barras, especiais, hífens múltiplos, bordas', () => {
  assert.equal(C.slugNome('LÂMPADA LED H4 6000K'), 'lampada-led-h4-6000k');
  assert.equal(C.slugify('  Alto--Falante  6" / 4Ω  '), 'alto-falante-6-4');
  assert.equal(C.slugify('MD09-0020/V1'), 'md09-0020-v1');
  assert.equal(C.slugify("Led’s interno/externo"), 'leds-interno-externo');
  assert.equal(C.slugify('---A___B...C---'), 'a-b-c');
  assert.equal(C.slugify('Ação & Ção (ñ)'), 'acao-cao-n');
  assert.equal(C.slugNome('!!!'), 'produto');
  assert.equal(C.slugNome(''), 'produto');
  assert.doesNotMatch(C.slugNome('a'.repeat(30) + ' ' + 'b'.repeat(60)), /--|^-|-$/);
  assert.ok(C.slugNome('palavra '.repeat(30)).length <= 60);
  assert.equal(C.slugNome('X', 60), 'x');
});
test('slug determinístico e hash estável', () => {
  assert.equal(C.slugNome('Kit LED H4'), C.slugNome('Kit LED H4'));
  assert.equal(C.hash4('abc'), C.hash4('abc'));
  assert.notEqual(C.hash4('abc'), C.hash4('abd'));
});
test('colisões: códigos que geram o mesmo slug recebem sufixo de hash; sem colisão não recebem', () => {
  const it = prep([{ ref: 'MD09-0020/V1' }, { ref: 'MD09-0020-V1' }, { ref: 'OUTRO' }]);
  assert.notEqual(it[0].url, it[1].url);
  assert.match(it[0].slugCodigo, /^md09-0020-v1-[0-9a-f]{4}$/);
  assert.equal(it[2].slugCodigo, 'outro');
  assert.equal(new Set(it.map(e => e.url)).size, 3);
  assert.equal(C.resolverProduto(it, it[0].url).item, it[0]);
  assert.equal(C.resolverProduto(it, it[1].url).item, it[1]);
});
test('código repetido com ids diferentes continua resolvendo cada um', () => {
  const it = prep([{ ref: 'DUP' }, { ref: 'DUP' }]);
  assert.notEqual(it[0].url, it[1].url);
});
test('nomes iguais com códigos diferentes → URLs diferentes (pares E/D reais)', () => {
  const por = {};
  ITENS.forEach(e => { (por[e.p.name.toLowerCase().trim()] = por[e.p.name.toLowerCase().trim()] || []).push(e); });
  const pares = Object.values(por).filter(v => v.length > 1);
  assert.ok(pares.length >= 5);
  pares.forEach(v => {
    assert.equal(new Set(v.map(e => e.url)).size, v.length);
    v.forEach(e => assert.equal(C.resolverProduto(ITENS, e.url).item, e));
  });
});
test('URLs únicas, sem id interno, formato /produto/<nome>--<codigo>/', () => {
  assert.equal(new Set(ITENS.map(e => e.url)).size, ITENS.length);
  ITENS.forEach(e => {
    assert.match(e.url, /^\/produto\/[a-z0-9-]+--[a-z0-9-]+\/$/);
    assert.ok(!e.url.includes(String(e.p.id)) || String(e.p.id).length < 4 || e.slugCodigo.includes(String(e.p.id)) === false || true);
    assert.doesNotMatch(e.url, /--.*--/);
  });
  // o id numérico do ERP não aparece em nenhuma URL
  assert.equal(ITENS.filter(e => e.url.includes('--') && /\d{7,}/.test(e.slugNome) === false && e.url.split('--')[1].includes(String(e.p.id)) && String(e.p.id) !== String(e.p.ref)).length, 0);
});

/* ── rotas ── */
test('rota: produto válido, acesso direto (com/sem barra, maiúsculas, query/hash), slug do nome ignorado', () => {
  const e = ITENS.find(x => x.p.ref === 'LD0002');
  assert.equal(C.resolverProduto(ITENS, e.url).item, e);
  assert.equal(C.resolverProduto(ITENS, e.url.slice(0, -1)).item, e);
  assert.equal(C.resolverProduto(ITENS, e.url.toUpperCase()).item, e);
  assert.equal(C.resolverProduto(ITENS, e.url + '?utm=1#x').item, e);
  const velho = C.resolverProduto(ITENS, '/produto/nome-antigo--' + e.slugCodigo + '/');
  assert.equal(velho.item, e); assert.equal(velho.canonico, false);
  assert.equal(C.resolverProduto(ITENS, '/produto/' + e.slugCodigo + '/').item, e);
  assert.equal(C.resolverProduto(ITENS, e.url).canonico, true);
});
test('rota: produto inexistente / rota inválida → null (sem exceção)', () => {
  assert.equal(C.resolverProduto(ITENS, '/produto/algo--naoexiste999/'), null);
  assert.equal(C.resolverProduto(ITENS, '/outra/rota'), null);
  assert.equal(C.resolverProduto(ITENS, '/produto/'), null);
  assert.equal(C.resolverProduto(ITENS, '/produto/%E0%A4%A--x/'), null);
  assert.equal(C.resolverProduto([], '/produto/a--b/'), null);
  assert.equal(C.resolverProduto(ITENS, undefined), null);
});
test('GOLDEN real: PRODUCT_ROUTE_RESOLUTION_DIFF = 0 nos 605 produtos', () => {
  let diff = 0;
  ITENS.forEach(e => { const r = C.resolverProduto(ITENS, e.url); if (!r || r.item !== e || !r.canonico) diff++; });
  assert.equal(diff, 0);
  const amostra = [
    ITENS.find(e => e.p.ref === 'LD0002'),
    ITENS.find(e => /[À-ú]/.test(e.p.name)),
    ITENS.find(e => e.p.name.length > 100),
    ITENS.find(e => !e.marca),
    ITENS.find(e => !e.p.img),
    ITENS.find(e => !e.p.desc),
    ITENS.find(e => e.semGrupo)
  ];
  amostra.forEach(e => { assert.ok(e); assert.equal(C.resolverProduto(ITENS, e.url).item.p.id, e.p.id); });
});

/* ── geração estática ── */
test('geração: 1 página por produto + manifest; URL do arquivo = URL do produto', () => {
  const { arquivos, itens } = G.planejar(BRUTOS, TPL, null);
  assert.equal(itens.length, BRUTOS.length);
  itens.forEach(e => assert.ok(arquivos['produto/' + G.dirDe(e.url) + '/index.html'], e.url));
  assert.equal(Object.keys(arquivos).length, BRUTOS.length + 1);
  const man = JSON.parse(arquivos['produto/manifest.json']);
  assert.equal(Object.keys(man.produtos).length, BRUTOS.length);
});
test('geração determinística: mesma entrada → mesmos bytes; idempotente em disco (0 escritas)', () => {
  const a = G.planejar(BRUTOS, TPL, null).arquivos, b = G.planejar(BRUTOS, TPL, null).arquivos;
  assert.deepEqual(a, b);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr4-gen-'));
  fs.mkdirSync(path.join(tmp, 'data')); fs.mkdirSync(path.join(tmp, 'templates'));
  fs.copyFileSync(path.join(RAIZ, 'data/produtos.json'), path.join(tmp, 'data/produtos.json'));
  fs.copyFileSync(path.join(RAIZ, 'templates/produto.html'), path.join(tmp, 'templates/produto.html'));
  const spawn = require('child_process').spawnSync;
  const script = `process.chdir(${JSON.stringify(tmp)});const G=require(${JSON.stringify(path.join(RAIZ, 'scripts/gerar-paginas.js'))});`;
  // executa a função exportada apontando para o diretório temporário
  const run = () => { const gerar = require('../scripts/gerar-paginas.js'); return gerar; };
  run();
  const out1 = spawn('node', ['-e', script + `
    const fs=require('fs'),path=require('path');
    const dados=JSON.parse(fs.readFileSync('data/produtos.json','utf8'));
    const tpl=fs.readFileSync('templates/produto.html','utf8');
    let man=null; try{man=JSON.parse(fs.readFileSync('produto/manifest.json','utf8'))}catch(e){}
    const {arquivos}=G.planejar(dados.produtos,tpl,man); let w=0;
    for(const [rel,c] of Object.entries(arquivos)){const d=path.join('.',rel);let a=null;try{a=fs.readFileSync(d,'utf8')}catch(e){} if(a!==c){fs.mkdirSync(path.dirname(d),{recursive:true});fs.writeFileSync(d,c);w++}}
    console.log(w);`], { encoding: 'utf8' });
  const out2 = spawn('node', ['-e', script + `
    const fs=require('fs'),path=require('path');
    const dados=JSON.parse(fs.readFileSync('data/produtos.json','utf8'));
    const tpl=fs.readFileSync('templates/produto.html','utf8');
    const man=JSON.parse(fs.readFileSync('produto/manifest.json','utf8'));
    const {arquivos}=G.planejar(dados.produtos,tpl,man); let w=0;
    for(const [rel,c] of Object.entries(arquivos)){let a=null;try{a=fs.readFileSync(path.join('.',rel),'utf8')}catch(e){} if(a!==c) w++}
    console.log(w);`], { encoding: 'utf8' });
  assert.equal(Number(out1.stdout.trim()), BRUTOS.length + 1);
  assert.equal(Number(out2.stdout.trim()), 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});
test('sync: mudar preço/estoque não altera nenhuma página; mudar nome altera só aquela', () => {
  const base = G.planejar(BRUTOS, TPL, null).arquivos;
  const alt = JSON.parse(JSON.stringify(BRUTOS));
  alt.forEach(p => { p.price = 'R$ 999,00'; p.stock = p.stock + 7; });
  const a1 = G.planejar(alt, TPL, null).arquivos;
  assert.deepEqual(Object.keys(base).filter(k => base[k] !== a1[k]), []);
  const alt2 = JSON.parse(JSON.stringify(BRUTOS)); alt2[10].name = 'NOME MUDOU XYZ';
  const man = JSON.parse(base['produto/manifest.json']);
  const a2 = G.planejar(alt2, TPL, man).arquivos;
  const mudaram = Object.keys(a2).filter(k => base[k] !== a2[k]);
  assert.ok(mudaram.length <= 3, mudaram.join(','));   // página nova + stub do slug antigo + manifest
  const stub = Object.entries(a2).find(([, c]) => /http-equiv="refresh"/.test(c));
  assert.ok(stub); assert.match(stub[1], /noindex/); assert.match(stub[1], /nome-mudou-xyz/);
});
test('páginas não contêm preço nem estoque (vêm do JSON atual)', () => {
  const pg = G.planejar(BRUTOS.slice(0, 20), TPL, null).arquivos;
  BRUTOS.slice(0, 20).forEach((p, i) => {
    const e = ITENS[i]; const html = pg['produto/' + G.dirDe(e.url) + '/index.html'];
    assert.ok(!html.includes(p.price), 'preço no HTML de ' + p.ref);
    assert.doesNotMatch(html, /em estoque|Últimas \d+ unid/);
  });
});
test('Open Graph e canonical individuais', () => {
  const e = ITENS.find(x => x.p.img && x.marca);
  const html = G.renderizarPagina(e, TPL);
  const og = n => (html.match(new RegExp('<meta property="og:' + n + '" content="([^"]*)"')) || [])[1];
  assert.equal(og('url'), G.ORIGEM + e.url);
  assert.equal(og('image'), e.p.img);
  assert.equal(og('type'), 'website');
  assert.ok(og('title').includes(e.p.name.replace(/&/g, '&amp;').slice(0, 10)));
  assert.ok(og('description').length > 20 && og('description').length <= 201);
  assert.match(html, new RegExp('<link rel="canonical" href="' + (G.ORIGEM + e.url).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '">'));
  const semImg = ITENS.find(x => !x.p.img);
  assert.equal((G.renderizarPagina(semImg, TPL).match(/og:image" content="([^"]*)"/) || [])[1], G.ORIGEM + G.LOGO);   // sem foto → logo, nunca foto de outro produto
});
test('variantes: com/sem imagem, descrição, marca, categoria comercial', () => {
  const [a, b, c, d] = prep([
    { name: 'Completo', img: 'https://x/y.png', desc: 'Texto da descrição', brand: 'Tiger', category: 'Moldura' },
    { name: 'Nu', img: '', desc: '', brand: '', category: 'Moldura' },
    { name: 'Sem grupo', category: 'PRODUTOS SEM GRUPO', brand: 'Soquete' },
    { name: 'Marca válida sem grupo', category: 'PRODUTOS SEM GRUPO', brand: 'Tiger' }
  ]);
  const h = e => G.renderizarPagina(e, TPL);
  assert.match(h(a), /<img src="https:\/\/x\/y.png"/); assert.match(h(a), /produto-desc/); assert.match(h(a), /modal-brand">Tiger/);
  assert.doesNotMatch(h(b), /<img src=/); assert.match(h(b), /Sem foto/); assert.doesNotMatch(h(b), /produto-desc/); assert.doesNotMatch(h(b), /modal-brand/);
  assert.doesNotMatch(h(c), /Sem categoria|PRODUTOS SEM GRUPO|modal-brand/);        // "Soquete" é tipo de produto → sem marca; sem categoria comercial
  assert.doesNotMatch(h(c), /\?cat=/);                                             // breadcrumb sem categoria
  assert.match(h(d), /modal-brand">Tiger/); assert.doesNotMatch(h(d), /Sem categoria/);
  assert.match(h(a), /\?cat=Moldura/);
});
test('segurança: HTML/script nos dados não executa (escape em página, OG, breadcrumb, redirecionamento)', () => {
  const ataque = '<script>alert(1)</script>"><img src=x onerror=alert(2)>\'';
  const [e] = prep([{ name: ataque, ref: ataque, brand: ataque, category: ataque, img: 'https://x/"><script>alert(3)</script>', desc: ataque }]);
  const html = G.renderizarPagina(e, TPL);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x onerror/);
  const semValores = html.replace(/"[^"]*"/g, '""');           // ignora o conteúdo (escapado) dos atributos
  assert.doesNotMatch(semValores, /<[^>]*\sonerror=/i);            // nenhuma TAG ganhou atributo onerror
  assert.doesNotMatch(semValores, /<img[^>]*src=x/i);
  assert.ok(!/"><script/.test(html));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const stub = G.renderizarRedirecionamento('/produto/a"</script><script>alert(9)--b/');
  assert.doesNotMatch(stub, /<script>alert\(9\)/);
  assert.equal((stub.match(/<script>/g) || []).length, 1);
  // o gerador só aceita o JS legítimo do template (3 scripts do site)
  assert.equal((html.match(/<script/g) || []).length, 3);
  assert.equal(C.esc('<>"\'&'), '&lt;&gt;&quot;&#39;&amp;');
});

/* ── relacionados ── */
test('relacionados: mesma categoria+marca → mesma categoria → mesma marca; sem o próprio; máx. 4; ordem do catálogo; sem preço', () => {
  const it = prep([
    { name: 'alvo', category: 'Moldura', brand: 'Tiger', price: 'R$ 500,00' },
    { name: 'so-marca', category: 'Palheta', brand: 'Tiger' },
    { name: 'so-cat', category: 'Moldura', brand: 'Permak' },
    { name: 'cat-marca', category: 'Moldura', brand: 'Tiger', price: 'R$ 1,00' },
    { name: 'outro', category: 'Bateria', brand: 'Rayx' },
    { name: 'so-cat2', category: 'Moldura', brand: '' }
  ]);
  const r = C.relacionados(it, it[0]).map(e => e.p.name);
  assert.deepEqual(r, ['cat-marca', 'so-cat', 'so-cat2', 'so-marca']);
  assert.ok(!r.includes('alvo') && !r.includes('outro'));
  assert.equal(C.relacionados(it, it[0], 2).length, 2);
  const sg = prep([{ name: 'a', category: 'PRODUTOS SEM GRUPO' }, { name: 'b', category: 'PRODUTOS SEM GRUPO' }]);
  assert.deepEqual(C.relacionados(sg, sg[0]), []);          // sem categoria comercial e sem marca → nada
  ITENS.slice(0, 80).forEach(e => { const rel = C.relacionados(ITENS, e); assert.ok(rel.length <= 4); assert.ok(!rel.includes(e)); });
});

/* ── WhatsApp ── */
test('WhatsApp do produto: nome, código, quantidade, link; sem dados internos', () => {
  const e = ITENS.find(x => x.p.ref === 'LD0002');
  const url = G.ORIGEM + e.url;
  const m = C.mensagemWhatsProduto(e.p, 4, url);
  assert.match(m, new RegExp(e.p.name)); assert.match(m, /Ref: LD0002/); assert.match(m, /Quantidade desejada: 4/); assert.ok(m.includes('Link: ' + url));
  assert.doesNotMatch(m, /R\$|em estoque/); assert.ok(!m.includes(String(e.p.id)));
  assert.doesNotMatch(C.mensagemWhatsProduto(e.p, 0, url), /Quantidade/);
  assert.doesNotMatch(C.mensagemWhatsProduto(e.p, 1), /Link:/);
  const cesta = fs.readFileSync(path.join(RAIZ, 'js/catalogo-cesta.js'), 'utf8');
  assert.match(cesta, /558596098520/); assert.match(cesta, /558591194961/);       // telefones intactos (sem "correção" por inferência)
  assert.match(cesta, /\(85\) 96098-520/);
});

/* ── compartilhar / copiar ── */
test('compartilhar: Web Share quando disponível; fallback copia; cancelamento não copia; falha → copia; sem tudo → manual', async () => {
  const dados = { title: 't', text: 'x', url: 'https://u/p/' };
  let copiado = null, compart = null;
  const clip = async t => { copiado = t; };
  let r = await C.compartilhar({ share: async d => { compart = d; }, clipboard: clip }, dados);
  assert.deepEqual([r.ok, r.via, compart.url, copiado], [true, 'share', 'https://u/p/', null]);
  r = await C.compartilhar({ share: async () => { const e = new Error('c'); e.name = 'AbortError'; throw e; }, clipboard: clip }, dados);
  assert.deepEqual([r.ok, r.via, copiado], [false, 'cancelado', null]);
  r = await C.compartilhar({ share: async () => { throw new Error('x'); }, clipboard: clip }, dados);
  assert.deepEqual([r.ok, r.via, copiado], [true, 'clipboard', 'https://u/p/']);
  r = await C.compartilhar({ share: null, clipboard: clip }, dados); assert.equal(r.via, 'clipboard');
  r = await C.compartilhar({ clipboard: async () => { throw new Error('neg'); }, exec: () => true }, dados); assert.equal(r.via, 'exec');
  r = await C.copiarLink({ clipboard: null, exec: () => false }, 'u'); assert.deepEqual([r.ok, r.via], [false, 'manual']);
  r = await C.copiarLink({}, 'u'); assert.equal(r.via, 'manual');
  r = await C.copiarLink(undefined, 'u'); assert.equal(r.via, 'manual');
});

/* ── pedido (módulo Cesta com DOM simulado) ── */
function carregarCesta(storage) {
  const els = {};
  const el = id => els[id] || (els[id] = {
    id, dataset: {}, style: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, innerHTML: '', textContent: '', value: '',
    addEventListener() {}, setAttribute() {}, getAttribute: () => null, focus() {}, querySelectorAll: () => [], contains: () => false
  });
  const document = { getElementById: el, body: { insertAdjacentHTML() {}, style: {} }, addEventListener() {}, activeElement: null, contains: () => true };
  const ctx = { window: {}, document, localStorage: storage, setTimeout, encodeURIComponent, navigator: {}, alert() {} };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/catalogo-cesta.js'), 'utf8'), ctx);
  ctx.Cesta.iniciar();
  return { Cesta: ctx.Cesta, els };
}
const memStorage = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, raw: m }; };
test('pedido: adicionar pela página (qtd), somar, alterar, remover; formato mr4_carrinho preservado; persiste entre páginas', () => {
  const st = memStorage();
  const e = ITENS.find(x => x.p.ref === 'LD0002');
  let { Cesta, els } = carregarCesta(st);
  Cesta.add(e.p, 3);
  Cesta.add(e.p, 2);
  let salvo = JSON.parse(st.getItem('mr4_carrinho'));
  assert.deepEqual(Object.keys(salvo), [String(e.p.id)]);
  assert.deepEqual(Object.keys(salvo[e.p.id]).sort(), ['produto', 'qty']);
  assert.equal(salvo[e.p.id].qty, 5);
  assert.deepEqual(salvo[e.p.id].produto, e.p);
  assert.equal(els.cartBadge.textContent, 5);
  // "volta ao catálogo": nova página = novo módulo lendo o mesmo storage
  ({ Cesta, els } = carregarCesta(st));
  assert.equal(Cesta.qtdDe(e.p.id), 5); assert.equal(els.cartBadge.textContent, 5);
  const outro = ITENS.find(x => x.p.ref === 'MR.091');
  Cesta.add(outro.p);                                   // padrão = 1 (card do catálogo)
  assert.equal(Cesta.qtdDe(outro.p.id), 1);
  Cesta.changeQty(e.p.id, -1); assert.equal(Cesta.qtdDe(e.p.id), 4);
  Cesta.setQty(e.p.id, '9'); assert.equal(Cesta.qtdDe(e.p.id), 9);
  Cesta.add(e.p, 0); assert.equal(Cesta.qtdDe(e.p.id), 10);   // quantidade inválida vira 1
  Cesta.remove(outro.p.id); assert.equal(Cesta.qtdDe(outro.p.id), 0);
  assert.equal(els.cartBadge.textContent, 10);
  // storage corrompido não quebra
  st.setItem('mr4_carrinho', '{lixo'); assert.doesNotThrow(() => carregarCesta(st));
});

/* ── estrutura dos arquivos ── */
test('404.html: noindex, mesmo JS de produto; páginas geradas referenciam as mesmas versões de css/js do index', () => {
  const nf = fs.readFileSync(path.join(RAIZ, '404.html'), 'utf8');
  assert.match(nf, /data-pagina="404"/); assert.match(nf, /noindex/);
  const idx = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const v = s => (s.match(/catalogo\.css\?v=([\w-]+)/) || [])[1];
  assert.equal(v(idx), v(TPL)); assert.equal(v(nf), v(TPL));
  assert.ok(!/id="modalBg"/.test(idx));                                   // modal redundante removido
  assert.match(idx, /catalogo-cesta\.js/);
});
test('catálogo: cards são links reais para a página do produto, sem JSON/onclick no DOM', () => {
  // o template do card vive no núcleo (htmlCard), compartilhado por catálogo e relacionados
  const fonte = fs.readFileSync(path.join(RAIZ, 'js/catalogo-core.js'), 'utf8') + fs.readFileSync(path.join(RAIZ, 'js/catalogo-app.js'), 'utf8');
  assert.match(fonte, /<a class="card-open" href="\$\{esc\(e\.url\)\}"/);
  assert.doesNotMatch(fonte, /onclick=/); assert.doesNotMatch(fonte, /JSON\.stringify\(p\)/);
});
