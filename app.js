const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
app.use(express.json());

// ==========================================
// 啟用 CORS（允許網站跨域請求）
// ==========================================
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ==========================================
// ⚠️ 請填入你的金鑰 ⚠️
// ==========================================
const CHANNEL_ACCESS_TOKEN = 'FpYYGobL5CFc3u5lsVOEGfHTSEYHHiw7P3e25FD5MhqusbsANf98WzgO2eAvPXBSkcLFdA8uI5pjbAZ75WX/xIcmlNcjUEztbyBvT0f8Z9y6QgmS/F+EPNDkUgO2YsRBdpKhRv5J3Eh0PIfF6kt4QwdB04t89/1O/w1cDnyilFU=';
const CWA_API_KEY = 'CWA-B59372C7-9BD4-44F8-B759-D6ED723C6BC4';
// ==========================================

// GitHub 設定
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

// 檔案路徑定義
const SUBSCRIBERS_FILE = './subscribers.json';
const HUMIDITY_HISTORY_FILE = './humidity_history.json';
const GROUPS_FILE = './groups.json';

// 全域變數
let subscribers = [];
let groups = [];
let humidityHistory = {};

// 限制查詢頻率
let lastQueryTime = {};

// ==========================================
// 載入群組列表
// ==========================================
try {
  if (fs.existsSync(GROUPS_FILE)) {
    const data = fs.readFileSync(GROUPS_FILE, 'utf8');
    groups = JSON.parse(data);
    console.log(`📋 載入 ${groups.length} 個群組`);
  }
} catch(e) { }

function saveGroups() {
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2));
}

// ==========================================
// GitHub 同步訂閱資料
// ==========================================
async function syncToGitHub() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.log('⚠️ GitHub 未設定，跳過同步');
    return;
  }
  
  try {
    const content = fs.readFileSync(SUBSCRIBERS_FILE, 'utf8');
    const base64Content = Buffer.from(content).toString('base64');
    
    let sha = null;
    try {
      const fileRes = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/subscribers.json`, {
        headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
      });
      sha = fileRes.data.sha;
    } catch(e) { }
    
    await axios.put(`https://api.github.com/repos/${GITHUB_REPO}/contents/subscribers.json`, {
      message: `Update subscribers - ${new Date().toISOString()}`,
      content: base64Content,
      sha: sha
    }, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
    });
    console.log('✅ 訂閱資料已同步到 GitHub');
  } catch (err) {
    console.error('❌ GitHub 同步失敗:', err.message);
  }
}

async function loadFromGitHub() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.log('⚠️ GitHub 未設定，從本地載入');
    return;
  }
  
  try {
    const res = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/subscribers.json`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
    });
    const content = Buffer.from(res.data.content, 'base64').toString('utf8');
    subscribers = JSON.parse(content);
    console.log(`📋 從 GitHub 載入 ${subscribers.length} 位訂閱用戶`);
    fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2));
  } catch(e) {
    console.log('📋 GitHub 無訂閱資料，使用本地檔案');
    try {
      if (fs.existsSync(SUBSCRIBERS_FILE)) {
        subscribers = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8'));
        console.log(`📋 從本地載入 ${subscribers.length} 位訂閱用戶`);
      }
    } catch(err) {}
  }
}

function saveSubscribers() {
  fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2));
  if (GITHUB_TOKEN && GITHUB_REPO) {
    syncToGitHub().catch(err => console.error('GitHub 同步錯誤:', err.message));
  }
}

loadFromGitHub();

// ==========================================
// 室內環境設定
// ==========================================
const INDOOR_TEMP = 26;

const CITIES = [
  { code: "1", name: "臺北市", displayName: "臺北市", apiName: "臺北市" },
  { code: "2", name: "新北市", displayName: "新北市", apiName: "新北市" },
  { code: "3", name: "桃園市", displayName: "桃園市", apiName: "桃園市" },
  { code: "4", name: "臺中市", displayName: "臺中市", apiName: "臺中市" },
  { code: "5", name: "臺南市", displayName: "臺南市", apiName: "臺南市" },
  { code: "6", name: "高雄市", displayName: "高雄市", apiName: "高雄市" }
];

// ==========================================
// 濕度歷史紀錄
// ==========================================
try {
  if (fs.existsSync(HUMIDITY_HISTORY_FILE)) {
    const data = fs.readFileSync(HUMIDITY_HISTORY_FILE, 'utf8');
    humidityHistory = JSON.parse(data);
    console.log(`📋 載入濕度歷史紀錄`);
  }
} catch(e) { }

function saveHumidityHistory() {
  fs.writeFileSync(HUMIDITY_HISTORY_FILE, JSON.stringify(humidityHistory, null, 2));
}

function getPreviousDayHumidity(cityName) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getMonth()+1}/${yesterday.getDate()}`;
  return humidityHistory[cityName]?.[yesterdayStr] || null;
}

async function saveTodayHumidity(cityName, humidity) {
  const today = new Date();
  const todayStr = `${today.getMonth()+1}/${today.getDate()}`;
  if (!humidityHistory[cityName]) humidityHistory[cityName] = {};
  humidityHistory[cityName][todayStr] = humidity;
  saveHumidityHistory();
}

// ==========================================
// 中央氣象署 API
// ==========================================
async function getForecastWeather(city, dateOffset = 0) {
  console.log(`🌡️ 獲取 ${city.displayName} 預報 (offset=${dateOffset})...`);
  
  try {
    const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-089?Authorization=${CWA_API_KEY}&format=JSON&LocationName=${encodeURIComponent(city.apiName)}`;
    const response = await axios.get(url, { timeout: 15000 });
    const data = response.data;
    
    if (data.success !== "true") return null;
    
    const locations = data.records?.Locations;
    if (!locations) return null;
    
    let targetLocation = null;
    for (const locSet of locations) {
      if (locSet.Location) {
        for (const loc of locSet.Location) {
          if (loc.LocationName === city.apiName) {
            targetLocation = loc;
            break;
          }
        }
      }
      if (targetLocation) break;
    }
    
    if (!targetLocation) return null;
    
    const tempElem = targetLocation.WeatherElement?.find(w => w.ElementName === "溫度");
    const humElem = targetLocation.WeatherElement?.find(w => w.ElementName === "相對濕度");
    
    if (!tempElem || !humElem) return null;
    
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + dateOffset);
    const targetDateStr = targetDate.toISOString().split('T')[0];
    
    let tempValue = null, humValue = null;
    
    for (const t of tempElem.Time) {
      if (t.DataTime?.split('T')[0] === targetDateStr) {
        tempValue = t.ElementValue?.[0]?.Temperature;
        break;
      }
    }
    for (const h of humElem.Time) {
      if (h.DataTime?.split('T')[0] === targetDateStr) {
        humValue = h.ElementValue?.[0]?.RelativeHumidity;
        break;
      }
    }
    
    if (tempValue && humValue) {
      console.log(`   ✅ ${city.displayName}: ${tempValue}℃, ${humValue}%`);
      return {
        temp: Math.round(parseFloat(tempValue)),
        humidity: Math.round(parseFloat(humValue))
      };
    }
    return null;
  } catch (error) {
    console.error(`   ❌ ${city.displayName} API錯誤:`, error.message);
    return null;
  }
}

async function getCurrentWeather(city) {
  console.log(`🌡️ 獲取 ${city.displayName} 即時觀測...`);
  try {
    const stationMap = {
      "臺北市": "臺北", "新北市": "板橋", "桃園市": "桃園",
      "臺中市": "臺中", "臺南市": "臺南", "高雄市": "高雄"
    };
    const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?Authorization=${CWA_API_KEY}&format=JSON`;
    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;
    
    if (data.success === "true" && data.records?.Station) {
      const matched = data.records.Station.find(s => s.StationName === stationMap[city.name]);
      if (matched?.WeatherElement) {
        const temp = Math.round(parseFloat(matched.WeatherElement.AirTemperature));
        const humidity = Math.round(parseFloat(matched.WeatherElement.RelativeHumidity));
        console.log(`   ✅ ${city.displayName}: ${temp}℃, ${humidity}%`);
        return { temp, humidity };
      }
    }
    return null;
  } catch (error) {
    console.error(`   ❌ ${city.displayName} 即時API錯誤:`, error.message);
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
    console.log(`   📦 使用類比資料: ${city.displayName}`);
  }
  return weather;
}

// ==========================================
// 室內濕度與燈號計算
// ==========================================
function calculateIndoorHumidity(tempOut, humOut) {
  const deltaTemp = tempOut - INDOOR_TEMP;
  if (deltaTemp <= 0) return Math.min(humOut, Math.round(humOut));
  if (deltaTemp < 2) return Math.min(90, Math.max(30, Math.round(humOut - 5)));
  if (deltaTemp >= 2 && deltaTemp < 5) return Math.min(75, Math.max(35, Math.round(0.85 * humOut - 0.15 * deltaTemp - 8)));
  let indoorHum = 0.82 * humOut - 0.34 * deltaTemp - 16;
  return Math.min(65, Math.max(25, Math.round(indoorHum)));
}

function calculateShockLevel(deltaRH, indoorHumidity) {
  let levelA = 1;
  if (deltaRH >= 50 && indoorHumidity < 40) levelA = 4;
  else if (deltaRH >= 30 && deltaRH < 50 && indoorHumidity < 45) levelA = 3;
  else if ((deltaRH >= 15 && deltaRH < 30) || indoorHumidity < 45) levelA = 2;
  
  let levelB = 1;
  if (deltaRH < 15) {
    if (indoorHumidity >= 85) levelB = 4;
    else if (indoorHumidity >= 80) levelB = 3;
    else if (indoorHumidity >= 75 || indoorHumidity <= 25) levelB = 2;
  }
  
  const finalLevel = Math.max(levelA, levelB);
  const levelMap = { 
    1: { name: "低衝擊", color: "#00CC00", emoji: "🟢" }, 
    2: { name: "中衝擊", color: "#FFCC00", emoji: "🟡" }, 
    3: { name: "高衝擊", color: "#FF6600", emoji: "🟠" }, 
    4: { name: "危險衝擊", color: "#FF0000", emoji: "🔴" } 
  };
  return { level: finalLevel, name: levelMap[finalLevel].name, color: levelMap[finalLevel].color, emoji: levelMap[finalLevel].emoji };
}

function calculateDailyIndex(weather, prevHumidity) {
  const indoorHumidity = calculateIndoorHumidity(weather.temp, weather.humidity);
  let deltaRH = 0;
  if (prevHumidity !== null && prevHumidity > 0) deltaRH = Math.abs(weather.humidity - prevHumidity);
  const shock = calculateShockLevel(deltaRH, indoorHumidity);
  return { tempOut: weather.temp, humOut: weather.humidity, indoorHumidity, deltaRH, shock };
}

async function calculateCityThreeDays(city) {
  const weather0 = await getWeather(city, 0);
  const weather1 = await getWeather(city, 1);
  const weather2 = await getWeather(city, 2);
  const yesterdayHumidity = getPreviousDayHumidity(city.name);
  const day0 = calculateDailyIndex(weather0, yesterdayHumidity);
  const day1 = calculateDailyIndex(weather1, weather0.humidity);
  const day2 = calculateDailyIndex(weather2, weather1.humidity);
  await saveTodayHumidity(city.name, weather0.humidity);
  console.log(`📊 ${city.displayName}: ${day0.shock.emoji} ${day1.shock.emoji} ${day2.shock.emoji}`);
  return { city: city.displayName, days: [day0, day1, day2] };
}

function getDateString(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getMonth()+1}/${date.getDate()}`;
}

// ==========================================
// 第一頁：Flex Message（6都預報表格）
// ==========================================
async function generatePage1Flex() {
  const today = getDateString(0);
  const tomorrow = getDateString(1);
  const dayAfter = getDateString(2);
  const citiesData = [];
  
  for (const city of CITIES) {
    citiesData.push(await calculateCityThreeDays(city));
  }
  
  const tableRows = [
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "城市", weight: "bold", size: "md", flex: 2 },
      { type: "text", text: today, weight: "bold", size: "md", flex: 1, align: "center" },
      { type: "text", text: tomorrow, weight: "bold", size: "md", flex: 1, align: "center" },
      { type: "text", text: dayAfter, weight: "bold", size: "md", flex: 1, align: "center" }
    ]},
    { type: "separator", margin: "sm" }
  ];
  
  for (const cityData of citiesData) {
    tableRows.push({
      type: "box", layout: "horizontal", contents: [
        { type: "text", text: cityData.city, size: "md", flex: 2 },
        { type: "text", text: cityData.days[0].shock.emoji, size: "md", flex: 1, align: "center", color: cityData.days[0].shock.color },
        { type: "text", text: cityData.days[1].shock.emoji, size: "md", flex: 1, align: "center", color: cityData.days[1].shock.color },
        { type: "text", text: cityData.days[2].shock.emoji, size: "md", flex: 1, align: "center", color: cityData.days[2].shock.color }
      ]
    });
  }
  
  return {
    type: "flex",
    altText: `🌡️💧 皮膚濕度壓力指數 ${today}~${dayAfter}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "🌡️💧 皮膚濕度壓力指數", weight: "bold", size: "lg", color: "#ffffff" },
          { type: "text", text: `預報日期 ${today} ~ ${dayAfter}`, size: "sm", color: "#dddddd", margin: "xs" }
        ],
        backgroundColor: "#667eea",
        paddingAll: "20px"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          ...tableRows,
          { type: "separator", margin: "md" },
          { type: "box", layout: "horizontal", contents: [
            { type: "text", text: "🟢 低衝擊", size: "sm", color: "#00CC00", flex: 1, align: "center" },
            { type: "text", text: "🟡 中衝擊", size: "sm", color: "#FFCC00", flex: 1, align: "center" }
          ]},
          { type: "box", layout: "horizontal", contents: [
            { type: "text", text: "🟠 高衝擊", size: "sm", color: "#FF6600", flex: 1, align: "center" },
            { type: "text", text: "🔴 危險衝擊", size: "sm", color: "#FF0000", flex: 1, align: "center" }
          ]}
        ],
        paddingAll: "20px"
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "xs",
        contents: [
          { type: "separator" },
          { type: "text", text: "🏠 室內基準溫度：冷氣房 26℃", size: "sm", color: "#999999", align: "center" },
          { type: "text", text: "📊 數據來源：中央氣象署", size: "sm", color: "#999999", align: "center" },
          { type: "button", style: "primary", height: "sm", action: { type: "message", label: "📋 查看燈號說明及建議", text: "詳細說明" }, margin: "md", color: "#667eea" }
        ],
        paddingAll: "12px"
      }
    }
  };
}

// ==========================================
// 第二頁：完整使用說明與保健建議
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
          { type: "text", text: "📋 使用說明與保健建議", weight: "bold", size: "lg", color: "#ffffff" }
        ],
        backgroundColor: "#667eea",
        paddingAll: "20px"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "🚦 燈號意義", weight: "bold", size: "md" },
          { type: "text", text: "🟢 低衝擊", weight: "bold", size: "sm", color: "#00CC00" },
          { type: "text", text: "濕度穩定且介於理想範圍，皮膚屏障無顯著壓力", size: "sm", color: "#666666", wrap: true },
          { type: "text", text: "🟡 中衝擊", weight: "bold", size: "sm", color: "#FFCC00", margin: "xs" },
          { type: "text", text: "濕度變化 15-30% 或室內濕度 <45% / ≥75%", size: "sm", color: "#666666", wrap: true },
          { type: "text", text: "🟠 高衝擊", weight: "bold", size: "sm", color: "#FF6600", margin: "xs" },
          { type: "text", text: "濕度變化 30-50% 且室內濕度 <45%", size: "sm", color: "#666666", wrap: true },
          { type: "text", text: "🔴 危險衝擊", weight: "bold", size: "sm", color: "#FF0000", margin: "xs" },
          { type: "text", text: "濕度變化 ≥50% 且室內濕度 <40% 或室內濕度 ≥85%", size: "sm", color: "#666666", wrap: true },
          { type: "separator", margin: "md" },
          
          { type: "text", text: "💡 保健建議", weight: "bold", size: "md" },
          { type: "text", text: "🟢 低衝擊：維持日常基礎保養", size: "sm", color: "#666666", wrap: true },
          { type: "text", text: "🟡 中衝擊：乾燥型加強保濕／潮濕型開啟除濕", size: "sm", color: "#666666", wrap: true },
          { type: "text", text: "🟠 高衝擊：減少戶外停留，主動調整室內濕度", size: "sm", color: "#666666", wrap: true },
          { type: "text", text: "🔴 危險衝擊：避免外出，立即調整環境", size: "sm", color: "#666666", wrap: true },
          { type: "separator", margin: "md" },
          
          { type: "text", text: "🔍 查詢指令", weight: "bold", size: "md" },
          { type: "text", text: "• 輸入「全台」查看六都3天預報", size: "sm", color: "#666666", wrap: true },
          { type: "text", text: "• 輸入「詳細說明」查看本頁面", size: "sm", color: "#666666", wrap: true },
          { type: "separator", margin: "md" },
          
          { type: "text", text: "🔔 訂閱管理", weight: "bold", size: "md" },
          { type: "text", text: "• 輸入「加入訂閱」開啟每日推播（每天上午 7:00）", size: "sm", color: "#666666", wrap: true },
          { type: "text", text: "• 輸入「取消訂閱」關閉每日推播", size: "sm", color: "#666666", wrap: true }
        ],
        paddingAll: "20px"
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "separator" },
          { type: "text", text: "📊 中央氣象署 | 室內濕度推算：工研院終極公式", size: "xs", color: "#999999", align: "center" },
          { type: "text", text: "📖 科學依據：Denda et al. (2002)、PMC (2019) 等", size: "xs", color: "#999999", align: "center" },
          { type: "text", text: "💡 輸入「全台」開始查詢", size: "xs", color: "#999999", align: "center" }
        ],
        paddingAll: "12px"
      }
    }
  };
}

// ==========================================
// 推播函數
// ==========================================
async function pushToUser(userId, page1, page2) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', { to: userId, messages: [page1, page2] }, {
      headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
    console.log(`✅ 推播成功: ${userId}`);
    return true;
  } catch (err) {
    console.error(`❌ 推播失敗: ${userId}`);
    return false;
  }
}

async function dailyPublishTask() {
  console.log(`\n📅 ===== 每日發布任務 ${new Date().toLocaleString()} =====`);
  const page1 = await generatePage1Flex();
  const page2 = await generatePage2Flex();
  
  console.log(`📤 推播給 ${subscribers.length} 位個人訂閱者`);
  for (const userId of subscribers) {
    await pushToUser(userId, page1, page2);
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`✅ 每日發布任務完成\n`);
}

async function replyBothFlexMessages(replyToken, page1, page2) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', { replyToken, messages: [page1, page2] }, {
      headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
    console.log('✅ 兩張卡片回復成功');
  } catch (err) {
    console.error('❌ 回復失敗:', err.response?.data || err.message);
  }
}

async function replyFlexMessage(replyToken, flexMessage) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', { replyToken, messages: [flexMessage] }, {
      headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
    console.log('✅ Flex Message 回復成功');
  } catch (err) {
    console.error('❌ 回復失敗:', err.response?.data || err.message);
  }
}

async function replyTextMessage(replyToken, text) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', { replyToken, messages: [{ type: 'text', text }] }, {
      headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
    console.log('✅ 文字回復成功');
  } catch (err) {
    console.error('❌ 回復失敗:', err.response?.data || err.message);
  }
}

async function sendPrivateMessage(userId, page1, page2) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', { to: userId, messages: [page1, page2] }, {
      headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
    console.log(`✅ 私訊發送成功: ${userId}`);
    return true;
  } catch (err) {
    console.error(`❌ 私訊發送失敗: ${userId}`);
    return false;
  }
}

// ==========================================
// 每日推播檢查機制
// ==========================================
let lastPublishDate = null;

function checkAndPublish() {
  const now = new Date();
  const taiwanTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const hours = taiwanTime.getUTCHours();
  const minutes = taiwanTime.getUTCMinutes();
  
  if (hours === 7 && minutes === 0) {
    const today = taiwanTime.toISOString().split('T')[0];
    if (lastPublishDate !== today) {
      console.log(`📅 觸發每日推播 - ${today}`);
      lastPublishDate = today;
      dailyPublishTask();
    }
  }
}

setInterval(() => {
  checkAndPublish();
}, 60 * 1000);

console.log('🕐 每日推播檢查機制已啟動（每分鐘檢查，每日 7:00 觸發）');

// ==========================================
// 網站 API：取得全台6都摘要（當天）
// ==========================================
app.get('/api/all-cities-summary', async (req, res) => {
  try {
    const results = [];
    
    for (const city of CITIES) {
      const weather = await getWeather(city, 0);
      const indoorHumidity = calculateIndoorHumidity(weather.temp, weather.humidity);
      const deltaRH = 0;
      const shock = calculateShockLevel(deltaRH, indoorHumidity);
      
      results.push({
        city: city.displayName,
        tempOut: weather.temp,
        humOut: weather.humidity,
        indoorHumidity: indoorHumidity,
        shockLevel: shock.name,
        shockEmoji: shock.emoji,
        shockColor: shock.color
      });
    }
    
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('API錯誤:', error);
    res.json({ success: false, message: error.message });
  }
});

// ==========================================
// 網站 API：取得全台6都3天預報
// ==========================================
app.get('/api/all-cities-3days', async (req, res) => {
  try {
    const results = [];
    
    for (const city of CITIES) {
      const threeDays = await calculateCityThreeDays(city);
      results.push({
        city: city.displayName,
        days: threeDays.days.map(day => ({
          shockLevel: day.shock.name,
          shockEmoji: day.shock.emoji,
          shockColor: day.shock.color
        }))
      });
    }
    
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('API錯誤:', error);
    res.json({ success: false, message: error.message });
  }
});

// ==========================================
// 健康檢查端點
// ==========================================
app.get('/', (req, res) => {
  res.json({ status: 'ok', subscribers: subscribers.length, indoorTemp: INDOOR_TEMP });
});

app.get('/health', (req, res) => {
  console.log(`💓 健康檢查 - ${new Date().toLocaleString()}`);
  res.status(200).send('OK');
});

app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'API 正常運作', time: new Date().toISOString() });
});

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
      const sourceType = event.source?.type;
      const sourceId = event.source?.groupId || event.source?.roomId || event.source?.userId;
      const userId = event.source?.userId;
      
      console.log(`📱 來源: ${sourceType}, ID: ${sourceId}`);
      
      if (event.type === 'join') {
        const groupId = event.source?.groupId;
        if (groupId && !groups.includes(groupId)) {
          groups.push(groupId);
          saveGroups();
          console.log(`✅ Bot 加入新群組: ${groupId}`);
          await replyTextMessage(replyToken, 
            `🌡️💧 皮膚濕度壓力指數 Bot 已加入！

📊 使用方式：
• 輸入「全台」查詢六都3天預報
• 輸入「詳細說明」查看完整說明

💡 查詢結果會「私訊」給您，不會打擾群組成員`);
        }
        continue;
      }
      
      if (event.type === 'follow') {
        if (!subscribers.includes(userId)) {
          subscribers.push(userId);
          saveSubscribers();
          console.log(`✅ 新用戶加入並自動訂閱: ${userId}`);
          await replyTextMessage(replyToken, 
            `🎉 歡迎加入【皮膚濕度壓力指數】！

📋 已為您自動開啟每日提醒，每天上午 7:00 收到六都連續3天預報。

📱 查詢方式：
• 輸入「全台」查看六都3天預報
• 輸入「詳細說明」查看完整使用說明

🔔 訂閱管理：
• 輸入「加入訂閱」開啟每日提醒
• 輸入「取消訂閱」關閉

📖 本指數依據 Denda et al. (2002) 等國際期刊研究設計

💡 試試看：現在輸入「全台」開始查詢！`);
        }
        continue;
      }
      
      if (event.type === 'unfollow') {
        const idx = subscribers.indexOf(userId);
        if (idx !== -1) {
          subscribers.splice(idx, 1);
          saveSubscribers();
          console.log(`❌ 用戶取消訂閱: ${userId}`);
        }
        continue;
      }
      
      if (event.type === 'message' && event.message.type === 'text') {
        const input = event.message.text.trim();
        console.log(`📱 輸入: "${input}"`);
        
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
            await replyTextMessage(replyToken, '✅ 訂閱成功！每天上午 7:00 收到預報。');
          } else {
            await replyTextMessage(replyToken, 'ℹ️ 您已是訂閱用戶');
          }
          continue;
        }
        
        if (input === '詳細說明') {
          const page2 = await generatePage2Flex();
          await replyFlexMessage(replyToken, page2);
          continue;
        }
        
        if (input === '全台' || input === 'ALL') {
          const page1 = await generatePage1Flex();
          const page2 = await generatePage2Flex();
          
          if (sourceType === 'user') {
            await replyBothFlexMessages(replyToken, page1, page2);
          } else {
            const now = Date.now();
            const lastTime = lastQueryTime[sourceId] || 0;
            
            if (now - lastTime < 30000) {
              await replyTextMessage(replyToken, '⚠️ 請稍後再查詢，30秒內只能查詢一次');
              continue;
            }
            lastQueryTime[sourceId] = now;
            
            const privateSent = await sendPrivateMessage(userId, page1, page2);
            
            if (privateSent) {
              await replyTextMessage(replyToken, '📊 已將六都預報私訊給您，請查看 LINE 的「聊天」列表');
            } else {
              await replyTextMessage(replyToken, '⚠️ 無法發送私訊，請先加入好友並允許接收訊息');
            }
          }
          continue;
        }
        
        const page1 = await generatePage1Flex();
        if (sourceType === 'user') {
          await replyFlexMessage(replyToken, page1);
        } else {
          await replyTextMessage(replyToken, 
            `📊 查詢六都皮膚濕度壓力指數\n\n` +
            `請輸入「全台」，結果將「私訊」給您，不會打擾群組成員。\n\n` +
            `📖 輸入「詳細說明」查看完整介紹`);
        }
      }
    }
  } catch (err) {
    console.error('處理錯誤:', err);
  }
});

// ==========================================
// 啟動伺服器
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 ========================================`);
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🏠 室內基準：${INDOOR_TEMP}℃`);
  console.log(`📡 預報 API：F-D0047-089`);
  console.log(`📅 每日推播：上午 7:00 (台灣時間)`);
  console.log(`📋 個人訂閱：${subscribers.length} 人`);
  console.log(`👥 群組數量：${groups.length} 個`);
  console.log(`💬 群組查詢：私訊回覆，不打擾群組`);
  console.log(`========================================\n`);
});
