/**
 * MR4 Catálogo — núcleo puro (sem DOM), usado pelo navegador (window.CatalogoCore)
 * e pelo Node (testes e scripts/sync-produtos.js).
 *
 * Tudo aqui é determinístico e sem IA:
 *  - normalização de texto SÓ para comparação (o nome exibido nunca é alterado pela busca);
 *  - higiene de exibição (resíduo fiscal de NF-e em nome/descrição) — o ERP não é alterado;
 *  - normalização de marcas por mapa explícito (equivalências comprovadas);
 *  - busca por tokens (E), ranking simples, tolerância leve a erro de digitação, ordenação.
 *
 * RANKING (maior pontuação primeiro; empate = ordem original do catálogo):
 *   1000  código exato
 *    900  nome exato
 *    800  nome começa com o texto digitado
 *    780  código começa com o texto digitado (parcial)
 *    700  todos os termos estão no nome
 *    600  marca casa com algum termo (e os termos estão em nome+marca)
 *    500  categoria casa com algum termo
 *    400  demais correspondências (termos espalhados em nome/código/marca/categoria)
 *   + até 5 pontos por termo que começa uma palavra do nome (desempate fino).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CatalogoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ───────── normalização para comparação ───────── */
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[‘’ʼ'`´"″′]/g, '')   // apóstrofos/aspas: Led’s → leds, 5'' → 5
      .replace(/[^a-z0-9]+/g, ' ')                  // hífen, pontuação, barras → espaço
      .replace(/\s+/g, ' ')
      .trim();
  }
  const compacto = s => norm(s).replace(/ /g, '');
  const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'para', 'com', 'e', 'a', 'o', 'em', 'p']);
  function tokens(q) {
    const t = norm(q).split(' ').filter(Boolean);
    const uteis = t.filter(x => !STOP.has(x));
    return uteis.length ? uteis : t;
  }

  /* ───────── higiene de exibição (resíduo fiscal) ───────── */
  const NUM = '[\\d.]+(?:,\\s?\\d+)?';
  const MARCADOR_FISCAL = /Trib\.?\s*aprox|Lote-Val|\bCEST\b|ICMS|\bST:\s*R\$|Lote-Validade|\bI\/\d+-N\/|\bIBPT\b/i;
  const PADROES_FISCAIS = [
    /Trib\.?\s*aprox\.?[^;\n]*/gi,                                                       // tributos aproximados + fonte IBPT
    /\bCEST:?\s*[\d.]+/gi,
    new RegExp('\\bBC\\s+ICMS\\s+retido\\s+R\\$\\s*' + NUM, 'gi'),
    new RegExp('\\bVl\\.?\\s+ICMS\\s+retido\\s+R\\$\\s*' + NUM, 'gi'),
    /\bImp\.?\s*Ret\.?\s*ST-?\s*Prot\.?\s*ICMS\s*[\d/]*/gi,
    new RegExp('\\bIVA:\\s*\\d+(?:,\\d+)?%\\s*pICMS\\s*ST:\\s*\\d+(?:,\\d+)?%\\s*BC\\s*ICMS\\s*ST:\\s*' + NUM + '\\s*VR\\s*ICMS\\s*ST:\\s*' + NUM, 'gi'),
    /\s*-?\s*Lote-Validade-Qtd:\s*\([^)]*\)/gi,
  /\s*-\s*Lote-Val[\w:()\-/]*\s*$/gi,                                              // 'Lote-Val' truncado no fim do nome
    /\(?(?:N\/)?I\/\d+-N\/+\d+\/\d+-\d+\)?/g,                                           // (N/I/6304-N///6/2004-2) e truncados
    new RegExp('(?:\\b(?:Base|Valor|Vl\\.?|or|alor|lor)\\s+)?\\bST:\\s*R\\$\\s*' + NUM, 'gi')  // Base ST / Valor ST / ST: R$
  ];
  function removerFiscal(texto) {
    let t = String(texto);
    if (!MARCADOR_FISCAL.test(t)) return t;                    // sem marcador → devolve intacto
    PADROES_FISCAIS.forEach(re => { t = t.replace(re, ' '); });
    t = t.replace(/\s+(?:Valor|Val|Base|Vl\.?)\s*$/i, ' ');                 // rótulo fiscal que ficou pendurado no fim
    t = t.split('\n').map(l => l.replace(/[ \t]+/g, ' ').replace(/^[\s;,.-]+|[\s;,]+$/g, '')).join('\n')
      .replace(/\n{3,}/g, '\n\n').trim();
    return /[a-z0-9]/i.test(t) && t.replace(/[^a-z0-9]/gi, '').length >= 3 ? t : '';
  }
  function limparDescricao(d) { return d ? removerFiscal(d) : (d || ''); }
  function limparNome(n) {
    const bruto = String(n == null ? '' : n);
    const limpo = removerFiscal(bruto);
    if (limpo === bruto) return bruto.replace(/\s+/g, ' ').trim();          // sem resíduo: só espaços (nunca mexe em hífens/caixa)
    const t = limpo.replace(/[ \t]+/g, ' ').replace(/[\s-]+$/g, '').trim();
    return t || bruto.replace(/\s+/g, ' ').trim();
  }

  /* ───────── marcas: mapa explícito e auditável ─────────
   * Só entram equivalências COMPROVADAS (mesma marca com caixa/grafia diferente, evidência nos dados).
   * Dúvida → não unir. Marcas que não aparecem aqui ficam como vieram (apenas trim/espaços).
   */
  const MAPA_MARCAS = [
    { para: 'Tiger', de: ['Tiger', 'TIGER'], motivo: 'caixa' },
    { para: 'Tiger', de: ['TIGER AUTO'], motivo: 'mesma linha de códigos (1015Hx, 1025xxx) já cadastrada como Tiger' },
    { para: 'Permak', de: ['Permak', 'PERMAK'], motivo: 'caixa' },
    { para: 'Fiamon', de: ['Fiamon', 'fiamon'], motivo: 'caixa' },
    { para: 'Tarponn', de: ['Tarponn', 'TARPONN'], motivo: 'caixa' },
    { para: 'Lux Led', de: ['Lux Led', 'Lux led'], motivo: 'caixa' },
    { para: 'Rayx', de: ['Rayx', 'RAYX'], motivo: 'caixa' },
    { para: 'Vipertron', de: ['Vipertron', 'VIPERTRON'], motivo: 'caixa' },
    { para: 'Exclusive', de: ['Exclusive', 'EXCLUSIVE'], motivo: 'caixa' },
    { para: 'First Option', de: ['First Option', 'FIRST OPTION'], motivo: 'caixa' },
    { para: 'Alemar', de: ['Alemar', 'ALEMAR'], motivo: 'caixa' },
    { para: 'Alemar', de: ['Alermar'], motivo: 'erro de digitação; o nome do produto contém ALEMAR' },
    { para: 'Fitto/Joker', de: ['Fitto/Joker', 'FITTO/JOKER'], motivo: 'caixa' },
    { para: 'Fitto/Joker', de: ['FITTO/JPKER'], motivo: 'erro de digitação (P por O); mesma linha MD09 das molduras Fitto/Joker' },
    { para: 'Look Out', de: ['look out'], motivo: 'caixa (tudo minúsculo)' }
  ];
  // valores que são tipo de produto, não marca → sem marca (não se inventa fabricante)
  const MARCAS_INVALIDAS = [
    { de: ['Soquete'], motivo: 'tipo de produto, não marca' },
    { de: ['MOLDURA'], motivo: 'tipo de produto, não marca' }
  ];
  const _marcaPorChave = {};
  MAPA_MARCAS.forEach(m => m.de.forEach(v => { _marcaPorChave[norm(v)] = m.para; }));
  const _marcaInvalida = {};
  MARCAS_INVALIDAS.forEach(m => m.de.forEach(v => { _marcaInvalida[norm(v)] = true; }));

  function marcaNormalizada(bruta) {
    const t = String(bruta == null ? '' : bruta).replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const k = norm(t);
    if (_marcaInvalida[k]) return '';
    return _marcaPorChave[k] || t;
  }
  /** relatório auditável: toda transformação realizada (bruto → exibido), com contagem */
  function relatorioMarcas(lista) {
    const c = {};
    (lista || []).forEach(p => {
      const b = String(p.brand == null ? '' : p.brand).replace(/\s+/g, ' ').trim();
      if (!b) return;
      const para = marcaNormalizada(b);
      if (para === b) return;
      const key = b + '→' + para;
      c[key] = c[key] || { de: b, para: para || '(sem marca)', produtos: 0 };
      c[key].produtos++;
    });
    return Object.values(c).sort((a, b) => b.produtos - a.produtos || a.de.localeCompare(b.de));
  }
  /** grupos que só diferem por caixa/espaço/acento e NÃO estão cobertos pelo mapa (alerta para o teste) */
  function marcasNaoUnificadas(lista) {
    const g = {};
    (lista || []).forEach(p => {
      const m = marcaNormalizada(p.brand);
      if (!m) return;
      const k = norm(m);
      (g[k] = g[k] || new Set()).add(m);
    });
    return Object.values(g).filter(s => s.size > 1).map(s => [...s]);
  }

  /* ───────── categorias ───────── */
  const ORDEM_CATEGORIAS = [
    'Led’s interno/externo', 'Lâmpada de led', 'Lâmpadas Halógenas', 'Câmera', 'Multimídia', 'Rádio',
    'Sensor estacionamento', 'Alto-Falantes', 'Chave', 'Farol de milha', 'Fusíveis', 'Terminais', 'Chicotes',
    'Soquetes', 'Antenas', 'Palheta', 'Bateria', 'Travas', 'Diversos', 'PRODUTOS SEM GRUPO', 'Moldura', 'Geral'
  ];
  const normCat = s => (s || '').trim().toLowerCase().replace(/[‘’ʼ']/g, "'");
  function prioridadeCategoria(cat) {
    const nc = normCat(cat);
    const i = ORDEM_CATEGORIAS.findIndex(c => normCat(c) === nc);
    return i >= 0 ? i : ORDEM_CATEGORIAS.length - 3;   // regra original da MR4 para categorias fora da lista
  }
  const ehSemGrupo = cat => norm(cat) === 'produtos sem grupo';
  const ROTULO_SEM_GRUPO = 'Sem categoria';
  const rotuloCategoria = cat => (ehSemGrupo(cat) ? ROTULO_SEM_GRUPO : String(cat || '').trim());
  /** categorias comerciais na ordem da MR4; "sem grupo" sempre separado e por último */
  function ordenarCategorias(cats) {
    const lista = [...new Set((cats || []).map(c => String(c || '').trim()).filter(Boolean))];
    const comerciais = lista.filter(c => !ehSemGrupo(c))
      .sort((a, b) => prioridadeCategoria(a) - prioridadeCategoria(b) || a.localeCompare(b, 'pt-BR'));
    return { comerciais, semGrupo: lista.filter(ehSemGrupo) };
  }

  /* ───────── preparação do catálogo e índice de busca ───────── */
  function precoNumerico(p) {
    const s = String((p && p.price) || '').replace(/[^\d,]/g, '').replace(',', '.');
    return parseFloat(s) || 0;
  }
  function prepararCatalogo(bruto) {
    return (bruto || []).map((r, ordem) => {
      const p = Object.assign({}, r, {
        name: limparNome(r.name),
        desc: limparDescricao(r.desc),
        category: String(r.category || '').trim()
      });
      const marca = marcaNormalizada(r.brand);
      const semGrupo = ehSemGrupo(p.category);
      const catRot = rotuloCategoria(p.category);
      const nome = norm(p.name), ref = norm(p.ref), cat = semGrupo ? '' : norm(p.category), mar = norm(marca);
      return {
        p, ordem, marca, semGrupo, catChave: p.category, catRotulo: catRot,
        n: nome, r: ref, rc: compacto(p.ref), c: cat, b: mar,
        all: [nome, ref, compacto(p.ref), cat, mar].join(' '),
        words: nome.split(' ').filter(Boolean)
      };
    });
  }

  /* ───────── tolerância leve a erro de digitação (distância de Damerau/OSA ≤ 1) ───────── */
  function osa(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = [];
    for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }
  function vocabulario(itens) {
    const v = new Map();
    itens.forEach(e => {
      new Set((e.n + ' ' + e.c + ' ' + e.b).split(' ')).forEach(w => {
        if (w.length >= 4 && !/\d/.test(w)) v.set(w, (v.get(w) || 0) + 1);
      });
    });
    return v;
  }
  /** para cada termo desconhecido (≥5 letras, sem dígitos) sugere até 3 palavras do catálogo a 1 edição de distância */
  function corrigirTermos(toks, itens, vocab) {
    let mudou = false;
    const alt = toks.map(t => {
      const conhecido = itens.some(e => e.all.includes(t));
      if (conhecido || t.length < 5 || /\d/.test(t)) return [t];
      const cands = [];
      vocab.forEach((freq, w) => {
        if (w[0] === t[0] && Math.abs(w.length - t.length) <= 1 && osa(t, w, 1) <= 1) cands.push([w, freq]);
      });
      if (!cands.length) return [t];
      mudou = true;
      return cands.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(c => c[0]);
    });
    return { alt, mudou };
  }

  /* ───────── busca ───────── */
  function casaToken(e, alts) {
    for (const t of alts) {
      if (e.all.includes(t)) return true;
      if (t.length > 3 && t.endsWith('s') && e.all.includes(t.slice(0, -1))) return true;   // plural simples
    }
    return false;
  }
  const _vocabCache = new WeakMap();
  function pontuar(e, qn, qc, alt) {
    const emNome = alt.every(a => a.some(t => e.n.includes(t) || (t.length > 3 && t.endsWith('s') && e.n.includes(t.slice(0, -1)))));
    let s;
    if (qc && (e.rc === qc || e.r === qn)) s = 1000;
    else if (e.n === qn) s = 900;
    else if (e.n.startsWith(qn)) s = 800;
    else if (qc.length >= 2 && e.rc.startsWith(qc)) s = 780;
    else if (emNome) s = 700;
    else {
      const nomeMarca = e.n + ' ' + e.b;
      const todosNomeMarca = alt.every(a => a.some(t => nomeMarca.includes(t)));
      const marcaCasa = e.b && alt.some(a => a.some(t => e.b.includes(t)));
      const catCasa = e.c && alt.some(a => a.some(t => e.c.includes(t)));
      if (marcaCasa && todosNomeMarca) s = 600;
      else if (catCasa) s = 500;
      else s = 400;
    }
    alt.forEach(a => { if (a.some(t => e.words.some(w => w.startsWith(t)))) s += 5; });
    return s;
  }
  /** retorna { itens (ordenados por relevância), corrigido: null | 'termos usados' } */
  function buscar(itens, consulta) {
    const qn = norm(consulta);
    if (!qn) return { itens: itens.slice(), corrigido: null, relevancia: false };
    const toks = tokens(consulta);
    const qc = qn.replace(/ /g, '');
    let alt = toks.map(t => [t]);
    let achados = itens.filter(e => alt.every(a => casaToken(e, a)));
    let corrigido = null;
    if (!achados.length) {
      let vocab = _vocabCache.get(itens);
      if (!vocab) { vocab = vocabulario(itens); _vocabCache.set(itens, vocab); }
      const c = corrigirTermos(toks, itens, vocab);
      if (c.mudou) {
        const tentativa = itens.filter(e => c.alt.every(a => casaToken(e, a)));
        if (tentativa.length) { achados = tentativa; alt = c.alt; corrigido = c.alt.map(a => a[0]).join(' '); }
      }
    }
    const pont = new Map(achados.map(e => [e, pontuar(e, qn, qc, alt)]));
    achados.sort((a, b) => pont.get(b) - pont.get(a) || a.ordem - b.ordem);
    return { itens: achados, corrigido, relevancia: true };
  }

  /* ───────── ordenação ───────── */
  function ordenar(lista, modo, destaques) {
    const arr = lista.slice();
    const dest = e => (destaques && destaques.has(String(e.p.id))) ? 0 : 1;
    const byOrdem = (a, b) => a.ordem - b.ordem;
    switch (modo) {
      case 'az': return arr.sort((a, b) => a.p.name.localeCompare(b.p.name, 'pt-BR') || byOrdem(a, b));
      case 'za': return arr.sort((a, b) => b.p.name.localeCompare(a.p.name, 'pt-BR') || byOrdem(a, b));
      case 'menor-preco': return arr.sort((a, b) => precoNumerico(a.p) - precoNumerico(b.p) || byOrdem(a, b));
      case 'maior-preco': return arr.sort((a, b) => precoNumerico(b.p) - precoNumerico(a.p) || byOrdem(a, b));
      case 'maior-estoque': return arr.sort((a, b) => b.p.stock - a.p.stock || byOrdem(a, b));
      case 'destaque': return arr.sort((a, b) => dest(a) - dest(b));   // estável: mantém a ordem recebida dentro de cada grupo
      default: return arr;                                              // 'padrao': ordem do catálogo (ou relevância na busca)
    }
  }

  /**
   * Consulta completa sobre a base inteira: categoria + marca + busca + ordenação.
   * estado: { q, cat, marca, sort }  (cat = chave de categoria; marca = marca normalizada)
   */
  function consultar(itens, estado, destaques) {
    const e = estado || {};
    let base = itens;
    if (e.cat) base = base.filter(x => x.catChave === e.cat);
    if (e.marca) base = base.filter(x => x.marca === e.marca);
    const comBusca = !!norm(e.q);
    let r = comBusca ? buscar(base, e.q) : { itens: base.slice(), corrigido: null, relevancia: false };
    // relevância vale para a ordenação padrão; as demais ordenações são escolha explícita do usuário
    let lista = r.itens;
    const modo = e.sort || 'padrao';
    if (modo === 'destaque') lista = ordenar(lista, 'destaque', destaques);
    else if (modo !== 'padrao') lista = ordenar(lista, modo, destaques);
    return { lista, total: lista.length, corrigido: r.corrigido, termo: String(e.q || '').trim(), comBusca };
  }

  function opcoesMarca(itens) {
    const c = {};
    itens.forEach(x => { if (x.marca) c[x.marca] = (c[x.marca] || 0) + 1; });
    return Object.keys(c).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(m => ({ marca: m, n: c[m] }));
  }

  function mensagemWhatsProduto(p, qtd) {
    const linhas = ['Olá, MR4 Distribuidora! Vi este produto no catálogo e tenho interesse:', '', '*' + p.name + '*', 'Ref: ' + p.ref];
    if (qtd && qtd > 0) linhas.push('Quantidade desejada: ' + qtd);
    linhas.push('', '(Mensagem enviada pelo catálogo digital)');
    return linhas.join('\n');
  }

  return {
    norm, compacto, tokens, removerFiscal, limparDescricao, limparNome,
    MAPA_MARCAS, MARCAS_INVALIDAS, marcaNormalizada, relatorioMarcas, marcasNaoUnificadas,
    ORDEM_CATEGORIAS, prioridadeCategoria, ehSemGrupo, rotuloCategoria, ROTULO_SEM_GRUPO, ordenarCategorias,
    precoNumerico, prepararCatalogo, buscar, ordenar, consultar, opcoesMarca, mensagemWhatsProduto, osa
  };
});
