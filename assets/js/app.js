// Controle de Salário (Bootstrap + JS) - agora em Firebase Firestore.
// Dica: abra index.html via Live Server (VSCode) para facilitar.

const $ = (sel) => document.querySelector(sel);
const userAvatar = document.getElementById("userAvatar");
const userEmailEl = document.getElementById("userEmail");
const btnProfile = document.getElementById("btnProfile");


// ================================
// Firebase init (COMPAT)
// ================================
const firebaseConfig = {
  apiKey: "AIzaSyDmbZCCR58Fa2g5x2y4pLC0YZrxurtwqg8",
  authDomain: "salary-saas.firebaseapp.com",
  projectId: "salary-saas",
  storageBucket: "salary-saas.firebasestorage.app",
  messagingSenderId: "32860095863",
  appId: "1:32860095863:web:f7cac5728fe0e629ce4d72",
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

let UID = null;

const TRIAL_DURATION_DAYS = 3;
const TRIAL_DURATION_MS = TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;

function isPaidPlan(plan) {
  return ["basic", "pro", "family"].includes(String(plan || "").toLowerCase());
}

function isTrialPlan(plan) {
  return String(plan || "").toLowerCase() === "trial";
}

// ================================
// Escopo (pessoal vs cofre compartilhado)
// ================================
let SCOPE = { kind: "user", id: null, role: "owner", name: null }; // kind: "user" | "household"

function baseDoc() {
  if (SCOPE.kind === "household") return db.collection("households").doc(SCOPE.id);
  return db.collection("users").doc(UID);
}

function updateScopeUI() {
  if (!scopeLabel) return;
  if (SCOPE.kind === "household") {
    const label = SCOPE.name ? `Cofre: ${SCOPE.name} - ${SCOPE.id}` : `Cofre: ${SCOPE.name}`;
    scopeLabel.textContent = label;
    scopeLabel.classList.remove("text-bg-light");
    scopeLabel.classList.add("text-bg-warning");
  } else {
    scopeLabel.textContent = "Pessoal";
    scopeLabel.classList.remove("text-bg-warning");
    scopeLabel.classList.add("text-bg-light");
  }
}

// ================================
// UI helpers (SweetAlert2 opcional)
// ================================
async function uiAlert(opts) {
  if (window.Swal && Swal.fire) return Swal.fire(opts);
  alert((opts.title ? opts.title + "\n\n" : "") + (opts.text || ""));
}

function normalizeBrazilianDocument(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function formatBrazilianDocument(value = "") {
  const normalized = normalizeBrazilianDocument(value);
  if (normalized.length === 11) {
    return normalized.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (normalized.length === 14) {
    return normalized.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return String(value || "").trim();
}

function isValidCPF(value = "") {
  const cpf = normalizeBrazilianDocument(value);
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  return digit === Number(cpf[10]);
}

function isValidCNPJ(value = "") {
  const cnpj = normalizeBrazilianDocument(value);
  if (!/^\d{14}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(cnpj[i]) * weights1[i];
  let digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (digit !== Number(cnpj[12])) return false;

  sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(cnpj[i]) * weights2[i];
  digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return digit === Number(cnpj[13]);
}

function isValidBrazilianDocument(value = "") {
  const normalized = normalizeBrazilianDocument(value);
  if (normalized.length === 11) return isValidCPF(normalized);
  if (normalized.length === 14) return isValidCNPJ(normalized);
  return false;
}

function applyTheme() {
  const dark = !!state.config.darkMode;
  document.body.classList.toggle("dark-mode", dark);
}


const persistFiltersDebounced = debounce(async () => {
  state.config.searchText = (search?.value || "").trim();
  state.config.filterType = filterType?.value || "all";
  state.config.filterStatus = filterStatus?.value || "all";
  state.config.updatedAt = Date.now();
  await fbSaveSettings({
    searchText: state.config.searchText,
    filterType: state.config.filterType,
    filterStatus: state.config.filterStatus,
    updatedAt: state.config.updatedAt,
  });
}, 300);


async function uiConfirm(opts) {
  if (window.Swal && Swal.fire) {
    const res = await Swal.fire({
      title: opts.title || "Confirmar",
      text: opts.text || "",
      icon: opts.icon || "question",
      showCancelButton: true,
      confirmButtonText: opts.confirmButtonText || "OK",
      cancelButtonText: opts.cancelButtonText || "Cancelar",
      confirmButtonColor: opts.confirmButtonColor,
    });
    return !!res.isConfirmed;
  }
  return confirm((opts.title ? opts.title + "\n\n" : "") + (opts.text || ""));
}

function requireAccountForHousehold() {
  const cur = auth.currentUser;
  if (!cur || cur.isAnonymous) {
    uiAlert({
      title: "Conecte uma conta",
      text: "Para usar cofre compartilhado, entre com Google ou email e senha.",
      icon: "info",
    });
    return false;
  }
  return true;
}

function makeCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

let BOOT_SEQ = 0;

async function refreshScopeFromProfile() {
  SCOPE = { kind: "user", id: UID, role: "owner", name: null };

  const cur = auth.currentUser;
  if (!cur || cur.isAnonymous) {
    updateScopeUI();
    return;
  }

  try {
    const uSnap = await userDocRef(UID).get();
    const hid = uSnap.exists ? (uSnap.data().householdId || null) : null;
    if (!hid) {
      updateScopeUI();
      return;
    }

    const hRef = db.collection("households").doc(hid);
    const hSnap = await hRef.get();
    if (!hSnap.exists) {
      await userDocRef(UID).set({ householdId: null }, { merge: true });
      updateScopeUI();
      return;
    }

    const memSnap = await hRef.collection("members").doc(UID).get();
    const role = memSnap.exists ? (memSnap.data().role || "member") : "member";
    const name = hSnap.data().name || null;

    SCOPE = { kind: "household", id: hid, role, name };
    updateScopeUI();
  } catch (e) {
    console.warn("Falha ao carregar escopo:", e);
    updateScopeUI();
  }
}

async function openHouseholdMenu() {
  if (!requireAccountForHousehold()) return;

  if (window.Swal && Swal.fire) {
    const res = await Swal.fire({
      title: "Cofre compartilhado",
      html: "<div class='text-start small text-secondary'>Crie um cofre ou entre com um código.</div>",
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: "Criar cofre",
      denyButtonText: "Entrar com código",
      cancelButtonText: "Cancelar",
    });
    if (res.isConfirmed) return createHouseholdFlow();
    if (res.isDenied) return joinHouseholdFlow();
    return;
  }

  const choice = prompt("Digite 1 para criar cofre, 2 para entrar com código:");
  if (choice === "1") return createHouseholdFlow();
  if (choice === "2") return joinHouseholdFlow();
}

async function createHouseholdFlow() {
  if (!requireAccountForHousehold()) return;

  let name = "Nosso cofre";
  if (window.Swal && Swal.fire) {
    const res = await Swal.fire({
      title: "Criar cofre",
      input: "text",
      inputLabel: "Nome do cofre",
      inputPlaceholder: "Ex: Casa / João&Mirelli / Família",
      inputValue: name,
      showCancelButton: true,
      confirmButtonText: "Criar",
      cancelButtonText: "Cancelar",
    });
    if (!res.isConfirmed) return;
    name = String(res.value || "").trim() || name;
  } else {
    name = prompt("Nome do cofre:", name)?.trim() || name;
  }

  let hid = null;
  for (let i = 0; i < 7; i++) {
    const code = makeCode(6);
    const ref = db.collection("households").doc(code);
    const snap = await ref.get();
    if (!snap.exists) {
      hid = code;
      break;
    }
  }
  if (!hid) {
    await uiAlert({ title: "Erro", text: "Não consegui gerar um código. Tente novamente.", icon: "error" });
    return;
  }

  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Sem usuário autenticado.");

  const hRef = db.collection("households").doc(hid);

  // 1) cria o cofre com ownerUid correto
  await hRef.set(
    {
      name,
      ownerUid: uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      version: 1,
    },
    { merge: true }
  );

  // 2) registra você como membro/owner
  await hRef.collection("members").doc(uid).set(
    { role: "owner", joinedAt: firebase.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  // 3) salva householdId no seu user
  await userDocRef(uid).set({ householdId: hid }, { merge: true });


  await bootstrap();

  await uiAlert({
    title: "Cofre criado ✅",
    text: `Código para compartilhar: ${hid}`,
    icon: "success",
  });
}

async function joinHouseholdFlow() {
  if (!requireAccountForHousehold()) return;

  let code = "";
  if (window.Swal && Swal.fire) {
    const res = await Swal.fire({
      title: "Entrar em um cofre",
      input: "text",
      inputLabel: "Código do cofre",
      inputPlaceholder: "Ex: A1B2C3",
      showCancelButton: true,
      confirmButtonText: "Entrar",
      cancelButtonText: "Cancelar",
      inputValidator: (v) => (!v || !v.trim() ? "Digite o código" : undefined),
    });
    if (!res.isConfirmed) return;
    code = String(res.value || "").trim().toUpperCase();
  } else {
    code = prompt("Código do cofre:")?.trim().toUpperCase() || "";
    if (!code) return;
  }

  const hRef = db.collection("households").doc(code);
  const hSnap = await hRef.get();
  if (!hSnap.exists) {
    await uiAlert({ title: "Não encontrado", text: "Código inválido.", icon: "error" });
    return;
  }

  await userDocRef(UID).set({ householdId: code }, { merge: true });

  await bootstrap();

  await uiAlert({
    title: "Pronto ✅",
    text: `Você entrou no cofre: ${hSnap.data().name || code}`,
    icon: "success",
  });
}

async function leaveHouseholdFlow() {
  if (SCOPE.kind !== "household") {
    await uiAlert({ title: "Modo pessoal", text: "Você não está em um cofre.", icon: "info" });
    return;
  }

  const ok = await uiConfirm({
    title: "Sair do cofre?",
    text: "Você voltará para o modo pessoal neste dispositivo.",
    icon: "warning",
    confirmButtonText: "Sair",
    cancelButtonText: "Cancelar",
    confirmButtonColor: "#dc3545",
  });
  if (!ok) return;

  const hid = SCOPE.id;

  try {
    await db.collection("households").doc(hid).collection("members").doc(UID).delete();
  } catch (e) {
    console.warn("Falha ao remover membership:", e);
  }

  await userDocRef(UID).set({ householdId: null }, { merge: true });

  await bootstrap();
  await uiAlert({ title: "Ok", text: "Você saiu do cofre.", icon: "success" });
}

// ================================
// CATEGORIAS PRÉ-DEFINIDAS
// ================================
const DEFAULT_CATEGORIES = [
  // Alimentação
  { name: "Mercado", emoji: "🛒", group: "Alimentação" },
  { name: "Restaurante", emoji: "🍽️", group: "Alimentação" },
  { name: "Padaria", emoji: "🥐", group: "Alimentação" },
  { name: "Café", emoji: "☕", group: "Alimentação" },

  // Transporte
  { name: "Transporte", emoji: "🚗", group: "Transporte" },
  { name: "Uber/99", emoji: "🚕", group: "Transporte" },
  { name: "Combustível", emoji: "⛽", group: "Transporte" },
  { name: "Estacionamento", emoji: "🅿️", group: "Transporte" },

  // Habitação
  { name: "Aluguel", emoji: "🏠", group: "Habitação" },
  { name: "Condomínio", emoji: "🏢", group: "Habitação" },
  { name: "Internet", emoji: "📡", group: "Habitação" },
  { name: "Água/Luz", emoji: "💡", group: "Habitação" },

  // Saúde
  { name: "Saúde", emoji: "⚕️", group: "Saúde" },
  { name: "Farmácia", emoji: "💊", group: "Saúde" },
  { name: "Academia", emoji: "🏋️", group: "Saúde" },

  // Lazer
  { name: "Lazer", emoji: "🎮", group: "Lazer" },
  { name: "Cinema", emoji: "🎬", group: "Lazer" },
  { name: "Viagem", emoji: "✈️", group: "Lazer" },
  { name: "Streaming", emoji: "📺", group: "Lazer" },

  // Educação
  { name: "Educação", emoji: "📚", group: "Educação" },
  { name: "Cursos", emoji: "🎓", group: "Educação" },

  // Pessoal
  { name: "Vestuário", emoji: "👕", group: "Pessoal" },
  { name: "Beleza", emoji: "💅", group: "Pessoal" },
  { name: "Cartão", emoji: "💳", group: "Pessoal" },

  // Trabalho
  { name: "Escritório", emoji: "💼", group: "Trabalho" },
];

function renderCategorySuggestions() {
  const container = document.getElementById("catSuggestContainer");
  if (!container) return;

  // Agrupar por categoria
  const grouped = {};
  DEFAULT_CATEGORIES.forEach(cat => {
    if (!grouped[cat.group]) grouped[cat.group] = [];
    grouped[cat.group].push(cat);
  });

  let html = "";

  // Renderizar por grupos
  Object.entries(grouped).forEach(([group, cats]) => {
    html += `<div style="width: 100%; margin-top: 0.5rem;"><small class=\"text-muted fw-600\">${group}</small></div>`;
    cats.forEach(cat => {
      html += `
        <button class="btn btn-sm btn-outline-secondary cat-suggest" data-cat="${escapeHtml(cat.name)}" title="${group}">
          <span>${cat.emoji}</span> ${escapeHtml(cat.name)}
        </button>
      `;
    });
  });

  container.innerHTML = html;

  // Adicionar event listeners
  container.querySelectorAll(".cat-suggest").forEach(btn => {
    btn.addEventListener("click", async () => {
      const v = btn.getAttribute("data-cat") || "";
      if (!v) return;
      const next = Array.from(new Set([...getCategories(), v]));
      await saveCategories(next);
      renderCategories();
      showToast("success", `✅ ${v} adicionada à sua lista`, 1200);
    });
  });
}

// ================================
// LISTAR TODOS OS COFRES DO USUÁRIO
// ================================
async function getUserHouseholds() {
  if (!UID) return [];

  const households = [];

  try {
    // 1. Busca cofres onde o usuário é owner
    const ownedQuery = await db.collection("households")
      .where("ownerUid", "==", UID)
      .get();

    ownedQuery.forEach(doc => {
      households.push({
        id: doc.id,
        ...doc.data(),
        role: "owner",
        isOwner: true
      });
    });

    // 2. Busca cofres onde o usuário é membro
    // Usa collectionGroup para buscar em todas as subcoleções "members"
    // Nota: Não podemos usar documentId() em collectionGroup sem o caminho completo
    const memberQuery = await db.collectionGroup("members").get();

    // Filtra apenas os documentos onde o ID corresponde ao UID do usuário
    const userMemberDocs = memberQuery.docs.filter(doc => doc.id === UID);

    // Para cada membro, busca os dados do household pai
    const memberPromises = userMemberDocs.map(async (memberDoc) => {
      const householdId = memberDoc.ref.parent.parent.id;

      // Não adiciona se já está na lista (como owner)
      if (households.find(h => h.id === householdId)) return null;

      const householdDoc = await db.collection("households").doc(householdId).get();
      if (householdDoc.exists) {
        return {
          id: householdDoc.id,
          ...householdDoc.data(),
          role: memberDoc.data().role || "member",
          isOwner: false
        };
      }
      return null;
    });

    const memberHouseholds = await Promise.all(memberPromises);
    memberHouseholds.forEach(h => {
      if (h) households.push(h);
    });

  } catch (error) {
    console.error("[getUserHouseholds] Erro ao buscar cofres:", error);
  }

  return households;
}

async function renderHouseholdsList() {
  const loadingEl = document.getElementById("householdsLoading");
  const listEl = document.getElementById("householdsList");
  const emptyEl = document.getElementById("householdsEmpty");

  if (!loadingEl || !listEl || !emptyEl) return;

  // Mostra loading
  loadingEl.classList.remove("d-none");
  listEl.classList.add("d-none");
  emptyEl.classList.add("d-none");

  try {
    const households = await getUserHouseholds();

    loadingEl.classList.add("d-none");

    if (households.length === 0) {
      emptyEl.classList.remove("d-none");
      return;
    }

    // Renderiza lista
    listEl.innerHTML = "";

    households.forEach(household => {
      const card = document.createElement("div");
      card.className = "card mb-3 border";

      const isActive = SCOPE.kind === "household" && SCOPE.id === household.id;
      if (isActive) {
        card.classList.add("border-primary", "border-2");
      }

      const roleText = household.isOwner ? "👑 Dono" : "👤 Membro";
      const activeText = isActive ? '<span class="badge bg-success ms-2">Ativo</span>' : '';

      card.innerHTML = `
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start">
            <div class="flex-grow-1">
              <h6 class="mb-1">
                ${household.name || "Cofre sem nome"}
                ${activeText}
              </h6>
              <p class="text-secondary small mb-2">
                ${roleText} • Código: <code>${household.id}</code>
              </p>
              <p class="text-secondary small mb-0">
                Criado em: ${household.createdAt ? new Date(household.createdAt.toDate()).toLocaleDateString('pt-BR') : '—'}
              </p>
            </div>
          </div>
          <div class="mt-3 d-flex gap-2 flex-wrap">
            <button class="btn btn-sm btn-primary btn-switch-household" data-hid="${household.id}">
              ${isActive ? '✓ Usando este cofre' : '↪ Mudar para este cofre'}
            </button>
            <button class="btn btn-sm btn-outline-secondary btn-copy-code" data-code="${household.id}">
              📋 Copiar código
            </button>
            ${household.isOwner ? `
              <button class="btn btn-sm btn-outline-danger btn-delete-household" data-hid="${household.id}">
                🗑️ Excluir cofre
              </button>
            ` : `
              <button class="btn btn-sm btn-outline-warning btn-leave-household" data-hid="${household.id}">
                🚪 Sair do cofre
              </button>
            `}
          </div>
        </div>
      `;

      listEl.appendChild(card);
    });

    listEl.classList.remove("d-none");

    // Adiciona event listeners
    setupHouseholdListeners();

  } catch (error) {
    console.error("[renderHouseholdsList] Erro:", error);
    loadingEl.classList.add("d-none");
    emptyEl.classList.remove("d-none");
  }
}

function setupHouseholdListeners() {
  // Mudar para cofre
  document.querySelectorAll(".btn-switch-household").forEach(btn => {
    btn.addEventListener("click", async () => {
      const hid = btn.getAttribute("data-hid");
      await userDocRef(UID).set({ householdId: hid }, { merge: true });
      await bootstrap();
      await uiAlert({ title: "✓", text: "Cofre ativado!", icon: "success" });
      await renderHouseholdsList();
    });
  });

  // Copiar código
  document.querySelectorAll(".btn-copy-code").forEach(btn => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-code");
      await navigator.clipboard.writeText(code);
      btn.textContent = "✓ Copiado!";
      setTimeout(() => {
        btn.textContent = "📋 Copiar código";
      }, 2000);
    });
  });

  // Sair do cofre (não-owner)
  document.querySelectorAll(".btn-leave-household").forEach(btn => {
    btn.addEventListener("click", async () => {
      const hid = btn.getAttribute("data-hid");

      const ok = await uiConfirm({
        title: "Sair deste cofre?",
        text: "Você perderá acesso aos dados compartilhados.",
        icon: "warning",
        confirmButtonText: "Sair",
        cancelButtonText: "Cancelar"
      });

      if (!ok) return;

      try {
        await db.collection("households").doc(hid).collection("members").doc(UID).delete();

        // Se era o cofre ativo, volta para pessoal
        if (SCOPE.kind === "household" && SCOPE.id === hid) {
          await userDocRef(UID).set({ householdId: null }, { merge: true });
          await bootstrap();
        }

        await uiAlert({ title: "Ok", text: "Você saiu do cofre.", icon: "success" });
        await renderHouseholdsList();
      } catch (error) {
        console.error("Erro ao sair:", error);
        await uiAlert({ title: "Erro", text: "Não foi possível sair do cofre.", icon: "error" });
      }
    });
  });

  // Excluir cofre (owner only)
  document.querySelectorAll(".btn-delete-household").forEach(btn => {
    btn.addEventListener("click", async () => {
      const hid = btn.getAttribute("data-hid");

      const ok = await uiConfirm({
        title: "⚠️ Excluir cofre permanentemente?",
        text: "TODOS os dados compartilhados serão perdidos. Esta ação não pode ser desfeita!",
        icon: "error",
        confirmButtonText: "Sim, excluir",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#dc3545"
      });

      if (!ok) return;

      try {
        // Remove todos os membros primeiro
        const membersSnap = await db.collection("households").doc(hid).collection("members").get();
        const deletePromises = membersSnap.docs.map(doc => doc.ref.delete());
        await Promise.all(deletePromises);

        // Remove o documento do household
        await db.collection("households").doc(hid).delete();

        // Se era o cofre ativo, volta para pessoal
        if (SCOPE.kind === "household" && SCOPE.id === hid) {
          await userDocRef(UID).set({ householdId: null }, { merge: true });
          await bootstrap();
        }

        await uiAlert({ title: "Excluído", text: "Cofre excluído com sucesso.", icon: "success" });
        await renderHouseholdsList();
      } catch (error) {
        console.error("Erro ao excluir:", error);
        await uiAlert({ title: "Erro", text: "Não foi possível excluir o cofre.", icon: "error" });
      }
    });
  });
}

async function bootstrap() {
  const cur = auth.currentUser;
  if (!cur) return;

  const mySeq = ++BOOT_SEQ;
  UID = cur.uid;

  try {
    await upsertUserProfile(cur);
  } catch (e) {
    console.warn("Falha ao salvar perfil:", e);
  }

  await refreshScopeFromProfile();
  if (mySeq !== BOOT_SEQ) return;

  stopListeners();

  const s = await fbLoadSettings();
  state.config = s || {};
  setDefaultsIfNeeded();
  syncConfigToUI();

  listenSettings();
  await listenMonth(getSelectedMonthKey());
  // listenFiis(); // TODO: Função não implementada ainda

  renderAll();
}


async function ensureAuth() {
  const cur = auth.currentUser;
  if (cur) {
    UID = cur.uid;
    return UID;
  }
  const res = await auth.signInAnonymously();
  UID = res.user.uid;
  return UID;
}

function userDocRef(uid) {
  return db.collection("users").doc(uid);
}

async function upsertUserProfile(user) {
  if (!user) return;

  const ref = userDocRef(user.uid);
  const snap = await ref.get();

  const payload = {
    uid: user.uid,
    name: user.displayName || "",
    email: user.email || "",
    photoURL: user.photoURL || "",
    provider: (user.providerData?.[0]?.providerId) || "unknown",
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  if (!snap.exists) {
    payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
  }

  await ref.set(payload, { merge: true });
}

// ================================
// Perfil do usuário
// ================================
function fbProfileRef() {
  if (!UID) throw new Error("Usuário não autenticado.");
  return db.collection("users").doc(UID);
}

async function fbLoadProfile() {
  const snap = await fbProfileRef().get();
  return snap.exists ? snap.data() : {};
}

async function fbSaveProfile(partial) {
  await fbProfileRef().set(
    {
      ...partial,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

function getInitials(name = "") {
  const n = String(name).trim();
  if (!n) return "U";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function setAvatarFallbackByName(name = "") {
  if (!userAvatar) return;
  const initial = getInitials(name);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
      <rect width="100%" height="100%" rx="32" ry="32" fill="#6c757d"/>
      <text x="50%" y="54%" text-anchor="middle" font-size="24" fill="white" font-family="Arial" font-weight="700">${initial}</text>
    </svg>`;
  userAvatar.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  userAvatar.style.visibility = "visible";
}

function applyUserChip(name, email) {
  if (userChip) userChip.textContent = name || (email ? email.split("@")[0] : "Usuário");
  if (userEmailEl) userEmailEl.textContent = email || "";
  // se não tiver foto, garante fallback pelas iniciais
  const cur = auth.currentUser;
  if (!cur?.photoURL) setAvatarFallbackByName(name || "");
}

async function openProfileFlow() {
  const cur = auth.currentUser;
  if (!cur) return;

  const data = await fbLoadProfile();
  const settings = await fbLoadSettings();

  const currentName = data.name || cur.displayName || "";
  const currentEmail = data.email || cur.email || "";
  const currentPhone = data.phone || "";
  const currentCity = data.city || "";
  const currentDocument = data.document || "";
  const currentPlan = String(settings?.plan || "none").toLowerCase();

  // Mapeia nome do plano
  const planName = {
    trial: "Free Trial",
    basic: "Basic",
    pro: "Pro",
    family: "Family",
    none: "Sem Plano"
  }[currentPlan] || "Desconhecido";

  const planPrice = {
    trial: `Grátis por ${TRIAL_DURATION_DAYS} dias`,
    basic: "R$ 10,90/mês",
    pro: "R$ 15,90/mês",
    family: "R$ 25,90/mês",
    none: "Acesso bloqueado"
  }[currentPlan] || "-";

  if (window.Swal?.fire) {
    const res = await Swal.fire({
      title: "📋 Meu Perfil",
      html: `
        <div class="text-start">
          <!-- Seção do Plano -->
          <div class="alert alert-info rounded-3 mb-3" role="alert">
            <div class="fw-bold">Plano Atual</div>
            <div style="font-size: 18px; color: #0d6efd;">
              ${planName} <span style="font-size: 14px;">${planPrice}</span>
            </div>
          </div>

          <!-- Informações Pessoais -->
          <label class="form-label fw-bold mt-3">Nome Completo</label>
          <input id="pfName" class="swal2-input" placeholder="Seu nome" value="${String(currentName).replace(/"/g, "&quot;")}">
          
          <label class="form-label fw-bold mt-2">CPF ou CNPJ</label>
          <input id="pfDocument" class="swal2-input" placeholder="000.000.000-00" value="${String(currentDocument).replace(/"/g, "&quot;")}" readonly style="background-color: #f5f5f5; cursor: not-allowed;">
          <small class="text-muted d-block mt-1">Dados do cadastro não podem ser alterados</small>

          <label class="form-label fw-bold mt-2">Email</label>
          <input id="pfEmail" class="swal2-input" placeholder="seuemail@..." value="${String(currentEmail).replace(/"/g, "&quot;")}">
          
          <label class="form-label fw-bold mt-2">Telefone</label>
          <input id="pfPhone" class="swal2-input" placeholder="(00) 00000-0000" value="${String(currentPhone).replace(/"/g, "&quot;")}">
          
          <label class="form-label fw-bold mt-2">Cidade</label>
          <input id="pfCity" class="swal2-input" placeholder="Sua cidade" value="${String(currentCity).replace(/"/g, "&quot;")}">
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Salvar Alterações",
      cancelButtonText: "Cancelar",
      focusConfirm: false,
      preConfirm: () => {
        const name = window.document.getElementById("pfName")?.value?.trim() || "";
        const email = window.document.getElementById("pfEmail")?.value?.trim() || "";
        const phone = window.document.getElementById("pfPhone")?.value?.trim() || "";
        const city = window.document.getElementById("pfCity")?.value?.trim() || "";

        if (!name) {
          Swal.showValidationMessage("Nome é obrigatório.");
          return false;
        }

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          Swal.showValidationMessage("Email inválido.");
          return false;
        }

        return { name, email, phone, city };
      },
    });

    if (!res.isConfirmed || !res.value) return;

    await fbSaveProfile(res.value);
    applyUserChip(res.value.name, res.value.email || currentEmail);

    await uiAlert({
      title: "✅ Perfil atualizado",
      text: "Seus dados foram salvos com sucesso.",
      icon: "success",
    });
    return;
  }

  // fallback sem SweetAlert
  const name = prompt("Nome:", currentName)?.trim();
  if (!name) return;
  const email = prompt("Email:", currentEmail)?.trim() || "";
  const phone = prompt("Telefone:", currentPhone)?.trim() || "";
  const city = prompt("Cidade:", currentCity)?.trim() || "";

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return uiAlert({ title: "Erro", text: "Email inválido.", icon: "error" });
  }

  await fbSaveProfile({ name, email, phone, city });
  applyUserChip(name, email || currentEmail);
  await uiAlert({ title: "✅ Perfil atualizado", text: "Dados salvos com sucesso.", icon: "success" });
}


// ================================
// AUTH UI
// ================================
const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const navAuthed = document.getElementById("navAuthed");
const userChip = document.getElementById("userChip");
const authMsg = document.getElementById("authMsg");

const btnGoogle = document.getElementById("btnGoogle");
const btnGoogleSignup = document.getElementById("btnGoogleSignup");
const btnEmailLogin = document.getElementById("btnEmailLogin");
const btnEmailSignup = document.getElementById("btnEmailSignup");
const btnLogout = document.getElementById("btnLogout");
const btnHousehold = document.getElementById("btnHousehold");
const btnLeaveHousehold = document.getElementById("btnLeaveHousehold");
const scopeLabel = document.getElementById("scopeLabel");
const homeView = document.getElementById("homeView");
const btnPlans = document.getElementById("btnPlans");
const btnOpenLogin = document.getElementById("btnOpenLogin");
const signupView = document.getElementById("signupView");
const btnGoToSignup = document.getElementById("btnGoToSignup");
const btnGoToLogin = document.getElementById("btnGoToLogin");
let PENDING_PLAN = null;

const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const signupEmail = document.getElementById("signupEmail");
const signupPassword = document.getElementById("signupPassword");
const signupPasswordConfirm = document.getElementById("signupPasswordConfirm");
const signupMsg = document.getElementById("signupMsg");

// Helpers UI
// ================================
function showLogin() {
  authView.classList.remove("d-none");
  signupView.classList.add("d-none");
  appView.classList.add("d-none");
  navAuthed.classList.add("d-none");
  if (homeView) homeView.classList.add("d-none");
  const mainNavbar = document.getElementById("mainNavbar");
  if (mainNavbar) mainNavbar.classList.add("d-none");
  // Limpa formulário
  loginEmail.value = "";
  loginPassword.value = "";
  showError("");
}

function showSignup() {
  authView.classList.add("d-none");
  signupView.classList.remove("d-none");
  appView.classList.add("d-none");
  navAuthed.classList.add("d-none");
  if (homeView) homeView.classList.add("d-none");
  const mainNavbar = document.getElementById("mainNavbar");
  if (mainNavbar) mainNavbar.classList.add("d-none");
  // Limpa formulário
  signupEmail.value = "";
  signupPassword.value = "";
  signupPasswordConfirm.value = "";
  showSignupError("");
}

function showAuth() {
  // Padrão é mostrar tela de login
  showLogin();
}

function showHome() {
  authView.classList.add("d-none");
  if (signupView) signupView.classList.add("d-none");
  appView.classList.add("d-none");
  navAuthed.classList.add("d-none");
  if (homeView) homeView.classList.remove("d-none");
  const mainNavbar = document.getElementById("mainNavbar");
  if (mainNavbar) mainNavbar.classList.add("d-none");

  // Remove a view de pagamento pendente se existir
  const pendingView = document.getElementById("paymentPendingView");
  if (pendingView) pendingView.classList.add("d-none");
}

async function showPaymentPending(user) {
  authView.classList.add("d-none");
  if (signupView) signupView.classList.add("d-none");
  appView.classList.add("d-none");
  navAuthed.classList.add("d-none");
  if (homeView) homeView.classList.add("d-none");
  const mainNavbar = document.getElementById("mainNavbar");
  if (mainNavbar) mainNavbar.classList.remove("d-none");

  const pendingView = document.getElementById("paymentPendingView");
  if (!pendingView) {
    console.error("paymentPendingView não encontrado no HTML");
    return;
  }

  pendingView.classList.remove("d-none");

  // Wire up os botões de plano
  const btnBasic = document.getElementById("pendingBtnBasic");
  const btnPro = document.getElementById("pendingBtnPro");
  const btnFamily = document.getElementById("pendingBtnFamily");

  [btnBasic, btnPro, btnFamily].forEach((btn) => {
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const plan = btn.id.replace("pendingBtn", "").toLowerCase();
      if (["basic", "pro", "family"].includes(plan)) {
        await createPaymentFlow(plan);
      }
    });
  });
}

async function showApp(user) {
  authView.classList.add("d-none");
  if (signupView) signupView.classList.add("d-none");
  appView.classList.remove("d-none");
  navAuthed.classList.remove("d-none");
  if (homeView) homeView.classList.add("d-none");
  const pendingView = document.getElementById("paymentPendingView");
  if (pendingView) pendingView.classList.add("d-none");
  const mainNavbar = document.getElementById("mainNavbar");
  if (mainNavbar) mainNavbar.classList.remove("d-none");

  let name = user.displayName || (user.email ? user.email.split("@")[0] : "Usuário");
  let email = user.email || "";

  try {
    const prof = await fbLoadProfile();
    if (prof?.name) name = prof.name;
    if (prof?.email) email = prof.email;
  } catch (e) {
    console.warn("Falha ao carregar perfil salvo:", e);
  }

  applyUserChip(name, email);

  const photo = user.photoURL;
  if (userAvatar) {
    if (photo) {
      userAvatar.src = photo;
      userAvatar.style.visibility = "visible";
    } else {
      setAvatarFallbackByName(name);
    }
  }

  // Inicializa módulo de IA
  try {
    if (typeof initAIModule === "function") {
      initAIModule();
    }
    // Verifica status de IA no background
    if (typeof checkAIPurchaseStatus === "function") {
      checkAIPurchaseStatus().catch(e => {
        console.warn("Erro ao verificar compra de IA:", e);
      });
    }
  } catch (e) {
    console.warn("Erro ao inicializar módulo de IA:", e);
  }
}


function showError(msg) {
  if (!msg) {
    authMsg.textContent = "";
    authMsg.classList.add("d-none");
    return;
  }
  authMsg.textContent = msg;
  authMsg.classList.remove("d-none");
}

function showSignupError(msg) {
  if (!msg) {
    signupMsg.textContent = "";
    signupMsg.classList.add("d-none");
    return;
  }
  signupMsg.textContent = msg;
  signupMsg.classList.remove("d-none");
}

function authErrorMessage(err) {
  const code = String(err?.code || "");

  if (code === "auth/popup-closed-by-user") return "Login cancelado.";
  if (code === "auth/popup-blocked") return "O navegador bloqueou a janela de login. Tentando redirecionamento...";
  if (code === "auth/network-request-failed") return "Falha de conexão. Verifique sua internet e tente novamente.";
  if (code === "auth/web-storage-unsupported") return "Seu navegador está bloqueando armazenamento local. Ative cookies/dados do site e tente novamente.";
  if (code === "auth/operation-not-supported-in-this-environment") return "Este navegador/ambiente não suporta login com popup. Abra no Chrome/Safari normal e tente novamente.";
  if (code === "auth/unauthorized-domain") return "Domínio não autorizado no Firebase Auth. Adicione este domínio em Authentication > Settings > Authorized domains.";

  if (code) return `Não foi possível entrar com Google (${code}).`;
  return err?.message || "Não foi possível entrar com Google.";
}

function isMobileAuthFlow() {
  const ua = navigator.userAgent || "";
  const mobileByUa = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
  const coarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  return mobileByUa || coarsePointer;
}

async function signInGoogleSmart() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  if (isMobileAuthFlow()) {
    await auth.signInWithRedirect(provider);
    return;
  }

  try {
    await auth.signInWithPopup(provider);
  } catch (err) {
    const popupFallbackCodes = new Set([
      "auth/popup-blocked",
      "auth/operation-not-supported-in-this-environment",
      "auth/cancelled-popup-request",
    ]);

    if (popupFallbackCodes.has(String(err?.code || ""))) {
      await auth.signInWithRedirect(provider);
      return;
    }
    throw err;
  }
}

// ================================
// Google Login
// ================================
btnGoogle?.addEventListener("click", async () => {
  try {
    showError("");
    await signInGoogleWithCPF();
  } catch (e) {
    showError(authErrorMessage(e));
  }
});

// ================================
// Google Signup
// ================================
btnGoogleSignup?.addEventListener("click", async () => {
  try {
    showSignupError("");
    await signInGoogleWithCPF();
  } catch (e) {
    showSignupError(authErrorMessage(e));
  }
});

// Função para fazer login com Google e pedir CPF se necessário
async function signInGoogleWithCPF() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  if (isMobileAuthFlow()) {
    await auth.signInWithRedirect(provider);
    return;
  }

  try {
    await auth.signInWithPopup(provider);
  } catch (err) {
    const popupFallbackCodes = new Set([
      "auth/popup-blocked",
      "auth/operation-not-supported-in-this-environment",
      "auth/cancelled-popup-request",
    ]);

    if (popupFallbackCodes.has(String(err?.code || ""))) {
      await auth.signInWithRedirect(provider);
      return;
    }
    throw err;
  }
}

auth.getRedirectResult().catch((e) => {
  showError(authErrorMessage(e));
});

// ================================
// Email Login
// ================================
btnEmailLogin?.addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    showError("");
    await auth.signInWithEmailAndPassword(
      loginEmail.value,
      loginPassword.value
    );
  } catch (e) {
    showError("Email ou senha inválidos.");
  }
});

// ================================
// Email Signup (forma separada)
// ================================
btnEmailSignup?.addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    showSignupError("");
    
    // Validar confirmação de senha
    if (signupPassword.value !== signupPasswordConfirm.value) {
      showSignupError("As senhas não conferem.");
      return;
    }

    if (signupPassword.value.length < 6) {
      showSignupError("A senha deve ter no mínimo 6 caracteres.");
      return;
    }

    // 1) Pede nome e CPF antes de criar a conta
    const signupResult = await getSignupData();
    if (!signupResult) return; // usuário cancelou

    const { fullName, cpf } = signupResult;

    // 2) Cria a conta no Firebase
    const userCredential = await auth.createUserWithEmailAndPassword(
      signupEmail.value,
      signupPassword.value
    );

    // 3) Salva nome e CPF no Firestore
    const uid = userCredential.user.uid;
    const now = Date.now();
    const trialEndDate = now + TRIAL_DURATION_MS;

    await db.collection("users").doc(uid).set(
      {
        name: fullName,
        document: formatBrazilianDocument(cpf),
        email: signupEmail.value,
        uid: uid,
        // Adiciona free trial automático
        plan: "trial",
        trialUsed: true,
        planStartDate: now,
        planTrialEndDate: trialEndDate,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Também salva nas settings para quickaccess
    await db.collection("users").doc(uid).collection("meta").doc("settings").set(
      {
        plan: "trial",
        trialUsed: true,
        planStartDate: now,
        planTrialEndDate: trialEndDate,
        updatedAt: now,
      },
      { merge: true }
    );

    // Conta criada com sucesso
    showSignupError(""); // limpa erros

  } catch (e) {
    showSignupError(e.message || "Erro ao criar conta. Tente novamente.");
  }
});

// ================================
// Navegação entre Login e Signup
// ================================
btnGoToSignup?.addEventListener("click", () => {
  showSignup();
});

btnGoToLogin?.addEventListener("click", () => {
  showLogin();
});

async function getSignupData() {
  let fullName = "";
  let cpf = "";

  if (window.Swal && Swal.fire) {
    const res = await Swal.fire({
      title: "Complete seu cadastro",
      html: `
        <div class="text-start">
          <label class="form-label">Nome Completo</label>
          <input id="signupName" class="swal2-input" placeholder="Seu nome completo" autofocus>
          
          <label class="form-label mt-2">CPF ou CNPJ</label>
          <input id="signupCpf" class="swal2-input" placeholder="000.000.000-00 ou 00.000.000/0000-00" maxlength="18">
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Criar conta",
      cancelButtonText: "Cancelar",
      preConfirm: () => {
        const name = window.document.getElementById("signupName")?.value?.trim() || "";
        const doc = window.document.getElementById("signupCpf")?.value?.trim() || "";

        if (!name || name.length < 3) {
          Swal.showValidationMessage("Nome completo é obrigatório (mínimo 3 caracteres)");
          return false;
        }

        if (!doc) {
          Swal.showValidationMessage("CPF/CNPJ é obrigatório");
          return false;
        }

        if (!isValidBrazilianDocument(doc)) {
          Swal.showValidationMessage("Informe um CPF ou CNPJ válido");
          return false;
        }

        return { name, doc };
      },
    });

    if (!res.isConfirmed) return null;
    fullName = res.value.name;
    cpf = res.value.doc;
  } else {
    fullName = prompt("Nome completo:")?.trim() || "";
    if (!fullName || fullName.length < 3) {
      alert("Por favor, informe seu nome completo.");
      return null;
    }
    cpf = prompt("CPF ou CNPJ:")?.trim() || "";
    if (!cpf) {
      alert("Por favor, informe seu CPF ou CNPJ.");
      return null;
    }
    if (!isValidBrazilianDocument(cpf)) {
      alert("Por favor, informe um CPF ou CNPJ válido.");
      return null;
    }
  }

  return { fullName, cpf };
}

// ================================
// Verifica e pede CPF/CNPJ se necessário (Google login)
// ================================
async function ensureUserHasDocument(user) {
  if (!user || !user.uid) return;

  try {
    const userDoc = await db.collection("users").doc(user.uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const hasDocument = userData.document && isValidBrazilianDocument(String(userData.document || ""));

    // Se já tem document válido, não faz nada
    if (hasDocument) return;

    // Pede para preencher CPF/CNPJ (especialmente para Google/novos usuários)
    const name = userData.name || user.displayName || "";
    const result = await getDocumentData(name);
    
    if (!result) return; // usuário cancelou

    const { fullName, document } = result;

    // Salva CPF/CNPJ e atualiza nome se necessário
    const now = Date.now();
    const isFreshAccount = !userData.plan || userData.plan === "none";
    
    const updateData = {
      name: fullName || name,
      document: formatBrazilianDocument(document),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    // Se for nova conta ou não tem plano, adiciona free trial
    if (isFreshAccount) {
      updateData.plan = "trial";
      updateData.trialUsed = true;
      updateData.planStartDate = now;
      updateData.planTrialEndDate = now + TRIAL_DURATION_MS;
    }

    await db.collection("users").doc(user.uid).set(updateData, { merge: true });

    // Também atualiza settings
    if (isFreshAccount) {
      await db.collection("users").doc(user.uid).collection("meta").doc("settings").set(
        {
          plan: "trial",
          trialUsed: true,
          planStartDate: now,
          planTrialEndDate: now + TRIAL_DURATION_MS,
          updatedAt: now,
        },
        { merge: true }
      );
    }
  } catch (e) {
    console.error("Erro ao verificar/pedir document:", e);
  }
}

// ================================
// Garante que usuário tem free trial
// ================================
async function ensureUserHasTrial(user) {
  if (!user || !user.uid) return;

  try {
    const userDoc = await db.collection("users").doc(user.uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    
    const plan = String(userData.plan || "none").toLowerCase();
    const hasPaidPlan = isPaidPlan(plan);
    const trialAlreadyUsed = userData.trialUsed === true || !!userData.planTrialEndDate || isTrialPlan(plan);

    // Não cria trial para assinantes ou para quem já usou trial
    if (hasPaidPlan || trialAlreadyUsed) {
      return;
    }

    // Usuário legado sem trial ganha 1 trial único
    const now = Date.now();
    const trialEndDate = now + TRIAL_DURATION_MS;

    console.log("[Trial Sync] Adicionando free trial para usuário:", user.uid);

    await db.collection("users").doc(user.uid).set(
      {
        plan: "trial",
        trialUsed: true,
        planStartDate: now,
        planTrialEndDate: trialEndDate,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Sincroniza em settings
    await db.collection("users").doc(user.uid).collection("meta").doc("settings").set(
      {
        plan: "trial",
        trialUsed: true,
        planStartDate: now,
        planTrialEndDate: trialEndDate,
        updatedAt: now,
      },
      { merge: true }
    );
  } catch (e) {
    console.error("Erro ao garantir free trial:", e);
  }
}

// ================================
// Modal para pedir CPF/CNPJ
// ================================
async function getDocumentData(currentName = "") {
  let fullName = currentName;
  let document = "";

  if (window.Swal && Swal.fire) {
    const res = await Swal.fire({
      title: "Dados pessoais necessários",
      html: `
        <div class="text-start">
          <p class="text-muted small mb-3">Para usar o Spendify, precisamos dos seus dados para pagamentos e emissão de recibos.</p>
          
          <label class="form-label fw-bold">Nome Completo</label>
          <input id="docName" class="swal2-input" placeholder="Seu nome completo" value="${String(currentName).replace(/"/g, "&quot;")}" autofocus>
          
          <label class="form-label fw-bold mt-2">CPF ou CNPJ</label>
          <input id="docNumber" class="swal2-input" placeholder="000.000.000-00 ou 00.000.000/0000-00" maxlength="18">
        </div>
      `,
      showCancelButton: false,
      confirmButtonText: "Continuar",
      preConfirm: () => {
        const name = window.document.getElementById("docName")?.value?.trim() || "";
        const doc = window.document.getElementById("docNumber")?.value?.trim() || "";

        if (!name || name.length < 3) {
          Swal.showValidationMessage("Nome completo é obrigatório (mínimo 3 caracteres)");
          return false;
        }

        if (!doc) {
          Swal.showValidationMessage("CPF/CNPJ é obrigatório");
          return false;
        }

        if (!isValidBrazilianDocument(doc)) {
          Swal.showValidationMessage("Informe um CPF ou CNPJ válido");
          return false;
        }

        return { name, doc };
      },
    });

    if (!res.isConfirmed) return null;
    fullName = res.value.name;
    document = res.value.doc;
  } else {
    // Fallback para navegadores sem SweetAlert
    fullName = prompt("Nome completo:", currentName)?.trim() || "";
    if (!fullName || fullName.length < 3) {
      alert("Por favor, informe seu nome completo.");
      return null;
    }
    document = prompt("CPF ou CNPJ:")?.trim() || "";
    if (!document) {
      alert("Por favor, informe seu CPF ou CNPJ.");
      return null;
    }
    if (!isValidBrazilianDocument(document)) {
      alert("Por favor, informe um CPF ou CNPJ válido.");
      return null;
    }
  }

  return { fullName, document };
}

// ================================
// Logout
// ================================
btnLogout?.addEventListener("click", async () => {
  await auth.signOut();
  showHome();
});

btnPlans?.addEventListener("click", async () => {
  if (!auth.currentUser) {
    showHome();
    const el = document.getElementById("pricingSection");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  // Se usuário está logado, mostra página de gerenciar plano
  await showPlanManagementPage();
});
btnOpenLogin?.addEventListener("click", () => {
  showAuth();
});

const btnUpgradePro = document.getElementById("btnUpgradePro");
const btnUpgradeFamily = document.getElementById("btnUpgradeFamily");
const btnUpgradeBasic = document.getElementById("btnUpgradeBasic");
btnUpgradeBasic?.addEventListener("click", async () => {
  if (!auth.currentUser) {
    PENDING_PLAN = "basic";
    showAuth();
    return;
  }
  await createPaymentFlow("basic");
});
btnUpgradePro?.addEventListener("click", async () => {
  if (!auth.currentUser) {
    PENDING_PLAN = "pro";
    showAuth();
    return;
  }
  await createPaymentFlow("pro");
});
btnUpgradeFamily?.addEventListener("click", async () => {
  if (!auth.currentUser) {
    PENDING_PLAN = "family";
    showAuth();
    return;
  }
  await createPaymentFlow("family");
});

async function createPaymentFlow(plan) {
  const cur = auth.currentUser;
  if (!cur) throw new Error("Sem usuário");

  // Carrega nome e CPF/CNPJ salvos durante o signup
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
  if (!fullName || !cpf || !isValidBrazilianDocument(cpf)) {
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
          const name = window.document.getElementById("nameInput")?.value?.trim() || "";
          const doc = window.document.getElementById("cpfInput")?.value?.trim() || "";

          if (!name || name.length < 3) {
            Swal.showValidationMessage("Nome completo é obrigatório (mínimo 3 caracteres)");
            return false;
          }

          if (!doc) {
            Swal.showValidationMessage("CPF/CNPJ é obrigatório");
            return false;
          }

          if (!isValidBrazilianDocument(doc)) {
            Swal.showValidationMessage("Informe um CPF ou CNPJ válido");
            return false;
          }

          return { name, doc };
        },
      });

      if (!res.isConfirmed) return;

      fullName = res.value.name;
      cpf = res.value.doc;

      // Salva os dados atualizados no Firebase (mantém com máscara para exibição)
      try {
        await db.collection("users").doc(cur.uid).set(
          {
            name: fullName,
            document: formatBrazilianDocument(cpf),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } catch (e) {
        console.warn("Erro ao atualizar dados:", e);
      }
    } else {
      throw new Error("SweetAlert não disponível para coletar dados de pagamento");
    }
  }

  const cleanDocument = normalizeBrazilianDocument(cpf);
  if (!isValidBrazilianDocument(cleanDocument)) {
    await uiAlert({
      title: "Documento inválido",
      text: "Informe um CPF ou CNPJ válido para continuar.",
      icon: "warning"
    });
    return;
  }

  const payload = {
    uid: cur.uid,
    plan,
    method: "pix",
    customer: {
      email: cur.email || "",
      name: fullName,
      document: cleanDocument,
    }
  };

  // ✅ Se estiver usando Netlify Functions sem redirect, este é o correto
  const base = "/api";
  const apiBase = window.SPENDIFY_API_BASE || base;


  // ✅ Backend exige token Firebase no Authorization
  const token = await cur.getIdToken();

  console.log("[Payment] criando pagamento", {
    plan,
    apiBase,
    uid: payload.uid,
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
    console.error("[Payment] Erro de rede:", networkError);
    await uiAlert({
      title: "Falha ao iniciar pagamento",
      text: "Não foi possível conectar ao servidor. Tente novamente.",
      icon: "error"
    });
    return;
  }

  console.log("[Payment] Response status:", r.status, r.statusText);
  console.log("[Payment] Content-Type:", r.headers.get("content-type"));

  // ✅ Parse seguro para não quebrar com resposta vazia/HTML
  const rawText = await r.text();
  let data = {};

  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (err) {
    console.error("[Payment] Resposta não-JSON:", rawText);
    await uiAlert({
      title: "Falha ao iniciar pagamento",
      text: "Servidor retornou uma resposta inválida.",
      icon: "error"
    });
    return;
  }

  if (!r.ok) {
    console.error("[Payment] Erro na resposta:", data);
    await uiAlert({
      title: "Falha ao iniciar pagamento",
      text: data.message || data.error || "Tente novamente.",
      icon: "error"
    });
    return;
  }

  console.log("[Payment] Dados recebidos:", data);

  // ✅ Nomes corretos do backend
  const method = data?.method || "pix";
  const qrImg = data?.pixQrImage || null;
  const pixKey = data?.pixKey || null;  // Chave PIX para copiar
  const boletoUrl = data?.boletoUrl || null;
  const orderId = data?.orderId || null;
  const amount = data?.amount || 0;

  console.log("[Payment] Extração:", { qrImg: !!qrImg, pixKey: !!pixKey, boletoUrl: !!boletoUrl, orderId });

  if (!qrImg && !boletoUrl) {
    await uiAlert({
      title: "Pagamento criado",
      text: orderId
        ? `Order ID: ${orderId}\n\nPagamento criado, mas o QR Code/URL não foi retornado.`
        : "Pagamento criado, mas o QR Code/URL não foi retornado.",
      icon: "info"
    });
    return;
  }

  // 🎯 Abre o novo modal de confirmação de pagamento
  showPaymentConfirmationModal({
    plan,
    method,
    amount,
    orderId,
    qrImg,
    pixKey,
    boletoUrl,
    uid: cur.uid
  });

  // Timeout de 5 minutos
  timeoutId = setTimeout(() => {
    console.log("[Payment] Timeout de 5 minutos, parando monitoramento");
    if (unsubscribe) unsubscribe();
  }, 5 * 60 * 1000);
}

// ================================
// PAYMENT CONFIRMATION MODAL
// ================================
function showPaymentConfirmationModal(paymentData) {
  const { plan, method, amount, orderId, qrImg, pixKey, boletoUrl, uid } = paymentData;

  // Preenche dados no modal
  const planBadge = {
    basic: "Plano Basic",
    pro: "Plano Pro",
    family: "Plano Family"
  };

  document.getElementById("paymentPlanBadge").textContent = planBadge[plan] || "Plano";
  document.getElementById("paymentAmount").textContent = `R$ ${amount.toFixed(2).replace(".", ",")}`;
  document.getElementById("paymentOrderId").textContent = orderId;

  // Preenche mídia (QR Code ou Boleto)
  const mediaContainer = document.getElementById("paymentMediaContainer");
  mediaContainer.innerHTML = "";

  if (qrImg && method === "pix") {
    const img = document.createElement("img");
    img.id = "paymentQrImage";
    img.src = qrImg;
    img.alt = "QR Code PIX";
    img.style.maxWidth = "100%";
    img.style.width = "220px";
    img.style.height = "auto";
    img.style.marginBottom = "1rem";
    img.className = "img-fluid";
    mediaContainer.appendChild(img);
  } else if (boletoUrl && method === "boleto") {
    const link = document.createElement("a");
    link.id = "paymentBoletoLink";
    link.href = boletoUrl;
    link.target = "_blank";
    link.className = "btn btn-outline-primary w-100";
    link.textContent = "📄 Abrir Boleto";
    mediaContainer.appendChild(link);
  }

  // Exibir chave PIX se disponível
  const pixKeyContainer = document.getElementById("paymentPixKeyContainer");
  console.log("[Payment Modal] PIX Key Info:", {
    pixKey: pixKey,
    pixKeyExists: !!pixKey,
    method: method,
    isPixMethod: method === "pix",
    containerExists: !!pixKeyContainer,
    willDisplay: !!pixKey && method === "pix"
  });

  if (pixKey && method === "pix") {
    pixKeyContainer.style.display = "block";
    document.getElementById("paymentPixKey").textContent = pixKey;
    console.log("[Payment Modal] ✅ PIX Key exibida:", pixKey);

    // Listener para copiar chave PIX
    const btnCopyPixKey = document.getElementById("btnCopyPixKey");
    btnCopyPixKey.onclick = () => {
      navigator.clipboard.writeText(pixKey).then(() => {
        btnCopyPixKey.textContent = "✅ Copiado!";
        setTimeout(() => {
          btnCopyPixKey.textContent = "📋 Copiar Chave PIX";
        }, 2000);
      }).catch(() => {
        alert("Erro ao copiar. Tente copiar manualmente.");
      });
    };
  } else {
    pixKeyContainer.style.display = "none";
    console.log("[Payment Modal] PIX Key não exibida. Detalhes:", { pixKey, method });
  }

  // Mostra o modal usando a função nativa
  const paymentModalEl = document.getElementById("paymentConfirmModal");
  const paymentModal = createNativeModal(paymentModalEl);
  paymentModal.show();

  // Inicializa timer
  let timeRemaining = 60; // 1 minuto
  const timerElement = document.getElementById("paymentTimer");
  const timerInterval = setInterval(() => {
    timeRemaining--;

    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    timerElement.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    // Muda cor conforme expira
    if (timeRemaining <= 60 && timeRemaining > 30) {
      timerElement.classList.remove("danger", "warning");
    } else if (timeRemaining <= 30 && timeRemaining > 10) {
      timerElement.classList.remove("danger");
      timerElement.classList.add("warning");
    } else if (timeRemaining <= 10) {
      timerElement.classList.remove("warning");
      timerElement.classList.add("danger");
    }

    if (timeRemaining <= 0) {
      clearInterval(timerInterval);
      if (unsubscribePayment) unsubscribePayment();

      // Mostra que expirou
      document.getElementById("paymentWaitingStatus").style.display = "none";
      document.getElementById("paymentMediaContainer").style.display = "none";
    }
  }, 1000);

  // Mostra status de aguardando
  document.getElementById("paymentWaitingStatus").style.display = "block";
  document.getElementById("paymentSuccessStatus").style.display = "none";
  document.getElementById("paymentInfo").style.display = "block";

  // Monitora confirmação do pagamento
  let unsubscribePayment = null;
  const settingsRef = db.collection("users").doc(uid).collection("meta").doc("settings");

  unsubscribePayment = settingsRef.onSnapshot(async (snap) => {
    const newPlan = snap.data()?.plan;

    if (newPlan === plan) {
      console.log("[Payment] ✅ Pagamento confirmado!", newPlan);

      // Salva a data de início do plano para cálculo de renovação
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      try {
        await fbSaveSettings({
          planStartDate: today,
          updatedAt: Date.now()
        });
        console.log("[Payment] planStartDate salvo:", today);
      } catch (e) {
        console.warn("[Payment] Falha ao salvar planStartDate:", e);
      }

      // Para timer
      clearInterval(timerInterval);
      if (unsubscribePayment) unsubscribePayment();

      // Mostra sucesso
      document.getElementById("paymentWaitingStatus").style.display = "none";
      document.getElementById("paymentMediaContainer").style.display = "none";
      document.getElementById("paymentInfo").style.display = "none";
      document.getElementById("paymentSuccessStatus").style.display = "block";

      // Auto-fecha após 2 segundos
      setTimeout(() => {
        paymentModal.hide();
        // Recarrega a página para refletir novo plano
        setTimeout(() => location.reload(), 500);
      }, 2000);
    }
  }, (error) => {
    console.error("[Payment] Erro ao monitorar pagamento:", error);
  });

  // Botão de voltar
  document.getElementById("btnBackFromPayment").addEventListener("click", () => {
    clearInterval(timerInterval);
    if (unsubscribePayment) unsubscribePayment();
  });

  // Botão de fechar (X)
  document.getElementById("btnClosePaymentModal")?.addEventListener("click", () => {
    paymentModal.hide();
    clearInterval(timerInterval);
    if (unsubscribePayment) unsubscribePayment();
  });

  // Botão de copiar ID
  document.getElementById("btnCopyOrderId").addEventListener("click", () => {
    navigator.clipboard.writeText(orderId);
    const btn = document.getElementById("btnCopyOrderId");
    const originalText = btn.textContent;
    btn.textContent = "✓ Copiado!";
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  });
}

async function showPaymentConfirmation(plan) {
  // Remove qualquer modal anterior
  const existingView = document.getElementById("paymentConfirmationView");
  if (existingView) {
    existingView.remove();
  }

  // Cria o container da tela de confirmação
  const confirmView = document.createElement("div");
  confirmView.id = "paymentConfirmationView";
  confirmView.className = "container my-5";
  confirmView.style.minHeight = "100vh";
  confirmView.style.display = "flex";
  confirmView.style.alignItems = "center";
  confirmView.style.justifyContent = "center";

  const planDetails = {
    basic: { name: "Basic", price: "10,90", features: ["Todos os recursos básicos", "Relatórios simples", "Suporte por email"] },
    pro: { name: "Pro", price: "15,90", features: ["Todos os recursos", "Análises avançadas", "Cofre compartilhado", "Suporte prioritário"] },
    family: { name: "Family", price: "25,90", features: ["Plano Pro + múltiplas contas", "Recursos ilimitados", "Suporte 24/7", "Sincronização em tempo real"] }
  };

  const details = planDetails[plan] || planDetails.pro;

  confirmView.innerHTML = `
    <div class="row justify-content-center">
      <div class="col-12 col-md-6 col-lg-5">
        <div class="card shadow-lg rounded-4 border-0 overflow-hidden">
          <!-- Header com gradiente -->
          <div class="p-5 text-center" style="background: linear-gradient(135deg, #0d6efd 0%, #0a58ca 100%); color: white;">
            <div class="mb-3" style="font-size: 64px; animation: bounce 1s ease-in-out;">✅</div>
            <h2 class="fw-bold mb-2">Obrigado!</h2>
            <p class="mb-0">Seu pagamento foi confirmado</p>
          </div>

          <!-- Conteúdo -->
          <div class="card-body p-5">
            <div class="text-center mb-4">
              <div class="alert alert-success border-0 rounded-3" role="alert">
                <strong>Bem-vindo ao plano ${details.name}! 🎉</strong>
              </div>
            </div>

            <div class="mb-4">
              <div class="text-center">
                <div class="display-6 fw-bold text-primary mb-1">R$ ${details.price}</div>
                <small class="text-secondary">por mês</small>
              </div>
            </div>

            <div class="mb-4">
              <h6 class="fw-bold text-dark mb-3">Seu plano inclui:</h6>
              <ul class="list-unstyled">
                ${details.features.map(f => `
                  <li class="mb-2">
                    <span style="color: #28a745; font-weight: bold;">✓</span>
                    <span class="text-secondary">${f}</span>
                  </li>
                `).join("")}
              </ul>
            </div>

            <div class="alert alert-light border-1 rounded-3 mb-4" role="alert">
              <small class="text-secondary">
                <strong>Próxima cobrança:</strong> em 30 dias<br>
                Você pode cancelar a qualquer momento sem penalidades.
              </small>
            </div>

            <div class="d-grid gap-2">
              <button id="btnContinueToApp" class="btn btn-primary btn-lg rounded-3 fw-bold">
                Acessar o Spendify
              </button>
              <button id="btnViewPlans" class="btn btn-outline-secondary btn-sm rounded-3">
                Ver seus planos
              </button>
            </div>

            <div class="text-center mt-4">
              <small class="text-secondary">
                Confirmação enviada para seu email
              </small>
            </div>
          </div>
        </div>

        <!-- Cards informativos -->
        <div class="row g-3 mt-4">
          <div class="col-6">
            <div class="text-center">
              <div style="font-size: 24px; color: #ffc107;">🚀</div>
              <small class="text-secondary d-block mt-2">Acesso imediato</small>
            </div>
          </div>
          <div class="col-6">
            <div class="text-center">
              <div style="font-size: 24px; color: #28a745;">🔒</div>
              <small class="text-secondary d-block mt-2">Pagamento seguro</small>
            </div>
          </div>
        </div>
      </div>
    </div>

    <style>
      @keyframes bounce {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
      }
      
      #paymentConfirmationView .card {
        box-shadow: 0 10px 40px rgba(13, 110, 253, 0.15);
      }
    </style>
  `;

  document.body.appendChild(confirmView);

  // Hide de outras views
  const authView = document.getElementById("authView");
  const appView = document.getElementById("appView");
  const navAuthed = document.getElementById("navAuthed");
  const homeView = document.getElementById("homeView");
  const paymentPendingView = document.getElementById("paymentPendingView");

  if (authView) authView.classList.add("d-none");
  if (appView) appView.classList.add("d-none");
  if (navAuthed) navAuthed.classList.add("d-none");
  if (homeView) homeView.classList.add("d-none");
  if (paymentPendingView) paymentPendingView.classList.add("d-none");

  // Event listeners
  const btnContinue = document.getElementById("btnContinueToApp");
  const btnViewPlans = document.getElementById("btnViewPlans");

  btnContinue?.addEventListener("click", () => {
    confirmView.remove();
    window.location.reload();
  });

  btnViewPlans?.addEventListener("click", () => {
    confirmView.remove();
    showHome();
    const el = document.getElementById("pricingSection");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

btnProfile?.addEventListener("click", async () => {
  try {
    await openProfileFlow();
  } catch (e) {
    console.error(e);
    await uiAlert({
      title: "Erro",
      text: e.message || String(e),
      icon: "error",
    });
  }
});
btnHousehold?.addEventListener("click", async () => {
  try {
    await openHouseholdMenu();
  } catch (e) {
    console.error(e);
    await uiAlert({ title: "Erro", text: e.message || String(e), icon: "error" });
  }
});

btnLeaveHousehold?.addEventListener("click", async () => {
  try {
    await leaveHouseholdFlow();
  } catch (e) {
    console.error(e);
    await uiAlert({ title: "Erro", text: e.message || String(e), icon: "error" });
  }
});
// ================================
// Auth State Listener
let didBoot = false;

async function bootApp() {
  // Config
  const s = await fbLoadSettings();
  state.config = s || {};
  setDefaultsIfNeeded();
  syncConfigToUI();
  updatePlanUI();

  // Listeners
  listenSettings();
  await listenMonth(getSelectedMonthKey());

  renderAll();
}

auth.onAuthStateChanged(async (user) => {
  if (user) {
    UID = user.uid;
    const s = await fbLoadSettings();
    state.config = s || {};
    setDefaultsIfNeeded();
    if (PENDING_PLAN) {
      const p = PENDING_PLAN;
      PENDING_PLAN = null;
      try { await createPaymentFlow(p); } catch { }
    }
    syncConfigToUI();
    let plan = String(state.config.plan || "none");

    // ✅ Verifica se o plano expirou (trial ou renovação)
    if (plan !== "none") {
      const now = Date.now();

      // Trial expira e bloqueia acesso
      if (isTrialPlan(plan) && state.config.planTrialEndDate) {
        if (now > state.config.planTrialEndDate) {
          console.log("[Auth] Trial expirado, bloqueando acesso:", { plan, trialEndDate: state.config.planTrialEndDate });
          await fbSaveSettings({
            plan: "none",
            trialUsed: true,
            planStartDate: null,
            planTrialEndDate: null,
            updatedAt: Date.now()
          });
          state.config.plan = "none";
          state.config.trialUsed = true;
          state.config.planStartDate = null;
          state.config.planTrialEndDate = null;
          plan = "none";
        }
      } else if (isPaidPlan(plan) && state.config.planStartDate) {
        // Plano pago expira em 30 dias sem renovação
        const startDate = new Date(state.config.planStartDate);
        if (!isNaN(startDate.getTime())) {
          const renewalDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
          const nowDate = new Date();
          
          // Se passou da data de renovação, plano expirou
          if (renewalDate < nowDate) {
            console.log("[Auth] Plano expirado, bloqueando acesso:", { plan, renewalDate });
            // Limpa o plano expirado
            await fbSaveSettings({ plan: "none", planStartDate: null, updatedAt: Date.now() });
            state.config.plan = "none";
            state.config.planStartDate = null;
            plan = "none";
          }
        }
      }
    }

    // ✅ Verifica se é usuário Google sem CPF e pede para preenchê-lo
    try {
      await ensureUserHasDocument(user);
    } catch (e) {
      console.warn("Erro ao verificar/pedir document:", e);
    }

    // ✅ Garante que usuário tem free trial se não tiver plano
    try {
      await ensureUserHasTrial(user);
      // Recarrega settings caso tenha sido adicionado trial
      const updatedSettings = await fbLoadSettings();
      if (updatedSettings && updatedSettings.plan && updatedSettings.plan !== "none") {
        state.config = updatedSettings;
        plan = String(state.config.plan || "none");
      }
    } catch (e) {
      console.warn("Erro ao garantir free trial:", e);
    }

    // ✅ Verifica se tem um plano válido, se não bloqueia acesso
    if (plan === "none") {
      console.log("[Auth] Sem plano válido, mostrando tela de pagamento pendente");
      await showPaymentPending(user);
    } else {
      showApp(user);
    }

    try { await upsertUserProfile(user); } catch (e) { console.warn(e); }

    if (!didBoot) {
      didBoot = true;
      await bootApp();
    }
    updatePlanUI();
    updateHouseholdsTabVisibility();
    try { await runProjections(); } catch { }
    try { syncGoalUI(); } catch { }
  } else {
    didBoot = false;
    UID = null;
    showHome();
    const projRows = document.getElementById("projRows");
    if (projRows) projRows.innerHTML = "";
  }
});


// ================================
// Firestore helpers
// Estrutura:
// users/{uid}/meta/settings   -> config
// users/{uid}/tx/{txId}       -> lançamentos (com monthKey)
// ================================
function settingsRef() {
  if (!UID) return null;
  return baseDoc().collection("meta").doc("settings");
}
function txCol() {
  if (!UID) return null;
  return baseDoc().collection("tx");
}

async function fbLoadSettings() {
  if (!UID) return null;
  const snap = await settingsRef().get();
  return snap.exists ? snap.data() : null;
}
async function fbSaveSettings(settings) {
  const ref = settingsRef();
  if (!ref) return; // UID não está definido
  await ref.set(settings, { merge: true });
}

// Cada lança mento é docId = entry.id
async function fbUpsertTx(entry) {
  const col = txCol();
  if (!col) return; // UID não está definido
  entry.id = cleanId(entry.id);
  await col.doc(entry.id).set(entry, { merge: true });
}
async function fbDeleteTx(id) {
  const col = txCol();
  if (!col) return; // UID não está definido
  await col.doc(id).delete();
}

// Lista lançamentos do mês (sem orderBy pra evitar índice)
async function fbListTxByMonth(mKey) {
  const col = txCol();
  if (!col) return []; // UID não está definido
  const snap = await col.where("monthKey", "==", mKey).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Export/Reset precisam de tudo
async function fbListAllTx() {
  const col = txCol();
  if (!col) return []; // UID não está definido
  const snap = await col.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Apagar tudo do usuário (batch em loop)

async function fbDeleteAllTx() {
  const col = txCol();
  if (!col) return; // UID não está definido
  while (true) {
    const snap = await col.limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

function recurringCol() {
  if (!UID) return null;
  return baseDoc().collection("recurring");
}

async function fbDeleteAllRecurring() {
  const col = recurringCol();
  if (!col) return; // UID não está definido
  while (true) {
    const snap = await col.limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

async function fbListRecurring() {
  const col = recurringCol();
  if (!col) return []; // UID não está definido
  const snap = await col.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function fbUpsertRecurring(template) {
  const col = recurringCol();
  if (!col) return template.id; // UID não está definido
  template.id = cleanId(template.id);
  template.updatedAt = Date.now();
  await col.doc(template.id).set(template, { merge: true });
  return template.id;
}

function brl(v) {
  const n = Number(v || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function cleanId(id) {
  const s = String(id || "").trim();
  // Retorna o ID se for válido, caso contrário retorna string vazia
  // uid() será gerado apenas quando necessário
  return s.length > 0 ? s : "";
}

function monthKeyFromDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function monthKeyNow() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function dateFromMonthDay(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1, clamp(day, 1, 31));
  const lastDay = new Date(y, m, 0).getDate();
  d.setDate(Math.min(d.getDate(), lastDay));
  return d.toISOString().slice(0, 10);
}

// ================================
// State (em memória) - Firestore é a fonte de verdade
// ================================
let state = {
  config: {},
  months: {},
};

function getRecurringSkipSetForMonth(mKey) {
  const skippedByMonth = state.config?.recurringSkipped || {};
  const raw = skippedByMonth[mKey];
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.map((x) => String(x || "").trim()).filter(Boolean));
}

async function markRecurringSkippedForMonth(mKey, templateId) {
  const tId = String(templateId || "").trim();
  if (!mKey || !tId) return;

  const skippedByMonth = { ...(state.config.recurringSkipped || {}) };
  const monthList = Array.isArray(skippedByMonth[mKey]) ? skippedByMonth[mKey] : [];
  const set = new Set(monthList.map((x) => String(x || "").trim()).filter(Boolean));
  set.add(tId);

  skippedByMonth[mKey] = [...set];
  state.config.recurringSkipped = skippedByMonth;

  await fbSaveSettings({
    recurringSkipped: skippedByMonth,
    updatedAt: Date.now(),
  });
}

// Expõe state globalmente para módulos externos (como ai-integration.js)
window.appState = state;

// ================================
// UX/Robustez globals
// ================================
let isLoadingMonth = false;
let isSavingEntry = false;
let pendingDelete = new Map(); // id -> { entry, mKey, timer }

function setLoading(v) {
  isLoadingMonth = !!v;
  document.getElementById("monthLoading")?.classList.toggle("d-none", !isLoadingMonth);
  document.getElementById("tableSkeleton")?.classList.toggle("d-none", !isLoadingMonth);
  document.getElementById("rows")?.classList.toggle("d-none", isLoadingMonth);
}

function debounce(fn, wait = 200) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

async function safeRun(actionName, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[${actionName}]`, err);
    await uiAlert({
      title: "Algo deu errado",
      text: `Falha em "${actionName}". Tente novamente.`,
      icon: "error",
    });
    throw err;
  }
}

function showToast(type = "success", title = "Concluído", opts = {}) {
  const {
    text = "",
    timer = 1800,
    position = "top-end",
    confirm = false
  } = opts;

  // normaliza tipo
  const icon = type === "error" ? "error"
    : type === "warning" ? "warning"
      : type === "info" ? "info"
        : "success";

  // SweetAlert2 (bonito)
  if (window.Swal?.fire) {
    return Swal.fire({
      toast: true,
      position,
      icon,
      title,
      text,
      showConfirmButton: confirm,
      confirmButtonText: "OK",
      timer: confirm ? undefined : timer,
      timerProgressBar: !confirm,
      customClass: {
        popup: "pretty-toast"
      },
      showClass: {
        popup: "animate__animated animate__fadeInRight animate__faster"
      },
      hideClass: {
        popup: "animate__animated animate__fadeOutRight animate__faster"
      },
      didOpen: (toast) => {
        if (!confirm) {
          toast.addEventListener("mouseenter", Swal.stopTimer);
          toast.addEventListener("mouseleave", Swal.resumeTimer);
        }
      }
    });
  }

  // fallback Bootstrap
  const toastEl = document.getElementById("appToast");
  const bodyEl = document.getElementById("appToastBody");
  if (toastEl && bodyEl && window.bootstrap?.Toast) {
    bodyEl.textContent = `${title}${text ? " • " + text : ""}`;
    toastEl.classList.remove("text-bg-success", "text-bg-info", "text-bg-warning", "text-bg-danger");
    const cls = {
      success: "text-bg-success",
      info: "text-bg-info",
      warning: "text-bg-warning",
      error: "text-bg-danger",
    };
    toastEl.classList.add(cls[type] || "text-bg-info");
    window.bootstrap.Toast.getOrCreateInstance(toastEl, { autohide: true, delay: timer }).show();
    return;
  }

  // fallback final
  console.log(`[${type}] ${title} ${text}`);
}




function getMonthData(mKey) {
  state.months[mKey] ??= { entries: [] };
  return state.months[mKey];
}
function getSelectedMonthKey() {
  return monthPicker.value || state.config.selectedMonth || monthKeyNow();
}

// ================================
// UI refs
// ================================
const monthPicker = $("#monthPicker");
const salaryMonthly = $("#salaryMonthly");
const autoIncomeEnabled = $("#autoIncomeEnabled");
const autoIncomeDay1 = $("#autoIncomeDay1");
const autoIncomeDay2 = $("#autoIncomeDay2");

const sumIncome = $("#sumIncome");
const sumExpense = $("#sumExpense");
const sumBalance = $("#sumBalance");
const sumPaid = $("#sumPaid");
const paidProgress = $("#paidProgress");

const rows = $("#rows");
const emptyState = $("#emptyState");

const search = $("#search");
const filterType = $("#filterType");
const filterStatus = $("#filterStatus");

const btnGenerateIncome = $("#btnGenerateIncome");
const btnAddExpense = $("#btnAddExpense");
const btnAddIncome = $("#btnAddIncome");
const btnToday = $("#btnToday");
const btnThemeToggle = document.getElementById("btnThemeToggle");

let chart;
let charts = {};

const PAGE_SIZE = 20;
let currentPage = 1;

// Modal
// Modal
const entryModalEl = document.getElementById("entryModal");

function createNativeModal(el) {
  let backdrop = null;

  const show = () => {
    if (!el) return;
    el.style.display = "block";
    el.removeAttribute("aria-hidden");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("role", "dialog");
    el.classList.add("show");

    document.body.classList.add("modal-open");
    document.body.style.overflow = "hidden";

    backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop fade show";
    document.body.appendChild(backdrop);
  };

  const hide = () => {
    if (!el) return;
    const active = document.activeElement;
    if (active && el.contains(active)) {
      try { active.blur(); } catch { }
    }
    el.classList.remove("show");
    el.setAttribute("aria-hidden", "true");
    el.removeAttribute("aria-modal");
    el.style.display = "none";

    document.body.classList.remove("modal-open");
    document.body.style.overflow = "";

    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    backdrop = null;
    cleanupBackdrops();
  };

  // fecha ao clicar no backdrop do próprio modal
  el?.addEventListener("click", (ev) => {
    if (ev.target === el) hide();
  });

  // fecha no ESC
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && el.classList.contains("show")) hide();
  });

  return { show, hide };
}

function cleanupBackdrops() {
  try {
    document.querySelectorAll(".modal-backdrop").forEach((b) => b.remove());
  } catch { }
  document.body.classList.remove("modal-open");
  document.body.style.overflow = "";
}

const entryModal = (() => {
  if (!entryModalEl) {
    console.error('Elemento #entryModal não encontrado.');
    return { show() { }, hide() { } };
  }

  // Bootstrap 5
  if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
    return bootstrap.Modal.getOrCreateInstance(entryModalEl);
  }

  // Bootstrap 5 (global window)
  if (window.bootstrap?.Modal) {
    return window.bootstrap.Modal.getOrCreateInstance(entryModalEl);
  }

  // Bootstrap 4 (jQuery)
  if (window.jQuery && typeof window.jQuery(entryModalEl).modal === "function") {
    return {
      show: () => window.jQuery(entryModalEl).modal("show"),
      hide: () => window.jQuery(entryModalEl).modal("hide"),
    };
  }

  // Fallback sem plugin
  console.warn("Bootstrap Modal plugin não encontrado. Usando fallback nativo.");
  return createNativeModal(entryModalEl);
})();

const entryForm = $("#entryForm");
const entryModalTitle = $("#entryModalTitle");
const entryId = $("#entryId");
const entryType = $("#entryType");
const entryDue = $("#entryDue");
const entryName = $("#entryName");
const entryCategory = $("#entryCategory");
const entryAmount = $("#entryAmount");
const entryPaid = $("#entryPaid");
const entryNotes = $("#entryNotes");
const entryRecurring = $("#entryRecurring");


// ================================
// Config defaults + sync
// ================================
function setDefaultsIfNeeded() {
  const m = monthKeyNow();
  if (!state.config.selectedMonth) state.config.selectedMonth = m;
  if (typeof state.config.salaryMonthly !== "number") state.config.salaryMonthly = 0;
  if (typeof state.config.autoIncomeEnabled !== "boolean") state.config.autoIncomeEnabled = true;
  if (typeof state.config.autoIncomeDay1 !== "number") state.config.autoIncomeDay1 = 5;
  if (typeof state.config.autoIncomeDay2 !== "number") state.config.autoIncomeDay2 = 20;

  // novos defaults de UX
  if (typeof state.config.searchText !== "string") state.config.searchText = "";
  if (!["all", "income", "expense"].includes(state.config.filterType)) state.config.filterType = "all";
  if (!["all", "open", "paid"].includes(state.config.filterStatus)) state.config.filterStatus = "all";
  if (typeof state.config.plan !== "string") state.config.plan = "none";
}


function syncConfigToUI() {
  monthPicker.value = state.config.selectedMonth || monthKeyNow();
  salaryMonthly.value = state.config.salaryMonthly || 0;
  autoIncomeEnabled.checked = !!state.config.autoIncomeEnabled;
  autoIncomeDay1.value = state.config.autoIncomeDay1 ?? 5;
  autoIncomeDay2.value = state.config.autoIncomeDay2 ?? 20;

  // restaura últimos filtros
  if (search) search.value = state.config.searchText || "";
  if (filterType) filterType.value = state.config.filterType || "all";
  if (filterStatus) filterStatus.value = state.config.filterStatus || "all";
  applyTheme();
}

async function syncUIToConfigAndSave() {
  state.config.selectedMonth = getSelectedMonthKey();
  state.config.salaryMonthly = Number(salaryMonthly.value || 0);
  state.config.autoIncomeEnabled = autoIncomeEnabled.checked;
  state.config.autoIncomeDay1 = clamp(Number(autoIncomeDay1.value || 5), 1, 31);
  state.config.autoIncomeDay2 = clamp(Number(autoIncomeDay2.value || 20), 1, 31);
  state.config.updatedAt = Date.now();
  await fbSaveSettings(state.config);
}

function updatePlanUI() {
  const plan = String(state.config.plan || "none");
  const paid = plan === "pro" || plan === "family";
  const isFamily = plan === "family";
  const showEl = (el, on) => { if (el) el.style.display = on ? "" : "none"; };
  const elRecTab = document.getElementById("tab-recorrencias-tab");
  const elProjTab = document.getElementById("tab-proj-tab");
  const elMetasTab = document.getElementById("tab-metas-tab");
  const elCompareTab = document.getElementById("tab-compare-tab");
  showEl(elRecTab, paid);
  showEl(elProjTab, paid);
  showEl(elMetasTab, paid);
  showEl(elCompareTab, paid);

  showEl(btnHousehold, isFamily);
  showEl(btnLeaveHousehold, isFamily);
  if (entryRecurring) entryRecurring.disabled = !paid;
}

// ================================
// Plan Management Page
// ================================
async function showPlanManagementPage() {
  const planManageView = document.getElementById("planManageView");
  const appView = document.getElementById("appView");
  const authView = document.getElementById("authView");
  const homeView = document.getElementById("homeView");
  const navAuthed = document.getElementById("navAuthed");
  const mainNavbar = document.getElementById("mainNavbar");

  // Hide outras views
  if (authView) authView.classList.add("d-none");
  if (appView) appView.classList.add("d-none");
  if (homeView) homeView.classList.add("d-none");

  // Show plano management + navbar
  if (planManageView) planManageView.classList.remove("d-none");
  if (navAuthed) navAuthed.classList.remove("d-none");
  if (mainNavbar) mainNavbar.classList.remove("d-none");

  // Load plano details
  await loadPlanDetails();
}

function showAppFromPlanView() {
  const planManageView = document.getElementById("planManageView");
  const appView = document.getElementById("appView");
  const navAuthed = document.getElementById("navAuthed");
  const mainNavbar = document.getElementById("mainNavbar");

  // Hide plano management
  if (planManageView) planManageView.classList.add("d-none");

  // Show app
  if (appView) appView.classList.remove("d-none");
  if (navAuthed) navAuthed.classList.remove("d-none");
  if (mainNavbar) mainNavbar.classList.remove("d-none");
}

function formatDateBRLong(iso) {
  if (!iso) return "—";
  try {
    const date = new Date(iso + "T00:00:00");
    return date.toLocaleDateString("pt-BR", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return iso;
  }
}

async function loadPlanDetails() {
  try {
    const cur = auth.currentUser;
    if (!cur) return;

    // Carrega configurações (inclui plan, planStartDate, etc)
    const settings = await fbLoadSettings();
    const currentPlan = String(settings?.plan || "none").toLowerCase();
    const planStartDate = settings?.planStartDate || null;
    const planTrialEndDate = settings?.planTrialEndDate || null;

    // Info do plano
    const planInfo = {
      trial: {
        name: "Free Trial",
        price: "0,00",
        icon: "🎁",
        features: [
          `Acesso completo por ${TRIAL_DURATION_DAYS} dias`,
          "Após o trial, escolha um plano pago",
          "Sem cobrança durante o período"
        ]
      },
      basic: {
        name: "Basic",
        price: "10,90",
        icon: "📚",
        features: [
          "1 usuário, 1 cofre pessoal",
          "Lançamentos + filtros",
          "Gráficos básicos"
        ]
      },
      pro: {
        name: "Pro",
        price: "15,90",
        icon: "⭐",
        features: [
          "Recorrências ilimitadas",
          "Metas + projeções",
          "Comparativo de meses",
          "Análises avançadas"
        ]
      },
      family: {
        name: "Family",
        price: "25,90",
        icon: "👨‍👩‍👧‍👦",
        features: [
          "Cofre compartilhado",
          "Papéis (owner/member)",
          "Histórico de alterações",
          "Tudo do plano Pro",
          "Múltiplas contas"
        ]
      },
      none: {
        name: "Sem Plano",
        price: "Acesso Bloqueado",
        icon: "🔒",
        features: ["Assine um plano para acessar", "Planos a partir de R$ 10,90/mês"]
      }
    };

    const info = planInfo[currentPlan] || planInfo.none;

    // Elemento de status
    const planStatus = document.getElementById("planStatus");
    const planName = document.getElementById("planName");
    const planIcon = document.getElementById("planIcon");
    const planPrice = document.getElementById("planPrice");
    const planStartDateEl = document.getElementById("planStartDate");
    const planRenewalDateEl = document.getElementById("planRenewalDate");
    const planExpiredAlert = document.getElementById("planExpiredAlert");
    const planExpiredDate = document.getElementById("planExpiredDate");
    const planActiveAlert = document.getElementById("planActiveAlert");
    const planAutoRenewalDate = document.getElementById("planAutoRenewalDate");
    const planFeaturesEl = document.getElementById("planFeatures");

    // Update view
    if (planName) planName.textContent = info.name;
    if (planIcon) planIcon.textContent = info.icon;
    if (planPrice) planPrice.textContent = `R$ ${info.price}`;

    // Calcula datas
    const now = new Date();
    let startDate = null;
    let renewalDate = null;

    // Valida planStartDate antes de criar a data
    if (planStartDate) {
      startDate = new Date(planStartDate);
      if (isNaN(startDate.getTime())) {
        startDate = null;
      }
    }

    if (currentPlan === "trial" && planTrialEndDate) {
      const trialEnd = new Date(planTrialEndDate);
      if (!isNaN(trialEnd.getTime())) {
        renewalDate = trialEnd;
      }
    } else if (startDate) {
      renewalDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    const isExpired = renewalDate && renewalDate < now;

    // Exibe datas de início e renovação
    if (planStartDateEl) {
      planStartDateEl.textContent = startDate && !isNaN(startDate.getTime()) ? formatDateBRLong(startDate.toISOString().slice(0, 10)) : "—";
    }

    if (planRenewalDateEl) {
      planRenewalDateEl.textContent = renewalDate && !isNaN(renewalDate.getTime()) ? formatDateBRLong(renewalDate.toISOString().slice(0, 10)) : "—";
    }

    // Mostra status (expirado ou ativo)
    if (planExpiredAlert && planActiveAlert) {
      if (isExpired && currentPlan !== "none") {
        planExpiredAlert.classList.remove("d-none");
        planActiveAlert.classList.add("d-none");
        if (planExpiredDate && renewalDate) {
          planExpiredDate.textContent = formatDateBRLong(renewalDate.toISOString().slice(0, 10));
        }
        if (planStatus) {
          planStatus.textContent = "Expirado";
          planStatus.classList.remove("text-bg-primary", "text-bg-success");
          planStatus.classList.add("text-bg-danger");
        }
      } else if (currentPlan !== "none") {
        planExpiredAlert.classList.add("d-none");
        planActiveAlert.classList.remove("d-none");
        if (planAutoRenewalDate && renewalDate) {
          planAutoRenewalDate.textContent = formatDateBRLong(renewalDate.toISOString().slice(0, 10));
        }
        if (planStatus) {
          planStatus.textContent = "Ativo";
          planStatus.classList.remove("text-bg-danger");
          planStatus.classList.add("text-bg-success");
        }
      } else {
        // Plano "none" - sem assinatura
        planExpiredAlert.classList.add("d-none");
        planActiveAlert.classList.add("d-none");
        if (planStatus) {
          planStatus.textContent = "Sem plano";
          planStatus.classList.remove("text-bg-primary", "text-bg-success", "text-bg-danger");
          planStatus.classList.add("text-bg-secondary");
        }
      }
    }

    // Renderiza features
    if (planFeaturesEl) {
      planFeaturesEl.innerHTML = info.features
        .map(f => `
          <div class="col-12 col-md-6">
            <div class="d-flex gap-2 align-items-start">
              <span style="color: #28a745; font-weight: bold; min-width: 20px;">✓</span>
              <span class="text-secondary">${f}</span>
            </div>
          </div>
        `)
        .join("");
    }

    // Status da IA
    const aiStatus = document.getElementById("aiStatus");
    const aiStatusText = document.getElementById("aiStatusText");
    const aiActiveInfo = document.getElementById("aiActiveInfo");
    const aiInactiveActions = document.getElementById("aiInactiveActions");
    const aiRenewalDateText = document.getElementById("aiRenewalDateText");
    const btnContractAI = document.getElementById("btnContractAI");

    // Carrega status da IA
    let userHasAI = false;
    let aiPurchasedAt = null;
    let aiRenewalDateValue = null;
    try {
      const userDoc = await db.collection("users").doc(cur.uid).get();
      if (userDoc.exists) {
        const userData = userDoc.data() || {};
        userHasAI = userData.aiPurchased === true;
        aiPurchasedAt = userData.aiPurchasedAt || null;

        console.log("[AI Debug] Carregando IA:", { userHasAI, aiPurchasedAt, type: typeof aiPurchasedAt });

        // ✅ Calcula e valida data de renovação SEMPRE que tem IA ativa
        if (userHasAI && aiPurchasedAt) {
          // Converte Timestamp do Firebase para millisegundos
          let aiTimestamp = aiPurchasedAt;
          if (aiPurchasedAt.toMillis && typeof aiPurchasedAt.toMillis === 'function') {
            // É um Timestamp do Firebase
            aiTimestamp = aiPurchasedAt.toMillis();
          } else if (aiPurchasedAt.seconds !== undefined) {
            // É um objeto com seconds e nanoseconds
            aiTimestamp = aiPurchasedAt.seconds * 1000 + Math.floor(aiPurchasedAt.nanoseconds / 1000000);
          }

          const aiStart = new Date(aiTimestamp);
          console.log("[AI Debug] Data criada:", { aiStart, isValid: !isNaN(aiStart.getTime()), aiTimestamp });

          if (!isNaN(aiStart.getTime())) {
            const aiRenewal = new Date(aiStart.getTime() + 30 * 24 * 60 * 60 * 1000);
            const now = new Date();

            // Se passou da data de renovação, IA expirou
            if (aiRenewal < now) {
              console.log("[AI] IA expirada, removendo acesso:", { aiRenewal, now });
              // Limpa IA expirada no Firebase
              await db.collection("users").doc(cur.uid).set(
                { aiPurchased: false, aiPurchasedAt: null },
                { merge: true }
              );
              userHasAI = false;
              aiPurchasedAt = null;
              aiRenewalDateValue = null;
            } else {
              // IA ainda está válida
              aiRenewalDateValue = aiRenewal;
              console.log("[AI] IA ativa, data de renovação:", { aiRenewal });
            }
          } else {
            console.warn("[AI] Data de IA inválida:", aiPurchasedAt);
          }
        }
      }
    } catch (e) {
      console.warn("Erro ao carregar status de IA:", e);
    }

    if (aiStatus && aiActiveInfo && aiInactiveActions) {
      // ✅ Mostra como ativo se tem IA com data de renovação válida
      if (userHasAI && aiRenewalDateValue) {
        aiStatus.textContent = "Ativo";
        aiStatus.className = "badge text-bg-success";
        aiActiveInfo.classList.remove("d-none");
        aiInactiveActions.classList.add("d-none");

        if (aiRenewalDateText) {
          aiRenewalDateText.textContent = formatDateBRLong(aiRenewalDateValue.toISOString().slice(0, 10));
        }
      } else {
        aiStatus.textContent = "Não contratada";
        aiStatus.className = "badge text-bg-secondary";
        aiActiveInfo.classList.add("d-none");
        aiInactiveActions.classList.remove("d-none");
      }
    }

    if (btnContractAI) {
      btnContractAI.onclick = async () => {
        await createAIPaymentFlow();
      };
    }

    // Wire up botões
    const btnBackFromPlans = document.getElementById("btnBackFromPlans");
    const btnChangePlan = document.getElementById("btnChangePlan");
    const btnCancelPlan = document.getElementById("btnCancelPlan");
    const btnRenewPlan = document.getElementById("btnRenewPlan");

    if (btnBackFromPlans) {
      btnBackFromPlans.onclick = () => showAppFromPlanView();
    }

    if (btnChangePlan) {
      btnChangePlan.onclick = async () => {
        if (window.Swal && Swal.fire) {
          const res = await Swal.fire({
            title: "Alterar Plano",
            text: "Qual plano deseja escolher?",
            icon: "question",
            showCancelButton: true,
            confirmButtonText: "Pro",
            denyButtonText: "Family",
            cancelButtonText: "Basic",
          });

          let selectedPlan = null;
          if (res.isConfirmed) selectedPlan = "pro";
          else if (res.isDenied) selectedPlan = "family";
          else if (res.dismiss === Swal.DismissReason.cancel) selectedPlan = "basic";

          if (selectedPlan && selectedPlan !== currentPlan) {
            await createPaymentFlow(selectedPlan);
          }
        }
      };
    }

    if (btnCancelPlan) {
      btnCancelPlan.onclick = async () => {
        const ok = await uiConfirm({
          title: "Cancelar assinatura?",
          text: "Você perderá acesso aos recursos premium.",
          icon: "warning",
          confirmButtonText: "Cancelar plano",
          cancelButtonText: "Manter",
          confirmButtonColor: "#dc3545",
        });
        if (ok) {
          await fbSaveSettings({ plan: "none", planStartDate: null, updatedAt: Date.now() });
          state.config.plan = "none";
          state.config.planStartDate = null;
          updatePlanUI();
          await loadPlanDetails();
          showToast("success", "Plano cancelado", 2000);
        }
      };
    }

    if (btnRenewPlan) {
      btnRenewPlan.onclick = async () => {
        // Oferece renovação (mesmo plano)
        await createPaymentFlow(currentPlan);
      };
    }

  } catch (err) {
    console.error("Erro ao carregar detalhes do plano:", err);
    await uiAlert({
      title: "Erro",
      text: "Não foi possível carregar as informações do plano.",
      icon: "error",
    });
  }
}

// ================================
// Entries ops (agora no Firestore)
// ================================
function upsertEntryLocal(mKey, entry) {
  const md = getMonthData(mKey);
  const idx = md.entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) md.entries[idx] = entry;
  else md.entries.push(entry);
}

function deleteEntryLocal(mKey, id) {
  const md = getMonthData(mKey);
  md.entries = md.entries.filter((e) => e.id !== id);
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const da = a.due || "";
    const dbb = b.due || "";
    if (da !== dbb) return da.localeCompare(dbb);
    return (a.type || "").localeCompare(b.type || "");
  });
}

function filteredEntries(entries) {
  const q = (search.value || "").trim().toLowerCase();
  const ft = filterType.value;
  const fs = filterStatus.value;

  return entries.filter((e) => {
    if (ft !== "all" && e.type !== ft) return false;
    if (fs === "paid" && !e.paid) return false;
    if (fs === "open" && e.paid) return false;

    if (q) {
      const blob = `${e.name || ""} ${e.category || ""} ${e.notes || ""}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
}

function paginate(list) {
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  return {
    totalPages,
    pageItems: list.slice(start, start + PAGE_SIZE),
  };
}

function renderPagination(totalPages) {
  const box = document.getElementById("paginationBox");
  if (!box) return;

  if (totalPages <= 1) {
    box.innerHTML = "";
    return;
  }

  box.innerHTML = `
    <div class="d-flex gap-2 justify-content-end align-items-center mt-2">
      <button id="pgPrev" class="btn btn-sm btn-outline-secondary" ${currentPage <= 1 ? "disabled" : ""}>Anterior</button>
      <span class="small text-secondary">Página ${currentPage} de ${totalPages}</span>
      <button id="pgNext" class="btn btn-sm btn-outline-secondary" ${currentPage >= totalPages ? "disabled" : ""}>Próxima</button>
    </div>
  `;

  document.getElementById("pgPrev")?.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderAll();
    }
  });

  document.getElementById("pgNext")?.addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage++;
      renderAll();
    }
  });
}


function computeSummary(entries) {
  const income = entries
    .filter((e) => e.type === "income")
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const expense = entries
    .filter((e) => e.type === "expense")
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const paid = entries
    .filter((e) => e.type === "expense" && e.paid)
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const balance = income - expense;
  const pct = expense > 0 ? (paid / expense) * 100 : 0;
  return { income, expense, paid, balance, pct };
}

function renderSummary(entries) {
  const { income, expense, paid, balance, pct } = computeSummary(entries);
  sumIncome.textContent = brl(income);
  sumExpense.textContent = brl(expense);
  sumPaid.textContent = brl(paid);

  sumBalance.textContent = brl(balance);
  sumBalance.classList.toggle("text-danger", balance < 0);
  sumBalance.classList.toggle("text-success", balance >= 0);

  const p = clamp(pct, 0, 100).toFixed(0);
  paidProgress.style.width = `${p}%`;
  paidProgress.textContent = `${p}%`;
}

function pillType(type) {
  if (type === "income")
    return `<span class="badge rounded-pill pill-type pill-income">Receb.</span>`;
  return `<span class="badge rounded-pill pill-type pill-expense">Despesa</span>`;
}

function formatDateBR(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("pt-BR");
  } catch {
    return iso;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) =>
  ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m])
  );
}

function renderTable(entries) {
  const full = sortEntries(filteredEntries(entries));
  const { pageItems, totalPages } = paginate(full);

  rows.innerHTML = pageItems
    .map((e) => {
      const amount = brl(e.amount);
      const uniqueCheckId = `chk-${e.id}`;
      return `
      <tr class="table-row-highlight">
        <td>${pillType(e.type)}</td>
        <td>
          <div class="fw-semibold">${escapeHtml(e.name || "")}</div>
          ${e.notes ? `<div class="small-muted">${escapeHtml(e.notes)}</div>` : ``}
        </td>
        <td>${escapeHtml(e.category || "-")}</td>
        <td>${formatDateBR(e.due)}</td>
        <td class="text-end fw-bold">${amount}</td>
        <td class="text-center">
          <div class="form-check d-inline-flex align-items-center justify-content-center">
            <input class="form-check-input" type="checkbox" id="${uniqueCheckId}" ${e.paid ? "checked" : ""} data-action="togglePaid" data-id="${e.id}">
          </div>
        </td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-secondary" data-action="edit" data-id="${e.id}">Editar</button>
          <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${e.id}">Excluir</button>
        </td>
      </tr>
    `;
    })
    .join("");

  const any = entries.length > 0;
  emptyState.classList.toggle("d-none", any);

  // Event delegation para melhor performance e evitar duplicatas
  rows.removeEventListener("click", handleRowClick);
  rows.addEventListener("click", handleRowClick);

  rows.removeEventListener("change", handleCheckboxChange);
  rows.addEventListener("change", handleCheckboxChange);

  renderPagination(totalPages);
}

// Handler de clicks nos botões (edit/delete)
function handleRowClick(ev) {
  const target = ev.target;
  if (!target.hasAttribute("data-action")) return;
  
  const action = target.getAttribute("data-action");
  const id = target.getAttribute("data-id");
  
  if (!id) return;
  
  if (action === "edit") {
    ev.preventDefault();
    openEdit(id);
  } else if (action === "delete") {
    ev.preventDefault();
    onDelete(id);
  }
}

// Handler de mudança nos checkboxes
function handleCheckboxChange(ev) {
  const target = ev.target;
  if (target.getAttribute("data-action") !== "togglePaid") return;
  
  const id = target.getAttribute("data-id");
  if (!id) return;
  
  togglePaid(id, target.checked);
}


function buildChart(entries) {
  const legacy = document.getElementById("chart");
  if (!legacy) return;
  const points = {};
  for (const e of entries) {
    if (!e.due) continue;
    const day = e.due.slice(8, 10);
    points[day] ??= { income: 0, expense: 0 };
    if (e.type === "income") points[day].income += Number(e.amount || 0);
    if (e.type === "expense") points[day].expense += Number(e.amount || 0);
  }

  const labels = Object.keys(points).sort((a, b) => Number(a) - Number(b));
  const incomeData = labels.map((d) => points[d].income);
  const expenseData = labels.map((d) => points[d].expense);

  // ✅ Saldo final (Receitas - Despesas) por dia
  const balanceData = labels.map((d) => points[d].income - points[d].expense);

  const ctx = legacy;
  if (chart) {
    try { chart.destroy(); } catch { }
  }

  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels.map((d) => `${d}`),
      datasets: [
        { label: "Receitas", data: incomeData, backgroundColor: "rgba(40, 167, 69, 0.85)" }, // verde (Bootstrap success)
        { label: "Despesas", data: expenseData, backgroundColor: "rgba(220, 53, 69, 0.85)" }, // vermelho (Bootstrap danger)  
        {
          label: "Saldo final",
          data: balanceData,
          backgroundColor: "rgba(255, 193, 7, 0.85)", // amarelo (Bootstrap warning)
          borderColor: "rgba(255, 193, 7, 1)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${brl(ctx.raw)}`,
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (v) => brl(v),
          },
        },
      },
    },
  });
}

function buildDailyChart(entries) {
  const el = document.getElementById("chartDaily");
  if (!el) return;
  const points = {};
  for (const e of entries) {
    if (!e.due) continue;
    const day = e.due.slice(8, 10);
    points[day] ??= { income: 0, expense: 0 };
    if (e.type === "income") points[day].income += Number(e.amount || 0);
    if (e.type === "expense") points[day].expense += Number(e.amount || 0);
  }
  const labels = Object.keys(points).sort((a, b) => Number(a) - Number(b));
  const incomeData = labels.map((d) => points[d].income);
  const expenseData = labels.map((d) => points[d].expense);
  const balanceData = labels.map((d) => points[d].income - points[d].expense);
  if (charts.chartDaily) {
    try { charts.chartDaily.destroy(); } catch { }
  }
  charts.chartDaily = new Chart(el, {
    type: "bar",
    data: {
      labels: labels.map((d) => `${d}`),
      datasets: [
        { label: "Receitas", data: incomeData, backgroundColor: "rgba(40, 167, 69, 0.85)" },
        { label: "Despesas", data: expenseData, backgroundColor: "rgba(220, 53, 69, 0.85)" },
        { label: "Saldo final", data: balanceData, backgroundColor: "rgba(255, 193, 7, 0.85)", borderColor: "rgba(255,193,7,1)", borderWidth: 1 },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${brl(ctx.raw)}` } },
      },
      scales: { y: { ticks: { callback: (v) => brl(v) } } },
    },
  });
}

function buildCategoryChart(entries) {
  const el = document.getElementById("chartByCategory");
  if (!el) return;
  const totals = {};
  for (const e of entries) {
    if (e.type !== "expense") continue;
    const cat = (e.category || "Outros").trim();
    totals[cat] = (totals[cat] || 0) + Number(e.amount || 0);
  }
  const labels = Object.keys(totals);
  const data = labels.map((k) => totals[k]);
  const colors = labels.map((_, i) => `hsl(${(i * 47) % 360} 70% 55% / 0.9)`);
  if (charts.chartByCategory) {
    try { charts.chartByCategory.destroy(); } catch { }
  }
  charts.chartByCategory = new Chart(el, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors }] },
    options: {
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${brl(ctx.raw)}` } },
      },
    },
  });
}



function renderAll() {
  // Mostrar loader
  const loader = document.getElementById('tableRefreshLoader');
  if (loader) {
    loader.classList.remove('d-none');
  }

  const mKey = getSelectedMonthKey();
  const md = getMonthData(mKey);
  const entries = md.entries || [];

  try {
    renderSummary(entries);
    renderTable(entries);
    buildChart(entries);
    buildDailyChart(entries);
    buildCategoryChart(entries);
    updateHouseholdsTabVisibility();
    updateGoalUI();
  } finally {
    // Esconder loader com pequeno delay para visualizar o efeito
    if (loader) {
      setTimeout(() => {
        loader.classList.add('d-none');
      }, 200);
    }
  }
}

// ================================
// Controle de visibilidade da tab Cofres (apenas plano Family)
// ================================
function updateHouseholdsTabVisibility() {
  const tabNav = document.getElementById("tab-cofres-nav");
  if (!tabNav) return;

  const plan = String(state.config.plan || "none").toLowerCase();

  if (plan === "family") {
    tabNav.style.display = "";
  } else {
    tabNav.style.display = "none";
  }
}

// ================================
// Modal handlers
// ================================
function openNew(type) {
  // Valida o tipo
  if (type !== "income" && type !== "expense") {
    console.error("openNew: Tipo inválido", type);
    type = "expense";
  }

  // Reseta o formulário completamente
  entryForm.reset();

  // Preenche com valores padrão
  entryModalTitle.textContent = type === "income" ? "Novo Recebimento" : "Nova Despesa";
  entryId.value = "";
  entryType.value = type;
  entryName.value = "";
  entryCategory.value = "";
  entryAmount.value = "";
  entryPaid.checked = false;
  entryNotes.value = "";

  if (entryRecurring) entryRecurring.checked = false;

  const mKey = getSelectedMonthKey();
  const iso = dateFromMonthDay(mKey, new Date().getDate());
  entryDue.value = iso;

  // Remove backdrop duplicado antes de abrir
  cleanupBackdrops();

  entryModal.show();
}

function openEdit(id) {
  if (!id) {
    console.error("openEdit: ID inválido", id);
    return;
  }

  const mKey = getSelectedMonthKey();
  const md = getMonthData(mKey);
  const e = md.entries.find((x) => x.id === id);
  
  if (!e) {
    console.error("openEdit: Lançamento não encontrado", id);
    showToast("error", "Lançamento não encontrado", { timer: 2000 });
    return;
  }

  // Limpa o formulário primeiro
  entryForm.reset();

  // Preenche com os dados do lançamento
  entryModalTitle.textContent = "Editar Lançamento";
  entryId.value = e.id || "";
  entryType.value = e.type || "expense";
  entryDue.value = e.due || "";
  entryName.value = e.name || "";
  entryCategory.value = e.category || "";
  entryAmount.value = Number(e.amount || 0);
  entryPaid.checked = !!e.paid;
  entryNotes.value = e.notes || "";

  if (entryRecurring) entryRecurring.checked = !!e.recurring;

  // Remove backdrop duplicado antes de abrir
  cleanupBackdrops();
  
  entryModal.show();
}

async function onDelete(id) {
  // Validação de ID
  if (!id) {
    console.error("onDelete: ID inválido", id);
    return;
  }

  const mKey = getSelectedMonthKey();
  const md = getMonthData(mKey);
  const e = md.entries.find((x) => x.id === id);
  
  // Validação de lançamento
  if (!e) {
    console.error("onDelete: Lançamento não encontrado", id);
    showToast("error", "Lançamento não encontrado", 2000);
    return;
  }

  const ok = await uiConfirm({
    title: "Excluir lançamento?",
    text: `“${e.name}” será removido.`,
    icon: "warning",
    confirmButtonText: "Excluir",
    cancelButtonText: "Cancelar",
    confirmButtonColor: "#dc3545",
  });
  if (!ok) return;

  // Se for instância recorrente, não recria novamente neste mês.
  if (e.recurring && e.instanceOf) {
    await markRecurringSkippedForMonth(mKey, e.instanceOf);
  }

  // Cópia profunda para rollback confiável em caso de falha no backend
  const entryCopy = JSON.parse(JSON.stringify(e));

  // Remove local imediatamente para resposta rápida da UI
  deleteEntryLocal(mKey, id);
  renderAll();

  await safeRun("excluir lançamento", async () => {
    try {
      await fbDeleteTx(id);
      showToast("success", "Lançamento excluído ✅", 1200);
    } catch (err) {
      console.error("Erro ao excluir do Firebase:", err);
      upsertEntryLocal(mKey, entryCopy);
      renderAll();
      showToast("error", "Falha ao excluir. Item restaurado.", 3000);
    }
  }).catch(() => {
    // Mensagens já tratadas acima
  });
}


let togglePaidInProgress = new Set();

async function togglePaid(id, paid) {
  if (!id) return;
  
  // Evita múltiplas execuções simultâneas para o mesmo ID
  if (togglePaidInProgress.has(id)) {
    console.log("togglePaid: Já em processamento", id);
    return;
  }

  const mKey = getSelectedMonthKey();
  const md = getMonthData(mKey);
  const e = md.entries.find((x) => x.id === id);
  
  if (!e) {
    console.error("togglePaid: Lançamento não encontrado", id);
    return;
  }

  // Se o estado já é o desejado, não faz nada
  if (e.paid === !!paid) {
    return;
  }

  togglePaidInProgress.add(id);

  try {
    await safeRun("alterar status de pagamento", async () => {
      e.paid = !!paid;
      e.updatedAt = Date.now();
      await fbUpsertTx(e);
      upsertEntryLocal(mKey, e);
      
      // Renderiza sem acionar novos eventos
      renderSummary(md.entries || []);
      
      showToast("success", e.paid ? "Marcado como pago ✅" : "Marcado como em aberto ⏳", { timer: 1200 });
    });
  } finally {
    togglePaidInProgress.delete(id);
  }
}


// ================================
// Auto income (gera e salva no Firestore)
// ================================
async function generateAutoIncome() {
  await syncUIToConfigAndSave();

  const mKey = getSelectedMonthKey();

  // trava anti-duplicação por mês
  state.config.autoIncomeGenerated ??= {};
  if (state.config.autoIncomeGenerated[mKey]) {
    alert("Recebimentos automáticos desse mês já foram gerados.");
    return;
  }

  const salary = Number(state.config.salaryMonthly || 0);

  if (salary <= 0) {
    alert("Informe o salário do mês para gerar os recebimentos.");
    return;
  }
  if (!state.config.autoIncomeEnabled) {
    alert("Ative 'Recebimentos automáticos' para gerar.");
    return;
  }

  const day1 = state.config.autoIncomeDay1 ?? 5;
  const day2 = state.config.autoIncomeDay2 ?? 20;

  // Remove os auto gerados anteriores (no mês)
  state.config.autoIncomeGenerated ??= {};
  state.config.autoIncomeGenerated[mKey] = false;
  const md = getMonthData(mKey);
  const toDelete = (md.entries || []).filter((e) => e.autoIncome).map((e) => e.id);
  for (const id of toDelete) await fbDeleteTx(id);
  md.entries = (md.entries || []).filter((e) => !e.autoIncome);

  const half = Math.round((salary / 2) * 100) / 100;
  const rest = Math.round((salary - half) * 100) / 100;

  const e1 = {
    id: uid(),
    monthKey: mKey,
    type: "income",
    name: "Salário (parcela 1)",
    category: "Salário",
    amount: half,
    due: dateFromMonthDay(mKey, day1),
    paid: true,
    notes: "Gerado automaticamente",
    autoIncome: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const e2 = {
    id: uid(),
    monthKey: mKey,
    type: "income",
    name: "Salário (parcela 2)",
    category: "Salário",
    amount: rest,
    due: dateFromMonthDay(mKey, day2),
    paid: false,
    notes: "Gerado automaticamente",
    autoIncome: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Salva no Firestore
  await fbUpsertTx(e1);
  await fbUpsertTx(e2);

  // marca como gerado pra não duplicar
  state.config.autoIncomeGenerated[mKey] = true;
  await fbSaveSettings({ autoIncomeGenerated: state.config.autoIncomeGenerated, updatedAt: Date.now() });

  // Local
  md.entries.push(e1, e2);

  renderAll();
}


async function ensureRecurringForMonth(mKey) {
  // Cria instâncias mensais para templates recorrentes que ainda não existem neste mês
  const templates = await fbListRecurring();
  if (!templates.length) return;

  const existing = await fbListTxByMonth(mKey);
  const existingInstanceOf = new Set(existing.map((e) => e.instanceOf).filter(Boolean));
  const skippedInstanceOf = getRecurringSkipSetForMonth(mKey);

  let wrote = 0;
  const batch = db.batch();
  const col = txCol();

  if (!col) return; // UID não está definido

  for (const t of templates) {
    if (t.enabled === false) continue;
    if ((t.freq || "monthly") !== "monthly") continue;

    const templateId = String(t.id || "").trim();
    if (!templateId) continue;

    if (existingInstanceOf.has(templateId)) continue;
    if (skippedInstanceOf.has(templateId)) continue;

    const day = clamp(Number(t.dayOfMonth || 1), 1, 31);
    const due = dateFromMonthDay(mKey, day);

    const entry = {
      id: uid(),
      monthKey: mKey,
      type: t.type || "expense",
      name: t.name || "Recorrente",
      category: t.category || "",
      amount: Number(t.amount || 0),
      due,
      paid: false,
      notes: t.notes || "",
      autoIncome: false,
      recurring: true,
      instanceOf: templateId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    batch.set(col.doc(entry.id), entry, { merge: true });
    wrote++;
  }

  if (wrote > 0) await batch.commit();
}


// ================================
// Realtime listeners
// ================================
var unsubscribeTx = null;
var unsubscribeSettings = null;

function stopListeners() {
  if (typeof unsubscribeTx === "function") unsubscribeTx();
  if (typeof unsubscribeSettings === "function") unsubscribeSettings();
  unsubscribeTx = null;
  unsubscribeSettings = null;
}

function listenSettings() {
  if (unsubscribeSettings) unsubscribeSettings();
  const ref = settingsRef();
  if (!ref) return; // UID não está definido
  unsubscribeSettings = ref.onSnapshot((snap) => {
    if (!snap.exists) return;
    const s = snap.data() || {};
    state.config = { ...state.config, ...s };
    setDefaultsIfNeeded();
    syncConfigToUI();
  });
}

async function listenMonth(mKey) {
  if (unsubscribeTx) unsubscribeTx();

  setLoading(true);

  // limpa local do mês antes de repopular
  state.months[mKey] = { entries: [] };

  // garante recorrências antes do snapshot
  await ensureRecurringForMonth(mKey);

  const col = txCol();
  if (!col) {
    setLoading(false);
    return; // UID não está definido
  }

  unsubscribeTx = col
    .where("monthKey", "==", mKey)
    .onSnapshot(
      (snap) => {
        const md = getMonthData(mKey);
        md.entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setLoading(false);
        renderAll();
      },
      (err) => {
        console.error("onSnapshot month error:", err);
        setLoading(false);
        uiAlert({
          title: "Erro de sincronização",
          text: "Não foi possível sincronizar os lançamentos agora.",
          icon: "error",
        });
      }
    );
}




// ================================
// Events
// ================================
monthPicker?.addEventListener("change", async () => {
  // salva mês escolhido no settings
  state.config.selectedMonth = monthPicker.value || monthKeyNow();
  await fbSaveSettings({ selectedMonth: state.config.selectedMonth, updatedAt: Date.now() });

  // muda listener
  await listenMonth(state.config.selectedMonth);
  renderAll();

});

salaryMonthly?.addEventListener("change", async () => {
  await syncUIToConfigAndSave();
  renderAll();
});
autoIncomeEnabled?.addEventListener("change", async () => {
  await syncUIToConfigAndSave();
});
autoIncomeDay1?.addEventListener("change", async () => {
  await syncUIToConfigAndSave();
});
autoIncomeDay2?.addEventListener("change", async () => {
  await syncUIToConfigAndSave();
});

search?.addEventListener("input", () => {
  renderAll();
  persistFiltersDebounced();
});

filterType?.addEventListener("change", () => {
  renderAll();
  persistFiltersDebounced();
});

filterStatus?.addEventListener("change", () => {
  renderAll();
  persistFiltersDebounced();
});

document.addEventListener("keydown", (ev) => {
  const tag = (ev.target?.tagName || "").toLowerCase();
  const typing = ["input", "textarea", "select"].includes(tag);
  if (typing) return;

  if (ev.key.toLowerCase() === "n") {
    ev.preventDefault();
    openNew("expense");
  }
  if (ev.key.toLowerCase() === "r") {
    ev.preventDefault();
    openNew("income");
  }
});

btnThemeToggle?.addEventListener("click", async () => {
  state.config.darkMode = !state.config.darkMode;
  state.config.updatedAt = Date.now();
  applyTheme();
  await fbSaveSettings({ darkMode: state.config.darkMode, updatedAt: state.config.updatedAt });
  showToast("success", state.config.darkMode ? "Tema escuro ativado 🌙" : "Tema claro ativado ☀️", 1200);
});


btnGenerateIncome?.addEventListener("click", generateAutoIncome);
btnAddExpense?.addEventListener("click", () => openNew("expense"));
btnAddIncome?.addEventListener("click", () => openNew("income"));

btnToday?.addEventListener("click", async () => {
  state.config.selectedMonth = monthKeyNow();
  await fbSaveSettings({ selectedMonth: state.config.selectedMonth, updatedAt: Date.now() });
  syncConfigToUI();
  await listenMonth(state.config.selectedMonth);
  renderAll();

});

entryForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (isSavingEntry) return;

  await safeRun("salvar lançamento", async () => {
    isSavingEntry = true;

    const btnSave = document.getElementById("btnSaveEntry");
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.textContent = "Salvando...";
    }

    const mKey = getSelectedMonthKey();

    // IMPORTANTE: captura o valor antes de qualquer hide/reset
    const currentId = cleanId(entryId.value);
    const isEdit = !!currentId;
    const now = Date.now();

    const rawName = (entryName.value || "").replace(/\s+/g, " ").trim();
    const rawCategory = (entryCategory.value || "").replace(/\s+/g, " ").trim();
    const dueVal = (entryDue.value || "").trim();
    const amountVal = Number(entryAmount.value || 0);

    // validações de negócio
    if (rawName.length < 3) {
      throw new Error("Nome deve ter ao menos 3 caracteres.");
    }
    if (!dueVal || Number.isNaN(new Date(`${dueVal}T00:00:00`).getTime())) {
      throw new Error("Data de vencimento inválida.");
    }
    if (!(amountVal > 0)) {
      throw new Error("Valor deve ser maior que zero.");
    }
    if (entryType.value === "expense" && !rawCategory) {
      throw new Error("Informe a categoria da despesa.");
    }

    // mantém createdAt em edição
    let createdAt = now;
    if (isEdit) {
      const md = getMonthData(mKey);
      const old = md.entries.find((x) => x.id === currentId);
      if (old?.createdAt) createdAt = old.createdAt;
    }

    const entry = {
      id: currentId || uid(),
      monthKey: mKey,
      type: entryType.value,
      name: rawName,
      category: rawCategory,
      amount: amountVal,
      due: dueVal,
      paid: !!entryPaid.checked,
      notes: (entryNotes.value || "").replace(/\s+/g, " ").trim(),
      autoIncome: false,
      recurring: !!(entryRecurring && entryRecurring.checked),
      createdAt,
      updatedAt: now,
    };

    // recorrência
    if (entry.recurring) {
      const dayOfMonth = Number((entry.due || "").slice(8, 10) || 1);
      const template = {
        id: entry.instanceOf || uid(),
        enabled: true,
        freq: "monthly",
        dayOfMonth,
        type: entry.type,
        name: entry.name,
        category: entry.category,
        amount: entry.amount,
        notes: entry.notes,
      };
      const templateId = await fbUpsertRecurring(template);
      entry.instanceOf = templateId;
    }

    await fbUpsertTx(entry);
    upsertEntryLocal(mKey, entry);
    renderAll();

    // Se foi marcado como recorrente, recarrega a lista de recorrências
    if (entry.recurring) {
      try {
        await loadRecurringAndRender();
      } catch (e) {
        console.warn("Erro ao recarregar recorrências:", e);
      }
    }

    showToast("success", isEdit ? "Alterações aplicadas ✏️" : "Lançamento salvo ✅");


    // hide só depois do toast/set de estado
    entryModal.hide();
  }).catch(async (err) => {
    const msg = err?.message || "Confira os campos.";
    showToast("warning", msg, 2200);
    await uiAlert({
      title: "Validação",
      text: msg,
      icon: "warning",
    });
  }).finally(() => {
    isSavingEntry = false;
    const btnSave = document.getElementById("btnSaveEntry");
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.textContent = "Salvar";
    }
  });
});



document.querySelectorAll('#entryModal [data-bs-dismiss="modal"]').forEach((btn) => {
  btn.addEventListener("click", () => {
    entryModal.hide();
    cleanupBackdrops();
  });
});





// ================================
// Features: Projeções, Metas, Período, Comparativo
// ================================
function monthKeyAdd(mk, delta) {
  const [y, m] = mk.split("-").map(Number);
  const d0 = new Date(y, m - 1 + delta, 1);
  const yy = d0.getFullYear();
  const mm = String(d0.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}
function computeSummary(list) {
  let income = 0, expense = 0, paid = 0;
  for (const e of list) {
    const v = Number(e.amount || 0);
    if (e.type === "income") income += v;
    if (e.type === "expense") {
      expense += v;
      if (e.paid) paid += v;
    }
  }
  const balance = income - expense;
  const pct = expense ? (paid / expense) * 100 : 0;
  return { income, expense, paid, balance, pct };
}
async function runProjections() {
  const projRows = document.getElementById("projRows");
  if (!projRows) return;
  if (!UID) return;
  try {
    const mk = (state?.config?.selectedMonth) || monthKeyNow();
    const rec = await fbListRecurring();
    const salary = Number(state?.config?.salaryMonthly || 0);
    const autoEnabled = !!state?.config?.autoIncomeEnabled;
    const months = [mk, monthKeyAdd(mk, 1), monthKeyAdd(mk, 2)];
    projRows.innerHTML = months.map((mkey) => {
      const incomeRec = rec.filter((r) => (r.type || "expense") === "income").reduce((a, b) => a + Number(b.amount || 0), 0);
      const expenseRec = rec.filter((r) => (r.type || "expense") === "expense").reduce((a, b) => a + Number(b.amount || 0), 0);
      const income = (autoEnabled ? salary : 0) + incomeRec;
      const expense = expenseRec;
      const balance = income - expense;
      return `
        <tr>
          <td>${mkey}</td>
          <td class="text-end">${brl(income)}</td>
          <td class="text-end">${brl(expense)}</td>
          <td class="text-end fw-bold">${brl(balance)}</td>
        </tr>
      `;
    }).join("");
  } catch (e) {
    console.error(e);
  }
}

// ================================
// METAS MELHORADAS
// ================================
function getGoalPreferences() {
  return state.config.categoryGoals || {};
}

async function saveGoalPreferences(prefs) {
  state.config.categoryGoals = prefs;
  state.config.updatedAt = Date.now();
  await fbSaveSettings({ categoryGoals: prefs, updatedAt: state.config.updatedAt });
}

function updateGoalUI() {
  const mKey = getSelectedMonthKey();
  const md = getMonthData(mKey);
  const goalValEl = document.getElementById("goalMonthly");
  const goalVal = Number(goalValEl?.value || state.config.goalMonthly || 0);

  // Calcular economia do mês
  const entries = md.entries || [];
  const totalIncome = entries.filter(e => e.type === "income").reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalExpense = entries.filter(e => e.type === "expense").reduce((s, e) => s + Number(e.amount || 0), 0);
  const savings = totalIncome - totalExpense;

  // Mostrar/esconder seções
  const progressContainer = document.getElementById("goalProgressContainer");
  const emptyState = document.getElementById("goalEmptyState");
  if (goalVal > 0) {
    progressContainer?.style.setProperty("display", "block");
    emptyState?.style.setProperty("display", "none");
  } else {
    progressContainer?.style.setProperty("display", "none");
    emptyState?.style.setProperty("display", "block");
    return;
  }

  // Atualizar barra de progresso
  const percent = goalVal > 0 ? Math.min(100, Math.round((savings / goalVal) * 100)) : 0;
  const progressBar = document.getElementById("goalProgressBar");
  const progressPercent = document.getElementById("goalProgressPercent");
  const goalSaved = document.getElementById("goalSaved");
  const goalRemaining = document.getElementById("goalRemaining");
  const goalStatus = document.getElementById("goalStatus");

  if (progressBar) {
    progressBar.style.width = percent + "%";
    progressBar.className = "progress-bar progress-bar-striped";
    if (percent >= 100) progressBar.classList.add("bg-success");
    else if (percent >= 75) progressBar.classList.add("bg-info");
    else if (percent >= 50) progressBar.classList.add("bg-warning");
    else progressBar.classList.add("bg-danger");
  }
  if (progressPercent) progressPercent.textContent = percent + "%";
  if (goalSaved) goalSaved.textContent = brl(Math.max(0, savings));
  if (goalRemaining) goalRemaining.textContent = brl(Math.max(0, goalVal - savings));

  // Status message
  if (goalStatus) {
    let msg = "";
    if (savings >= goalVal) {
      msg = "✅ <strong>Meta atingida!</strong> Você já economizou o que se propôs.";
    } else {
      const daysLeft = new Date(mKey.slice(0, 4), mKey.slice(5) - 1 + 1, 0).getDate() - new Date().getDate();
      const dailyNeeded = daysLeft > 0 ? (goalVal - savings) / daysLeft : 0;
      if (dailyNeeded > 0) {
        msg = `Você precisa economizar <strong>${brl(dailyNeeded)}/dia</strong> para atingir a meta (${daysLeft} dias restantes).`;
      }
    }
    goalStatus.innerHTML = msg;
  }

  renderCategoryGoals();
  renderGoalHistory();
}

function renderCategoryGoals() {
  const container = document.getElementById("categoryGoalsContainer");
  const emptyState = document.getElementById("categoryGoalsEmpty");
  if (!container) return;

  const prefs = getGoalPreferences();
  const cats = Object.entries(prefs);

  if (cats.length === 0) {
    container.innerHTML = "";
    emptyState?.style.setProperty("display", "block");
    return;
  }

  emptyState?.style.setProperty("display", "none");
  container.innerHTML = cats.map(([cat, limit]) => {
    const mKey = getSelectedMonthKey();
    const md = getMonthData(mKey);
    const entries = md.entries || [];
    const spent = entries
      .filter(e => e.type === "expense" && e.category === cat)
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    const percent = Math.min(100, Math.round((spent / limit) * 100));
    const badgeColor = spent > limit ? "bg-danger" : spent > limit * 0.75 ? "bg-warning" : "bg-success";

    return `
      <div>
        <div class="flex-grow-1">
          <small class="fw-bold">${escapeHtml(cat)}</small>
          <div class="progress mt-1" style="height: 16px;">
            <div class="progress-bar ${badgeColor}" style="width: ${percent}%;" role="progressbar"></div>
          </div>
          <small class="text-muted">${brl(spent)} / ${brl(limit)}</small>
        </div>
        <button class="btn btn-sm btn-close goal-cat-delete" data-cat="${escapeHtml(cat)}"></button>
      </div>
    `;
  }).join("");

  // Listeners para remover
  container.querySelectorAll(".goal-cat-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const cat = btn.getAttribute("data-cat");
      const prefs = getGoalPreferences();
      delete prefs[cat];
      await saveGoalPreferences(prefs);
      updateGoalUI();
      showToast("success", "Limite removido ✅", 1200);
    });
  });
}

function renderGoalHistory() {
  const container = document.getElementById("goalHistoryContainer");
  if (!container) return;

  // Usar o mês selecionado como referência, não a data atual
  const selectedMKey = getSelectedMonthKey();
  const [year, month] = selectedMKey.split("-").map(Number);

  const months = [-2, -1, 0].map(offset => {
    const d = new Date(year, month - 1 + offset, 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  });

  let html = "";
  months.forEach(mKey => {
    const md = getMonthData(mKey);
    const entries = md.entries || [];
    const totalIncome = entries.filter(e => e.type === "income").reduce((s, e) => s + Number(e.amount || 0), 0);
    const totalExpense = entries.filter(e => e.type === "expense").reduce((s, e) => s + Number(e.amount || 0), 0);
    const savings = totalIncome - totalExpense;
    const goal = state.config.goalMonthly || 0;
    const percent = goal > 0 ? Math.min(100, Math.round((savings / goal) * 100)) : 0;
    const badgeColor = savings >= goal ? "bg-success" : savings > goal * 0.5 ? "bg-warning" : "bg-danger";

    const monthLabel = new Date(mKey + "-01").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

    html += `
      <div class="col-12 col-md-4">
        <div class="goal-history-card">
          <div class="small text-muted text-capitalize">${monthLabel}</div>
          <div class="fw-bold mt-1">${brl(savings)}</div>
          <div class="small text-muted">de ${brl(goal)}</div>
          ${goal > 0 ? `<span class="goal-history-badge badge ${badgeColor}">${percent}%</span>` : ""}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function syncGoalUI() {
  const goalMonthly = document.getElementById("goalMonthly");
  const g = Number(state?.config?.goalMonthly || 0);
  if (goalMonthly) goalMonthly.value = g || 0;
  updateGoalUI();
}

async function saveGoal() {
  const goalMonthly = document.getElementById("goalMonthly");
  const v = Number(goalMonthly?.value || 0);
  state.config.goalMonthly = v;
  state.config.updatedAt = Date.now();
  await fbSaveSettings({ goalMonthly: v, updatedAt: state.config.updatedAt });
  updateGoalUI();
  showToast("success", v > 0 ? "Meta salva ✅" : "Meta removida", 1200);
}
async function runPeriod() {
  const periodIncome = document.getElementById("periodIncome");
  const periodExpense = document.getElementById("periodExpense");
  const periodBalance = document.getElementById("periodBalance");
  const periodStart = document.getElementById("periodStart");
  const periodEnd = document.getElementById("periodEnd");
  if (!periodIncome || !periodExpense || !periodBalance) return;
  if (!UID) return;
  const s = periodStart?.value;
  const e = periodEnd?.value;
  if (!s || !e) return;
  try {
    const all = await fbListAllTx();
    const list = all.filter((x) => x.monthKey >= s && x.monthKey <= e);
    const sum = computeSummary(list);
    periodIncome.textContent = brl(sum.income);
    periodExpense.textContent = brl(sum.expense);
    periodBalance.textContent = brl(sum.balance);
  } catch (err) {
    console.error(err);
  }
}
async function runCompare() {
  const cmpRows = document.getElementById("cmpRows");
  const cmpA = document.getElementById("cmpA");
  const cmpB = document.getElementById("cmpB");
  if (!cmpRows) return;
  if (!UID) return;
  const a = cmpA?.value || monthKeyNow();
  const b = cmpB?.value || monthKeyAdd(a, -1);
  try {
    const ta = await fbListTxByMonth(a);
    const tb = await fbListTxByMonth(b);
    const sa = computeSummary(ta);
    const sb = computeSummary(tb);
    cmpRows.innerHTML = `
      <tr>
        <td>${a}</td>
        <td class="text-end">${brl(sa.income)}</td>
        <td class="text-end">${brl(sa.expense)}</td>
        <td class="text-end fw-bold">${brl(sa.balance)}</td>
      </tr>
      <tr>
        <td>${b}</td>
        <td class="text-end">${brl(sb.income)}</td>
        <td class="text-end">${brl(sb.expense)}</td>
        <td class="text-end fw-bold">${brl(sb.balance)}</td>
      </tr>
      <tr>
        <td>Diferença</td>
        <td class="text-end">${brl(sa.income - sb.income)}</td>
        <td class="text-end">${brl(sa.expense - sb.expense)}</td>
        <td class="text-end fw-bold">${brl(sa.balance - sb.balance)}</td>
      </tr>
    `;
  } catch (err) {
    console.error(err);
  }
}
document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.getElementById("mainTabs");
  if (tabs && window.bootstrap?.Tab) {
    tabs.querySelectorAll('[data-bs-toggle="tab"]').forEach((btn) => {
      btn.addEventListener("shown.bs.tab", () => {
        const mKey = getSelectedMonthKey();
        const md = getMonthData(mKey);
        const entries = md.entries || [];
        buildDailyChart(entries);
        buildCategoryChart(entries);
        runProjections();
        syncGoalUI();
      });
    });
  }
  document.getElementById("btnAddExpense")?.addEventListener("click", () => openNew("expense"));
  document.getElementById("btnAddIncome")?.addEventListener("click", () => openNew("income"));
  document.getElementById("goalSaveBtn")?.addEventListener("click", saveGoal);

  // Adicionar limite por categoria
  document.getElementById("btnAddCategoryGoal")?.addEventListener("click", async () => {
    if (window.Swal && Swal.fire) {
      const categories = getCategories().sort((a, b) => a.localeCompare(b));
      const categoryOptions = categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join("");

      const res = await Swal.fire({
        title: "Adicionar Limite de Categoria",
        html: `
          <div class="text-start">
            <label class="form-label fw-bold">Categoria</label>
            <select id="limitCat" class="form-select form-select-sm mb-3">
              <option value="">-- Selecione --</option>
              ${categoryOptions}
            </select>
            
            <label class="form-label fw-bold">Limite Mensal (R$)</label>
            <input id="limitAmount" type="number" class="form-control form-control-sm" min="0" step="0.01" placeholder="0,00">
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: "Adicionar",
        cancelButtonText: "Cancelar",
        preConfirm: () => {
          const cat = window.document.getElementById("limitCat")?.value?.trim();
          const amount = Number(window.document.getElementById("limitAmount")?.value || 0);
          if (!cat) {
            Swal.showValidationMessage("Selecione uma categoria");
            return false;
          }
          if (amount <= 0) {
            Swal.showValidationMessage("Informe um limite válido");
            return false;
          }
          return { cat, amount };
        }
      });

      if (res.isConfirmed) {
        const prefs = getGoalPreferences();
        prefs[res.value.cat] = res.value.amount;
        await saveGoalPreferences(prefs);
        updateGoalUI();
        showToast("success", "Limite adicionado ✅", 1200);
      }
    }
  });

  // Atualizar metas quando mudar de mês
  monthPicker?.addEventListener("change", () => {
    updateGoalUI();
  });

  // Quando a tab de metas for aberta, atualiza
  const tabMetas = document.getElementById("tab-metas-tab");
  tabMetas?.addEventListener("shown.bs.tab", () => {
    updateGoalUI();
  });

  document.getElementById("periodRunBtn")?.addEventListener("click", runPeriod);
  document.getElementById("cmpRunBtn")?.addEventListener("click", runCompare);
  if (UID) runProjections();
  syncGoalUI();

  const modalEl = document.getElementById("entryModal");
  modalEl?.addEventListener("hidden.bs.modal", cleanupBackdrops);
  modalEl?.addEventListener("hide.bs.modal", cleanupBackdrops);
});
// ================================
// Init (Firestore first)
// ================================
// (async function init() {
//   await ensureAuth();

//   // Config
//   const s = await fbLoadSettings();
//   state.config = s || {};
//   setDefaultsIfNeeded();
//   syncConfigToUI();

//   // Listeners
//   listenSettings();
//   await listenMonth(getSelectedMonthKey());

//   renderAll();
// })();

// ================================
// Spendify UX extras (não quebra o core)
// ================================
const trendIncomeEl = document.getElementById("trendIncome");
const trendExpenseEl = document.getElementById("trendExpense");
const trendBalanceEl = document.getElementById("trendBalance");

const btnQuickExpense = document.getElementById("btnQuickExpense");
const btnQuickIncome = document.getElementById("btnQuickIncome");
const btnCompactToggle = document.getElementById("btnCompactToggle");

const recRows = document.getElementById("recRows");
const recEmpty = document.getElementById("recEmpty");
const btnNewRecurring = document.getElementById("btnNewRecurring");

const catNew = document.getElementById("catNew");
const catAddBtn = document.getElementById("catAddBtn");
const catRows = document.getElementById("catRows");
const catEmpty = document.getElementById("catEmpty");

function percentDelta(cur, prev) {
  const c = Number(cur || 0), p = Number(prev || 0);
  if (!p && !c) return null;
  if (!p) return 100;
  return ((c - p) / p) * 100;
}

async function computeTrendsForSelectedMonth() {
  try {
    const mk = getSelectedMonthKey();
    const prev = monthKeyAdd(mk, -1);
    const curTx = getMonthData(mk)?.entries || [];
    const prevTx = await fbListTxByMonth(prev);

    const sc = computeSummary(curTx);
    const sp = computeSummary(prevTx);

    const di = percentDelta(sc.income, sp.income);
    const de = percentDelta(sc.expense, sp.expense);
    const db = percentDelta(sc.balance, sp.balance);

    const fmt = (v) => {
      if (v === null || Number.isNaN(v)) return "—";
      const sign = v > 0 ? "+" : "";
      return `${sign}${v.toFixed(0)}% vs mês anterior`;
    };

    if (trendIncomeEl) trendIncomeEl.textContent = fmt(di);
    if (trendExpenseEl) trendExpenseEl.textContent = fmt(de);
    if (trendBalanceEl) trendBalanceEl.textContent = fmt(db);
  } catch (e) { }
}

function applyRowStates() {
  const mk = getSelectedMonthKey();
  const entries = getMonthData(mk)?.entries || [];
  const map = new Map(entries.map(e => [e.id, e]));
  const todayIso = new Date().toISOString().slice(0, 10);

  document.querySelectorAll("#rows tr").forEach(tr => {
    tr.classList.remove("row-paid", "row-overdue", "row-today");
  });

  document.querySelectorAll('#rows [data-action="edit"]').forEach(btn => {
    const id = btn.getAttribute("data-id");
    const e = map.get(id);
    const tr = btn.closest("tr");
    if (!e || !tr) return;

    if (e.paid) tr.classList.add("row-paid");
    if (!e.paid && e.due && e.due < todayIso) tr.classList.add("row-overdue");
    if (!e.paid && e.due === todayIso) tr.classList.add("row-today");
  });
}

function setCompactMode(on) {
  const tbl = document.querySelector("#tab-visao table.table");
  if (!tbl) return;
  tbl.classList.toggle("table-compact", !!on);
  state.config.compactMode = !!on;
  state.config.updatedAt = Date.now();
  fbSaveSettings({ compactMode: state.config.compactMode, updatedAt: state.config.updatedAt });
  if (btnCompactToggle) btnCompactToggle.textContent = on ? "Modo confortável" : "Modo compacto";
  if (prefCompact) prefCompact.checked = !!on;
}

function syncConfigToExtraUI() {
  if (salaryMonthly) salaryMonthly.value = state.config.salaryMonthly || 0;
  if (autoIncomeEnabled) autoIncomeEnabled.checked = !!state.config.autoIncomeEnabled;
  if (autoIncomeDay1) autoIncomeDay1.value = state.config.autoIncomeDay1 ?? 5;
  if (autoIncomeDay2) autoIncomeDay2.value = state.config.autoIncomeDay2 ?? 20;

  const on = !!state.config.compactMode;
  if (prefCompact) prefCompact.checked = on;
  if (btnCompactToggle) btnCompactToggle.textContent = on ? "Modo confortável" : "Modo compacto";

  const tbl = document.querySelector("#tab-visao table.table");
  if (tbl) tbl.classList.toggle("table-compact", on);
}

async function saveConfigFromExtraUI() {
  if (salaryMonthly) state.config.salaryMonthly = Number(salaryMonthly.value || 0);
  if (autoIncomeEnabled) state.config.autoIncomeEnabled = !!autoIncomeEnabled.checked;
  if (autoIncomeDay1) state.config.autoIncomeDay1 = clamp(Number(autoIncomeDay1.value || 5), 1, 31);
  if (autoIncomeDay2) state.config.autoIncomeDay2 = clamp(Number(autoIncomeDay2.value || 20), 1, 31);
  state.config.updatedAt = Date.now();
  await fbSaveSettings({
    salaryMonthly: state.config.salaryMonthly,
    autoIncomeEnabled: state.config.autoIncomeEnabled,
    autoIncomeDay1: state.config.autoIncomeDay1,
    autoIncomeDay2: state.config.autoIncomeDay2,
    updatedAt: state.config.updatedAt
  });
  syncConfigToUI();
  syncConfigToExtraUI();
}

function getCategories() {
  const arr = state.config.categories;
  return Array.isArray(arr) ? arr : [];
}
async function saveCategories(arr) {
  state.config.categories = arr;
  state.config.updatedAt = Date.now();
  await fbSaveSettings({ categories: arr, updatedAt: state.config.updatedAt });
  updateCategoryDatalist();
}

// ================================
// CATEGORIAS - Autocomplete e Sugestões do Form
// ================================
function updateCategoryDatalist() {
  const datalist = document.getElementById("categoryDatalist");
  if (!datalist) return;

  const categories = getCategories().slice().sort((a, b) => a.localeCompare(b));
  datalist.innerHTML = categories.map(cat => `<option value="${escapeHtml(cat)}"></option>`).join("");
}

function updateCategorySuggestions() {
  const input = document.getElementById("entryCategory");
  const suggestContainer = document.getElementById("categorySuggestions");
  if (!input || !suggestContainer) return;

  const typed = (input.value || "").trim().toLowerCase();
  const categories = getCategories().sort((a, b) => a.localeCompare(b));

  // Filtrar categorias que começam com o que foi digitado
  let suggestions = [];
  if (typed.length > 0) {
    suggestions = categories.filter(cat => cat.toLowerCase().startsWith(typed));
  } else {
    // Se não digitou nada, mostrar as 5 categorias mais usadas (ou todas se tiver menos)
    suggestions = categories.slice(0, 5);
  }

  if (suggestions.length === 0) {
    suggestContainer.classList.remove("active");
    return;
  }

  suggestContainer.innerHTML = suggestions.map(cat => `
    <button type="button" class="btn btn-sm btn-outline-secondary" data-category="${escapeHtml(cat)}">
      ${escapeHtml(cat)}
    </button>
  `).join("");

  suggestContainer.classList.add("active");

  // Adicionar listeners
  suggestContainer.querySelectorAll("[data-category]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      input.value = btn.getAttribute("data-category");
      updateCategorySuggestions();
      input.focus();
    });
  });
}

function renderCategories() {
  if (!catRows || !catEmpty) return;
  const cats = getCategories().slice().sort((a, b) => a.localeCompare(b));
  catRows.innerHTML = cats.map(c => `
    <tr>
      <td class="fw-semibold">${escapeHtml(c)}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-danger" data-catdel="${escapeHtml(c)}">Remover</button>
      </td>
    </tr>
  `).join("");
  catEmpty.classList.toggle("d-none", cats.length > 0);

  catRows.querySelectorAll("[data-catdel]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const c = btn.getAttribute("data-catdel");
      const ok = await uiConfirm({ title: "Remover categoria?", text: c, icon: "warning", confirmButtonText: "Remover", cancelButtonText: "Cancelar", confirmButtonColor: "#dc3545" });
      if (!ok) return;
      const next = getCategories().filter(x => x !== c);
      await saveCategories(next);
      renderCategories();
      showToast("success", "Categoria removida ✅", 1200);
    });
  });
}

async function loadRecurringAndRender() {
  if (!recRows || !recEmpty) return;
  const list = await fbListRecurring();
  recRows.innerHTML = list.map(t => `
    <tr>
      <td>${pillType((t.type || "expense") === "income" ? "income" : "expense")}</td>
      <td class="fw-semibold">${escapeHtml(t.name || "Recorrente")}</td>
      <td>${escapeHtml(t.category || "-")}</td>
      <td>${escapeHtml(String(t.dayOfMonth || 1))}</td>
      <td class="text-end fw-bold">${brl(t.amount || 0)}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-danger" data-recdel="${t.id}">Excluir</button>
      </td>
    </tr>
  `).join("");
  recEmpty.classList.toggle("d-none", list.length > 0);

  recRows.querySelectorAll("[data-recdel]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-recdel") || "";
      if (!id.trim()) {
        console.warn("Excluir recorrência: id vazio");
        return;
      }

      // Oferece escolha ao usuário
      if (window.Swal && Swal.fire) {
        const res = await Swal.fire({
          title: "Excluir recorrência?",
          html: `
            <div class="text-start">
              <p class="mb-3">O que você deseja fazer?</p>
              <div class="alert alert-info small mb-0">
                <strong>Opção 1:</strong> Deletar apenas o modelo (lançamentos criados continuam)<br>
                <strong>Opção 2:</strong> Deletar modelo E todos os lançamentos associados
              </div>
            </div>
          `,
          icon: "warning",
          showCancelButton: true,
          showDenyButton: true,
          confirmButtonText: "Deletar modelo e lançamentos",
          denyButtonText: "Deletar apenas modelo",
          cancelButtonText: "Cancelar",
          confirmButtonColor: "#dc3545",
          denyButtonColor: "#fd7e14"
        });

        if (!res.isConfirmed && !res.isDenied) return; // Cancelado

        const deleteAllEntries = res.isConfirmed; // true = deletar tudo, false = apenas template

        await safeRun("excluir recorrência", async () => {
          const col = recurringCol();
          if (!col) return;

          // Se decidiu deletar tudo, remove todos os lançamentos associados
          if (deleteAllEntries) {
            try {
              const transactionsCol = txCol();
              if (transactionsCol) {
                const snap = await transactionsCol.where("instanceOf", "==", id).get();
                const batch = db.batch();
                snap.docs.forEach(doc => batch.delete(doc.ref));
                if (snap.docs.length > 0) {
                  await batch.commit();
                  console.log(`[Recurring] Deletado ${snap.docs.length} lançamento(s) associado(s)`);
                }
              }
            } catch (e) {
              console.error("Erro ao deletar lançamentos associados:", e);
            }
          }

          // Deleta o template
          await col.doc(id).delete();
          showToast("success", deleteAllEntries ? "Recorrência e lançamentos deletados ✅" : "Recorrência deletada ✅", 1200);
          await loadRecurringAndRender();
        });
      } else {
        // Fallback sem SweetAlert
        const ok = await uiConfirm({
          title: "Excluir recorrência?",
          text: "Este modelo não será mais criado nos próximos meses.",
          icon: "warning",
          confirmButtonText: "Excluir",
          cancelButtonText: "Cancelar",
          confirmButtonColor: "#dc3545"
        });
        if (!ok) return;

        await safeRun("excluir recorrência", async () => {
          const col = recurringCol();
          if (col) {
            await col.doc(id).delete();
            showToast("success", "Recorrência excluída ✅", 1200);
            await loadRecurringAndRender();
          }
        });
      }
    });
  });
}

function wireSpendifyExtras() {
  // Botão voltar para página inicial (na tela de planos)
  const btnBackToHome = document.getElementById("btnBackToHome");
  btnBackToHome?.addEventListener("click", async () => {
    await auth.signOut();
    showHome();
  });

  btnQuickExpense?.addEventListener("click", () => openNew("expense"));
  btnQuickIncome?.addEventListener("click", () => openNew("income"));

  btnCompactToggle?.addEventListener("click", () => setCompactMode(!state.config.compactMode));
  prefCompact?.addEventListener("change", () => setCompactMode(!!prefCompact.checked));

  btnGenerateIncome?.addEventListener("click", async () => {
    await syncUIToConfigAndSave();
    await generateAutoIncome();
  });

  btnThemeToggle?.addEventListener("click", () => {
    state.config.darkMode = !state.config.darkMode;
    fbSaveSettings({ darkMode: state.config.darkMode, updatedAt: Date.now() });
    applyTheme();
  });

  salaryMonthly?.addEventListener("change", syncUIToConfigAndSave);
  autoIncomeEnabled?.addEventListener("change", syncUIToConfigAndSave);
  autoIncomeDay1?.addEventListener("change", syncUIToConfigAndSave);
  autoIncomeDay2?.addEventListener("change", syncUIToConfigAndSave);

  // Quando a tab de visão for aberta, resincroniza os dados
  const tabVisao = document.getElementById("tab-visao-tab");
  tabVisao?.addEventListener("shown.bs.tab", async () => {
    const mKey = getSelectedMonthKey();
    await listenMonth(mKey);
    renderAll();
  });

  // Botão de atualizar lista de cofres
  const btnRefreshHouseholds = document.getElementById("btnRefreshHouseholds");
  btnRefreshHouseholds?.addEventListener("click", async () => {
    await renderHouseholdsList();
  });

  // Quando a tab de cofres for aberta, carrega a lista
  const tabCofres = document.getElementById("tab-cofres-tab");
  tabCofres?.addEventListener("shown.bs.tab", async () => {
    await renderHouseholdsList();
  });

  // Quando a tab de recorrências for aberta, carrega a lista
  const tabRecorrencias = document.getElementById("tab-recorrencias-tab");
  tabRecorrencias?.addEventListener("shown.bs.tab", async () => {
    await loadRecurringAndRender();
  });

  // Nova recorrência
  btnNewRecurring?.addEventListener("click", async () => {
    if (window.Swal && Swal.fire) {
      const categories = getCategories().sort((a, b) => a.localeCompare(b));
      const categoryOptions = categories.map(cat => `<option value="${escapeHtml(cat)}"></option>`).join("");

      const res = await Swal.fire({
        title: "Nova Recorrência",
        html: `
          <div class="text-start">
            <label class="form-label fw-bold">Tipo</label>
            <select id="recType" class="form-select form-select-sm mb-3">
              <option value="expense" selected>💸 Despesa</option>
              <option value="income">💰 Recebimento</option>
            </select>
            
            <label class="form-label fw-bold">Nome</label>
            <input id="recName" class="form-control form-control-sm mb-3" placeholder="Ex: Aluguel" autofocus>
            
            <label class="form-label fw-bold">Categoria</label>
            <div class="position-relative">
              <input id="recCat" class="form-control form-control-sm mb-2" placeholder="Ex: Aluguel, Mercado..." list="recCategoryList">
              <datalist id="recCategoryList">
                ${categoryOptions}
              </datalist>
            </div>
            <div id="recCatSuggestions" class="d-flex flex-wrap gap-1 mb-3"></div>
            
            <label class="form-label fw-bold">Dia do mês</label>
            <input id="recDay" type="number" class="form-control form-control-sm mb-3" min="1" max="31" value="1">
            
            <label class="form-label fw-bold">Valor (R$)</label>
            <input id="recAmount" type="number" class="form-control form-control-sm" min="0" step="0.01" value="0">
          </div>`,
        showCancelButton: true,
        confirmButtonText: "Criar Recorrência",
        cancelButtonText: "Cancelar",
        didOpen: () => {
          const recCatInput = document.getElementById("recCat");
          const recCatSuggestions = document.getElementById("recCatSuggestions");

          if (recCatInput && recCatSuggestions) {
            // Mostrar sugestões iniciais
            const topCategories = categories.slice(0, 5);
            recCatSuggestions.innerHTML = topCategories.map(cat => `
              <button type="button" class="btn btn-sm btn-outline-secondary rec-cat-btn" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">
                ${escapeHtml(cat)}
              </button>
            `).join("");

            // Listeners para os botões de sugestão
            recCatSuggestions.querySelectorAll(".rec-cat-btn").forEach(btn => {
              btn.addEventListener("click", (e) => {
                e.preventDefault();
                recCatInput.value = btn.textContent.trim();
              });
            });

            // Atualizar sugestões ao digitar
            recCatInput.addEventListener("input", () => {
              const typed = (recCatInput.value || "").trim().toLowerCase();
              let filtered = [];

              if (typed.length > 0) {
                filtered = categories.filter(cat => cat.toLowerCase().startsWith(typed)).slice(0, 5);
              } else {
                filtered = categories.slice(0, 5);
              }

              recCatSuggestions.innerHTML = filtered.map(cat => `
                <button type="button" class="btn btn-sm btn-outline-secondary rec-cat-btn" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;">
                  ${escapeHtml(cat)}
                </button>
              `).join("");

              recCatSuggestions.querySelectorAll(".rec-cat-btn").forEach(btn => {
                btn.addEventListener("click", (e) => {
                  e.preventDefault();
                  recCatInput.value = btn.textContent.trim();
                });
              });
            });
          }
        },
        preConfirm: () => {
          const type = window.document.getElementById("recType")?.value || "expense";
          const name = window.document.getElementById("recName")?.value?.trim() || "";
          const category = window.document.getElementById("recCat")?.value?.trim() || "";
          const dayOfMonth = Number(window.document.getElementById("recDay")?.value || 1);
          const amount = Number(window.document.getElementById("recAmount")?.value || 0);

          if (!name) {
            Swal.showValidationMessage("Nome é obrigatório");
            return false;
          }
          if (amount <= 0) {
            Swal.showValidationMessage("Valor deve ser maior que 0");
            return false;
          }

          return { type, name, category, dayOfMonth, amount };
        }
      });

      if (res.isConfirmed && res.value) {
        const template = {
          id: uid(),
          type: res.value.type,
          name: res.value.name,
          category: res.value.category,
          dayOfMonth: res.value.dayOfMonth,
          amount: res.value.amount,
          createdAt: Date.now()
        };

        try {
          await fbUpsertRecurring(template);
          await loadRecurringAndRender();
          showToast("success", "Recorrência criada ✅", 1200);
        } catch (e) {
          showToast("error", "Erro ao criar recorrência", 2000);
        }
      }
    }
  });

  catAddBtn?.addEventListener("click", async () => {
    const v = (catNew?.value || "").trim();
    if (!v) return;
    const next = Array.from(new Set([...getCategories(), v]));
    await saveCategories(next);
    if (catNew) catNew.value = "";
    renderCategories();
    renderCategorySuggestions();
    showToast("success", "Categoria adicionada ✅", 1200);
  });

  // Quando a tab de categorias for aberta, carrega as sugestões
  const tabCategories = document.getElementById("tab-categorias-tab");
  tabCategories?.addEventListener("shown.bs.tab", async () => {
    renderCategorySuggestions();
  });

  // Listeners do input de categoria no formulário de entrada
  entryCategory?.addEventListener("input", () => {
    updateCategorySuggestions();
  });

  entryCategory?.addEventListener("focus", () => {
    updateCategorySuggestions();
  });

  // Inicializar o datalist quando o DOM estiver pronto
  if (state && state.config) {
    updateCategoryDatalist();
  }

  document.getElementById("sumIncome")?.closest(".stat")?.addEventListener("click", () => {
    if (filterType) filterType.value = "income";
    renderAll(); persistFiltersDebounced();
  });
  document.getElementById("sumExpense")?.closest(".stat")?.addEventListener("click", () => {
    if (filterType) filterType.value = "expense";
    renderAll(); persistFiltersDebounced();
  });
  document.getElementById("sumPaid")?.closest(".text-end")?.addEventListener("click", () => {
    if (filterStatus) filterStatus.value = "paid";
    renderAll(); persistFiltersDebounced();
  });
}

const _renderAllOriginal = renderAll;
renderAll = function () {
  _renderAllOriginal();
  applyRowStates();
  computeTrendsForSelectedMonth();
};

document.addEventListener("DOMContentLoaded", () => {
  wireSpendifyExtras();

  // Listener para atualizar categorias quando o modal de entrada é aberto
  const entryModalEl = document.getElementById("entryModal");
  if (entryModalEl) {
    entryModalEl.addEventListener("shown.bs.modal", () => {
      updateCategoryDatalist();
      updateCategorySuggestions();
    });
  }

  setTimeout(() => {
    try { syncConfigToExtraUI(); } catch { }
    try { renderCategories(); } catch { }
    try { renderCategorySuggestions(); } catch { }
    try { updateCategoryDatalist(); } catch { }
    try { loadRecurringAndRender(); } catch { }
  }, 600);
});

const _listenSettingsOriginal = listenSettings;
listenSettings = function () {
  if (unsubscribeSettings) unsubscribeSettings();
  const ref = settingsRef();
  if (!ref) return; // UID não está definido
  unsubscribeSettings = ref.onSnapshot((snap) => {
    if (!snap.exists) return;
    const s = snap.data() || {};
    state.config = { ...state.config, ...s };
    setDefaultsIfNeeded();
    syncConfigToUI();
    syncConfigToExtraUI();
    renderCategories();
  });
};
