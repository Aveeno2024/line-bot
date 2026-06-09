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
  
  let drynessLevel, drynessLevelEn, drynessColor, drynessAdvice;
  if (drynessScore >= THRESHOLDS.DRYNESS.HIGH) {
    drynessLevel = "危險";
    drynessLevelEn = "DANGER";
    drynessColor = "#FF0000";
    drynessAdvice = "🔥 請立即加強保濕，避免長時間吹冷氣";
  } else if (drynessScore >= THRESHOLDS.DRYNESS.MEDIUM) {
    drynessLevel = "高";
    drynessLevelEn = "HIGH";
    drynessColor = "#FF6600";
    drynessAdvice = "⚠️ 建議使用保濕乳液，多補充水分";
  } else if (drynessScore >= THRESHOLDS.DRYNESS.LOW) {
    drynessLevel = "中";
    drynessLevelEn = "MEDIUM";
    drynessColor = "#FFCC00";
    drynessAdvice = "😐 可適度補充水分，保持肌膚滋潤";
  } else {
    drynessLevel = "低";
    drynessLevelEn = "LOW";
    drynessColor = "#00CC00";
    drynessAdvice = "✅ 狀況良好，持續保持";
  }
  
  let shockLevel, shockLevelEn, shockColor, shockAdvice;
  if (shockValue >= THRESHOLDS.SHOCK.HIGH) {
    shockLevel = "危險";
    shockLevelEn = "DANGER";
    shockColor = "#FF0000";
    shockAdvice = "🔥 濕度衝擊劇烈！進出冷氣房請注意身體調節";
  } else if (shockValue >= THRESHOLDS.SHOCK.MEDIUM) {
    shockLevel = "高";
    shockLevelEn = "HIGH";
    shockColor = "#FF6600";
    shockAdvice = "⚠️ 濕度落差大，建議緩慢進出室內外";
  } else if (shockValue >= THRESHOLDS.SHOCK.LOW) {
    shockLevel = "中";
    shockLevelEn = "MEDIUM";
    shockColor = "#FFCC00";
    shockAdvice = "😐 有些微衝擊感，一般體質可適應";
  } else {
    shockLevel = "低";
    shockLevelEn = "LOW";
    shockColor = "#00CC00";
    shockAdvice = "✅ 進出舒適，身體適應良好";
  }
  
  return {
    indoorHumidity,
    drynessScore: Math.round(drynessScore),
    drynessLevel,
    drynessLevelEn,
    drynessColor,
    drynessAdvice,
    shockValue: Math.round(shockValue),
    shockLevel,
    shockLevelEn,
    shockColor,
    shockAdvice
  };
}

// ==========================================
// 產生 Flex Message
// ==========================================
function generateFlexMessage(city, weather, index) {
  const date = new Date();
  const dateStr = `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2,'0')}`;
  
  return {
    type: "flex",
    altText: `【${city.displayName}】皮膚乾燥${index.drynessLevel} / 濕度衝擊${index.shockLevel}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "🌡️💧 皮膚濕度衝擊指數",
            weight: "bold",
            size: "xl",
            color: "#ffffff"
          },
          {
            type: "text",
            text: city.displayName,
            weight: "bold",
            size: "lg",
            color: "#ffffff",
            margin: "xs"
          },
          {
            type: "text",
            text: dateStr,
            size: "sm",
            color: "#dddddd",
            margin: "xs"
          }
        ],
        backgroundColor: "#667eea",
        paddingAll: "20px"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          // 室內環境說明
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "🏠 室內環境", weight: "bold", size: "sm" },
              { type: "text", text: `冷氣房 ${INDOOR_TEMP}℃`, size: "sm", color: "#666666", align: "end" }
            ]
          },
          // 室外環境
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "🌤️ 室外環境", weight: "bold", size: "sm" },
              { type: "text", text: `${weather.temp}℃  ${weather.humidity}%`, size: "sm", color: "#666666", align: "end" }
            ]
          },
          { type: "separator", margin: "md" },
          // 皮膚乾燥指數標題
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "🌡️ 皮膚乾燥指數", weight: "bold", size: "md" },
              { type: "text", text: `${index.drynessScore}分`, weight: "bold", size: "lg", color: index.drynessColor, align: "end" }
            ]
          },
          // 乾燥指數燈號
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "燈號", size: "xs", color: "#999999" },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "●", size: "lg", color: index.drynessColor },
                  { type: "text", text: ` ${index.drynessLevel} (${index.drynessLevelEn})`, size: "xs", color: "#666666" }
                ],
                align: "end"
              }
            ]
          },
          // 乾燥指數建議
          {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "💡 建議", size: "xs", color: "#999999" },
              { type: "text", text: index.drynessAdvice, size: "xs", color: "#666666", wrap: true }
            ]
          },
          { type: "separator", margin: "md" },
          // 濕度衝擊指數標題
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "💧 濕度衝擊指數", weight: "bold", size: "md" },
              { type: "text", text: `${index.shockValue}%`, weight: "bold", size: "lg", color: index.shockColor, align: "end" }
            ]
          },
          // 衝擊指數燈號
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "燈號", size: "xs", color: "#999999" },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "●", size: "lg", color: index.shockColor },
                  { type: "text", text: ` ${index.shockLevel} (${index.shockLevelEn})`, size: "xs", color: "#666666" }
                ],
                align: "end"
              }
            ]
          },
          // 衝擊指數建議
          {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "💡 建議", size: "xs", color: "#999999" },
              { type: "text", text: index.shockAdvice, size: "xs", color: "#666666", wrap: true }
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
          { type: "separator" },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "📊 中央氣象署", size: "xxs", color: "#999999" },
              { type: "text", text: "依據 Denda et al. 2002", size: "xxs", color: "#999999", align: "end" }
            ]
          }
        ],
        paddingAll: "12px"
      }
    }
  };
}

// ==========================================
// 產生全台摘要 Flex Message
// ==========================================
async function generateTaiwanSummaryFlex() {
  const results = [];
  
  for (const city of CITIES) {
    const weather = await getWeather(city);
    const index = calculateIndex(weather);
    results.push({
      city: city.displayName,
      shockValue: index.shockValue,
      shockLevel: index.shockLevel,
      shockColor: index.shockColor
    });
    await new Promise(r => setTimeout(r, 300));
  }
  
  const date = new Date();
  const dateStr = `${date.getMonth()+1}/${date.getDate()}`;
  
  // 分類城市
  const danger = results.filter(r => r.shockValue >= 30);
  const high = results.filter(r => r.shockValue >= 20 && r.shockValue < 30);
  const medium = results.filter(r => r.shockValue >= 10 && r.shockValue < 20);
  const low = results.filter(r => r.shockValue < 10);
  
  const cityListContents = [];
  
  if (danger.length > 0) {
    cityListContents.push(
      { type: "text", text: "🔴 危險衝擊 (≥30%)", weight: "bold", size: "sm", color: "#FF0000", margin: "md" },
      { type: "text", text: danger.map(c => c.city).join("、"), size: "xs", color: "#666666", wrap: true }
    );
  }
  
  if (high.length > 0) {
    cityListContents.push(
      { type: "text", text: "🟠 高衝擊 (20-29%)", weight: "bold", size: "sm", color: "#FF6600", margin: "md" },
      { type: "text", text: high.map(c => c.city).join("、"), size: "xs", color: "#666666", wrap: true }
    );
  }
  
  if (medium.length > 0) {
    cityListContents.push(
      { type: "text", text: "🟡 中衝擊 (10-19%)", weight: "bold", size: "sm", color: "#FFCC00", margin: "md" },
      { type: "text", text: medium.map(c => c.city).join("、"), size: "xs", color: "#666666", wrap: true }
    );
  }
  
  if (low.length > 0) {
    cityListContents.push(
      { type: "text", text: "🟢 低衝擊 (<10%)", weight: "bold", size: "sm", color: "#00CC00", margin: "md" },
      { type: "text", text: low.map(c => c.city).join("、"), size: "xs", color: "#666666", wrap: true }
    );
  }
  
  return {
    type: "flex",
    altText: `全台皮膚濕度衝擊指數摘要 ${dateStr}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "🌡️💧 全台皮膚濕度衝擊指數",
            weight: "bold",
            size: "xl",
            color: "#ffffff"
          },
          {
            type: "text",
            text: dateStr,
            size: "sm",
            color: "#dddddd",
            margin: "xs"
          }
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
              { type: "text", text: `${INDOOR_TEMP}℃ / 濕度 = 室外 × ${INDOOR_HUM_RATIO}`, size: "xs", color: "#666666", align: "end" }
            ]
          },
          { type: "separator", margin: "md" },
          ...cityListContents,
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "💡 查詢詳細指數", size: "xs", color: "#999999" },
              { type: "text", text: "輸入城市代碼 (1=臺北市, 2=新北市...)", size: "xxs", color: "#AAAAAA", wrap: true }
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
          { type: "separator" },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "📊 中央氣象署", size: "xxs", color: "#999999" },
              { type: "text", text: "依據 Denda et al. 2002", size: "xxs", color: "#999999", align: "end" }
            ]
          }
        ],
        paddingAll: "12px"
      }
    }
  };
}

// ==========================================
// 發送 Flex Message
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
      console.error(`❌ 推播失敗: ${userId}`, err.response?.data || err.message);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

async function dailyPublishTask() {
  console.log(`\n📅 ===== 開始每日發布任務 ${new Date().toLocaleString()} =====`);
  
  const summaryFlex = await generateTaiwanSummaryFlex();
  await pushToSubscribersFlex(summaryFlex);
  
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
      
      if (event.type === 'follow') {
        const userId = event.source.userId;
        if (!subscribers.includes(userId)) {
          subscribers.push(userId);
          saveSubscribers();
          console.log(`✅ 新用戶加入並自動訂閱: ${userId}`);
          await replyFlexMessage(replyToken, {
            type: "flex",
            altText: "歡迎加入皮膚濕度衝擊指數",
            contents: {
              type: "bubble",
              header: {
                type: "box",
                layout: "vertical",
                contents: [
                  { type: "text", text: "🎉 歡迎加入", weight: "bold", size: "xl", color: "#ffffff" }
                ],
                backgroundColor: "#667eea",
                paddingAll: "20px"
              },
              body: {
                type: "box",
                layout: "vertical",
                spacing: "md",
                contents: [
                  { type: "text", text: "已為您自動開啟每日提醒", weight: "bold", size: "md" },
                  { type: "text", text: "每天上午 9:00 收到全台指數摘要", size: "sm", color: "#666666" },
                  { type: "separator", margin: "md" },
                  { type: "text", text: "📱 查詢方式", weight: "bold", size: "sm" },
                  { type: "text", text: "• 輸入城市代碼（1=臺北市）", size: "xs", color: "#666666" },
                  { type: "text", text: "• 輸入「全台」查詢今日摘要", size: "xs", color: "#666666" },
                  { type: "separator", margin: "md" },
                  { type: "text", text: "🔔 訂閱管理", weight: "bold", size: "sm" },
                  { type: "text", text: "• 輸入「加入訂閱」開啟", size: "xs", color: "#666666" },
                  { type: "text", text: "• 輸入「取消訂閱」關閉", size: "xs", color: "#666666" }
                ],
                paddingAll: "20px"
              }
            }
          });
        }
        continue;
      }
      
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
      
      if (event.type === 'message' && event.message.type === 'text') {
        const input = event.message.text.trim();
        const userId = event.source.userId;
        
        if (input === '取消訂閱') {
          const idx = subscribers.indexOf(userId);
          if (idx !== -1) {
            subscribers.splice(idx, 1);
            saveSubscribers();
            await replyTextMessage(replyToken, '✅ 已取消每日提醒！如需重新開啟，請輸入「加入訂閱」');
          } else {
            await replyTextMessage(replyToken, 'ℹ️ 您尚未訂閱每日提醒，無需取消。');
          }
          continue;
        }
        
        if (input === '加入訂閱') {
          if (!subscribers.includes(userId)) {
            subscribers.push(userId);
            saveSubscribers();
            await replyTextMessage(replyToken, '✅ 訂閱成功！每天上午 9:00 會收到全台指數摘要。');
          } else {
            await replyTextMessage(replyToken, 'ℹ️ 您已經是訂閱用戶囉！');
          }
          continue;
        }
        
        if (input === '全台' || input === 'ALL') {
          const summaryFlex = await generateTaiwanSummaryFlex();
          await replyFlexMessage(replyToken, summaryFlex);
          continue;
        }
        
        const upperInput = input.toUpperCase();
        const city = CITIES.find(c => c.code === upperInput);
        
        if (city) {
          const weather = await getWeather(city);
          const index = calculateIndex(weather);
          const flexMessage = generateFlexMessage(city, weather, index);
          await replyFlexMessage(replyToken, flexMessage);
        } else {
          await replyTextMessage(replyToken, `📱 請輸入城市代碼查詢：

1=臺北市  2=新北市  3=基隆市
4=宜蘭縣  5=花蓮縣  6=臺東縣
7=屏東縣  8=高雄市  9=臺南市
A=雲林縣  B=嘉義縣  C=彰化縣
D=臺中市  E=南投縣  F=苗栗縣
G=桃園市  H=金門縣  I=澎湖縣

輸入「全台」查詢今日摘要
輸入「加入訂閱」開啟每日提醒`);
        }
      }
    }
  } catch (err) {
    console.error('處理錯誤:', err);
  }
});

// ==========================================
// 發送 Flex Message
// ==========================================
async function replyFlexMessage(replyToken, flexMessage) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: [flexMessage]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`
      }
    });
    console.log('✅ Flex Message 回復成功');
  } catch (err) {
    console.error('❌ 回復失敗:', err.response?.data || err.message);
  }
}

async function replyTextMessage(replyToken, text) {
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
    console.log('✅ 文字回復成功');
  } catch (err) {
    console.error('❌ 回復失敗:', err.response?.data || err.message);
  }
}

app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '皮膚濕度衝擊指數 Bot 運行中 (Flex Message)',
    indoorTemp: INDOOR_TEMP,
    indoorHumRatio: INDOOR_HUM_RATIO,
    subscribers: subscribers.length
  });
});

// ==========================================
// 設定每日排程（台灣時間早上 9:00 發布）
// ==========================================
schedule.scheduleJob('0 1 * * *', () => {
  const now = new Date();
  console.log(`📅 執行每日推播 - 伺服器時間: ${now.toLocaleString()}`);
  dailyPublishTask();
});

console.log('📅 已設定每日發布排程：每天早上 9:00 (台灣時間)');

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 ========================================`);
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🏠 室內基準：${INDOOR_TEMP}℃ / 濕度 = 室外 × ${INDOOR_HUM_RATIO}`);
  console.log(`📖 科學依據：Denda et al. (2002)、PMC (2019) 等`);
  console.log(`📅 每日推播時間：上午 9:00 (台灣時間)`);
  console.log(`🎨 訊息格式：Flex Message (卡片式)`);
  console.log(`========================================\n`);
});
