const express = require('express');
const axios = require('axios');
const schedule = require('node-schedule');
const fs = require('fs');
const app = express();
app.use(express.json());

// ==========================================
// ⚠️ 請填入你的金鑰 ⚠️
// ==========================================
const CHANNEL_ACCESS_TOKEN = 'FpYYGobL5CFc3u5lsVOEGfHTSEYHHiw7P3e25FD5MhqusbsANf98WzgO2eAvPXBSkcLFdA8uI5pjbAZ75WX/xIcmlNcjUEztbyBvT0f8Z9y6QgmS/F+EPNDkUgO2YsRBdpKhRv5J3Eh0PIfF6kt4QwdB04t89/1O/w1cDnyilFU=';
const CWA_API_KEY = 'CWA-B59372C7-9BD4-44F8-B759-D6ED723C6BC4';
// ==========================================

// 室內環境設定
const INDOOR_TEMP = 26;
const INDOOR_HUM_RATIO = 0.5;

// 燈號閾值
const THRESHOLDS = {
  DRYNESS: { LOW: 25, MEDIUM: 50, HIGH: 75 },
  SHOCK: { LOW: 10, MEDIUM: 20, HIGH: 30 }
};

// 完整城市列表
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

// 類比資料
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

// ==========================================
// 用戶訂閱列表
// ==========================================
let subscribers = [];
const SUBSCRIBERS_FILE = './subscribers.json';

try {
  if (fs.existsSync(SUBSCRIBERS_FILE)) {
    const data = fs.readFileSync(SUBSCRIBERS_FILE, 'utf8');
    subscribers = JSON.parse(data);
    console.log(`📋 載入 ${subscribers.length} 位訂閱用戶`);
  }
} catch(e) { 
  console.log('📋 無訂閱記錄');
}

function saveSubscribers() {
  fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2));
}

// ==========================================
// 從中央氣象署獲取真實天氣
// ==========================================
async function getRealWeather(city) {
  try {
    const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?Authorization=${CWA_API_KEY}&format=JSON`;
    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;
    
    if (data.success === "true" && data.records?.Station) {
      const stations = data.records.Station;
      const matched = stations.find(s => 
        s.StationName === city.stationName ||
        s.StationName.includes(city.stationName)
      );
      
      if (matched && matched.WeatherElement) {
        const weather = matched.WeatherElement;
        const temp = parseFloat(weather.AirTemperature);
        const humidity = parseFloat(weather.RelativeHumidity);
        
        if (!isNaN(temp) && !isNaN(humidity) && temp !== -99 && humidity !== -99) {
          return { temp, humidity };
        }
      }
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

function calculateIndex(weather) {
  const indoorHumidity = Math.round(weather.humidity * INDOOR_HUM_RATIO);
  const deltaTemp = Math.max(0, weather.temp - INDOOR_TEMP);
  const drynessScore = Math.min(100, (deltaTemp / 12) * 50 + Math.max(0, 55 - indoorHumidity) * 1.5);
  const shockValue = Math.abs(weather.humidity - indoorHumidity);
  
  let drynessLevel, drynessColor, drynessAdvice;
  if (drynessScore >= 75) {
    drynessLevel = "危險";
    drynessColor = "#FF0000";
    drynessAdvice = "🔥 請立即加強保濕，避免長時間吹冷氣";
  } else if (drynessScore >= 50) {
    drynessLevel = "高";
    drynessColor = "#FF6600";
    drynessAdvice = "⚠️ 建議使用保濕乳液，多補充水分";
  } else if (drynessScore >= 25) {
    drynessLevel = "中";
    drynessColor = "#FFCC00";
    drynessAdvice = "😐 可適度補充水分，保持肌膚滋潤";
  } else {
    drynessLevel = "低";
    drynessColor = "#00CC00";
    drynessAdvice = "✅ 狀況良好，持續保持";
  }
  
  let shockLevel, shockColor, shockAdvice;
  if (shockValue >= 30) {
    shockLevel = "危險";
    shockColor = "#FF0000";
    shockAdvice = "🔥 濕度衝擊劇烈！進出冷氣房請注意身體調節";
  } else if (shockValue >= 20) {
    shockLevel = "高";
    shockColor = "#FF6600";
    shockAdvice = "⚠️ 濕度落差大，建議緩慢進出室內外";
  } else if (shockValue >= 10) {
    shockLevel = "中";
    shockColor = "#FFCC00";
    shockAdvice = "😐 有些微衝擊感，一般體質可適應";
  } else {
    shockLevel = "低";
    shockColor = "#00CC00";
    shockAdvice = "✅ 進出舒適，身體適應良好";
  }
  
  return {
    indoorHumidity,
    drynessScore: Math.round(drynessScore),
    drynessLevel,
    drynessColor,
    drynessAdvice,
    shockValue: Math.round(shockValue),
    shockLevel,
    shockColor,
    shockAdvice
  };
}

// ==========================================
// 產生回應訊息（純文字，確保可用）
// ==========================================
function generateTextMessage(city, weather, index) {
  const date = new Date();
  const dateStr = `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2,'0')}`;
  
  return `🌡️💧 【${city.displayName} 皮膚濕度衝擊指數】${dateStr}

🏠 室內環境：冷氣房 ${INDOOR_TEMP}℃
🌤️ 室外環境：${weather.temp}℃  ${weather.humidity}%

🌡️ 皮膚乾燥指數：${index.drynessLevel} (${index.drynessScore}分)
   💡 ${index.drynessAdvice}

💧 濕度衝擊指數：${index.shockLevel} (衝擊差 ${index.shockValue}%)
   💡 ${index.shockAdvice}

📊 資料來源：中央氣象署
📖 依據 Denda et al. (2002)`;
}

async function generateTaiwanSummaryText() {
  const results = [];
  for (const city of CITIES) {
    const weather = await getWeather(city);
    const index = calculateIndex(weather);
    results.push({ city: city.displayName, shockValue: index.shockValue });
    await new Promise(r => setTimeout(r, 300));
  }
  
  const danger = results.filter(r => r.shockValue >= 30);
  const high = results.filter(r => r.shockValue >= 20 && r.shockValue < 30);
  const medium = results.filter(r => r.shockValue >= 10 && r.shockValue < 20);
  const low = results.filter(r => r.shockValue < 10);
  
  const date = new Date();
  const dateStr = `${date.getMonth()+1}/${date.getDate()}`;
  
  let message = `🌡️💧 【全台皮膚濕度衝擊指數摘要】${dateStr}\n\n`;
  message += `🏠 室內基準：${INDOOR_TEMP}℃ / 濕度 = 室外 × ${INDOOR_HUM_RATIO}\n`;
  message += `📖 依據 Denda et al. (2002)\n\n`;
  message += `🔴 危險衝擊 (≥30%):\n${danger.length > 0 ? danger.map(c => c.city).join("、") : "無"}\n\n`;
  message += `🟠 高衝擊 (20-29%):\n${high.length > 0 ? high.map(c => c.city).join("、") : "無"}\n\n`;
  message += `🟡 中衝擊 (10-19%):\n${medium.length > 0 ? medium.map(c => c.city).join("、") : "無"}\n\n`;
  message += `🟢 低衝擊 (<10%):\n${low.length > 0 ? low.map(c => c.city).join("、") : "無"}\n\n`;
  message += `💡 查詢詳細：輸入城市代碼（1=臺北市, 2=新北市...）\n`;
  message += `🔔 訂閱每日提醒：輸入「加入訂閱」`;
  
  return message;
}

async function pushToSubscribers(message) {
  if (subscribers.length === 0) {
    console.log('📭 尚無訂閱用戶');
    return;
  }
  console.log(`📤 開始推播給 ${subscribers.length} 位訂閱用戶...`);
  for (const userId of subscribers) {
    try {
      await axios.post('https://api.line.me/v2/bot/message/push', {
        to: userId,
        messages: [{ type: 'text', text: message }]
      }, {
        headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
      });
      console.log(`✅ 推播成功: ${userId}`);
    } catch (err) {
      console.error(`❌ 推播失敗: ${userId}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

async function dailyPublishTask() {
  console.log(`\n📅 ===== 開始每日發布任務 =====`);
  const summary = await generateTaiwanSummaryText();
  await pushToSubscribers(summary);
  console.log(`✅ 每日發布任務完成\n`);
}

async function replyTextMessage(replyToken, text) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    }, {
      headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
    console.log('✅ 回復成功');
  } catch (err) {
    console.error('❌ 回復失敗:', err.response?.data || err.message);
  }
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
      const replyToken = event.replyToken;
      
      if (event.type === 'follow') {
        const userId = event.source.userId;
        if (!subscribers.includes(userId)) {
          subscribers.push(userId);
          saveSubscribers();
          console.log(`✅ 新用戶加入並自動訂閱: ${userId}`);
          await replyTextMessage(replyToken, 
            `🎉 歡迎加入【皮膚濕度衝擊指數】！

📋 已為您自動開啟每日提醒，每天上午 8:00 收到全台指數摘要。

📱 查詢方式：
• 輸入城市代碼（1=臺北市, 2=新北市...）
• 輸入「全台」查詢今日摘要

🔔 訂閱管理：
• 輸入「加入訂閱」開啟
• 輸入「取消訂閱」關閉

📖 依據 Denda et al. (2002) 國際期刊研究設計`);
        }
        continue;
      }
      
      if (event.type === 'unfollow') {
        const userId = event.source.userId;
        const index = subscribers.indexOf(userId);
        if (index !== -1) {
          subscribers.splice(index, 1);
          saveSubscribers();
          console.log(`❌ 用戶取消訂閱: ${userId}`);
        }
        continue;
      }
      
      if (event.type === 'message' && event.message.type === 'text') {
        const input = event.message.text.trim();
        const userId = event.source.userId;
        
        console.log(`📱 用戶輸入: "${input}"`);
        
        if (input === '取消訂閱') {
          const idx = subscribers.indexOf(userId);
          if (idx !== -1) {
            subscribers.splice(idx, 1);
            saveSubscribers();
            await replyTextMessage(replyToken, '✅ 已取消每日提醒！輸入「加入訂閱」可重新開啟。');
          } else {
            await replyTextMessage(replyToken, 'ℹ️ 您尚未訂閱，無需取消。');
          }
          continue;
        }
        
        if (input === '加入訂閱') {
          if (!subscribers.includes(userId)) {
            subscribers.push(userId);
            saveSubscribers();
            await replyTextMessage(replyToken, '✅ 訂閱成功！每天上午 8:00 收到全台指數摘要。');
          } else {
            await replyTextMessage(replyToken, 'ℹ️ 您已經是訂閱用戶囉！');
          }
          continue;
        }
        
        if (input === '全台' || input === 'ALL') {
          const summary = await generateTaiwanSummaryText();
          await replyTextMessage(replyToken, summary);
          continue;
        }
        
        // 城市查詢
        const upperInput = input.toUpperCase();
        const city = CITIES.find(c => c.code === upperInput);
        
        console.log(`🔍 比對: 輸入=${upperInput}, 找到=${city ? city.displayName : '無'}`);
        
        if (city) {
          const weather = await getWeather(city);
          const index = calculateIndex(weather);
          const message = generateTextMessage(city, weather, index);
          await replyTextMessage(replyToken, message);
        } else {
          await replyTextMessage(replyToken, 
            `📱 請輸入城市代碼查詢：

1=臺北市  2=新北市  3=基隆市
4=宜蘭縣  5=花蓮縣  6=臺東縣
7=屏東縣  8=高雄市  9=臺南市
A=雲林縣  B=嘉義縣  C=彰化縣
D=臺中市  E=南投縣  F=苗栗縣
G=桃園市  H=金門縣  I=澎湖縣

輸入「全台」查詢今日摘要
輸入「加入訂閱」開啟每日提醒（每天 08:00）`);
        }
      }
    }
  } catch (err) {
    console.error('處理錯誤:', err);
  }
});

app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    subscribers: subscribers.length,
    indoorTemp: INDOOR_TEMP,
    indoorHumRatio: INDOOR_HUM_RATIO
  });
});

// ==========================================
// 每日排程（台灣時間 8:00 = UTC 00:00）
// ==========================================
schedule.scheduleJob('0 0 * * *', () => {
  const now = new Date();
  console.log(`📅 執行每日推播 - UTC: ${now.toISOString()}`);
  dailyPublishTask();
});

console.log('📅 已設定每日推播：上午 8:00 (台灣時間)');

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`🏠 室內基準：${INDOOR_TEMP}℃ / 濕度 = 室外 × ${INDOOR_HUM_RATIO}`);
  console.log(`📅 每日推播：上午 8:00 (台灣時間)`);
  console.log(`========================================\n`);
});
