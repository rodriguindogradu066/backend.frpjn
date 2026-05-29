# FRPJSTORE.BR — Backend

## ⚠️ IMPORTANTE — Antes de subir pro GitHub

Este repositório NÃO deve conter o arquivo `.env`.
As variáveis de ambiente devem ser configuradas no Vercel.

## Variáveis de ambiente no Vercel

Vá em: Settings → Environment Variables

| Nome | Valor |
|------|-------|
| MP_ACCESS_TOKEN | Seu token do Mercado Pago |
| SITE_URL | https://rodriguindogradu066.github.io/FRPJ |
| GOOGLE_SHEET_ID | 1HWEPT-YXv4rd8Qa-yy8SfEmnpSPd-mpPykiAxw344yI |
| GOOGLE_SERVICE_ACCOUNT_JSON | (conteudo do JSON em uma linha) |

## Estrutura
```
backend-frpj/
├── api/
│   └── index.js
├── package.json
├── vercel.json
└── .gitignore
```
