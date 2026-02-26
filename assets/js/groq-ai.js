// ================================
// Groq AI Integration para Spendify
// ================================

// A chave do Groq agora fica segura no backend
// O frontend chama o endpoint /api/ai/chat que faz proxy para a API Groq

class GroqAI {
  constructor() {
    this.conversationHistory = [];
    this.isLoading = false;
    
    // Detecta ambiente local (localhost ou 127.0.0.1)
    const isLocal = window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1' ||
                    window.location.hostname === '';
    
    this.apiEndpoint = isLocal 
      ? 'http://localhost:3001/ai/chat'
      : '/api/ai/chat';
      
    this.systemPrompt = `Você é um assistente financeiro especializado em controle de gastos e economia de dinheiro. 
Sua função é ajudar usuários do Spendify a:
1. Analisar seus gastos e identificar padrões
2. Dar dicas práticas para economizar dinheiro
3. Sugerir categorias e limites de gastos
4. Motivar o usuário a alcançar metas financeiras
5. Explicar conceitos de educação financeira

IMPORTANTE: 
- Sempre seja empático e motivador
- Dê respostas em português brasileiro
- Use números e dados quando relevante
- Forneça dicas acionáveis e práticas
- Se o usuário fornecer dados financeiros (renda, despesas), use-os para personalizar as recomendações`;
  }

  /**
   * Envia uma mensagem para a IA via backend
   * @param {string} userMessage - Mensagem do usuário
   * @param {object} financialData - Dados financeiros do usuário (opcional)
   * @returns {Promise<string>} - Resposta da IA
   */
  async sendMessage(userMessage, financialData = null) {
    if (this.isLoading) {
      throw new Error("Aguarde a resposta anterior.");
    }

    if (!userMessage.trim()) {
      throw new Error("Mensagem não pode estar vazia.");
    }

    this.isLoading = true;

    try {
      // Monta o contexto financeiro se disponível
      let contextMessage = userMessage;
      if (financialData) {
        contextMessage = this._buildContextMessage(userMessage, financialData);
      }

      // Adiciona mensagem do usuário ao histórico
      this.conversationHistory.push({
        role: "user",
        content: contextMessage,
      });

      // Prepara mensagens para enviar ao backend
      const messages = [
        {
          role: "system",
          content: this.systemPrompt,
        },
        ...this.conversationHistory,
      ];

      // Pega o UID do usuário autenticado
      const user = firebase.auth().currentUser;
      if (!user) {
        throw new Error("Você precisa estar logado para usar a IA");
      }

      // Obtém o token de autenticação do Firebase
      const idToken = await user.getIdToken();

      // Chama o backend (que fará a chamada segura para o Groq)
      const response = await fetch(this.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          messages: messages,
          model: "llama-3.3-70b-versatile",
          uid: user.uid // Para dev.js que não tem verifyFirebaseToken
        }),
      });

      if (!response.ok) {
        let errorData = {};
        const contentType = response.headers.get("content-type");
        
        // Só tenta parsear JSON se a resposta tiver content-type correto
        if (contentType && contentType.includes("application/json")) {
          try {
            errorData = await response.json();
          } catch (e) {
            console.warn("Erro ao parsear JSON de erro:", e);
          }
        }
        
        if (response.status === 403) {
          throw new Error("Você precisa contratar a IA para usar este recurso");
        }
        
        if (response.status === 429) {
          throw new Error("Limite de mensagens atingido. Aguarde um momento.");
        }
        
        throw new Error(errorData.message || `Erro ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const assistantMessage = data.response || "Desculpe, não consegui processar sua solicitação.";

      // Adiciona resposta do assistente ao histórico
      this.conversationHistory.push({
        role: "assistant",
        content: assistantMessage,
      });

      // Mantém apenas as últimas 10 mensagens para economizar tokens
      if (this.conversationHistory.length > 20) {
        this.conversationHistory = this.conversationHistory.slice(-20);
      }

      return assistantMessage;
    } catch (error) {
      console.error("Erro ao comunicar com a IA:", error);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Cria um contexto de mensagem com dados financeiros
   * @private
   */
  _buildContextMessage(userMessage, financialData) {
    let context = `[Contexto financeiro do usuário]\n`;

    if (financialData.renda) {
      context += `- Renda mensal: R$ ${financialData.renda}\n`;
    }
    if (financialData.totalDespesas) {
      context += `- Total de despesas: R$ ${financialData.totalDespesas}\n`;
    }
    if (financialData.saldo) {
      context += `- Saldo: R$ ${financialData.saldo}\n`;
    }
    if (financialData.principais_categorias) {
      context += `- Principais categorias de gasto: ${financialData.principais_categorias.join(", ")}\n`;
    }
    if (financialData.meta_economia) {
      context += `- Meta de economia: R$ ${financialData.meta_economia}\n`;
    }
    if (financialData.mes) {
      context += `- Período: ${financialData.mes}\n`;
    }
    if (financialData.tendencias) {
      context += `- Tendências: ${financialData.tendencias}\n`;
    }
    
    // Adiciona detalhes das despesas se disponíveis
    if (financialData.despesas_detalhadas && financialData.despesas_detalhadas.length > 0) {
      context += `\n[Despesas Detalhadas]\n`;
      financialData.despesas_detalhadas.forEach((despesa, index) => {
        context += `${index + 1}. ${despesa.nome} - ${despesa.categoria}\n`;
        context += `   Valor: R$ ${despesa.valor}\n`;
        context += `   Vencimento: ${despesa.data}\n`;
        context += `   Status: ${despesa.pago ? "Pago" : "Pendente"}\n`;
      });
    }

    context += `\n[Pergunta do usuário]\n${userMessage}`;
    return context;
  }

  /**
   * Limpa o histórico de conversa
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * Obtém o histórico de conversa
   */
  getHistory() {
    return [...this.conversationHistory];
  }

  /**
   * Envia uma pergunta rápida (para análises curtas)
   */
  async quickAnalysis(topic, financialData) {
    const prompt = `Faça uma análise rápida (em 2-3 parágrafos) sobre: ${topic}`;
    return this.sendMessage(prompt, financialData);
  }
}

// Instância global do Groq AI
const groqAI = new GroqAI();
