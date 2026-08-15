# ФинШтурман 1.0 — Cloudflare Workers Static Assets

Эта версия подготовлена именно для нового интерфейса Cloudflare Workers Builds.

## Структура репозитория

```text
public/
  index.html
  app.js
  styles.css
  config.js
  manifest.webmanifest
  sw.js
  icons/
wrangler.jsonc
package.json
supabase-schema.sql
README.md
.gitignore
```

Cloudflare публикует содержимое папки `public` как статическое приложение.
`wrangler.jsonc` указывает `assets.directory = "./public"`.

## Что вводить в Cloudflare

- Project name: `finsturman`
- Build command: оставить пустым
- Deploy command: `npx wrangler deploy`
- Path: `/`

Если Cloudflare уже создал проект с другим именем, имя проекта в Cloudflare и поле
`name` в `wrangler.jsonc` должны совпадать.

## Supabase

В `public/config.js` должны быть:

```js
window.FIN_CONFIG = {
  SUPABASE_URL: "https://....supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_..."
};
```

Никогда не вставляйте `sb_secret_...` или `service_role`.

## После первого deploy

Получите адрес `*.workers.dev`, затем добавьте его в Supabase:

Authentication → URL Configuration:
- Site URL
- Redirect URLs

После этого можно зарегистрироваться в ФинШтурмане и поставить его на экран iPhone.
