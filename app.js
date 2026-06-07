const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// ==========================================
// ⚠️ 請填入你的金鑰 ⚠️
// ==========================================
const CHANNEL_ACCESS_TOKEN = '你的LINE Channel Access Token';
const CWA_AUTH_KEY = '你的中央氣象署授權碼';
// ==========================================

// 城市列表（1碼）
const CITIES = [
  { code: "1", name: "臺北市", displayName: "臺北市" },
  { code: "2", name: "新北市", displayName: "新北市" },
  { code: "3", name: "基隆市", displayName: "基隆市" },
  { code: "4", name: "宜蘭縣", displayName: "宜蘭縣" },
  { code: "5", name: "花蓮縣", displayName: "花蓮縣" },
  { code: "6", name: "臺東縣", displayName: "台東縣" },
  { code: "7", name: "屏東縣", displayName: "屏東縣" },
  { code: "8", name: "高雄市", displayName: "高雄市" },
  { code: "9", name: "臺南市", displayName: "台南市" },
  { code: "A", name: "雲林縣", displayName: "雲林縣" },
  { code: "B", name: "嘉義縣", displayName: "嘉義縣" },
  { code: "C", name: "彰化縣", displayName: "彰化縣" },
  { code: "D", name: "臺中市", displayName: "台中市" },
  { code: "E", name: "南投縣", displayName: "南投縣" },
  { code: "F", name: "苗栗縣", displayName: "苗栗縣" },
  { code: "G", name: "桃園市", displayName: "桃園市" },
  { code: "H", name: "金門縣", displayName: "金門縣" },
  { code: "I", name: "澎湖縣", displayName: "澎湖縣" }
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
// 使用觀測資料 API 獲取天氣
// ==========================================
async function getRealWeather(cityName) {
  // 使用觀測資料 API (O-A0001-001)
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?Authorization=${CWA_AUTH_KEY}&format=JSON&locationName=${encodeURIComponent(cityName)}`;
  
  try {
    console.log(`🌤️ 正在獲取 ${cityName} 真實天氣...`);
    
    const response = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'LINE-Bot/1.0' }
    });
    
    const data = response.data;
    
    if (data.success !== "true") {
      console.log('❌ API 回傳失敗');
      return null;
    }
    
    const locations = data.records?.location;
    if (!locations || locations.length === 0) {
      console.log('❌ 找不到 location 資料');
      return null;
    }
    
    // 找到匹配的城市
    let targetLocation = null;
    for (let loc of locations) {
      const locName = loc.locationName;
      // 寬鬆匹配
      if (locName === cityName || 
          locName.includes(cityName) || 
          cityName.includes(locName)) {
        targetLocation = loc;
        console.log(`✅ 匹配成功: ${locName}`);
        break;
      }
    }
    
    if (!targetLocation) {
      console.log(`❌ 找不到 ${cityName} 的資料`);
      return null;
    }
    
    const weatherElements = targetLocation.weatherElement;
    
    // 找溫度
    const tempData = weatherElements.find(w => 
      w.elementName === "溫度" || 
      w.elementName === "AirTemperature" ||
      w.elementName === "溫度"
    );
    
    // 找濕度
    const humData = weatherElements.find(w => 
      w.elementName === "相對濕度" || 
      w.elementName === "RelativeHumidity" ||
      w.elementName === "相對濕度"
    );
    
    if (!tempData || !humData) {
      console.log('❌ 找不到溫度或濕度資料');
      return null;
    }
    
    // 取最新時間點的值
    let temp = null;
    let humidity = null;
    
    if (tempData.time && tempData.time.length > 0) {
      const tempValue = tempData.time[0].elementValue;
      temp = tempValue?.value || tempValue?.Temperature;
    }
    
    if (humData.time && humData.time.length > 0) {
      const humValue = humData.time[0].elementValue;
      humidity = humValue?.value || humValue?.RelativeHumidity;
    }
    
    if (temp && humidity) {
      console.log(`✅ ${cityName} 真實天氣: ${temp}℃, ${humidity}%`);
      return { temp: parseFloat(temp), humidity: parseFloat(humidity) };
    }
    
    console.log(`❌ 溫度或濕度值為空: temp=${temp}, humidity=${humidity}`);
    return null;
  } catch (e) {
    console.error(`❌ 獲取 ${cityName} 天氣失敗:`, e.message);
    return null;
  }
}

// 取得天氣（真實 API + 模擬備援）
async function getWeather(cityName) {
  try {
    const realWeather = await getRealWeather(cityName);
    if (realWeather && realWeather.temp && realWeather.humidity) {
      return realWeather;
    }
  } catch (e) {
    console.log(`真實 API 異常: ${e.message}`);
  }
  
  console.log(`使用類比資料: ${cityName}`);
  return MOCK_WEATHER[cityName] || { temp: 28, humidity: 60 };
}

// 計算合併指數
async function getCombinedIndex(city) {
  const weather = await getWeather(city.name);
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
  
  const dataSource = isRealData ? "中央氣象署觀測資料" : "類比資料";
  
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
  console.log('收到請求');
  
  try {
    const events = req.body.events;
    if (!events) return res.status(200).send('OK');
    
    for (let event of events) {
      const replyToken = event.replyToken;
      
      if (event.type === 'message' && event.message.type === 'text') {
        const userInput = event.message.text.trim().toUpperCase();
        const city = CITIES.find(c => c.code === userInput);
        
        if (city) {
          const replyText = await getCombinedIndex(city);
          await replyMessage(replyToken, replyText);
        } else {
          await sendCityMenu(replyToken);
        }
      }
      
      if (event.type === 'postback') {
        const data = event.postback.data;
        if (data && data.startsWith('city=')) {
          const cityCode = data.split('=')[1];
          const city = CITIES.find(c => c.code === cityCode);
          if (city) {
            const replyText = await getCombinedIndex(city);
            await replyMessage(replyToken, replyText);
          }
        }
      }
    }
    
    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook 錯誤:', err);
    res.status(200).send('OK');
  }
});

// 發送左右滑動的城市選單
async function sendCityMenu(replyToken) {
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
    console.log('回復成功');
  } catch (err) {
    console.error('回復失敗:', err.response?.data || err.message);
  }
}

// 健康檢查
app.get('/', (req, res) => {
  res.send('✅ LINE Bot 已上線！\n\n輸入代碼查詢環境指數：1=臺北市，2=新北市...');
});

// 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`觀測資料 API 已啟用`);
});
