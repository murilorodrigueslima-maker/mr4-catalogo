'use strict';
/**
 * Hubs de navegação (somente dados reais do catálogo; nenhum texto de marca/montadora inventado):
 *  - /marcas/ : índice de todas as marcas com página, contagem real e categorias predominantes.
 *  - /categoria/moldura/<montadora>/ : molduras cujo NOME cita explicitamente a montadora (token literal). Candidata só com ≥ MIN_PRODUTOS e ≥ MIN_MODELOS.
 * Sem JS, sem preço/estoque no HTML (mudam a cada sync): a página só lista e leva às páginas de produto.
 * Montadora NÃO é inferida de modelo (GOL sem "VW" no nome fica fora). Normalização aprovada (inequívoca): VW→Volkswagen, GM→Chevrolet.
 */
const Core = require('../js/catalogo-core.js');
const LD = require('./jsonld.js');
const E = require('./entidade.js');
const esc = Core.esc;
const ORIGEM = E.origem;
const MIN_PRODUTOS = 5, MIN_MODELOS = 3;
const GENERICAS = new Set(['diversos', 'geral', 'produtos sem grupo']);
const sa = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const cmp = (a, b) => a.localeCompare(b, 'pt-BR');

const MONTADORAS = [['HYUNDAI', 'Hyundai'], ['FIAT', 'Fiat'], ['TOYOTA', 'Toyota'], ['VW', 'Volkswagen'], ['VOLKSWAGEN', 'Volkswagen'], ['GM', 'Chevrolet'], ['CHEVROLET', 'Chevrolet'],
  ['HONDA', 'Honda'], ['RENAULT', 'Renault'], ['FORD', 'Ford'], ['NISSAN', 'Nissan'], ['PEUGEOT', 'Peugeot'], ['CITROEN', 'Citroën'], ['SUZUKI', 'Suzuki'], ['MITSUBISHI', 'Mitsubishi'], ['JEEP', 'Jeep']];
const MONT_RE = new RegExp('\\b(' + MONTADORAS.map(m => m[0]).join('|') + ')\\b', 'g');
const STOP = /\b(MOLDURA|MOLD|PLASTICA|POLEGADAS?|COMPATIVEL|COM|COMFIAT|I-PANEL|PANEL|DE|PARA|P|9P|ADAPTADORA|FLUTUANTE|CHINES|JAPONES|CHI|JAP|DIN|2DIN|1DIN|E|MD|UV|PROTECTION|BOTAO|AIRBAG|DUPLO|PRETO|PRETA|FOSCO|GRAFITE|PRATA|CINZA|BRILHANTE|BLACK|PIANO|BLK|CZB|DETALHE|DETALHES|SEM|RADIO|ACABAMENTO|FRISO|EM|DIANTE|AR|ANALOGICO|DIGITAL|A\/C|MODELO|RELOGIO|GAVETA|ABERTURA|PARTE|ESCRITA|SINCE|UMA|AUXILIAR|ADESIVO)\b/g;

/** montadoras citadas LITERALMENTE no nome (token inteiro) */
function montadorasDoNome(nome) {
  const toks = sa(nome).replace(/[()]/g, ' ').split(/[\s,\/]+/).filter(Boolean);
  return [...new Set(MONTADORAS.filter(([k]) => toks.includes(k)).map(([, v]) => v))];
}
/** nº estimado de modelos distintos no nome (só para decidir se o hub é diverso; NUNCA exibido) */
function modelosEstimados(nome) {
  const n = sa(nome).replace(/[()]/g, ' ');
  const corpo = n.replace(/^(MOLDURA|MOLD\.?|I-PANEL|ADAPTADOR[A]?)\s+/, '').split(/ - | -(?=[A-Z])/)[0]
    .replace(/\b(19|20)\d{2}(\/(19|20)\d{2})?\b|\b\d{2}\/\d{2}\b|\b\d{1,2}(\.\d)?\b|\+/g, ' ').replace(MONT_RE, ' ');
  return [...new Set(corpo.split(/[,\/]+/).map(c => c.replace(STOP, ' ').replace(/\s+/g, ' ').trim()).filter(c => c.length > 1))];
}
const ehMoldura = it => it.catChave === 'Moldura';

/** hubs de montadora (candidatos): [{ montadora, slug, url, itens, modelos }] — ordenados por nº de produtos (desc) e nome */
function hubsMoldura(itens) {
  const mold = itens.filter(ehMoldura);
  if (!mold.length) return [];
  const base = mold[0].catUrl;                                   // ex.: /categoria/moldura/
  const por = {};
  mold.forEach(it => montadorasDoNome(it.p.name).forEach(m => { (por[m] = por[m] || []).push(it); }));
  return Object.keys(por).map(m => {
    const lista = por[m].slice().sort((a, b) => cmp(a.p.name, b.p.name) || cmp(String(a.p.ref), String(b.p.ref)));
    const modelos = new Set(); lista.forEach(it => modelosEstimados(it.p.name).forEach(x => modelos.add(x)));
    return { montadora: m, slug: Core.slugify(m), url: base + Core.slugify(m) + '/', base, itens: lista, modelos: modelos.size };
  }).filter(h => h.itens.length >= MIN_PRODUTOS && h.modelos >= MIN_MODELOS).sort((a, b) => b.itens.length - a.itens.length || cmp(a.montadora, b.montadora));
}

const bc = (passos) => `<nav class="bc" aria-label="Você está em">${passos.map((p, i) => i === passos.length - 1 ? `<span aria-current="page">${esc(p.nome)}</span>` : `<a href="${esc(p.url)}">${esc(p.nome)}</a>`).join(' › ')}</nav>`;
const plural = (n, um, varios) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`;
const topCats = it => {
  const c = {}; it.forEach(e => { if (e.catRotulo && !GENERICAS.has(Core.norm(e.catChave))) c[e.catRotulo] = (c[e.catRotulo] || 0) + 1; });
  return Object.keys(c).sort((a, b) => c[b] - c[a] || cmp(a, b)).slice(0, 3);
};
const montar = (modelo, head, o, conteudo) => modelo
  .replace('{{HEAD}}', () => head({ title: o.title, description: o.description, canonical: o.url, noindex: o.noindex, jsonld: o.jsonld }))
  .replace('{{CONTEUDO}}', () => conteudo)
  .replace('{{RODAPE}}', () => E.rodape(false));

/** /marcas/ */
function marcasOrdenadas(tax) { return tax.marcas.slice().sort((a, b) => b.itens.length - a.itens.length || cmp(a.rotulo, b.rotulo)); }
function paginaMarcas(modelo, head, tax) {
  const url = ORIGEM + '/marcas/', lista = marcasOrdenadas(tax), n = lista.length;
  const total = lista.reduce((s, m) => s + m.itens.length, 0);
  const title = 'Marcas do catálogo B2B | MR4 Distribuidora';
  const description = `${plural(n, 'marca listada', 'marcas listadas')} no catálogo B2B da MR4 Distribuidora, com a quantidade de produtos de cada uma. Escolha a marca e veja códigos, preço e estoque.`;
  const passos = [{ nome: 'Catálogo', url: '/' }, { nome: 'Marcas', url: '/marcas/' }];
  const itens = lista.map(m => `<li><a href="${esc(m.url)}">${esc(m.rotulo)}</a> <span class="hub-n">${plural(m.itens.length, 'produto', 'produtos')}</span>${topCats(m.itens).length ? `<span class="hub-cats">${esc(topCats(m.itens).join(' · '))}</span>` : ''}</li>`).join('\n');
  const conteudo = `${bc(passos)}
<h1>Marcas do catálogo</h1>
<p>Este índice reúne as ${plural(n, 'marca', 'marcas')} com produtos listados no catálogo B2B da MR4 Distribuidora (${total.toLocaleString('pt-BR')} produtos com marca informada). A ordem é pela quantidade de produtos, depois pelo nome. Produtos sem marca informada no cadastro não aparecem aqui; veja todos no <a href="/">catálogo</a>.</p>
<ul class="hub-lista">
${itens}
</ul>`;
  const jsonld = LD.tag(LD.grafoLista(url, 'Marcas do catálogo', description, lista.map(m => ({ url: ORIGEM + m.url, nome: m.rotulo })), [{ nome: 'Catálogo', url: ORIGEM + '/' }, { nome: 'Marcas', url }]));
  return montar(modelo, head, { title, description, url, jsonld }, conteudo);
}

/** hub de montadora (molduras). `vazio` = página que existiu e deixou de ser candidata: noindex (nunca apagada) */
function paginaHubMoldura(modelo, head, hub, outros, noindex) {
  const url = ORIGEM + hub.url, m = hub.montadora, n = hub.itens.length;
  const marcas = [...new Set(hub.itens.map(i => i.marca).filter(Boolean))].sort(cmp);
  const title = `Molduras para ${m} no catálogo B2B | MR4 Distribuidora`;
  const description = `Molduras para ${m}: ${plural(n, 'produto listado', 'produtos listados')} no catálogo B2B da MR4 Distribuidora. Veja os nomes, códigos e anos informados nos cadastros.`;
  const passos = [{ nome: 'Catálogo', url: '/' }, { nome: 'Moldura', url: hub.base }, { nome: m, url: hub.url }];
  const lista = hub.itens.map(e => `<li><a href="${esc(e.url)}">${esc(e.p.name)}</a> <span class="rel-cod">Cód. ${esc(e.p.ref)}${e.marca ? ' · ' + esc(e.marca) : ''}</span></li>`).join('\n');
  const outras = outros.filter(o => o.url !== hub.url);
  const conteudo = `${bc(passos)}
<h1>Molduras para ${esc(m)}</h1>
<p>Esta página reúne ${plural(n, 'moldura', 'molduras')} do catálogo B2B da MR4 Distribuidora cujo cadastro cita a montadora ${esc(m)}${marcas.length ? `, nas marcas ${esc(Core.listaPt(marcas))}` : ''}. Abra o produto para ver preço e estoque atuais.</p>
<ul class="hub-lista hub-prod">
${lista}
</ul>
<p class="hub-nota">Molduras cujo cadastro não informa a montadora não aparecem nesta lista; veja todas em <a href="${esc(hub.base)}">Molduras</a>.</p>
${outras.length ? `<p class="hub-outras"><strong>Outras montadoras:</strong> ${outras.map(o => `<a href="${esc(o.url)}">${esc(o.montadora)}</a>`).join(' · ')}</p>` : ''}`;
  const jsonld = LD.tag(LD.grafoLista(url, `Molduras para ${m}`, description, hub.itens.map(e => ({ url: ORIGEM + e.url, nome: e.p.name })), passos.map(p => ({ nome: p.nome, url: ORIGEM + p.url }))));
  return montar(modelo, head, { title, description, url, jsonld, noindex }, conteudo);
}
/** links "por montadora" para a categoria Moldura (HTML inserido no contexto da página da categoria) */
function navMontadoras(hubs) {
  return hubs.length ? `<nav aria-label="Molduras por montadora"><strong>Molduras por montadora:</strong> ${hubs.map(h => `<a href="${esc(h.url)}">${esc(h.montadora)}</a>`).join(' · ')}</nav>` : '';
}
module.exports = { ehMoldura, MIN_PRODUTOS, MIN_MODELOS, montadorasDoNome, modelosEstimados, hubsMoldura, paginaMarcas, paginaHubMoldura, navMontadoras, marcasOrdenadas };
