'use strict';
/**
 * Fonte ÚNICA dos dados institucionais da MR4 (Fase Entidade, 03/10/2026).
 * Dados fornecidos e confirmados pelo proprietário; prevalecem sobre diretórios externos.
 * Alimenta: rodapé, páginas /sobre/ e /contato/, Schema.org (Organization, PostalAddress, taxID, horários) e o link de WhatsApp institucional.
 * NÃO inventar aqui: CEP, coordenadas, razão social, ano de fundação, redes sociais (sameAs), números de clientes/vendas.
 * Os WhatsApp dos vendedores (js/catalogo-cesta.js) são outro fluxo (pedidos) e não passam por este arquivo.
 */
const ORIGEM = 'https://catalogo.mr4distribuidora.com.br';
const E = {
  origem: ORIGEM,
  nome: 'MR4 Distribuidora',
  razaoSocial: 'MR4 COMERCIO DE PECAS E ACESSORIOS AUTOMOTIVOS LTDA',   // confirmada pelo proprietário (03/10/2026); só onde faz sentido legal/institucional
  cnpj: '38.440.066/0001-75',
  endereco: { rua: 'Rua Ceará, 634', cidade: 'Fortaleza', uf: 'CE', estado: 'Ceará', cep: '60441-842', pais: 'BR', paisNome: 'Brasil' },
  telefone: '(85) 99609-8520',   // decisão do proprietário 03/10/2026: o mesmo número da ficha do Google Business Profile ((85) 9119-4961 foi rejeitado pelo Google como inválido)
  telefoneE164: '+5585996098520',
  whatsappDigitos: '5585996098520',
  email: 'mr4distribuidora@gmail.com',
  horarios: [
    { rotulo: 'Segunda a sexta', dias: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], abre: '08:30', fecha: '17:30' },
    { rotulo: 'Sábado', dias: ['Saturday'], abre: '08:30', fecha: '12:00' }
  ],
  mensagemWhatsapp: 'Olá! Vim pelo catálogo B2B da MR4 Distribuidora e gostaria de falar com o atendimento.',   // institucional: sem dados pessoais nem de pedido
  abrangencia: 'Atendimento para todo o Brasil',   // confirmada pelo proprietário; NÃO implica frete grátis, prazo nacional nem entrega própria
  instagram: 'https://www.instagram.com/mr4distribuidora/',   // perfil aberto e conferido (logo MR4, "Distribuidora de peças e acessórios automotivos · Atacado")
  facebook: 'https://www.facebook.com/p/Mr4distribuidora-100064696208963/',   // página oficial confirmada pelo proprietário; URL canônico real (og:url/canonical do Facebook), página "Mr4distribuidora" (id 100064696208963)
  gbp: 'https://www.google.com/maps?cid=17633794425759222596',   // ficha oficial no Google Business Profile (gerenciada pelo proprietário; mesmo NAP e site; CID = 0xf4b7d29a35a44b44 do lugar "MR4 Distribuidora", Rua Ceará 634) — desambigua a entidade de outras empresas "MR4"
  descricao: 'Distribuidora de acessórios e peças automotivas no atacado, com sede em Fortaleza, Ceará. Catálogo B2B para lojistas e instaladores.',   // mesma afirmação já publicada em /sobre/ (confirmada pelo proprietário)
  paginas: { sobre: '/sobre/', contato: '/contato/', privacidade: '/privacidade/' }
};
E.sameAs = () => [E.instagram, E.facebook, E.gbp];   // só perfis oficiais confirmados (redes sociais + ficha do Google)
E.enderecoLinha = `${E.endereco.rua} — ${E.endereco.cidade}, ${E.endereco.estado}`;
E.enderecoCurto = `${E.endereco.rua} · ${E.endereco.cidade}, ${E.endereco.uf}`;
E.horarioTexto = h => `${h.rotulo}: ${h.abre} às ${h.fecha}`;
E.whatsappUrl = () => `https://wa.me/${E.whatsappDigitos}?text=${encodeURIComponent(E.mensagemWhatsapp)}`;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** rodapé compartilhado (catálogo, produto, institucionais). `atendimento`: inclui selo de sync + botão (precisam do JS do catálogo) */
E.rodape = atendimento => `<footer>
  <div><strong>${esc(E.nome)}</strong> · Atacado B2B · ${esc(E.abrangencia)}</div>
  <div>CNPJ ${esc(E.cnpj)} · ${esc(E.enderecoCurto)} · <a href="${E.paginas.sobre}">Sobre</a> · <a href="${E.paginas.contato}">Contato</a> · <a href="${E.paginas.privacidade}">Privacidade</a></div>${atendimento ? `
  <div class="rodape-dir"><span class="sync-badge" id="syncBadge"></span> <button class="rodape-atend" type="button" id="rodapeAtend">Falar com atendimento</button></div>` : ''}
</footer>`;

/** Schema.org — endereço, horários (em Place, pois openingHoursSpecification não existe em Organization) */
E.schemaEndereco = () => ({ '@type': 'PostalAddress', streetAddress: E.endereco.rua, addressLocality: E.endereco.cidade, addressRegion: E.endereco.uf, postalCode: E.endereco.cep, addressCountry: E.endereco.pais });
E.schemaHorarios = () => E.horarios.map(h => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: h.dias, opens: h.abre, closes: h.fecha }));

module.exports = E;
