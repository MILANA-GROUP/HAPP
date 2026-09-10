'use strict';

const path = require('path');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const TelegramBot = require('node-telegram-bot-api');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('FATAL: BOT_TOKEN is not set in environment variables.');
  process.exit(1);
}

const DB_PATH = path.join(__dirname, 'database.db');
const PUBLIC_DIR = path.join(__dirname, 'public'); // static site files
const ASSETS_DIR = path.join(__dirname, 'assets'); // bot images

const WELCOME_PHOTO = path.join(ASSETS_DIR, 'welcome_photo.PNG');
const AUTH_PHOTO = path.join(ASSETS_DIR, 'auth_photo.JPG');

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to open database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database at', DB_PATH);
});

/**
 * All schema setup happens inside a single db.serialize() call so that
 * statements run strictly in order on the same connection. This avoids
 * "SQLITE_ERROR: no such table" race conditions that happen when queries
 * fire before CREATE TABLE has finished.
 */
function initDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('PRAGMA foreign_keys = ON;');

      db.run(
        `CREATE TABLE IF NOT EXISTS users (
          telegram_id INTEGER PRIMARY KEY,
          phone       TEXT,
          first_name  TEXT,
          username    TEXT
        )`,
        (err) => {
          if (err) return reject(err);
        }
      );

      db.run(
        `CREATE TABLE IF NOT EXISTS marks (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          creator_chat_id  INTEGER,
          title            TEXT NOT NULL,
          photo            TEXT,
          text             TEXT
        )`,
        (err) => {
          if (err) return reject(err);
        }
      );

      // Seed a default mark if the table is empty.
      db.get('SELECT COUNT(*) AS count FROM marks', (err, row) => {
        if (err) return reject(err);

        if (row.count === 0) {
          db.run(
            `INSERT INTO marks (creator_chat_id, title, photo, text)
             VALUES (?, ?, ?, ?)`,
            [0, 'Тестовая метка', null, 'Это метка по умолчанию, добавленная при первом запуске.'],
            (err) => {
              if (err) return reject(err);
              console.log('Seeded default mark.');
              resolve();
            }
          );
        } else {
          resolve();
        }
      });
    });
  });
}

// --- Small promise wrappers around sqlite3 for convenience -----------------

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this); // this.lastID / this.changes
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

async function upsertUser(contact) {
  const { user_id, phone_number, first_name } = contact;
  await dbRun(
    `INSERT INTO users (telegram_id, phone, first_name, username)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET
       phone = excluded.phone,
       first_name = excluded.first_name,
       username = excluded.username`,
    [user_id, phone_number, first_name, contact.username || null]
  );
}

function getUser(telegramId) {
  return dbGet('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
}

function deleteUser(telegramId) {
  return dbRun('DELETE FROM users WHERE telegram_id = ?', [telegramId]);
}

function getAllMarks() {
  return dbAll('SELECT * FROM marks ORDER BY id ASC');
}

// ---------------------------------------------------------------------------
// Telegram bot
// ---------------------------------------------------------------------------

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

const mainMenuKeyboard = {
  reply_markup: {
    keyboard: [['👤 АККАУНТ', '📍 Метки']],
    resize_keyboard: true,
  },
};

const loginInlineKeyboard = {
  reply_markup: {
    inline_keyboard: [[{ text: '🔑 Войти', callback_data: 'login' }]],
  },
};

const contactRequestKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: '📱 Поделиться контактом', request_contact: true }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  },
};

// --- /start ------------------------------------------------------------

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendPhoto(chatId, WELCOME_PHOTO, {
      caption: 'Добро пожаловать! Нажмите кнопку ниже, чтобы войти.',
      ...loginInlineKeyboard,
    });
  } catch (err) {
    console.error('Error sending welcome photo:', err.message);
    await bot.sendMessage(
      chatId,
      'Добро пожаловать! Нажмите кнопку ниже, чтобы войти.',
      loginInlineKeyboard
    );
  }
});

// --- Inline button callbacks --------------------------------------------

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  try {
    if (data === 'login') {
      await bot.answerCallbackQuery(query.id);
      try {
        await bot.sendPhoto(chatId, AUTH_PHOTO, {
          caption: 'Пожалуйста, поделитесь своим контактом для входа.',
          ...contactRequestKeyboard,
        });
      } catch (err) {
        console.error('Error sending auth photo:', err.message);
        await bot.sendMessage(
          chatId,
          'Пожалуйста, поделитесь своим контактом для входа.',
          contactRequestKeyboard
        );
      }
      return;
    }

    if (data === 'logout') {
      await deleteUser(chatId);
      await bot.answerCallbackQuery(query.id, { text: 'Вы вышли из аккаунта.' });
      await bot.sendMessage(chatId, 'Вы вышли из аккаунта.', {
        reply_markup: { remove_keyboard: true },
      });
      await bot.sendMessage(
        chatId,
        'Нажмите кнопку ниже, чтобы войти снова.',
        loginInlineKeyboard
      );
      return;
    }

    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error('Error handling callback_query:', err.message);
    try {
      await bot.answerCallbackQuery(query.id, {
        text: 'Произошла ошибка, попробуйте ещё раз.',
      });
    } catch (_) {
      // ignore secondary failure
    }
  }
});

// --- Contact sharing -----------------------------------------------------

bot.on('contact', async (msg) => {
  const chatId = msg.chat.id;
  const contact = msg.contact;

  // Only accept the user's own contact, not a forwarded one.
  if (contact.user_id && contact.user_id !== msg.from.id) {
    await bot.sendMessage(chatId, 'Пожалуйста, поделитесь своим собственным контактом.');
    return;
  }

  try {
    await upsertUser({
      user_id: chatId,
      phone_number: contact.phone_number,
      first_name: contact.first_name,
      username: msg.from.username,
    });

    await bot.sendMessage(chatId, 'Вы успешно авторизованы! ✅', mainMenuKeyboard);
  } catch (err) {
    console.error('Error saving user contact:', err.message);
    await bot.sendMessage(chatId, 'Не удалось сохранить данные. Попробуйте ещё раз позже.');
  }
});

// --- Text menu buttons -----------------------------------------------------

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return; // ignore non-text updates here (contact/photo handled elsewhere)

  try {
    if (text === '👤 АККАУНТ') {
      const user = await getUser(chatId);

      if (!user) {
        await bot.sendMessage(
          chatId,
          'Вы не авторизованы. Нажмите /start, чтобы войти.',
          loginInlineKeyboard
        );
        return;
      }

      const info =
        `👤 Имя: ${user.first_name || '—'}\n` +
        `📞 Телефон: ${user.phone || '—'}`;

      await bot.sendMessage(chatId, info, {
        reply_markup: {
          inline_keyboard: [[{ text: '🚪 Выйти', callback_data: 'logout' }]],
        },
      });
      return;
    }

    if (text === '📍 Метки') {
      const marks = await getAllMarks();

      if (marks.length === 0) {
        await bot.sendMessage(chatId, 'Меток пока нет.');
        return;
      }

      const list = marks
        .map((m, i) => `${i + 1}. ${m.title}${m.text ? ` — ${m.text}` : ''}`)
        .join('\n');

      await bot.sendMessage(chatId, `📍 Список меток:\n\n${list}`);
      return;
    }
  } catch (err) {
    console.error('Error handling message:', err.message);
    await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте ещё раз позже.');
  }
});

// ---------------------------------------------------------------------------
// Express web server
// ---------------------------------------------------------------------------

const app = express();

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Check whether a given chat id is authorized (i.e. saved in the users table).
app.get('/api/auth-status/:chatId', async (req, res) => {
  const chatId = Number(req.params.chatId);

  if (!Number.isInteger(chatId)) {
    return res.status(400).json({ error: 'chatId must be an integer' });
  }

  try {
    const user = await getUser(chatId);
    res.json({ authorized: !!user });
  } catch (err) {
    console.error('Error in /api/auth-status:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Return all marks for the website.
app.get('/api/marks', async (req, res) => {
  try {
    const marks = await getAllMarks();
    res.json(marks);
  } catch (err) {
    console.error('Error in /api/marks:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Fallback for unknown API routes.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start() {
  try {
    await initDatabase();
    console.log('Database initialized.');

    app.listen(PORT, () => {
      console.log(`Web server listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
  }
}

start();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown() {
  console.log('Shutting down...');
  bot.stopPolling().finally(() => {
    db.close((err) => {
      if (err) console.error('Error closing database:', err.message);
      process.exit(0);
    });
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
