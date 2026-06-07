const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// ==========================================
// ⚠️ 请填入你的密钥 ⚠️
// ==========================================
const CHANNEL_ACCESS_TOKEN = 'yn5Na00wbNupb51o4eVC+GSvXbjqO2oaZURDj3IVHbcVwndFdmXK33Upu1y68YXrkcLFdA8uI5pjbAZ75WX/xIcmlNcjUEztbyBvT0f8Z9wedwylmDkXq2E1X+CuQhpjl/bQDNmT08b0XChzXshqRAdB04t89/1O/w1cDnyilFU=';
const CWA_AUTH_KEY = 'CWA-B59372C7-9BD4-44F8-B759-D6ED723C6BC4';
// ==========================================

// 城市列表（1码）
const CITIES = [
  { code: "1", name: "臺北市", displayName: "台北市" },
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

// 模拟数据（备用）
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
// 使用乡镇天气预报 API 获取天气
// ==========================================
async function getRealWeather(cityName) {
  // 正确的 dataid 对照表
  const DATAID_MAP = {
    "臺北市": "F-D0047-061",
    "新北市": "F-D0047-063",
    "基隆市": "F-D0047-001",
    "宜蘭縣": "F-D0047-003",
    "花蓮縣": "F-D0047-005",
    "臺東縣": "F-D0047-007",
    "屏東縣": "F-D0047-009",
    "高雄市": "F-D0047-067",
    "臺南市": "F-D0047-065",
    "雲林縣": "F-D0047-011",
    "嘉義縣": "F-D0047-013",
    "彰化縣": "F-D0047-015",
    "臺中市": "F-D0047-059",
    "南投縣": "F-D0047-017",
    "苗栗縣": "F-D0047-019",
    "桃園市": "F-D0047-055",
    "金門縣": "F-D0047-089",
    "澎湖縣": "F-D0047-091"
  };
  
  const dataid = DATAID_MAP[cityName];
  if (!dataid) {
    console.log(`❌ 找不到 ${cityName} 的 dataid`);
    return null;
  }
  
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${dataid}?Authorization=${CWA_AUTH_KEY}&format=JSON`;
  
  try {
    console.log(`🌤️ 正在获取 ${cityName} 真实天气...`);
    
    const response = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'LINE-Bot/1.0' }
    });
    
    const data = response.data;
    
    if (data.success !== "true") {
      console.log('❌ API 回传失败');
      return null;
    }
    
    const locations = data.records?.Locations;
    if (!locations || locations.length === 0) {
      console.log('❌ 找不到 Locations 资料');
      return null;
    }
    
    // 找到匹配的城市
    let targetLocation = null;
    for (let loc of locations) {
      if (loc.LocationsName === cityName) {
        targetLocation = loc;
        break;
      }
    }
    
    if (!targetLocation) {
      console.log(`❌ 找不到 ${cityName} 的 Locations 资料`);
      return null;
    }
    
    // 取第一个行政区
    const firstLocation = targetLocation.Location?.[0];
    if (!firstLocation) {
      console.log('❌ 找不到 Location 资料');
      return null;
    }
    
    const weatherElements = firstLocation.WeatherElement;
    
    // 找温度（可能是「溫度」或「平均温度」）
    let tempData = weatherElements.find(w => 
      w.ElementName === "溫度" || w.ElementName === "平均温度"
    );
    
    // 找湿度
    let humData = weatherElements.find(w => 
      w.ElementName === "相對濕度" || w.ElementName === "平均相对湿度"
    );
    
    if (!tempData || !humData) {
      console.log('❌ 找不到温度或湿度资料');
      return null;
    }
    
    // 取值
    let temp = null;
    let humidity = null;
    
    if (tempData.Time?.[0]?.ElementValue?.[0]?.Temperature) {
      temp = tempData.Time[0].ElementValue[0].Temperature;
    } else if (tempData.Time?.[0]?.ElementValue?.[0]?.value) {
      temp = tempData.Time[0].ElementValue[0].value;
    } else if (tempData.Time?.[0]?.ElementValue?.[0]?.平均温度) {
      temp = tempData.Time[0].ElementValue[0].平均温度;
    }
    
    if (humData.Time?.[0]?.ElementValue?.[0]?.RelativeHumidity) {
      humidity = humData.Time[0].ElementValue[0].RelativeHumidity;
    } else if (humData.Time?.[0]?.ElementValue?.[0]?.value) {
      humidity = humData.Time[0].ElementValue[0].value;
    } else if (humData.Time?.[0]?.ElementValue?.[0]?.平均相对湿度) {
      humidity = humData.Time[0].ElementValue[0].平均相对湿度;
    }
    
    if (temp && humidity) {
      console.log(`✅ ${cityName} 真实天气: ${temp}℃, ${humidity}%`);
      return { temp: parseFloat(temp), humidity: parseFloat(humidity) };
    }
    
    console.log(`❌ 温度或湿度值为空`);
    return null;
  } catch (e) {
    console.error(`❌ 获取 ${cityName} 天气失败:`, e.message);
    return null;
  }
}

// 取得天气（真实 API + 模拟备援）
async function getWeather(cityName) {
  const realWeather = await getRealWeather(cityName);
  if (realWeather) {
    return realWeather;
  }
  console.log(`真实 API 失败，改用模拟数据: ${cityName}`);
  return MOCK_WEATHER[cityName] || { temp: 28, humidity: 60 };
}

// 计算合并指数
async function getCombinedIndex(city) {
  const weather = await getWeather(city.name);
  const isRealData = weather !== MOCK_WEATHER[city.name];
  
  const deltaTemp = Math.max(0, weather.temp - INDOOR_TEMP);
  const drynessScore = (deltaTemp / 12) * 50 + Math.max(0, 55 - weather.humidity) * 1.5;
  
  let drynessLevel = "🟢 低";
  let drynessAdvice = "✅ 状况良好";
  if (drynessScore >= 75) {
    drynessLevel = "🔴 危险";
    drynessAdvice = "🔥 请立即加强保湿，避免长时间吹冷气。";
  } else if (drynessScore >= 50) {
    drynessLevel = "🟠 高";
    drynessAdvice = "⚠️ 建议使用保湿乳液。";
  } else if (drynessScore >= 25) {
    drynessLevel = "🟡 中";
    drynessAdvice = "😐 可适度补充水分。";
  }
  
  const shock = Math.abs(weather.humidity - INDOOR_HUM);
  let shockLevel = "🟢 低";
  let shockAdvice = "✅ 进出舒适";
  if (shock >= 30) {
    shockLevel = "🔴 危险";
    shockAdvice = "🔥 湿度冲击剧烈！进出冷气房请注意身体调节。";
  } else if (shock >= 20) {
    shockLevel = "🟠 高";
    shockAdvice = "⚠️ 湿度落差大，建议缓慢进出室内外。";
  } else if (shock >= 10) {
    shockLevel = "🟡 中";
    shockAdvice = "😐 有些微冲击感，一般体质可适应。";
  }
  
  const dataSource = isRealData ? "中央气象署即时资料" : "模拟数据";
  
  return `🌤️ 【${city.displayName} 环境指数】

🌡️ 皮肤干燥指数：${drynessLevel} (${Math.round(drynessScore)}分)
   • 室外 ${weather.temp}℃ / 室内 ${INDOOR_TEMP}℃
   • 室外湿度 ${weather.humidity}% / 室内 ${INDOOR_HUM}%
   💡 ${drynessAdvice}

💧 湿度冲击指数：${shockLevel} (冲击差 ${Math.round(shock)}%)
   • 室外湿度 ${weather.humidity}% → 室内 ${INDOOR_HUM}%
   💡 ${shockAdvice}

📊 资料来源：${dataSource}`;
}

// ==========================================
// LINE Webhook 入口
// ==========================================
app.post('/webhook', async (req, res) => {
  console.log('收到请求');
  
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
    console.error('Webhook 错误:', err);
    res.status(200).send('OK');
  }
});

// 发送左右滑动的城市选单
async function sendCityMenu(replyToken) {
  const carousel = {
    type: 'flex',
    altText: '请选择城市查询环境指数',
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
            { type: 'text', text: '皮肤干燥指数 + 湿度冲击指数', size: 'sm', color: '#666666', align: 'center', wrap: true },
            { type: 'separator', margin: 'md' },
            { type: 'text', text: '📊 点下方按钮查询', size: 'sm', color: '#AAAAAA', align: 'center' }
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
              label: '🔍 查询',
              data: `city=${city.code}`,
              displayText: `查询 ${city.displayName}`
            }
          }]
        }
      }))
    }
  };
  
  await replyMessage(replyToken, [carousel]);
}

// 回复 LINE 消息
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
    console.log('回复成功');
  } catch (err) {
    console.error('回复失败:', err.response?.data || err.message);
  }
}

// 健康检查
app.get('/', (req, res) => {
  res.send('✅ LINE Bot 已上线！\n\n输入代码查询环境指数：1=台北市，2=新北市...');
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`真实 API 已启用`);
});
