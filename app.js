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
// R² ≈ 0.85
// RH_in = 0.82 × RH_out - 0.34 × ΔT - 16
// 適用範圍：T_out ≥ 28，T_in = 24~27，RH_out ≥ 50%
// ==========================================
function calculateIndoorHumidity(tempOut, humOut, tempIn = 26) {
  const deltaTemp = tempOut - tempIn;
  
  // 特殊情況：室外溫度比室內低（雨天或冬天）
  if (deltaTemp <= 0) {
    return Math.min(humOut, Math.round(humOut));
  }
  
  // 溫差小於 2°C（如雨天低溫高濕）
  if (deltaTemp < 2) {
    const indoorHum = humOut - 5;
    return Math.min(90, Math.max(30, Math.round(indoorHum)));
  }
  
  // 溫差 2°C ~ 5°C（間歇冷卻）
  if (deltaTemp >= 2 && deltaTemp < 5) {
    const indoorHum = 0.85 * humOut - 0.15 * deltaTemp - 8;
    return Math.min(75, Math.max(35, Math.round(indoorHum)));
  }
  
  // 溫差 ≥ 5°C（連續強制冷卻）- 使用終極公式
  let indoorHum = 0.82 * humOut - 0.34 * deltaTemp - 16;
  indoorHum = Math.min(65, Math.max(25, Math.round(indoorHum)));
  
  return indoorHum;
}

// ==========================================
// 燈號判定（兩大路徑，取最高等級）
// 路徑 A：濕度衝擊（Delta_RH 與 RH_in 複合條件）
// 路徑 B：極端穩態壓力（Delta_RH < 15% 但 RH_in 極端）
// ==========================================
function calculateShockLevel(deltaRH, indoorHumidity) {
  // 路徑 A：濕度衝擊
  let levelA = 1; // 預設低衝擊
  
  // 危險衝擊：Delta_RH ≥ 50% 且 RH_in < 40%
  if (deltaRH >= 50 && indoorHumidity < 40) {
    levelA = 4;
  }
  // 高衝擊：30% ≤ Delta_RH < 50% 且 RH_in < 45%
  else if (deltaRH >= 30 && deltaRH < 50 && indoorHumidity < 45) {
    levelA = 3;
  }
  // 中衝擊：15% ≤ Delta_RH < 30% 或 RH_in < 45%
  else if ((deltaRH >= 15 && deltaRH < 30) || indoorHumidity < 45) {
    levelA = 2;
  }
  
  // 路徑 B：極端穩態壓力（濕度變化小但環境極端）
  let levelB = 1;
  
  if (deltaRH < 15) {
    // 危險衝擊：RH_in ≥ 85%
    if (indoorHumidity >= 85) {
      levelB = 4;
    }
    // 高衝擊：RH_in ≥ 80%
    else if (indoorHumidity >= 80) {
      levelB = 3;
    }
    // 中衝擊：RH_in ≥ 75% 或 RH_in ≤ 25%
    else if (indoorHumidity >= 75 || indoorHumidity <= 25) {
      levelB = 2;
    }
  }
  
  // 取最高等級
  const finalLevel = Math.max(levelA, levelB);
  
  const levelMap = {
    1: { name: "低衝擊", color: "#00CC00", emoji: "🟢", en: "LOW" },
    2: { name: "中衝擊", color: "#FFCC00", emoji: "🟡", en: "MEDIUM" },
    3: { name: "高衝擊", color: "#FF6600", emoji: "🟠", en: "HIGH" },
    4: { name: "危險衝擊", color: "#FF0000", emoji: "🔴", en: "DANGER" }
  };
  
  return {
    level: finalLevel,
    name: levelMap[finalLevel].name,
    color: levelMap[finalLevel].color,
    emoji: levelMap[finalLevel].emoji,
    en: levelMap[finalLevel].en
  };
}

function calculateDrynessLevel(indoorHumidity) {
  if (indoorHumidity <= 25) return { name: "極度乾燥", color: "#FF0000", advice: "🔥 皮膚嚴重缺水！請立即加強保濕" };
  if (indoorHumidity <= 35) return { name: "乾燥", color: "#FF6600", advice: "⚠️ 皮膚容易緊繃，建議使用保濕乳液" };
  if (indoorHumidity <= 45) return { name: "偏乾", color: "#FFCC00", advice: "😐 可適度補充水分，保持肌膚滋潤" };
  if (indoorHumidity <= 65) return { name: "舒適", color: "#00CC00", advice: "✅ 濕度適中，皮膚狀態良好" };
  if (indoorHumidity <= 75) return { name: "偏濕", color: "#FFCC00", advice: "😐 有些微黏膩感，建議保持通風" };
  if (indoorHumidity <= 85) return { name: "潮濕", color: "#FF6600", advice: "⚠️ 濕度偏高，建議開啟除濕機" };
  return { name: "極度潮濕", color: "#FF0000", advice: "🔥 濕度過高！皮膚屏障易受損，請立即除濕" };
}

// ==========================================
// 獲取天氣資料（3天預測）
// ==========================================
async function getWeatherData(city) {
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
  const realWeather = await getWeatherData(city);
  if (realWeather) {
    return realWeather;
  }
  console.log(`📦 使用類比資料: ${city.displayName}`);
  return MOCK_WEATHER[city.name] || { temp: 28, humidity: 60 };
}

// ==========================================
// 計算指數
// ==========================================
async function calculateCityIndex(city) {
  const weather = await getWeather(city);
  const indoorHumidity = calculateIndoorHumidity(weather.temp, weather.humidity, INDOOR_TEMP);
  const deltaRH = Math.abs(weather.humidity - indoorHumidity);
  const shock = calculateShockLevel(deltaRH, indoorHumidity);
  const dryness = calculateDrynessLevel(indoorHumidity);
  
  return {
    city: city.displayName,
    tempOut: weather.temp,
    humOut: weather.humidity,
    indoorHumidity,
    deltaRH,
    shock,
    dryness,
    advice: getAdviceByShockLevel(shock.level, indoorHumidity)
  };
}

function getAdviceByShockLevel(level, indoorHumidity) {
  if (level === 4) {
    if (indoorHumidity >= 85) {
      return "🔥 今天室內極端潮濕，皮膚長時間過度水合，屏障會變脆弱。建議立即開啟除濕機，將濕度降至 60% 以下。";
    }
    return "🔥 濕度衝擊劇烈！請留在室內並立即調整環境濕度，保護皮膚屏障。";
  }
  if (level === 3) {
    if (indoorHumidity >= 80) {
      return "⚠️ 室內維持高濕狀態，皮膚容易悶熱、長小顆粒。建議開啟除濕機或空調除濕模式。";
    }
    if (indoorHumidity < 45) {
      return "⚠️ 冷氣房非常乾燥，皮膚水分持續散失。建議多補充水分，每2-3小時補擦保濕產品。";
    }
    return "⚠️ 今天環境對皮膚壓力較大，請減少戶外活動並主動調整室內濕度。";
  }
  if (level === 2) {
    if (indoorHumidity < 45) {
      return "😐 室內偏乾，皮膚水分容易流失。建議適度補充水分，使用保濕產品。";
    }
    if (indoorHumidity >= 75) {
      return "😐 室內濕度偏高，建議開啟除濕機或空調，保持皮膚乾爽。";
    }
    return "😐 濕度有明顯變化，進出冷氣房時可稍作停留適應。";
  }
  return "✅ 濕度穩定且介於理想範圍，皮膚屏障無顯著壓力，維持日常基礎保養即可。";
}

// ==========================================
// 產生 Flex Message - 第一頁：6都整體情況與趨勢
// ==========================================
async function generateOverviewFlex() {
  const date = new Date();
  const dateStr = `${date.getMonth()+1}/${date.getDate()}`;
  
  const cityData = [];
  for (const city of CITIES) {
    const data = await calculateCityIndex(city);
    cityData.push(data);
  }
  
  // 分類6都
  const dangerCities = cityData.filter(c => c.shock.level === 4);
  const highCities = cityData.filter(c => c.shock.level === 3);
  const mediumCities = cityData.filter(c => c.shock.level === 2);
  const lowCities = cityData.filter(c => c.shock.level === 1);
  
  return {
    type: "flex",
    altText: `🌡️💧 皮膚濕度壓力指數 ${dateStr}`,
    contents: {
      type: "carousel",
      contents: [
        // 第一頁：6都總覽
        {
          type: "bubble",
          size: "mega",
          header: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "🌡️💧 皮膚濕度壓力指數", weight: "bold", size: "xl", color: "#ffffff" },
              { type: "text", text: `${dateStr} 六都環境預報`, size: "sm", color: "#dddddd", margin: "xs" }
            ],
            backgroundColor: "#667eea",
            paddingAll: "20px"
          },
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [
              { type: "text", text: "📊 六都衝擊等級", weight: "bold", size: "md" },
              ...dangerCities.map(c => ({ type: "text", text: `${c.shock.emoji} ${c.city}：${c.shock.name}`, size: "sm", color: c.shock.color, margin: "xs" })),
              ...highCities.map(c => ({ type: "text", text: `${c.shock.emoji} ${c.city}：${c.shock.name}`, size: "sm", color: c.shock.color, margin: "xs" })),
              ...mediumCities.map(c => ({ type: "text", text: `${c.shock.emoji} ${c.city}：${c.shock.name}`, size: "sm", color: c.shock.color, margin: "xs" })),
              ...lowCities.map(c => ({ type: "text", text: `${c.shock.emoji} ${c.city}：${c.shock.name}`, size: "sm", color: c.shock.color, margin: "xs" })),
              { type: "separator", margin: "md" },
              { type: "text", text: "💡 點擊下方按鈕查看詳細建議", size: "xs", color: "#999999", align: "center" }
            ],
            paddingAll: "20px"
          },
          footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
              { type: "button", style: "primary", color: "#667eea", action: { type: "message", label: "📋 查看保健建議", text: "保健建議" } }
            ],
            paddingAll: "12px"
          }
        },
        // 第二頁：詳細保健建議 + 文獻依據
        {
          type: "bubble",
          size: "mega",
          header: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "📋 皮膚保健建議", weight: "bold", size: "xl", color: "#ffffff" }
            ],
            backgroundColor: "#667eea",
            paddingAll: "20px"
          },
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [
              { type: "text", text: "🟢 低衝擊", weight: "bold", size: "sm", color: "#00CC00" },
              { type: "text", text: "維持日常基礎保養，正常清潔與保濕，皮膚屏障無顯著壓力。", size: "xs", color: "#666666", wrap: true },
              { type: "text", text: "🟡 中衝擊", weight: "bold", size: "sm", color: "#FFCC00", margin: "md" },
              { type: "text", text: "加強保濕或除濕，進出冷氣房前稍作停留適應。", size: "xs", color: "#666666", wrap: true },
              { type: "text", text: "🟠 高衝擊", weight: "bold", size: "sm", color: "#FF6600", margin: "md" },
              { type: "text", text: "積極防護，減少戶外停留，主動調整室內濕度。", size: "xs", color: "#666666", wrap: true },
              { type: "text", text: "🔴 危險衝擊", weight: "bold", size: "sm", color: "#FF0000", margin: "md" },
              { type: "text", text: "盡量留在室內，立即調整環境濕度，保護皮膚屏障。", size: "xs", color: "#666666", wrap: true },
              { type: "separator", margin: "md" },
              { type: "text", text: "📖 文獻依據", weight: "bold", size: "sm" },
              { type: "text", text: "1. Denda et al. (2002) — 濕度突然下降會破壞皮膚屏障恆定", size: "xxs", color: "#999999", wrap: true },
              { type: "text", text: "2. 環境濕度與皮膚綜述 — 低濕導致乾燥、粗糙", size: "xxs", color: "#999999", wrap: true },
              { type: "text", text: "3. PMC (2019) — 高濕環境延緩脂質屏障形成", size: "xxs", color: "#999999", wrap: true },
              { type: "text", text: "4. 皮膚氣候趨勢綜述 (2024) — 濕度變化導致水分異常流失", size: "xxs", color: "#999999", wrap: true }
            ],
            paddingAll: "20px"
          },
          footer: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "📊 中央氣象署 | 室內濕度推算依據工研院實測", size: "xxs", color: "#999999", align: "center" }
            ],
            paddingAll: "12px"
          }
        }
      ]
    }
  };
}

// ==========================================
// 產生單一城市詳細 Flex Message
// ==========================================
async function generateCityDetailFlex(city) {
  const data = await calculateCityIndex(city);
  const date = new Date();
  const dateStr = `${date.getMonth()+1}/${date.getDate()}`;
  
  return {
    type: "flex",
    altText: `${city.displayName} 皮膚濕度壓力指數 ${data.shock.name}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "🌡️💧 皮膚濕度壓力指數", weight: "bold", size: "xl", color: "#ffffff" },
          { type: "text", text: `${city.displayName} ${dateStr}`, size: "sm", color: "#dddddd", margin: "xs" }
        ],
        backgroundColor: "#667eea",
        paddingAll: "20px"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "🏠 室內環境", weight: "bold", size: "sm" },
              { type: "text", text: `冷氣房 ${INDOOR_TEMP}℃`, size: "sm", color: "#666666", align: "end" }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "🌤️ 室外環境", weight: "bold", size: "sm" },
              { type: "text", text: `${data.tempOut}℃  ${data.humOut}%`, size: "sm", color: "#666666", align: "end" }
            ]
          },
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "💧 衝擊指數", weight: "bold", size: "md" },
              { type: "text", text: `${data.shock.name}`, weight: "bold", size: "lg", color: data.shock.color, align: "end" }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "室內濕度", size: "xs", color: "#999999" },
              { type: "text", text: `${data.indoorHumidity}%`, size: "sm", color: data.dryness.color, align: "end" }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "濕度變化", size: "xs", color: "#999999" },
              { type: "text", text: `${data.deltaRH}%`, size: "sm", color: "#666666", align: "end" }
            ]
          },
          {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "💡 建議", size: "xs", color: "#999999" },
              { type: "text", text: data.advice, size: "xs", color: "#666666", wrap: true }
            ]
          },
          { type: "separator", margin: "md" },
          { type: "text", text: "📖 本指數依據以下文獻設計：", size: "xxs", color: "#999999" },
          { type: "text", text: "Denda et al. (2002)、環境濕度與皮膚綜述、PMC (2019)、皮膚氣候趨勢綜述 (2024)", size: "xxs", color: "#999999", wrap: true }
        ],
        paddingAll: "20px"
      }
    }
  };
}

// ==========================================
// 產生保健建議 Flex Message
// ==========================================
async function generateAdviceFlex() {
  return {
    type: "flex",
    altText: "皮膚保健建議",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "📋 皮膚保健建議", weight: "bold", size: "xl", color: "#ffffff" }
        ],
        backgroundColor: "#667eea",
        paddingAll: "20px"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "🟢 低衝擊", weight: "bold", size: "sm", color: "#00CC00" },
          { type: "text", text: "維持日常基礎保養，正常清潔與保濕。", size: "xs", color: "#666666", wrap: true },
          { type: "text", text: "🟡 中衝擊", weight: "bold", size: "sm", color: "#FFCC00", margin: "md" },
          { type: "text", text: "乾燥型：提高保濕頻率，每2-3小時補擦保濕產品。", size: "xs", color: "#666666", wrap: true },
          { type: "text", text: "潮濕型：開啟除濕機，保持皮膚乾爽。", size: "xs", color: "#666666", wrap: true },
          { type: "text", text: "🟠 高衝擊", weight: "bold", size: "sm", color: "#FF6600", margin: "md" },
          { type: "text", text: "提前防護，減少長時間戶外停留，主動調整室內濕度。", size: "xs", color: "#666666", wrap: true },
          { type: "text", text: "🔴 危險衝擊", weight: "bold", size: "sm", color: "#FF0000", margin: "md" },
          { type: "text", text: "避免非必要外出，立即調整室內環境，觀察皮膚反應。", size: "xs", color: "#666666", wrap: true },
          { type: "separator", margin: "md" },
          { type: "text", text: "📖 文獻依據", weight: "bold", size: "sm" },
          { type: "text", text: "1. Denda et al. (2002) — 證實濕度突然下降會破壞皮膚屏障恆定", size: "xxs", color: "#999999", wrap: true },
          { type: "text", text: "2. 環境濕度與皮膚綜述 — 闡明低濕導致乾燥、粗糙", size: "xxs", color: "#999999", wrap: true },
          { type: "text", text: "3. 相對濕度對脂質屏障影響研究 (2019) — 高濕環境延緩屏障修復", size: "xxs", color: "#999999", wrap: true },
          { type: "text", text: "4. 急遽濕度變化導致皮膚水分異常流失 (2024) — 皮膚氣候趨勢綜述", size: "xxs", color: "#999999", wrap: true },
          { type: "separator", margin: "md" },
          { type: "text", text: "📊 燈號判定邏輯（取最高等級）", weight: "bold", size: "sm" },
          { type: "text", text: "路徑A（濕度衝擊）：依據 Delta_RH 與 RH_in 複合條件", size: "xxs", color: "#999999", wrap: true },
          { type: "text", text: "路徑B（極端穩態壓力）：Delta_RH < 15% 但 RH_in 落於極端區間", size: "xxs", color: "#999999", wrap: true }
        ],
        paddingAll: "20px"
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "📊 中央氣象署 | 室內濕度推算依據工研院實測數據", size: "xxs", color: "#999999", align: "center" }
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
  const overviewFlex = await generateOverviewFlex();
  await pushToSubscribersFlex(overviewFlex);
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
          await replyTextMessage(replyToken, 
            `🎉 歡迎加入【皮膚濕度壓力指數】！

📋 已為您自動開啟每日提醒，每天上午 7:00 收到六都環境預報。

📱 查詢方式：
• 輸入城市名稱（台北市、新北市、桃園市、台中市、台南市、高雄市）
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
            await replyTextMessage(replyToken, '✅ 訂閱成功！每天上午 7:00 收到六都環境預報。');
          } else {
            await replyTextMessage(replyToken, 'ℹ️ 您已經是訂閱用戶囉！');
          }
          continue;
        }
        
        if (input === '保健建議' || input === '保健指南') {
          const adviceFlex = await generateAdviceFlex();
          await replyFlexMessage(replyToken, adviceFlex);
          continue;
        }
        
        // 城市查詢（支援中文名稱）
        const matchedCity = CITIES.find(c => 
          input === c.displayName || 
          input === c.name || 
          input === c.displayName.replace('市', '').replace('臺', '台')
        );
        
        if (matchedCity) {
          const cityDetail = await generateCityDetailFlex(matchedCity);
          await replyFlexMessage(replyToken, cityDetail);
          continue;
        }
        
        // 無效輸入，顯示總覽
        const overviewFlex = await generateOverviewFlex();
        await replyFlexMessage(replyToken, overviewFlex);
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
  console.log(`🎨 訊息格式：Flex Message (卡片式)`);
  console.log(`📊 六都：${CITIES.map(c => c.displayName).join('、')}`);
  console.log(`========================================\n`);
});
