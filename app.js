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

// 城市列表（使用新 API 的正確 dataid）
const CITIES = [
  { code: "1", name: "臺北市", displayName: "臺北市", dataid: "F-C0032-001" },
  { code: "2", name: "新北市", displayName: "新北市", dataid: "F-C0032-002" },
  { code: "3", name: "基隆市", displayName: "基隆市", dataid: "F-C0032-003" },
  { code: "4", name: "宜蘭縣", displayName: "宜蘭縣", dataid: "F-C0032-004" },
  { code: "5", name: "花蓮縣", displayName: "花蓮縣", dataid: "F-C0032-005" },
  { code: "6", name: "臺東縣", displayName: "台東縣", dataid: "F-C0032-006" },
  { code: "7", name: "屏東縣", displayName: "屏東縣", dataid: "F-C0032-007" },
  { code: "8", name: "高雄市", displayName: "高雄市", dataid: "F-C0032-008" },
  { code: "9", name: "臺南市", displayName: "台南市", dataid: "F-C0032-009" },
  { code: "A", name: "雲林縣", displayName: "雲林縣", dataid: "F-C0032-010" },
  { code: "B", name: "嘉義縣", displayName: "嘉義縣", dataid: "F-C0032-011" },
  { code: "C", name: "彰化縣", displayName: "彰化縣", dataid: "F-C0032-012" },
  { code: "D", name: "臺中市", displayName: "台中市", dataid: "F-C0032-013" },
  { code: "E", name: "南投縣", displayName: "南投縣", dataid: "F-C0032-014" },
  { code: "F", name: "苗栗縣", displayName: "苗栗縣", dataid: "F-C0032-015" },
  { code: "G", name: "桃園市", displayName: "桃園市", dataid: "F-C0032-016" },
  { code: "H", name: "金門縣", displayName: "金門縣", dataid: "F-C0032-017" },
  { code: "I", name: "澎湖縣", displayName: "澎湖縣", dataid: "F-C0032-018" }
];

// 類比資料（當 API 失敗時使用）
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
// 從中央氣象署獲取真實天氣（新版 API）
// ==========================================
async function getRealWeather(city) {
  const { dataid, name, displayName } = city;
  
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${dataid}?Authorization=${CWA_AUTH_KEY}&format=JSON`;
  
  try {
    console.log(`🌤️ 正在獲取 ${displayName} 真實天氣... (dataid: ${dataid})`);
    
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'LINE-Bot/1.0' }
    });
    
    const data = response.data;
    
    // 檢查 API 回應狀態
    if (data.success !== "true") {
      console.log(`❌ API 回傳失敗: ${data.success}`);
      return null;
    }
    
    // 新版 API 的資料結構
    // data.records.Locations[0].Location[]
    const records = data.records;
    if (!records || !records.Locations || records.Locations.length === 0) {
      console.log('❌ 找不到 Locations 資料');
      return null;
    }
    
    const locations = records.Locations[0];
    const locationArray = locations.Location;
    
    if (!locationArray || locationArray.length === 0) {
      console.log('❌ 找不到 Location 陣列');
      return null;
    }
    
    // 取第一個鄉鎮市區的資料作為代表
    const firstLocation = locationArray[0];
    const weatherElements = firstLocation.WeatherElement;
    
    if (!weatherElements) {
      console.log('❌ 找不到 WeatherElement');
      return null;
    }
    
    // 找溫度（ElementName 可能是 "平均溫度" 或 "溫度"）
    let tempData = weatherElements.find(w => w.ElementName === "平均溫度");
    if (!tempData) {
      tempData = weatherElements.find(w => w.ElementName === "溫度");
    }
    
    // 找相對濕度
    let humData = weatherElements.find(w => w.ElementName === "相對濕度");
    if (!humData) {
      humData = weatherElements.find(w => w.ElementName === "平均相對濕度");
    }
    
    if (!tempData || !humData) {
      console.log(`❌ 找不到溫度或濕度資料`);
      console.log(`   可用的 ElementName: ${weatherElements.map(w => w.ElementName).join(', ')}`);
      return null;
    }
    
    // 取值：通常 Time 陣列第一筆是即時或最近預報
    let temp = null;
    let humidity = null;
    
    if (tempData.Time && tempData.Time.length > 0) {
      const elementValue = tempData.Time[0].ElementValue;
      if (elementValue && elementValue.length > 0) {
        // 可能是 value 或 Temperature 欄位
        temp = elementValue[0].value || elementValue[0].Temperature;
      }
    }
    
    if (humData.Time && humData.Time.length > 0) {
      const elementValue = humData.Time[0].ElementValue;
      if (elementValue && elementValue.length > 0) {
        humidity = elementValue[0].value || elementValue[0].RelativeHumidity;
      }
    }
    
    if (temp && humidity) {
      const tempNum = parseFloat(temp);
      const humNum = parseFloat(humidity);
      console.log(`✅ ${displayName} 真實天氣: ${tempNum}℃, ${humNum}%`);
      return { temp: tempNum, humidity: humNum };
    }
    
    console.log(`⚠️ 溫度或濕度值無效: temp=${temp}, humidity=${humidity}`);
    return null;
    
  } catch (e) {
    console.error(`❌ 獲取 ${displayName} 天氣失敗:`, e.message);
    if (e.response) {
      console.error(`   HTTP ${e.response.status}: ${JSON.stringify(e.response.data).substring(0, 200)}`);
    }
    return null;
  }
}

// 取得天氣（真實 API + 模擬備援）
async function getWeather(city) {
  try {
    const realWeather = await getRealWeather(city);
    if (realWeather && realWeather.temp && realWeather.humidity) {
      return realWeather;
    }
  } catch (e) {
    console.log(`真實 API 異常: ${e.message}`);
  }
  
  console.log(`📦 使用類比資料: ${city.displayName}`);
  return MOCK_WEATHER[city.name] || { temp: 28, humidity: 60 };
}

// 計算合併指數
async function getCombinedIndex(city) {
  const weather = await getWeather(city);
  const isRealData = weather !== MOCK_WEATHER[city.name];
  
  const deltaTemp = Math.max(0, weather.temp - INDOOR_TEMP);
  const drynessScore = (deltaTemp / 12) * 50 + Math.max(0, 55 - weather.humidity) * 1.5;
  
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
  
  const dataSource = isRealData ? "🌐 中央氣象署即時資料" : "📋 類比資料（API 暫時無法使用）";
  
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
// LINE Webhook 入口
// ==========================================
app.post('/webhook', async (req, res) => {
  console.log('📨 收到 Webhook 請求');
  
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
          console.log(`📱 用戶查詢: ${city.displayName} (代碼: ${userInput})`);
          const replyText = await getCombinedIndex(city);
          await replyMessage(replyToken, replyText);
        } else {
          console.log(`📱 用戶輸入無效代碼: ${userInput}，顯示選單`);
          await sendCityMenu(replyToken);
        }
      }
      
      if (event.type === 'postback') {
        const data = event.postback.data;
        if (data && data.startsWith('city=')) {
          const cityCode = data.split('=')[1];
          const city = CITIES.find(c => c.code === cityCode);
          if (city) {
            console.log(`📱 用戶從選單查詢: ${city.displayName}`);
            const replyText = await getCombinedIndex(city);
            await replyMessage(replyToken, replyText);
          }
        }
      }
    }
    
    res.status(200).send('OK');
  } catch (err) {
    console.error('❌ Webhook 錯誤:', err);
    res.status(200).send('OK');
  }
});

// 發送左右滑動的城市選單
async function sendCityMenu(replyToken) {
  // 將城市分成多個 bubble（LINE Flex Carousel 最多 12 個，這裡全部顯示）
  const carousel = {
    type: 'flex',
    altText: '請選擇城市查詢環境指數',
    contents: {
      type: 'carousel',
      contents: CITIES.map(city => ({
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents: [
            { type: 'text', text: `🌡️💧 ${city.displayName}`, weight: 'bold', size: 'xl', align: 'center' },
            { type: 'text', text: '皮膚乾燥指數 + 濕度衝擊指數', size: 'sm', color: '#666666', align: 'center', wrap: true },
            { type: 'separator', margin: 'md' },
            { type: 'text', text: '📊 點下方按鈕查詢', size: 'sm', color: '#AAAAAA', align: 'center' }
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
  
  await replyMessage(replyToken, [carousel]);
}

// 回復 LINE 消息
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
  res.send(`
    ✅ LINE Bot 已上線！
    
    輸入代碼查詢環境指數：
    1=臺北市, 2=新北市, 3=基隆市, 4=宜蘭縣, 5=花蓮縣, 6=臺東縣
    7=屏東縣, 8=高雄市, 9=臺南市, A=雲林縣, B=嘉義縣, C=彰化縣
    D=臺中市, E=南投縣, F=苗栗縣, G=桃園市, H=金門縣, I=澎湖縣
    
    或輸入任意文字顯示選單
  `);
});

// 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 使用中央氣象署新版 API (F-C0032-xxx 鄉鎮預報)`);
  console.log(`🔑 API Key: ${CWA_AUTH_KEY.substring(0, 10)}...`);
});
