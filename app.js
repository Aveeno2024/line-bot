const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// ==========================================
// ⚠️ 請填入你的金鑰 ⚠️
// ==========================================
const CHANNEL_ACCESS_TOKEN = 'FpYYGobL5CFc3u5lsVOEGfHTSEYHHiw7P3e25FD5MhqusbsANf98WzgO2eAvPXBSkcLFdA8uI5pjbAZ75WX/xIcmlNcjUEztbyBvT0f8Z9y6QgmS/F+EPNDkUgO2YsRBdpKhRv5J3Eh0PIfF6kt4QwdB04t89/1O/w1cDnyilFU=';
const CWA_AUTH_KEY = 'CWA-B59372C7-9BD4-44F8-B759-D6ED723C6BC4';
// ==========================================

// 城市列表（使用觀測站 ID）
const CITIES = [
  { code: "1", name: "臺北市", displayName: "臺北市", stationId: "46692" },
  { code: "2", name: "新北市", displayName: "新北市", stationId: "46688" },
  { code: "3", name: "基隆市", displayName: "基隆市", stationId: "46694" },
  { code: "4", name: "宜蘭縣", displayName: "宜蘭縣", stationId: "46708" },
  { code: "5", name: "花蓮縣", displayName: "花蓮縣", stationId: "46699" },
  { code: "6", name: "臺東縣", displayName: "台東縣", stationId: "46766" },
  { code: "7", name: "屏東縣", displayName: "屏東縣", stationId: "46759" },
  { code: "8", name: "高雄市", displayName: "高雄市", stationId: "46744" },
  { code: "9", name: "臺南市", displayName: "台南市", stationId: "46741" },
  { code: "A", name: "雲林縣", displayName: "雲林縣", stationId: "46734" },
  { code: "B", name: "嘉義縣", displayName: "嘉義縣", stationId: "46748" },
  { code: "C", name: "彰化縣", displayName: "彰化縣", stationId: "46736" },
  { code: "D", name: "臺中市", displayName: "台中市", stationId: "46749" },
  { code: "E", name: "南投縣", displayName: "南投縣", stationId: "46765" },
  { code: "F", name: "苗栗縣", displayName: "苗栗縣", stationId: "46757" },
  { code: "G", name: "桃園市", displayName: "桃園市", stationId: "46705" },
  { code: "H", name: "金門縣", displayName: "金門縣", stationId: "46711" },
  { code: "I", name: "澎湖縣", displayName: "澎湖縣", stationId: "46735" }
];

// 類比資料（備用）
const MOCK_WEATHER = {
  "臺北市": { temp: 32, humidity: 58 },
  "新北市": { temp: 31, humidity: 60 },
  "基隆市": { temp: 29, humidity: 68 },
  "宜蘭縣": { temp: 30, humidity: 65 },
  "花蓮縣": { temp: 30, humidity: 63 },
  "臺東縣": { temp: 31, humidity: 60 },
  "屏東縣": { temp: 33, humidity: 58 },
  "高雄市": { temp: 33, humidity: 52 },
  "臺南市": { temp: 32, humidity: 56 },
  "雲林縣": { temp: 32, humidity: 57 },
  "嘉義縣": { temp: 32, humidity: 59 },
  "彰化縣": { temp: 31, humidity: 58 },
  "臺中市": { temp: 31, humidity: 55 },
  "南投縣": { temp: 31, humidity: 61 },
  "苗栗縣": { temp: 30, humidity: 60 },
  "桃園市": { temp: 30, humidity: 62 },
  "金門縣": { temp: 29, humidity: 68 },
  "澎湖縣": { temp: 30, humidity: 70 }
};

const INDOOR_TEMP = 25.0;
const INDOOR_HUM = 50.0;

// ==========================================
// 從中央氣象署獲取真實天氣
// ==========================================
async function getRealWeather(city) {
  const { stationId, displayName } = city;
  
  // 使用即時觀測資料 API
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?Authorization=${CWA_AUTH_KEY}&format=JSON&StationId=${stationId}`;
  
  try {
    console.log(`🌤️ 獲取 ${displayName} 天氣...`);
    
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'LINE-Bot/1.0' }
    });
    
    const data = response.data;
    
    // 檢查 API 回應
    if (!data || data.success !== "true") {
      console.log(`❌ API 失敗: ${displayName}`);
      return null;
    }
    
    // 解析資料 - 注意 O-A0001-001 的資料結構
    const station = data.records?.Station?.[0];
    if (!station || !station.WeatherElement) {
      console.log(`❌ 無觀測資料: ${displayName}`);
      return null;
    }
    
    const temp = station.WeatherElement.AirTemperature;
    const humidity = station.WeatherElement.RelativeHumidity;
    
    if (temp && humidity) {
      const tempNum = parseFloat(temp);
      const humNum = parseFloat(humidity);
      console.log(`✅ ${displayName}: ${tempNum}℃, ${humNum}%`);
      return { temp: tempNum, humidity: humNum };
    }
    
    console.log(`⚠️ 資料不完整: ${displayName}`);
    return null;
    
  } catch (error) {
    console.error(`❌ ${displayName} API 錯誤:`, error.message);
    return null;
  }
}

// 取得天氣（真實 API + 備援）
async function getWeather(city) {
  const realWeather = await getRealWeather(city);
  if (realWeather && realWeather.temp && realWeather.humidity) {
    return realWeather;
  }
  
  console.log(`📦 使用類比資料: ${city.displayName}`);
  return MOCK_WEATHER[city.name] || { temp: 28, humidity: 60 };
}

// 計算指數
async function getCombinedIndex(city) {
  const weather = await getWeather(city);
  const isRealData = MOCK_WEATHER[city.name] ? weather !== MOCK_WEATHER[city.name] : false;
  
  const deltaTemp = Math.max(0, weather.temp - INDOOR_TEMP);
  const drynessScore = Math.min(100, (deltaTemp / 12) * 50 + Math.max(0, 55 - weather.humidity) * 1.5);
  
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
  
  const dataSource = isRealData ? "🌐 中央氣象署即時觀測" : "📋 類比資料";
  
  return `🌤️ 【${city.displayName} 環境指數】

🌡️ 皮膚乾燥指數：${drynessLevel} (${Math.round(drynessScore)}分)
   • 室外 ${weather.temp}℃ / 室內 ${INDOOR_TEMP}℃
   • 室外濕度 ${weather.humidity}% / 室內 ${INDOOR_HUM}%
   💡 ${drynessAdvice}

💧 濕度衝擊指數：${shockLevel} (衝擊差 ${Math.round(shock)}%)
   • 室外濕度 ${weather.humidity}% → 室內 ${INDOOR_HUM}%
   💡 ${shockAdvice}

📊 資料來源：${dataSource}`;
}

// ==========================================
// LINE Webhook
// ==========================================
app.post('/webhook', async (req, res) => {
  console.log('📨 收到 Webhook');
  
  try {
    const events = req.body.events;
    if (!events || events.length === 0) {
      return res.status(200).send('OK');
    }
    
    for (let event of events) {
      const replyToken = event.replyToken;
      
      if (event.type === 'message' && event.message.type === 'text') {
        const userInput = event.message.text.trim().toUpperCase();
        const city = CITIES.find(c => c.code === userInput);
        
        if (city) {
          const replyText = await getCombinedIndex(city);
          await replyMessage(replyToken, replyText);
        } else {
          await sendCityMenu(replyToken);
        }
      }
      
      if (event.type === 'postback') {
        const data = event.postback.data;
        if (data && data.startsWith('city=')) {
          const cityCode = data.split('=')[1];
          const city = CITIES.find(c => c.code === cityCode);
          if (city) {
            const replyText = await getCombinedIndex(city);
            await replyMessage(replyToken, replyText);
          }
        }
      }
    }
    
    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook 錯誤:', err);
    res.status(200).send('OK');
  }
});

// 城市選單
async function sendCityMenu(replyToken) {
  // 限制一次最多顯示 10 個，避免超過 LINE 限制
  const displayCities = CITIES.slice(0, 10);
  
  const carousel = {
    type: 'flex',
    altText: '請選擇城市',
    contents: {
      type: 'carousel',
      contents: displayCities.map(city => ({
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents: [
            { type: 'text', text: `🌡️💧 ${city.displayName}`, weight: 'bold', size: 'xl', align: 'center' },
            { type: 'separator', margin: 'md' },
            { type: 'text', text: '點下方按鈕查詢', size: 'sm', color: '#666666', align: 'center' }
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
              displayText: `查詢 ${city.displayName}`
            }
          }]
        }
      }))
    }
  };
  
  const helpText = {
    type: 'text',
    text: '請輸入城市代碼查詢：\n1=臺北市 2=新北市 3=基隆市\n4=宜蘭縣 5=花蓮縣 6=臺東縣\n7=屏東縣 8=高雄市 9=臺南市\nA=雲林縣 B=嘉義縣 C=彰化縣\nD=臺中市 E=南投縣 F=苗栗縣\nG=桃園市 H=金門縣 I=澎湖縣'
  };
  
  await replyMessage(replyToken, [helpText, carousel]);
}

// 發送訊息
async function replyMessage(replyToken, messages) {
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
  res.json({ status: 'ok', message: 'LINE Bot is running' });
});

// 啟動伺服器 - 務必監聽正確的 PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 API 金鑰已設定: ${CWA_AUTH_KEY ? '是' : '否'}`);
  console.log(`🤖 LINE Token 已設定: ${CHANNEL_ACCESS_TOKEN ? '是' : '否'}`);
});
