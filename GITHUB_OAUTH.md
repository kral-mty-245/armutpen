# NOMI AI GitHub OAuth backend

Bu repo GitHub işlemleri için güvenli OAuth endpoint'i içerir. `index.html` statik kalabilir; backend'i Vercel gibi Node serverless destekleyen bir ortamda yayınlayın.

## Ortam değişkenleri

- `GITHUB_CLIENT_ID`: GitHub OAuth App Client ID
- `GITHUB_CLIENT_SECRET`: GitHub OAuth App Client Secret
- `GITHUB_OAUTH_SECRET`: en az 32 karakterlik rastgele session imzalama sırrı
- `APP_ORIGIN`: yayınlanan site adresi, örn. `https://example.com`

GitHub OAuth App callback URL'si şu olmalıdır:

```text
https://example.com/api/github?action=callback
```

## Frontend akışı

- Bağlan butonu: `GET /api/github?action=start` adresini yeni sekmede açar.
- OAuth sonrası token backend'deki HttpOnly cookie'de tutulur; tarayıcı JavaScript'i token'ı göremez.
- Durum: `GET /api/github?action=status`
- İşlemler, her zaman kullanıcı butona bastıktan sonra `POST /api/github` ile çağrılmalıdır:

```js
await fetch('/api/github', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({ action: 'create-repo', repo: 'armut-pen' })
});
```

Push için aynı isteğe `files: {"index.html":"..."}` ekleyin. Pages için `action: "pages"` gönderin. NOMI AI'nin kendi başına işlem yapmaması ve her isteğin kullanıcı onay butonundan sonra çalıştırılması gerekir.

## Güvenlik

PAT frontend'e koymayın ve `localStorage` içinde saklamayın. OAuth state kontrolü endpoint içinde yapılır; token HttpOnly/Secure cookie'de tutulur. Üretimde HTTPS ve uygun OAuth scope'larını kullanın.
