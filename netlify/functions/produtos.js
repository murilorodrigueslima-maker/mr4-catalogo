// netlify/functions/produtos.js
// Esta função roda no servidor do Netlify — os tokens ficam protegidos aqui.
// Os valores vêm das variáveis de ambiente configuradas no painel do Netlivo.

const ACCESS_TOKEN        = process.env.GC_ACCESS_TOKEN;
const SECRET_ACCESS_TOKEN = process.env.GC_SECRET_ACCESS_TOKEN;
const API_BASE            = 'https://api.gestaoclick.com';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  // Suporte a CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  try {
    const params = event.queryStringParameters || {};
    const pagina    = params.pagina    || 1;
    const busca     = params.busca     || '';
    const categoria = params.categoria || '';

    // Monta a URL de produtos com paginação e filtros opcionais
    let url = `${API_BASE}/produtos?pagina=${pagina}&limite=100`;
    if (busca)     url += `&nome=${encodeURIComponent(busca)}`;
    if (categoria) url += `&categoria=${encodeURIComponent(categoria)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'access-token':        ACCESS_TOKEN,
        'secret-access-token': SECRET_ACCESS_TOKEN,
        'Content-Type':        'application/json',
      },
    });

    if (!response.ok) {
      const erro = await response.text();
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ erro: `Erro na API GestãoClick: ${response.status}`, detalhe: erro }),
      };
    }

    const data = await response.json();

    // Normaliza os campos para o catálogo (ajuste os nomes se necessário após testar)
    const produtos = (data.data || data.produtos || data || []).map(p => ({
      id:        p.id        || p.codigo_interno,
      ref:       p.codigo    || p.codigo_interno || p.referencia || '—',
      name:      p.nome      || p.descricao      || '—',
      category:  p.categoria || p.grupo          || 'Acessórios',
      price:     formatPrice(p.preco_venda       || p.valor      || 0),
      stock:     p.estoque   || p.quantidade_estoque || 0,
      img:       p.foto      || p.imagem         || '',
      desc:      p.descricao_completa || p.observacoes || '',
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        produtos,
        total:   data.total   || produtos.length,
        paginas: data.paginas || 1,
        pagina:  Number(pagina),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ erro: 'Erro interno na função', detalhe: err.message }),
    };
  }
};

function formatPrice(valor) {
  if (!valor || valor === 0) return 'Sob consulta';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(valor));
}
