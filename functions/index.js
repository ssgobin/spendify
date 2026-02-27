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
// Enhanced Helmet security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "https:", "data:"],
      connectSrc: ["'self'", "https://firestore.googleapis.com", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "https://api.groq.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  noSniff: true,
  xssFilter: true,
  frameguard: { action: "deny" },
  hidePoweredBy: true,
  permittedCrossDomainPolicies: { permittedPolicies: "none" }
}));

// Adicionar headers de segurança adicionais
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// ================================
// SECURITY: CORS Restritivo
// ================================
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://your-domain.com").split(",").map(o => o.trim());
const isDevelopment = process.env.NODE_ENV === 'development';

app.use(cors({
  origin: function (origin, callback) {
    // Em desenvolvimento, permite localhost
    if (isDevelopment && (!origin || origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      callback(null, true);
      return;
    }

    // Em produção, requer origem e valida contra whitelist
    if (!origin) {
      callback(new Error("No origin header - CORS blocked"));
      return;
    }

    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('[CORS] Origem bloqueada:', origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 3600,
  optionsSuccessStatus: 204
}));

// SECURITY: Validar Content-Type para requisições POST/PUT
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      return res.status(415).json({
        error: 'unsupported_media_type',
        message: 'Content-Type deve ser application/json'
      });
    }
  }
  next();
});

// ================================
// SECURITY: Rate Limiting
// ================================
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutos
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // 100 requests por IP
  message: "Muitas requisições. Tente novamente mais tarde.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health", // Skip health check
  handler: (req, res) => {
    console.warn('[Rate Limit] Limite excedido:', {
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent']
    });
    res.status(429).json({
      error: 'rate_limit_exceeded',
      message: 'Muitas requisições. Tente novamente mais tarde.',
      retryAfter: Math.ceil(15 * 60) // segundos
    });
  }
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: parseInt(process.env.PAYMENT_RATE_LIMIT_MAX) || 10, // 10 pagamentos por IP por hora
  skipSuccessfulRequests: false,
  message: "Limite de requisições de pagamento excedido",
  handler: (req, res) => {
    console.warn('[Payment Rate Limit] Limite excedido:', {
      ip: req.ip,
      uid: req.body?.uid
    });
    res.status(429).json({
      error: 'payment_rate_limit_exceeded',
      message: 'Limite de requisições de pagamento excedido',
      retryAfter: 3600
    });
  }
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    console.warn('[Admin Rate Limit] Limite excedido:', {
      ip: req.ip,
      uid: req.user?.uid
    });
    res.status(429).json({
      error: 'admin_rate_limit_exceeded',
      message: 'Limite de requisições administrativas excedido',
      retryAfter: 900
    });
  }
});

app.use("/payments", apiLimiter);
app.use("/admin", adminLimiter);

app.use(express.json({ limit: "10kb" })); // Limitar tamanho do JSON
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// ================================
// SECURITY: Validação de Schemas
// ================================
const paymentSchema = Joi.object({
  uid: Joi.string().required().pattern(/^[a-zA-Z0-9]{20,}$/).trim(),
  plan: Joi.string().valid("basic", "pro", "family").required().lowercase(),
  type: Joi.string().valid("basic", "pro", "family", "ai").optional().lowercase(),
  method: Joi.string().valid("pix", "boleto").default("pix").lowercase(),
  customer: Joi.object({
    email: Joi.string().email().required().max(100).lowercase().trim(),
    name: Joi.string().required().min(3).max(100).trim(),
    document: Joi.string().pattern(/^\d{11,14}$/).required().trim()
  }).required()
}).options({ stripUnknown: true });

const adminSchema = Joi.object({
  uid: Joi.string().required().pattern(/^[a-zA-Z0-9]{20,}$/).trim(),
  plan: Joi.string().valid("basic", "pro", "family").required().lowercase(),
  adminKey: Joi.string().required().min(32).max(128)
}).options({ stripUnknown: true });

// Schema para mensagens de IA
const aiMessageSchema = Joi.object({
  role: Joi.string().valid("user", "assistant", "system").required(),
  content: Joi.string().required().min(1).max(4000).trim()
}).options({ stripUnknown: true });

const aiChatSchema = Joi.object({
  messages: Joi.array().items(aiMessageSchema).min(1).max(50).required(),
  model: Joi.string().valid("llama-3.3-70b-versatile", "llama-3.1-70b-versatile").optional(),
  uid: Joi.string().pattern(/^[a-zA-Z0-9]{20,}$/).optional() // Para dev.js
}).options({ stripUnknown: true });

// ================================
// SECURITY: Middleware de Autenticação
// ================================
async function verifyFirebaseToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No authorization token" });
    }
    const token = authHeader.substring(7);
    if (!token || token.length < 10) {
      return res.status(401).json({ error: "Invalid token format" });
    }
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("[Auth] Token inválido - Code:", error.code);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ================================
// SECURITY: Logging seguro (sem dados sensíveis)
// ================================
function safeLog(context, data) {
  if (!data) return;
  const safe = JSON.parse(JSON.stringify(data));
  // Remove dados sensíveis
  if (safe.apiKey) safe.apiKey = "***";
  if (safe.token) safe.token = "***";
  if (safe.secret) safe.secret = "***";
  if (safe.signature) safe.signature = "***";
  if (safe.customer?.document) safe.customer.document = safe.customer.document.slice(-4).padStart(14, "*");
  if (safe.customer?.email) safe.customer.email = safe.customer.email.split("@")[0].slice(0, 2) + "***@***";
  if (safe.body) safe.body = "[redacted]";
  console.log(`[${context}]`, safe);
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

function priceForPlan(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "basic") return 10.9;
  if (p === "family") return 25.9;
  if (p === "pro") return 15.9;
  return 0;
}

async function setUserPlan(uid, plan) {
  const ref = db.collection("users").doc(uid).collection("meta").doc("settings");
  await ref.set({ plan, planStartDate: Date.now(), updatedAt: Date.now() }, { merge: true });
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

    // Verificar se o PagHiper rejeitou a transação
    if (createReq?.result === "reject") {
      const errorMessage = createReq?.response_message || "Pagamento rejeitado pela API";
      console.error("[Payment] PagHiper rejeitou:", errorMessage);
      return res.status(400).json({
        error: "payment_rejected",
        message: errorMessage
      });
    }

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
    const responseData = e.response?.data || {};

    console.error("[Payment] Erro:", {
      status: errorStatus,
      error: e.code,
      url: e.config?.url,
      responseData: JSON.stringify(responseData)
    });

    // Se o erro veio do PagHiper, retornar a mensagem específica
    const paghiperError = responseData?.pix_create_request?.response_message ||
      responseData?.create_request?.response_message ||
      responseData?.message;

    return res.status(errorStatus >= 400 && errorStatus < 600 ? errorStatus : 500).json({
      error: "payment_creation_failed",
      message: paghiperError || "Erro ao processar pagamento"
    });
  }
});

// ================================
// PAYMENTS: Webhook com assinatura HMAC (timing-safe)
// ================================
function verifyWebhookSignature(body, signature) {
  const secret = process.env.PAGHIPER_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[Webhook] PAGHIPER_WEBHOOK_SECRET não configurado");
    return false;
  }

  if (!signature || typeof signature !== "string" || signature.length !== 64) {
    return false;
  }

  const bodyString = typeof body === "string" ? body : JSON.stringify(body);
  const hash = crypto
    .createHmac("sha256", secret)
    .update(bodyString)
    .digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(signature, "hex")
  );
}

app.post("/payments/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const signature = req.headers["x-webhook-signature"];

    // SECURITY: Validar assinatura do webhook
    try {
      if (!verifyWebhookSignature(body, signature)) {
        console.warn("[Webhook] Tentativa de webhook com assinatura inválida");
        return res.status(401).send("Unauthorized");
      }
    } catch (sigError) {
      console.warn("[Webhook] Erro ao verificar assinatura");
      return res.status(401).send("Unauthorized");
    }

    const status = String(body.status || body.notification_status || "").toLowerCase();
    const orderId = String(body.order_id || body.reference || "");

    if (!orderId || orderId.length > 100) return res.status(400).send("Invalid reference");

    const m = orderId.match(/^uid_([a-zA-Z0-9]+)_(basic|pro|family)_\d+$/);
    const uid = m?.[1] || "";
    const plan = m?.[2] || "";

    if (!uid || !plan) {
      console.warn("[Webhook] Falha ao parsear referência (formato inválido)");
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
// AI: Rate limiter específico para IA
// ================================
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: parseInt(process.env.AI_RATE_LIMIT_MAX) || 50, // 50 requisições por IP
  message: "Limite de requisições de IA excedido. Tente novamente mais tarde.",
  standardHeaders: true,
  legacyHeaders: false,
});

// ================================
// AI: Proxy seguro para Groq API
// ================================
app.post("/ai/chat", aiLimiter, verifyFirebaseToken, async (req, res) => {
  try {
    const { messages, model } = req.body || {};

    // Validação de entrada
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: "missing_messages",
        message: "Mensagens são obrigatórias"
      });
    }

    // Validar tamanho das mensagens
    if (messages.length > 50) {
      return res.status(400).json({
        error: "too_many_messages",
        message: "Número máximo de mensagens excedido"
      });
    }

    // SECURITY: Verificar se o usuário tem acesso à IA
    const uid = req.user.uid;
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        error: "user_not_found",
        message: "Usuário não encontrado"
      });
    }

    const userData = userDoc.data() || {};
    if (!userData.aiPurchased) {
      return res.status(403).json({
        error: "ai_not_purchased",
        message: "Você precisa contratar a IA primeiro"
      });
    }

    // Obter chave da API do Groq
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

    if (!GROQ_API_KEY) {
      console.error("[AI] GROQ_API_KEY não configurada");
      return res.status(500).json({
        error: "ai_not_configured",
        message: "Serviço de IA não está configurado"
      });
    }

    // Sanitizar mensagens
    const sanitizedMessages = messages.map(msg => ({
      role: String(msg.role || "user").substring(0, 20),
      content: String(msg.content || "").substring(0, 4000)
    }));

    // SECURITY: Registrar uso da IA para auditoria
    await db.collection("ai_usage_logs").add({
      uid,
      timestamp: Date.now(),
      messageCount: sanitizedMessages.length,
      model: model || "llama-3.3-70b-versatile"
    });

    // Chamar a API do Groq
    const response = await axios.post(
      GROQ_API_URL,
      {
        model: model || "llama-3.3-70b-versatile",
        messages: sanitizedMessages,
        temperature: 0.7,
        max_tokens: 1000
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`
        },
        timeout: 30000 // 30 segundos
      }
    );

    const aiResponse = response.data?.choices?.[0]?.message?.content ||
      "Desculpe, não consegui processar sua mensagem.";

    return res.json({
      success: true,
      response: aiResponse,
      model: model || "llama-3.3-70b-versatile"
    });

  } catch (error) {
    console.error("[AI] Erro:", {
      status: error.response?.status,
      message: error.message,
      data: error.response?.data
    });

    if (error.response?.status === 429) {
      return res.status(429).json({
        error: "rate_limit",
        message: "Limite de uso da IA atingido. Tente novamente em alguns minutos."
      });
    }

    if (error.code === 'ECONNABORTED') {
      return res.status(408).json({
        error: "timeout",
        message: "Tempo de resposta excedido. Tente novamente."
      });
    }

    return res.status(500).json({
      error: "ai_error",
      message: "Erro ao processar mensagem com a IA"
    });
  }
});

// ================================
// ADMIN: Endpoint seguro para alterar plano
// ================================
app.post("/admin/set-plan", adminLimiter, verifyFirebaseToken, async (req, res) => {
  try {
    // SECURITY: Verificar se é admin via custom claims
    const claims = req.user.custom_claims || {};
    if (!claims.admin === true) {
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

    // SECURITY: Registrar alteração administrativa com IP
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0] || req.ip || "unknown";
    await db.collection("admin_logs").add({
      action: "set_plan",
      adminUid: req.user.uid,
      targetUid: uid,
      plan,
      clientIp,
      userAgent: req.headers["user-agent"],
      timestamp: Date.now()
    });

    await setUserPlan(uid, plan);

    console.log("[Admin] ✅ Plano alterado:", { uid, plan });

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
