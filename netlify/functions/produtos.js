const ACCESS_TOKEN        = process.env.GC_ACCESS_TOKEN;
const SECRET_ACCESS_TOKEN = process.env.GC_SECRET_ACCESS_TOKEN;
const API_BASE            = 'https://api.gestaoclick.com';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  try {
    const params    = event.queryStringParameters || {};
    const busca     = params.busca     || '';
    const categoria = params.categoria || '';
    const LIMITE    = 100;

    // Busca primeira página para saber o total
    const primeiraRes = await fetchGC(buildUrl(busca, categoria, 1, LIMITE));
    if (!primeiraRes.ok) {
      const erro = await primeiraRes.text();
      return { statusCode: primeiraRes.status, headers, body: JSON.stringify({ erro: `Erro na API: ${primeiraRes.status}`, detalhe: erro }) };
    }

    const primeiraData  = await primeiraRes.json();
    const totalProdutos = Number(primeiraData.total) || 0;
    const totalPaginas  = totalProdutos > 0 ? Math.ceil(totalProdutos / LIMITE) : 1;

    let todosProdutos = normalizaProdutos(primeiraData);

    // Busca páginas restantes em paralelo
    if (totalPaginas > 1) {
      const promises = [];
      for (let p = 2; p <= totalPaginas; p++) {
        promises.push(
          fetchGC(buildUrl(busca, categoria, p, LIMITE))
            .then(r => r.json())
            .then(d => normalizaProdutos(d))
            .catch(() => [])
        );
      }
      const restante = await Promise.all(promises);
      restante.forEach(lista => { todosProdutos = todosProdutos.concat(lista); });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        produtos: todosProdutos,
        total:    todosProdutos.length,
        paginas:  1,
        pagina:   1,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ erro: 'Erro interno', detalhe: err.message }),
    };
  }
};

function buildUrl(busca, categoria, pagina, limite) {
  let url = `${API_BASE}/produtos?pagina=${pagina}&limite=${limite}`;
  if (busca)     url += `&nome=${encodeURIComponent(busca)}`;
  if (categoria) url += `&categoria=${encodeURIComponent(categoria)}`;
  return url;
}

function fetchGC(url) {
  return fetch(url, {
    method: 'GET',
    headers: {
      'access-token':        ACCESS_TOKEN,
      'secret-access-token': SECRET_ACCESS_TOKEN,
      'Content-Type':        'application/json',
    },
  });
}

function normalizaProdutos(data) {
  return (data.data || data.produtos || data || []).map(p => ({
    id:       p.id        || p.codigo_interno,
    ref:      p.codigo    || p.codigo_interno || p.referencia || '—',
    name:     p.nome      || p.descricao      || '—',
    category: p.categoria || p.grupo          || 'Acessórios',
    price:    formatPrice(p.preco_venda       || p.valor      || 0),
    stock:    p.estoque   || p.quantidade_estoque || 0,
    img:      p.foto      || p.imagem         || '',
    desc:     p.descricao_completa || p.observacoes || '',
  }));
}

function formatPrice(valor) {
  if (!valor || valor === 0) return 'Sob consulta';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(valor));
}
