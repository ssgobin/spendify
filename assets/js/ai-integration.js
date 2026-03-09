// ================================
// Integração Groq AI com Spendify
// ================================

let currentAIMonth = null;
let userHasPurchasedAI = false;
let aiModuleInitialized = false;

/**
 * Helper para criar Tab do Bootstrap com fallback
 */
function createBootstrapTab(elementId) {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error(`[AI] Elemento ${elementId} não encontrado`);
    return null;
  }
  
  if (typeof bootstrap !== 'undefined' && bootstrap.Tab) {
    return new bootstrap.Tab(element);
  }
  
  // Fallback: usa atributo data-bs-toggle
  element.click();
  return { show: () => element.click() };
}

/**
 * Verifica se o usuário comprou a IA
 */
async function checkAIPurchaseStatus() {
  try {
    const cur = auth.currentUser;
    if (!cur) return false;

    const userDoc = await db.collection("users").doc(cur.uid).get();
    if (!userDoc.exists) {
      userHasPurchasedAI = false;
      return false;
    }

    const userData = userDoc.data() || {};
    userHasPurchasedAI = userData.aiPurchased === true;
    console.log("Status de IA:", userHasPurchasedAI);
    return userHasPurchasedAI;
  } catch (error) {
    console.error("Erro ao verificar compra de IA:", error);
    return false;
  }
}

/**
 * Inicializa os event listeners da IA
 */
function initAIModule() {
  // Prevenir inicialização duplicada
  if (aiModuleInitialized) {
    console.log("[AI] Módulo já inicializado, pulando...");
    return;
  }
  aiModuleInitialized = true;
  
  const btnAI = document.getElementById("btnAI");
  const btnSendAIMessage = document.getElementById("btnSendAIMessage");
  const aiChatInput = document.getElementById("aiChatInput");
  const btnClearChatHistory = document.getElementById("btnClearChatHistory");
  const btnGetAIAnalysis = document.getElementById("btnGetAIAnalysis");
  const btnContractAI = document.getElementById("btnContractAI");
  const btnCancelAIPurchase = document.getElementById("btnCancelAIPurchase");

  // Abrir IA do menu
  if (btnAI) {
    btnAI.addEventListener("click", async () => {
      // Verifica se tem acesso
      const hasAccess = await checkAIPurchaseStatus();
      showAIView(hasAccess);
      
      // Navega para a aba de IA
      const tab = createBootstrapTab("tab-ia-tab");
      if (tab) tab.show();
      
      if (hasAccess) {
        updateAIFinancialData();
        setTimeout(() => {
          document.getElementById("aiChatInput")?.focus();
        }, 300);
      }
    });
  }

  // Contratar IA
  if (btnContractAI) {
    btnContractAI.addEventListener("click", async () => {
      await createAIPaymentFlow();
    });
  }

  // Cancelar (voltar)
  if (btnCancelAIPurchase) {
    btnCancelAIPurchase.addEventListener("click", () => {
      const tab = createBootstrapTab("tab-visao-tab");
      if (tab) tab.show();
    });
  }

  // Enviar mensagem
  if (btnSendAIMessage) {
    btnSendAIMessage.addEventListener("click", sendAIMessage);
  }

  // Enter para enviar
  if (aiChatInput) {
    aiChatInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendAIMessage();
      }
    });
  }

  // Limpar histórico
  if (btnClearChatHistory) {
    btnClearChatHistory.addEventListener("click", () => {
      if (confirm("Limpar histórico da conversa?")) {
        groqAI.clearHistory();
        document.getElementById("aiChatHistory").innerHTML = "";
        addAIMessage("Conversa limpa! Como posso ajudá-lo com seus gastos?", "assistant");
      }
    });
  }

  // Verificar status quando a aba de IA é acessada
  const tabiaElement = document.getElementById("tab-ia-tab");
  if (tabiaElement) {
    tabiaElement.addEventListener("shown.bs.tab", async () => {
      const hasAccess = await checkAIPurchaseStatus();
      showAIView(hasAccess);
      if (hasAccess) {
        updateAIFinancialData();
      }
    });
  }

  // Análise completa
  if (btnGetAIAnalysis) {
    btnGetAIAnalysis.addEventListener("click", async () => {
      try {
        const financialData = await getAIFinancialData();
        const analysis = await groqAI.quickAnalysis(
          "Faça uma análise detalhada dos meus gastos do mês atual, incluindo principais categorias, tendências e recomendações para economia",
          financialData
        );
        addAIMessage(analysis, "assistant");
      } catch (error) {
        console.error("Erro ao gerar análise:", error);
        addAIMessage(
          "Desculpe, não consegui gerar a análise agora. Tente novamente.",
          "assistant"
        );
      }
    });
  }
}

/**
 * Mostra a view apropriada (compra ou chat)
 */
function showAIView(hasAccess) {
  const notPurchasedView = document.getElementById("aiNotPurchasedView");
  const purchasedView = document.getElementById("aiPurchasedView");

  if (hasAccess) {
    notPurchasedView?.classList.add("d-none");
    purchasedView?.classList.remove("d-none");
  } else {
    notPurchasedView?.classList.remove("d-none");
    purchasedView?.classList.add("d-none");
  }
}

/**
 * Envia mensagem para a IA
 */
async function sendAIMessage() {
  const aiChatInput = document.getElementById("aiChatInput");
  const btnSendAIMessage = document.getElementById("btnSendAIMessage");
  const aiLoadingIndicator = document.getElementById("aiLoadingIndicator");
  const message = aiChatInput.value.trim();

  if (!message) return;

  // Adiciona a mensagem do usuário ao chat
  addAIMessage(message, "user");
  aiChatInput.value = "";
  btnSendAIMessage.disabled = true;
  aiLoadingIndicator.classList.remove("d-none");

  try {
    // Obtem dados financeiros para contexto
    const financialData = await getAIFinancialData();

    // Envia mensagem para Groq
    const response = await groqAI.sendMessage(message, financialData);

    // Adiciona resposta ao chat
    addAIMessage(response, "assistant");
  } catch (error) {
    console.error("Erro ao comunicar com IA:", error);
    addAIMessage(
      `Desculpe, houve um erro: ${error.message || "Tente novamente mais tarde."}`,
      "assistant"
    );
  } finally {
    btnSendAIMessage.disabled = false;
    aiLoadingIndicator.classList.add("d-none");
    aiChatInput.focus();
  }
}

/**
 * Adiciona mensagem ao histórico do chat
 */
function addAIMessage(text, sender = "assistant") {
  const chatHistory = document.getElementById("aiChatHistory");
  const messageDiv = document.createElement("div");

  messageDiv.className = `mb-3 d-flex ${sender === "user" ? "justify-content-end" : "justify-content-start"}`;

  const bubbleClass =
    sender === "user"
      ? "bg-primary text-white"
      : "bg-light border border-secondary text-dark";

  messageDiv.innerHTML = `
    <div class="p-3 rounded-3" style="max-width: 85%; word-wrap: break-word; ${
      sender === "user" ? "background-color: #0d6efd;" : ""
    }">
      ${escapeHtml(text).replace(/\n/g, "<br>")}
    </div>
  `;

  chatHistory.appendChild(messageDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

/**
 * Função rápida para dicas
 */
function aiQuickTip(tip) {
  const aiChatInput = document.getElementById("aiChatInput");
  let prompt = "";

  switch (tip) {
    case "analise":
      prompt =
        "Analise meus gastos do mês e me explique o que vê. Quais foram as principais despesas?";
      break;
    case "economia":
      prompt =
        "Me dê 5 dicas práticas e realistas para economizar mais dinheiro no meu orçamento atual.";
      break;
    case "categoria":
      prompt =
        "Como posso categorizar melhor meus gastos para ter uma visão mais clara do meu dinheiro?";
      break;
    case "metas":
      prompt =
        "Como devo definir e acompanhar metas de economia realistas para o próximo mês?";
      break;
    case "habitos":
      prompt =
        "Que hábitos de gasto alguns especialistas apontam como importantes para mudar?";
      break;
  }

  aiChatInput.value = prompt;
  aiChatInput.focus();
}

/**
 * Obtem dados financeiros para contextualizar a IA
 */
async function getAIFinancialData() {
  const month = document.getElementById("monthPicker")?.value || getMonthString();
  currentAIMonth = month;

  try {
    // Obtem os dados do mês selecionado/atual usando appState global
    const appState = window.appState || { months: {} };
    const monthData = appState.months[month] || {};
    const entries = monthData.entries || [];

    const income = entries
      .filter((e) => e.type === "income")
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    const expense = entries
      .filter((e) => e.type === "expense")
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    const balance = income - expense;

    // Categorias principais
    const categoryMap = {};
    entries.forEach((e) => {
      if (e.type === "expense") {
        const cat = e.category || "Sem categoria";
        categoryMap[cat] = (categoryMap[cat] || 0) + e.amount;
      }
    });

    const topCategories = Object.entries(categoryMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map((e) => e[0]);

    // Lista detalhada das despesas para análise
    const despesas = entries
      .filter((e) => e.type === "expense")
      .map((e) => ({
        nome: e.name || "Sem nome",
        categoria: e.category || "Sem categoria",
        valor: e.amount || 0,
        data: e.due || "",
        pago: e.paid || false
      }));

    return {
      mes: month,
      renda: income,
      totalDespesas: expense,
      saldo: balance,
      principais_categorias: topCategories,
      despesas_detalhadas: despesas,
      meta_economia: appState.config?.goalMonthly || 0,
      tendencias: balance >= 0 ? "Positiva (economizando)" : "Negativa (gastando mais)",
    };
  } catch (error) {
    console.warn("Erro ao obter dados financeiros para IA:", error);
    return {
      mes: month,
      renda: 0,
      totalDespesas: 0,
      saldo: 0,
      principais_categorias: [],
      tendencias: "Sem dados ainda",
    };
  }
}

/**
 * Atualiza os dados financeiros exibidos na IA
 */
async function updateAIFinancialData() {
  try {
    const financialData = await getAIFinancialData();

    document.getElementById("aiSumIncome").textContent = formatCurrency(
      financialData.renda
    );
    document.getElementById("aiSumExpense").textContent = formatCurrency(
      financialData.totalDespesas
    );
    document.getElementById("aiSumBalance").textContent = formatCurrency(
      financialData.saldo
    );

    // Ajusta cor do saldo
    const balanceEl = document.getElementById("aiSumBalance");
    if (financialData.saldo >= 0) {
      balanceEl.classList.remove("text-danger");
      balanceEl.classList.add("text-success");
    } else {
      balanceEl.classList.remove("text-success");
      balanceEl.classList.add("text-danger");
    }
  } catch (error) {
    console.warn("Erro ao atualizar dados de IA:", error);
  }
}

/**
 * Função auxiliar para escapar HTML
 */
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Obtém a string do mês atual no formato YYYY-MM
 */
function getMonthString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Formata valor para moeda brasileira
 */
function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

/**
 * Debounce helper
 */
function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}

/**
 * Cria fluxo de pagamento para a IA
 */
async function createAIPaymentFlow() {
  const cur = auth.currentUser;
  if (!cur) {
    uiAlert({
      title: "Não autenticado",
      text: "Você precisa estar logado para contratar a IA.",
      icon: "warning"
    });
    return;
  }

  // Carrega nome e CPF/CNPJ salvos
  let fullName = cur.displayName || "";
  let cpf = "";

  try {
    const userDoc = await db.collection("users").doc(cur.uid).get();
    if (userDoc.exists) {
      const userData = userDoc.data() || {};
      fullName = userData.name || fullName;
      cpf = userData.document || cpf;
    }
  } catch (e) {
    console.warn("Erro ao carregar dados do usuário:", e);
  }

  // Se não tem nome ou CPF salvo, pede para preencher
  if (!fullName || !cpf) {
    if (window.Swal && Swal.fire) {
      const res = await Swal.fire({
        title: "Dados para pagamento",
        html: `
          <div class="text-start">
            <label class="form-label">Nome Completo</label>
            <input id="nameInput" class="swal2-input" placeholder="Seu nome completo" value="${String(fullName).replace(/"/g, "&quot;")}">
            
            <label class="form-label mt-2">CPF ou CNPJ</label>
            <input id="cpfInput" class="swal2-input" placeholder="000.000.000-00 ou 00.000.000/0000-00" maxlength="18" value="${String(cpf).replace(/"/g, "&quot;")}">
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: "Continuar",
        cancelButtonText: "Cancelar",
        preConfirm: () => {
          const name = document.getElementById("nameInput")?.value?.trim() || "";
          const doc = document.getElementById("cpfInput")?.value?.trim() || "";

          if (!name || name.length < 3) {
            Swal.showValidationMessage("Nome completo é obrigatório (mínimo 3 caracteres)");
            return false;
          }

          if (!doc) {
            Swal.showValidationMessage("CPF/CNPJ é obrigatório");
            return false;
          }

          return { name, doc };
        },
      });

      if (!res.isConfirmed) return;

      fullName = res.value.name;
      cpf = res.value.doc;

      // Salva os dados atualizados no Firebase
      try {
        await db.collection("users").doc(cur.uid).set(
          {
            name: fullName,
            document: cpf,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } catch (e) {
        console.warn("Erro ao atualizar dados:", e);
      }
    }
  }

  // Valida documento
  const cleanDocument = String(cpf).replace(/\D/g, "");
  if (!/^\d{11,14}$/.test(cleanDocument)) {
    await uiAlert({
      title: "Documento inválido",
      text: "Informe um CPF ou CNPJ válido.",
      icon: "warning"
    });
    return;
  }

  const payload = {
    uid: cur.uid,
    type: "ai",
    method: "pix",
    customer: {
      email: cur.email || "",
      name: fullName,
      document: cleanDocument,
    }
  };

  const apiBase = window.SPENDIFY_API_BASE || "/api";
  const token = await cur.getIdToken();

  console.log("[AI Payment] Criando pagamento", {
    uid: payload.uid,
    type: payload.type,
    method: payload.method
  });

  let r;
  try {
    r = await fetch(`${apiBase}/payments/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (networkError) {
    console.error("[AI Payment] Erro de rede:", networkError);
    await uiAlert({
      title: "Falha ao iniciar pagamento",
      text: "Não foi possível conectar ao servidor. Tente novamente.",
      icon: "error"
    });
    return;
  }

  const rawText = await r.text();
  let data = {};

  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (err) {
    console.error("[AI Payment] Resposta não-JSON:", rawText);
    await uiAlert({
      title: "Falha ao iniciar pagamento",
      text: "Servidor retornou uma resposta inválida.",
      icon: "error"
    });
    return;
  }

  if (!r.ok) {
    console.error("[AI Payment] Erro na resposta:", data);
    await uiAlert({
      title: "Falha ao iniciar pagamento",
      text: data.message || data.error || "Tente novamente.",
      icon: "error"
    });
    return;
  }

  console.log("[AI Payment] Dados recebidos:", data);

  // Extrai dados do pagamento
  const qrImg = data.pixQrImage || data.qrCode || data.qr_code || "";
  const pixKey = data.pixKey || data.dict_key || data.pix_key || "";
  const boletoUrl = data.boletoUrl || data.boleto_url || data.pix_url || "";
  const orderId = data.orderId || data.transaction_id || data.reference_id || "";
  const amount = data.amount || 15;
  const method = data.method || "pix";

  console.log("[AI Payment] Exibindo confirmação:", { qrImg: !!qrImg, pixKey: !!pixKey, orderId });

  // Usa SweetAlert2 para exibir o pagamento
  await showAIPaymentSwal({
    qrImg,
    pixKey,
    boletoUrl,
    orderId,
    amount,
    method,
    uid: cur.uid
  });
}

/**
 * Exibe modal de pagamento da IA usando SweetAlert2
 */
async function showAIPaymentSwal({ qrImg, pixKey, boletoUrl, orderId, amount, method, uid }) {
  // Monta HTML do conteúdo
  let htmlContent = `
    <div class="text-center">
      <div class="badge bg-primary mb-3">Assistente IA</div>
      <h5 class="mb-3">R$ ${amount.toFixed(2).replace(".", ",")}</h5>
      <p class="text-muted small mb-4">Order ID: <code>${orderId}</code></p>
  `;

  // Adiciona QR Code se disponível
  if (qrImg && method === "pix") {
    htmlContent += `
      <div class="mb-3">
        <img src="${qrImg}" alt="QR Code PIX" style="max-width: 100%; width: 240px; height: auto; border-radius: 8px; border: 2px solid #e9ecef;">
      </div>
    `;
  }

  // Adiciona chave PIX para copiar
  if (pixKey && method === "pix") {
    htmlContent += `
      <div class="mb-3">
        <label class="form-label small text-muted">Chave PIX (Copia e Cola)</label>
        <div class="input-group">
          <input type="text" class="form-control form-control-sm font-monospace" id="aiPixKeyInput" value="${pixKey}" readonly>
          <button class="btn btn-outline-secondary btn-sm" type="button" id="aiCopyPixBtn">
            📋 Copiar
          </button>
        </div>
      </div>
    `;
  }

  // Adiciona link do boleto se disponível
  if (boletoUrl && method === "boleto") {
    htmlContent += `
      <div class="mb-3">
        <a href="${boletoUrl}" target="_blank" class="btn btn-outline-primary btn-sm w-100">
          📄 Abrir Boleto
        </a>
      </div>
    `;
  }

  htmlContent += `
      <div class="alert alert-info mt-3 mb-0" id="aiPaymentStatus">
        <div class="spinner-border spinner-border-sm me-2" role="status">
          <span class="visually-hidden">Aguardando...</span>
        </div>
        Aguardando confirmação do pagamento...
      </div>
    </div>
  `;

  // Exibe SweetAlert2
  const swalResult = Swal.fire({
    title: '💳 Pagamento PIX',
    html: htmlContent,
    showConfirmButton: false,
    showCancelButton: true,
    cancelButtonText: 'Fechar',
    allowOutsideClick: false,
    didOpen: () => {
      // Adiciona evento de copiar chave PIX
      const copyBtn = document.getElementById("aiCopyPixBtn");
      if (copyBtn && pixKey) {
        copyBtn.addEventListener("click", () => {
          const input = document.getElementById("aiPixKeyInput");
          if (input) {
            input.select();
            navigator.clipboard.writeText(pixKey).then(() => {
              copyBtn.innerHTML = "✅ Copiado!";
              setTimeout(() => {
                copyBtn.innerHTML = "📋 Copiar";
              }, 2000);
            }).catch(() => {
              alert("Erro ao copiar. Tente copiar manualmente.");
            });
          }
        });
      }

      // Inicia monitoramento do pagamento
      startAIPaymentMonitoring(uid, orderId);
    },
    willClose: () => {
      // Para o monitoramento quando fechar
      if (window.aiPaymentUnsubscribe) {
        window.aiPaymentUnsubscribe();
        window.aiPaymentUnsubscribe = null;
      }
    }
  });
}

/**
 * Monitora o status do pagamento da IA
 */
function startAIPaymentMonitoring(uid, orderId) {
  const statusDiv = document.getElementById("aiPaymentStatus");
  if (!statusDiv) return;

  let pollCount = 0;
  const maxPolls = 300; // 5 minutos (300 segundos)

  const pollInterval = setInterval(async () => {
    pollCount++;

    try {
      const userDoc = await db.collection("users").doc(uid).get();
      const userData = userDoc.data() || {};

      if (userData.aiPurchased === true) {
        clearInterval(pollInterval);
        
        // Atualiza status local
        userHasPurchasedAI = true;

        // Mostra sucesso
        statusDiv.className = "alert alert-success mt-3 mb-0";
        statusDiv.innerHTML = `
          <strong>✅ Pagamento Confirmado!</strong><br>
          <small>A IA foi ativada com sucesso. Fechando em 3 segundos...</small>
        `;

        // Fecha e atualiza UI
        setTimeout(() => {
          Swal.close();
          showAIView(true);
          updateAIFinancialData();
          
          // Mostra mensagem de boas-vindas
          uiAlert({
            title: "IA Ativada! 🎉",
            text: "Seu Assistente de IA está pronto para ajudá-lo com suas finanças!",
            icon: "success"
          });
        }, 3000);
      }
    } catch (error) {
      console.error("[AI Payment] Erro ao verificar pagamento:", error);
    }

    // Para depois de 5 minutos
    if (pollCount >= maxPolls) {
      clearInterval(pollInterval);
      statusDiv.className = "alert alert-warning mt-3 mb-0";
      statusDiv.innerHTML = `
        <strong>⏱️ Tempo Esgotado</strong><br>
        <small>O pagamento ainda não foi confirmado. Verifique seu banco.</small>
      `;
    }
  }, 1000); // Verifica a cada 1 segundo

  // Guarda referência para poder cancelar depois
  window.aiPaymentUnsubscribe = () => clearInterval(pollInterval);
}

// Inicializa quando o app estiver pronto (após autenticação)
// Não inicializa no DOMContentLoaded para evitar duplicação
// document.addEventListener("DOMContentLoaded", () => {
//   console.log("🤖 Módulo de IA inicializado");
//   initAIModule();
// });

// Também tenta inicializar quando o app está pronto (firebase autenticado)
// Será acionado por um evento no app.js após login
window.addEventListener("appReady", () => {
  console.log("🤖 Módulo de IA inicializado (appReady)");
  initAIModule();
  
  // Mostra uma mensagem de boas-vindas
  const chatHistory = document.getElementById("aiChatHistory");
  if (chatHistory && chatHistory.children.length === 0) {
    addAIMessage(
      "👋 Olá! Sou seu assistente de controle de gastos. Posso ajudá-lo com:\n\n💡 Dicas para economizar\n📊 Análise de seus gastos\n🎯 Planejamento de metas\n📁 Organização de categorias\n\nComo posso ajudá-lo?",
      "assistant"
    );
  }
});
