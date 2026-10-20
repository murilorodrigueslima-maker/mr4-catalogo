'use strict';
/** Cliente mínimo da API do GitHub (fetch injetável; o token só vai no cabeçalho Authorization e nunca é registrado). Usado SOMENTE pelos vigias. */
function criarGithub({ token, repo, fetchFn = fetch, api = 'https://api.github.com', timeoutMs = 20000 } = {}) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(String(repo || ''))) throw new Error('GITHUB_CONFIG_INVALIDA');
  const chamar = async (metodo, caminho, corpo) => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetchFn(`${api}${caminho}`, { method: metodo, signal: ac.signal, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'mr4-catalogo-vigia' }, ...(corpo ? { body: JSON.stringify(corpo) } : {}) });
      if (r.status === 204) return null;
      let j = null; try { j = await r.json(); } catch (e) { j = null; }
      if (!r.ok) { const e = new Error(`GITHUB_HTTP_${r.status}`); e.http = r.status; throw e; }          // sem corpo/URL na mensagem
      return j;
    } finally { clearTimeout(t); }
  };
  const R = `/repos/${repo}`;
  return {
    runsConcluidos: async (workflow, n = 30) => ((await chamar('GET', `${R}/actions/workflows/${workflow}/runs?status=completed&per_page=${n}`)) || {}).workflow_runs || [],
    jobsDoRun: async runId => ((await chamar('GET', `${R}/actions/runs/${runId}/jobs?per_page=30`)) || {}).jobs || [],
    issuesAbertas: async label => (await chamar('GET', `${R}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=50`)) || [],
    garantirLabel: async (nome, cor, descricao) => { try { await chamar('POST', `${R}/labels`, { name: nome, color: cor, description: descricao }); } catch (e) { if (e.http !== 422) throw e; } },
    criarIssue: async ({ title, body, labels }) => chamar('POST', `${R}/issues`, { title, body, labels }),
    atualizarIssue: async (numero, campos) => chamar('PATCH', `${R}/issues/${numero}`, campos),
    comentar: async (numero, body) => chamar('POST', `${R}/issues/${numero}/comments`, { body }),
  };
}
module.exports = { criarGithub };
