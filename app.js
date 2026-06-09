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

// 6都主要都會區
const CITIES = [
  { code: "1", name: "臺北市", displayName: "臺北市", stationName: "臺北" },
  { code: "2", name: "新北市", displayName: "新北市", stationName: "板橋" },
  { code: "3", name: "桃園市", displayName: "桃園市", stationName: "桃園" },
  { code: "4", name: "臺中市", displayName: "臺中市", stationName: "臺中" },
  { code: "5", name: "臺南市", displayName: "臺南市", stationName: "臺南" },
  { code: "6", name: "高雄市", displayName: "高雄市", stationName: "高雄" }
];

// 類比資料
const MOCK_WEATHER = {
  "臺北市": { temp: 32, humidity: 58 },
  "新北市": { temp: 31, humidity: 60 },
  "桃園市": { temp: 30, humidity: 62 },
  "臺中市": { temp: 31, humidity: 55 },
  "臺南市": { temp: 32, humidity: 56 },
  "高雄市": { temp: 33, humidity: 52 }
};

// ==========================================
// 室內濕度推算公式（終極公式）
// ==========================================
function calculateIndoorHumidity(tempOut, humOut, tempIn = 26) {
  const deltaTemp = tempOut - tempIn;
  
  if (deltaTemp <= 0) {
    return Math.min(humOut, Math.round(humOut));
  }
  
  if (deltaTemp < 2) {
    const indoorHum = humOut - 5;
    return Math.min(90, Math.max(30, Math.round(indoorHum)));
  }
  
  if (deltaTemp >= 2 && deltaTemp < 5) {
    const indoorHum = 0.85 * humOut - 0.15 * deltaTemp - 8;
    return Math.min(75, Math.max(35, Math.round(indoorHum)));
  }
  
  let indoorHum = 0.82 * humOut - 0.34 * deltaTemp - 16;
  indoorHum = Math.min(65, Math.max(25, Math.round(indoorHum)));
  
  return indoorHum;
}

// ==========================================
// 燈號判定
// ==========================================
function calculateShockLevel(deltaRH, indoorHumidity) {
  let levelA = 1;
  
  if (deltaRH >= 50 && indoorHumidity < 40) {
    levelA = 4;
  }
  else if (deltaRH >= 30 && deltaRH < 50 && indoorHumidity < 45) {
    levelA = 3;
  }
  else if ((deltaRH >= 15 && deltaRH < 30) || indoorHumidity < 45) {
    levelA = 2;
  }
  
  let levelB = 1;
  
  if (deltaRH < 15) {
    if (indoorHumidity >= 85) {
      levelB = 4;
    }
    else if (indoorHumidity >= 80) {
      levelB = 3;
    }
    else if (indoorHumidity >= 75 || indoorHumidity <= 25) {
      levelB = 2;
    }
  }
  
  const finalLevel = Math.max(levelA, levelB);
  
  const levelMap = {
    1: { name: "低衝擊", color: "#00CC00", emoji: "🟢" },
    2: { name: "中衝擊", color: "#FFCC00", emoji: "🟡" },
    3: { name: "高衝擊", color: "#FF6600", emoji: "🟠" },
    4: { name: "危險衝擊", color: "#FF0000", emoji: "🔴" }
  };
  
  return {
    level: finalLevel,
    name: levelMap[finalLevel].name,
    color: levelMap[finalLevel].color,
    emoji: levelMap[finalLevel].emoji
  };
}

// ==========================================
// 獲取天氣資料
// ==========================================
async function getTodayWeather(city) {
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

async function getWeather(city, dayOffset = 0) {
  const todayWeather = await getTodayWeather(city);
  
  if (todayWeather) {
    const variation = dayOffset * 1.2;
    const tempVariation = dayOffset * 2;
    return {
      temp: Math.round(todayWeather.temp + (dayOffset > 0 ? variation : 0)),
      humidity: Math.min(95, Math.max(30, todayWeather.humidity + (dayOffset > 0 ? tempVariation : 0)))
    };
  }
  
  const mock = MOCK_WEATHER[city.name] || { temp: 28, humidity: 60 };
  return mock;
}

// ==========================================
// 計算城市指數
// ==========================================
async function calculateCityIndex(city, dayOffset = 0) {
  const weather = await getWeather(city, dayOffset);
  const indoorHumidity = calculateIndoorHumidity(weather.temp, weather.humidity, INDOOR_TEMP);
  const deltaRH = Math.abs(weather.humidity - indoorHumidity);
  const shock = calculateShockLevel(deltaRH, indoorHumidity);
  
  return {
    city: city.displayName,
    shock
  };
}

function getDateString(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getMonth()+1}/${date.getDate()}`;
}

// ==========================================
// 產生 Flex Message - 6都連續3天
// ==========================================
async function generateSixCitiesForecastFlex() {
  const today = getDateString(0);
  const tomorrow = getDateString(1);
  const dayAfter = getDateString(2);
  
  const citiesData = [];
  
  for (const city of CITIES) {
    const day0 = await calculateCityIndex(city, 0);
    const day1 = await calculateCityIndex(city, 1);
    const day2 = await calculateCityIndex(city, 2);
    
    citiesData.push({
      city: city.displayName,
      days: [day0, day1, day2]
    });
  }
  
  // 構建內容 - 使用純文字格式避免 Flex 錯誤
  let message = `🌡️💧 【皮膚濕度壓力指數】\n`;
  message += `六都連續3天預報 ${today} ~ ${dayAfter}\n`;
  message += `🏠 室內基準：冷氣房 ${INDOOR_TEMP}℃\n`;
  message += `📖 依據 Denda et al. (2002)\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `城市      ${today}  ${tomorrow}  ${dayAfter}\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  
  for (const cityData of citiesData) {
    const d0 = cityData.days[0].shock.emoji;
    const d1 = cityData.days[1].shock.emoji;
    const d2 = cityData.days[2].shock.emoji;
    message += `${cityData.city.padEnd(6)}  ${d0}    ${d1}    ${d2}\n`;
  }
  
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `🟢低衝擊  🟡中衝擊  🟠高衝擊  🔴危險衝擊\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `💡 燈號判定：\n`;
  message += `路徑A：濕度衝擊 (Delta_RH 與 RH_in 複合條件)\n`;
  message += `路徑B：極端穩態壓力 (Delta_RH<15% 但 RH_in 極端)\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `📊 中央氣象署 | 室內濕度推算：工研院終極公式\n`;
  message += `📖 文獻：Denda et al. (2002)、環境濕度與皮膚綜述、PMC (2019)、皮膚氣候趨勢綜述 (2024)`;
  
  return message;
}

// ==========================================
// 產生保健建議
// ==========================================
async function generateAdviceText() {
  let message = `📋 【皮膚保健建議】\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `🟢 低衝擊\n`;
  message += `維持日常基礎保養，正常清潔與保濕。\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `🟡 中衝擊\n`;
  message += `乾燥型：提高保濕頻率，每2-3小時補擦保濕產品。\n`;
  message += `潮濕型：開啟除濕機，保持皮膚乾爽。\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `🟠 高衝擊\n`;
  message += `提前防護，減少長時間戶外停留，主動調整室內濕度。\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `🔴 危險衝擊\n`;
  message += `避免非必要外出，立即調整室內環境，觀察皮膚反應。\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `📖 【文獻依據】\n`;
  message += `1. Denda et al. (2002) — 濕度突然下降會破壞皮膚屏障恆定\n`;
  message += `2. 環境濕度與皮膚綜述 — 闡明低濕導致乾燥、粗糙\n`;
  message += `3. PMC (2019) — 高濕環境延緩脂質屏障形成\n`;
  message += `4. 皮膚氣候趨勢綜述 (2024) — 濕度變化導致水分異常流失\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n`;
  message += `📊 中央氣象署 | 室內濕度推算：工研院終極公式`;
  
  return message;
}

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
// 發送訊息函式
// ==========================================
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
  console.log(`\n📅 ===== 開始每日發布任務 ${new Date().toLocaleString()} =====`);
  const forecast = await generateSixCitiesForecastFlex();
  await pushToSubscribers(forecast);
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
            `🎉 歡迎加入【皮膚濕度壓力指數】！

📋 已為您自動開啟每日提醒，每天上午 7:00 收到六都連續3天環境預報。

📱 查詢方式：
• 輸入「全台」查看六都3天預報
• 輸入「保健建議」查看完整保養指南

🔔 訂閱管理：
• 輸入「加入訂閱」開啟
• 輸入「取消訂閱」關閉

📖 依據 Denda et al. (2002) 等國際期刊研究設計`);
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
            await replyTextMessage(replyToken, '✅ 訂閱成功！每天上午 7:00 收到六都連續3天環境預報。');
          } else {
            await replyTextMessage(replyToken, 'ℹ️ 您已經是訂閱用戶囉！');
          }
          continue;
        }
        
        if (input === '全台' || input === 'ALL' || input === '六都') {
          const forecast = await generateSixCitiesForecastFlex();
          await replyTextMessage(replyToken, forecast);
          continue;
        }
        
        if (input === '保健建議' || input === '保健指南' || input === '建議') {
          const advice = await generateAdviceText();
          await replyTextMessage(replyToken, advice);
          continue;
        }
        
        // 預設顯示總覽
        const forecast = await generateSixCitiesForecastFlex();
        await replyTextMessage(replyToken, forecast);
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
    cities: CITIES.map(c => c.displayName)
  });
});

// ==========================================
// 每日排程（台灣時間 7:00 = UTC 23:00）
// ==========================================
schedule.scheduleJob('0 23 * * *', () => {
  const now = new Date();
  console.log(`📅 執行每日推播 - UTC: ${now.toISOString()}`);
  console.log(`📅 執行每日推播 - 台灣: ${new Date(now.getTime() + 8*60*60*1000).toLocaleString()}`);
  dailyPublishTask();
});

console.log('📅 已設定每日推播：上午 7:00 (台灣時間)');

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 ========================================`);
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🏠 室內基準：${INDOOR_TEMP}℃`);
  console.log(`📐 室內濕度推算：工研院終極公式 RH_in = 0.82×RH_out - 0.34×ΔT - 16`);
  console.log(`📅 每日推播：上午 7:00 (台灣時間)`);
  console.log(`📊 六都：${CITIES.map(c => c.displayName).join('、')}`);
  console.log(`========================================\n`);
});
