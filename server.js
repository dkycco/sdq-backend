const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bodyParser = require("body-parser");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const multer = require("multer"); // Tambahan untuk upload file
const path = require("path");
const fs = require("fs");

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
// Middleware agar folder assets bisa diakses secara publik lewat browser
app.use("/assets", express.static("assets"));

// --- KONEKSI DATABASE ---
const db = mysql.createConnection({
  host: "192.168.1.4",
  user: "smkkorprisumedang",
  password: "20208395",
  database: "unsap_food",
});

db.connect((err) => {
  if (err) {
    console.error("❌ Gagal konek database:", err);
  } else {
    console.log("✅ Berhasil konek ke MySQL Database!");
  }
});

// --- KONFIGURASI MULTER (UPDATE: SUPPORT TOKO, PRODUK & BUKTI BAYAR) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Cek nama field input file untuk menentukan folder tujuan
    if (file.fieldname === "store_image") {
      cb(null, "assets/images/stores"); // Folder Toko
    } else if (file.fieldname === "payment_proof") {
      cb(null, "assets/images/proofs"); // Folder Bukti Bayar
    } else {
      cb(null, "assets/images/products"); // Folder Produk
    }
  },
  filename: (req, file, cb) => {
    // Nama file: 1712345678-namaasli.jpg
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage: storage });

// --- KONFIGURASI EMAIL (NODEMAILER) ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: "galerymusik05@gmail.com",
    pass: "gsqv tbdy ruqt owpy",
  },
});

// --- API ROUTES ---

// 1. Ambil Semua Produk (JOIN DENGAN TOKO)
app.get("/api/products", (req, res) => {
  const sql = `
        SELECT p.*, s.name as store_name, s.image as store_image 
        FROM products p 
        LEFT JOIN stores s ON p.store_id = s.id 
        ORDER BY p.id DESC
    `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// 2. Ambil Detail Produk
app.get("/api/products/:id", (req, res) => {
  const sql = `
        SELECT p.*, s.name as store_name 
        FROM products p 
        LEFT JOIN stores s ON p.store_id = s.id 
        WHERE p.id = ?
    `;
  db.query(sql, [req.params.id], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.length === 0)
      return res.status(404).json({ msg: "Produk tidak ditemukan" });
    res.json(result[0]);
  });
});

// 3. Register Akun
app.post("/api/register", (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ message: "Semua kolom wajib diisi!" });

  const checkSql = "SELECT * FROM users WHERE email = ?";
  db.query(checkSql, [email], (err, results) => {
    if (err) return res.status(500).json(err);
    if (results.length > 0)
      return res.status(400).json({ message: "Email sudah terdaftar!" });

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);

    const insertSql =
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)";
    db.query(insertSql, [name, email, hash], (err, result) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Registrasi Berhasil! Silakan Login." });
    });
  });
});

// 4. Login
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const sql = "SELECT * FROM users WHERE email = ?";
  db.query(sql, [email], (err, results) => {
    if (err) return res.status(500).json(err);
    if (results.length === 0)
      return res.status(404).json({ message: "Email tidak ditemukan" });

    const user = results[0];
    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Password salah!" });

    res.json({
      message: "Login Sukses",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  });
});

// 5. Request Reset Password
app.post("/api/req-reset", (req, res) => {
  const { email } = req.body;
  const sql = "SELECT * FROM users WHERE email = ?";
  db.query(sql, [email], (err, results) => {
    if (err) return res.status(500).json(err);
    if (results.length === 0)
      return res.status(404).json({ message: "Email tidak ditemukan!" });

    const token = crypto.randomBytes(20).toString("hex");
    const expires = Date.now() + 3600000;

    const updateSql =
      "UPDATE users SET reset_token = ?, reset_expires = ? WHERE email = ?";
    db.query(updateSql, [token, expires, email], (err, result) => {
      if (err) return res.status(500).json(err);
      const resetLink = `http://127.0.0.1:5500/reset-password.html?token=${token}`;

      const mailOptions = {
        from: '"Unsap Food Hub" <230660121018@student.unsap.ac.id>',
        to: email,
        subject: "Reset Password - Unsap Food Hub",
        html: `<h3>Halo ${results[0].name},</h3><p>Klik tombol di bawah untuk reset password:</p><a href="${resetLink}" style="background:#ff4757; color:white; padding:10px; text-decoration:none;">Reset Password Sekarang</a>`,
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error)
          return res.status(500).json({ message: "Gagal kirim email" });
        res.json({ message: "Link reset sudah dikirim ke email!" });
      });
    });
  });
});

// 6. Update Password Baru
app.post("/api/reset-password", (req, res) => {
  const { token, newPassword } = req.body;
  const sql = "SELECT * FROM users WHERE reset_token = ? AND reset_expires > ?";
  db.query(sql, [token, Date.now()], (err, results) => {
    if (err || results.length === 0)
      return res.status(400).json({ message: "Token tidak valid/kadaluarsa" });
    const hash = bcrypt.hashSync(newPassword, 10);
    const updateSql =
      "UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?";
    db.query(updateSql, [hash, results[0].id], (err, result) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Password berhasil diperbarui!" });
    });
  });
});

// 7. Simpan Transaksi (Checkout) - UPDATE DENGAN UPLOAD BUKTI BAYAR
app.post("/api/checkout", upload.single("payment_proof"), (req, res) => {
  // Karena pakai FormData, data ada di req.body
  const { orderId, buyer, phone, total, items, payment_method } = req.body;

  // Nama file bukti (jika ada)
  const proofImage = req.file ? req.file.filename : null;

  const sql =
    "INSERT INTO transactions (order_id, buyer_name, buyer_phone, total_amount, items, payment_method, payment_proof) VALUES (?, ?, ?, ?, ?, ?, ?)";

  db.query(
    sql,
    [orderId, buyer, phone, total, items, payment_method, proofImage],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Gagal menyimpan transaksi" });
      }
      res.json({ message: "Transaksi Sukses", id: result.insertId });
    }
  );
});

// --- API ADMIN ---

// 8. Ambil Semua Transaksi
app.get("/api/admin/orders", (req, res) => {
  const sql = "SELECT * FROM transactions ORDER BY created_at DESC";
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// 9. Update Status Pesanan
app.put("/api/admin/orders/:id", (req, res) => {
  const { status } = req.body;
  const sql = "UPDATE transactions SET status = ? WHERE id = ?";
  db.query(sql, [status, req.params.id], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "Status pesanan berhasil diperbarui" });
  });
});

// 10. Hapus Pesanan
app.delete("/api/admin/orders/:id", (req, res) => {
  const sql = "DELETE FROM transactions WHERE id = ?";
  db.query(sql, [req.params.id], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "Pesanan berhasil dihapus" });
  });
});

// 11. Tambah Produk Baru
app.post("/api/admin/products", upload.single("image"), (req, res) => {
  const { name, price, description, category, rating, store_id } = req.body;
  const imageName = req.file ? req.file.filename : "default.jpg";

  const sql =
    "INSERT INTO products (name, price, image, description, category, rating, store_id) VALUES (?, ?, ?, ?, ?, ?, ?)";
  db.query(
    sql,
    [name, price, imageName, description, category, rating, store_id],
    (err, result) => {
      if (err)
        return res.status(500).json({ message: "Gagal menyimpan ke database" });
      res.json({
        message: "Produk baru berhasil ditambahkan!",
        filename: imageName,
      });
    }
  );
});

// 12. Hapus Produk
app.delete("/api/admin/products/:id", (req, res) => {
  const productId = req.params.id;
  const sqlGetImage = "SELECT image FROM products WHERE id = ?";
  db.query(sqlGetImage, [productId], (err, results) => {
    if (err) return res.status(500).json(err);
    if (results.length === 0)
      return res.status(404).json({ message: "Produk tidak ditemukan" });

    const imageName = results[0].image;
    db.query(
      "DELETE FROM products WHERE id = ?",
      [productId],
      (err, result) => {
        if (err) return res.status(500).json(err);
        if (imageName && imageName !== "default.jpg") {
          const filePath = path.join(
            __dirname,
            "assets/images/products",
            imageName
          );
          fs.unlink(filePath, () => {});
        }
        res.json({ message: "Produk berhasil dihapus!" });
      }
    );
  });
});

// --- MANAJEMEN TOKO ---

// 13. Ambil Daftar Toko
app.get("/api/admin/stores", (req, res) => {
  db.query("SELECT * FROM stores", (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// 14. ADMIN: TAMBAH TOKO BARU (VERSI DEBUG LENGKAP)
app.post("/api/admin/stores", upload.single("store_image"), (req, res) => {
  // 1. Cek apakah Data Teks masuk?
  console.log("➡️ Menerima Data Toko...");
  console.log("   - Body:", req.body);

  // 2. Cek apakah File Gambar masuk?
  console.log("   - File:", req.file);

  const { name, description } = req.body;

  // Validasi sederhana
  if (!name) {
    console.error("❌ Eror: Nama Toko Kosong!");
    return res.status(400).json({ message: "Gagal: Nama Toko wajib diisi!" });
  }

  const imageName = req.file ? req.file.filename : "default_store.jpg";

  const sql = "INSERT INTO stores (name, description, image) VALUES (?, ?, ?)";

  db.query(sql, [name, description, imageName], (err, result) => {
    if (err) {
      // 3. Jika Database Menolak, Tampilkan Alasannya di Terminal
      console.error("❌ SQL ERROR:", err.sqlMessage);

      // Kirim pesan error yang JELAS ke Frontend (biar gak undefined)
      return res
        .status(500)
        .json({ message: "Database Error: " + err.sqlMessage });
    }

    console.log(
      "✅ Sukses: Toko berhasil disimpan ke Database (ID: " +
        result.insertId +
        ")"
    );
    res.json({ message: "Toko berhasil dibuat!" });
  });
});

// --- FITUR REVIEW ---

// 15. Ambil Review Per Produk
app.get("/api/reviews/:productId", (req, res) => {
  const sql =
    "SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC";
  db.query(sql, [req.params.productId], (err, results) => {
    if (err) return res.status(500).json(err);
    res.json(results);
  });
});

// 16. Kirim Review Baru
app.post("/api/reviews", (req, res) => {
  const { product_id, user_name, rating, comment } = req.body;
  const sqlInsert =
    "INSERT INTO reviews (product_id, user_name, rating, comment) VALUES (?, ?, ?, ?)";

  db.query(
    sqlInsert,
    [product_id, user_name, rating, comment],
    (err, result) => {
      if (err)
        return res.status(500).json({ message: "Gagal menyimpan review" });

      const sqlAvg =
        "SELECT AVG(rating) as average FROM reviews WHERE product_id = ?";
      db.query(sqlAvg, [product_id], (err, results) => {
        if (err) return;
        const newRating = parseFloat(results[0].average).toFixed(1);
        db.query(
          "UPDATE products SET rating = ? WHERE id = ?",
          [newRating, product_id],
          () => {
            res.json({
              message: "Ulasan berhasil dikirim!",
              newRating: newRating,
            });
          }
        );
      });
    }
  );
});

// 17. Ambil Detail Order (Struk)
app.get("/api/orders/:orderId", (req, res) => {
  const sql = "SELECT * FROM transactions WHERE order_id = ?";
  db.query(sql, [req.params.orderId], (err, results) => {
    if (err) return res.status(500).json(err);
    if (results.length === 0)
      return res.status(404).json({ message: "Pesanan tidak ditemukan" });
    res.json(results[0]);
  });
});

// Jalankan Server
app.listen(port, () => {
  console.log(`🚀 Server berjalan di http://localhost:${port}`);
});
