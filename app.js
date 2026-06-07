const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// ==========================================
// ⚠️ 請填入你的金鑰 ⚠️
// ==========================================
const CHANNEL_ACCESS_TOKEN = 'FpYYGobL5CFc3u5lsVOEGfHTSEYHHiw7P3e25FD5MhqusbsANf98WzgO2eAvPXBSkcLFdA8uI5pjbAZ75WX/xIcmlNcjUEztbyBvT0f8Z9y6QgmS/F+EPNDkUgO2YsRBdpKhRv5J3Eh0PIfF6kt4QwdB04t89/1O/w1cDnyilFU=';
const OPENWEATHER_API_KEY = 'c18e4c4fda2f35d440449d71b76fb485';  // 
// ==========================================

// 城市列表（使用英文名稱）
const CITIES = [
  { code: "1", name: "臺北市", displayName: "臺北市", english: "Taipei" },
  { code: "2", name: "新北市", displayName: "新北市", english: "New Taipei" },
  { code: "3", name: "基隆市", displayName: "基隆市", english: "Keelung" },
  { code: "4", name: "宜蘭縣", displayName: "宜蘭縣", english: "Yilan" },
  { code: "5", name: "花蓮縣", displayName: "花蓮縣", english: "Hualien" },
  { code: "6", name: "臺東縣", displayName: "台東縣", english: "Taitung" },
  { code: "7", name: "屏東縣", displayName: "屏東縣", english: "Pingtung" },
  { code: "8", name: "高雄市", displayName: "高雄市", english: "Kaohsiung" },
  { code: "9", name: "臺南市", displayName: "台南市", english: "Tainan" },
  { code: "A", name: "雲林縣", displayName: "雲林縣", english: "Yunlin" },
  { code: "B", name: "嘉義縣", displayName: "嘉義縣", english: "Chiayi" },
  { code: "C", name: "彰化縣", displayName: "彰化縣", english: "Changhua" },
  { code: "D", name: "臺中市", displayName: "台中市", english: "Taichung" },
  { code: "E", name: "南投縣", displayName: "南投縣", english: "Nantou" },
  { code: "F", name: "苗栗縣", displayName: "苗栗縣", english: "Miaoli" },
  { code: "G", name: "桃園市", displayName: "桃園市", english: "Taoyuan" },
  { code: "H", name: "金門縣", displayName: "金門縣", english: "Kinmen" },
  { code: "I", name: "澎湖縣", displayName: "澎湖縣", english: "Penghu" }
];

// 室內環境設定
const INDOOR_TEMP = 25;
const INDOOR_HUM = 50;

// ==========================================
// 從 OpenWeatherMap 獲取天氣
// ==========================================
async function getRealWeather(city) {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city.english}&units=metric&appid=${OPENWEATHER_API_KEY}&lang=zh_tw`;
    
    console.log(`🌤️ 獲取 ${city.displayName} 天氣...`);
    
    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;
    
    if (data && data.main) {
      const temp = Math.round(data.main.temp);
      const humidity = data.main.humidity;
      
      console.log(`✅ ${city.displayName}: ${temp}℃, ${humidity}%`);
      return { temp, humidity };
    }
    
    return null;
  } catch (error) {
    console.error(`❌ ${city.displayName} API錯誤:`, error.response?.data?.message || error.message);
    return null;
  }
}

async function getWeather(city) {
  const realWeather = await getRealWeather(city);
  if (realWeather) {
    return realWeather;
  }
  
  // 如果 API 失敗，使用類比資料
  console.log(`📦 使用類比資料: ${city.displayName}`);
  return { temp: 28, humidity: 60 };
}

// ==========================================
// 計算環境指數
// ==========================================
async function getCombinedIndex(city) {
  const weather = await getWeather(city);
  
  // 計算皮膚乾燥指數
  const deltaTemp = Math.max(0, weather.temp - INDOOR_TEMP);
  const drynessScore = Math.min(100, (deltaTemp / 12) * 50 + Math.max(0, 55 - weather.humidity) * 1.5);
  
  let drynessLevel = "🟢 低";
  let drynessAdvice = "✅ 狀況良好";
  if (drynessScore >= 75) {
    drynessLevel = "🔴 危險";
    drynessAdvice = "🔥 請立即加強保濕，避免長時間吹冷氣";
  } else if (drynessScore >= 50) {
    drynessLevel = "🟠 高";
    drynessAdvice = "⚠️ 建議使用保濕乳液，多補充水分";
  } else if (drynessScore >= 25) {
    drynessLevel = "🟡 中";
    drynessAdvice = "😐 可適度補充水分，保持肌膚滋潤";
  }
  
  // 計算濕度衝擊指數
  const shock = Math.abs(weather.humidity - INDOOR_HUM);
  let shockLevel = "🟢 低";
  let shockAdvice = "✅ 進出舒適，身體適應良好";
  if (shock >= 30) {
    shockLevel = "🔴 危險";
    shockAdvice = "🔥 濕度衝擊劇烈！進出冷氣房請注意身體調節";
  } else if (shock >= 20) {
    shockLevel = "🟠 高";
    shockAdvice = "⚠️ 濕度落差大，建議緩慢進出室內外";
  } else if (shock >= 10) {
    shockLevel = "🟡 中";
    shockAdvice = "😐 有些微衝擊感，一般體質可適應";
  }
  
  return `🌤️ 【${city.displayName} 環境指數】

🌡️ 皮膚乾燥指數：${drynessLevel} (${Math.round(drynessScore)}分)
   • 室外 ${weather.temp}℃ / 室內 ${INDOOR_TEMP}℃
   • 室外濕度 ${weather.humidity}% / 室內 ${INDOOR_HUM}%
   💡 ${drynessAdvice}

💧 濕度衝擊指數：${shockLevel} (衝擊差 ${Math.round(shock)}%)
   • 室外濕度 ${weather.humidity}% → 室內 ${INDOOR_HUM}%
   💡 ${shockAdvice}

📊 資料來源：🌐 OpenWeatherMap`;
}

// ==========================================
// LINE Webhook
// ==========================================
app.post('/webhook', async (req, res) => {
  console.log('📨 收到 Webhook 請求');
  res.status(200).send('OK');
  
  try {
    const events = req.body.events;
    if (!events || events.length === 0) return;
    
    for (const event of events) {
      const replyToken = event.replyToken;
      
      // 處理文字訊息
      if (event.type === 'message' && event.message.type === 'text') {
        const userInput = event.message.text.trim().toUpperCase();
        const city = CITIES.find(c => c.code === userInput);
        
        if (city) {
          const replyText = await getCombinedIndex(city);
          await replyMessage(replyToken, replyText);
        } else {
          await sendHelpMessage(replyToken);
        }
      }
      
      // 處理按鈕回傳
      if (event.type === 'postback' && event.postback.data?.startsWith('city=')) {
        const cityCode = event.postback.data.split('=')[1];
        const city = CITIES.find(c => c.code === cityCode);
        if (city) {
          const replyText = await getCombinedIndex(city);
          await replyMessage(replyToken, replyText);
        }
      }
    }
  } catch (err) {
    console.error('處理錯誤:', err);
  }
});

// 發送幫助訊息
async function sendHelpMessage(replyToken) {
  const helpText = `📱 【環境指數查詢 Bot】

請輸入城市代碼查詢：

1=臺北市    2=新北市    3=基隆市
4=宜蘭縣    5=花蓮縣    6=臺東縣
7=屏東縣    8=高雄市    9=臺南市
A=雲林縣    B=嘉義縣    C=彰化縣
D=臺中市    E=南投縣    F=苗栗縣
G=桃園市    H=金門縣    I=澎湖縣

💡 範例：輸入「1」查詢臺北市`;
  
  await replyMessage(replyToken, helpText);
}

// 發送 LINE 訊息
async function replyMessage(replyToken, text) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`
      }
    });
    console.log('✅ 回復成功');
  } catch (err) {
    console.error('❌ 回復失敗:', err.response?.data || err.message);
  }
}

// 健康檢查
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'LINE 環境指數 Bot 運行中',
    version: '2.0.0',
    api: 'OpenWeatherMap'
  });
});

// ==========================================
// 啟動伺服器
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 ========================================`);
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 使用 OpenWeatherMap API`);
  console.log(`🔑 API Key: ${OPENWEATHER_API_KEY ? '已設定 ✓' : '未設定 ✗'}`);
  console.log(`🤖 LINE Token: ${CHANNEL_ACCESS_TOKEN ? '已設定 ✓' : '未設定 ✗'}`);
  console.log(`========================================\n`);
});
