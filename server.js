const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const users = {};       // chatId -> phone / data
const userMarks = {};   // chatId -> [ marks ]

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const caption = "ПРИВЕТ! ЗДЕСЬ ТЫ МОЖЕШЬ УВИДЕТЬ ТО, ЧТО ТЕБЕ НЕ ЗАХОЧЕТСЯ УВИДЕТЬ НА ДОРОГАХ).\nПользуйся нашим сервисом пока он бесплатный.";
    
    // Путь к картинке в корне проекта (положите файл photo.jpg рядом с server.js, если хотите фото)
    const photoPath = path.join(__dirname, 'photo.jpg');

    try {
        await bot.sendPhoto(chatId, photoPath, {
            caption: caption,
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'ПЕРЕЙТИ К РЕГИСТРАЦИИ / ВХОДУ', callback_data: 'register' }]
                ]
            }
        });
    } catch (e) {
        // Если картинка photo.jpg не найдена, отправляем просто текст с кнопкой без падения
        await bot.sendMessage(chatId, caption, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'ПЕРЕЙТИ К РЕГИСТРАЦИИ / ВХОДУ', callback_data: 'register' }]
                ]
            }
        });
    }
});

// Обработка нажатий на инлайн-кнопки в боте
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === 'register') {
        await bot.sendMessage(chatId, "Для входа перейдите на сайт сервиса и авторизуйтесь.");
    }
    
    await bot.answerCallbackQuery(query.id);
});

// Пример API endpoint для взаимодействия с сайтом
app.get('/api/check-auth/:chatId', (req, res) => {
    const chatId = req.params.chatId;
    if (users[chatId]) {
        res.json({ status: 'authorized', user: users[chatId] });
    } else {
        res.json({ status: 'unauthorized' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
