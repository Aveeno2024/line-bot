const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// ==========================================
// ⚠️ 請在這裡填入你的金鑰 ⚠️
// ==========================================
const CWA_AUTH_KEY = 'CWA-B59372C7-9BD4-44F8-B759-D6ED723C6BC4';
const LINE_ACCESS_TOKEN = 'yn5Na00wbNupb51o4eVC+GSvXbjqO2oaZURDj3IVHbcVwndFdmXK33Upu1y68YXrkcLFdA8uI5pjbAZ75WX/xIcmlNcjUEztbyBvT0f8Z9wedwylmDkXq2E1X+CuQhpjl/bQDNmT08b0XChzXshqRAdB04t89/1O/w1cDnyilFU=';
// ==========================================

// 城市列表（共18個）
const CITIES = [
  { code: "01", name: "臺北市" }, { code: "02", name: "新北市" },
  { code: "03", name: "基隆市" }, { code: "04", name: "宜蘭縣" },
  { code: "05", name: "花蓮縣" }, { code: "06", name: "臺東縣" },
  { code: "07", name: "屏東縣" }, { code: "08", name: "高雄市" },
  { code: "09", name: "臺南市" }, { code: "0A", name: "雲林縣" },
  { code: "0B", name: "嘉義縣" }, { code: "0C", name: "彰化縣" },
  { code: "0D", name: "臺中市" }, { code: "0E", name: "南投縣" },
  { code: "0F", name: "苗栗縣" }, { code: "0G", name: "桃園市" },
  { code: "0H", name: "金門縣" }, { code: "0I", name: "澎湖縣" }
];

// 城市對應的氣象資料 ID（請確認正確）
const CITY_DATAID = {
  "臺北市": "F-D0047-061", "新北市": "F-D0047-063", "基隆市": "F-D0047-001",
  "宜蘭縣": "F-D0047-003", "花蓮縣": "F-D0047-005", "臺東縣": "F-D0047-007",
  "屏東縣": "F-D0047-009", "高雄市": "F-D0047-067", "臺南市": "F-D0047-065",
  "雲林縣": "F-D0047-011", "嘉義縣": "F-D0047-013", "彰化縣": "F-D0047-015",
  "臺中市": "F-D0047-059", "南投縣": "F-D0047-017", "苗栗縣": "F-D0047-019",
  "桃園市": "F-D0047-055",
  "金門縣": "F-D0047-XXX",  // 請填入正確的 dataid
  "澎湖縣": "F-D0047-YYY"    // 請填入正確的 dataid
};

const INDOOR_TEMP = 25.0;
const INDOOR_HUM = 50.0;

// ==========================================
// LINE Webhook 入口
// ==========================================
app.post('/webhook', async (req, res) => {
  console.log('收到 Webhook 請求');
  
  try {
    const events = req.body.events;
    if (!events) {
      return res.status(200).send('OK');
    }
    
    for (let event of events) {
      const replyToken = event.replyToken;
      
      // 處理文字消息
      if (event.type === 'message' && event.message.type === 'text') {
        const userInput = event.message.text.trim().toUpperCase();
        const city = CITIES.find(c => c.code === userInput);
        
        if (city) {
          const replyText = await getCombinedIndex(city.name);
          await replyToLine(replyToken, replyText);
        } else {
          await sendCarouselMenu(replyToken);
        }
      }
      
      // 處理按鈕回傳
      if (event.type === 'postback') {
        const data = event.postback.data;
        if (data && data.startsWith('city=')) {
          const cityCode = data.split('=')[1];
          const city = CITIES.find(c => c.code === cityCode);
          if (city) {
            const replyText = await getCombinedIndex(city.name);
            await replyToLine(replyToken, replyText);
          }
        }
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook 錯誤:', error);
    res.status(200).send('OK');
  }
});

// 發送 Flex Message 選單（左右滑動）
async function sendCarouselMenu(replyToken) {
  const carousel = {
    type: 'flex',
    altText: '請選擇城市查詢環境指數',
    contents: {
      type: 'carousel',
      contents: []
    }
  };
  
  for (let city of CITIES) {
    carousel.contents.contents.push({
      type: 'bubble',
      hero: {
        type: 'image',
        url: 'https://scdn.line-apps.com/n/channel_devcenter/img/fx/01_1_cafe.png',
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: `🌡️💧 ${city.name}`, weight: 'bold', size: 'xl', align: 'center' },
          { type: 'text', text: '皮膚乾燥指數 + 濕度衝擊指數', size: 'sm', color: '#666666', align: 'center', wrap: true },
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            spacing: 'sm',
            contents: [
              { type: 'text', text: '📊 即時查詢', size: 'sm', color: '#AAAAAA' },
              { type: 'text', text: '🌐 資料來源：中央氣象署', size: 'sm', color: '#AAAAAA' }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [{
          type: 'button',
          style: 'primary',
          color: '#4A90E2',
          action: {
            type: 'postback',
            label: '🔍 查詢',
            data: `city=${city.code}`,
            displayText: `查詢 ${city.name}`
          }
        }]
      }
    });
  }
  
  await replyToLine(replyToken, [carousel]);
}

// 計算指數並回復
async function getCombinedIndex(cityName) {
  const weather = await getWeatherByCity(cityName);
  if (!weather) {
    return `❌ 無法獲取 ${cityName} 的天氣資料，請稍後再試。`;
  }
  
  // 皮膚乾燥指數
  const deltaTemp = Math.max(0, weather.temp - INDOOR_TEMP);
  const drynessScore = (deltaTemp / 12) * 50 + Math.max(0, 55 - weather.humidity) * 1.5;
  
  let drynessLevel = "🟢 低";
  let drynessAdvice = "✅ 狀況良好";
  if (drynessScore >= 75) {
    drynessLevel = "🔴 危險";
    drynessAdvice = "🔥 請立即加強保濕，避免長時間吹冷氣。";
  } else if (drynessScore >= 50) {
    drynessLevel = "🟠 高";
    drynessAdvice = "⚠️ 建議使用保濕乳液。";
  } else if (drynessScore >= 25) {
    drynessLevel = "🟡 中";
    drynessAdvice = "😐 可適度補充水分。";
  }
  
  // 濕度衝擊指數
  const shock = Math.abs(weather.humidity - INDOOR_HUM);
  let shockLevel = "🟢 低";
  let shockAdvice = "✅ 進出舒適";
  if (shock >= 30) {
    shockLevel = "🔴 危險";
    shockAdvice = "🔥 濕度衝擊劇烈！進出冷氣房請注意身體調節。";
  } else if (shock >= 20) {
    shockLevel = "🟠 高";
    shockAdvice = "⚠️ 濕度落差大，建議緩慢進出室內外。";
  } else if (shock >= 10) {
    shockLevel = "🟡 中";
    shockAdvice = "😐 有些微衝擊感，一般體質可適應。";
  }
  
  return `🌤️ 【${cityName} 環境指數】

🌡️ 皮膚乾燥指數：${drynessLevel} (${Math.round(drynessScore)}分)
   • 室外 ${weather.temp}℃ / 室內 ${INDOOR_TEMP}℃
   • 室外濕度 ${weather.humidity}% / 室內 ${INDOOR_HUM}%
   💡 ${drynessAdvice}

💧 濕度衝擊指數：${shockLevel} (衝擊差 ${Math.round(shock)}%)
   • 室外濕度 ${weather.humidity}% → 室內 ${INDOOR_HUM}%
   💡 ${shockAdvice}

📊 資料時間：即時查詢
🌐 資料來源：中央氣象署`;
}

// 調用中央氣象署 API
async function getWeatherByCity(cityName) {
  const dataid = CITY_DATAID[cityName];
  if (!dataid) {
    console.log(`找不到 ${cityName} 的 dataid`);
    return null;
  }
  
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${dataid}?Authorization=${CWA_AUTH_KEY}&format=JSON&limit=1`;
  
  try {
    const response = await axios.get(url);
    const data = response.data;
    
    const location = data.records?.locations[0]?.location[0];
    if (!location) return null;
    
    const weatherEle = location.weatherElement;
    const tempElem = weatherEle.find(w => w.elementName === "T");
    const humElem = weatherEle.find(w => w.elementName === "RH");
    
    const temp = tempElem?.time[0]?.elementValue[0]?.value;
    const humidity = humElem?.time[0]?.elementValue[0]?.value;
    
    if (temp && humidity) {
      return { temp: parseFloat(temp), humidity: parseFloat(humidity) };
    }
    return null;
  } catch (e) {
    console.error('氣象 API 錯誤:', e.message);
    return null;
  }
}

// 回復 LINE 消息
async function replyToLine(replyToken, messages) {
  if (!Array.isArray(messages)) {
    messages = [{ type: 'text', text: messages }];
  }
  
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: messages
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
      }
    });
    console.log('回復成功');
  } catch (e) {
    console.error('LINE 回復錯誤:', e.response?.data || e.message);
  }
}

// 健康檢查（讓 Render 知道服務正常）
app.get('/', (req, res) => {
  res.send('✅ LINE 環境指數 Bot 已上線！\n\n請在 LINE 輸入任意文字喚出城市選單。');
});

// 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 伺服器運行中，埠: ${PORT}`);
  console.log(`📡 Webhook 網址: https://你的功能變數名稱.onrender.com/webhook`);
});
