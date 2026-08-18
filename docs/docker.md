Viewed bigquery.test.ts:85-105

I will view the contents of the GitHub Actions workflow file to see what actions it performs and what permissions or secrets it requires to execute successfully. This is the most specific tool for viewing file content.

Viewed release-docker.yml:1-46

Setelah menambahkan `.github/workflows/release-docker.yml`, secara umum alur CI/CD ini **sudah siap berjalan (out-of-the-box)** karena menggunakan `${{ secrets.GITHUB_TOKEN }}` bawaan GitHub untuk login ke GitHub Container Registry (GHCR) dan mendefinisikan izin (`permissions: packages: write`) secara eksplisit di dalam berkas workflow.

Namun, ada beberapa langkah konfigurasi di GitHub dan cara memicunya yang perlu Anda perhatikan:

### 1. Cara Memicu (Trigger) Workflow
Workflow ini diatur untuk berjalan hanya ketika ada tag baru dengan awalan `v` (seperti `v1.0.0`) yang di-*push*, atau saat Anda mempublikasikan *Release* baru di GitHub.

Untuk mencobanya secara lokal, Anda bisa melakukan langkah berikut di terminal proyek:
```bash
# 1. Tambahkan tag versi baru
git tag v1.0.0

# 2. Push tag tersebut ke GitHub (ini akan memicu GitHub Actions)
git push origin v1.0.0
```

---

### 2. Memeriksa Pengaturan Workflow Permissions di GitHub
Meskipun izin menulis paket (`packages: write`) sudah ditulis di dalam berkas YAML, beberapa organisasi atau repositori memiliki aturan keamanan ketat yang menonaktifkan fitur ini secara default.
Untuk memastikannya:
1. Buka halaman repositori Anda di GitHub.
2. Masuk ke menu **Settings** > **Actions** > **General**.
3. Gulir ke bawah hingga bagian **Workflow permissions**.
4. Pastikan opsi **Read and write permissions** terpilih (atau minimal pastikan workflow diizinkan membuat paket).

---

### 3. Mengatur Visibilitas Paket (GitHub Packages Settings)
Setelah pertama kali workflow berhasil berjalan dan berhasil mengunggah image ke GHCR:
1. Buka profil GitHub Anda (atau organisasi kantor) dan masuk ke tab **Packages**.
2. Cari paket bernama `bigquery-mcp`.
3. Secara default, GitHub biasanya menyetel visibilitas paket baru sebagai **Private**.
4. **Jika Anda ingin men-deploy ke Cloud Run kantor:**
   * **Opsi A (Rekomendasi untuk Perusahaan)**: Tetap biarkan *Private*, namun di dalam menu **Package Settings** > **Manage Actions access**, pastikan repositori Anda memiliki akses *Read* / *Inherited* ke paket tersebut. Di sisi Cloud Run, Anda perlu mengonfigurasi kredensial penarikan (*image pull secret*) jika Cloud Run ditarik dari registry privat di luar Google Artifact Registry (GAR).
   * **Opsi B (Rekomendasi untuk Open Source)**: Ubah visibilitas paket menjadi **Public** melalui halaman **Package Settings** di bagian bawah (*Danger Zone*). Setelah menjadi publik, Cloud Run dapat menarik image tersebut secara langsung tanpa perlu otentikasi tambahan.

> [!TIP]
> Jika di masa mendatang Anda ingin men-deploy langsung ke Cloud Run kantor tanpa *image pull secret*, pertimbangkan untuk menggunakan **Google Artifact Registry (GAR)** alih-alih GHCR. Anda bisa menggunakan workflow serupa tetapi masuk (*login*) menggunakan Google Service Account dengan kunci `wip` (Workload Identity Federation) atau kredensial GCP.