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
  listenFiis();

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
    basic: "Basic",
    pro: "Pro",
    family: "Family",
    none: "Nenhum (Teste)"
  }[currentPlan] || "Desconhecido";

  const planPrice = {
    basic: "R$ 10,90/mês",
    pro: "R$ 15,90/mês",
    family: "R$ 25,90/mês",
    none: "Acesso limitado"
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
        const name = document.getElementById("pfName")?.value?.trim() || "";
        const email = document.getElementById("pfEmail")?.value?.trim() || "";
        const phone = document.getElementById("pfPhone")?.value?.trim() || "";
        const city = document.getElementById("pfCity")?.value?.trim() || "";

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
const btnEmailLogin = document.getElementById("btnEmailLogin");
const btnEmailSignup = document.getElementById("btnEmailSignup");
const btnLogout = document.getElementById("btnLogout");
const btnHousehold = document.getElementById("btnHousehold");
const btnLeaveHousehold = document.getElementById("btnLeaveHousehold");
const scopeLabel = document.getElementById("scopeLabel");
const homeView = document.getElementById("homeView");
const btnPlans = document.getElementById("btnPlans");
const btnOpenLogin = document.getElementById("btnOpenLogin");
let PENDING_PLAN = null;

const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");

// Helpers UI
// ================================
function showAuth() {
  authView.classList.remove("d-none");
  appView.classList.add("d-none");
  navAuthed.classList.add("d-none");
  if (homeView) homeView.classList.add("d-none");
  const mainNavbar = document.getElementById("mainNavbar");
  if (mainNavbar) mainNavbar.classList.add("d-none");
}

function showHome() {
  authView.classList.add("d-none");
  appView.classList.add("d-none");
  navAuthed.classList.add("d-none");
  if (homeView) homeView.classList.remove("d-none");
  const mainNavbar = document.getElementById("mainNavbar");
  if (mainNavbar) mainNavbar.classList.add("d-none");
}

function showPaymentPending(user) {
  authView.classList.add("d-none");
  appView.classList.add("d-none");
  navAuthed.classList.add("d-none");
  if (homeView) homeView.classList.add("d-none");
  const mainNavbar = document.getElementById("mainNavbar");
  if (mainNavbar) mainNavbar.classList.remove("d-none");

  // Mostra o painel de pagamento pendente
  let pendingView = document.getElementById("paymentPendingView");
  if (!pendingView) {
    pendingView = document.createElement("div");
    pendingView.id = "paymentPendingView";
    pendingView.className = "container my-5";
    document.body.appendChild(pendingView);
  }

  const email = user?.email || "usuário";
  pendingView.innerHTML = `
    <div class="row justify-content-center">
      <div class="col-12 col-md-7 col-lg-5">
        <div class="card shadow-sm rounded-4 border-0">
          <div class="card-body p-5 text-center">
            <div class="mb-3">
              <div style="font-size: 48px;">💳</div>
            </div>
            <h4 class="fw-bold mb-2">Escolha um plano</h4>
            <p class="text-secondary mb-4">
              Para continuar usando o Spendify, você precisa escolher um plano de pagamento.
            </p>
            
            <div class="alert alert-info mb-4" role="alert">
              <small class="text-start d-block">
                <strong>Conta criada com sucesso! 🎉</strong><br>
                Para acessar todos os recursos, complete o pagamento abaixo.
              </small>
            </div>

            <div class="d-flex flex-column gap-2">
              <button class="btn btn-outline-primary btn-lg rounded-3" data-plan="basic">
                <span class="d-block fw-bold">Basic</span>
                <span class="small">R$ 6,90 / mês</span>
              </button>
              <button class="btn btn-primary btn-lg rounded-3" data-plan="pro">
                <span class="d-block fw-bold">Pro ⭐ Recomendado</span>
                <span class="small">R$ 19,90 / mês</span>
              </button>
              <button class="btn btn-outline-primary btn-lg rounded-3" data-plan="family">
                <span class="d-block fw-bold">Family</span>
                <span class="small">R$ 29,90 / mês</span>
              </button>
            </div>

            <div class="mt-4">
              <button id="btnLogoutPending" class="btn btn-outline-secondary btn-sm">
                Sair
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  let btnProPending = pendingView.querySelector('[data-plan="pro"]');
  let btnBasicPending = pendingView.querySelector('[data-plan="basic"]');
  let btnFamilyPending = pendingView.querySelector('[data-plan="family"]');
  let btnLogoutPending = pendingView.querySelector('#btnLogoutPending');

  [btnBasicPending, btnProPending, btnFamilyPending].forEach((btn) => {
    btn?.addEventListener("click", async () => {
      const plan = btn.getAttribute("data-plan");
      await createPaymentFlow(plan);
    });
  });

  btnLogoutPending?.addEventListener("click", async () => {
    await auth.signOut();
    showHome();
  });

  pendingView.classList.remove("d-none");
}

async function showApp(user) {
  authView.classList.add("d-none");
  appView.classList.remove("d-none");
  navAuthed.classList.remove("d-none");
  if (homeView) homeView.classList.add("d-none");
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
}


function showError(msg) {
  authMsg.textContent = msg;
  authMsg.classList.remove("d-none");
}

// ================================
// Google Login
// ================================
btnGoogle?.addEventListener("click", async () => {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (e) {
    showError(e.message);
  }
});

// ================================
// Email Login
// ================================
btnEmailLogin?.addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    await auth.signInWithEmailAndPassword(
      loginEmail.value,
      loginPassword.value
    );
  } catch (e) {
    showError("Email ou senha inválidos.");
  }
});

// ================================
// Email Signup
// ================================
btnEmailSignup?.addEventListener("click", async () => {
  try {
    // 1) Pede nome e CPF antes de criar a conta
    const signupResult = await getSignupData();
    if (!signupResult) return; // usuário cancelou

    const { fullName, cpf } = signupResult;

    // 2) Cria a conta no Firebase
    const userCredential = await auth.createUserWithEmailAndPassword(
      loginEmail.value,
      loginPassword.value
    );

    // 3) Salva nome e CPF no Firestore
    const uid = userCredential.user.uid;
    await db.collection("users").doc(uid).set(
      {
        name: fullName,
        document: cpf,
        email: loginEmail.value,
        uid: uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Conta criada com sucesso, agora precisa de pagamento
    showError(""); // limpa erros

  } catch (e) {
    showError(e.message);
  }
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
        const name = document.getElementById("signupName")?.value?.trim() || "";
        const doc = document.getElementById("signupCpf")?.value?.trim() || "";

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
  }

  return { fullName, cpf };
}

// ================================
// Logout
// ================================
btnLogout?.addEventListener("click", async () => {
  await auth.signOut();
  showHome();
});

btnPlans?.addEventListener("click", () => {
  showHome();
  const el = document.getElementById("pricingSection");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
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

      // Salva os dados atualizados no Firebase (mantém com máscara para exibição)
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
    } else {
      throw new Error("SweetAlert não disponível para coletar dados de pagamento");
    }
  }

  // Backend valida somente números (11 a 14 dígitos)
  const cleanDocument = String(cpf).replace(/\D/g, "");
  if (!/^\d{11,14}$/.test(cleanDocument)) {
    await uiAlert({
      title: "Documento inválido",
      text: "Informe um CPF ou CNPJ válido (somente números ou com máscara).",
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
  const base = "/.netlify/functions/api";

  // Permite sobrescrever o endpoint da API em dev/produção
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
  const qrImg = data?.pixQrImage || null;
  const boletoUrl = data?.boletoUrl || null;
  const orderId = data?.orderId || null;

  console.log("[Payment] Extração:", { qrImg: !!qrImg, boletoUrl: !!boletoUrl, orderId });

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

  if (window.Swal && Swal.fire) {
    if (qrImg) {
      await Swal.fire({
        title: "Pague com PIX",
        html: `
          <img src="${qrImg}" alt="QR Code" style="max-width:100%;border-radius:12px;" />
          <p style="margin-top:12px;font-size:12px;color:#666;">
            Aguardando confirmação do pagamento...
          </p>
          ${orderId ? `<p style="font-size:11px;color:#999;">Pedido: ${orderId}</p>` : ""}
        `,
        icon: "info",
        confirmButtonText: "Ok"
      });
    } else if (boletoUrl) {
      await Swal.fire({
        title: "Boleto gerado",
        html: `
          <a href="${boletoUrl}" target="_blank" class="btn btn-primary">Abrir boleto</a>
          <p style="margin-top:12px;font-size:12px;color:#666;">
            Aguardando confirmação do pagamento...
          </p>
          ${orderId ? `<p style="font-size:11px;color:#999;">Pedido: ${orderId}</p>` : ""}
        `,
        icon: "info",
        confirmButtonText: "Ok",
      });
    } else {
      await Swal.fire({ title: "Pagamento criado", icon: "success" });
    }
  }

  // Monitora a confirmação do pagamento
  console.log("[Payment] Monitorando plano para confirmação...");
  const settingsRef = db.collection("users").doc(cur.uid).collection("meta").doc("settings");

  let unsubscribe = null;
  let timeoutId = null;
  let confirmed = false;

  unsubscribe = settingsRef.onSnapshot(
    (snap) => {
      const newPlan = snap.data()?.plan;
      console.log("[Payment] Plano atual:", newPlan);

      // ✅ confirmação correta: quando o plano vira exatamente o plano comprado
      if (!confirmed && newPlan === plan) {
        confirmed = true;
        console.log("[Payment] ✅ Pagamento confirmado! Novo plano:", newPlan);

        if (unsubscribe) unsubscribe();
        if (timeoutId) clearTimeout(timeoutId);

        if (typeof showPaymentConfirmation === "function") {
          showPaymentConfirmation(newPlan);
        } else {
          uiAlert({
            title: "Pagamento confirmado",
            text: `Seu plano ${newPlan} foi ativado com sucesso!`,
            icon: "success"
          });
        }
      }
    },
    (error) => {
      console.error("[Payment] Erro ao monitorar plano:", error);
    }
  );

  // Timeout de 5 minutos
  timeoutId = setTimeout(() => {
    console.log("[Payment] Timeout de 5 minutos, parando monitoramento");
    if (unsubscribe) unsubscribe();
  }, 5 * 60 * 1000);
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
    basic: { name: "Basic", price: "6,90", features: ["Todos os recursos básicos", "Relatórios simples", "Suporte por email"] },
    pro: { name: "Pro", price: "19,90", features: ["Todos os recursos", "Análises avançadas", "Cofre compartilhado", "Suporte prioritário"] },
    family: { name: "Family", price: "29,90", features: ["Plano Pro + múltiplas contas", "Recursos ilimitados", "Suporte 24/7", "Sincronização em tempo real"] }
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


// ================================
// Cofre compartilhado - botões
// ================================
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
    const plan = String(state.config.plan || "none");

    // Se não tem plano, mostra tela de pagamento pendente
    if (plan !== "basic" && plan !== "pro" && plan !== "family") {
      showPaymentPending(user);
      return;
    }

    showApp(user);

    try { await upsertUserProfile(user); } catch (e) { console.warn(e); }

    if (!didBoot) {
      didBoot = true;
      await bootApp();
    }
    updatePlanUI();
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
  return s.length ? s : uid();
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

  // Bootstrap 5 real
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
      return `
      <tr>
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
            <input class="form-check-input" type="checkbox" ${e.paid ? "checked" : ""} data-action="togglePaid" data-id="${e.id}">
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

  rows.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      const action = ev.currentTarget.getAttribute("data-action");
      const id = ev.currentTarget.getAttribute("data-id");
      if (action === "edit") openEdit(id);
      if (action === "delete") onDelete(id);
    });
  });

  rows.querySelectorAll('input[data-action="togglePaid"]').forEach((chk) => {
    chk.addEventListener("change", (ev) => {
      const id = ev.currentTarget.getAttribute("data-id");
      togglePaid(id, ev.currentTarget.checked);
    });
  });

  renderPagination(totalPages);


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
  const mKey = getSelectedMonthKey();
  const md = getMonthData(mKey);
  const entries = md.entries || [];
  renderSummary(entries);
  renderTable(entries);
  buildChart(entries);
  buildDailyChart(entries);
  buildCategoryChart(entries);
}

// ================================
// Modal handlers
// ================================
function openNew(type) {
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

  entryModal.show();
}

function openEdit(id) {
  const mKey = getSelectedMonthKey();
  const md = getMonthData(mKey);
  const e = md.entries.find((x) => x.id === id);
  if (!e) return;

  entryModalTitle.textContent = "Editar Lançamento";
  entryId.value = e.id;
  entryType.value = e.type;
  entryDue.value = e.due;
  entryName.value = e.name || "";
  entryCategory.value = e.category || "";
  entryAmount.value = Number(e.amount || 0);
  entryPaid.checked = !!e.paid;
  entryNotes.value = e.notes || "";

  if (entryRecurring) entryRecurring.checked = !!e.recurring;

  entryModal.show();
}

async function onDelete(id) {
  const mKey = getSelectedMonthKey();
  const md = getMonthData(mKey);
  const e = md.entries.find((x) => x.id === id);
  if (!e) return;

  const ok = await uiConfirm({
    title: "Excluir lançamento?",
    text: `“${e.name}” será removido.`,
    icon: "warning",
    confirmButtonText: "Excluir",
    cancelButtonText: "Cancelar",
    confirmButtonColor: "#dc3545",
  });
  if (!ok) return;

  // remove local imediatamente (efeito rápido)
  deleteEntryLocal(mKey, id);
  renderAll();

  // agenda commit definitivo em 5s
  const timer = setTimeout(async () => {
    await safeRun("excluir lançamento", async () => {
      await fbDeleteTx(id);
      pendingDelete.delete(id);
      showToast("success", "Exclusão confirmada ✅", 1200);

    });
  }, 5000);

  pendingDelete.set(id, { entry: e, mKey, timer });

  // toast undo
  const undoToastEl = document.getElementById("undoToast");
  const undoMsg = document.getElementById("undoToastMsg");
  const undoBtn = document.getElementById("undoToastBtn");

  if (undoMsg) undoMsg.textContent = `Lançamento excluído: ${e.name}`;
  const toastInst = window.bootstrap?.Toast?.getOrCreateInstance(undoToastEl, { delay: 5000 });
  toastInst?.show();

  if (undoBtn) {
    undoBtn.onclick = () => {
      const p = pendingDelete.get(id);
      if (!p) return;
      clearTimeout(p.timer);
      upsertEntryLocal(p.mKey, p.entry);
      pendingDelete.delete(id);
      renderAll();
      showToast("info", "Exclusão desfeita ↩️", 1200);
      toastInst?.hide();
    };
  }
}


async function togglePaid(id, paid) {
  const mKey = getSelectedMonthKey();
  const md = getMonthData(mKey);
  const e = md.entries.find((x) => x.id === id);
  if (!e) return;

  await safeRun("alterar status de pagamento", async () => {
    e.paid = !!paid;
    e.updatedAt = Date.now();
    await fbUpsertTx(e);
    upsertEntryLocal(mKey, e);
    renderAll();
    showToast("success", e.paid ? "Marcado como pago ✅" : "Marcado como em aberto ⏳", 1200);
  });
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
function syncGoalUI() {
  const goalMonthly = document.getElementById("goalMonthly");
  const goalCurrent = document.getElementById("goalCurrent");
  const g = Number(state?.config?.goalMonthly || 0);
  if (goalMonthly) goalMonthly.value = g || 0;
  if (goalCurrent) goalCurrent.textContent = brl(g);
}
async function saveGoal() {
  const goalMonthly = document.getElementById("goalMonthly");
  const v = Number(goalMonthly?.value || 0);
  state.config.goalMonthly = v;
  state.config.updatedAt = Date.now();
  await fbSaveSettings({ goalMonthly: v, updatedAt: state.config.updatedAt });
  syncGoalUI();
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

const salaryMonthly2 = document.getElementById("salaryMonthly2");
const autoIncomeEnabled2 = document.getElementById("autoIncomeEnabled2");
const autoIncomeDay12 = document.getElementById("autoIncomeDay12");
const autoIncomeDay22 = document.getElementById("autoIncomeDay22");
const btnGenerateIncome2 = document.getElementById("btnGenerateIncome2");
const btnThemeToggle2 = document.getElementById("btnThemeToggle2");
const prefCompact = document.getElementById("prefCompact");

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
  if (salaryMonthly2) salaryMonthly2.value = state.config.salaryMonthly || 0;
  if (autoIncomeEnabled2) autoIncomeEnabled2.checked = !!state.config.autoIncomeEnabled;
  if (autoIncomeDay12) autoIncomeDay12.value = state.config.autoIncomeDay1 ?? 5;
  if (autoIncomeDay22) autoIncomeDay22.value = state.config.autoIncomeDay2 ?? 20;

  const on = !!state.config.compactMode;
  if (prefCompact) prefCompact.checked = on;
  if (btnCompactToggle) btnCompactToggle.textContent = on ? "Modo confortável" : "Modo compacto";

  const tbl = document.querySelector("#tab-visao table.table");
  if (tbl) tbl.classList.toggle("table-compact", on);
}

async function saveConfigFromExtraUI() {
  if (salaryMonthly2) state.config.salaryMonthly = Number(salaryMonthly2.value || 0);
  if (autoIncomeEnabled2) state.config.autoIncomeEnabled = !!autoIncomeEnabled2.checked;
  if (autoIncomeDay12) state.config.autoIncomeDay1 = clamp(Number(autoIncomeDay12.value || 5), 1, 31);
  if (autoIncomeDay22) state.config.autoIncomeDay2 = clamp(Number(autoIncomeDay22.value || 20), 1, 31);
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
      const ok = await uiConfirm({ title: "Excluir recorrência?", text: "Este modelo não será mais criado nos próximos meses.", icon: "warning", confirmButtonText: "Excluir", cancelButtonText: "Cancelar", confirmButtonColor: "#dc3545" });
      if (!ok) return;
      await safeRun("excluir recorrência", async () => {
        const col = recurringCol();
        if (col) {
          await col.doc(id).delete();
          showToast("success", "Recorrência excluída ✅", 1200);
          await loadRecurringAndRender();
        }
      });
    });
  });
}

function wireSpendifyExtras() {
  btnQuickExpense?.addEventListener("click", () => openNew("expense"));
  btnQuickIncome?.addEventListener("click", () => openNew("income"));

  btnCompactToggle?.addEventListener("click", () => setCompactMode(!state.config.compactMode));
  prefCompact?.addEventListener("change", () => setCompactMode(!!prefCompact.checked));

  btnGenerateIncome2?.addEventListener("click", async () => {
    await saveConfigFromExtraUI();
    await generateAutoIncome();
  });

  btnThemeToggle2?.addEventListener("click", () => btnThemeToggle?.click());

  salaryMonthly2?.addEventListener("change", saveConfigFromExtraUI);
  autoIncomeEnabled2?.addEventListener("change", saveConfigFromExtraUI);
  autoIncomeDay12?.addEventListener("change", saveConfigFromExtraUI);
  autoIncomeDay22?.addEventListener("change", saveConfigFromExtraUI);

  catAddBtn?.addEventListener("click", async () => {
    const v = (catNew?.value || "").trim();
    if (!v) return;
    const next = Array.from(new Set([...getCategories(), v]));
    await saveCategories(next);
    if (catNew) catNew.value = "";
    renderCategories();
    showToast("success", "Categoria adicionada ✅", 1200);
  });

  document.querySelectorAll(".cat-suggest").forEach(btn => {
    btn.addEventListener("click", async () => {
      const v = btn.getAttribute("data-cat") || "";
      if (!v) return;
      const next = Array.from(new Set([...getCategories(), v]));
      await saveCategories(next);
      renderCategories();
      showToast("success", "Categoria adicionada ✅", 1200);
    });
  });

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
  setTimeout(() => {
    try { syncConfigToExtraUI(); } catch { }
    try { renderCategories(); } catch { }
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
