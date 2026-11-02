const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar cliente do Supabase com Variáveis de Ambiente
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Função para consultar o Supabase com base na pergunta
async function getRelevantContextFromSupabase(query) {
  try {
    // Pesquisa simples por palavras-chave na coluna conteudo e titulo
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const searchTerm = words.join(' & ');

    // 1. Tentar pesquisa por Full-Text Search do PostgreSQL
    let { data, error } = await supabase
      .from('etpc_knowledge')
      .select('*')
      .textSearch('conteudo', `'${searchTerm}'`, { config: 'portuguese' })
      .limit(2);

    // 2. Se não encontrar resultados, faz uma busca por ILIKE simples
    if ((!data || data.length === 0) && words.length > 0) {
      const { data: fallbackData } = await supabase
        .from('etpc_knowledge')
        .select('*')
        .ilike('conteudo', `%${words[0]}%`)
        .limit(2);
      
      data = fallbackData;
    }

    return data || [];
  } catch (err) {
    console.error("Erro ao consultar o Supabase:", err);
    return [];
  }
}

// Endpoint do Chatbot
app.post('/api/chat', async (req, res) => {
  const { question } = req.body;

  if (!question) {
    return res.status(400).json({ reply: 'A pergunta não pode estar vazia.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ reply: 'Erro de configuração: Chave da API Gemini não definida.' });
  }

  // Buscar dados no Supabase
  const matchedDocs = await getRelevantContextFromSupabase(question);

  let contextText = "";
  let primaryUrl = null;

  if (matchedDocs.length > 0) {
    contextText = matchedDocs.map(doc => `[FONTE: ${doc.url}]\n${doc.conteudo}`).join('\n\n');
    primaryUrl = matchedDocs[0].url;
  } else {
    contextText = "Nenhuma informação relevante encontrada no site da ETPC.";
  }

  // System Prompt estrito
  const systemPrompt = `És o assistente virtual oficial da ETPC (Escola Profissional de Carvalhos). 

REGRAS OBRIGATÓRIAS:
1. Responde APENAS utilizando a informação presente no [CONTEXTO ETPC] abaixo.
2. Se a informação NÃO constar no contexto, responde exatamente: "Lamento, mas não disponho de informação suficiente no site da ETPC para responder a essa questão."
3. Recusa educadamente responder a perguntas sobre assuntos sem relação com a ETPC (ex: futebol, receitas, política).
4. NUNCA inventes factos ou dados.

[CONTEXTO ETPC]:
${contextText}

[PERGUNTA]:
${question}`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }]
      })
    });

    if (!response.ok) throw new Error(`Status ${response.status}`);

    const data = await response.json();
    const botReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Erro ao processar resposta.";

    return res.json({
      reply: botReply,
      sourceUrl: primaryUrl
    });

  } catch (error) {
    console.error("Erro na API da IA:", error);
    return res.status(503).json({
      reply: "O assistente está temporariamente indisponível. Por favor, tente mais tarde.",
      sourceUrl: null
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor a correr na porta ${PORT}`));
