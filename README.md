# y2be — зеркало YouTube (лицо)

Клиентская часть: статический SPA (vanilla JS + hls.js с jsDelivr CDN)
+ прокси /api и /img на origin через netlify.toml redirects (status=200).

Домен-лицо: https://fancy-boba-e4c743.netlify.app (Netlify, автодеплой
из этого репо). Прежнее лицо — Vercel (freeland-indol) заблокирован
DPI из РФ; netlify.app троттлится мигающим детектом — потому hls.js
вынесен на jsDelivr (проверено 1.6-3.7 МБ/с сквозь DPI).

Origin в браузере клиента не светится: все запросы идут через этот
домен (redirects status=200), /admin наружу не проксируется.

## Переменные окружения
Не требуются: origin работает в открытом режиме для /api и /img
(см. app.py origin_guard). При возврате shared-secret добавить
заголовок в netlify.toml redirects.
