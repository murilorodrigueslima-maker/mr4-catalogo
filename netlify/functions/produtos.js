const ACCESS_TOKEN        = process.env.GC_ACCESS_TOKEN;
const SECRET_ACCESS_TOKEN = process.env.GC_SECRET_ACCESS_TOKEN;
const API_BASE            = 'https://api.gestaoclick.com';

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  try {
    const params    = event.queryStringParameters || {};
    const busca     = params.busca     || '';
    const categoria = params.categoria || '';
    const LIMITE    = 100;
    const primeiraRes = await fetchGC(buildUrl(busca, categoria, 1, LIMITE));
    if (!primeiraRes.ok) {
      const erro = await primeiraRes.text();
      return { statusCode: primeiraRes.status, headers, body: JSON.stringify({ erro: `Erro: ${primeiraRes.status}`, detalhe: erro }) };
    }
    const primeiraData = await primeiraRes.json();
    const meta         = primeiraData.meta || {};
    const totalPaginas = Number(meta.total_paginas) || 1;
    let todosProdutos  = normalizaProdutos(primeiraData.data || []);
    if (totalPaginas > 1) {
      const promises = [];
      for (let p = 2; p <= totalPaginas; p++) {
        promises.push(
          fetchGC(buildUrl(busca, categoria, p, LIMITE))
            .then(r => r.json())
            .then(d => normalizaProdutos(d.data || []))
            .catch(() => [])
        );
      }
      const restante = await Promise.all(promises);
      restante.forEach(lista => { todosProdutos = todosProdutos.concat(lista); });
    }

    // Filtra apenas produtos com estoque maior que zero
    todosProdutos = todosProdutos.filter(p => p.stock > 0);

    return { statusCode: 200, headers, body: JSON.stringify({ produtos: todosProdutos, total: todosProdutos.length, paginas: 1, pagina: 1 }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ erro: 'Erro interno', detalhe: err.message }) };
  }
};
function buildUrl(busca, categoria, pagina, limite) {
  let url = `${API_BASE}/produtos?pagina=${pagina}&limite=${limite}`;
  if (busca) url += `&nome=${encodeURIComponent(busca)}`;
  if (categoria) url += `&categoria=${encodeURIComponent(categoria)}`;
  return url;
}
function fetchGC(url) {
  return fetch(url, { method: 'GET', headers: { 'access-token': ACCESS_TOKEN, 'secret-access-token': SECRET_ACCESS_TOKEN, 'Content-Type': 'application/json' } });
}
function normalizaProdutos(lista) {
  return lista.map(p => ({
    id:       p.id || p.codigo_interno,
    ref:      p.codigo_interno || p.codigo || '—',
    name:     p.nome || '—',
    category: p.categoria || p.grupo || 'Acessórios',
    price:    formatPrice(p.preco_venda || p.valor || 0),
    stock:    Number(p.estoque || p.quantidade_estoque || 0),
    img:      p.foto || p.imagem || '',
    desc:     p.descricao_completa || p.observacoes || '',
  }));
}
function formatPrice(valor) {
  if (!valor || valor === 0) return 'Sob consulta';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor));
}
