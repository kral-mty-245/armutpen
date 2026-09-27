# GitHub erişimi: kullanıcı PAT tokenı

Google girişi ve GitHub OAuth/Client ID kurulumu kullanılmaz.

- Kullanıcı AI Ayarları'na kendi GitHub kişisel erişim tokenını (PAT) girer.
- Token yalnızca açık sayfanın belleğinde kalır; her işlemde güvenli sunucu isteğiyle GitHub'a iletilir. Veritabanına kaydedilmez.
- Giriş ekranındaki GitHub tokenıyla giriş, GitHub kullanıcı kimliğini ve ilk kayıtta doğrulanmış birincil e-postayı kontrol eder. `user:email` veya Email addresses: read izni gerekir.
- Mevcut e-posta hesabı otomatik bağlanmaz: kullanıcı önce şifresiyle giriş yapar, ayarlardan tokenını doğrulayarak kimliğini bağlar.
- Depo oluşturma, push ve Pages işlemleri ayrıca kullanıcı onayı ister. Tokenın ilgili hesap/depo için gereken yazma izinleri olmalıdır. Yeni depolar özeldir. Pages yayını içeriği herkese açık hâle getirebilir.
- Canlı işlemler gerçek yetkili token olmadan doğrulanamaz. Eski `/api/github?action=start` ve `api/github.js` kullanılmaz; güncel yollar `server/main.py` içindedir.
