const express = require('express');
const axios = require('axios');
const fs = require('fs');
const schedule = require('node-schedule');
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
const CACHE_FILE = './cached_forecast.json';

// 全域變數
let subscribers = [];
let groups = [];
let humidityHistory = {};
let cachedForecast = null;
let lastCacheTime = null;

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
    const loadedSubscribers = JSON.parse(content);
    
    subscribers = loadedSubscribers;
    
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

// ==========================================
// 中央氣象署 API - 獲取 14:00 的預報資料
// ==========================================

async function getForecastAtTime(city, dateOffset = 0, targetHour = 14) {
  console.log(`\n🔍 ===== ${city.displayName} 第${dateOffset+1}天原始數據 ====`);
  console.log(`📡 請求: ${city.displayName} ${dateOffset}天後 ${targetHour}:00`);
  
  try {
    const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-089?Authorization=${CWA_API_KEY}&format=JSON&LocationName=${encodeURIComponent(city.apiName)}`;
    const response = await axios.get(url, { timeout: 15000 });
    const data = response.data;
    
    if (data.success !== "true") {
      console.log(`❌ API 回應失敗: ${data.success}`);
      return null;
    }
    
    const locations = data.records?.Locations;
    if (!locations) {
      console.log(`❌ 無 Locations 資料`);
      return null;
    }
    
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
    
    if (!targetLocation) {
      console.log(`❌ 找不到 ${city.apiName} 的資料`);
      return null;
    }
    
    const tempElem = targetLocation.WeatherElement?.find(w => w.ElementName === "溫度");
    const humElem = targetLocation.WeatherElement?.find(w => w.ElementName === "相對濕度");
    
    if (!tempElem || !humElem) {
      console.log(`❌ 找不到溫度或濕度元素`);
      return null;
    }
    
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + dateOffset);
    const targetDateStr = targetDate.toISOString().split('T')[0];
    
    let tempValue = null, humValue = null;
    
    for (const t of tempElem.Time) {
      const dataTime = t.DataTime;
      if (dataTime && dataTime.includes(targetDateStr)) {
        const hour = parseInt(dataTime.split('T')[1]?.split(':')[0]);
        if (hour === targetHour) {
          tempValue = t.ElementValue?.[0]?.Temperature;
          break;
        }
      }
    }
    
    for (const h of humElem.Time) {
      const dataTime = h.DataTime;
      if (dataTime && dataTime.includes(targetDateStr)) {
        const hour = parseInt(dataTime.split('T')[1]?.split(':')[0]);
        if (hour === targetHour) {
          humValue = h.ElementValue?.[0]?.RelativeHumidity;
          break;
        }
      }
    }
    
    if (tempValue && humValue) {
      console.log(`📊 原始數據: 溫度=${tempValue}℃, 濕度=${humValue}%`);
      console.log(`✅ API 連線成功`);
      return {
        temp: Math.round(parseFloat(tempValue)),
        humidity: Math.round(parseFloat(humValue))
      };
    }
    
    console.log(`❌ 找不到指定時間的數據`);
    return null;
  } catch (error) {
    console.error(`❌ API 錯誤: ${error.message}`);
    return null;
  }
}

async function getCurrentWeather(city) {
  console.log(`\n🔍 ===== ${city.displayName} 即時觀測數據 ====`);
  
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
        console.log(`📊 原始數據: 溫度=${temp}℃, 濕度=${humidity}%`);
        console.log(`✅ 即時觀測成功`);
        return { temp, humidity };
      }
    }
    console.log(`❌ 找不到 ${city.name} 的即時觀測資料`);
    return null;
  } catch (error) {
    console.error(`❌ 即時API錯誤: ${error.message}`);
    return null;
  }
}

async function getWeather(city, dateOffset = 0, targetHour = 14) {
  // 優先使用預報 API
  let weather = await getForecastAtTime(city, dateOffset, targetHour);
  
  // 如果預報 API 失敗且是當天，嘗試即時觀測 API
  if (!weather && dateOffset === 0) {
    console.log(`⚠️ 預報API失敗，嘗試使用即時觀測API`);
    weather = await getCurrentWeather(city);
  }
  
  // 如果還是失敗，返回 null（不使用類比資料）
  if (!weather) {
    console.log(`❌ ${city.displayName} 所有 API 都失敗，標記為暫無資料`);
    return null;
  }
  
  return weather;
}

// ==========================================
// 室內濕度推算公式（分段函數）
// ==========================================
function calculateIndoorHumidity(tempOut, humOut) {
  const deltaTemp = tempOut - INDOOR_TEMP;
  
  let result = 0;
  
  if (deltaTemp <= 0) {
    result = Math.min(humOut, Math.round(humOut));
    console.log(`   📐 公式選擇: ΔT≤0 → 情況1 (RH_in = RH_out = ${result}%)`);
  } else if (deltaTemp < 2) {
    result = Math.min(90, Math.max(30, Math.round(humOut - 5)));
    console.log(`   📐 公式選擇: 0<ΔT<2 → 情況2 (RH_in = RH_out - 5 = ${result}%)`);
  } else if (deltaTemp >= 2 && deltaTemp < 5) {
    result = Math.min(75, Math.max(35, Math.round(0.85 * humOut - 0.15 * deltaTemp - 8)));
    console.log(`   📐 公式選擇: 2≤ΔT<5 → 情況3 (RH_in = ${result}%)`);
  } else {
    result = Math.min(65, Math.max(25, Math.round(0.82 * humOut - 0.34 * deltaTemp - 16)));
    console.log(`   📐 公式選擇: ΔT≥5 → 情況4 (RH_in = ${result}%)`);
  }
  
  return result;
}

// ==========================================
// 燈號判定（依優先級順序）
// ==========================================
function calculateShockLevel(humOut, indoorHumidity) {
  const gap = humOut - indoorHumidity;
  
  console.log(`   📊 計算: Gap = ${humOut} - ${indoorHumidity} = ${gap}%`);
  console.log(`   🔍 條件檢查:`);
  
  if (indoorHumidity <= 15) {
    console.log(`      ✅ 條件1: RH_in=${indoorHumidity} ≤ 15 → 🔴 危險衝擊`);
    return { level: 4, name: "危險衝擊", color: "#FF0000", emoji: "🔴" };
  }
  console.log(`      ❌ 條件1: RH_in=${indoorHumidity} > 15`);
  
  if (indoorHumidity >= 85) {
    console.log(`      ✅ 條件2: RH_in=${indoorHumidity} ≥ 85 → 🔴 危險衝擊`);
    return { level: 4, name: "危險衝擊", color: "#FF0000", emoji: "🔴" };
  }
  console.log(`      ❌ 條件2: RH_in=${indoorHumidity} < 85`);
  
  if (gap >= 30 && indoorHumidity < 45) {
    console.log(`      ✅ 條件3: Gap=${gap} ≥ 30 且 RH_in=${indoorHumidity} < 45 → 🔴 危險衝擊`);
    return { level: 4, name: "危險衝擊", color: "#FF0000", emoji: "🔴" };
  }
  console.log(`      ❌ 條件3: Gap=${gap} < 30 或 RH_in=${indoorHumidity} ≥ 45`);
  
  if (indoorHumidity >= 80) {
    console.log(`      ✅ 條件4: RH_in=${indoorHumidity} ≥ 80 → 🟠 高衝擊`);
    return { level: 3, name: "高衝擊", color: "#FF6600", emoji: "🟠" };
  }
  console.log(`      ❌ 條件4: RH_in=${indoorHumidity} < 80`);
  
  if (indoorHumidity <= 30) {
    console.log(`      ✅ 條件5: RH_in=${indoorHumidity} ≤ 30 → 🟠 高衝擊`);
    return { level: 3, name: "高衝擊", color: "#FF6600", emoji: "🟠" };
  }
  console.log(`      ❌ 條件5: RH_in=${indoorHumidity} > 30`);
  
  if (gap >= 15 && gap < 35 && indoorHumidity < 45) {
    console.log(`      ✅ 條件6: 15≤${gap}<35 且 RH_in=${indoorHumidity} < 45 → 🟠 高衝擊`);
    return { level: 3, name: "高衝擊", color: "#FF6600", emoji: "🟠" };
  }
  console.log(`      ❌ 條件6: Gap=${gap} 不在 15-35 或 RH_in=${indoorHumidity} ≥ 45`);
  
  if (gap <= 15 && (indoorHumidity >= 70 || indoorHumidity <= 40)) {
    console.log(`      ✅ 條件7: Gap=${gap} ≤ 15 且 (RH_in=${indoorHumidity} ≥70 或 ≤40) → 🟡 中衝擊`);
    return { level: 2, name: "中衝擊", color: "#FFCC00", emoji: "🟡" };
  }
  console.log(`      ❌ 條件7: 不符合`);
  
  console.log(`      ✅ 條件8: 其他情況 → 🟢 低衝擊`);
  return { level: 1, name: "低衝擊", color: "#00CC00", emoji: "🟢" };
}

function calculateDailyIndex(weather) {
  if (!weather) {
    console.log(`   ❌ 無天氣資料`);
    return {
      tempOut: null,
      humOut: null,
      indoorHumidity: null,
      gap: null,
      shock: { level: 0, name: "暫無資料", color: "#999999", emoji: "❓" }
    };
  }
  
  console.log(`\n📐 === 開始計算室內濕度 ===`);
  const indoorHumidity = calculateIndoorHumidity(weather.temp, weather.humidity);
  const shock = calculateShockLevel(weather.humidity, indoorHumidity);
  const gap = weather.humidity - indoorHumidity;
  
  console.log(`   📋 計算結果匯總:`);
  console.log(`      室外溫度: ${weather.temp}℃`);
  console.log(`      室外濕度: ${weather.humidity}%`);
  console.log(`      室內濕度: ${indoorHumidity}%`);
  console.log(`      濕度落差: ${gap}%`);
  console.log(`      最終燈號: ${shock.emoji} ${shock.name}`);
  
  return {
    tempOut: weather.temp,
    humOut: weather.humidity,
    indoorHumidity: indoorHumidity,
    gap: gap,
    shock: shock
  };
}

async function calculateCityThreeDays(city, targetHour = 14) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🏙️ 開始計算 ${city.displayName} 連續3天預報`);
  console.log(`${'='.repeat(60)}`);
  
  const weather0 = await getWeather(city, 0, targetHour);
  const weather1 = await getWeather(city, 1, targetHour);
  const weather2 = await getWeather(city, 2, targetHour);
  
  console.log(`\n📅 第1天 (今天):`);
  const day0 = calculateDailyIndex(weather0);
  console.log(`\n📅 第2天 (明天):`);
  const day1 = calculateDailyIndex(weather1);
  console.log(`\n📅 第3天 (後天):`);
  const day2 = calculateDailyIndex(weather2);
  
  const hasData = day0.shock.level !== 0 || day1.shock.level !== 0 || day2.shock.level !== 0;
  if (!hasData) {
    console.log(`⚠️ ${city.displayName} 完全無資料`);
  }
  
  console.log(`\n📊 ${city.displayName} 三天燈號: ${day0.shock.emoji} ${day1.shock.emoji} ${day2.shock.emoji}`);
  console.log(`${'='.repeat(60)}\n`);
  
  return {
    city: city.displayName,
    days: [day0, day1, day2]
  };
}

function getDateString(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getMonth()+1}/${date.getDate()}`;
}

// ==========================================
// 錯誤訊息 Flex Message（全部 API 無法連線時顯示）
// ==========================================
function getErrorFlexMessage() {
  const today = getDateString(0);
  const tomorrow = getDateString(1);
  const dayAfter = getDateString(2);
  
  return {
    type: "flex",
    altText: "⚠️ 中央氣象署 API 暫時無法連線",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "⚠️ 服務暫時無法使用", weight: "bold", size: "lg", color: "#ffffff" },
          { type: "text", text: `預報日期 ${today} ~ ${dayAfter}`, size: "sm", color: "#dddddd", margin: "xs" }
        ],
        backgroundColor: "#FF6600",
        paddingAll: "20px"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "中央氣象署 API 暫時無法連線", size: "md", weight: "bold", color: "#FF0000", wrap: true },
          { type: "text", text: "請稍後再試，或聯繫管理員。", size: "sm", color: "#666666", wrap: true },
          { type: "separator", margin: "md" },
          { type: "text", text: "💡 您可以嘗試：", size: "sm", weight: "bold" },
          { type: "text", text: "• 幾分鐘後重新查詢", size: "xs", color: "#666666" },
          { type: "text", text: "• 加入 LINE 好友接收推播", size: "xs", color: "#666666" }
        ],
        paddingAll: "20px"
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "separator" },
          { type: "text", text: "📊 中央氣象署", size: "xs", color: "#999999", align: "center" }
        ],
        paddingAll: "12px"
      }
    }
  };
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
    citiesData.push(await calculateCityThreeDays(city, 14));
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
  
  let hasError = false;
  
  for (const cityData of citiesData) {
    if (cityData.days.some(day => day.shock.level === 0)) {
      hasError = true;
    }
    
    tableRows.push({
      type: "box", layout: "horizontal", contents: [
        { type: "text", text: cityData.city, size: "md", flex: 2 },
        { type: "text", text: cityData.days[0].shock.emoji, size: "md", flex: 1, align: "center", color: cityData.days[0].shock.color },
        { type: "text", text: cityData.days[1].shock.emoji, size: "md", flex: 1, align: "center", color: cityData.days[1].shock.color },
        { type: "text", text: cityData.days[2].shock.emoji, size: "md", flex: 1, align: "center", color: cityData.days[2].shock.color }
      ]
    });
  }
  
  const footerContents = [
    { type: "separator" },
    { type: "text", text: "🏠 室內基準溫度：冷氣房 26℃", size: "sm", color: "#999999", align: "center" }
  ];
  
  if (hasError) {
    footerContents.push({ 
      type: "text", 
      text: "⚠️ 部分城市資料取得失敗，顯示「❓」表示暫無資料", 
      size: "xs", 
      color: "#FF6600", 
      align: "center",
      wrap: true
    });
  }
  
  footerContents.push(
    { type: "text", text: "📊 數據來源：中央氣象署", size: "sm", color: "#999999", align: "center" },
    { type: "button", style: "primary", height: "sm", action: { type: "message", label: "📋 查看燈號說明及建議", text: "詳細說明" }, margin: "md", color: "#667eea" }
  );
  
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
          { type: "text", text: `預報日期 ${today} ~ ${dayAfter} (下午2點數據)`, size: "sm", color: "#dddddd", margin: "xs" }
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
          ]},
          { type: "text", text: "❓ 暫無資料", size: "xs", color: "#999999", align: "center", margin: "md" }
        ],
        paddingAll: "20px"
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "xs",
        contents: footerContents,
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
          { type: "text", text: "舒適區：水分散失與保留達到相對動態平衡", size: "sm", color: "#666666", wrap: true },
          { type: "text", text: "🟡 中衝擊", weight: "bold", size: "sm", color: "#FFCC00", margin: "xs" },
          { type: "text", text: "溫和乾燥/潮濕：濕度偏高或偏低但落差小", size: "sm", color: "#666666", wrap: true },
          { type: "text", text: "🟠 高衝擊", weight: "bold", size: "sm", color: "#FF6600", margin: "xs" },
          { type: "text", text: "重度乾燥或中度環境衝擊", size: "sm", color: "#666666", wrap: true },
          { type: "text", text: "🔴 危險衝擊", weight: "bold", size: "sm", color: "#FF0000", margin: "xs" },
          { type: "text", text: "極端乾燥/潮濕或環境衝擊：需立即防護", size: "sm", color: "#666666", wrap: true },
          { type: "text", text: "❓ 暫無資料", weight: "bold", size: "sm", color: "#999999", margin: "xs" },
          { type: "text", text: "該時段無法取得天氣資料，請稍後再試", size: "sm", color: "#666666", wrap: true },
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
          { type: "text", text: "• 輸入「加入訂閱」開啟每日提醒", size: "sm", color: "#666666", wrap: true },
          { type: "text", text: "• 輸入「取消訂閱」關閉每日提醒", size: "sm", color: "#666666", wrap: true }
        ],
        paddingAll: "20px"
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "separator" },
          { type: "text", text: "📊 中央氣象署 | 室內濕度推算：工研院終極公式", size: "xs", color: "#999999", align: "center" },
          { type: "text", text: "📖 科學依據：Denda et al. (2002)、PMC (2019) 等", size: "xs", color: "#999999", align: "center" }
        ],
        paddingAll: "12px"
      }
    }
  };
}

// ==========================================
// 快取管理函數
// ==========================================

async function precomputeAndCache() {
  console.log(`\n🔄 開始預計算快取 - ${new Date().toLocaleString()}`);
  const startTime = Date.now();
  
  try {
    const page1 = await generatePage1Flex();
    const page2 = await generatePage2Flex();
    
    cachedForecast = { page1, page2 };
    lastCacheTime = new Date();
    
    const cacheData = {
      page1: page1,
      page2: page2,
      lastCacheTime: lastCacheTime.toISOString()
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
    
    const duration = Date.now() - startTime;
    console.log(`✅ 快取預計算完成，耗時 ${duration}ms`);
  } catch (error) {
    console.error('❌ 預計算失敗:', error);
    cachedForecast = null;
  }
}

function loadCacheFromFile() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf8');
      const cache = JSON.parse(data);
      cachedForecast = { page1: cache.page1, page2: cache.page2 };
      lastCacheTime = new Date(cache.lastCacheTime);
      console.log(`📦 從檔案載入快取成功，時間: ${lastCacheTime.toLocaleString()}`);
      return true;
    }
  } catch (error) {
    console.error('❌ 載入快取失敗:', error);
  }
  return false;
}

async function getCachedForecast() {
  if (!cachedForecast || !cachedForecast.page1) {
    console.log('⚠️ 快取不存在，重新預計算');
    await precomputeAndCache();
    return cachedForecast;
  }
  
  if (lastCacheTime && (Date.now() - lastCacheTime.getTime() > 24 * 60 * 60 * 1000)) {
    console.log('⚠️ 快取已超過 24 小時，重新預計算');
    await precomputeAndCache();
    return cachedForecast;
  }
  
  return cachedForecast;
}

// ==========================================
// 推播函數
// ==========================================
async function pushToUser(userId, page1) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', { to: userId, messages: [page1] }, {
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
  
  const cache = await getCachedForecast();
  
  if (cache && cache.page1) {
    console.log(`📤 推播給 ${subscribers.length} 位個人訂閱者`);
    for (const userId of subscribers) {
      await pushToUser(userId, cache.page1);
      await new Promise(r => setTimeout(r, 500));
    }
  } else {
    const errorMsg = getErrorFlexMessage();
    for (const userId of subscribers) {
      await pushToUser(userId, errorMsg);
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  console.log(`✅ 每日發布任務完成\n`);
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

async function sendPrivateMessage(userId, page1) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', { to: userId, messages: [page1] }, {
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
// 網站 API
// ==========================================
app.get('/api/all-cities-3days', async (req, res) => {
  try {
    const cache = await getCachedForecast();
    if (cache && cache.page1) {
      res.json({ success: true, message: '資料已快取', lastUpdate: lastCacheTime?.toISOString() });
    } else {
      res.json({ success: false, message: '暫無快取資料' });
    }
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', subscribers: subscribers.length, indoorTemp: INDOOR_TEMP, cacheTime: lastCacheTime?.toLocaleString() });
});

app.get('/health', (req, res) => {
  console.log(`💓 健康檢查 - ${new Date().toLocaleString()}`);
  res.status(200).send('OK');
});

app.get('/api/refresh-cache', async (req, res) => {
  console.log('🔄 手動觸發快取更新');
  await precomputeAndCache();
  res.json({ success: true, message: '快取已更新', cacheTime: lastCacheTime?.toLocaleString() });
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
          
          const cache = await getCachedForecast();
          if (cache && cache.page1) {
            await replyFlexMessage(replyToken, cache.page1);
          } else {
            const errorMsg = getErrorFlexMessage();
            await replyFlexMessage(replyToken, errorMsg);
          }
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
          const cache = await getCachedForecast();
          
          if (cache && cache.page1) {
            if (sourceType === 'user') {
              await replyFlexMessage(replyToken, cache.page1);
            } else {
              const now = Date.now();
              const lastTime = lastQueryTime[sourceId] || 0;
              
              if (now - lastTime < 30000) {
                await replyTextMessage(replyToken, '⚠️ 請稍後再查詢，30秒內只能查詢一次');
                continue;
              }
              lastQueryTime[sourceId] = now;
              
              const privateSent = await sendPrivateMessage(userId, cache.page1);
              
              if (privateSent) {
                await replyTextMessage(replyToken, '📊 已將六都預報私訊給您，請查看 LINE 的「聊天」列表');
              } else {
                await replyTextMessage(replyToken, '⚠️ 無法發送私訊，請先加入好友並允許接收訊息');
              }
            }
          } else {
            const errorMsg = getErrorFlexMessage();
            await replyFlexMessage(replyToken, errorMsg);
          }
          continue;
        }
        
        const cache = await getCachedForecast();
        if (cache && cache.page1 && sourceType === 'user') {
          await replyFlexMessage(replyToken, cache.page1);
        } else if (sourceType !== 'user') {
          await replyTextMessage(replyToken, 
            `📊 查詢六都皮膚濕度壓力指數\n\n` +
            `請輸入「全台」，結果將「私訊」給您，不會打擾群組成員。\n\n` +
            `📖 輸入「詳細說明」查看完整介紹`);
        } else {
          const errorMsg = getErrorFlexMessage();
          await replyFlexMessage(replyToken, errorMsg);
        }
      }
    }
  } catch (err) {
    console.error('處理錯誤:', err);
  }
});

// ==========================================
// 每日推播檢查機制（每分鐘檢查，最穩定）
// ==========================================

let lastPublishDate = null;

function checkAndPublish() {
  const now = new Date();
  const taiwanTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const hours = taiwanTime.getUTCHours();
  const minutes = taiwanTime.getUTCMinutes();
  
  // 早上 7:00 觸發（每分鐘檢查，確保不會錯過）
  if (hours === 7 && minutes === 0) {
    const today = taiwanTime.toISOString().split('T')[0];
    if (lastPublishDate !== today) {
      console.log(`📅 觸發每日推播 - ${today} 台灣時間 ${hours}:${minutes}`);
      lastPublishDate = today;
      dailyPublishTask();
    }
  }
}

// 每分鐘檢查一次
setInterval(() => {
  checkAndPublish();
}, 60 * 1000);

console.log('🕐 每日推播檢查機制已啟動（每分鐘檢查，每日 7:00 觸發）');

// ==========================================
// 定時預計算任務（每天 14:10 台灣時間 = UTC 06:10）
// ==========================================
schedule.scheduleJob('10 6 * * *', () => {
  console.log(`\n⏰ 定時任務觸發 - 開始預計算`);
  precomputeAndCache();
});

console.log('📅 已設定定時預計算任務：每天 14:10 (台灣時間)');

// ==========================================
// 啟動伺服器
// ==========================================
(async () => {
  // 先載入訂閱資料
  await loadFromGitHub();
  
  // 載入快取
  loadCacheFromFile();
  
  // 啟動時執行一次預計算（如果快取不存在）
  if (!cachedForecast) {
    console.log('🚀 啟動時無快取，立即執行預計算');
    await precomputeAndCache();
  } else if (lastCacheTime && (Date.now() - lastCacheTime.getTime() > 24 * 60 * 60 * 1000)) {
    console.log('⚠️ 快取已超過 24 小時，重新預計算');
    await precomputeAndCache();
  }
  
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 ========================================`);
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🏠 室內基準：${INDOOR_TEMP}℃`);
    console.log(`📡 預報 API：F-D0047-089 (取樣: 下午2點)`);
    console.log(`⏰ 預計算時間：每天 14:10 (台灣時間)`);
    console.log(`🕐 每日推播：上午 7:00 (台灣時間) - 每分鐘檢查`);
    console.log(`📦 快取狀態：${cachedForecast ? '已載入' : '無'}`);
    console.log(`📋 個人訂閱：${subscribers.length} 人`);
    console.log(`👥 群組數量：${groups.length} 個`);
    console.log(`========================================\n`);
  });
})();
