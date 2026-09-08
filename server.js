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

// === НАСТРОЙКА КАРТИНОК ===
// Сюда можно подставить file_id из Telegram (например, "AgACAgIAAxkBA...") 
// либо прямые ссылки / локальные пути к вашим изображениям
const welcomePhoto = 'https://images.unsplash.com/photo-1506744038136-46273834b3fb'; // Картинка для /start
const authPhoto = 'https://images.unsplash.com/photo-1506744038136-46273834b3fb';    // Картинка для раздела авторизации/входа

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const caption = "ПРИВЕТ! ЗДЕСЬ ТЫ МОЖЕШЬ УВИДЕТЬ ТО, ЧТО ТЕБЕ НЕ ЗАХОЧЕТСЯ УВИДЕТЬ НА ДОРОГАХ).\nПользуйся нашим сервисом пока он бесплатный.";

    try {
        await bot.sendPhoto(chatId, welcomePhoto, {
            caption: caption,
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'ПЕРЕЙТИ К РЕГИСТРАЦИИ / ВХОДУ', callback_data: 'register' }]
                ]
            }
        });
    } catch (e) {
        console.error("Ошибка отправки welcomePhoto:", e.message);
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
        const authCaption = "Для входа и регистрации перейдите на сайт сервиса:";
        try {
            await bot.sendPhoto(chatId, authPhoto, {
                caption: authCaption,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🌐 Открыть сайт', url: 'https://milana-group.github.io' }] // Замените на ссылку вашего сайта, если нужно
                    ]
                }
            });
        } catch (e) {
            await bot.sendMessage(chatId, authCaption);
        }
    }
    
    await bot.answerCallbackQuery(query.id);
});

// API endpoint для сайта
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
