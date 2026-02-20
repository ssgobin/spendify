import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";
import admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Joi from "joi";
import crypto from "crypto";

if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!privateKey || !process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL) {
    throw new Error('Firebase credentials not found in environment variables');
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: privateKey,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
}
const db = admin.firestore();
const auth = admin.auth();

const app = express();

// ================================
// SECURITY: Headers de Proteção
// ================================
app.use(helmet());

// ================================
// SECURITY: CORS Restritivo
// ================================
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://your-domain.com").split(",");
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 3600
}));

// ================================
// SECURITY: Rate Limiting
// ================================
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por IP
  message: "Muitas requisições. Tente novamente mais tarde.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health", // Skip health check
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10, // 10 pagamentos por IP por hora
  skipSuccessfulRequests: false,
  message: "Limite de requisições de pagamento excedido"
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: false
});

app.use("/payments", apiLimiter);
app.use("/admin", adminLimiter);

app.use(express.json({ limit: "10kb" })); // Limitar tamanho do JSON
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// ================================
// SECURITY: Validação de Schemas
// ================================
const paymentSchema = Joi.object({
  uid: Joi.string().required().pattern(/^[a-zA-Z0-9]{20,}$/),
  plan: Joi.string().valid("basic", "pro", "family").required(),
  method: Joi.string().valid("pix", "boleto").default("pix"),
  customer: Joi.object({
    email: Joi.string().email().required(),
    name: Joi.string().required().max(100),
    document: Joi.string().pattern(/^\d{11,14}$/).required()
  }).required()
});

const adminSchema = Joi.object({
  uid: Joi.string().required().pattern(/^[a-zA-Z0-9]{20,}$/),
  plan: Joi.string().valid("basic", "pro", "family").required(),
  adminKey: Joi.string().required()
});

// ================================
// SECURITY: Middleware de Autenticação
// ================================
async function verifyFirebaseToken(req, res, next) {
  try {
    const token = req.headers.authorization?.split("Bearer ")[1];
    if (!token) {
      return res.status(401).json({ error: "No authorization token" });
    }
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("[Auth] Token inválido:", error.code);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ================================
// SECURITY: Logging seguro (sem dados sensíveis)
// ================================
function safeLog(context, data) {
  const safe = JSON.parse(JSON.stringify(data));
  // Remove dados sensíveis
  if (safe.apiKey) safe.apiKey = "***";
  if (safe.token) safe.token = "***";
  if (safe.customer?.document) safe.customer.document = safe.customer.document.slice(-4).padStart(14, "*");
  if (safe.customer?.email) safe.customer.email = safe.customer.email.split("@")[0].slice(0, 2) + "***@***";
  console.log(`[${context}]`, safe);
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

function priceForPlan(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "basic") return 6.9;
  if (p === "family") return 29.9;
  if (p === "pro") return 19.9;
  return 0;
}

async function setUserPlan(uid, plan) {
  const ref = db.collection("users").doc(uid).collection("meta").doc("settings");
  await ref.set({ plan, updatedAt: Date.now() }, { merge: true });
}

// ================================
// PAYMENTS: Criar transação segura
// ================================
app.post("/payments/create", paymentLimiter, verifyFirebaseToken, async (req, res) => {
  try {
    // Validar entrada com Joi
    const { error, value } = paymentSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({ error: "validation_failed", message: error.details[0].message });
    }

    const { uid, plan, method, customer } = value;

    // SECURITY: Verificar se o UID é do usuário autenticado
    if (uid !== req.user.uid) {
      console.warn("[Security] Tentativa de criar pagamento para UID diferente:", { uid, userUid: req.user.uid });
      return res.status(403).json({ error: "forbidden", message: "Acesso negado" });
    }

    const amount = priceForPlan(plan);
    if (amount <= 0) return res.status(400).json({ error: "invalid_plan" });
    if (String(method).toLowerCase() === "pix" && amount < 3) {
      return res.status(400).json({ error: "amount_too_low_for_pix" });
    }

    const API_KEY = process.env.PAGHIPER_API_KEY;
    const TOKEN = process.env.PAGHIPER_TOKEN;
    if (!API_KEY || !TOKEN) {
      console.error("[Payment] Gateway não configurado");
      return res.status(500).json({ error: "payment_gateway_unavailable" });
    }

    const referenceId = `uid_${uid}_${plan}_${Date.now()}`;
    let payload = {};

    let url = "";
    const mth = String(method).toLowerCase();
    if (mth === "boleto") {
      url = process.env.PAGHIPER_BOLETO_URL;
      payload = {
        apiKey: API_KEY,
        token: TOKEN,
        order_id: referenceId,
        notification_url: process.env.PAGHIPER_WEBHOOK_URL,
        value_cents: Math.round(amount * 100),
        payer_email: customer.email,
        payer_name: customer.name,
        payer_cpf_cnpj: customer.document,
        days_due_date: 3,
        fixed_description: true,
        description: `Spendify ${plan}`,
      };
    } else {
      url = process.env.PAGHIPER_PIX_URL;
      payload = {
        apiKey: API_KEY,
        token: TOKEN,
        order_id: referenceId,
        payer_email: customer.email,
        payer_name: customer.name,
        payer_cpf_cnpj: customer.document,
        notification_url: process.env.PAGHIPER_WEBHOOK_URL,
        fixed_description: true,
        value_cents: Math.round(amount * 100),
        description: `Plano ${plan} - Spendify`,
        days_due_date: 1,
        items: [
          {
            item_id: plan,
            description: `Plano ${plan}`,
            quantity: "1",
            price_cents: Math.round(amount * 100)
          }
        ]
      };
    }
    if (!url) return res.status(500).json({ error: "endpoint_not_configured" });

    safeLog("Payment", { url, method: mth, amount, uid });

    const axiosConfig = {
      timeout: 15000,
      headers: { "Content-Type": "application/json" }
    };
    const r = await axios.post(url, payload, axiosConfig);
    const data = r.data || {};

    const createReq = data?.pix_create_request || data?.create_request || {};
    const pixCode = createReq?.pix_code || {};

    const pixQrImage =
      pixCode?.qrcode_image_url ||
      (pixCode?.qrcode_base64 ? `data:image/png;base64,${pixCode.qrcode_base64}` : null) ||
      createReq?.qrcode_image ||
      createReq?.pix_qr_image ||
      createReq?.qr_code_image ||
      data?.qrcode_image ||
      data?.pix_qr_image ||
      data?.qr_code_image;

    const boletoUrl =
      createReq?.bank_slip?.url_slip ||
      data?.bank_slip?.url_slip ||
      data?.url ||
      createReq?.url;

    // Armazenar transação no Firestore para auditoria
    await db.collection("payments").doc(referenceId).set({
      uid,
      plan,
      method,
      amount,
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + (method === "boleto" ? 3 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000)
    });

    safeLog("Payment", { status: r.status, dataKeys: Object.keys(data) });

    return res.status(200).json({
      success: true,
      orderId: referenceId,
      method: mth,
      amount,
      pixQrImage: mth === "pix" ? pixQrImage : null,
      boletoUrl: mth === "boleto" ? boletoUrl : null
    });
  } catch (e) {
    const errorMsg = e.message || "Unknown error";
    const errorStatus = e.response?.status || 500;
    console.error("[Payment] Erro:", {
      status: errorStatus,
      error: e.code,
      url: e.config?.url
    });
    return res.status(500).json({
      error: "payment_creation_failed",
      message: "Erro ao processar pagamento"
    });
  }
});

// ================================
// PAYMENTS: Webhook com assinatura HMAC
// ================================
function verifyWebhookSignature(body, signature) {
  const secret = process.env.PAGHIPER_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[Webhook] PAGHIPER_WEBHOOK_SECRET não configurado");
    return false;
  }

  const bodyString = typeof body === "string" ? body : JSON.stringify(body);
  const hash = crypto
    .createHmac("sha256", secret)
    .update(bodyString)
    .digest("hex");

  return hash === signature;
}

app.post("/payments/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const signature = req.headers["x-webhook-signature"];

    // SECURITY: Validar assinatura do webhook
    if (!verifyWebhookSignature(body, signature)) {
      console.warn("[Webhook] Tentativa de webhook com assinatura inválida");
      return res.status(401).send("Unauthorized");
    }

    const status = String(body.status || body.notification_status || "").toLowerCase();
    const orderId = String(body.order_id || body.reference || "");

    if (!orderId) return res.status(400).send("Invalid reference");

    const m = orderId.match(/^uid_(.+?)_(basic|pro|family)_/);
    const uid = m?.[1] || "";
    const plan = m?.[2] || "";

    if (!uid || !plan) {
      console.error("[Webhook] Falha ao parsear referência:", { orderId });
      return res.status(400).send("Invalid reference format");
    }

    safeLog("Webhook", { uid, plan, status });

    if (status === "paid" || status === "completed" || status === "approved") {
      await setUserPlan(uid, plan);

      // Atualizar status de pagamento no Firestore
      const ref = db.collection("payments").doc(orderId);
      await ref.update({
        status: "completed",
        completedAt: Date.now()
      });

      console.log("[Webhook] ✅ Plano atualizado:", { uid, plan });
    } else if (status === "cancelled" || status === "expired") {
      const ref = db.collection("payments").doc(orderId);
      await ref.update({
        status: status,
        cancelledAt: Date.now()
      });
      console.log("[Webhook] ⚠️ Pagamento", status, { uid });
    }
    return res.status(200).send("OK");
  } catch (e) {
    console.error("[Webhook] Erro:", e.code || e.message);
    return res.status(500).send("Error");
  }
});

// ================================
// ADMIN: Endpoint seguro para alterar plano
// ================================
app.post("/admin/set-plan", verifyFirebaseToken, async (req, res) => {
  try {
    // SECURITY: Verificar se é admin
    const claims = req.user.custom_claims || {};
    if (!claims.admin) {
      console.warn("[Security] Acesso negado ao admin por usuário não-admin:", { uid: req.user.uid });
      return res.status(403).json({ error: "forbidden", message: "Acesso negado" });
    }

    // Validar entrada com Joi
    const { error, value } = Joi.object({
      uid: Joi.string().required().pattern(/^[a-zA-Z0-9]{20,}$/),
      plan: Joi.string().valid("basic", "pro", "family").required()
    }).validate(req.body || {});

    if (error) {
      return res.status(400).json({ error: "validation_failed", message: error.details[0].message });
    }

    const { uid, plan } = value;

    // SECURITY: Registrar alteração administrativa
    await db.collection("admin_logs").add({
      action: "set_plan",
      adminUid: req.user.uid,
      targetUid: uid,
      plan,
      timestamp: Date.now()
    });

    await setUserPlan(uid, plan);

    console.log("[Admin] ✅ Plano alterado:", { uid, plan, admin: req.user.uid });

    return res.status(200).json({
      success: true,
      message: `Plano alterado para ${plan}`,
      uid,
      plan,
      updatedAt: new Date().toISOString()
    });

  } catch (e) {
    console.error("[Admin] Erro:", e.code || e.message);
    return res.status(500).json({
      error: "internal_error",
      message: "Erro ao processar requisição"
    });
  }
});
export const api = onRequest(app);
