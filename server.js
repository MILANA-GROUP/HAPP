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
    
    // Точный путь к файлу welcome_photo в корне репозитория (если он в папке, поменяйте на path.join(__dirname, 'папка', 'welcome_photo.jpg'))
    // Проверьте расширение: .jpg, .jpeg или .png
    const photoPath = path.join(__dirname, 'welcome_photo.jpg');

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
        console.error("Ошибка отправки welcome_photo:", e.message);
        // Если путь не совпадет, бот пришлет текст с кнопкой, но не упадет
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
        const authPhotoPath = path.join(__dirname, 'auth_photo.jpg'); // Путь ко второму файлу

        try {
            await bot.sendPhoto(chatId, authPhotoPath, {
                caption: authCaption,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🌐 Открыть сайт', url: 'https://milana-group.github.io' }]
                    ]
                }
            });
        } catch (e) {
            await bot.sendMessage(chatId, authCaption, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🌐 Открыть сайт', url: 'https://milana-group.github.io' }]
                    ]
                }
            });
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
