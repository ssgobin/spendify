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

function priceForPlan(plan) {
    const p = String(plan || "").toLowerCase();
    if (p === "basic") return 10.9;
    if (p === "family") return 25.9;
    if (p === "pro") return 15.9;
    return 0;
}

async function setUserPlan(uid, plan) {
    const ref = db.collection("users").doc(uid).collection("meta").doc("settings");
    await ref.set({ plan, updatedAt: Date.now() }, { merge: true });
}

app.post("/payments/create", async (req, res) => {
    try {
        const { uid, plan, method = "pix", customer = {} } = req.body || {};
        if (!uid || !plan) return res.status(400).json({ error: "missing_params" });
        const amount = priceForPlan(plan);
        if (amount <= 0) return res.status(400).json({ error: "invalid_plan" });
        if (String(method).toLowerCase() === "pix" && amount < 3) {
            return res.status(400).json({ error: "amount_too_low_for_pix" });
        }

        const API_KEY = process.env.PAGHIPER_API_KEY || "";
        const TOKEN = process.env.PAGHIPER_TOKEN || "";
        if (!API_KEY || !TOKEN) return res.status(500).json({ error: "gateway_not_configured" });

        const referenceId = `uid_${uid}_${plan}_${Date.now()}`;
        let payload = {};

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
                description: `Spendify ${plan}`,
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

        console.log("[Payment] Chamando Paghiper", { url, method: mth, amount });
        console.log("[Payment] Payload:", JSON.stringify(payload, null, 2));
        const axiosConfig = {
            timeout: 15000,
            headers: { "Content-Type": "application/json" }
        };
        const r = await axios.post(url, payload, axiosConfig);
        const data = r.data || {};

        console.log("[Payment] Status Paghiper:", r.status);
        console.log("[Payment] Headers Paghiper:", r.headers);
        console.log("[Payment] Resposta completa Paghiper:", JSON.stringify(data, null, 2));

        const createReq = data?.pix_create_request || data?.create_request || {};
        const pixCode = createReq?.pix_code || {};

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

        // Extrai URL do boleto
        const boletoUrl =
            createReq?.bank_slip?.url_slip ||
            data?.bank_slip?.url_slip ||
            data?.url ||
            createReq?.url;

        console.log("[Payment] Extraído:", { pixQrImage: !!pixQrImage, boletoUrl: !!boletoUrl });
        return res.json({
            ok: true,
            method: mth,
            gateway: "paghiper",
            referenceId,
            boleto_url: boletoUrl || "",
            pix_qr_image: pixQrImage || "",
            raw: data,
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
        console.log("[Webhook] Recebido:", { status: body.status || body.notification_status, orderId: body.order_id || body.reference });

        const status = String(body.status || body.notification_status || "").toLowerCase();
        const orderId = String(body.order_id || body.reference || "");
        if (!orderId) return res.status(400).send("missing_reference");

        const m = orderId.match(/^uid_(.+?)_(basic|pro|family)_/);
        const uid = m?.[1] || "";
        const plan = m?.[2] || "";
        if (!uid || !plan) {
            console.error("[Webhook] Falha ao parsear referência:", { orderId });
            return res.status(400).send("invalid_reference");
        }

        console.log("[Webhook] Processando pagamento:", { uid, plan, status });

        if (status === "paid" || status === "completed" || status === "approved") {
            await setUserPlan(uid, plan);
            console.log("[Webhook] ✅ Plano atualizado:", { uid, plan });
        } else {
            console.log("[Webhook] Status não é pago:", { status });
        }
        return res.status(200).send("OK");
    } catch (e) {
        console.error("[Webhook] Erro:", e.message);
        return res.status(500).send("ERR");
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`\n🚀 API rodando em http://localhost:${PORT}`);
    console.log(`   GET  http://localhost:${PORT}/health`);
    console.log(`   POST http://localhost:${PORT}/payments/create\n`);
});
