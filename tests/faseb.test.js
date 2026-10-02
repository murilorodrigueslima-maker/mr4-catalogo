'use strict';
// UX B2B — Fase B: quantidade, pedido com preço atual, total estimado, produto removido, estoque, vendedor, página do produto
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const C = require('../js/catalogo-core.js');

const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const CESTA = ler('js/catalogo-cesta.js'), PAGINA = ler('js/produto-app.js'), APP = ler('js/catalogo-app.js');
const CSS = ler('css/catalogo.css'), CSSP = ler('css/produto.css');
const mk = (id, ref, price, stock, o = {}) => Object.assign({ id: String(id), ref, name: 'Produto ' + ref, category: 'Moldura', brand: 'Tiger', price, stock, img: '', desc: '' }, o);
const catalogo = lista => C.prepararCatalogo(lista);
const linhaCarrinho = (p, qty) => ({ produto: p, qty });

/* ── dinheiro em centavos inteiros ── */
test('precoCentavos / formatarCentavos: inteiros, sem ponto flutuante', () => {
  const casos = [['R$ 39,90', 3990], ['R$ 2,50', 250], ['R$ 1.450,00', 145000], ['R$ 0,50', 50], ['R$ 0,05', 5], ['R$ 12', 1200], ['R$ 3,5', 350], ['R$ 1.234.567,89', 123456789]];
  casos.forEach(([t, c]) => assert.equal(C.precoCentavos(t), c, t));
  ['Sob consulta', '', null, undefined, 'abc', 'R$ -', 'R$ 1,234'].forEach(t => assert.equal(C.precoCentavos(t), null, String(t)));
  assert.equal(C.formatarCentavos(11970), 'R$ 119,70');
  assert.equal(C.formatarCentavos(14470), 'R$ 144,70');
  assert.equal(C.formatarCentavos(145000), 'R$ 1.450,00');
  assert.equal(C.formatarCentavos(5), 'R$ 0,05');
  assert.equal(C.formatarCentavos(0), 'R$ 0,00');
  assert.equal(C.formatarCentavos(null), '—');
  // armadilhas clássicas do float: 0,10 × 3 e 19,99 × 3
  assert.equal(C.formatarCentavos(C.precoCentavos('R$ 0,10') * 3), 'R$ 0,30');
  assert.equal(C.formatarCentavos(C.precoCentavos('R$ 19,99') * 3), 'R$ 59,97');
  assert.equal(C.formatarCentavos(C.precoCentavos('R$ 1,15') * 100), 'R$ 115,00');
});
test('quantidade: inteiro ≥ 1, sem NaN, sem negativo, com teto', () => {
  assert.deepEqual(['', 'abc', null, undefined, '0', '-5', '  ', '1,5', '٣'].map(C.normalizarQtd), [1, 1, 1, 1, 1, 1, 1, 15, 1]);
  assert.equal(C.normalizarQtd('20'), 20); assert.equal(C.normalizarQtd(' 3 '), 3); assert.equal(C.normalizarQtd(7), 7);
  assert.equal(C.normalizarQtd('99999999999'), C.MAX_QTD); assert.equal(C.MAX_QTD, 9999);
});

/* ── pedido: exemplos do enunciado ── */
test('subtotal e total: A 3 × R$ 39,90 = R$ 119,70; B 10 × R$ 2,50 = R$ 25,00; total R$ 144,70', () => {
  const it = catalogo([mk(1, 'A', 'R$ 39,90', 100), mk(2, 'B', 'R$ 2,50', 100)]);
  const car = { 1: linhaCarrinho(it[0].p, 3), 2: linhaCarrinho(it[1].p, 10) };
  const r = C.resolverPedido(car, it);
  assert.deepEqual(r.linhas.map(l => [C.formatarCentavos(l.precoCent), l.qtd, C.formatarCentavos(l.subtotalCent)]), [['R$ 39,90', 3, 'R$ 119,70'], ['R$ 2,50', 10, 'R$ 25,00']]);
  assert.equal(r.totalCent, 14470); assert.equal(C.formatarCentavos(r.totalCent), 'R$ 144,70');
  assert.equal(r.totalItens, 13); assert.equal(r.indisponiveis, 0); assert.equal(r.carregado, true);
});
test('PREÇO ATUAL VENCE: carrinho guarda R$ 39,90, JSON atual R$ 42,90 → subtotal e total usam R$ 42,90', () => {
  const antigo = mk(1, 'A', 'R$ 39,90', 50);
  const atual = catalogo([mk(1, 'A', 'R$ 42,90', 50)]);
  const r = C.resolverPedido({ 1: linhaCarrinho(antigo, 3) }, atual);
  const l = r.linhas[0];
  assert.equal(l.precoCent, 4290); assert.equal(l.subtotalCent, 12870); assert.equal(r.totalCent, 12870);
  assert.equal(l.precoAtualizado, true);
  // preço igual → sem aviso
  const igual = C.resolverPedido({ 1: linhaCarrinho(mk(1, 'A', 'R$ 42,90', 50), 1) }, atual).linhas[0];
  assert.equal(igual.precoAtualizado, false);
  // o preço guardado nunca entra na conta, mesmo que seja o único disponível
  assert.notEqual(r.totalCent, 3990 * 3);
});
test('PRODUTO REMOVIDO do JSON: continua no pedido (nome, código, qtd), indisponível, sem preço, fora do total', () => {
  const it = catalogo([mk(2, 'B', 'R$ 2,50', 100)]);
  const car = { 1: linhaCarrinho(mk(1, 'X', 'R$ 99,00', 5, { name: 'Produto X' }), 5), 2: linhaCarrinho(it[0].p, 2) };
  const r = C.resolverPedido(car, it);
  const x = r.linhas.find(l => l.id === '1');
  assert.equal(x.estado, 'indisponivel'); assert.equal(x.nome, 'Produto X'); assert.equal(x.ref, 'X'); assert.equal(x.qtd, 5);
  assert.equal(x.precoCent, undefined); assert.equal(x.subtotalCent, undefined);
  assert.equal(r.indisponiveis, 1); assert.equal(r.totalCent, 500);               // só o produto B (2 × 2,50)
  assert.equal(r.totalItens, 7);                                                   // as 5 unidades continuam contadas como itens do pedido
  assert.ok(!JSON.stringify(x).includes('9900'));                                  // preço antigo não vaza
  const car2 = JSON.parse(JSON.stringify(car));
  C.resolverPedido(car2, it); assert.deepEqual(car2, car);                         // resolver NÃO altera nem remove o carrinho
});
test('ESTOQUE: 10 desejadas, 6 em estoque → mantém 10, avisa, não reduz', () => {
  const it = catalogo([mk(1, 'A', 'R$ 10,00', 6)]);
  const r = C.resolverPedido({ 1: linhaCarrinho(it[0].p, 10) }, it);
  const l = r.linhas[0];
  assert.equal(l.qtd, 10); assert.equal(l.acimaEstoque, true); assert.equal(l.estoque, 6); assert.equal(l.subtotalCent, 10000); assert.equal(r.totalCent, 10000);
  assert.equal(C.resolverPedido({ 1: linhaCarrinho(it[0].p, 6) }, it).linhas[0].acimaEstoque, false);   // = estoque: normal
  assert.equal(C.resolverPedido({ 1: linhaCarrinho(it[0].p, 1) }, it).linhas[0].acimaEstoque, false);
});
test('item sem preço fixo ("Sob consulta") não entra no total e não quebra', () => {
  const it = catalogo([mk(1, 'A', 'Sob consulta', 5), mk(2, 'B', 'R$ 1,00', 5)]);
  const r = C.resolverPedido({ 1: linhaCarrinho(it[0].p, 2), 2: linhaCarrinho(it[1].p, 3) }, it);
  assert.equal(r.semPreco, 1); assert.equal(r.totalCent, 300);
  assert.equal(r.linhas[0].subtotalCent, null);
});
test('catálogo ainda não carregado: mostra o pedido sem preço (nunca usa o preço guardado)', () => {
  const r = C.resolverPedido({ 1: linhaCarrinho(mk(1, 'A', 'R$ 39,90', 5), 3) }, null);
  assert.equal(r.carregado, false); assert.equal(r.linhas[0].estado, 'carregando'); assert.equal(r.linhas[0].qtd, 3);
  assert.equal(r.totalCent, 0); assert.equal(r.linhas[0].precoCent, undefined);
});

/* ── compatibilidade com carrinho antigo (fixture do formato pré-Fase B) ── */
const CARRINHO_ANTIGO = JSON.stringify({
  '47142039': { produto: { id: '47142039', ref: 'MR.016', name: 'T10 8 LEDS', category: 'Led’s interno/externo', brand: 'LDCAR', price: 'R$ 1,50', stock: 100, img: 'https://x/a.png', desc: '', slugNome: 'x' }, qty: 4 },
  '99999999': { produto: { id: '99999999', ref: 'FENIXH4', name: 'H4 LED FENIX 11.000 LUMENS', price: 'R$ 80,00', stock: 3, img: '' }, qty: '2' },
  '55': { produto: { id: '55', name: 'Sem código antigo', price: 'R$ 5,00' }, qty: 1 },
  '56': 'lixo', '57': { qty: 3 }
});
test('carrinho antigo: abre, mantém quantidades, resolve por código, calcula preço atual, nada é perdido', () => {
  const car = JSON.parse(CARRINHO_ANTIGO);
  const dados = JSON.parse(ler('data/produtos.json')).produtos;
  const it = C.prepararCatalogo(dados);
  const r = C.resolverPedido(car, it);
  const t10 = r.linhas.find(l => l.ref === 'MR.016'), fenix = r.linhas.find(l => l.ref === 'FENIXH4');
  assert.ok(t10 && fenix);
  assert.equal(t10.qtd, 4); assert.equal(fenix.qtd, 2);                            // "2" (texto) vira 2
  const atualT10 = dados.find(p => p.ref === 'MR.016');
  assert.equal(t10.precoCent, C.precoCentavos(atualT10.price));                    // preço ATUAL, não o R$ 1,50 guardado
  assert.equal(t10.subtotalCent, C.precoCentavos(atualT10.price) * 4);
  assert.equal(t10.precoAtualizado, C.precoCentavos(atualT10.price) !== 150);
  assert.equal(r.linhas.length, 4);                                                // 56 ("lixo") é ignorado só na leitura; os demais seguem
  assert.equal(r.linhas.find(l => l.id === '57').estado, 'indisponivel');          // sem produto/código: honesto, não inventa
});
function ctxCesta(armazenado) {
  const els = {};
  const el = id => els[id] || (els[id] = {
    id, dataset: {}, style: {}, hidden: false, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, innerHTML: '', textContent: '', value: '',
    addEventListener(t, f) { (this.h = this.h || {})[t] = f; }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, focus() {}, select() {},
    querySelector: () => null, querySelectorAll: () => [], contains: () => false
  });
  const mem = {}; if (armazenado != null) mem.mr4_carrinho = armazenado;
  const mkStorage = m => ({ getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } });
  const abertos = [];
  const document = { getElementById: el, body: { insertAdjacentHTML() {}, style: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} } }, addEventListener() {}, activeElement: null, contains: () => true, querySelectorAll: () => [] };
  const ctx = { document, localStorage: mkStorage(mem), sessionStorage: mkStorage({}), setTimeout, encodeURIComponent, navigator: {}, addEventListener() {}, open: (u) => { abertos.push(u); return {}; } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/catalogo-core.js'), 'utf8'), ctx);
  vm.runInContext(CESTA, ctx);
  ctx.Cesta.iniciar();
  return { Cesta: ctx.Cesta, els, mem, abertos, ctx };
}
test('Cesta: lê o carrinho antigo sem apagar nada e continua gravando no MESMO formato/chave', () => {
  const { Cesta, mem } = ctxCesta(CARRINHO_ANTIGO);
  assert.equal(Cesta.qtdDe('47142039'), 4); assert.equal(Cesta.qtdDe('99999999'), 2);
  const novo = C.prepararCatalogo([mk(7, 'NOVO', 'R$ 3,00', 9)])[0].p;
  Cesta.add(novo, 5);
  const salvo = JSON.parse(mem.mr4_carrinho);
  assert.deepEqual(Object.keys(salvo).sort(), ['47142039', '55', '56', '57', '7', '99999999'].sort());   // nada sumiu (inclusive entradas estranhas)
  assert.deepEqual(Object.keys(salvo['7']).sort(), ['produto', 'qty']); assert.equal(salvo['7'].qty, 5);
  assert.equal(salvo['47142039'].produto.ref, 'MR.016');
  assert.deepEqual(Object.keys(mem).filter(k => /carrinho/i.test(k)), ['mr4_carrinho']);                  // um único armazenamento do pedido
});
test('Cesta: JSON corrompido não quebra; quantidades são limitadas e normalizadas; remover/limpar', () => {
  const lixo = ctxCesta('{nao-json');
  assert.equal(lixo.Cesta.resumo().linhas.length, 0);
  const { Cesta, mem } = ctxCesta(null);
  const p = C.prepararCatalogo([mk(1, 'A', 'R$ 1,00', 5)])[0].p;
  Cesta.add(p, '12abc'); assert.equal(Cesta.qtdDe('1'), 12);
  Cesta.add(p, -3); assert.equal(Cesta.qtdDe('1'), 13);                                                    // negativo vira 1
  Cesta.add(p, 999999); assert.equal(Cesta.qtdDe('1'), C.MAX_QTD);                                         // teto
  Cesta.setQty('1', 20); assert.equal(Cesta.qtdDe('1'), 20);
  Cesta.changeQty('1', -19); assert.equal(Cesta.qtdDe('1'), 1);
  Cesta.changeQty('1', -1); assert.equal(Cesta.qtdDe('1'), 0); assert.equal(JSON.parse(mem.mr4_carrinho)['1'], undefined);
  Cesta.add(p, 2); Cesta.remove('1'); assert.equal(Cesta.qtdDe('1'), 0);
  Cesta.add(p, 2); Cesta.limpar(); assert.deepEqual(JSON.parse(mem.mr4_carrinho), {});
});
test('Cesta: resumo usa SEMPRE o catálogo atual (definirCatalogo) para preço/total', () => {
  const { Cesta } = ctxCesta(JSON.stringify({ 1: { produto: { id: '1', ref: 'A', name: 'A', price: 'R$ 39,90' }, qty: 3 } }));
  assert.equal(Cesta.resumo().linhas[0].estado, 'carregando');
  Cesta.definirCatalogo(C.prepararCatalogo([mk(1, 'A', 'R$ 42,90', 50)]));
  const r = Cesta.resumo();
  assert.equal(r.totalCent, 12870); assert.equal(r.linhas[0].precoAtualizado, true);
  Cesta.definirCatalogo(C.prepararCatalogo([]));                                                           // produto sumiu do JSON
  const r2 = Cesta.resumo(); assert.equal(r2.linhas[0].estado, 'indisponivel'); assert.equal(r2.totalCent, 0); assert.equal(Cesta.qtdDe('1'), 3);
});

/* ── vendedor e WhatsApp ── */
test('último vendedor: lembrado, pré-selecionado, trocável; telefones intactos; mensagem igual à anterior', () => {
  const a = ctxCesta(null);
  const p = C.prepararCatalogo([mk(1, 'A', 'R$ 1,00', 5, { name: 'LÂMPADA A' })])[0].p;
  a.Cesta.add(p, 2);
  assert.equal(a.els.vendedorSel.value, 'ademir');                                                         // padrão = primeiro vendedor (comportamento anterior)
  a.ctx.document.getElementById('clienteNome').value = ' Loja X ';
  a.els.vendedorSel.value = 'fabiana';
  a.els.btnEnviarPedido.h.click();
  assert.equal(a.abertos.length, 1);
  assert.ok(a.abertos[0].startsWith('https://wa.me/558591194961?text='));
  assert.equal(decodeURIComponent(a.abertos[0].split('text=')[1]), 'Ola, MR4 Distribuidora!\n\n*Loja X* - Pedido:\n\n• 2x LÂMPADA A (Ref: A)\n\n*Total: 2 itens*');
  assert.equal(a.mem.mr4_ultimo_vendedor, 'fabiana');
  // próxima visita: carrega o último
  const b = ctxCesta(a.mem.mr4_carrinho); b.ctx.localStorage.setItem('mr4_ultimo_vendedor', 'fabiana'); b.Cesta.iniciar();
  assert.equal(b.els.vendedorSel.value, 'fabiana');
  b.els.vendedorSel.value = 'ademir'; b.els.btnEnviarPedido.h.click();
  assert.ok(b.abertos[0].startsWith('https://wa.me/558596098520?text='));                                  // troca fácil; número do Ademir como estava
  assert.equal(b.ctx.localStorage.getItem('mr4_ultimo_vendedor'), 'ademir');
  // valor inválido gravado não quebra
  const c = ctxCesta(null); c.ctx.localStorage.setItem('mr4_ultimo_vendedor', 'zzz'); c.Cesta.iniciar(); assert.equal(c.els.vendedorSel.value, 'ademir');
  assert.match(CESTA, /\(85\) 96098-520/); assert.match(CESTA, /\(85\) 91194-961/);
});
test('envio não é automático e pedido grande copia o texto (comportamento anterior preservado)', () => {
  assert.match(CESTA, /encoded\.length > 3000/); assert.match(CESTA, /wa\.me\/\$\{v\.num\}`;?/);
  assert.match(CESTA, /btnEnviarPedido'\)\.addEventListener\('click', enviarPedido\)/);
});

/* ── componentes (HTML) ── */
test('controle de quantidade: botões reais, campo numérico acessível, rótulos, estado "No pedido", escape', () => {
  const p = mk(9, 'AB-1', 'R$ 1,00', 5, { name: 'Produto "X" <b>' });
  const h = C.htmlAcao(p, 0);
  assert.match(h, /<button type="button" class="qb" data-q="-1" aria-label="Diminuir quantidade de Produto &quot;X&quot; &lt;b&gt;">−<\/button>/);
  assert.match(h, /<input class="qi" type="text" inputmode="numeric" pattern="\[0-9\]\*" maxlength="4" autocomplete="off" value="1" aria-label="Quantidade de /);
  assert.match(h, /data-add="9"[^>]*>Adicionar<\/button>/);
  assert.doesNotMatch(h, /type="number"/); assert.doesNotMatch(h, /<b>/);
  const no = C.htmlAcao(p, 4);
  assert.match(no, /class="acao no-pedido"/); assert.match(no, /value="4"/); assert.match(no, /aria-disabled="true"/); assert.match(no, />✓ No pedido<\/button>/);
  assert.match(C.htmlAcao(p, 2, 'acao--grande'), /class="acao no-pedido acao--grande"/);
});
test('card e relacionados usam o mesmo componente; clique no controle não abre a página', () => {
  const e = C.prepararCatalogo([mk(9, 'AB-1', 'R$ 1,00', 5)])[0];
  assert.match(C.htmlCard(e, { qtd: 3 }), /class="acao no-pedido"[\s\S]*value="3"/);
  assert.match(C.htmlCard(e, { acao: false }), /card-precos/); assert.doesNotMatch(C.htmlCard(e, { acao: false }), /class="acao/);
  assert.match(CESTA, /e\.preventDefault\(\); e\.stopPropagation\(\);\s*\/\/ nunca abre a página do produto/);
  assert.match(CSS, /\.card-compra\{[^}]*position:relative;z-index:2/);                                  // controles acima do link esticado
  assert.match(PAGINA, /C\.htmlCard\(e, \{ qtd: Cesta\.qtdDe\(e\.p\.id\) \}\)/);                          // relacionados com a mesma ação
  assert.match(PAGINA, /Cesta\.delegarAcao\(rel,/);
});
test('sincronização: um só estado (carrinho) pintado em cards, relacionados, página e painel', () => {
  assert.match(APP, /Cesta\.aoMudar\(id => Cesta\.pintar\(id\)\)/);
  assert.match(PAGINA, /Cesta\.aoMudar\(id => \{ Cesta\.pintar\(id\); pintarResumo\(it\); \}\)/);
  assert.match(CESTA, /window\.addEventListener\('storage'/);                                           // outra aba/janela
  assert.match(CESTA, /function mudou\(id\) \{ desenhar\(\); avisar\(id\); \}/);
  assert.match(APP, /Cesta\.definirCatalogo\(itens\)/); assert.match(PAGINA, /Cesta\.definirCatalogo\(itens\)/);
  assert.equal((APP.match(/fetch\(/g) || []).length, 2);                                                 // produtos.json + destaques.json: um carregamento, sem refetch
  assert.equal((PAGINA.match(/fetch\(/g) || []).length, 1);
});

/* ── painel do pedido: docado × modal, barra mobile, acessibilidade ── */
test('painel: docado (≥1280px) não é modal; modal em telas menores; Esc; foco; confirmação ao limpar', () => {
  assert.match(CESTA, /min-width:1280px/);
  assert.match(CESTA, /sb\.setAttribute\('role', 'complementary'\); sb\.removeAttribute\('aria-modal'\)/);
  assert.match(CESTA, /sb\.setAttribute\('role', 'dialog'\); sb\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(CESTA, /if \(!dock\) \{|\(vendAberto \|\| \(aberto && !dock\)\)/);                          // foco preso só em modal
  assert.match(CESTA, /e\.key === 'Escape'/);
  assert.match(CESTA, /id="limparConfirma"[\s\S]*Sim, limpar/);
  assert.match(CESTA, /\$\('btnLimpar'\)\.addEventListener\('click', \(\) => \{ \$\('limparConfirma'\)\.hidden = false/);
  assert.match(CSS, /\.cart-sidebar\.dock\{top:var\(--topo\);width:var\(--dock\)/);
  assert.match(CSS, /--dock:360px/);
  assert.match(CSS, /body\.pedido-docado>\.layout[\s\S]*margin-right:var\(--dock\)/);
  assert.match(CESTA, /Total estimado: <strong id="cartTotal">/); assert.match(CESTA, /Valores e disponibilidade sujeitos à confirmação no atendimento\./);
});
test('barra do pedido no mobile: só com itens, não cobre conteúdo; some no desktop docado e na página do produto', () => {
  assert.match(CESTA, /barra\.hidden = !total/);
  assert.match(CSS, /body\.com-barra\{padding-bottom:72px\}/);
  assert.match(CSS, /@media\(min-width:1280px\)\{\.barra-pedido\{display:none!important\}/);
  assert.match(CSS, /body\.pagina-produto \.barra-pedido\{display:none!important\}/);
  assert.match(CESTA, /`Pedido · \$\{rotulo\}\$\{totTxt\}`/);
});

/* ── página do produto ── */
test('página do produto: nome → código/marca → compra; descrição fora da coluna comercial; copiar código; sem preço no HTML estático', () => {
  const e = C.prepararCatalogo([mk(9, 'AB-1', 'R$ 12,50', 5, { desc: 'Texto da descrição' })])[0];
  const est = C.htmlProdutoInfo(e);
  assert.ok(est.indexOf('produto-nome') < est.indexOf('produto-codigo') && est.indexOf('produto-codigo') < est.indexOf('id="pCompra"'));
  assert.ok(est.indexOf('id="pCompra"') < est.indexOf('produto-desc'));
  assert.match(est, /<section class="produto-desc">/);
  assert.doesNotMatch(est, /R\$ 12,50|em estoque/); assert.doesNotMatch(est, /copiar-cod/);
  const din = C.htmlProdutoInfo(e, true);
  assert.match(din, /id="pCopiarCod" aria-label="Copiar código AB-1">Copiar código/);
  assert.match(PAGINA, /Código copiado/);
  assert.doesNotMatch(C.htmlProdutoInfo(C.prepararCatalogo([mk(9, 'AB-1', 'R$ 1,00', 5)])[0]), /produto-desc/);   // sem descrição: sem bloco vazio
});
test('página do produto (mobile): barra de compra fixa = o mesmo controle; desktop em duas colunas', () => {
  assert.match(CSSP, /@media\(max-width:760px\)\{[\s\S]*\.acao--grande\{position:fixed;left:0;right:0;bottom:0/);
  assert.match(CSSP, /body\.pagina-produto\{padding-bottom:72px\}/);                                         // a barra fixa não cobre o rodapé
  assert.match(CSSP, /\.produto\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.05fr\)/);
  assert.match(CSSP, /\.produto-desc\{grid-column:1\/-1/);
  assert.match(PAGINA, /C\.htmlAcao\(p, Cesta\.qtdDe\(p\.id\), 'acao--grande'\)/);                          // carrega a quantidade que já está no pedido
  assert.match(CSSP, /\.acao--grande \.qb\{width:52px;height:52px/);
});
test('Fase B não introduz: modo compacto, pedido rápido, login, checkout, pagamento, frete, desconto', () => {
  const tudo = CESTA + PAGINA + APP + CSS + CSSP;
  assert.doesNotMatch(tudo, /modo-compacto|pedido-rapido|login|checkout|pagamento|frete|desconto|cupom/i);
});
