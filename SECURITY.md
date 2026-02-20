# 🔐 Guia de Segurança - Backend Spendify

## Melhorias de Segurança Implementadas

### 1. **Headers de Segurança (Helmet)**
- Proteção contra XSS, Clickjacking, MIME-type sniffing
- Configurações de Content Security Policy (CSP)
- Prevenção de ataques comuns via headers HTTP

### 2. **CORS Restritivo**
- ✅ **ANTES**: Permitia todas as origens (`*`)
- ✅ **DEPOIS**: Apenas domínios configurados em `ALLOWED_ORIGINS`
- Credenciais habilitadas apenas para origens autorizadas

### 3. **Autenticação com Firebase**
- ✅ Todos os endpoints sensíveis requerem token JWT do Firebase
- ✅ Verificação automática de identidade do usuário
- ✅ Admin panel protegido por `custom_claims`

### 4. **Rate Limiting**
```
- API Geral: 100 requisições / 15 minutos por IP
- Pagamentos: 10 requisições / 1 hora por IP
- Admin: 30 requisições / 15 minutos por IP
```

### 5. **Validação de Entrada (Joi)**
- Schemas rigorosos para todo input
- Validação de email, documento (CPF/CNPJ), UID
- Limite de tamanho de payload (10KB)

### 6. **Segurança de Pagamento**
- ✅ Verificação de assinatura HMAC no webhook
- ✅ Armazenamento de transações no Firestore para auditoria
- ✅ Validação de que UID pertence ao usuário autenticado

### 7. **Logging Seguro**
- ✅ **ANTES**: Expunha dados sensíveis (email, documento completo)
- ✅ **DEPOIS**: Mascaramento automático de dados sensíveis
  - Email: `jo***@***`
  - Documento: `**********1234`
  - API Keys/Tokens: `***`

### 8. **Tratamento de Erros**
- ✅ **ANTES**: Retornava detalhes da API em caso de erro
- ✅ **DEPOIS**: Apenas mensagens genéricas ao cliente
- ✅ Informações detalhadas apenas nos logs internos

### 9. **Admin Panel Seguro**
- ✅ **ANTES**: Usava `adminKey` em plaintext no body
- ✅ **DEPOIS**: Usa Firebase Authentication + custom claims
- ✅ Todas as ações administrativas são auditadas em `admin_logs`

### 10. **Proteção Contra Ataques Comuns**
- XSS prevention via Helmet + Content-Type validation
- CSRF prevention via CORS configuration
- Injection prevention via Joi validation
- Brute force prevention via rate limiting
- Parameter tampering prevention via UID verification

---

## Variáveis de Ambiente Obrigatórias

```bash
# Paghiper
PAGHIPER_API_KEY=your_api_key
PAGHIPER_TOKEN=your_token
PAGHIPER_WEBHOOK_SECRET=your_webhook_secret
PAGHIPER_PIX_URL=https://pix.paghiper.com/invoice/create/
PAGHIPER_BOLETO_URL=https://boleto.paghiper.com/invoice/create/
PAGHIPER_WEBHOOK_URL=https://your-domain.com/api/payments/webhook

# CORS
ALLOWED_ORIGINS=https://your-domain.com,https://www.your-domain.com
```

---

## Configuração de Admin no Firebase

Para designar um admin:

```javascript
// No Firebase Console ou via Admin SDK
await admin.auth().setCustomUserClaims(uid, { admin: true });
```

---

## Fluxo de Autenticação

### Criar Pagamento
```
1. Cliente autentica com Firebase ID Token
2. Token é enviado no header: Authorization: Bearer <token>
3. Servidor valida token e extrai UID
4. Verifica se UID no request == UID do token
5. Rate limiting bloqueia abuso
6. Joi valida entrada
7. Transação é criada e armazenada para auditoria
```

### Webhook de Pagamento
```
1. Paghiper envia webhook com signature HMAC
2. Servidor valida signature usando PAGHIPER_WEBHOOK_SECRET
3. Extrai UID e plan da ordem
4. Atualiza status do usuário no Firestore
5. Log seguro sem dados sensíveis
```

### Admin Panel
```
1. Usuário autentica com Firebase
2. Servidor verifica custom_claims.admin
3. Apenas admins podem alterar planos
4. Todas as ações são registradas em admin_logs
```

---

## Checklist de Deploy

- [ ] Configurar `ALLOWED_ORIGINS` com domínios corretos
- [ ] Gerar `PAGHIPER_WEBHOOK_SECRET` seguro (mínimo 32 caracteres)
- [ ] Nunca committar `.env` (use `.env.example`)
- [ ] Configurar admins via Firebase Console
- [ ] Testar webhook com assinatura válida
- [ ] Validar CORS com curl: `curl -H "Origin: https://your-domain.com" https://api.your-domain.com/health`
- [ ] Monitorar logs para tentativas suspeitas
- [ ] Habilitar 2FA nas contas administrativas

---

## Monitoramento Recomendado

1. **Rate Limiting Alerts**: Alertar se IP ultrapassa limite
2. **Failed Auth Attempts**: Monitorar tokens inválidos
3. **Admin Actions**: Log de todas as alterações administrativas
4. **Webhook Failures**: Rastrear falhas de assinatura
5. **Error Rates**: Alertar se taxa de erro > 5%

---

## Recursos Adicionais

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Firebase Security Best Practices](https://firebase.google.com/docs/rules)
- [Express.js Security](https://expressjs.com/en/advanced/best-practice-security.html)
- [PCI DSS Compliance](https://www.pcisecuritystandards.org/)

