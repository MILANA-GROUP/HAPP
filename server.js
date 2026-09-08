const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.static(__dirname));

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("База данных успешно инициализирована.");
  } catch (err) {
    console.error("Ошибка инициализации БД:", err);
  }
}
initDB();

app.get('/api/marks', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, title, lat, lng FROM marks ORDER BY id ASC');
    const marks = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      coords: [row.lat, row.lng]
    }));
    res.json(marks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post('/api/marks', async (req, res) => {
  try {
    const { title, coords } = req.body;
    if (!title || !coords || coords.length !== 2) {
      return res.status(400).json({ error: "Неверные данные" });
    }
    const result = await pool.query(
      'INSERT INTO marks (title, lat, lng) VALUES ($1, $2, $3) RETURNING id, title, lat, lng',
      [title, coords[0], coords[1]]
    );
    const row = result.rows[0];
    res.json({
      id: row.id,
      title: row.title,
      coords: [row.lat, row.lng]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.delete('/api/marks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM marks WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});
