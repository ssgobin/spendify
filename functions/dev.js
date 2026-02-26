import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";
import admin from "firebase-admin";
import { readFileSync } from "fs";

// Initialize Firebase Admin
const serviceAccount = JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"));
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: "salary-saas",
});
const db = admin.firestore();

const app = express();
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ================================
// AI: Proxy seguro para Groq API
// ================================
app.post("/ai/chat", async (req, res) => {
    try {
        const { messages, model, uid } = req.body || {};

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "missing_messages" });
        }

        if (!uid) {
            return res.status(400).json({ error: "missing_uid" });
        }

        // Verifica se o usuário tem acesso à IA
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
    if (p === "test") return 0.5;      // Plano de teste com R$ 0,50
    if (p === "basic") return 10.9;
    if (p === "family") return 25.9;
    if (p === "pro") return 15.9;
    if (p === "ai") return 15;         // Complemento IA
    return 0;
}

// Validação básica de CPF (11 dígitos)
function isValidCPF(cpf) {
    const cleaned = String(cpf || "").replace(/\D/g, "");
    return cleaned.length === 11 && /^\d+$/.test(cleaned);
}

// Validação básica de CNPJ (14 dígitos)
function isValidCNPJ(cnpj) {
    const cleaned = String(cnpj || "").replace(/\D/g, "");
    return cleaned.length === 14 && /^\d+$/.test(cleaned);
}

async function setUserPlan(uid, plan) {
    const ref = db.collection("users").doc(uid).collection("meta").doc("settings");
    await ref.set({ plan, planStartDate: Date.now(), updatedAt: Date.now() }, { merge: true });
}

app.post("/payments/create", async (req, res) => {
    try {
        const { uid, plan, type, method = "pix", customer = {} } = req.body || {};
        const planOrType = plan || type || "";

        if (!uid || !planOrType) return res.status(400).json({ error: "missing_params" });
        if (plan && type) return res.status(400).json({ error: "invalid_params", message: "Envie apenas 'plan' OU 'type', não ambos" });

        // Validar document
        const document = String(customer.document || "").replace(/\D/g, "");
        if (!document) {
            return res.status(400).json({ error: "missing_document", message: "CPF/CNPJ é obrigatório" });
        }

        const isValidDoc = isValidCPF(document) || isValidCNPJ(document);
        if (!isValidDoc) {
            return res.status(400).json({ error: "invalid_document", message: "CPF/CNPJ inválido. Deve ter 11 (CPF) ou 14 (CNPJ) dígitos." });
        }

        const amount = getPrice(planOrType);
        if (amount <= 0) return res.status(400).json({ error: "invalid_plan_or_type" });
        if (String(method).toLowerCase() === "pix" && amount < 3) {
            return res.status(400).json({ error: "amount_too_low_for_pix" });
        }

        const API_KEY = process.env.PAGHIPER_API_KEY || "";
        const TOKEN = process.env.PAGHIPER_TOKEN || "";
        if (!API_KEY || !TOKEN) return res.status(500).json({ error: "gateway_not_configured" });

        const referenceId = `uid_${uid}_${planOrType}_${Date.now()}`;
        let payload = {};

        // Gera descrição baseada no tipo (plano ou complemento)
        let desc = type ? "Assistente IA" : `Spendify ${plan}`;
        let boletoDesc = type ? "Assistente IA - Spendify" : `Spendify ${plan}`;

        let url = "";
        const mth = String(method).toLowerCase();
        if (mth === "boleto") {
            url = process.env.PAGHIPER_BOLETO_URL || "";
            payload = {
                apiKey: API_KEY,
                token: TOKEN,
                order_id: referenceId,
                notification_url: process.env.PAGHIPER_WEBHOOK_URL || "",
                value_cents: Math.round(amount * 100),
                payer_email: customer.email || "",
                payer_name: customer.name || "",
                payer_cpf_cnpj: customer.document || "",
                days_due_date: 3,
                fixed_description: true,
                description: boletoDesc,
            };
        } else {
            url = process.env.PAGHIPER_PIX_URL || "";
            payload = {
                apiKey: API_KEY,
                token: TOKEN,
                order_id: referenceId,
                payer_email: customer.email || "",
                payer_name: customer.name || "",
                payer_cpf_cnpj: customer.document || "",
                notification_url: process.env.PAGHIPER_WEBHOOK_URL || "",
                fixed_description: true,
                description: `${desc} - Spendify`,
                days_due_date: 1,
                items: [
                    {
                        item_id: planOrType,
                        description: desc,
                        quantity: "1",
                        price_cents: Math.round(amount * 100)
                    }
                ]
            };
        }
        if (!url) return res.status(500).json({ error: "endpoint_not_configured" });

        console.log("[Payment] Chamando Paghiper", { url, method: mth, amount });
        console.log("[Payment] Payload:", JSON.stringify(payload, null, 2));
        const axiosConfig = {
            timeout: 15000,
            headers: { "Content-Type": "application/json" }
        };
        const r = await axios.post(url, payload, axiosConfig);
        const data = r.data || {};

        console.log("[Payment] Raw Response:", JSON.stringify(data, null, 2));

        // Verifica se a API do PagHiper retornou erro
        const createReq = data?.pix_create_request || data?.create_request || {};
        if (createReq?.result === "reject") {
            console.error("[Payment] PagHiper rejeitou:", createReq?.response_message);
            return res.status(400).json({
                error: "payment_rejected",
                message: createReq?.response_message || "Pagamento rejeitado pela API"
            });
        }

        const pixCode = createReq?.pix_code || {};

        console.log("[Payment] Paths searched:", {
            createReq: !!createReq,
            pixCode: !!pixCode,
            "pixCode.qrcode_image_url": pixCode?.qrcode_image_url,
            "pixCode.qrcode_base64": !!pixCode?.qrcode_base64,
            "createReq.qrcode_image": createReq?.qrcode_image,
            "createReq.pix_qr_image": createReq?.pix_qr_image,
            "data.qrcode_image": data?.qrcode_image,
            "data.pix_qr_image": data?.pix_qr_image,
        });

        // Tenta extrair a imagem do QR code
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

        // Extrai URL do boleto
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

        // Debug: mostra a estrutura completa
        if (!pixQrImage && mth === "pix") {
            console.log("[Payment] ⚠️ QR Code não encontrado! Estrutura dos dados:", {
                dataKeys: Object.keys(data),
                createReqKeys: Object.keys(createReq),
                pixCodeKeys: Object.keys(pixCode),
                firstLevelValues: Object.entries(data).slice(0, 5).reduce((acc, [k, v]) => {
                    acc[k] = typeof v === 'string' ? v.substring(0, 100) : (typeof v === 'object' ? Object.keys(v) : v);
                    return acc;
                }, {})
            });
        }

        return res.json({
            success: true,
            orderId: referenceId,
            method: mth,
            amount,
            pixQrImage: mth === "pix" ? pixQrImage : null,
            pixKey: mth === "pix" ? pixKey : null,
            boletoUrl: mth === "boleto" ? boletoUrl : null
        });
    } catch (e) {
        const errorMsg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
        const errorStatus = e.response?.status || 500;
        console.error("[Payment] Error:", { status: errorStatus, error: errorMsg, url });
        return res.status(errorStatus).json({
            error: "create_failed",
            message: errorMsg,
            url: url
        });
    }
});

app.post("/payments/webhook", async (req, res) => {
    try {
        const body = req.body || {};

        // Log completo do webhook recebido para debug
        console.log("[Webhook] Recebido:", {
            body: JSON.stringify(body),
            headers: JSON.stringify(req.headers)
        });

        const status = String(body.status || body.notification_status || "").toLowerCase();
        const orderId = String(body.order_id || body.reference || body.transaction_id || "");

        console.log("[Webhook] Processando:", { status, orderId });

        if (!orderId) {
            console.error("[Webhook] missing_reference");
            return res.status(400).send("missing_reference");
        }

        const m = orderId.match(/^uid_(.+?)_(basic|pro|family|ai)_/);
        const uid = m?.[1] || "";
        const planOrType = m?.[2] || "";
        if (!uid || !planOrType) {
            console.error("[Webhook] Falha ao parsear referência:", { orderId });
            return res.status(400).send("invalid_reference");
        }

        console.log("[Webhook] Processando pagamento:", { uid, planOrType, status });

        if (status === "paid" || status === "completed" || status === "approved") {
            // Se for IA, atualiza o campo aiPurchased do usuário
            if (planOrType === "ai") {
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
                await setUserPlan(uid, planOrType);
                console.log("[Webhook] ✅ Plano atualizado:", { uid, plan: planOrType });
            }
        } else {
            console.log("[Webhook] Status:", { status });
        }
        return res.status(200).send("OK");
    } catch (e) {
        console.error("[Webhook] Erro:", e.message, e.stack);
        return res.status(500).send("ERR");
    }
});

// Endpoint manual para ativar pagamento
app.post("/payments/check-status", async (req, res) => {
    try {
        const { orderId, adminKey } = req.body || {};

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

        // Simula confirmação de pagamento
        if (planOrType === "ai") {
            await db.collection("users").doc(uid).set(
                {
                    aiPurchased: true,
                    aiPurchasedAt: Date.now()
                },
                { merge: true }
            );
            console.log("[Manual Check] ✅ IA ativada manualmente:", { uid, orderId });
        } else {
            await setUserPlan(uid, planOrType);
            console.log("[Manual Check] ✅ Plano ativado manualmente:", { uid, plan: planOrType, orderId });
        }

        return res.json({
            success: true,
            message: planOrType === "ai" ? "IA ativada com sucesso" : "Plano ativado com sucesso",
            orderId,
            uid,
            [planOrType === "ai" ? "type" : "plan"]: planOrType
        });

    } catch (e) {
        console.error("[Manual Check] Erro:", e.message);
        return res.status(500).json({ error: "internal_error", message: e.message });
    }
});

// Endpoint de admin: Ativar IA manualmente
app.post("/admin/activate-ai", async (req, res) => {
    try {
        const { uid, adminKey } = req.body || {};

        if (adminKey !== process.env.ADMIN_KEY) {
            return res.status(403).json({ error: "forbidden" });
        }

        if (!uid) {
            return res.status(400).json({ error: "missing_uid" });
        }

        // Ativa IA para o usuário
        await db.collection("users").doc(uid).set(
            {
                aiPurchased: true,
                aiPurchasedAt: Date.now()
            },
            { merge: true }
        );

        console.log("[Admin] ✅ IA ativada manualmente para:", uid);

        return res.json({
            success: true,
            message: "IA ativada com sucesso",
            uid,
            aiPurchased: true
        });

    } catch (e) {
        console.error("[Admin] Erro:", e.message);
        return res.status(500).json({ error: "internal_error", message: e.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`\n🚀 API rodando em http://localhost:${PORT}`);
    console.log(`   GET  http://localhost:${PORT}/health`);
    console.log(`   POST http://localhost:${PORT}/ai/chat`);
    console.log(`   POST http://localhost:${PORT}/payments/create`);
    console.log(`   POST http://localhost:${PORT}/admin/activate-ai (admin)\n`);
});
