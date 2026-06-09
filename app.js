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

// 室內溫度固定為 26℃
const INDOOR_TEMP = 26;

// 6都主要都會區
const CITIES = [
  { code: "1", name: "臺北市", displayName: "臺北市", apiName: "臺北市" },
  { code: "2", name: "新北市", displayName: "新北市", apiName: "新北市" },
  { code: "3", name: "桃園市", displayName: "桃園市", apiName: "桃園市" },
  { code: "4", name: "臺中市", displayName: "臺中市", apiName: "臺中市" },
  { code: "5", name: "臺南市", displayName: "臺南市", apiName: "臺南市" },
  { code: "6", name: "高雄市", displayName: "高雄市", apiName: "高雄市" }
];

// ==========================================
// 從中央氣象署預報 API 獲取天氣（F-D0047-089）
// ==========================================
async function getForecastWeather(city, dateOffset = 0) {
  try {
    const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-089?Authorization=${CWA_API_KEY}&format=JSON&LocationName=${encodeURIComponent(city.apiName)}`;
    
    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;
    
    if (data.success === "true" && data.records?.Locations?.[0]?.Location) {
      const locations = data.records.Locations[0].Location;
      const targetLocation = locations.find(l => l.LocationName === city.apiName);
      
      if (targetLocation && targetLocation.WeatherElement) {
        const tempElem = targetLocation.WeatherElement.find(w => w.ElementName === "平均溫度");
        const humElem = targetLocation.WeatherElement.find(w => w.ElementName === "平均相對濕度");
        
        if (tempElem?.Time && humElem?.Time) {
          const timeIndex = Math.min(dateOffset, tempElem.Time.length - 1);
          const tempData = tempElem.Time[timeIndex]?.ElementValue?.[0]?.value;
          const humData = humElem.Time[timeIndex]?.ElementValue?.[0]?.value;
          
          if (tempData && humData) {
            return {
              temp: Math.round(parseFloat(tempData)),
              humidity: Math.round(parseFloat(humData))
            };
          }
        }
      }
    }
    return null;
  } catch (error) {
    console.error(`❌ ${city.displayName} 預報API錯誤:`, error.message);
    return null;
  }
}

// 備用：即時觀測 API
async function getCurrentWeather(city) {
  try {
    const stationMap = {
      "臺北市": "臺北",
      "新北市": "板橋",
      "桃園市": "桃園",
      "臺中市": "臺中",
      "臺南市": "臺南",
      "高雄市": "高雄"
    };
    const stationName = stationMap[city.name];
    
    const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?Authorization=${CWA_API_KEY}&format=JSON`;
    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;
    
    if (data.success === "true" && data.records?.Station) {
      const matched = data.records.Station.find(s => s.StationName === stationName);
      if (matched && matched.WeatherElement) {
        return {
          temp: Math.round(parseFloat(matched.WeatherElement.AirTemperature)),
          humidity: Math.round(parseFloat(matched.WeatherElement.RelativeHumidity))
        };
      }
    }
    return null;
  } catch (error) {
    console.error(`❌ ${city.displayName} 即時API錯誤:`, error.message);
    return null;
  }
}

async function getWeather(city, dateOffset = 0) {
  let weather = await getForecastWeather(city, dateOffset);
  
  if (!weather && dateOffset === 0) {
    weather = await getCurrentWeather(city);
  }
  
  if (!weather) {
    const mockData = {
      "臺北市": { temp: 32, humidity: 58 },
      "新北市": { temp: 31, humidity: 60 },
      "桃園市": { temp: 30, humidity: 62 },
      "臺中市": { temp: 31, humidity: 55 },
      "臺南市": { temp: 32, humidity: 56 },
      "高雄市": { temp: 33, humidity: 52 }
    };
    weather = mockData[city.name] || { temp: 28, humidity: 60 };
    console.log(`📦 使用類比資料: ${city.displayName}`);
  }
  
  return weather;
}

// ==========================================
// 室內濕度推算公式（終極公式）
// ==========================================
function calculateIndoorHumidity(tempOut, humOut) {
  const deltaTemp = tempOut - INDOOR_TEMP;
  
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
// 計算城市指數
// ==========================================
async function calculateCityIndex(city, dateOffset = 0) {
  const weather = await getWeather(city, dateOffset);
  const indoorHumidity = calculateIndoorHumidity(weather.temp, weather.humidity);
  const deltaRH = Math.abs(weather.humidity - indoorHumidity);
  const shock = calculateShockLevel(deltaRH, indoorHumidity);
  
  return {
    city: city.displayName,
    tempOut: weather.temp,
    humOut: weather.humidity,
    indoorHumidity,
    deltaRH,
    shock
  };
}

function getDateString(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getMonth()+1}/${date.getDate()}`;
}

// ==========================================
// 第一頁：Flex Message - 6都連續3天圖示表格
// ==========================================
async function generatePage1Flex() {
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
  
  // 表格行
  const tableRows = [];
  
  tableRows.push({
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: "城市", weight: "bold", size: "sm", flex: 2 },
      { type: "text", text: today, weight: "bold", size: "sm", flex: 1, align: "center" },
      { type: "text", text: tomorrow, weight: "bold", size: "sm", flex: 1, align: "center" },
      { type: "text", text: dayAfter, weight: "bold", size: "sm", flex: 1, align: "center" }
    ]
  });
  
  tableRows.push({ type: "separator", margin: "sm" });
  
  for (const cityData of citiesData) {
    tableRows.push({
      type: "box",
      layout: "horizontal",
      contents: [
        { type: "text", text: cityData.city, size: "sm", flex: 2 },
        { type: "text", text: cityData.days[0].shock.emoji, size: "sm", flex: 1, align: "center", color: cityData.days[0].shock.color },
        { type: "text", text: cityData.days[1].shock.emoji, size: "sm", flex: 1, align: "center", color: cityData.days[1].shock.color },
        { type: "text", text: cityData.days[2].shock.emoji, size: "sm", flex: 1, align: "center", color: cityData.days[2].shock.color }
      ]
    });
  }
  
  // 圖例
  const legendItems = [
    { emoji: "🟢", name: "低衝擊", color: "#00CC00" },
    { emoji: "🟡", name: "中衝擊", color: "#FFCC00" },
    { emoji: "🟠", name: "高衝擊", color: "#FF6600" },
    { emoji: "🔴", name: "危險衝擊", color: "#FF0000" }
  ];
  
  const legendBox = {
    type: "box",
    layout: "horizontal",
    contents: legendItems.map(item => ({
      type: "text",
      text: `${item.emoji} ${item.name}`,
      size: "xxs",
      color: item.color,
      flex: 1,
      align: "center"
    }))
  };
  
  return {
    type: "flex",
    altText: `🌡️💧 六都皮膚濕度壓力指數 ${today}~${dayAfter}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "🌡️💧 皮膚濕度壓力指數", weight: "bold", size: "xl", color: "#ffffff" },
          { type: "text", text: `六都連續3天預報 ${today} ~ ${dayAfter}`, size: "sm", color: "#dddddd", margin: "xs" }
        ],
        backgroundColor: "#667eea",
        paddingAll: "20px"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "🏠 室內基準", size: "xs", color: "#999999" },
              { type: "text", text: `冷氣房 ${INDOOR_TEMP}℃`, size: "xs", color: "#666666", align: "end" }
            ]
          },
          { type: "separator", margin: "md" },
          ...tableRows,
          { type: "separator", margin: "md" },
          legendBox,
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "💡 點擊下方按鈕查看詳細說明", size: "xs", color: "#999999", align: "center" }
            ]
          }
        ],
        paddingAll: "20px"
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "button", style: "primary", color: "#667eea", action: { type: "message", label: "📋 查看詳細說明", text: "詳細說明" } }
        ],
        paddingAll: "12px"
      }
    }
  };
}

// ==========================================
// 第二頁：Flex Message - 文字說明 + 用戶指令
// ==========================================
async function generatePage2Flex() {
  return {
    type: "flex",
    altText: "皮膚保健建議與使用說明",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "📋 使用說明與保健建議", weight: "bold", size: "xl", color: "#ffffff" }
        ],
        backgroundColor: "#667eea",
        paddingAll: "20px"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "🔍 查詢指令", weight: "bold", size: "sm" },
          { type: "text", text: "• 輸入「全台」查看六都3天預報", size: "xs", color: "#666666" },
          { type: "text", text: "• 輸入「詳細說明」查看本頁面", size: "xs", color: "#666666" },
          { type: "separator", margin: "md" },
          { type: "text", text: "🔔 訂閱管理", weight: "bold", size: "sm" },
          { type: "text", text: "• 輸入「加入訂閱」開啟每日推播", size: "xs", color: "#666666" },
          { type: "text", text: "• 輸入「取消訂閱」關閉每日推播", size: "xs", color: "#666666" },
          { type: "text", text: "• 每日推播時間：早上 7:00", size: "xs", color: "#666666" },
          { type: "separator", margin: "md" },
          { type: "text", text: "🟢 低衝擊", weight: "bold", size: "sm", color: "#00CC00" },
          { type: "text", text: "維持日常基礎保養，正常清潔與保濕。", size: "xs", color: "#666666" },
          { type: "text", text: "🟡 中衝擊", weight: "bold", size: "sm", color: "#FFCC00", margin: "md" },
          { type: "text", text: "乾燥型：提高保濕頻率，每2-3小時補擦保濕產品。", size: "xs", color: "#666666" },
          { type: "text", text: "潮濕型：開啟除濕機，保持皮膚乾爽。", size: "xs", color: "#666666" },
          { type: "text", text: "🟠 高衝擊", weight: "bold", size: "sm", color: "#FF6600", margin: "md" },
          { type: "text", text: "提前防護，減少長時間戶外停留，主動調整室內濕度。", size: "xs", color: "#666666" },
          { type: "text", text: "🔴 危險衝擊", weight: "bold", size: "sm", color: "#FF0000", margin: "md" },
          { type: "text", text: "避免非必要外出，立即調整室內環境，觀察皮膚反應。", size: "xs", color: "#666666" },
          { type: "separator", margin: "md" },
          { type: "text", text: "📖 燈號判定邏輯", weight: "bold", size: "sm" },
          { type: "text", text: "路徑A（濕度衝擊）：依據 Delta_RH 與 RH_in 複合條件", size: "xxs", color: "#999999" },
          { type: "text", text: "路徑B（極端穩態壓力）：Delta_RH < 15% 但 RH_in 極端", size: "xxs", color: "#999999" },
          { type: "separator", margin: "md" },
          { type: "text", text: "📖 文獻依據", weight: "bold", size: "sm" },
          { type: "text", text: "1. Denda et al. (2002) — 濕度突然下降會破壞皮膚屏障恆定", size: "xxs", color: "#999999" },
          { type: "text", text: "2. 環境濕度與皮膚綜述 — 闡明低濕導致乾燥、粗糙", size: "xxs", color: "#999999" },
          { type: "text", text: "3. PMC (2019) — 高濕環境延緩脂質屏障形成", size: "xxs", color: "#999999" },
          { type: "text", text: "4. 皮膚氣候趨勢綜述 (2024) — 濕度變化導致水分異常流失", size: "xxs", color: "#999999" }
        ],
        paddingAll: "20px"
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "separator" },
          { type: "text", text: "📊 中央氣象署 | 室內濕度推算：工研院終極公式", size: "xxs", color: "#999999", align: "center" },
          { type: "text", text: "💡 輸入「全台」開始查詢", size: "xxs", color: "#999999", align: "center" }
        ],
        paddingAll: "12px"
      }
    }
  };
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
async function pushToSubscribersFlex(message) {
  if (subscribers.length === 0) {
    console.log('📭 尚無訂閱用戶');
    return;
  }
  console.log(`📤 開始推播給 ${subscribers.length} 位訂閱用戶...`);
  for (const userId of subscribers) {
    try {
      await axios.post('https://api.line.me/v2/bot/message/push', {
        to: userId,
        messages: [message]
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
  
  const page1Flex = await generatePage1Flex();
  
  for (const userId of subscribers) {
    try {
      await axios.post('https://api.line.me/v2/bot/message/push', {
        to: userId,
        messages: [page1Flex]
      }, {
        headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
      });
      console.log(`✅ 推播成功: ${userId}`);
    } catch (err) {
      console.error(`❌ 推播失敗: ${userId}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`✅ 每日發布任務完成\n`);
}

async function replyFlexMessage(replyToken, flexMessage) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: [flexMessage]
    }, {
      headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
    console.log('✅ Flex Message 回復成功');
  } catch (err) {
    console.error('❌ Flex Message 回復失敗:', err.response?.data || err.message);
    await replyTextMessage(replyToken, "暫時無法顯示卡片，請稍後再試。");
  }
}

async function replyTextMessage(replyToken, text) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    }, {
      headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
    console.log('✅ 文字回復成功');
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
          
          // 發送兩頁訊息
          const page1 = await generatePage1Flex();
          const page2 = await generatePage2Flex();
          await replyFlexMessage(replyToken, page1);
          await new Promise(r => setTimeout(r, 500));
          await replyFlexMessage(replyToken, page2);
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
          const page1 = await generatePage1Flex();
          await replyFlexMessage(replyToken, page1);
          continue;
        }
        
        if (input === '詳細說明' || input === '說明' || input === '幫助' || input === 'help') {
          const page2 = await generatePage2Flex();
          await replyFlexMessage(replyToken, page2);
          continue;
        }
        
        // 預設顯示第一頁
        const page1 = await generatePage1Flex();
        await replyFlexMessage(replyToken, page1);
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
  console.log(`📡 天氣來源：中央氣象署 F-D0047-089 預報 API`);
  console.log(`📅 每日推播：上午 7:00 (台灣時間)`);
  console.log(`🎨 訊息格式：2頁 Flex Message (卡片式)`);
  console.log(`📊 六都：${CITIES.map(c => c.displayName).join('、')}`);
  console.log(`========================================\n`);
});
