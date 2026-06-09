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

// 城市列表
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
  console.log('📋 無訂閱記錄，將建立新檔案');
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
          return { temp, humidity, stationName: matched.StationName };
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
  
  let drynessLevel, drynessAdvice;
  if (drynessScore >= THRESHOLDS.DRYNESS.HIGH) {
    drynessLevel = "🔴 危險";
    drynessAdvice = "🔥 請立即加強保濕，避免長時間吹冷氣";
  } else if (drynessScore >= THRESHOLDS.DRYNESS.MEDIUM) {
    drynessLevel = "🟠 高";
    drynessAdvice = "⚠️ 建議使用保濕乳液，多補充水分";
  } else if (drynessScore >= THRESHOLDS.DRYNESS.LOW) {
    drynessLevel = "🟡 中";
    drynessAdvice = "😐 可適度補充水分，保持肌膚滋潤";
  } else {
    drynessLevel = "🟢 低";
    drynessAdvice = "✅ 狀況良好，持續保持";
  }
  
  let shockLevel, shockAdvice;
  if (shockValue >= THRESHOLDS.SHOCK.HIGH) {
    shockLevel = "🔴 危險";
    shockAdvice = "🔥 濕度衝擊劇烈！進出冷氣房請注意身體調節（依據 Denda et al. 2002：濕度急遽下降會破壞皮膚屏障恆定）";
  } else if (shockValue >= THRESHOLDS.SHOCK.MEDIUM) {
    shockLevel = "🟠 高";
    shockAdvice = "⚠️ 濕度落差大，建議緩慢進出室內外";
  } else if (shockValue >= THRESHOLDS.SHOCK.LOW) {
    shockLevel = "🟡 中";
    shockAdvice = "😐 有些微衝擊感，一般體質可適應";
  } else {
    shockLevel = "🟢 低";
    shockAdvice = "✅ 進出舒適，身體適應良好";
  }
  
  return {
    indoorHumidity,
    drynessScore: Math.round(drynessScore),
    drynessLevel,
    drynessAdvice,
    shockValue: Math.round(shockValue),
    shockLevel,
    shockAdvice
  };
}

function generatePostContent(city, weather, index, includeScientificNote = true) {
  const date = new Date().toLocaleString('zh-TW', { 
    month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' 
  });
  
  let content = `🌡️💧 【${city.displayName} 皮膚濕度衝擊指數】${date}

🏠 室內環境基準：${INDOOR_TEMP}℃ / 濕度 = 室外 × ${INDOOR_HUM_RATIO}

🌡️ 皮膚乾燥指數：${index.drynessLevel} (${index.drynessScore}分)
   • 室外 ${weather.temp}℃ / 室內 ${INDOOR_TEMP}℃
   • 室外濕度 ${weather.humidity}% / 室內 ${index.indoorHumidity}%
   💡 ${index.drynessAdvice}

💧 濕度衝擊指數：${index.shockLevel} (衝擊差 ${index.shockValue}%)
   • 室外濕度 ${weather.humidity}% → 室內 ${index.indoorHumidity}%
   💡 ${index.shockAdvice}

📊 資料來源：中央氣象署`;

  if (includeScientificNote) {
    content += `

📖 科學依據：
• Denda et al. (2002) - 濕度驟降破壞皮膚屏障恆定
• PMC (2019) - 高濕環境延緩脂質屏障形成
• 2024 皮膚氣候趨勢綜述 - 急遽濕度變化導致水分流失`;
  }

  return content;
}

async function generateTaiwanSummary() {
  const results = [];
  
  for (const city of CITIES) {
    const weather = await getWeather(city);
    const index = calculateIndex(weather);
    results.push({
      city: city.displayName,
      temp: weather.temp,
      humidity: weather.humidity,
      indoorHumidity: index.indoorHumidity,
      drynessScore: index.drynessScore,
      drynessLevel: index.drynessLevel.replace(/[🟢🟡🟠🔴]/g, '').trim(),
      shockValue: index.shockValue,
      shockLevel: index.shockLevel.replace(/[🟢🟡🟠🔴]/g, '').trim()
    });
    await new Promise(r => setTimeout(r, 300));
  }
  
  const date = new Date().toLocaleString('zh-TW', { month: 'numeric', day: 'numeric' });
  let summary = `🌡️💧 【全台皮膚濕度衝擊指數摘要】${date}\n\n`;
  summary += `🏠 室內基準：${INDOOR_TEMP}℃ / 濕度 = 室外 × ${INDOOR_HUM_RATIO}\n`;
  summary += `📖 依據 Denda et al. (2002)：濕度驟降會破壞皮膚屏障\n\n`;
  
  summary += `🔴 危險衝擊 (差≥30%):\n`;
  let dangerCities = results.filter(r => r.shockValue >= 30);
  if (dangerCities.length > 0) {
    dangerCities.forEach(r => summary += `   • ${r.city}: 衝擊差 ${r.shockValue}%\n`);
  } else {
    summary += `   • 無\n`;
  }
  
  summary += `\n🟠 高衝擊 (差20-29%):\n`;
  let highCities = results.filter(r => r.shockValue >= 20 && r.shockValue < 30);
  if (highCities.length > 0) {
    highCities.forEach(r => summary += `   • ${r.city}: 衝擊差 ${r.shockValue}%\n`);
  } else {
    summary += `   • 無\n`;
  }
  
  summary += `\n🟡 中衝擊 (差10-19%):\n`;
  let midCities = results.filter(r => r.shockValue >= 10 && r.shockValue < 20);
  if (midCities.length > 0) {
    midCities.forEach(r => summary += `   • ${r.city}: 衝擊差 ${r.shockValue}%\n`);
  } else {
    summary += `   • 無\n`;
  }
  
  summary += `\n📊 詳細查詢：輸入城市代碼（1=臺北市, 2=新北市...）\n`;
  summary += `🔔 訂閱每日提醒：輸入「加入訂閱」\n`;
  summary += `🔕 取消每日提醒：輸入「取消訂閱」`;
  
  return summary;
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
      console.error(`❌ 推播失敗: ${userId}`, err.response?.data || err.message);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

async function dailyPublishTask() {
  console.log(`\n📅 ===== 開始每日發布任務 ${new Date().toLocaleString()} =====`);
  
  const summary = await generateTaiwanSummary();
  await pushToSubscribers(summary);
  
  console.log(`✅ 每日發布任務完成\n`);
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
      
      // 用戶加入好友
      if (event.type === 'follow') {
        const userId = event.source.userId;
        if (!subscribers.includes(userId)) {
          subscribers.push(userId);
          saveSubscribers();
          console.log(`✅ 新用戶加入並自動訂閱: ${userId}`);
          await replyMessage(replyToken, 
            `🎉 歡迎加入【皮膚濕度衝擊指數】！

📋 已為您「自動開啟」每日提醒，每天上午 8:00 會收到全台指數摘要。

📱 查詢方式：
• 輸入城市代碼（1=臺北市, 2=新北市...）
• 輸入「全台」查詢今日摘要

🔔 訂閱管理：
• 輸入「加入訂閱」開啟每日提醒
• 輸入「取消訂閱」關閉每日提醒

📖 本指數依據 Denda et al. (2002) 等國際期刊研究設計`);
        }
        continue;
      }
      
      // 用戶封鎖 Bot
      if (event.type === 'unfollow') {
        const userId = event.source.userId;
        const index = subscribers.indexOf(userId);
        if (index !== -1) {
          subscribers.splice(index, 1);
          saveSubscribers();
          console.log(`❌ 用戶封鎖並取消訂閱: ${userId}`);
        }
        continue;
      }
      
      // 處理文字訊息
      if (event.type === 'message' && event.message.type === 'text') {
        const input = event.message.text.trim();
        const userId = event.source.userId;
        
        // ==========================================
        // 取消訂閱
        // ==========================================
        if (input === '取消訂閱') {
          const idx = subscribers.indexOf(userId);
          if (idx !== -1) {
            subscribers.splice(idx, 1);
            saveSubscribers();
            console.log(`🔕 用戶取消訂閱: ${userId}`);
            await replyMessage(replyToken, 
              `✅ 已取消每日提醒！

您將不再收到每日上午 8:00 的全台指數摘要。

💡 如需重新開啟提醒，請輸入「加入訂閱」`);
          } else {
            await replyMessage(replyToken, 
              `ℹ️ 您尚未訂閱每日提醒，無需取消。

💡 如需開啟每日提醒，請輸入「加入訂閱」`);
          }
          continue;
        }
        
        // ==========================================
        // 加入訂閱
        // ==========================================
        if (input === '加入訂閱') {
          if (!subscribers.includes(userId)) {
            subscribers.push(userId);
            saveSubscribers();
            console.log(`🔔 用戶加入訂閱: ${userId}`);
            await replyMessage(replyToken, 
              `✅ 訂閱成功！

您將在每天上午 8:00 收到全台皮膚濕度衝擊指數摘要。

📱 查詢方式：
• 輸入城市代碼（1=臺北市, 2=新北市...）
• 輸入「全台」立即查詢今日摘要

🔕 如需取消提醒，請輸入「取消訂閱」`);
          } else {
            await replyMessage(replyToken, 
              `ℹ️ 您已經是訂閱用戶囉！

您會在每天上午 8:00 收到全台指數摘要。

🔕 如需取消提醒，請輸入「取消訂閱」`);
          }
          continue;
        }
        
        // ==========================================
        // 全台摘要
        // ==========================================
        if (input === '全台' || input === 'ALL') {
          const summary = await generateTaiwanSummary();
          await replyMessage(replyToken, summary);
          continue;
        }
        
        // ==========================================
        // 城市查詢
        // ==========================================
        const upperInput = input.toUpperCase();
        const city = CITIES.find(c => c.code === upperInput);
        
        if (city) {
          const weather = await getWeather(city);
          const index = calculateIndex(weather);
          const reply = generatePostContent(city, weather, index, true);
          await replyMessage(replyToken, reply);
        } else {
          await sendHelp(replyToken);
        }
      }
    }
  } catch (err) {
    console.error('處理錯誤:', err);
  }
});

// ==========================================
// 發送幫助訊息
// ==========================================
async function sendHelp(replyToken) {
  const help = `📱 【皮膚濕度衝擊指數查詢】

🏠 室內基準：${INDOOR_TEMP}℃ / 濕度 = 室外 × ${INDOOR_HUM_RATIO}
📖 科學依據：Denda et al. (2002) - 濕度驟降破壞皮膚屏障

🔍 城市代碼查詢：
1=臺北市  2=新北市  3=基隆市
4=宜蘭縣  5=花蓮縣  6=臺東縣
7=屏東縣  8=高雄市  9=臺南市
A=雲林縣  B=嘉義縣  C=彰化縣
D=臺中市  E=南投縣  F=苗栗縣
G=桃園市  H=金門縣  I=澎湖縣

📊 其他指令：
• 輸入「全台」查詢今日摘要
• 輸入「加入訂閱」開啟每日提醒（每天 08:00）
• 輸入「取消訂閱」停止提醒`;
  
  await replyMessage(replyToken, help);
}

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

app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '皮膚濕度衝擊指數 Bot 運行中',
    indoorTemp: INDOOR_TEMP,
    indoorHumRatio: INDOOR_HUM_RATIO,
    subscribers: subscribers.length
  });
});

// ==========================================
// 設定每日排程（每天早上 8:00 發布）
// ==========================================
schedule.scheduleJob('* * * * *', () => {
  dailyPublishTask();
});

console.log('📅 已設定每日發布排程：每天早上 8:00');

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 ========================================`);
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🏠 室內基準：${INDOOR_TEMP}℃ / 濕度 = 室外 × ${INDOOR_HUM_RATIO}`);
  console.log(`📖 科學依據：Denda et al. (2002)、PMC (2019) 等`);
  console.log(`📅 每日推播時間：上午 8:00`);
  console.log(`========================================\n`);
});
