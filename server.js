const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Инициализация базы данных SQLite (файл database.db сохранится на сервере Railway)
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) console.error('Ошибка подключения к БД', err.message);
  else console.log('Подключено к базе данных SQLite.');
});

// Создаем таблицу пользователей, если ее еще нет
db.run(`CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  phone TEXT,
  first_name TEXT,
  username TEXT
)`);

// Создаем таблицу меток, чтобы они были общими для всех пользователей и сохранялись в БД
db.run(`CREATE TABLE IF NOT EXISTS marks (
  id TEXT PRIMARY KEY,
  creator_chat_id INTEGER,
  title TEXT,
  photo TEXT,
  text TEXT
)`);

const waitingForMedia = {}; // chatId -> markId

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
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
    // Удаляем пользователя из базы данных при выходе
    db.run(`DELETE FROM users WHERE telegram_id = ?`, [chatId], async (err) => {
      try { await bot.deleteMessage(chatId, messageId); } catch (e) {}
      bot.sendMessage(chatId, "Вы вышли из аккаунта. Введите /start для повторного входа.");
    });
  } else if (query.data.startsWith('select_mark_')) {
    const markId = query.data.replace('select_mark_', '');
    waitingForMedia[chatId] = markId;
    bot.sendMessage(chatId, "Отправьте фото и текст для этой метки:");
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (msg.contact) {
    const phone = msg.contact.phone_number;
    const firstName = msg.from.first_name || 'Пользователь';
    const username = msg.from.username || '';

    // Сохраняем или обновляем пользователя в базе данных
    const query = `
      INSERT INTO users (telegram_id, phone, first_name, username) 
      VALUES (?, ?, ?, ?)
      ON CONFLICT(telegram_id) 
      DO UPDATE SET phone=excluded.phone, first_name=excluded.first_name, username=excluded.username
    `;

    db.run(query, [chatId, phone, firstName, username], (err) => {
      if (err) {
        console.error('Ошибка сохранения контакта в БД:', err);
      }
    });

    bot.sendMessage(chatId, "Вы успешно авторизованы! Теперь сайт разблокирован.", {
      reply_markup: {
        keyboard: [
          [{ text: '👤 АККАУНТ' }, { text: '📍 Метки' }]
        ],
        resize_keyboard: true
      }
    });
    return;
  }

  if (text === '👤 АККАУНТ') {
    db.get(`SELECT * FROM users WHERE telegram_id = ?`, [chatId], (err, user) => {
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
    // Получаем ВСЕ метки из базы данных, чтобы они были общими для всех пользователей
    db.all(`SELECT * FROM marks`, [], (err, marks) => {
      if (err || !marks || marks.length === 0) {
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
    const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
    const markText = text || msg.caption || "";

    // Обновляем метку в общей базе данных SQLite
    db.run(
      `UPDATE marks SET photo = ?, text = ? WHERE id = ?`,
      [photo, markText, markId],
      (err) => {
        if (err) {
          console.error("Ошибка сохранения метки в БД:", err);
          bot.sendMessage(chatId, "Не удалось сохранить метку на сервере.");
        } else {
          bot.sendMessage(chatId, "Метка успешно обновлена!");
        }
      }
    );

    delete waitingForMedia[chatId];
    return;
  }
});

// Эндпоинт для проверки авторизации на сайте
app.get('/api/auth-status/:chatId', (req, res) => {
  const chatId = req.params.chatId;
  
  db.get(`SELECT * FROM users WHERE telegram_id = ?`, [chatId], (err, user) => {
    if (err) {
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
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
