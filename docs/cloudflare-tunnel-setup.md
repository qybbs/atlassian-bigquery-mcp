# Panduan Setup Cloudflare Tunnel (cloudflared) dengan Domain Kustom

Untuk me-forward `localhost` ke domain kustom Anda sendiri menggunakan Cloudflare Tunnel (sebelumnya bernama Argo Tunnel), ada dua metode utama. 

Metode pertama menggunakan **Cloudflare Zero Trust Dashboard** (sangat direkomendasikan karena paling praktis, otomatis membuat sertifikat SSL, dan mengelola DNS secara otomatis tanpa konfigurasi berkas lokal). Metode kedua menggunakan **CLI Lokal**.

## Prasyarat
1. Domain Anda sudah terdaftar di Cloudflare dan Nameserver-nya diarahkan ke Cloudflare.
2. Aplikasi lokal Anda (MCP Server) sedang berjalan, misalnya di port `3000` (`http://localhost:3000`).

---

## Metode 1: Menggunakan Cloudflare Zero Trust Dashboard (Paling Mudah)

### Langkah 1: Instal `cloudflared` di Laptop/Server
Unduh dan pasang agen Cloudflare Tunnel di komputer Anda:
*   **macOS:**
    ```bash
    brew install cloudflare/cloudflare/cloudflared
    ```
*   **Linux (Debian/Ubuntu):**
    ```bash
    curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared.deb
    ```

### Langkah 2: Buat Tunnel di Zero Trust Dashboard
1. Masuk ke Dashboard Cloudflare, lalu pilih menu **Zero Trust** di bilah sisi kiri.
2. Masuk ke **Networks** > **Tunnels**, lalu klik **Create a tunnel**.
3. Pilih **Cloudflared** (default) lalu klik **Next**.
4. Beri nama tunnel Anda (misalnya: `bigquery-mcp-gateway`), kemudian klik **Save tunnel**.

### Langkah 3: Jalankan Konektor Agen
Dashboard akan menampilkan berbagai pilihan OS beserta baris kode instalasi yang menyertakan **token unik**. 
* Pilih OS komputer Anda, salin kode perintah tersebut, lalu jalankan di terminal Anda.
* Contoh tampilan kodenya (di macOS/Linux):
  ```bash
  sudo cloudflared service install <TOKEN_UNIK_ANDA>
  ```
* Tunggu beberapa saat di dashboard sampai status tunnel Anda berubah menjadi **Healthy** (Aktif), lalu klik **Next**.

### Langkah 4: Hubungkan ke Domain Kustom Anda
Pada halaman **Route traffic**, definisikan domain Anda:
1. **Domain:** Pilih domain terdaftar Anda (misalnya: `domainku.com`).
2. **Subdomain:** (Opsional, misalnya `mcp` sehingga URL-nya menjadi `mcp.domainku.com`).
3. **Service:** 
   * **Type:** Pilih `HTTP`.
   * **URL:** Isi dengan `localhost:3000` (sesuai port aplikasi Anda).
4. Klik **Save tunnel**.

*Cloudflare secara otomatis akan membuatkan CNAME record baru pada DNS domain Anda dan menerbitkan sertifikat SSL gratis sehingga alamat tersebut bisa diakses dengan protokol HTTPS (`https://mcp.domainku.com`).*

---

## Metode 2: Menggunakan CLI Lokal (Pendekatan Developer)

Jika Anda lebih memilih mengelola konfigurasi melalui file konfigurasi lokal di terminal:

### Langkah 1: Login via CLI
Jalankan perintah ini di terminal Anda untuk mengautentikasi akun Cloudflare:
```bash
cloudflared tunnel login
```
Terminal akan memberikan tautan login. Buka di browser Anda, pilih domain yang ingin dihubungkan, lalu setujui otorisasi. Proses ini akan mengunduh sertifikat `cert.pem` ke folder `~/.cloudflared/`.

### Langkah 2: Buat Tunnel Baru
Buat tunnel dengan nama pilihan Anda:
```bash
cloudflared tunnel create mcp-tunnel
```
Perintah ini akan menghasilkan file JSON kredensial (misalnya: `~/.cloudflared/12345678-abcd-1234-abcd-123456789abc.json`) beserta **Tunnel ID**.

### Langkah 3: Buat Berkas Konfigurasi `config.yml`
Buat berkas bernama `config.yml` di dalam direktori `~/.cloudflared/` (atau di root folder proyek Anda) dan isi sebagai berikut:
```yaml
tunnel: <TUNNEL_ID_ANDA>
credentials-file: /Users/<USER_KOMPUTER_ANDA>/.cloudflared/<TUNNEL_ID_ANDA>.json

ingress:
  - hostname: mcp.domainku.com
    service: http://localhost:3000
  - service: http_status:404
```

### Langkah 4: Arahkan DNS Domain ke Tunnel
Gunakan perintah ini untuk membuat rute DNS CNAME secara otomatis di Cloudflare:
```bash
cloudflared tunnel route dns mcp-tunnel mcp.domainku.com
```

### Langkah 5: Jalankan Tunnel
Jalankan tunnel secara lokal agar mulai menerima trafik:
```bash
cloudflared tunnel run mcp-tunnel
```

---

## Langkah Pengujian
Setelah salah satu metode di atas selesai diatur:
1. Buka browser dan kunjungi `https://mcp.domainku.com/health` (atau subdomain yang Anda pilih).
2. Jika berhasil, Anda akan melihat respons JSON:
   ```json
   { "status": "ok", "service": "Enterprise SaaS-to-MCP Gateway" }
   ```
3. Di Atlassian Rovo admin console, Anda sekarang bisa mendaftarkan endpoint MCP Server Anda menggunakan URL HTTPS publik ini: `https://mcp.domainku.com/mcp`.
