#!/usr/bin/env node
/**
 * Gera as páginas estáticas de produto: produto/<slug-nome>--<slug-codigo>/index.html
 *
 * - Determinístico: sem datas/aleatoriedade; mesma entrada → mesmos bytes.
 * - Só escreve arquivos cujo conteúdo mudou (nada de tocar em centenas de arquivos a cada sync).
 * - O HTML estático traz só dados estáveis (nome, código, marca, categoria, foto, descrição) + Open Graph.
 *   Preço e estoque NÃO entram no HTML: mudam a cada sync e vêm do data/produtos.json no navegador.
 * - Nunca apaga páginas (produto sem estoque some do JSON e volta depois; o link antigo continua abrindo
 *   e mostra "não disponível no momento"). Se o nome mudar (slug novo), a página antiga vira um redirecionamento.
 * - produto/manifest.json guarda código→pasta (para detectar renomeações).
 *
 * SEO Fase 1 (quando chamado com `opts` — ver planejar): além dos produtos gera, de forma determinística,
 *   index.html (home) e categoria/<slug>/ e marca/<slug>/ a partir de templates/catalogo.html (UM shell só),
 *   robots.txt, sitemap.xml e data/seo-estado.json (lastmod por hash de conteúdo; ausência de produtos).
 *   - lastmod: a data (do campo `atualizado` do produtos.json, nunca o relógio) em que o HTML da URL mudou de fato;
 *     URL sem histórico → sem lastmod (melhor omitir do que inventar).
 *   - produto que SAIU do feed: aviso estático "indisponível" + fora do sitemap; após CARENCIA_DIAS (tempo do feed)
 *     contínuos ausente → noindex,follow. Estoque oscila (o feed só traz estoque > 0; 602–626 itens em setembro),
 *     por isso a carência. Feed doente (queda > 15 %) → nada é regenerado (falha de sync ≠ produto removido).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Core = require('../js/catalogo-core.js');
const LD = require('./jsonld.js');

const ORIGEM = 'https://catalogo.mr4distribuidora.com.br';
const LOGO = '/assets/logo-header.png';


const crypto = require('crypto');
const CARENCIA_DIAS = 7;            // ausência contínua no feed antes de noindex (tempo do feed, não do relógio)
const LIMITE_SAUDE = 0.85;          // feed com menos de 85 % dos itens da última rodada saudável = suspeito
const NOME_HOME = 'Catálogo B2B de acessórios automotivos';
const H1_HOME = 'MR4 Distribuidora — Catálogo B2B';   // H1 da home = logo do topo (alt); a barra de resultados não ganha largura
const TITLE_HOME = NOME_HOME + ' | MR4 Distribuidora';
const DESC_HOME = 'Catálogo B2B da MR4 Distribuidora (Fortaleza, CE): acessórios automotivos no atacado para lojistas e instaladores — iluminação LED, molduras, alarmes, multimídia e mais. Atendemos CE, PI e RN.';
const hash12 = t => crypto.createHash('sha1').update(String(t)).digest('hex').slice(0, 12);
const normHtml = h => h.replace(/\?v=[A-Za-z0-9._-]+/g, '');
const esc = Core.esc;

function headSeo(o) {
  const l = [`<title>${esc(o.title)}</title>`, `<meta name="description" content="${esc(o.description)}">`, `<link rel="canonical" href="${esc(o.canonical)}">`];
  if (o.noindex) l.push('<meta name="robots" content="noindex,follow">');
  l.push('<meta property="og:type" content="website">', '<meta property="og:site_name" content="MR4 Distribuidora">', '<meta property="og:locale" content="pt_BR">',
    `<meta property="og:title" content="${esc(o.title)}">`, `<meta property="og:description" content="${esc(o.description)}">`,
    `<meta property="og:url" content="${esc(o.canonical)}">`, `<meta property="og:image" content="${esc(ORIGEM + LOGO)}">`);
  if (o.jsonld) l.push(o.jsonld);
  return l.join('\n');
}
function linksTaxonomia(tax, raizTexto) {
  const cats = '<a class="cat-link" href="/" data-cat="">Todas</a>' + tax.categorias.map(c =>
    `<a class="cat-link${c.chave && Core.ehSemGrupo(c.chave) ? ' sem-cat' : ''}" href="${esc(c.url)}" data-cat="${esc(c.chave)}">${esc(c.rotulo)}</a>`).join('');
  const marcas = '<a class="cat-link" href="/" data-marca="">Todas as marcas</a>' + tax.marcas.map(m =>
    `<a class="cat-link" href="${esc(m.url)}" data-marca="${esc(m.chave)}">${esc(m.rotulo)}</a>`).join('');
  return { cats, marcas };
}
function contextoSeo(tax, intro) {
  return `<section class="seo-contexto" aria-labelledby="ctxTit"><h2 id="ctxTit">${esc(intro.titulo)}</h2>${[].concat(intro.texto).map(t => `<p>${esc(t)}</p>`).join('')}
<nav aria-label="Categorias do catálogo"><strong>Categorias:</strong> ${tax.categorias.map(c => `<a href="${esc(c.url)}">${esc(c.rotulo)}</a>`).join(' · ')}</nav>
<nav aria-label="Marcas do catálogo"><strong>Marcas:</strong> ${tax.marcas.map(m => `<a href="${esc(m.url)}">${esc(m.rotulo)}</a>`).join(' · ')}</nav></section>`;
}
const textoHome = tax => [
  'A MR4 Distribuidora é distribuidora de acessórios e peças automotivas no atacado, com sede em Fortaleza (CE). Este é o catálogo B2B para lojistas e instaladores de CE, PI e RN.',
  `Navegue por categorias como ${Core.listaPt(tax.categorias.filter(c => !GENERICAS.has(Core.norm(c.chave))).slice(0, 6).map(c => c.rotulo))} ou por marca, consulte código, preço e estoque atualizados a cada sincronização e monte seu pedido para enviar ao atendimento pelo WhatsApp.`
];
const LOGO_LINK = alt => `<a class="logo" href="/" id="logoTopo" aria-label="MR4 Distribuidora — catálogo"><img class="logo-img" src="/assets/logo-header.png" width="103" height="36" alt="${alt}"></a>`;

const GENERICAS = new Set(['diversos', 'geral', 'produtos sem grupo']);       // categorias genéricas: texto neutro, sem fingir especialização
const topPor = (itens, f, n) => {
  const c = {}; itens.forEach(e => { const k = f(e); if (k) c[k] = (c[k] || 0) + 1; });
  return Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b, 'pt-BR')).slice(0, n);
};
const plural = (n, um, varios) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`;
/** textos de categoria/marca: só nome, contagem do feed e marcas/categorias reais predominantes — nada de finalidade técnica */
function textosTaxonomia(tipo, t) {
  const cat = tipo === 'categoria', n = t.itens.length, rotulo = t.rotulo;
  const gen = cat && GENERICAS.has(Core.norm(t.chave));
  const rel = cat ? topPor(t.itens, e => e.marca, 3) : topPor(t.itens, e => (GENERICAS.has(Core.norm(e.catChave)) ? '' : e.catRotulo), 3);
  const relTxt = !rel.length ? '' : cat ? `, de marcas como ${Core.listaPt(rel)}` : `, em categorias como ${Core.listaPt(rel)}`;
  if (!n) {
    return { title: cat ? `${rotulo} no catálogo B2B | MR4 Distribuidora` : `Produtos ${rotulo} no catálogo B2B | MR4 Distribuidora`,
      description: `Nenhum produto ${cat ? 'da categoria' : 'da marca'} ${rotulo} listado no momento no catálogo B2B da MR4 Distribuidora.`, intro: `Nenhum produto ${cat ? 'da categoria' : 'da marca'} ${rotulo} está listado no momento.` };
  }
  const MAX = 160, fim = ' Consulte códigos, preço e estoque atuais.';
  const mk = relT => cat
    ? `${rotulo}: ${plural(n, 'produto listado', 'produtos listados')} no catálogo B2B da MR4 Distribuidora${relT}.${fim}`
    : `Produtos ${rotulo}: ${plural(n, 'item listado', 'itens listados')} no catálogo B2B da MR4 Distribuidora${relT}.${fim}`;
  let description = mk(relTxt);
  for (let k = rel.length - 1; description.length > MAX && k >= 1; k--) description = mk(`${cat ? ', de marcas como ' : ', em categorias como '}${Core.listaPt(rel.slice(0, k))}`);
  if (description.length > MAX) description = mk('');
  const abre = cat
    ? (gen ? `Esta página reúne ${plural(n, 'produto listado', 'produtos listados')} na categoria “${rotulo}” do catálogo B2B da MR4 Distribuidora${/sem categoria/i.test(rotulo) ? ', cadastrados sem uma categoria definida' : ''}${relTxt}.`
           : `Esta página reúne ${plural(n, 'produto listado', 'produtos listados')} da categoria ${rotulo} no catálogo B2B da MR4 Distribuidora${relTxt}.`)
    : `Esta página reúne ${plural(n, 'produto', 'produtos')} da marca ${rotulo} listados no catálogo B2B da MR4 Distribuidora${relTxt}.`;
  return {
    title: cat ? (/sem categoria/i.test(rotulo) ? 'Produtos sem categoria no catálogo B2B | MR4 Distribuidora' : `${rotulo} no catálogo B2B | MR4 Distribuidora`) : `Produtos ${rotulo} no catálogo B2B | MR4 Distribuidora`,
    description, intro: abre + ' Veja códigos, preço e estoque atuais e monte seu pedido para enviar pelo WhatsApp.'
  };
}
function renderizarShell(shell, tax, pg) {
  const l = linksTaxonomia(tax);
  return shell
    .replace('{{HEAD}}', () => headSeo(pg))
    .replace('{{BODYATTRS}}', () => pg.bodyAttrs || '')
    .replace('{{CATS}}', () => l.cats).replace('{{MARCAS}}', () => l.marcas)
    // home: o H1 é a marca no topo (logo com alt), sem ocupar a barra de resultados; categoria/marca: H1 compacto na barra
    .replace('{{LOGO}}', () => (pg.h1Logo ? `<h1 class="h1-logo">${LOGO_LINK(esc(pg.h1Logo))}</h1>` : LOGO_LINK('MR4 Distribuidora')))
    .replace('{{H1}}', () => (pg.h1 ? `<h1 class="titulo-pg">${esc(pg.h1)}</h1>` : ''))
    .replace('{{LISTA}}', () => pg.lista || '')
    .replace('{{CONTEXTO}}', () => contextoSeo(tax, pg.contexto));
}
function paginaTaxonomia(shell, tax, tipo, t, vazia) {
  const cat = tipo === 'categoria', url = ORIGEM + t.url;
  const rotulo = t.rotulo, tx = textosTaxonomia(tipo, t);
  return renderizarShell(shell, tax, {
    title: tx.title, description: tx.description,
    canonical: url, noindex: !!vazia, jsonld: LD.tag(LD.grafoTaxonomia(tipo, t, tx.description, !!vazia)),
    bodyAttrs: ` data-pagina="${tipo}" data-${cat ? 'cat' : 'marca'}="${esc(t.chave)}"`,
    h1: rotulo,
    lista: vazia ? `<p class="seo-vazio">Nenhum produto disponível nesta ${cat ? 'categoria' : 'marca'} no momento. <a href="/">Ver todo o catálogo</a>.</p>` : Core.htmlListaProdutosSeo(t.itens, cat ? `Produtos da categoria ${rotulo}` : `Produtos da marca ${rotulo}`),
    contexto: { titulo: cat ? `Sobre a categoria ${rotulo}` : `Sobre a marca ${rotulo}`, texto: tx.intro }
  });
}
function paginaHome(shell, tax) {
  return renderizarShell(shell, tax, {
    title: TITLE_HOME, description: DESC_HOME, canonical: ORIGEM + '/', jsonld: LD.tag(LD.grafoHome()), bodyAttrs: ' data-pagina="home"', h1: '', h1Logo: H1_HOME, lista: '',
    contexto: { titulo: 'Sobre o catálogo', texto: textoHome(tax) }
  });
}
/** página histórica de produto que saiu do feed: aviso estático (sem preço/estoque), sem relacionados; noindex após a carência */
function marcarIndisponivel(html, noindex) {
  let h = html.replace(/<meta name="robots" content="[^"]*">\n?/g, '');
  if (noindex) h = h.replace(/(<link rel="canonical" href="[^"]*">)/, '$1\n<meta name="robots" content="noindex,follow">');
  h = h.replace(/<div class="produto-compra"[^>]*>[\s\S]*?<\/div>/, '<div class="produto-compra" id="pCompra" data-estado="indisponivel"><p class="produto-indisp">Produto não disponível no catálogo no momento. <a href="/">Ver o catálogo</a>.</p></div>');
  h = h.replace(/<section class="relacionados"[\s\S]*?<\/section>/, '');
  return LD.somenteBreadcrumb(h);                                            // sem Product (nem preço/estoque antigos) em página de produto fora do feed
}
const dataFeed = atualizado => { const d = new Date(atualizado); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
const diasEntre = (a, b) => { const x = new Date(a), y = new Date(b); return isNaN(x) || isNaN(y) ? 0 : Math.floor((y - x) / 86400000); };
const urlXml = (loc, lastmod) => `<url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
const ROBOTS = `User-agent: *\nAllow: /\n\nSitemap: ${ORIGEM}/sitemap.xml\n`;

function renderizarPagina(item, tpl, rel, titulo) {
  const m = Core.metaProduto(item, ORIGEM, LOGO, titulo);
  const og = ['<meta property="product:retailer_item_id" content="' + Core.esc(item.p.ref) + '">'].concat(item.marca ? ['<meta property="product:brand" content="' + Core.esc(item.marca) + '">'] : []).join('\n');
  return tpl
    .replace(/\{\{TITLE\}\}/g, Core.esc(m.title))
    .replace(/\{\{DESC\}\}/g, Core.esc(m.description))
    .replace(/\{\{CANONICAL\}\}/g, Core.esc(m.url))
    .replace(/\{\{OG_IMAGE\}\}/g, Core.esc(m.image))
    .replace('{{OG_PRODUCT}}', () => og)
    .replace('{{JSONLD}}', () => LD.tag(LD.grafoProduto(item)))
    .replace('{{BREADCRUMB}}', () => Core.htmlBreadcrumb(item).replace('<nav ', '<nav id="bc" '))
    .replace('{{INFO}}', () => Core.htmlProdutoInfo(item))
    .replace('{{RELACIONADOS}}', () => Core.htmlRelacionadosEstatico(rel || []));
}
function renderizarRedirecionamento(novoUrl) {
  const abs = ORIGEM + novoUrl;
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Redirecionando… — MR4 Distribuidora</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${Core.esc(abs)}">
<meta http-equiv="refresh" content="0; url=${Core.esc(novoUrl)}">
</head><body><p>Este produto mudou de endereço: <a href="${Core.esc(novoUrl)}">abrir página atual</a>.</p>
<script>location.replace(${JSON.stringify(novoUrl).replace(/</g, '\\u003c')}+location.search+location.hash);</script></body></html>
`;
}
const dirDe = url => url.replace(/^\/produto\//, '').replace(/\/$/, '');

/** planejamento puro: devolve os arquivos que DEVEM existir (caminho relativo → conteúdo) e o novo manifesto.
 *  Sem `opts` = comportamento da Fase 2 (só páginas de produto + manifest).
 *  Com `opts` = { shell, estado, atualizado, existente(rel) } → SEO Fase 1 (home, categorias, marcas, robots, sitemap, estado). */
function planejar(produtosBrutos, tpl, manifestoAnterior, opts) {
  const itens = Core.prepararCatalogo(produtosBrutos);
  const est0 = (opts && opts.estado) || {};
  if (opts && (!itens.length || (est0.ativos && itens.length < LIMITE_SAUDE * est0.ativos))) {
    return { arquivos: {}, itens, saudavel: false, estado: est0 };            // feed suspeito: não regenera nada
  }
  const anterior = (manifestoAnterior && manifestoAnterior.produtos) || {};
  const arquivos = {};
  const produtos = Object.assign({}, anterior);
  const rel = opts ? (it => Core.relacionados(itens, it, 4)) : (() => []);
  const titulos = Core.titulosProdutos(itens);                              // title único: o código desambigua nomes iguais
  itens.forEach((it, i) => {
    const dir = dirDe(it.url);
    arquivos['produto/' + dir + '/index.html'] = renderizarPagina(it, tpl, rel(it), titulos[i]);
    const antigo = anterior[it.slugCodigo];
    if (antigo && antigo !== dir) arquivos['produto/' + antigo + '/index.html'] = renderizarRedirecionamento(it.url);
    produtos[it.slugCodigo] = dir;
  });
  const ordenado = {};
  Object.keys(produtos).sort().forEach(k => { ordenado[k] = produtos[k]; });
  arquivos['produto/manifest.json'] = JSON.stringify({ versao: 1, produtos: ordenado }, null, 1) + '\n';
  if (!opts) return { arquivos, itens };

  const hoje = dataFeed(opts.atualizado);
  const tax = Core.taxonomia(itens);
  const vivos = new Set(itens.map(i => i.slugCodigo));
  const estado = { versao: 1, ativos: itens.length, lastmod: {}, ausentes: {}, taxonomias: {} };

  // produtos que saíram do feed: aviso estático; noindex só após a carência
  Object.keys(ordenado).filter(c => !vivos.has(c)).forEach(c => {
    const rel0 = 'produto/' + ordenado[c] + '/index.html';
    if (arquivos[rel0]) return;                                              // virou stub de redirecionamento
    const prev = opts.existente(rel0);
    if (!prev || /http-equiv="refresh"/.test(prev)) return;
    const primeira = (est0.ausentes && est0.ausentes[c]) || hoje;
    estado.ausentes[c] = primeira;
    arquivos[rel0] = marcarIndisponivel(prev, !!primeira && !!hoje && diasEntre(primeira, hoje) >= CARENCIA_DIAS);
  });

  // páginas de categoria e marca (memória: página que existiu e ficou sem produtos vira noindex, nunca é apagada)
  const vivas = {};
  [['categoria', tax.categorias], ['marca', tax.marcas]].forEach(([tipo, lista]) => lista.forEach(t => {
    vivas[t.url] = 1;
    estado.taxonomias[t.url] = { tipo, chave: t.chave, rotulo: t.rotulo };
    arquivos[t.url.slice(1) + 'index.html'] = paginaTaxonomia(opts.shell, tax, tipo, t, false);
  }));
  Object.keys(est0.taxonomias || {}).filter(u => !vivas[u]).forEach(u => {
    const m = est0.taxonomias[u];
    estado.taxonomias[u] = m;
    arquivos[u.slice(1) + 'index.html'] = paginaTaxonomia(opts.shell, tax, m.tipo, { chave: m.chave, rotulo: m.rotulo, url: u, itens: [] }, true);
  });
  arquivos['index.html'] = paginaHome(opts.shell, tax);
  arquivos['robots.txt'] = ROBOTS;

  // sitemap: só URLs canônicas, indexáveis e com 200 (home, categorias, marcas, produtos atuais)
  const urls = [{ u: '/', f: 'index.html' }]
    .concat(tax.categorias.map(t => ({ u: t.url, f: t.url.slice(1) + 'index.html' })))
    .concat(tax.marcas.map(t => ({ u: t.url, f: t.url.slice(1) + 'index.html' })))
    .concat(itens.map(i => ({ u: i.url, f: 'produto/' + dirDe(i.url) + '/index.html' })).sort((x, y) => (x.u < y.u ? -1 : 1)));
  const lm0 = est0.lastmod || {};
  const entradas = urls.map(({ u, f }) => {
    const h = hash12(normHtml(arquivos[f]));
    const ant = lm0[u];
    // sem histórico: 1ª geração (estado vazio) → sem data; URL nova numa geração posterior → data do feed (a página é de fato nova)
    const reg = !ant ? { h, d: Object.keys(lm0).length ? hoje : null } : ant.h === h ? ant : { h, d: hoje };
    estado.lastmod[u] = reg;
    return urlXml(ORIGEM + u, reg.d);
  });
  arquivos['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entradas.join('\n')}\n</urlset>\n`;
  const ord = o => Object.keys(o).sort().reduce((r, k) => (r[k] = o[k], r), {});
  estado.lastmod = ord(estado.lastmod); estado.ausentes = ord(estado.ausentes); estado.taxonomias = ord(estado.taxonomias);
  arquivos['data/seo-estado.json'] = JSON.stringify(estado, null, 1) + '\n';
  return { arquivos, itens, saudavel: true, estado, tax, urls: urls.map(x => x.u) };
}

/** URLs INDEXÁVEIS cujo HTML (sem ?v=) é novo ou mudou de verdade — insumo do IndexNow. Sitemap/robots/estado/manifest nunca entram. */
const PAGINA_INDEXAVEL = /^(index\.html|(categoria|marca|produto)\/[^/]+\/index\.html)$/;
function urlsAlteradas(arquivos, existente) {
  const out = [];
  Object.keys(arquivos).filter(rel => PAGINA_INDEXAVEL.test(rel)).sort().forEach(rel => {
    const antes = existente(rel);
    if (antes !== null && normHtml(antes) === normHtml(arquivos[rel])) return;
    out.push(rel === 'index.html' ? ORIGEM + '/' : ORIGEM + '/' + rel.replace(/index\.html$/, ''));
  });
  return out;
}

function executar(raiz) {
  const dados = JSON.parse(fs.readFileSync(path.join(raiz, 'data/produtos.json'), 'utf8'));
  const tpl = fs.readFileSync(path.join(raiz, 'templates/produto.html'), 'utf8');
  const lerJson = rel => { try { return JSON.parse(fs.readFileSync(path.join(raiz, rel), 'utf8')); } catch (e) { return null; } };
  const lerTxt = rel => { try { return fs.readFileSync(path.join(raiz, rel), 'utf8'); } catch (e) { return null; } };
  const manifesto = lerJson('produto/manifest.json');
  const shell = fs.readFileSync(path.join(raiz, 'templates/catalogo.html'), 'utf8');
  const r = planejar(dados.produtos || [], tpl, manifesto, { shell, estado: lerJson('data/seo-estado.json'), atualizado: dados.atualizado, existente: lerTxt });
  if (r.saudavel === false) {
    console.warn(`⚠️  Feed suspeito (${r.itens.length} itens; referência ${(r.estado || {}).ativos || '—'}): nada foi regenerado (falha de sync não é remoção de produto).`);
    return { produtos: r.itens.length, escritos: 0, iguais: 0, saudavel: false };
  }
  const alteradas = urlsAlteradas(r.arquivos, lerTxt);                      // calculado ANTES de gravar
  let escritos = 0, iguais = 0;
  Object.keys(r.arquivos).sort().forEach(rel => {
    const destino = path.join(raiz, rel);
    const atual = lerTxt(rel);
    if (atual === r.arquivos[rel]) { iguais++; return; }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, r.arquivos[rel], 'utf8');
    escritos++;
  });
  console.log(`🧱 Site estático: ${r.itens.length} produtos · ${r.tax.categorias.length} categorias · ${r.tax.marcas.length} marcas · ${r.urls.length} URLs no sitemap · ${escritos} arquivos escritos · ${iguais} sem mudança`);
  return { produtos: r.itens.length, escritos, iguais, saudavel: true, alteradas };
}

module.exports = { LD, urlsAlteradas, planejar, textosTaxonomia, textoHome, GENERICAS, renderizarPagina, renderizarRedirecionamento, marcarIndisponivel, paginaHome, paginaTaxonomia, dirDe, ORIGEM, LOGO, CARENCIA_DIAS, LIMITE_SAUDE, TITLE_HOME, DESC_HOME, ROBOTS };
if (require.main === module) {
  const r = executar(path.join(__dirname, '..'));
  if (process.env.INDEXNOW_URLS_FILE) { try { fs.writeFileSync(process.env.INDEXNOW_URLS_FILE, JSON.stringify(r.alteradas || [])); } catch (e) { /* best-effort */ } }
}
