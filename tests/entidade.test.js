'use strict';
// Fase Entidade — dados institucionais únicos, /sobre/, /contato/, Organization, NAP, footer, sitemap, crawl estático
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../js/catalogo-core.js');
const G = require('../scripts/gerar-paginas.js');
const E = require('../scripts/entidade.js');

const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const BRUTOS = JSON.parse(ler('data/produtos.json')).produtos;
const TPL = ler('templates/produto.html'), SHELL = ler('templates/catalogo.html');
const R = G.planejar(BRUTOS, TPL, null, { shell: SHELL, estado: null, atualizado: '2026-10-03T10:00:00Z', existente: () => null });
const A = R.arquivos;
const ORI = 'https://catalogo.mr4distribuidora.com.br';
const htmls = () => Object.keys(A).filter(k => /\.html$/.test(k));
const grafo = h => JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
const tipo = (g, t) => g.find(n => n['@type'] === t);
const links = h => [...h.matchAll(/<a [^>]*href="([^"]+)"/g)].map(m => m[1]);

test('fonte única: dados oficiais confirmados pelo proprietário', () => {
  assert.equal(E.nome, 'MR4 Distribuidora'); assert.equal(E.cnpj, '38.440.066/0001-75');
  assert.equal(E.endereco.rua, 'Rua Ceará, 634'); assert.equal(E.endereco.cidade, 'Fortaleza'); assert.equal(E.endereco.uf, 'CE');
  assert.equal(E.telefone, '(85) 9119-4961'); assert.equal(E.telefoneE164, '+558591194961'); assert.equal(E.whatsappDigitos, '558591194961');
  assert.equal(E.email, 'mr4distribuidora@gmail.com');
  assert.deepEqual(E.horarios.map(h => [h.rotulo, h.abre, h.fecha]), [['Segunda a sexta', '08:30', '17:30'], ['Sábado', '08:30', '12:00']]);
  assert.equal('cep' in E.endereco || 'postalCode' in E.endereco, false);              // CEP não confirmado: não existe
});
test('endereço antigo/divergente ausente de TODAS as páginas geradas, do repositório versionado e dos geradores', () => {
  const ruim = /Rio Grande do Norte,?\s*1105|Rua Rio Grande|Democrito Rocha|Dem[óo]crito/i;
  htmls().forEach(k => assert.doesNotMatch(A[k], ruim, k));
  ['index.html', '404.html', 'templates/catalogo.html', 'templates/produto.html', 'templates/institucional.html', 'scripts/entidade.js', 'scripts/institucional.js', 'scripts/jsonld.js', 'scripts/gerar-paginas.js', 'js/catalogo-cesta.js'].forEach(f => assert.doesNotMatch(ler(f), ruim, f));
});
test('rodapé: gerado pela fonte única, compacto, com Sobre e Contato, em catálogo, categoria, marca, produto e 404', () => {
  const amostra = ['index.html', 'categoria/moldura/index.html', 'marca/tiger/index.html', Object.keys(A).find(k => /^produto\/.+\/index\.html$/.test(k)), 'sobre/index.html', 'contato/index.html'];
  amostra.forEach(k => {
    const h = A[k]; const f = h.match(/<footer>[\s\S]*?<\/footer>/)[0];
    assert.ok(f.includes('CNPJ 38.440.066/0001-75 · Rua Ceará, 634 · Fortaleza, CE'), k);
    assert.ok(f.includes('<a href="/sobre/">Sobre</a>') && f.includes('<a href="/contato/">Contato</a>'), k);
    assert.ok(f.length < 900, k);
  });
  assert.ok(ler('404.html').includes(E.rodape(true)));
  assert.equal(ler('templates/catalogo.html').includes('<footer>'), false);            // nada de rodapé duplicado manualmente nos templates
  assert.equal(ler('templates/produto.html').includes('<footer>'), false);
});
test('/sobre/ e /contato/: title único, description factual, canonical, 1 H1, Open Graph, breadcrumb, HTML semântico', () => {
  const titulos = new Set(htmls().map(k => A[k].match(/<title>([^<]*)<\/title>/)[1]));
  [['sobre/index.html', '/sobre/'], ['contato/index.html', '/contato/']].forEach(([k, u]) => {
    const h = A[k];
    assert.ok(h.includes(`<link rel="canonical" href="${ORI}${u}">`));
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
    assert.equal(h.match(/<title>([^<]*)<\/title>/)[1].length <= 70, true);
    assert.equal(htmls().filter(x => A[x].match(/<title>([^<]*)<\/title>/)[1] === h.match(/<title>([^<]*)<\/title>/)[1]).length, 1);
    const d = h.match(/<meta name="description" content="([^"]*)"/)[1]; assert.ok(d.length >= 70 && d.length <= 170);
    ['og:title', 'og:description', 'og:url', 'og:type', 'og:image', 'og:locale'].forEach(p => assert.match(h, new RegExp('property="' + p + '"')));
    assert.doesNotMatch(h, /name="robots"/);
    assert.match(h, /<main id="conteudo"/); assert.match(h, /<nav class="bc"/); assert.match(h, /<header class="topo/);
    assert.doesNotMatch(h, /<script src=/);                                            // páginas institucionais não carregam JS
  });
  assert.ok(titulos.size > 600);
});
test('/contato/: NAP + CNPJ + horário; WhatsApp institucional sem dados pessoais/pedido; vendedores não usados', () => {
  const h = A['contato/index.html'];
  ['MR4 Distribuidora', 'Rua Ceará, 634', 'Fortaleza', 'Ceará', '(85) 9119-4961', 'mr4distribuidora@gmail.com', '38.440.066/0001-75', 'Segunda a sexta: 08:30 às 17:30', 'Sábado: 08:30 às 12:00'].forEach(t => assert.ok(h.includes(t), t));
  assert.ok(links(h).includes('tel:+558591194961')); assert.ok(links(h).includes('mailto:mr4distribuidora@gmail.com'));
  const w = links(h).find(u => u.startsWith('https://wa.me/'));
  assert.ok(w.startsWith('https://wa.me/558591194961?text=')); assert.equal(w.split('?')[1].startsWith('text='), true);
  assert.equal(decodeURIComponent(w.split('text=')[1]), E.mensagemWhatsapp);
  assert.doesNotMatch(decodeURIComponent(w.split('text=')[1]), /pedido n|R\$|\d{3,}/);   // sem dados de pedido/pessoais
  assert.doesNotMatch(h, /558596098520|96098-520/);                                   // número do Ademir fora da página institucional
  assert.match(ler('js/catalogo-cesta.js'), /558596098520/); assert.match(ler('js/catalogo-cesta.js'), /558591194961/);   // fluxo de vendedores intacto
});
test('/sobre/: responde às perguntas básicas e NÃO inventa fatos', () => {
  const h = A['sobre/index.html'];
  ['O que é a MR4 Distribuidora?', 'A MR4 atende lojistas e instaladores?', 'Como acessar o catálogo?', 'Onde fica a MR4 Distribuidora?', 'Qual o horário de atendimento'].forEach(t => assert.ok(h.includes(t), t));
  [A['sobre/index.html'], A['contato/index.html']].forEach(x => assert.doesNotMatch(x.replace(/<script[\s\S]*?<\/script>/g, ''), /fundad|desde \d{4}|\d+ anos|há \d+ anos|milhares|\d+\s*clientes|líder|certific|exclusiv|melhor|maior|depoiment|avalia[çc]/i));
  assert.doesNotMatch(h, /postalCode|CEP|\b\d{5}-\d{3}\b/);
});
test('Organization: mesmo @id em todo o site; NAP/taxID/PostalAddress/horários; sem CEP, geo, sameAs, legalName', () => {
  const o = tipo(grafo(A['index.html']), 'Organization');
  assert.equal(o['@id'], ORI + '/#organization'); assert.equal(o.taxID, '38.440.066/0001-75');
  assert.deepEqual(o.address, { '@type': 'PostalAddress', streetAddress: 'Rua Ceará, 634', addressLocality: 'Fortaleza', addressRegion: 'CE', addressCountry: 'BR' });
  assert.equal(o.telephone, '+558591194961'); assert.equal(o.email, 'mr4distribuidora@gmail.com');
  assert.equal(o.contactPoint.contactType, 'customer service');
  const hs = o.location.openingHoursSpecification;
  assert.deepEqual(hs.map(x => [x.dayOfWeek, x.opens, x.closes]), [[['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], '08:30', '17:30'], [['Saturday'], '08:30', '12:00']]);
  assert.equal(o.location['@type'], 'Place'); assert.deepEqual(o.location.address, o.address);
  ['sameAs', 'geo', 'legalName', 'foundingDate'].forEach(k => { assert.equal(k in o, false, k); assert.equal(k in o.location, false, k); });
  ['sobre/index.html', 'contato/index.html'].forEach(k => assert.deepEqual(tipo(grafo(A[k]), 'Organization'), o, k));   // idêntica: sem entidade duplicada divergente
  // produto/categoria/marca não carregam outra Organization (só referência por @id no seller)
  Object.keys(A).filter(k => /^(produto|categoria|marca)\/.+\/index\.html$/.test(k)).forEach(k => assert.equal(grafo(A[k]).some(n => n['@type'] === 'Organization'), false, k));
  const seller = Object.keys(A).filter(k => /^produto\//.test(k)).map(k => A[k]).find(h => /"seller"/.test(h));
  assert.match(seller, /"seller":\{"@type":"Organization","@id":"https:\/\/catalogo\.mr4distribuidora\.com\.br\/#organization","name":"MR4 Distribuidora"\}/);
});
test('Schema das páginas: AboutPage/ContactPage + Organization (@id) + BreadcrumbList; WebSite com o mesmo @id', () => {
  [['sobre/index.html', 'AboutPage', '/sobre/'], ['contato/index.html', 'ContactPage', '/contato/']].forEach(([k, t, u]) => {
    const g = grafo(A[k]); const p = tipo(g, t), bc = tipo(g, 'BreadcrumbList');
    assert.equal(p.url, ORI + u); assert.deepEqual(p.about, { '@id': ORI + '/#organization' }); assert.deepEqual(p.isPartOf, { '@id': ORI + '/#website' });
    assert.deepEqual(p.breadcrumb, { '@id': bc['@id'] });
    assert.equal(bc.itemListElement.length, 2); assert.equal(bc.itemListElement[1].item, ORI + u);
    const ids = g.map(n => n['@id']); assert.equal(new Set(ids).size, ids.length);
    assert.equal(tipo(g, 'WebSite')['@id'], ORI + '/#website');
  });
});
test('LocalBusiness NÃO é usado (decisão: manter Organization + Place da sede); privacidade não publicada sem confirmação', () => {
  htmls().forEach(k => assert.doesNotMatch(A[k], /"@type":"(LocalBusiness|Store|AutoPartsStore|WholesaleStore)"/, k));
  assert.equal('privacidade/index.html' in A, false);
});
test('sitemap: inclui /sobre/ e /contato/; contagem = home + categorias + marcas + 2 + produtos; todas canônicas e com arquivo', () => {
  const locs = [...A['sitemap.xml'].matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(locs.includes(ORI + '/sobre/') && locs.includes(ORI + '/contato/'));
  assert.equal(locs.length, 1 + R.tax.categorias.length + R.tax.marcas.length + 2 + R.itens.length);
  assert.equal(new Set(locs).size, locs.length);
  locs.forEach(u => { const rel = u.replace(ORI, '').replace(/^\//, '') + 'index.html'; assert.ok(rel in A, rel); assert.ok(A[rel].includes(`rel="canonical" href="${u}"`), u); });
});
test('crawl estático: de /, só por <a href>, alcança /sobre/ e /contato/ (0 órfãs) e as institucionais voltam ao catálogo', () => {
  const vistos = new Set(['/']), fila = ['/'];
  while (fila.length) {
    const u = fila.pop(); const rel = u.replace(/^\//, '') + 'index.html'; const h = A[rel]; assert.ok(h, u);
    links(h).filter(l => /^\/(sobre|contato)\/$|^\/(categoria|marca|produto)\/[^?#]+\/$|^\/$/.test(l)).forEach(l => { if (!vistos.has(l)) { vistos.add(l); fila.push(l); } });
  }
  assert.ok(vistos.has('/sobre/') && vistos.has('/contato/'));
  const indexaveis = Object.keys(A).filter(k => /index\.html$/.test(k)).map(k => '/' + k.replace(/index\.html$/, ''));
  assert.deepEqual(indexaveis.filter(u => !vistos.has(u)), []);
  assert.ok(links(A['sobre/index.html']).includes('/') && links(A['sobre/index.html']).includes('/contato/'));
  assert.ok(links(A['contato/index.html']).includes('/sobre/'));
});
test('IndexNow: /sobre/ e /contato/ são páginas indexáveis detectáveis por diff (sem seed)', () => {
  const novas = G.urlsAlteradas(A, rel => (/^(sobre|contato)\//.test(rel) ? null : A[rel]));
  assert.deepEqual(novas, [ORI + '/contato/', ORI + '/sobre/']);
});
test('desempenho: institucionais sem JS e CSS próprio pequeno; catálogo e produto sem peso novo', () => {
  assert.ok(Buffer.byteLength(A['sobre/index.html']) < 9000 && Buffer.byteLength(A['contato/index.html']) < 8000);
  assert.ok(Buffer.byteLength(ler('css/institucional.css')) < 3000);
  assert.equal(ler('templates/catalogo.html').includes('institucional.css'), false);
  assert.equal(ler('templates/produto.html').includes('institucional.css'), false);
});
