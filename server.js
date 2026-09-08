const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const users = {};       // chatId -> { phone, first_name, username }
const userMarks = {};   // chatId -> [ { id, title, coords, photo, text } ]
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
    delete users[chatId];
    try { await bot.deleteMessage(chatId, messageId); } catch (e) {}
    bot.sendMessage(chatId, "Вы вышли из аккаунта. Введите /start для повторного входа.");
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
    users[chatId] = {
      phone: msg.contact.phone_number,
      first_name: msg.from.first_name || 'Пользователь'
    };

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
    if (!users[chatId]) {
      bot.sendMessage(chatId, "Вы не авторизованы. Введите /start");
      return;
    }
    bot.sendMessage(chatId, `Профиль: ${users[chatId].first_name}\nТелефон: ${users[chatId].phone}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔴 Выйти из аккаунта', callback_data: 'logout' }]
        ]
      }
    });
    return;
  }

  if (text === '📍 Метки') {
    const marks = userMarks[chatId] || [];
    if (marks.length === 0) {
      bot.sendMessage(chatId, "У вас пока нет сохраненных меток.");
      return;
    }
    const inlineKeyboard = marks.map(m => [{ text: `📍 ${m.title}`, callback_data: `select_mark_${m.id}` }]);
    bot.sendMessage(chatId, "Ваши метки:", {
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
    return;
  }

  if (waitingForMedia[chatId]) {
    const markId = waitingForMedia[chatId];
    if (!userMarks[chatId]) userMarks[chatId] = [];
    const mark = userMarks[chatId].find(m => m.id === markId);
    if (mark) {
      mark.photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
      mark.text = text || msg.caption || "";
      bot.sendMessage(chatId, "Метка успешно обновлена!");
    }
    delete waitingForMedia[chatId];
  }
});

app.get('/api/auth-status/:chatId', (req, res) => {
  const chatId = req.params.chatId;
  if (users[chatId]) {
    res.json({ authorized: true, user: users[chatId] });
  } else {
    res.json({ authorized: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
