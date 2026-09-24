# Persembahan — Issue Tracker (PKL)

Skrip persembahan + jawapan soalan bos. Ganti `[LIVE URL]` dengan URL Vercel anda.

---

## 0. Elevator pitch (30 saat, hafal ini)

> "Saya bina satu **Issue Tracker** berbentuk web. Bila ada staf jumpa masalah —
> contohnya sistem tak jalan, atau barang rosak — dia boleh **report** dalam app
> ini. Administrator akan **uruskan status** sampai selesai. Semua data masuk ke
> **database Supabase** yang dikongsi, jadi semua orang nampak senarai yang sama.
> App ini dah **live** di [LIVE URL], kod disimpan di **GitHub**, dan setiap kali
> saya update kod, **Vercel** deploy automatik."

---

## 1. Susunan slide + skrip

### Slide 1 — Tajuk
- **Issue Tracker** — sistem lapor & urus isu berasaskan web
- Nama, tempat PKL, tarikh

### Slide 2 — Masalah & objektif (1 min)
> "Sebelum ada sistem, masalah dilaporkan secara tidak formal — WhatsApp, mulut,
> kertas. Susah nak tahu **siapa buat, status apa, dan mana yang dah selesai**.
>
> Objektif saya: satu tempat berpusat untuk lapor isu, tetapkan **status**,
> **priority**, dan **siapa** yang bertanggungjawab — dengan **permission** yang
> betul dan boleh **deploy online**."

### Slide 3 — Demo (yang paling penting; ingat: boss suka tengok ia berfungsi)
> "Saya tunjuk sekarang" — ikut **Skrip Demo** dalam Bahagian 4.

### Slide 4 — Apa yang sistem boleh buat (senarai ciri)
- **Login / Daftar** (email + password) dan **reset password**
- **Dashboard** semua isu + kiraan: Total / Pending / Done / None / High priority
- **Report issue** + Description
- **Status workflow**: None → Pending → Done
- **Priority**: Low / Medium / High
- **Search** (tajuk, penerangan, nama pelapor) + filter priority & status
- **My reports** — isu yang saya laporkan sahaja
- **Statistics** — carta status, priority, top reporter, aktiviti 14 hari
- **Reports** (admin) — tapis ikut tarikh & status, **Download CSV**, **Print/PDF**
- **Users** (admin) — naik/turun pangkat, edit, padam pengguna
- **Settings** (admin) — backup/restore (JSON), eksport CSV
- **Notifications** — loceng + feed aktiviti
- **Selamat**: sekatan di UI **dan** di database (Row Level Security)

### Slide 5 — Peranan & kebenaran (tunjuk jadual)

| Kebolehan | Normal user | Administrator |
| --- | :---: | :---: |
| Nampak senarai isu | ✅ | ✅ |
| Report isu | ✅ | ✅ |
| Tukar status (None/Pending/Done) | ❌ | ✅ |
| Edit / padam isu | ❌ | ✅ |
| Urus pengguna (promote/demote/edit/delete) | ❌ | ✅ |
| Statistics | ✅ | ✅ |
| Reports & Settings | ❌ | ✅ |

> "Jadi ia bukan sekadar aplikasi biasa — ada **role** dan **kawalan akses**.
> Normal user lapor sahaja; admin yang uruskan aliran kerja."

### Slide 6 — Tech stack (apa yang saya guna & kenapa) → Bahagian 2
### Slide 7 — Seni bina: App → Supabase → Database → Bahagian 3 (rajah)
### Slide 8 — Keselamatan (2 lapis)
> "Peraturan bukan sekadar disorok dalam UI. Ia **dikuatkuasa di database** —
> Row Level Security dan trigger. Jadi walaupun orang buka DevTools dan cuba
> hantar request sendiri, database akan tetap tolak."

### Slide 9 — Hasil / bukti
- Live URL: `[LIVE URL]`
- Repo GitHub: `[GITHUB URL]`
- Supabase: Table Editor → `issues`, `profiles`

### Slide 10 — Penambahbaikan seterusnya (roadmap) → jawapan Q1
### Slide 11 — Q&A

---

## 2. Tech stack — apa saya guna & buat apa

| Teknologi | Guna untuk apa (cakap macam ini) |
| --- | --- |
| **HTML / CSS / JavaScript** | Front-end. Satu fail `index.html`, **tak perlu install apa-apa**, tak perlu build — senang deploy. |
| **Supabase** | "Backend as a Service". Ia beri saya **Auth** (login + email), **Postgres database**, dan **REST API automatik**. Saya tak perlu tulis server sendiri. |
| **GitHub** | Simpan kod + **version control**. Ini "sumber kebenaran" projek; dari sini juga Vercel deploy. |
| **Vercel** | **Hosting / deploy**. Sambung ke repo GitHub — setiap `git push`, ia deploy automatik dan bagi **live URL**. Fail `vercel.json` tambah **security headers**. |
| **OpenCode** | **AI coding assistant** (macam pair-programmer) yang saya guna untuk tulis & baiki kod, selaraskan skema database dengan app, dan verify sambungan. Ia pecut proses pembangunan. |
| **Cloudflare** | (Belum guna) — sesuai sebagai **lapisan keselamatan/CDN** di hadapan: DNS, WAF, anti-DDoS. Boleh tambah nanti bila perlu. |
| **CDN (jsdelivr)** | Muat naik library `supabase-js` ke browser tanpa install. |

**Cara cakap kalau bos tanya "kenapa pilih tech ni?"**
> "Saya pilih yang **percuma, cepat, dan tak perlu server sendiri**. Supabase
> uruskan login + database; Vercel uruskan hosting. Saya fokus pada logik app,
> bukan maintenance server."

---

## 3. Sambungan App → Supabase → Database (soalan bos mesti tanya)

**Cakap versi ringkas:**
> "App saya (browser) tak simpan data sendiri. Ia hantar permintaan ke Supabase.
> Supabase ada dua bahagian: **Auth** untuk sahkan pengguna, dan **API** yang
> sambung ke **database Postgres**. Setiap permintaan bawa token pengguna
> (login), dan database ada **Row Level Security** yang tentukan baris mana
> seseorang boleh baca atau ubah."

**Rajah (boleh letak dalam slide):**

```
   Browser  ──  index.html  (HTML/CSS/JS)
      │
      │  supabase-js  (CDN)  +  Project URL + anon public key
      ▼
   SUPABASE
      ├── Auth        → daftar / login / reset password (email)
      └── REST API    → PostgREST
      ▼
   POSTGRES DATABASE
      ├── profiles  (id, email, full_name, role)
      └── issues    (title, description, status, priority, created_by, masa)
             ▲
             └── Row Level Security + Trigger  (kuatkuasa peraturan)
```

**Langkah tepat bila app berjalan:**
1. App buka → `supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)`.
2. User **daftar/login** → Supabase Auth sahkan → beri **session (JWT)**.
3. App ambil data: `supabase.from('issues').select(...)` → pergi ke **PostgREST API** → **Postgres**.
4. Setiap permintaan bawa JWT; **RLS** semak `auth.uid()` → benarkan atau tolak baris.
5. **Trigger** database pula: auto-cipta `profiles` bila sign up, auto-kemaskini `updated_at`, dan sekat perubahan yang tak dibenarkan.

**Isu "anon key nampak dalam kod, tak bahaya ke?"**
> "Tak. Ia **public key** — memang direka untuk terdedah. Yang melindungi data
> ialah **Row Level Security** di database, bukan kerahsiaan key itu. Yang tidak
> boleh dibuka langsung ialah **service_role key**."

---

## 4. Skrip demo live (klik ikut urutan)

1. **Buka live URL** → tunjuk ia berfungsi (bukan `localhost`).
2. **Login sebagai admin** (contoh `admin@demo.com` / `admin123`).
3. **Dashboard** → tunjuk kiraan **Total / Pending / Done / None / High priority**.
4. **Report issue** → taip contoh: "Printer tingkat 3 rosak", priority **High**.
   - Perhatian: isu baru mula sebagai **None**.
5. Tunjuk **status dropdown** → tukar **None → Pending → Done**. (Ini "admin resolve".)
6. **Search** "printer" + **filter High** → tunjuk senarai mengecil.
7. **Statistics** → tunjuk carta **by status**, **by priority**, **top reporter**.
8. **Reports** → pilih tarikh bulan ini → **Download CSV** → buka dalam Excel.
   (Boleh sebut: "inilah yang boleh dilampirkan dalam mesyuarat management.")
9. **Logout**, **login sebagai normal user** → tunjuk dia **boleh report tapi tak
   nampak** butang edit/status. → "Ini kawalan akses."
10. **Buka Supabase dashboard** → Table Editor → tunjuk baris dalam `issues`
    sebenarnya masuk database.

> Tip: buat demo guna **akaun demo** dulu sebagai backup, kalau internet lambat.

---

## 5. Q&A — soalan bos + jawapan

### Q1. Kalau app ni untuk company gunapakai, apa yang akan improve next?
**Jawapan:**
> "Sekarang sudah ada asas yang kukuh: login, role, workflow status, priority,
> search, statistics, report + CSV, backup. Yang seterusnya, ikut keutamaan:
> 1. **Assignment** — tetapkan isu kepada staf tertentu (siapa kena selesaikan).
> 2. **Due date + SLA + alert overdue** — jawab soalan 'mana yang lambat'.
> 3. **Kategori / label / projek** — contoh HR, IT, Maintenance.
> 4. **Comment & attachment** — bukti dan perbincangan pada setiap isu.
> 5. **Notifikasi sebenar** (email / Slack / WhatsApp) + **event log**.
> 6. **Reporting lanjutan** — purata masa selesai, trend bulanan.
> 7. **Security hardening** — tak benarkan self-register jadi admin; kekang ke
>    email domain company; SSO (Google Workspace).
> 8. **Performance** — pagination + indeks bila data dah beribu."

### Q2. Siapa yang create issue, dan siapa yang akan resolve?
> "**Create:** mana-mana pengguna yang login — butang **Report issue**. Sistem
> stamp **nama/tarikh pelapor** (`created_by`) secara automatik.
>
> **Resolve:** **Administrator** yang uruskan status **None → Pending → Done**.
> Normal user lapor sahaja, tidak boleh tukar status.
>
> **Next:** tambah **assigned_to** supaya jelas siapa bertanggungjawab, dan rekod
> siapa + bila ia diselesaikan."

### Q3. Macam mana nak tengok & track status isu?
> "Ada **3 tempat**:
> 1. **Dashboard** — setiap isu ada kolum **Status**; ada tab **All / Pending /
>    Done / None** dengan kiraan; kad atas tunjuk Total, Pending, Done, None,
>    High priority.
> 2. **My reports** — isu yang kita laporkan sendiri.
> 3. **Notifications** — feed aktiviti terkini (belum dibaca ditanda).
>
> Setiap baris juga tunjuk **'Updated X ago'**, jadi kita tahu bila terakhir
> diusik."

### Q4. Macam mana nak tahu isu mana yang overdue / bottleneck?
> "**Sekarang:** belum ada tarikh akhir (due date). Tapi bottleneck boleh
> dikesan secara tak langsung:
> - Bilangan **None** besar = banyak isu **belum di-triage**.
> - **Pending** yang lama (lihat 'Updated') = tersekat.
> - **High priority yang masih open** = risiko.
> - **Carta aktiviti 14 hari** = tengok naik atau turun.
>
> **Next (yang saya cadang):** tambah **due_date + SLA**, papar **badge
> 'Overdue'**, filter & kiraan overdue, dan **aging report** (berapa lama setiap
> isu terbuka) + **purata masa selesai**."

### Q5. Siapa boleh view, edit, close isu?
> - **View:** semua yang login (shared board).
> - **Report (create):** semua yang login.
> - **Edit butiran (tajuk, penerangan, priority):** Administrator.
> - **Close / tukar status:** Administrator.
> - **Padam:** Administrator.
> - **Urus pengguna:** Administrator.
>
> "Admin **tak boleh ubah role sendiri** atau **padam akaun sendiri** — elak
> terkunci dari sistem. Dan peraturan ini dikuatkuasa **dua lapis**: UI **dan**
> database (RLS + trigger)."

### Q6. Kalau isu banyak, macam mana nak categorise / prioritise?
> "**Sekarang:** **Priority (Low/Med/High)** + **Status (None/Pending/Done)** +
> **Search** (tajuk/penerangan/pelapor) + **filter** priority & tab status +
> **Statistics** breakdown.
>
> **Next:** **label/tag**, **kategori/jabatan**, **severity**, susun ikut
> priority/tarikh, **bulk action**, dan papan **backlog vs sprint**."

### Q7. Untuk reporting kepada management, data apa patut dihighlight?
> "Guna halaman **Statistics** dan **Reports**:
> - **Jumlah isu** (Total)
> - **% selesai** (completion rate = Done / Total)
> - **Backlog** (None = belum di-triage, Pending = dalam proses)
> - **High priority yang masih open** (risiko)
> - **Breakdown by status & by priority**
> - **Trend 14 hari** (aktiviti naik/turun)
> - **Top reporter** (beban kerja)
>
> "Untuk mesyuarat: buka **Reports**, pilih julat tarikh, **Download CSV** atau
> **Print/PDF**, lampirkan. **Next:** tambah **purata masa selesai** dan
> **peratus overdue** sebagai KPI."

### Soalan cepumas lain (bonus)
- **"Data selamat tak?"** → RLS + trigger; anon key memang public; service key tak pernah masuk web.
- **"Kalau internet down?"** → ada **demo mode** (guna localStorage) untuk tunjuk fungsi tanpa Supabase.
- **"Kenapa satu fail HTML?"** → mudah deploy, mudah dihantar, tiada dependency.
- **"Kos?"** → Supabase & Vercel & GitHub **free tier**, cukup untuk kegunaan ini.

---

## 6. Glosari ringkas (kalau tersekat)

| Istilah | Maksud mudah |
| --- | --- |
| **Row Level Security (RLS)** | Peraturan database: siapa boleh baca/ubah baris mana. |
| **Trigger** | Kod database yang auto-jalan bila ada insert/update. |
| **Auth** | Bahagian yang uruskan login & kata laluan. |
| **API / PostgREST** | "Pintu" yang app guna untuk bercakap dengan database. |
| **Deploy** | Naikkan app ke internet supaya orang boleh buka. |
| **Repo** | Folder projek dalam GitHub. |
| **Anon key** | Public key Supabase — selamat diletak dalam kod. |
| **Demo mode** | Mod tanpa database; simpan dalam browser sahaja. |

---

### Checklist sebelum masuk bilik
- [ ] Buka `[LIVE URL]` dalam browser sekali (pastikan loading).
- [ ] Login admin berjaya; ada sekurang-kurangnya 3–5 isu contoh.
- [ ] Buka tab Supabase (Table Editor → `issues`) sedia.
- [ ] Fail CSV contoh dah didownload, sedia untuk ditunjuk.
- [ ] Telefon/hotspot backup kalau wifi dewan perlahan.
