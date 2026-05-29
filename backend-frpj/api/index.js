// ══════════════════════════════════════════════════════
//  FRPJSTORE.BR — Servidor Backend
//  Mercado Pago Checkout Pro + Google Sheets
// ══════════════════════════════════════════════════════
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { google } = require('googleapis');

const app = express();

// ── MIDDLEWARES ──────────────────────────────────────
app.use(express.json());
app.use(cors({
  origin: [
    'https://rodriguindogradu066.github.io/FRPJ',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    /\.github\.io$/,
    /\.vercel\.app$/
  ],
  credentials: true
}));

// ── MERCADO PAGO ─────────────────────────────────────
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 5000 }
});
const preference = new Preference(mpClient);
const payment    = new Payment(mpClient);

// ── GOOGLE SHEETS ────────────────────────────────────
function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

// ── HELPERS ──────────────────────────────────────────
function formatDate(date = new Date()) {
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function gerarId() {
  return 'FRP' + Date.now().toString(36).toUpperCase();
}

// ── ROTAS ────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'FRPJSTORE.BR Backend', versao: '1.0.0' });
});

// ─────────────────────────────────────────────────────
// POST /criar-preferencia
// ─────────────────────────────────────────────────────
app.post('/criar-preferencia', async (req, res) => {
  try {
    const { produto, tamanho, cliente } = req.body;
    if (!produto || !tamanho || !cliente) {
      return res.status(400).json({ erro: 'Dados incompletos.' });
    }

    const pedidoId = gerarId();
    const siteUrl  = process.env.SITE_URL || 'https://rodriguindogradu066.github.io/FRPJ';

    const prefData = {
      external_reference: pedidoId,
      items: [{
        id:          String(produto.id),
        title:       produto.nome,
        description: `Camiseta ${produto.nome} — Tamanho ${tamanho}`,
        category_id: 'fashion',
        quantity:    1,
        currency_id: 'BRL',
        unit_price:  Number(produto.preco)
      }],
      payer: {
        name:    cliente.nome.split(' ')[0],
        surname: cliente.nome.split(' ').slice(1).join(' ') || '',
        email:   cliente.email,
        phone:   { area_code: cliente.telefone?.slice(0,2) || '63', number: cliente.telefone?.slice(2) || '' }
      },
      payment_methods: { installments: 12 },
      back_urls: {
        success: `${siteUrl}/sucesso.html?pedido=${pedidoId}`,
        failure: `${siteUrl}/falha.html?pedido=${pedidoId}`,
        pending: `${siteUrl}/pendente.html?pedido=${pedidoId}`
      },
      auto_return: 'approved',
      notification_url: `https://backend-frpj.vercel.app/webhook`,
      metadata: { pedido_id: pedidoId, tamanho, ...cliente }
    };

    const resp = await preference.create({ body: prefData });

    await salvarPedido({ pedidoId, status: 'AGUARDANDO_PAGAMENTO', produto: produto.nome, tamanho, preco: produto.preco, cliente });

    res.json({
      pedido_id:          pedidoId,
      init_point:         resp.init_point,
      sandbox_init_point: resp.sandbox_init_point
    });

  } catch (err) {
    console.error('Erro ao criar preferencia:', err);
    res.status(500).json({ erro: 'Erro interno ao criar preferencia.' });
  }
});

// ─────────────────────────────────────────────────────
// POST /webhook — notificações do Mercado Pago
// ─────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type === 'payment') {
      const paymentId = data?.id;
      if (!paymentId) return res.sendStatus(200);
      const pay = await payment.get({ id: paymentId });
      const statusMap = {
        approved: 'PAGO ✅', pending: 'PENDENTE ⏳',
        in_process: 'PROCESSANDO 🔄', rejected: 'RECUSADO ❌',
        cancelled: 'CANCELADO 🚫', refunded: 'REEMBOLSADO 💸'
      };
      const status    = statusMap[pay.status] || pay.status.toUpperCase();
      const pedidoId  = pay.external_reference;
      const payMethod = pay.payment_type_id === 'credit_card' ? 'Cartao de Credito'
                      : pay.payment_type_id === 'debit_card'  ? 'Cartao de Debito'
                      : pay.payment_type_id === 'ticket'      ? 'Boleto'
                      : pay.payment_type_id === 'bank_transfer' ? 'Pix'
                      : pay.payment_type_id || 'Desconhecido';
      await atualizarStatus(pedidoId, status, payMethod, String(paymentId));
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('Erro no webhook:', err);
    res.sendStatus(500);
  }
});

// GET /pedido/:id
app.get('/pedido/:id', async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Pedidos!A:L'
    });
    const rows = resp.data.values || [];
    const row  = rows.find(r => r[0] === req.params.id);
    if (!row) return res.status(404).json({ erro: 'Pedido nao encontrado.' });
    res.json({ pedido_id:row[0], status:row[1], produto:row[2], tamanho:row[3], preco:row[4], cliente:row[5], email:row[6], telefone:row[7], endereco:row[8], data:row[9], pagamento:row[10], id_mp:row[11] });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar pedido.' });
  }
});

// ── SHEETS HELPERS ───────────────────────────────────
async function salvarPedido({ pedidoId, status, produto, tamanho, preco, cliente }) {
  try {
    const sheets = getSheetsClient();
    await garantirAba(sheets);
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Pedidos!A:L',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[
        pedidoId, status, produto, tamanho,
        `R$ ${Number(preco).toFixed(2).replace('.',',')}`,
        cliente.nome, cliente.email, cliente.telefone,
        `${cliente.endereco || ''} CEP: ${cliente.cep || ''}`,
        formatDate(), '', ''
      ]] }
    });
  } catch (err) { console.error('Erro ao salvar pedido:', err); }
}

async function atualizarStatus(pedidoId, status, metodo, paymentId) {
  try {
    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Pedidos!A:A'
    });
    const rows = resp.data.values || [];
    const rowIdx = rows.findIndex(r => r[0] === pedidoId);
    if (rowIdx === -1) return;
    const sheetRow = rowIdx + 1;
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `Pedidos!B${sheetRow}`, values: [[status]] },
          { range: `Pedidos!K${sheetRow}`, values: [[metodo]] },
          { range: `Pedidos!L${sheetRow}`, values: [[paymentId]] }
        ]
      }
    });
  } catch (err) { console.error('Erro ao atualizar status:', err); }
}

async function garantirAba(sheets) {
  try {
    const info = await sheets.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID });
    const abas = info.data.sheets.map(s => s.properties.title);
    if (!abas.includes('Pedidos')) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        requestBody: { requests: [{ addSheet: { properties: { title: 'Pedidos' } } }] }
      });
    }
    const head = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Pedidos!A1:L1'
    });
    if (!head.data.values?.[0]?.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Pedidos!A1:L1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[
          '🆔 Pedido','📦 Status','👕 Produto','📏 Tamanho',
          '💰 Valor','👤 Cliente','📧 Email','📱 Telefone',
          '📍 Endereco','🕐 Data','💳 Pagamento','🔑 ID MP'
        ]] }
      });
    }
  } catch (err) { console.error('Erro ao garantir aba:', err); }
}

// ── START ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ FRPJSTORE.BR Backend rodando na porta ${PORT}`));
module.exports = app;
