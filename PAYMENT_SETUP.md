# Setup de Pagamentos - Spendify

## 📋 Checklist

- [x] API de pagamento integrada com Paghiper
- [x] Frontend monitora confirmação de pagamento
- [x] Webhook para receber notificações do Paghiper
- [ ] Webhook URL configurado
- [ ] Regras do Firestore configuradas
- [ ] Deploy em produção

## 🔧 Configuração Necessária

### 1. Webhook URL em Produção

No arquivo [functions/.env](functions/.env), atualize:

```env
PAGHIPER_WEBHOOK_URL=https://seu-dominio.com/api/payments/webhook
```

**Importante:** O Paghiper só pode chamar webhooks públicos (HTTPS). Em desenvolvimento local, deixe vazio.

---

### 2. Regras de Segurança do Firestore

Configure as regras de acesso no **Firebase Console** → **Firestore** → **Rules**:

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Usuários podem ler/escrever seus próprios dados
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
      
      // Firebase Functions Admin pode atualizar planos
      allow write: if false;
    }
    
    // Admins podem ler tudo
    match /{document=**} {
      allow read, write: if isAdmin();
    }
  }
  
  function isAdmin() {
    return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == "admin";
  }
}
```

---

### 3. Testando Localmente

```bash
# Terminal 1: Inicia a API
cd functions
node dev.js

# Terminal 2: No navegador
# Abre http://localhost:3000
# DevTools (F12) mostra logs [Payment] em tempo real
# Terminal 1 mostra logs [Payment] e [Webhook]
```

---

### 4. Fluxo de Pagamento

1. **Usuário clica "Upgrade"** → `createPaymentFlow(plan)`
2. **Modal pede CPF/CNPJ** → Valida dados
3. **API cria pagamento** → Paghiper gera QR Code
4. **Modal mostra QR Code** → `[Payment] Monitorando plano...`
5. **Usuário paga via PIX/Boleto**
6. **Paghiper notifica webhook** → `/payments/webhook`
7. **Webhook atualiza Firestore** → `users/{uid}/meta/settings`
8. **Frontend detecta mudança** → Mostra "✅ Pagamento confirmado!"
9. **Recarrega página** com novo plano ativo

---

### 5. Logs Importantes

#### No console do navegador (F12):
```
[Payment] criando pagamento
[Payment] Response status: 200
[Payment] Raw response: {...}
[Payment] Monitorando plano para confirmação...
[Payment] Plano atual: family
✅ Pagamento confirmado!
```

#### No terminal (node dev.js):
```
[Payment] Chamando Paghiper
[Payment] Payload: {...}
[Payment] Status Paghiper: 201
[Payment] Resposta completa Paghiper: {...}
[Webhook] Recebido: { status: 'paid', orderId: '...' }
[Webhook] ✅ Plano atualizado: { uid: '...', plan: 'family' }
```

---

### 6. Troubleshooting

**❌ "days_due_date invalido"**
- Solução: Reinicie o servidor (`node dev.js`)

**❌ "items invalidos"**
- Solução: Verifique se `item_id`, `quantity` e `price_cents` estão corretos

**❌ Webhook não chama**
- Paghiper precisa de HTTPS público
- Configure em PAGHIPER_WEBHOOK_URL
- Registre a URL na conta Paghiper (Settings → Webhooks)

**❌ Plano não atualiza após pagamento**
- Verificar Firestore Rules
- Verificar se o webhook foi chamado (logs no terminal)
- Verificar se a `order_id` segue o padrão `uid_..._plan_...`

---

## 📱 Endpoints

**POST** `/api/payments/create`
```json
{
  "uid": "user_id",
  "plan": "basic|pro|family",
  "customer": {
    "email": "user@email.com",
    "name": "Full Name",
    "document": "12345678901"
  }
}
```

**POST** `/api/payments/webhook` (Paghiper)
```json
{
  "status": "paid",
  "order_id": "uid_..._plan_...",
  "transaction_id": "..."
}
```

---

## 💰 Preços

- **Basic**: R$ 6,90/mês
- **Pro**: R$ 19,90/mês
- **Family**: R$ 29,90/mês

---

## 🔒 Segurança

✅ CPF/CNPJ obrigatório e validado no Paghiper
✅ Order ID única por transação
✅ Usuário UID na order ID para rastreabilidade
✅ Webhook valida plano antes de atualizar
✅ Firestore Rules protegem dados do usuário

---

## 📚 Referências

- [Paghiper Docs](https://dev.paghiper.com)
- [Firebase Firestore Rules](https://firebase.google.com/docs/firestore/security/start)
- [Express.js Documentation](https://expressjs.com)
