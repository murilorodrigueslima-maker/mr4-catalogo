'use strict';
// node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../js/catalogo-core.js');
const DADOS = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/produtos.json'), 'utf8'));
const BRUTOS = DADOS.produtos;
const ITENS = C.prepararCatalogo(BRUTOS);

/* ── referência INDEPENDENTE da busca (outra implementação, outra normalização) ── */
const refNorm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
  .replace(/['’‘`´"]/g, '').split(/[^a-z0-9]+/).filter(Boolean).join(' ');
function refBusca(q, filtros = {}) {
  const stop = new Set(['de', 'da', 'do', 'das', 'dos', 'para', 'com', 'e', 'a', 'o', 'em', 'p']);
  let t = refNorm(q).split(' ').filter(Boolean);
  const u = t.filter(x => !stop.has(x)); if (u.length) t = u;
  return BRUTOS.filter(p => {
    const sem = refNorm(p.category) === 'produtos sem grupo';
    if (filtros.cat && p.category.trim() !== filtros.cat) return false;
    if (filtros.marca && C.marcaNormalizada(p.brand) !== filtros.marca) return false;
    const hay = [refNorm(p.name), refNorm(p.ref), refNorm(p.ref).replace(/ /g, ''), sem ? '' : refNorm(p.category), refNorm(C.marcaNormalizada(p.brand))].join(' ');
    return t.every(x => hay.includes(x) || (x.length > 3 && x.endsWith('s') && hay.includes(x.slice(0, -1))));
  }).map(p => String(p.id)).sort();
}
const ids = r => r.lista.map(e => String(e.p.id)).sort();
const consultar = (q, extra = {}) => C.consultar(ITENS, Object.assign({ q }, extra));

/* ── normalização ── */
test('norm: caixa, acento, espaços, hífen, pontuação', () => {
  assert.equal(C.norm('LÂMPADA H4'), 'lampada h4');
  assert.equal(C.norm('  Alto-Falante   6"  '), 'alto falante 6');
  assert.equal(C.norm('Led’s interno/externo'), 'leds interno externo');
  assert.equal(C.norm('Câmera, de ré.'), 'camera de re');
  assert.equal(C.norm(null), '');
});
test('norm só serve para comparação: nome exibido não muda', () => {
  const it = C.prepararCatalogo([{ id: '1', ref: 'A-1', name: 'LÂMPADA  H4 ', category: ' Lâmpada de led ', brand: 'Tiger', price: 'R$ 1,00', stock: 1, img: '', desc: '' }])[0];
  assert.equal(it.p.name, 'LÂMPADA H4');          // só trim/espaços duplicados
  assert.equal(it.n, 'lampada h4');
});

/* ── bateria obrigatória ── */
const OBRIGATORIAS = ['lampada', 'lâmpada', 'camera', 'câmera', 'alto falante', 'alto-falante', 'led h4', 'h4 led', 'tiger', 'permak', 'ldcar'];
for (const q of OBRIGATORIAS) {
  test(`busca "${q}" = golden independente`, () => {
    const got = ids(consultar(q)), exp = refBusca(q);
    assert.ok(exp.length > 0, 'golden não pode ser vazio para este termo');
    assert.deepEqual(got, exp);
  });
}
test('lampada ≡ lâmpada ≡ LÂMPADA; led h4 ≡ h4 led; alto falante ≡ alto-falante', () => {
  assert.deepEqual(ids(consultar('lampada')), ids(consultar('LÂMPADA')));
  assert.deepEqual(ids(consultar('led h4')), ids(consultar('h4 led')));
  assert.deepEqual(ids(consultar('alto falante')), ids(consultar('alto-falante')));
  assert.deepEqual(ids(consultar('camera')), ids(consultar('CÂMERA')));
});
test('antes da correção os termos acima retornavam 0 ou muito pouco; agora retornam o esperado', () => {
  const antigo = q => BRUTOS.filter(p => p.name.toLowerCase().includes(q.trim().toLowerCase()) || (p.ref || '').toLowerCase().includes(q.trim().toLowerCase())).length;
  assert.equal(antigo('lâmpada'), 0); assert.ok(consultar('lâmpada').total > 50);
  assert.equal(antigo('câmera'), 0); assert.ok(consultar('câmera').total >= 6);
  assert.equal(antigo('alto-falante'), 0); assert.ok(consultar('alto-falante').total >= 20);
  assert.ok(consultar('tiger').total > antigo('tiger'));
});
test('código exato, parcial, caixa e espaços múltiplos', () => {
  const alvo = BRUTOS.find(p => p.ref === 'LD0002');
  assert.ok(alvo);
  for (const q of ['LD0002', 'ld0002', '  ld0002  ']) {
    const r = consultar(q);
    assert.equal(String(r.lista[0].p.id), String(alvo.id), 'código exato vem primeiro: ' + q);
  }
  assert.ok(ids(consultar('LD00')).includes(String(alvo.id)), 'código parcial');
  assert.deepEqual(ids(consultar('led    h4')), ids(consultar('led h4')));
  const comPontuacao = BRUTOS.find(p => /\(/.test(p.ref));
  if (comPontuacao) assert.ok(ids(consultar(comPontuacao.ref)).includes(String(comPontuacao.id)));
});
test('termo inexistente → 0; tolerância não inventa resultado absurdo', () => {
  assert.equal(consultar('zzzzqqqq').total, 0);
  assert.equal(consultar('xyzxyz123').total, 0);
  assert.equal(consultar('banana').total, 0);
});
test('erro simples de digitação: lampda → lâmpadas; resultado sinalizado', () => {
  const r = consultar('lampda');
  assert.equal(r.corrigido, 'lampada');
  assert.deepEqual(ids(r), refBusca('lampada'));
  assert.equal(consultar('lampada').corrigido, null);              // sem erro, sem correção
  assert.equal(C.osa('lampda', 'lampada', 1), 1);
  assert.equal(C.osa('tigre', 'tiger', 1), 1);
  assert.ok(C.osa('banana', 'bateria', 1) > 1);
});
test('busca + categoria, + marca, + ordenação (golden independente)', () => {
  const cat = 'Lâmpadas Halógenas';
  assert.deepEqual(ids(consultar('h4', { cat })), refBusca('h4', { cat }));
  assert.ok(consultar('h4', { cat }).total > 0);
  assert.deepEqual(ids(consultar('h7', { marca: 'Tiger' })), refBusca('h7', { marca: 'Tiger' }));
  assert.deepEqual(ids(consultar('lampada', { cat, marca: 'Tiger' })), refBusca('lampada', { cat, marca: 'Tiger' }));
  // ordenação preserva o conjunto e ordena de verdade
  const base = ids(consultar('led'));
  for (const sort of ['az', 'za', 'menor-preco', 'maior-preco', 'maior-estoque', 'destaque', 'padrao']) {
    assert.deepEqual(ids(consultar('led', { sort })), base, sort);
  }
  const preco = consultar('led', { sort: 'menor-preco' }).lista.map(e => C.precoNumerico(e.p));
  assert.deepEqual(preco, preco.slice().sort((a, b) => a - b));
  const est = consultar('led', { sort: 'maior-estoque' }).lista.map(e => e.p.stock);
  assert.deepEqual(est, est.slice().sort((a, b) => b - a));
  const az = consultar('led', { sort: 'az' }).lista.map(e => e.p.name);
  assert.deepEqual(az, az.slice().sort((a, b) => a.localeCompare(b, 'pt-BR')));
});
test('sem busca: ordem padrão = ordem do JSON; filtros por categoria e marca batem com os dados', () => {
  const r = consultar('');
  assert.equal(r.total, BRUTOS.length);
  assert.deepEqual(r.lista.map(e => e.p.id), BRUTOS.map(p => p.id));
  const cat = 'Moldura';
  assert.equal(consultar('', { cat }).total, BRUTOS.filter(p => p.category.trim() === cat).length);
  assert.equal(consultar('', { marca: 'Tiger' }).total, BRUTOS.filter(p => C.marcaNormalizada(p.brand) === 'Tiger').length);
});
test('destaques primeiro mantém ordem relativa', () => {
  const d = new Set([String(BRUTOS[10].id), String(BRUTOS[5].id)]);
  const r = C.consultar(ITENS, { q: '', sort: 'destaque' }, d);
  assert.deepEqual(r.lista.slice(0, 2).map(e => String(e.p.id)), [String(BRUTOS[5].id), String(BRUTOS[10].id)]);
  assert.equal(r.total, BRUTOS.length);
});

/* ── ranking ── */
const fx = (lista) => C.prepararCatalogo(lista.map((x, i) => Object.assign({ id: String(i + 1), ref: 'R' + i, name: 'X', category: 'Geral', brand: '', price: 'R$ 1,00', stock: 1, img: '', desc: '' }, x)));
test('ranking: código exato > nome exato > começa com > todos no nome > marca > categoria > demais', () => {
  const it = fx([
    { id: 'cat', name: 'Produto qualquer', category: 'Sensor estacionamento', ref: 'Q1' },
    { id: 'marca', name: 'Estacionamento universal', brand: 'Sensor', category: 'Geral', ref: 'Q2' },
    { id: 'todos', name: 'Kit com sensor de estacionamento universal', ref: 'Q3' },
    { id: 'comeca', name: 'Sensor estacionamento 4 pontos', ref: 'Q4' },
    { id: 'exato', name: 'sensor estacionamento', ref: 'Q5' },
    { id: 'codigo', name: 'Outro produto', ref: 'sensor-estacionamento' }
  ]);
  const r = C.buscar(it, 'sensor estacionamento').itens.map(e => e.p.id);
  assert.deepEqual(r, ['codigo', 'exato', 'comeca', 'todos', 'marca', 'cat']);
});
test('ranking: marca antes de categoria e empate pela ordem original', () => {
  const it = fx([
    { id: 'c1', name: 'Alpha', category: 'Palheta', ref: 'A1' },
    { id: 'b1', name: 'Alpha', brand: 'Palheta', category: 'Geral', ref: 'A2' },
    { id: 'c2', name: 'Beta', category: 'Palheta', ref: 'A3' }
  ]);
  assert.deepEqual(C.buscar(it, 'palheta').itens.map(e => e.p.id), ['b1', 'c1', 'c2']);
});
test('ranking determinístico: duas execuções idênticas', () => {
  assert.deepEqual(consultar('led h4').lista.map(e => e.p.id), consultar('led h4').lista.map(e => e.p.id));
});
test('SEM GRUPO não entra na busca por texto de categoria', () => {
  assert.equal(consultar('grupo').lista.filter(e => e.semGrupo && !/grupo/i.test(e.p.name + e.p.ref)).length, 0);
});

/* ── higiene de descrição (exemplos SINTÉTICOS no formato do resíduo fiscal) ── */
test('sanitização remove resíduo fiscal e mantém conteúdo comercial', () => {
  const S = C.limparDescricao;
  assert.equal(S('CEST: 99.999.00 BC ICMS retido R$ 10,00 Vl ICMS retido R$ 1,00 Imp Ret ST-Prot ICMS 01/01'), '');
  assert.equal(S('Trib aprox R$ 1,00 Fed, R$ 2,00 Est e R$ 0,00 Mun Fonte: IBPT/empresometro.com.br - 9Z9999'), '');
  assert.equal(S('IVA: 40% pICMS ST: 20% BC ICMS ST: 11,11 VR ICMS ST: 2,22'), '');
  assert.equal(S('(N/I/1111-N///1/2222-2) Base ST: R$ 11, 11  Valor ST: R$ 2, 22'), '');
  assert.equal(S('ST: R$ 3, 33'), '');
  assert.equal(S('Trib aprox R$ 2,41 Federal Fonte: IBPT/x.com - 1A1A1; CEST: 12.007.00'), '');
  const misto = 'Lâmpada super branca 6000K. Voltagem: 12 volts.\nAplicações: farol.\nCEST: 01.071.00';
  assert.equal(S(misto), 'Lâmpada super branca 6000K. Voltagem: 12 volts.\nAplicações: farol.');
  const legit = 'Especificação:\nCor: Super branca 6000K (Alto Brilho).\nQuantidade de LED: 8 Leds.\nGarantia de 90 dias. Lote de 10 unidades.';
  assert.equal(S(legit), legit);                         // nada de fiscal → intacta byte a byte
  assert.equal(S(''), ''); assert.equal(S(null), '');
});
test('sanitização de nome: só resíduo fiscal e espaços; caixa e códigos preservados', () => {
  assert.equal(C.limparNome('  TELA LED 5V - Lote-Validade-Qtd:(N/I/1-N///1/1-1) Base ST: R$ 1,00  Valor'), 'TELA LED 5V');
  assert.equal(C.limparNome('TELA LED 5V - Lote-Validade-Qtd:(N/I/1-N///1/1-1) Base ST: R$ 1,00  Val'), 'TELA LED 5V');
  assert.equal(C.limparNome('  LÂMPADA   H4 12V/55W '), 'LÂMPADA H4 12V/55W');
  assert.equal(C.limparNome('Kit Lote de 5 unidades'), 'Kit Lote de 5 unidades');
});
test('dados reais: 0 resíduos fiscais após sanitizar; descrições legítimas inalteradas', () => {
  const marcador = /CEST|ICMS|Trib\.? aprox|Base ST|Imp Ret|Lote-Val|\bST:\s*R\$/i;
  assert.equal(ITENS.filter(e => marcador.test(e.p.name + ' ' + e.p.desc)).length, 0);
  BRUTOS.forEach((p, i) => { if (p.desc && !marcador.test(p.desc)) assert.equal(ITENS[i].p.desc, p.desc); });
  BRUTOS.forEach((p, i) => { if (!marcador.test(p.name)) assert.equal(ITENS[i].p.name, p.name.replace(/\s+/g, ' ').trim()); });
  assert.equal(ITENS.length, BRUTOS.length);
});

/* ── marcas ── */
test('mapa de marcas: transformações auditáveis e nenhuma variante de caixa sem tratar', () => {
  assert.deepEqual(C.marcasNaoUnificadas(BRUTOS), []);
  assert.equal(C.marcaNormalizada('FIAMON'.toLowerCase()), 'Fiamon');
  assert.equal(C.marcaNormalizada('fiamon'), 'Fiamon');
  assert.equal(C.marcaNormalizada('TIGER AUTO'), 'Tiger');
  assert.equal(C.marcaNormalizada('FITTO/JPKER'), 'Fitto/Joker');
  assert.equal(C.marcaNormalizada('Alermar'), 'Alemar');
  assert.equal(C.marcaNormalizada('Soquete'), '');
  assert.equal(C.marcaNormalizada('MOLDURA'), '');
  assert.equal(C.marcaNormalizada('  '), '');
  // dúvida → não une
  assert.equal(C.marcaNormalizada('FITTO'), 'FITTO');
  assert.equal(C.marcaNormalizada('Joker'), 'Joker');
  assert.equal(C.marcaNormalizada('Faimon'), 'Faimon');
  assert.equal(C.marcaNormalizada('MarcaNova'), 'MarcaNova');
  const rel = C.relatorioMarcas(BRUTOS);
  assert.ok(rel.length >= 10);
  rel.forEach(r => assert.notEqual(r.de, r.para));
});
test('marcas: dado original do produto não é alterado; só a derivada', () => {
  const copia = JSON.stringify(BRUTOS);
  C.prepararCatalogo(BRUTOS);
  assert.equal(JSON.stringify(BRUTOS), copia);
});

/* ── categorias ── */
test('categorias: ordem MR4, SEM GRUPO separado, nenhuma perdida', () => {
  const todas = [...new Set(BRUTOS.map(p => p.category.trim()))];
  const o = C.ordenarCategorias(todas);
  assert.equal(o.comerciais.length + o.semGrupo.length, todas.length);
  assert.ok(!o.comerciais.some(c => C.ehSemGrupo(c)));
  assert.deepEqual(o.semGrupo, todas.filter(c => C.ehSemGrupo(c)));
  assert.equal(C.rotuloCategoria('PRODUTOS SEM GRUPO'), 'Sem categoria');
  assert.equal(C.rotuloCategoria(' Moldura '), 'Moldura');
  assert.equal(o.comerciais[0], 'Led\u2019s interno/externo');
  // produtos sem grupo continuam localizáveis por nome e pelo filtro
  const sg = ITENS.filter(e => e.semGrupo);
  assert.ok(sg.length > 0);
  assert.equal(consultar('', { cat: o.semGrupo[0] }).total, sg.length);
  assert.ok(ids(consultar(sg[0].p.name)).includes(String(sg[0].p.id)));
});

/* ── WhatsApp por produto ── */
test('mensagem de interesse: nome, código, quantidade opcional, origem; sem preço/estoque', () => {
  const p = { name: 'LÂMPADA H4', ref: 'H4-1', price: 'R$ 9,99', stock: 77 };
  const m = C.mensagemWhatsProduto(p, 0);
  assert.match(m, /LÂMPADA H4/); assert.match(m, /Ref: H4-1/); assert.match(m, /catálogo/);
  assert.doesNotMatch(m, /Quantidade/); assert.doesNotMatch(m, /9,99|77/);
  assert.match(C.mensagemWhatsProduto(p, 3), /Quantidade desejada: 3/);
});

/* ── regressão do catálogo atual ── */
test('regressão: contagens, campos e imutabilidade de preço/estoque', () => {
  assert.equal(BRUTOS.length, DADOS.total);
  assert.ok(BRUTOS.length >= 500);
  ITENS.forEach((e, i) => {
    assert.equal(e.p.price, BRUTOS[i].price); assert.equal(e.p.stock, BRUTOS[i].stock);
    assert.equal(e.p.img, BRUTOS[i].img); assert.equal(e.p.id, BRUTOS[i].id); assert.equal(e.p.ref, BRUTOS[i].ref);
  });
  assert.equal(new Set(BRUTOS.map(p => p.category.trim())).size >= 20, true);
});
test('o sync usa o mesmo núcleo de higiene', () => {
  const s = fs.readFileSync(path.join(__dirname, '../scripts/sync-produtos.js'), 'utf8');
  assert.match(s, /require\('\.\.\/js\/catalogo-core\.js'\)/);
  assert.match(s, /Core\.limparDescricao/); assert.match(s, /Core\.limparNome/);
});
