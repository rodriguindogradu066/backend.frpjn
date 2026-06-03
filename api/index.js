// ══════════════════════════════════════════════════════
//  FRPJSTORE.BR — Backend v2.0
//  Checkout Transparente: Pix + Cartão + Boleto
// ══════════════════════════════════════════════════════
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 10000 }
});
const payment = new Payment(mpClient);

function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}
function formatDate(d=new Date()) { return d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}); }
function gerarId() { return 'FRP'+Date.now().toString(36).toUpperCase(); }
function formatCpf(cpf) { return cpf?.replace(/\D/g,'').slice(0,11); }

// Health check
app.get('/', (req, res) => res.json({ status:'ok', app:'FRPJSTORE.BR Backend', versao:'2.0.0' }));

// ─────────────────────────────────────────────────────
//  POST /criar-pix — Pagamento PIX transparente
// ─────────────────────────────────────────────────────
app.post('/criar-pix', async (req, res) => {
  try {
    const { produto, tamanho, cliente } = req.body;
    const pedidoId = gerarId();

    const payData = {
      transaction_amount: Number(produto.preco),
      description: `${produto.nome} — Tamanho ${tamanho}`,
      payment_method_id: 'pix',
      payer: {
        email: cliente.email,
        first_name: cliente.nome.split(' ')[0],
        last_name: cliente.nome.split(' ').slice(1).join(' ') || 'Cliente',
        identification: { type: 'CPF', number: formatCpf(cliente.cpf) }
      },
      external_reference: pedidoId,
      notification_url: 'https://backend-frpjn.vercel.app/webhook',
      metadata: { pedido_id: pedidoId, tamanho, ...cliente }
    };

    const result = await payment.create({ body: payData });

    await salvarPedido({ pedidoId, status: 'AGUARDANDO_PIX ⏳', produto: produto.nome, tamanho, preco: produto.preco, cliente, paymentId: String(result.id) });

    res.json({
      pedido_id: pedidoId,
      payment_id: result.id,
      qr_code: result.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: result.point_of_interaction?.transaction_data?.qr_code_base64,
      status: result.status
    });
  } catch(err) {
    console.error('Erro PIX:', err?.message || err);
    res.status(500).json({ erro: 'Erro ao criar PIX', detalhe: err?.message });
  }
});

// ─────────────────────────────────────────────────────
//  POST /criar-pagamento-cartao — Cartão transparente
// ─────────────────────────────────────────────────────
app.post('/criar-pagamento-cartao', async (req, res) => {
  try {
    const { produto, tamanho, cliente, token, installments, payment_method_id } = req.body;
    const pedidoId = gerarId();

    const payData = {
      transaction_amount: Number(produto.preco),
      description: `${produto.nome} — Tamanho ${tamanho}`,
      installments: installments || 1,
      payment_method_id,
      token,
      payer: {
        email: cliente.email,
        first_name: cliente.nome.split(' ')[0],
        last_name: cliente.nome.split(' ').slice(1).join(' ') || 'Cliente',
        identification: { type: 'CPF', number: formatCpf(cliente.cpf) }
      },
      external_reference: pedidoId,
      notification_url: 'https://backend-frpjn.vercel.app/webhook',
      metadata: { pedido_id: pedidoId, tamanho, ...cliente }
    };

    const result = await payment.create({ body: payData });

    const statusMap = { approved:'PAGO ✅', in_process:'EM ANALISE 🔄', rejected:'RECUSADO ❌' };
    await salvarPedido({ pedidoId, status: statusMap[result.status]||result.status, produto: produto.nome, tamanho, preco: produto.preco, cliente, paymentId: String(result.id) });

    res.json({
      pedido_id: pedidoId,
      payment_id: result.id,
      status: result.status,
      status_detail: result.status_detail
    });
  } catch(err) {
    console.error('Erro cartao:', err?.message || err);
    res.status(500).json({ erro: 'Erro ao processar cartao', detalhe: err?.message });
  }
});

// ─────────────────────────────────────────────────────
//  POST /criar-boleto — Boleto transparente
// ─────────────────────────────────────────────────────
app.post('/criar-boleto', async (req, res) => {
  try {
    const { produto, tamanho, cliente } = req.body;
    const pedidoId = gerarId();

    const payData = {
      transaction_amount: Number(produto.preco),
      description: `${produto.nome} — Tamanho ${tamanho}`,
      payment_method_id: 'bolbradesco',
      payer: {
        email: cliente.email,
        first_name: cliente.nome.split(' ')[0],
        last_name: cliente.nome.split(' ').slice(1).join(' ') || 'Cliente',
        identification: { type: 'CPF', number: formatCpf(cliente.cpf) },
        address: {
          zip_code: cliente.cep?.replace(/\D/g,''),
          street_name: cliente.endereco || 'Rua',
          street_number: '0',
          neighborhood: 'Centro',
          city: 'Palmas',
          federal_unit: 'TO'
        }
      },
      external_reference: pedidoId,
      notification_url: 'https://backend-frpjn.vercel.app/webhook',
      metadata: { pedido_id: pedidoId, tamanho, ...cliente }
    };

    const result = await payment.create({ body: payData });

    await salvarPedido({ pedidoId, status: 'BOLETO GERADO 🧾', produto: produto.nome, tamanho, preco: produto.preco, cliente, paymentId: String(result.id) });

    res.json({
      pedido_id: pedidoId,
      payment_id: result.id,
      boleto_url: result.transaction_details?.external_resource_url,
      barcode: result.barcode?.content,
      status: result.status
    });
  } catch(err) {
    console.error('Erro boleto:', err?.message || err);
    res.status(500).json({ erro: 'Erro ao gerar boleto', detalhe: err?.message });
  }
});

// ─────────────────────────────────────────────────────
//  GET /status-pagamento/:id — Consulta status
// ─────────────────────────────────────────────────────
app.get('/status-pagamento/:id', async (req, res) => {
  try {
    const result = await payment.get({ id: req.params.id });
    res.json({ status: result.status, status_detail: result.status_detail });
  } catch(err) {
    res.status(500).json({ erro: 'Erro ao consultar status' });
  }
});

// ─────────────────────────────────────────────────────
//  POST /webhook — Notificações MP
// ─────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type === 'payment') {
      const paymentId = data?.id;
      if (!paymentId) return res.sendStatus(200);
      const pay = await payment.get({ id: paymentId });
      const statusMap = { approved:'PAGO ✅', pending:'PENDENTE ⏳', in_process:'PROCESSANDO 🔄', rejected:'RECUSADO ❌', cancelled:'CANCELADO 🚫', refunded:'REEMBOLSADO 💸' };
      const status = statusMap[pay.status] || pay.status.toUpperCase();
      const metodo = pay.payment_type_id==='credit_card'?'Cartao Credito':pay.payment_type_id==='debit_card'?'Cartao Debito':pay.payment_type_id==='ticket'?'Boleto':pay.payment_type_id==='bank_transfer'?'Pix':'Outro';
      await atualizarStatus(pay.external_reference, status, metodo, String(paymentId));
    }
    res.sendStatus(200);
  } catch(err) {
    console.error('Webhook erro:', err);
    res.sendStatus(500);
  }
});

// GET /pedido/:id
app.get('/pedido/:id', async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Pedidos!A:L' });
    const rows = resp.data.values || [];
    const row = rows.find(r => r[0] === req.params.id);
    if (!row) return res.status(404).json({ erro: 'Pedido nao encontrado.' });
    res.json({ pedido_id:row[0], status:row[1], produto:row[2], tamanho:row[3], preco:row[4], cliente:row[5] });
  } catch(err) { res.status(500).json({ erro: 'Erro ao buscar pedido.' }); }
});

// SHEETS HELPERS
async function salvarPedido({ pedidoId, status, produto, tamanho, preco, cliente, paymentId='' }) {
  try {
    const sheets = getSheetsClient();
    await garantirAba(sheets);
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Pedidos!A:L',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[pedidoId, status, produto, tamanho,
        `R$ ${Number(preco).toFixed(2).replace('.',',')}`,
        cliente.nome, cliente.email, cliente.telefone,
        `${cliente.endereco||''} CEP: ${cliente.cep||''}`,
        formatDate(), '', paymentId]] }
    });
  } catch(err) { console.error('Erro salvar:', err); }
}

async function atualizarStatus(pedidoId, status, metodo, paymentId) {
  try {
    const sheets = getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Pedidos!A:A' });
    const rows = resp.data.values || [];
    const rowIdx = rows.findIndex(r => r[0] === pedidoId);
    if (rowIdx === -1) return;
    const sheetRow = rowIdx + 1;
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: [
        { range: `Pedidos!B${sheetRow}`, values: [[status]] },
        { range: `Pedidos!K${sheetRow}`, values: [[metodo]] },
        { range: `Pedidos!L${sheetRow}`, values: [[paymentId]] }
      ]}
    });
  } catch(err) { console.error('Erro atualizar:', err); }
}

async function garantirAba(sheets) {
  try {
    const info = await sheets.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID });
    const abas = info.data.sheets.map(s => s.properties.title);
    if (!abas.includes('Pedidos')) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: 'Pedidos' } } }] } });
    }
    const head = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Pedidos!A1:L1' });
    if (!head.data.values?.[0]?.length) {
      await sheets.spreadsheets.values.update({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Pedidos!A1:L1', valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['ID Pedido','Status','Produto','Tamanho','Valor','Cliente','Email','Telefone','Endereco','Data','Pagamento','ID MP']] }
      });
    }
  } catch(err) { console.error('Erro aba:', err); }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FRPJSTORE.BR Backend v2 porta ${PORT}`));
module.exports = app;
