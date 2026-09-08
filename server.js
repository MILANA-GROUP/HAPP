const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static('.')); // Чтобы раздавать index.html

// Подключение к PostgreSQL через переменную окружения Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Требуется для внешних подключений к базам на Railway
  }
});

// Создание таблицы для маркеров/данных при запуске, если её еще нет
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS markers (
        id SERIAL PRIMARY KEY,
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Таблица успешно проверена/создана в PostgreSQL");
  } catch (err) {
    console.error("Ошибка при создании таблицы:", err);
  }
}
initDb();

// Пример API для получения данных
app.get('/api/data', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM markers ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Ошибка сервера при получении данных");
  }
});

// Пример API для сохранения данных
app.post('/api/data', async (req, res) => {
  try {
    const { data } = req.body;
    await pool.query('INSERT INTO markers (data) VALUES ($1)', [data]);
    res.status(200).send("Успешно сохранено");
  } catch (err) {
    console.error(err);
    res.status(500).send("Ошибка сервера при сохранении");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
