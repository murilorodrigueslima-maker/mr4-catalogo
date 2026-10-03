'use strict';
/**
 * Páginas institucionais estáticas (/sobre/, /contato/). Só afirma o que o proprietário confirmou (scripts/entidade.js)
 * e o que o próprio site já faz. NÃO inventar: fundação, anos de mercado, nº de clientes, marcas oficiais, certificações, cobertura.
 * Texto 100 % estático (sem números do feed) ⇒ não muda a cada sync.
 */
const E = require('./entidade.js');
const LD = require('./jsonld.js');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ORIGEM = E.origem;

const PAGINAS = {
  sobre: {
    caminho: 'sobre/index.html', url: ORIGEM + E.paginas.sobre, tipo: 'AboutPage', nome: 'Sobre a MR4 Distribuidora',
    title: 'Sobre a MR4 Distribuidora | Catálogo B2B de acessórios automotivos',
    description: 'A MR4 Distribuidora é distribuidora de acessórios e peças automotivas no atacado, em Fortaleza (CE). Veja dados da empresa, endereço, horário e contato.',
    h1: 'Sobre a MR4 Distribuidora'
  },
  contato: {
    caminho: 'contato/index.html', url: ORIGEM + E.paginas.contato, tipo: 'ContactPage', nome: 'Contato',
    title: 'Contato | MR4 Distribuidora — Fortaleza, CE',
    description: 'Contato da MR4 Distribuidora: Rua Ceará, 634, Fortaleza (CE). WhatsApp e telefone (85) 9119-4961, e-mail e horário de atendimento.',
    h1: 'Contato — MR4 Distribuidora'
  },
  privacidade: {
    caminho: 'privacidade/index.html', url: ORIGEM + E.paginas.privacidade, tipo: 'WebPage', nome: 'Privacidade',
    title: 'Privacidade | MR4 Distribuidora',
    description: 'Como o catálogo B2B da MR4 Distribuidora trata informações: dados no navegador, pedido pelo WhatsApp, recursos externos e pedidos de acesso, correção ou exclusão.',
    h1: 'Privacidade'
  }
};

const dados = () => `<dl class="inst-dados">
<dt>Nome público</dt><dd>${esc(E.nome)}</dd>
<dt>Razão social</dt><dd>${esc(E.razaoSocial)}</dd>
<dt>CNPJ</dt><dd>${esc(E.cnpj)}</dd>
<dt>Endereço</dt><dd><address style="font-style:normal">${esc(E.endereco.rua)}<br>${esc(E.endereco.cidade)} — ${esc(E.endereco.estado)}<br>CEP ${esc(E.endereco.cep)}<br>${esc(E.endereco.paisNome)}</address></dd>
<dt>Telefone / WhatsApp</dt><dd><a href="tel:${E.telefoneE164}">${esc(E.telefone)}</a></dd>
<dt>E-mail</dt><dd><a href="mailto:${esc(E.email)}">${esc(E.email)}</a></dd>
<dt>Horário</dt><dd>${E.horarios.map(h => esc(E.horarioTexto(h))).join('<br>')}</dd>
</dl>`;
const breadcrumb = nome => `<nav class="bc" aria-label="Você está em"><a href="/">Catálogo</a> › <span aria-current="page">${esc(nome)}</span></nav>`;
const ZAP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';

function conteudoSobre() {
  const p = PAGINAS.sobre;
  return `${breadcrumb(p.nome)}
<h1>${esc(p.h1)}</h1>
<h2>O que é a MR4 Distribuidora?</h2>
<p>A MR4 Distribuidora (${esc(E.razaoSocial)}, CNPJ ${esc(E.cnpj)}) é uma distribuidora de acessórios e peças automotivas no atacado, com sede em Fortaleza, Ceará. Este site é o catálogo B2B da empresa: nele o comprador consulta os produtos, vê código, preço e estoque e monta o pedido.</p>
<h2>Quem a MR4 atende?</h2>
<p>A MR4 atua no segmento B2B e atende lojistas e instaladores. ${esc(E.abrangencia)}: clientes de qualquer estado podem fazer pedidos pelo catálogo.</p>
<h2>Como acessar o catálogo?</h2>
<p>O catálogo está na <a href="/">página inicial</a>. Os produtos podem ser buscados por nome, código, marca ou categoria. Depois de montar o pedido, ele é enviado pelo WhatsApp a um dos vendedores da MR4; valores e disponibilidade ficam sujeitos à confirmação no atendimento.</p>
<h2>Onde fica a MR4 Distribuidora?</h2>
<p>${esc(E.endereco.rua)}, ${esc(E.endereco.cidade)}, ${esc(E.endereco.estado)}, CEP ${esc(E.endereco.cep)}, ${esc(E.endereco.paisNome)}.</p>
<h2>Qual o horário de atendimento e como entrar em contato?</h2>
<p>${E.horarios.map(h => esc(E.horarioTexto(h))).join('; ')}. Telefone e WhatsApp: ${esc(E.telefone)}. E-mail: <a href="mailto:${esc(E.email)}">${esc(E.email)}</a>. A MR4 também está no <a href="${esc(E.instagram)}" rel="me noopener">Instagram</a>. Veja todos os canais na página de <a href="${E.paginas.contato}">contato</a>.</p>
<h2>Dados da empresa</h2>
${dados()}`;
}
function conteudoContato() {
  const p = PAGINAS.contato;
  return `${breadcrumb(p.nome)}
<h1>${esc(p.h1)}</h1>
<p>Fale com a MR4 Distribuidora pelos canais abaixo. Para consultar produtos e montar um pedido, use o <a href="/">catálogo</a>.</p>
${dados()}
<div class="inst-acoes">
<a class="inst-btn" href="${esc(E.whatsappUrl())}" target="_blank" rel="noopener noreferrer">${ZAP} Falar no WhatsApp</a>
<a class="inst-btn sec" href="/">Ir ao catálogo</a>
</div>
<p>Sobre a empresa, veja a página <a href="${E.paginas.sobre}">Sobre a MR4 Distribuidora</a>.</p>`;
}

function conteudoPrivacidade() {
  const p = PAGINAS.privacidade, mail = `<a href="mailto:${esc(E.email)}">${esc(E.email)}</a>`;
  return `${breadcrumb(p.nome)}
<h1>${esc(p.h1)}</h1>
<p>Esta página descreve, de forma simples, como o catálogo B2B da ${esc(E.nome)} funciona em relação a informações do visitante. Ela reflete o funcionamento atual do site e não é aconselhamento jurídico.</p>
<h2>O que você pode fornecer</h2>
<p>O catálogo não tem cadastro, login nem formulário que envie dados aos servidores da MR4. Você pode digitar termos de busca (usados apenas no seu navegador para filtrar os produtos) e, ao montar um pedido, o seu nome ou o nome da sua empresa no campo do pedido, que é opcional.</p>
<h2>Armazenamento local no navegador</h2>
<p>Para o catálogo funcionar, o seu navegador guarda no próprio dispositivo: o pedido em montagem (produtos e quantidades), a preferência de modo de exibição, o vendedor escolhido por último e, durante a sessão, a busca, os filtros e a posição da página para você voltar de um produto sem perder o lugar. A finalidade é só manter o seu pedido e a sua navegação. Essas informações ficam no seu dispositivo e não são enviadas à MR4 por esse mecanismo. Para apagá-las, use “Limpar pedido” no catálogo ou limpe os dados do site nas configurações do navegador.</p>
<h2>Pedido pelo WhatsApp</h2>
<p>Ao usar “Enviar pedido pelo WhatsApp”, o catálogo abre o WhatsApp com uma mensagem já preenchida para o vendedor escolhido, contendo o nome ou a empresa informado (se houver), os produtos com referência e as quantidades. Nada é enviado até você confirmar o envio no próprio WhatsApp. A partir daí, a conversa passa a ocorrer pelo WhatsApp e a MR4 recebe a mensagem para atender o pedido. O botão de WhatsApp da página de <a href="${E.paginas.contato}">contato</a> abre uma conversa com o número institucional e uma mensagem inicial padrão, sem dados pessoais.</p>
<h2>Recursos externos</h2>
<p>As fotos dos produtos são carregadas de um serviço de armazenamento externo (Amazon S3); ao exibir uma foto, o seu navegador faz uma requisição a esse serviço. O site é hospedado no GitHub Pages. As fontes, os estilos e os scripts do catálogo são servidos pelo próprio site.</p>
<h2>Cookies e análise de acesso</h2>
<p>O código do catálogo não define cookies e, atualmente, não usa ferramentas de análise de acesso (Analytics), pixels de publicidade nem rastreamento para anúncios. Se isso mudar, esta página será atualizada.</p>
<h2>Solicitações sobre dados pessoais</h2>
<p>Pedidos de acesso, correção ou exclusão de dados pessoais podem ser feitos pelo e-mail ${mail}. Esse também é o canal para dúvidas sobre esta página.</p>
<h2>Dados da empresa</h2>
<p>${esc(E.nome)} — ${esc(E.razaoSocial)}, CNPJ ${esc(E.cnpj)}. ${esc(E.enderecoLinha)}, CEP ${esc(E.endereco.cep)}.</p>
<p>Última atualização: outubro de 2026.</p>`;
}

/** { 'sobre/index.html': html, 'contato/index.html': html } — `head(o)` e `rodape` vêm do gerador */
function gerar(modelo, head) {
  const out = {};
  [['sobre', conteudoSobre], ['contato', conteudoContato], ['privacidade', conteudoPrivacidade]].forEach(([k, f]) => {
    const p = PAGINAS[k];
    out[p.caminho] = modelo
      .replace('{{HEAD}}', () => head({ title: p.title, description: p.description, canonical: p.url, jsonld: LD.tag(LD.paginaInstitucional(p.tipo, p.url, p.nome, p.description)) }))
      .replace('{{CONTEUDO}}', () => f())
      .replace('{{RODAPE}}', () => E.rodape(false));
  });
  return out;
}
module.exports = { PAGINAS, gerar, conteudoSobre, conteudoContato, conteudoPrivacidade };
