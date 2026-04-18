/**
 * Sync de produtos — MR4 Distribuidora
 * Busca todos os produtos do GestãoClick e salva em data/produtos.json
 * Rodado pelo GitHub Actions a cada 30 minutos
 */

const fs   = require('fs');
const path = require('path');

const ACCESS_TOKEN  = process.env.GC_ACCESS_TOKEN;
const SECRET_TOKEN  = process.env.GC_SECRET_ACCESS_TOKEN;
const API_BASE      = 'https://api.gestaoclick.com';
const OUTPUT_PATH   = path.join(__dirname, '../data/produtos.json');
const LIMITE        = 100;

async function fetchGC(url) {
  const res = await fetch(url, {
    headers: {
      'access-token': ACCESS_TOKEN,
      'secret-access-token': SECRET_TOKEN,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Erro ${res.status} em ${url}`);
  return res.json();
}

function extraiMarca(p) {
  // Atributos do GestãoClick: [{atributo: {descricao, conteudo}}]
  const atribs = p.atributos || [];
  if (Array.isArray(atribs)) {
    const m = atribs.find(a => a.atributo && /^marca$/i.test((a.atributo.descricao || '').trim()));
    if (m) return (m.atributo.conteudo || '').trim();
  }
  return '';
}

function normalizaProdutos(lista) {
  return lista.map(p => {
    const valores = p.valores || [];
    const preco   = valores.length > 0 ? (valores[0].valor_venda || 0) : 0;
    const fotos   = p.fotos || [];
    const img     = fotos.length > 0 ? fotos[0] : '';
    return {
      id:       p.id || p.codigo_interno,
      ref:      p.codigo_interno || p.codigo || '—',
      name:     p.nome || '—',
      category: p.nome_grupo || p.grupo || p.categoria || 'Geral',
      brand:    extraiMarca(p),
      price:    formatPrice(preco),
      stock:    Number(p.estoque || 0),
      img:      img,
      desc:     p.descricao || p.observacoes || '',
    };
  });
}

function formatPrice(valor) {
  if (!valor || valor === 0) return 'Sob consulta';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor));
}

async function sync() {
  console.log('🔄 Iniciando sync de produtos...');

  // Primeira página
  const primeira = await fetchGC(`${API_BASE}/produtos?pagina=1&limite=${LIMITE}`);

  const meta      = primeira.meta || {};
  const totalPags = Number(meta.total_paginas) || 1;
  let todos       = normalizaProdutos(primeira.data || []);

  console.log(`📦 Total de páginas: ${totalPags}`);

  // Demais páginas em paralelo
  if (totalPags > 1) {
    const promises = [];
    for (let p = 2; p <= totalPags; p++) {
      promises.push(
        fetchGC(`${API_BASE}/produtos?pagina=${p}&limite=${LIMITE}`)
          .then(d => normalizaProdutos(d.data || []))
          .catch(e => { console.warn(`Página ${p} falhou:`, e.message); return []; })
      );
    }
    const restante = await Promise.all(promises);
    restante.forEach(lista => { todos = todos.concat(lista); });
  }

  // Só produtos com estoque
  const comEstoque = todos.filter(p => p.stock > 0);

  // Ordem de categorias definida pela MR4 (apóstrofo curvo exato do GestãoClick)
  const ORDEM_CATEGORIAS = [
    "Led\u2019s interno/externo", "Lâmpada de led", "Lâmpada de led ",
    "Lâmpadas Halógenas", "Câmera", "Multimídia", "Rádio",
    "Sensor estacionamento", "Alto-Falantes", "Chave", "Farol de milha",
    "Fusíveis", "Terminais", "Chicotes", "Soquetes", "Antenas",
    "Palheta", "Bateria", "Travas", "Diversos", "PRODUTOS SEM GRUPO", "Moldura", "Geral",
  ];
  const normCat = s => (s||'').trim().toLowerCase().replace(/[\u2018\u2019\u02bc']/g, "'");
  const CATS_LED = ["lâmpada de led", "led's interno/externo"];
  const prioridade = cat => {
    const nc = normCat(cat);
    const idx = ORDEM_CATEGORIAS.findIndex(c => normCat(c) === nc);
    return idx >= 0 ? idx : ORDEM_CATEGORIAS.length - 3;
  };
  const ENCAIXE_ORDER = ['H1','H3','H4','H7','H8','H11','H16','H27','HB3','HB4','D1','D2','D3','D4','D5','T10','T15','T20','T5'];
  const encaixePrio = nome => {
    const n = (nome||'').toUpperCase();
    for (let i = 0; i < ENCAIXE_ORDER.length; i++) {
      if (n.includes(' '+ENCAIXE_ORDER[i]+' ') || n.includes(' '+ENCAIXE_ORDER[i]+'/') || n.endsWith(' '+ENCAIXE_ORDER[i])) return i;
    }
    return 999;
  };
  const precoNum = p => {
    const s = (p.price||'').replace(/[^\d,]/g,'').replace(',','.');
    return parseFloat(s)||0;
  };
  comEstoque.sort((a, b) => {
    const pa = prioridade(a.category), pb = prioridade(b.category);
    if (pa !== pb) return pa - pb;
    // LEDs: encaixe → preço crescente
    if (CATS_LED.includes(normCat(a.category))) {
      const ea = encaixePrio(a.name), eb = encaixePrio(b.name);
      if (ea !== eb) return ea - eb;
      return precoNum(a) - precoNum(b);
    }
    // Outros: marca → encaixe → nome
    const ba = (a.brand||'').toLowerCase(), bb = (b.brand||'').toLowerCase();
    if (ba !== bb) return ba < bb ? -1 : 1;
    const ea = encaixePrio(a.name), eb = encaixePrio(b.name);
    if (ea !== eb) return ea - eb;
    return (a.name||'').localeCompare(b.name||'', 'pt-BR');
  });

  const output = {
    produtos:    comEstoque,
    total:       comEstoque.length,
    atualizado:  new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output), 'utf8');
  console.log(`✅ Sync concluído: ${comEstoque.length} produtos salvos em data/produtos.json`);
}

sync().catch(err => {
  console.error('❌ Erro no sync:', err.message);
  process.exit(1);
});
