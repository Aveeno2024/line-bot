const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// ==========================================
// ⚠️ 請填入你的金鑰 ⚠️
// ==========================================
const CHANNEL_ACCESS_TOKEN = 'FpYYGobL5CFc3u5lsVOEGfHTSEYHHiw7P3e25FD5MhqusbsANf98WzgO2eAvPXBSkcLFdA8uI5pjbAZ75WX/xIcmlNcjUEztbyBvT0f8Z9y6QgmS/F+EPNDkUgO2YsRBdpKhRv5J3Eh0PIfF6kt4QwdB04t89/1O/w1cDnyilFU=';
const CWA_API_KEY = 'CWA-B59372C7-9BD4-44F8-B759-D6ED723C6BC4';
// ==========================================

// 城市對照表（站名要用 API 回傳的格式）
const CITIES = [
  { code: "1", name: "臺北市", displayName: "臺北市", stationName: "臺北" },
  { code: "2", name: "新北市", displayName: "新北市", stationName: "板橋" },
  { code: "3", name: "基隆市", displayName: "基隆市", stationName: "基隆" },
  { code: "4", name: "宜蘭縣", displayName: "宜蘭縣", stationName: "宜蘭" },
  { code: "5", name: "花蓮縣", displayName: "花蓮縣", stationName: "花蓮" },
  { code: "6", name: "臺東縣", displayName: "台東縣", stationName: "臺東" },
  { code: "7", name: "屏東縣", displayName: "屏東縣", stationName: "屏東" },
  { code: "8", name: "高雄市", displayName: "高雄市", stationName: "高雄" },
  { code: "9", name: "臺南市", displayName: "台南市", stationName: "臺南" },
  { code: "A", name: "雲林縣", displayName: "雲林縣", stationName: "虎尾" },
  { code: "B", name: "嘉義縣", displayName: "嘉義縣", stationName: "嘉義" },
  { code: "C", name: "彰化縣", displayName: "彰化縣", stationName: "田中" },
  { code: "D", name: "臺中市", displayName: "台中市", stationName: "臺中" },
  { code: "E", name: "南投縣", displayName: "南投縣", stationName: "日月潭" },
  { code: "F", name: "苗栗縣", displayName: "苗栗縣", stationName: "苗栗" },
  { code: "G", name: "桃園市", displayName: "桃園市", stationName: "桃園" },
  { code: "H", name: "金門縣", displayName: "金門縣", stationName: "金門" },
  { code: "I", name: "澎湖縣", displayName: "澎湖縣", stationName: "澎湖" }
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

const INDOOR_TEMP = 25;
const INDOOR_HUM = 50;

// ==========================================
// 從中央氣象署獲取真實天氣
// ==========================================
async function getRealWeather(city) {
  try {
    // 不帶 StationId，取得所有測站
    const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?Authorization=${CWA_API_KEY}&format=JSON`;
    
    console.log(`🌤️ 獲取 ${city.displayName} 天氣...`);
    
    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;
    
    if (data.success === "true" && data.records?.Station) {
      const stations = data.records.Station;
      
      // 尋找匹配的測站
      const matched = stations.find(s => 
        s.StationName === city.stationName ||
        s.StationName.includes(city.stationName)
      );
      
      if (matched && matched.WeatherElement) {
        const weather = matched.WeatherElement;
        const temp = parseFloat(weather.AirTemperature);
        const humidity = parseFloat(weather.RelativeHumidity);
        
        if (!isNaN(temp) && !isNaN(humidity) && temp !== -99 && humidity !== -99) {
          console.log(`✅ ${city.displayName} (${matched.StationName}): ${temp}℃, ${humidity}%`);
          return { temp, humidity };
        }
      }
      
      // 除錯：顯示前幾個測站名稱
      console.log(`⚠️ 找不到 ${city.stationName}，可用的測站: ${stations.slice(0, 5).map(s => s.StationName).join(', ')}`);
    }
    
    return null;
  } catch (error) {
    console.error(`❌ ${city.displayName} API錯誤:`, error.message);
    return null;
  }
}

async function getWeather(city) {
  const realWeather = await getRealWeather(city);
  if (realWeather) {
    return realWeather;
  }
  
  console.log(`📦 使用類比資料: ${city.displayName}`);
  return MOCK_WEATHER[city.name] || { temp: 28, humidity: 60 };
}

async function getCombinedIndex(city) {
  const weather = await getWeather(city);
  const isReal = MOCK_WEATHER[city.name] ? weather !== MOCK_WEATHER[city.name] : false;
  
  const deltaTemp = Math.max(0, weather.temp - INDOOR_TEMP);
  const drynessScore = Math.min(100, (deltaTemp / 12) * 50 + Math.max(0, 55 - weather.humidity) * 1.5);
  
  let drynessLevel = "🟢 低";
  let drynessAdvice = "✅ 狀況良好";
  if (drynessScore >= 75) {
    drynessLevel = "🔴 危險";
    drynessAdvice = "🔥 請立即加強保濕";
  } else if (drynessScore >= 50) {
    drynessLevel = "🟠 高";
    drynessAdvice = "⚠️ 建議使用保濕乳液";
  } else if (drynessScore >= 25) {
    drynessLevel = "🟡 中";
    drynessAdvice = "😐 可適度補充水分";
  }
  
  const shock = Math.abs(weather.humidity - INDOOR_HUM);
  let shockLevel = "🟢 低";
  let shockAdvice = "✅ 進出舒適";
  if (shock >= 30) {
    shockLevel = "🔴 危險";
    shockAdvice = "🔥 濕度衝擊劇烈";
  } else if (shock >= 20) {
    shockLevel = "🟠 高";
    shockAdvice = "⚠️ 濕度落差大";
  } else if (shock >= 10) {
    shockLevel = "🟡 中";
    shockAdvice = "😐 有些微衝擊感";
  }
  
  const source = isReal ? "🌐 中央氣象署" : "📋 類比資料";
  
  return `🌤️ 【${city.displayName} 環境指數】

🌡️ 皮膚乾燥指數：${drynessLevel} (${Math.round(drynessScore)}分)
   • 室外 ${weather.temp}℃ / 室內 ${INDOOR_TEMP}℃
   • 室外濕度 ${weather.humidity}% / 室內 ${INDOOR_HUM}%
   💡 ${drynessAdvice}

💧 濕度衝擊指數：${shockLevel} (衝擊差 ${Math.round(shock)}%)
   💡 ${shockAdvice}

📊 ${source}`;
}

// ==========================================
// LINE Webhook
// ==========================================
app.post('/webhook', async (req, res) => {
  console.log('📨 收到 Webhook');
  res.status(200).send('OK');
  
  try {
    const events = req.body.events;
    if (!events) return;
    
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const input = event.message.text.trim().toUpperCase();
        const city = CITIES.find(c => c.code === input);
        
        if (city) {
          const reply = await getCombinedIndex(city);
          await replyMessage(event.replyToken, reply);
        } else {
          await sendHelp(event.replyToken);
        }
      }
    }
  } catch (err) {
    console.error('處理錯誤:', err);
  }
});

async function sendHelp(replyToken) {
  const help = `📱 請輸入代碼：

1=臺北市  2=新北市  3=基隆市
4=宜蘭縣  5=花蓮縣  6=臺東縣
7=屏東縣  8=高雄市  9=臺南市
A=雲林縣  B=嘉義縣  C=彰化縣
D=臺中市  E=南投縣  F=苗栗縣
G=桃園市  H=金門縣  I=澎湖縣`;
  
  await replyMessage(replyToken, help);
}

async function replyMessage(replyToken, text) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    }, {
      headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
    console.log('✅ 回復成功');
  } catch (err) {
    console.error('❌ 回復失敗:', err.response?.data);
  }
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'LINE Bot 運行中' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 使用中央氣象署 API (O-A0001-001)`);
});
