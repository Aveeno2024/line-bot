const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = 'yn5Na00wbNupb51o4eVC+GSvXbjqO2oaZURDj3IVHbcVwndFdmXK33Upu1y68YXrkcLFdA8uI5pjbAZ75WX/xIcmlNcjUEztbyBvT0f8Z9wedwylmDkXq2E1X+CuQhpjl/bQDNmT08b0XChzXshqRAdB04t89/1O/w1cDnyilFU=';

// 城市列表
const CITIES = [
  { code: "01", name: "台北市" }, { code: "02", name: "新北市" },
  { code: "03", name: "基隆市" }, { code: "04", name: "宜蘭縣" },
  { code: "05", name: "花蓮縣" }, { code: "06", name: "臺東縣" },
  { code: "07", name: "屏東縣" }, { code: "08", name: "高雄市" },
  { code: "09", name: "臺南市" }, { code: "0A", name: "雲林縣" },
  { code: "0B", name: "嘉義縣" }, { code: "0C", name: "彰化縣" },
  { code: "0D", name: "臺中市" }, { code: "0E", name: "南投縣" },
  { code: "0F", name: "苗栗縣" }, { code: "0G", name: "桃園市" },
  { code: "0H", name: "金門縣" }, { code: "0I", name: "澎湖縣" }
];

app.post('/webhook', async (req, res) => {
  console.log('收到請求');
  
  try {
    const events = req.body.events;
    for (let event of events) {
      const replyToken = event.replyToken;
      
      if (event.type === 'message' && event.message.type === 'text') {
        const userInput = event.message.text.trim().toUpperCase();
        const city = CITIES.find(c => c.code === userInput);
        
        if (city) {
          // 找到城市，回傳指數（測試用模擬資料）
          const replyText = `🌤️ 【${city.name} 環境指數 - 測試模式】

🌡️ 皮膚乾燥指數：🟡 中 (42分)
   • 室外 31℃ / 室內 25℃
   • 室外濕度 55% / 室內 50%
   💡 可適度補充水分

💧 濕度衝擊指數：🟢 低 (5分)
   • 室外濕度 55% → 室內 50%
   💡 進出舒適

📌 這是測試資料，串接氣象 API 後會變成真實數據。`;
          await reply(replyToken, replyText);
        } else {
          // 沒找到城市，顯示選單
          await sendCarouselMenu(replyToken);
        }
      }
      
      if (event.type === 'postback') {
        const data = event.postback.data;
        if (data && data.startsWith('city=')) {
          const cityCode = data.split('=')[1];
          const city = CITIES.find(c => c.code === cityCode);
          if (city) {
            const replyText = `你查詢了 ${city.name}，指數計算中...`;
            await reply(replyToken, replyText);
          }
        }
      }
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('錯誤:', err);
    res.status(200).send('OK');
  }
});

async function sendCarouselMenu(replyToken) {
  const carousel = {
    type: 'flex',
    altText: '請選擇城市',
    contents: {
      type: 'carousel',
      contents: CITIES.slice(0, 10).map(city => ({
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: `🌡️💧 ${city.name}`, weight: 'bold', size: 'xl', align: 'center' }
          ]
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [{
            type: 'button',
            action: { type: 'postback', label: '查詢', data: `city=${city.code}`, displayText: `查詢 ${city.name}` }
          }]
        }
      }))
    }
  };
  await reply(replyToken, [carousel]);
}

async function reply(replyToken, messages) {
  if (!Array.isArray(messages)) messages = [{ type: 'text', text: messages }];
  await axios.post('https://api.line.me/v2/bot/message/reply', {
    replyToken: replyToken,
    messages: messages
  }, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
  });
}

app.get('/', (req, res) => res.send('OK'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
