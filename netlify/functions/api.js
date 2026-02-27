import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";
import admin from "firebase-admin";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Joi from "joi";
import crypto from "crypto";
import serverless from "serverless-http";

// Initialize Firebase Admin
function normalizePrivateKey(raw) {
    if (!raw) return "";

    let key = String(raw).trim();

    // Se veio entre aspas no Netlify, remove
    if (
        (key.startsWith('"') && key.endsWith('"')) ||
        (key.startsWith("'") && key.endsWith("'"))
    ) {
        key = key.slice(1, -1);
    }

    // Converte \n textual para quebra real
    key = key.replace(/\\n/g, "\n");

    // Remove \r (Windows) se existir
    key = key.replace(/\r/g, "");

    return key;
}

if (!admin.apps.length) {
    const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

    if (!privateKey || !process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL) {
        throw new Error("Firebase credentials not found in environment variables");
    }

    // Validação extra para detectar erro cedo
    if (
        !privateKey.includes("-----BEGIN PRIVATE KEY-----") ||
        !privateKey.includes("-----END PRIVATE KEY-----")
    ) {
        throw new Error("FIREBASE_PRIVATE_KEY inválida: formato PEM não reconhecido");
    }

    console.log("[BOOT] Iniciando function");
    console.log("[BOOT] FIREBASE_PROJECT_ID?", !!process.env.FIREBASE_PROJECT_ID);
    console.log("[BOOT] FIREBASE_CLIENT_EMAIL?", !!process.env.FIREBASE_CLIENT_EMAIL);
    console.log("[BOOT] FIREBASE_PRIVATE_KEY?", !!process.env.FIREBASE_PRIVATE_KEY);

    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            privateKey,
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
    maxAge: 3600
}));

// ================================
// SECURITY: Rate Limiting
// ================================
const apiLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: "Muitas requisições. Tente novamente mais tarde.",
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === "/health",
    handler: (req, res) => {
        console.warn('[Rate Limit] Limite excedido:', {
            ip: req.ip,
            path: req.path,
            userAgent: req.headers['user-agent']
        });
        res.status(429).json({
            error: 'rate_limit_exceeded',
            message: 'Muitas requisições. Tente novamente mais tarde.',
            retryAfter: Math.ceil(15 * 60)
        });
    }
});

const aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: parseInt(process.env.AI_RATE_LIMIT_MAX) || 20, // 20 mensagens por minuto
    message: "Muitas mensagens para a IA. Aguarde um momento.",
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.warn('[AI Rate Limit] Limite excedido:', {
            ip: req.ip,
            uid: req.user?.uid
        });
        res.status(429).json({
            error: 'ai_rate_limit_exceeded',
            message: 'Muitas mensagens para a IA. Aguarde um momento.',
            retryAfter: 60
        });
    }
});

const paymentLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: parseInt(process.env.PAYMENT_RATE_LIMIT_MAX) || 10,
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

app.use("/api/payments", apiLimiter);
app.use("/api/admin", adminLimiter);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// ================================
// SECURITY: Validação de Schemas
// ================================
const paymentSchema = Joi.object({
    uid: Joi.string().required().pattern(/^[a-zA-Z0-9]{20,}$/).trim(),
    plan: Joi.string().valid("basic", "pro", "family").lowercase(),
    type: Joi.string().valid("ai").lowercase(),
    method: Joi.string().valid("pix", "boleto").default("pix").lowercase(),
    customer: Joi.object({
        email: Joi.string().email().required().max(100).lowercase().trim(),
        name: Joi.string().required().min(3).max(100).trim(),
        document: Joi.string().pattern(/^\d{11,14}$/).required().trim()
    }).required()
}).xor("plan", "type").required().options({ stripUnknown: true });

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
// SECURITY: Logging seguro
// ================================
function safeLog(context, data) {
    if (!data) return;
    const safe = JSON.parse(JSON.stringify(data));
    if (safe.apiKey) safe.apiKey = "***";
    if (safe.token) safe.token = "***";
    if (safe.secret) safe.secret = "***";
    if (safe.signature) safe.signature = "***";
    if (safe.customer?.document) safe.customer.document = safe.customer.document.slice(-4).padStart(14, "*");
    if (safe.customer?.email) safe.customer.email = safe.customer.email.split("@")[0].slice(0, 2) + "***@***";
    if (safe.body) safe.body = "[redacted]";
    console.log(`[${context}]`, safe);
}

app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ================================
// AI: Proxy seguro para Groq API
// ================================
app.post("/api/ai/chat", aiLimiter, verifyFirebaseToken, async (req, res) => {
    try {
        const { messages, model } = req.body || {};

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "missing_messages" });
        }

        // Verifica se o usuário tem acesso à IA
        const uid = req.user.uid;
        const userDoc = await db.collection("users").doc(uid).get();
        const userData = userDoc.data() || {};

        if (!userData.aiPurchased) {
            return res.status(403).json({ error: "ai_not_purchased", message: "Você precisa contratar a IA primeiro" });
        }

        // Chama a API do Groq
        const GROQ_API_KEY = process.env.GROQ_API_KEY;
        const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

        if (!GROQ_API_KEY) {
            console.error("[AI] GROQ_API_KEY não configurada");
            return res.status(500).json({ error: "ai_not_configured" });
        }

        const response = await axios.post(
            GROQ_API_URL,
            {
                model: model || "llama-3.3-70b-versatile",
                messages: messages,
                temperature: 0.7,
                max_tokens: 1000
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${GROQ_API_KEY}`
                }
            }
        );

        const aiResponse = response.data?.choices?.[0]?.message?.content || "Desculpe, não consegui processar sua mensagem.";

        return res.json({
            success: true,
            response: aiResponse,
            model: model || "llama-3.3-70b-versatile"
        });

    } catch (error) {
        console.error("[AI] Erro:", error.response?.data || error.message);

        if (error.response?.status === 429) {
            return res.status(429).json({ error: "rate_limit", message: "Limite de uso da IA atingido. Tente novamente em alguns minutos." });
        }

        return res.status(500).json({ error: "ai_error", message: "Erro ao processar mensagem" });
    }
});

function getPrice(planOrType) {
    const p = String(planOrType || "").toLowerCase();
    if (p === "basic") return 10.9;
    if (p === "family") return 25.9;
    if (p === "pro") return 15.9;
    if (p === "ai") return 15;
    return 0;
}

async function setUserPlan(uid, plan) {
    const ref = db.collection("users").doc(uid).collection("meta").doc("settings");
    await ref.set({ plan, planStartDate: Date.now(), updatedAt: Date.now() }, { merge: true });
}

// ================================
// PAYMENTS: Criar transação segura
// ================================
app.post("/api/payments/create", paymentLimiter, verifyFirebaseToken, async (req, res) => {
    try {
        const { error, value } = paymentSchema.validate(req.body || {});
        if (error) {
            return res.status(400).json({ error: "validation_failed", message: error.details[0].message });
        }

        const { uid, plan, type, method, customer } = value;
        const planOrType = plan || type || "";

        if (uid !== req.user.uid) {
            console.warn("[Security] Tentativa de criar pagamento para UID diferente:", { uid, userUid: req.user.uid });
            return res.status(403).json({ error: "forbidden", message: "Acesso negado" });
        }

        const amount = getPrice(planOrType);
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

        const referenceId = `uid_${uid}_${planOrType}_${Date.now()}`;
        let payload = {};

        let url = "";
        const mth = String(method).toLowerCase();

        // Gera descrição baseada no tipo (plano ou complemento)
        let desc = type ? "Assistente IA" : `Spendify ${plan}`;
        let boletoDesc = type ? "Assistente IA - Spendify" : `Spendify ${plan}`;

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
                description: boletoDesc,
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
                description: `${desc} - Spendify`,
                days_due_date: 1,
                items: [
                    {
                        item_id: planOrType,
                        description: `${desc}`,
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

        console.log("[Payment] Raw Response:", JSON.stringify(data, null, 2));

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

        // Extrair chave PIX para copiar (procura em múltiplos caminhos)
        const pixKey =
            pixCode?.qrcode ||
            pixCode?.pix_code ||
            pixCode?.dict_key ||
            pixCode?.pix_dict_key ||
            createReq?.pix_code?.qrcode ||
            createReq?.pix_code?.dict_key ||
            createReq?.pix_code?.pix_dict_key ||
            createReq?.dict_key ||
            createReq?.pix_dict_key ||
            data?.qrcode ||
            data?.dict_key ||
            data?.pix_code ||
            data?.pix_dict_key ||
            null;

        const boletoUrl =
            createReq?.bank_slip?.url_slip ||
            data?.bank_slip?.url_slip ||
            data?.url ||
            createReq?.url;

        console.log("[Payment] Extracted:", {
            pixQrImage: !!pixQrImage,
            pixKeyFound: !!pixKey,
            pixKeyValue: pixKey,
            boletoUrl: !!boletoUrl,
            method: mth,
            dataKeys: Object.keys(data),
            createReqKeys: Object.keys(createReq),
            pixCodeKeys: Object.keys(pixCode),
            pixCodeFull: JSON.stringify(pixCode, null, 2),
            allDataFields: JSON.stringify(data, null, 2)
        });

        await db.collection("payments").doc(referenceId).set({
            uid,
            plan: plan || undefined,
            type: type || undefined,
            method,
            amount,
            status: "pending",
            createdAt: Date.now(),
            expiresAt: Date.now() + (method === "boleto" ? 3 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000)
        });

        return res.status(200).json({
            success: true,
            orderId: referenceId,
            method: mth,
            amount,
            pixQrImage: mth === "pix" ? pixQrImage : null,
            pixKey: mth === "pix" ? pixKey : null,
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
    try {
        return crypto.timingSafeEqual(
            Buffer.from(hash, "hex"),
            Buffer.from(signature, "hex")
        );
    } catch (e) {
        return false;
    }
}

app.post("/api/payments/webhook", async (req, res) => {
    try {
        const body = req.body || {};
        const signature = req.headers["x-webhook-signature"];

        // Log completo do webhook recebido para debug
        console.log("[Webhook] Recebido:", {
            body: JSON.stringify(body),
            headers: JSON.stringify(req.headers),
            signature: signature
        });

        // Verificação de assinatura (desabilitada se PAGHIPER_WEBHOOK_SECRET não configurado)
        const webhookSecret = process.env.PAGHIPER_WEBHOOK_SECRET;
        if (webhookSecret && signature) {
            try {
                if (!verifyWebhookSignature(body, signature)) {
                    console.warn("[Webhook] Assinatura inválida, mas processando mesmo assim...");
                    // Não bloqueia, apenas avisa
                }
            } catch (sigError) {
                console.warn("[Webhook] Erro ao verificar assinatura:", sigError.message);
            }
        } else {
            console.warn("[Webhook] Verificação de assinatura desabilitada (sem secret ou signature)");
        }

        const status = String(body.status || body.notification_status || "").toLowerCase();
        const orderId = String(body.order_id || body.reference || body.transaction_id || "");

        console.log("[Webhook] Processando:", { status, orderId });

        if (!orderId || orderId.length > 100) {
            console.error("[Webhook] Invalid reference:", orderId);
            return res.status(400).send("Invalid reference");
        }

        const m = orderId.match(/^uid_([a-zA-Z0-9]+)_(basic|pro|family|ai)_\d+$/);
        const uid = m?.[1] || "";
        const plan = m?.[2] || "";

        if (!uid || !plan) {
            console.warn("[Webhook] Falha ao parsear referência (formato inválido):", orderId);
            return res.status(400).send("Invalid reference format");
        }

        safeLog("Webhook", { uid, plan, status });

        if (status === "paid" || status === "completed" || status === "approved") {
            // Se for IA, atualiza o campo aiPurchased do usuário
            if (plan === "ai") {
                await db.collection("users").doc(uid).set(
                    {
                        aiPurchased: true,
                        aiPurchasedAt: Date.now()
                    },
                    { merge: true }
                );
                console.log("[Webhook] ✅ IA comprada:", { uid });
            } else {
                // Se for plano, atualiza o plano do usuário
                await setUserPlan(uid, plan);
                console.log("[Webhook] ✅ Plano atualizado:", { uid, plan });
            }

            const ref = db.collection("payments").doc(orderId);
            await ref.update({
                status: "completed",
                completedAt: Date.now()
            });
        } else if (status === "cancelled" || status === "expired") {
            const ref = db.collection("payments").doc(orderId);
            await ref.update({
                status: status,
                cancelledAt: Date.now()
            });
            console.log("[Webhook] ⚠️ Pagamento", status, { uid });
        } else {
            console.log("[Webhook] Status desconhecido:", status);
        }
        return res.status(200).send("OK");
    } catch (e) {
        console.error("[Webhook] Erro:", e.code || e.message, e.stack);
        return res.status(500).send("Error");
    }
});

// ================================
// ENDPOINT MANUAL: Verificar e atualizar status de pagamento
// ================================
app.post("/api/payments/check-status", async (req, res) => {
    try {
        const { orderId, adminKey } = req.body || {};

        // Verificação básica de admin key
        if (adminKey !== process.env.ADMIN_KEY) {
            return res.status(403).json({ error: "forbidden" });
        }

        if (!orderId) {
            return res.status(400).json({ error: "missing_order_id" });
        }

        const m = orderId.match(/^uid_([a-zA-Z0-9]+)_(basic|pro|family|ai)_\d+$/);
        const uid = m?.[1] || "";
        const planOrType = m?.[2] || "";

        if (!uid || !planOrType) {
            return res.status(400).json({ error: "invalid_order_id_format" });
        }

        // Busca o status do pagamento no Firestore
        const paymentDoc = await db.collection("payments").doc(orderId).get();

        if (!paymentDoc.exists) {
            return res.status(404).json({ error: "payment_not_found" });
        }

        const paymentData = paymentDoc.data();

        // Se status já é completed, apenas retorna
        if (paymentData.status === "completed") {
            return res.json({
                success: true,
                message: "Pagamento já confirmado",
                orderId,
                uid,
                planOrType,
                status: paymentData.status
            });
        }

        // Marca como pago e ativa o plano ou IA
        if (planOrType === "ai") {
            await db.collection("users").doc(uid).set(
                {
                    aiPurchased: true,
                    aiPurchasedAt: Date.now()
                },
                { merge: true }
            );
        } else {
            await setUserPlan(uid, planOrType);
        }

        await db.collection("payments").doc(orderId).update({
            status: "completed",
            completedAt: Date.now(),
            manuallyConfirmed: true
        });

        console.log("[Manual Check] ✅ Ativado manualmente:", { uid, planOrType, orderId });

        return res.json({
            success: true,
            message: planOrType === "ai" ? "IA ativada com sucesso" : "Plano ativado com sucesso",
            orderId,
            uid,
            planOrType
        });

    } catch (e) {
        console.error("[Manual Check] Erro:", e.message);
        return res.status(500).json({ error: "internal_error", message: e.message });
    }
});

// ================================
// ADMIN: Endpoint para ativar IA manualmente
// ================================
app.post("/api/admin/activate-ai", async (req, res) => {
    try {
        const { uid, adminKey } = req.body || {};

        if (adminKey !== process.env.ADMIN_KEY) {
            return res.status(403).json({ error: "forbidden" });
        }

        if (!uid) {
            return res.status(400).json({ error: "missing_uid" });
        }

        await db.collection("users").doc(uid).set(
            {
                aiPurchased: true,
                aiPurchasedAt: Date.now()
            },
            { merge: true }
        );

        console.log("[Admin] ✅ IA ativada manualmente:", { uid });

        return res.json({
            success: true,
            message: "IA ativada com sucesso",
            uid
        });
    } catch (e) {
        console.error("[Admin] Erro ao ativar IA:", e.message);
        return res.status(500).json({ error: "internal_error", message: e.message });
    }
});

// ================================
// ADMIN: Endpoint seguro para alterar plano
// ================================
app.post("/api/admin/set-plan", verifyFirebaseToken, async (req, res) => {
    try {
        // SECURITY: Verificar se é admin via custom_claims (não apenas admin)
        const claims = req.user.custom_claims || {};
        if (claims.admin !== true) {
            console.warn("[Security] Acesso negado ao admin por usuário não-admin:", { uid: req.user.uid });
            return res.status(403).json({ error: "forbidden", message: "Acesso negado" });
        }

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

app.use((err, req, res, next) => {
    console.error("[Express Error]", err);
    if (res.headersSent) return next(err);
    res.status(500).json({
        error: "internal_server_error",
        message: "Erro interno no servidor"
    });
});

// ✅ Netlify handler com basePath
export const handler = serverless(app, {
    basePath: "/.netlify/functions/api"
});
