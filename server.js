const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Carregar a base de conhecimento local da ETPC
const knowledgeBase = JSON.parse(fs.readFileSync(path.join(__dirname, 'knowledge.json'), 'utf8'));

// Função para filtrar conteúdos relevantes da base de dados (Simple RAG)
function getRelevantContext(query) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  let results = [];

  knowledgeBase.forEach(item => {
    const textToSearch = (item.titulo + " " + item.conteudo + " " + item.categoria).toLowerCase();
    let score = 0;
    words.forEach(word => {
      if (textToSearch.includes(word)) score += 1;
    });
    if (score > 0) {
      results.push({ item, score });
    }
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 2).map(r => r.item);
}

// Endpoint do Chatbot
app.post('/api/chat', async (req, res) => {
  const { question } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'A pergunta não pode estar vazia.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ 
      reply: 'Erro de configuração no servidor: Chave da API da IA não encontrada.',
      sourceUrl: null 
    });
  }

  // 1. Pesquisar informação na base de dados
  const matchedDocs = getRelevantContext(question);

  let contextText = "";
  let primaryUrl = null;

  if (matchedDocs.length > 0) {
    contextText = matchedDocs.map(doc => `[FONTE: ${doc.url}]\n${doc.conteudo}`).join('\n\n');
    primaryUrl = matchedDocs[0].url;
  } else {
    contextText = "Nenhuma informação relevante encontrada no site da ETPC.";
  }

  // 2. Construir o System Prompt com regras rigorosas
  const systemPrompt = `És o assistente virtual oficial da ETPC (Escola Profissional de Carvalhos). 
A tua missão é responder a perguntas de alunos, encarregados de educação e visitantes.

REGRAS OBRIGATÓRIAS:
1. Responde APENAS utilizando a informação explicitamente presente no [CONTEXTO ETPC] abaixo.
2. Se a informação NÃO constar no contexto ou for insuficiente, responde exatamente: "Lamento, mas não disponho de informação suficiente no site da ETPC para responder a essa questão."
3. Se o utilizador perguntar sobre assuntos gerais (ex: futebol, receitas de cozinha, política, jogos, notícias globais), recusa educadamente indicando que apenas podes prestar informações sobre a ETPC.
4. NUNCA inventes dados, prazos, contactos ou cursos que não estejam expressamente escritos no contexto.
5. Mantém um tom profissional, cordial e objetivo em português de Portugal.

[CONTEXTO ETPC]:
${contextText}

[PERGUNTA DO UTILIZADOR]:
${question}`;

  try {
    // 3. Chamada à API da IA (Google Gemini REST API)
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }]
      })
    });

    if (!response.ok) {
      throw new Error(`Erro na API Gemini: ${response.statusText}`);
    }

    const data = await response.json();
    const botReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Não foi possível gerar uma resposta válida.";

    return res.json({
      reply: botReply,
      sourceUrl: primaryUrl
    });

  } catch (error) {
    console.error("Erro na comunicação com a IA:", error);
    return res.status(503).json({
      reply: "O assistente está temporariamente indisponível devido a uma falha de comunicação. Por favor, tente novamente mais tarde.",
      sourceUrl: null
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor a executar em http://localhost:${PORT}`);
});
