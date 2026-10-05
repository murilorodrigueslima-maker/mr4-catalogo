'use strict';
// Guard de números das descrições: número no ERP passa; fora do ERP só com fonte oficial rastreável do SKU exato; resto reprova.
const test = require('node:test');
const assert = require('node:assert/strict');
const GN = require('../scripts/guard-numeros.js');

const erp = { name: 'MULTIMIDIA CARPLAY 9', brand: '', ref: 'KRC3200' };
const fonte = (o) => Object.assign({
  url: 'https://kx3.com.br/produto/multimidia-mp5-carplay-android-auto-9-krc3200/',
  skuTrecho: 'Multimídia MP5 Carplay & Android Auto 9" – KRC3200',
  trechos: ['Tela de 9” de vidro 1280x800p', 'FM com 18 memórias']
}, o || {});
const v = (desc, extra) => GN.verificarNumeros(Object.assign({ desc, erp, marca: 'KX3', fonte: fonte() }, extra || {}));
const D = 'Multimídia KX3 KRC3200 de 9 polegadas com tela de 1280x800 e FM com 18 memórias.';

test('guard: número presente no ERP → PASS (sem precisar de fonte)', () => {
  const r = GN.verificarNumeros({ desc: 'Multimídia KX3 KRC3200 de 9 polegadas com Carplay e Android Auto.', erp, marca: 'KX3' });
  assert.deepEqual([r.ok, r.externos], [true, []]);
});
test('guard: número ausente no ERP, presente literalmente na fonte oficial do SKU → PASS', () => {
  const r = v(D); assert.equal(r.ok, true, r.problemas.join('|')); assert.deepEqual(r.externos.sort(), ['1280', '18', '800']);
});
test('guard: número sem evidência → FAIL', () => {
  assert.equal(GN.verificarNumeros({ desc: D, erp, marca: 'KX3' }).ok, false);                        // sem fonteNumeros
  const r = v(D.replace('18 memórias', '24 memórias')); assert.equal(r.ok, false); assert.match(r.problemas.join('|'), /"24" não está literalmente/);
});
test('guard: fonte de produto/SKU diferente ou domínio não oficial → FAIL', () => {
  assert.match(v(D, { fonte: fonte({ skuTrecho: 'Multimídia MP5 Carplay 7" – KRC3100' }) }).problemas.join('|'), /código exato/);
  assert.match(v(D, { fonte: fonte({ url: 'https://loja-qualquer.com.br/krc3200' }) }).problemas.join('|'), /domínio oficial/);
  assert.match(v(D, { fonte: fonte({ url: 'http://kx3.com.br/x' }) }).problemas.join('|'), /domínio oficial/);
  assert.match(v(D, { marca: 'Permak' }).problemas.join('|'), /domínio oficial/);                       // domínio de outra marca
  assert.match(v(D, { fonte: fonte({ url: 'https://kx3.com.br.evil.com/x' }) }).problemas.join('|'), /domínio oficial/);
});
test('guard: SKU contido em outro código não vale (KRC3200 ≠ KRC32001)', () => {
  assert.match(v(D, { fonte: fonte({ skuTrecho: 'Multimídia KRC32001' }) }).problemas.join('|'), /código exato/);
});
test('guard: conflito com o ERP (mesma unidade, valor diferente) → FAIL; ERP tem precedência', () => {
  const e2 = { name: 'SUBWOOFER 8\'\' UPGRADE 400 WATTS RMS 4 OHMS', brand: '', ref: '1.04.154' };
  const f2 = { url: 'https://www.bomber.com.br/produto/x/', skuTrecho: 'Código 1.04.154', trechos: ['Potência (RMS) 500 W RMS', 'Diâmetro da bobina 46,3 mm'] };
  const r = GN.verificarNumeros({ desc: 'Subwoofer Bomber de 8 polegadas, 500 W RMS, 4 ohms e bobina de 46,3 mm.', erp: e2, marca: 'Bomber', fonte: f2 });
  assert.equal(r.ok, false); assert.match(r.problemas.join('|'), /CONFLITO com ERP: 500 w × ERP 400 w/);
  const ok = GN.verificarNumeros({ desc: 'Subwoofer Bomber de 8 polegadas, 400 W RMS, 4 ohms e bobina de 46,3 mm.', erp: e2, marca: 'Bomber', fonte: f2 });
  assert.equal(ok.ok, true, ok.problemas.join('|'));
});
test('guard: quantidade de embalagem/conteúdo inferida ou vinda de lista de embalagem → FAIL', () => {
  const f = fonte({ trechos: ['Tela de 9” de vidro 1280x800p', 'FM com 18 memórias', '4 cápsulas'] });
  assert.match(v(D + ' Acompanha 4 cápsulas.', { fonte: f }).problemas.join('|'), /embalagem\/conteúdo/);
  assert.match(v(D + ' Vendido em 4 unidades.', { fonte: f }).problemas.join('|'), /embalagem\/conteúdo/);
  assert.match(v(D, { fonte: fonte({ trechos: ['Conteúdo da Embalagem: 1 Cabo 6M', 'FM com 18 memórias', 'Tela 1280x800p'] }) }).problemas.join('|'), /embalagem/);
});
test('guard: preço, promoção, garantia, condição de venda → FAIL', () => {
  ['com 12 meses de garantia', 'por R$ 10 de entrada', 'em promoção', 'com 10% off', 'com frete grátis'].forEach(t =>
    assert.equal(v(D + ' ' + t).ok, false, t));
  assert.match(v(D, { fonte: fonte({ trechos: ['Tela 1280x800p', 'FM com 18 memórias', 'Garantia de 12 meses'] }) }).problemas.join('|'), /garantia/);
});
test('guard: não é bypass genérico — lista fechada de domínios oficiais e fonteNumeros mal formada reprova', () => {
  assert.deepEqual(Object.keys(GN.OFICIAIS).sort(), ['ASX', 'Bomber', 'KX3', 'Permak', 'Tragial']);
  [null, undefined, 'x', {}, { url: 'https://kx3.com.br/x' }, { url: 'https://kx3.com.br/x', skuTrecho: 'KRC3200', trechos: [] }].forEach(f =>
    assert.equal(GN.verificarNumeros({ desc: D, erp, marca: 'KX3', fonte: f }).ok, false));
});
