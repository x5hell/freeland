# y2be — зеркало YouTube (клиентская часть)

Видимая клиенту часть: статический SPA (vanilla JS + hls.js) и serverless-прокси
на origin. Развёрнуто на Vercel (Hobby) из этого репозитория автодеплоем.

## Переменные окружения (Vercel → Settings → Environment Variables)

| Переменная       | Значение                          |
|------------------|-----------------------------------|
| `ORIGIN_URL`     | `https://y2be.duckdns.org`        |
| `ORIGIN_SECRET`  | shared secret (см. `/etc/ytmirror.env` на origin) |

После добавления переменных — Redeploy (последний деплой из GitHub).

## Что здесь

- `index.html`, `style.css`, `app.js` — SPA (лента, поиск, watch с HLS-плеером)
- `hls.js` — hls.js 1.5.20 (cdnjs, Apache-2.0)
- `api/proxy.js` — единственная функция: `/api/*`, `/img/*` → origin с
  `X-Origin-Secret`; 3xx от origin не транслируются
- `vercel.json` — rewrites `/api/:path*`, `/img/:path*` → `/api/proxy`;
  картинки кэшируются 6ч

## Ограничения

- Лимиты Hobby: функции ≤300с, ~100ГБ/мес fair-use — сегменты по ~0.4МБ и
  JSON проходят с запасом
- Админка и служебные эндпоинты живут только на origin и через прокси
  не ходят
