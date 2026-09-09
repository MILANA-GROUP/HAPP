const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Не даём боту "тихо" ронять процесс при сетевых сбоях long-polling
bot.on('polling_error', (err) => {
  console.error('Polling error:', err.code, err.message);
});

// Инициализация базы данных SQLite (файл database.db сохранится на сервере Railway)
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('Ошибка подключения к БД', err.message);
    return;
  }
  console.log('Подключено к базе данных SQLite.');

  // ВАЖНО: serialize гарантирует, что запросы ниже выполнятся строго по очереди —
  // без этого CREATE TABLE и последующие запросы к этой же таблице могли
  // выполняться "внахлёст" на разных потоках пула sqlite3 и падать
  // с ошибкой "SQLITE_ERROR: no such table".
  db.serialize(() => {
    db.run(`PRAGMA foreign_keys = ON`);
    initDatabaseDefaults();
  });
});

// Функция создания таблиц и дефолтных данных
function initDatabaseDefaults() {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    phone TEXT,
    first_name TEXT,
    username TEXT
  )`, (err) => {
    if (err) console.error('Ошибка создания таблицы users:', err.message);
  });

  db.run(`CREATE TABLE IF NOT EXISTS marks (
    id TEXT PRIMARY KEY,
    creator_chat_id INTEGER,
    title TEXT,
    photo TEXT,
    text TEXT
  )`, (err) => {
    if (err) {
      console.error('Ошибка создания таблицы marks:', err.message);
      return;
    }

    // Проверяем, есть ли хоть одна метка, если нет — создаём базовую,
    // чтобы список не был пустым
    db.get(`SELECT COUNT(*) as count FROM marks`, (err, row) => {
      if (err) {
        console.error('Ошибка проверки количества меток:', err.message);
        return;
      }
      if (row && row.count === 0) {
        db.run(
          `INSERT INTO marks (id, creator_chat_id, title, photo, text) VALUES (?, ?, ?, ?, ?)`,
          ['1', 0, 'Первая аварийная метка', null, 'Описание появится позже'],
          (err) => {
            if (err) console.error('Ошибка вставки метки по умолчанию:', err.message);
          }
        );
      }
    });
  });
}

const waitingForMedia = {}; // chatId -> markId

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  // на всякий случай сбрасываем "режим ожидания", если пользователь перезапустил бота
  delete waitingForMedia[chatId];

  const caption = "ПРИВЕТ! ЗДЕСЬ ТЫ МОЖЕШЬ УВИДЕТЬ ТО, ЧТО ТЕБЕ НЕ ЗАХОЧЕТСЯ УВИДЕТЬ на дорогах).\nПользуйся нашим сервисом пока он бесплатный.";

  try {
    await bot.sendPhoto(chatId, 'welcome_photo.PNG', {
      caption: caption,
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ПЕРЕЙТИ К РЕГИСТРАЦИИ / ВХОДУ', callback_data: 'start_auth' }]
        ]
      }
    });
  } catch (e) {
    console.error('Не удалось отправить welcome_photo:', e.message);
    await bot.sendMessage(chatId, caption, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ПЕРЕЙТИ К РЕГИСТРАЦИИ / ВХОДУ', callback_data: 'start_auth' }]
        ]
      }
    });
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  try {
    if (query.data === 'start_auth') {
      try { await bot.deleteMessage(chatId, messageId); } catch (e) {}

      const authText = "Для РЕГИСТРАЦИИ / ВХОДА НЕОБХОДИМО Отправить номер телефона . Нажмите кнопку ниже для того чтобы поделится номером";
      try {
        await bot.sendPhoto(chatId, 'auth_photo.JPG', {
          caption: authText,
          reply_markup: {
            keyboard: [
              [{ text: '📱 Поделиться контактом', request_contact: true }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
          }
        });
      } catch (e) {
        console.error('Не удалось отправить auth_photo:', e.message);
        await bot.sendMessage(chatId, authText, {
          reply_markup: {
            keyboard: [
              [{ text: '📱 Поделиться контактом', request_contact: true }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true
          }
        });
      }
    } else if (query.data === 'logout') {
      db.run(`DELETE FROM users WHERE telegram_id = ?`, [chatId], async (err) => {
        if (err) console.error('Ошибка удаления пользователя:', err.message);
        try { await bot.deleteMessage(chatId, messageId); } catch (e) {}
        bot.sendMessage(chatId, "Вы вышли из аккаунта. Введите /start для повторного входа.");
      });
    } else if (query.data.startsWith('select_mark_')) {
      const markId = query.data.replace('select_mark_', '');

      // Проверяем, что метка действительно существует, прежде чем ждать медиа от пользователя
      db.get(`SELECT id FROM marks WHERE id = ?`, [markId], (err, row) => {
        if (err) {
          console.error('Ошибка проверки метки:', err.message);
          bot.sendMessage(chatId, "Произошла ошибка при выборе метки. Попробуйте ещё раз.");
          return;
        }
        if (!row) {
          bot.sendMessage(chatId, "Такой метки не существует.");
          return;
        }
        waitingForMedia[chatId] = markId;
        bot.sendMessage(chatId, "Отправьте фото и текст для этой метки:");
      });
    }

    // Обязательно отвечаем на callback, иначе кнопка будет "крутиться" у пользователя
    bot.answerCallbackQuery(query.id).catch(() => {});
  } catch (e) {
    console.error('Ошибка обработки callback_query:', e.message);
    bot.answerCallbackQuery(query.id).catch(() => {});
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  try {
    if (msg.contact) {
      const phone = msg.contact.phone_number;
      const firstName = msg.from.first_name || 'Пользователь';
      const username = msg.from.username || '';

      const query = `
        INSERT INTO users (telegram_id, phone, first_name, username)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(telegram_id)
        DO UPDATE SET phone = excluded.phone, first_name = excluded.first_name, username = excluded.username
      `;

      db.run(query, [chatId, phone, firstName, username], (err) => {
        if (err) {
          console.error('Ошибка сохранения контакта в БД:', err.message);
          bot.sendMessage(chatId, "Не удалось сохранить контакт. Попробуйте ещё раз позже.");
          return;
        }
        bot.sendMessage(chatId, "Вы успешно авторизованы! Теперь сайт разблокирован.", {
          reply_markup: {
            keyboard: [
              [{ text: '👤 АККАУНТ' }, { text: '📍 Метки' }]
            ],
            resize_keyboard: true
          }
        });
      });
      return;
    }

    if (text === '👤 АККАУНТ') {
      delete waitingForMedia[chatId];
      db.get(`SELECT * FROM users WHERE telegram_id = ?`, [chatId], (err, user) => {
        if (err) {
          console.error('Ошибка получения пользователя:', err.message);
          bot.sendMessage(chatId, "Произошла ошибка. Попробуйте ещё раз.");
          return;
        }
        if (!user) {
          bot.sendMessage(chatId, "Вы не авторизованы. Введите /start");
          return;
        }
        bot.sendMessage(chatId, `Профиль: ${user.first_name}\nТелефон: ${user.phone}`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔴 Выйти из аккаунта', callback_data: 'logout' }]
            ]
          }
        });
      });
      return;
    }

    if (text === '📍 Метки') {
      delete waitingForMedia[chatId];
      db.all(`SELECT * FROM marks`, [], (err, marks) => {
        if (err) {
          console.error('Ошибка получения меток:', err.message);
          bot.sendMessage(chatId, "Не удалось загрузить метки. Попробуйте ещё раз.");
          return;
        }
        if (!marks || marks.length === 0) {
          bot.sendMessage(chatId, "В системе пока нет сохраненных меток.");
          return;
        }
        const inlineKeyboard = marks.map(m => [{ text: `📍 ${m.title}`, callback_data: `select_mark_${m.id}` }]);
        bot.sendMessage(chatId, "Все метки:", {
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      });
      return;
    }

    if (waitingForMedia[chatId]) {
      const markId = waitingForMedia[chatId];
      const photo = (msg.photo && msg.photo.length > 0)
        ? msg.photo[msg.photo.length - 1].file_id
        : null;
      const markText = text || msg.caption || null;

      if (!photo && !markText) {
        bot.sendMessage(chatId, "Пришлите фото и/или текст для метки.");
        return;
      }

      // UPSERT с COALESCE: если фото/текст в этом сообщении не пришли,
      // сохраняем то, что уже было записано ранее, вместо затирания NULL'ом.
      const query = `
        INSERT INTO marks (id, creator_chat_id, title, photo, text)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
          creator_chat_id = excluded.creator_chat_id,
          photo = COALESCE(excluded.photo, marks.photo),
          text = COALESCE(excluded.text, marks.text)
      `;

      db.run(query, [markId, chatId, `Метка ${markId}`, photo, markText], function (err) {
        if (err) {
          console.error("Ошибка сохранения метки в БД:", err.message);
          bot.sendMessage(chatId, "Не удалось сохранить метку на сервере: " + err.message);
        } else {
          bot.sendMessage(chatId, "Метка успешно сохранена!");
        }
      });

      delete waitingForMedia[chatId];
      return;
    }
  } catch (e) {
    console.error('Ошибка обработки сообщения:', e.message);
  }
});

// Эндпоинт для проверки авторизации на сайте
app.get('/api/auth-status/:chatId', (req, res) => {
  const chatId = req.params.chatId;

  db.get(`SELECT * FROM users WHERE telegram_id = ?`, [chatId], (err, user) => {
    if (err) {
      console.error('Ошибка /api/auth-status:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    if (user) {
      res.json({ authorized: true, user: { phone: user.phone, first_name: user.first_name, username: user.username } });
    } else {
      res.json({ authorized: false });
    }
  });
});

// Эндпоинт для получения всех общих меток на сайте
app.get('/api/marks', (req, res) => {
  db.all(`SELECT * FROM marks`, [], (err, rows) => {
    if (err) {
      console.error('Ошибка /api/marks:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Глобальные перехватчики, чтобы редкая непойманная ошибка не роняла весь процесс
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
