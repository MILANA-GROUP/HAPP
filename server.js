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
const waitingForMedia = {}; // chatId -> state

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const caption = "ПРИВЕТ! ЗДЕСЬ ТЫ МОЖЕШЬ УВИДЕТЬ ТО, ЧТО ТЕБЕ НЕ ЗАХОЧЕТСЯ УВИДЕТЬ НА ДОРОГАХ).\nПользуйся нашим сервисом пока он бесплатный.";

    try {
        await bot.sendPhoto(chatId, 'welcome_image.jpg', {
            caption: caption,
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'ПЕРЕЙТИ К РЕГИСТРАЦИИ / ВХОДУ', callback_data: 'register' }]
                ]
            }
        });
    } catch (e) {
        await bot.sendMessage(chatId, caption, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'ПЕРЕЙТИ К РЕГИСТРАЦИИ / ВХОДУ', callback_data: 'register' }]
                ]
            }
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
