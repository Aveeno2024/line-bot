const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// ==========================================
// ⚠️ 请填入你的密钥 ⚠️
// ==========================================
const CHANNEL_ACCESS_TOKEN = 'yn5Na00wbNupb51o4eVC+GSvXbjqO2oaZURDj3IVHbcVwndFdmXK33Upu1y68YXrkcLFdA8uI5pjbAZ75WX/xIcmlNcjUEztbyBvT0f8Z9wedwylmDkXq2E1X+CuQhpjl/bQDNmT08b0XChzXshqRAdB04t89/1O/w1cDnyilFU=';
const CWA_AUTH_KEY = 'CWA-B59372C7-9BD4-44F8-B759-D6ED723C6BC4';  // 格式: CWA-XXXXX-XXXXX
// ==========================================

// 城市列表（使用「臺」不是「台」）
const CITIES = [
  { code: "01", name: "臺北市" }, { code: "02", name: "新北市" },
  { code: "03", name: "基隆市" }, { code: "04", name: "宜蘭縣" },
  { code: "05", name: "花蓮縣" }, { code: "06", name: "臺東縣" },
  { code: "07", name: "屏東縣" }, { code: "08", name: "高雄市" },
  { code: "09", name: "臺南市" }, { code: "0A", name: "雲林縣" },
  { code: "0B", name: "嘉義縣" }, { code: "0C", name: "彰化縣" },
  { code: "0D", name: "臺中市" }, { code: "0E", name: "南投縣" },
  { code: "0F", name: "苗栗縣" }, { code: "0G", name: "桃園市" },
  { code: "0H", name: "金門縣" }, { code: "0I", name: "澎湖縣" }
];

// 城市对应的气象资料 ID
const CITY_DATAID = {
  "臺北市": "F-D0047-061", "新北市": "F-D0047-063", "基隆市": "F-D0047-001",
  "宜蘭縣": "F-D0047-003", "花蓮縣": "F-D0047-005", "臺東縣": "F-D0047-007",
  "屏東縣": "F-D0047-009", "高雄市": "F-D0047-067", "臺南市": "F-D0047-065",
  "雲林縣": "F-D0047-011", "嘉義縣": "F-D0047-013", "彰化縣": "F-D0047-015",
  "臺中市": "F-D0047-059", "南投縣": "F-D0047-017", "苗栗縣": "F-D0047-019",
  "桃園市": "F-D0047-055",
  "金門縣": "F-D0047-089",  // 请确认正确
  "澎湖縣": "F-D0047-091"    // 请确认正确
};

// 模拟数据（当 API 失败时使用）
const MOCK_WEATHER = {
  "臺北市": { temp: 32, humidity: 58 },
  "新北市": { temp: 31, humidity: 60 },
  "基隆市": { temp: 29, humidity: 68 },
  "桃園市": { temp: 30, humidity: 62 },
  "臺中市": { temp: 31, humidity: 55 },
  "高雄市": { temp: 33, humidity: 52 },
  "臺南市": { temp: 32, humidity: 56 },
  "宜蘭縣": { temp: 30, humidity: 65 },
  "花蓮縣": { temp: 30, humidity: 63 },
  "臺東縣": { temp: 31, humidity: 60 },
  "屏東縣": { temp: 33, humidity: 58 },
  "雲林縣": { temp: 32, humidity: 57 },
  "嘉義縣": { temp: 32, humidity: 59 },
  "彰化縣": { temp: 31, humidity: 58 },
  "南投縣": { temp: 31, humidity: 61 },
  "苗栗縣": { temp: 30, humidity: 60 },
  "金門縣": { temp: 29, humidity: 68 },
  "澎湖縣": { temp: 30, humidity: 70 }
};

const INDOOR_TEMP = 25.0;
const INDOOR_HUM = 50.0;

// 是否使用真实 API
const USE_REAL_API = true;

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
          const replyText = await getCombinedIndex(city.name);
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
            const replyText = await getCombinedIndex(city.name);
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

// 从中央气象署获取真实天气
async function getRealWeather(cityName) {
  const dataid = CITY_DATAID[cityName];
  if (!dataid) {
    console.log(`找不到 ${cityName} 的 dataid`);
    return null;
  }
  
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${dataid}?Authorization=${CWA_AUTH_KEY}&format=JSON`;
  
  try {
    console.log(`正在获取 ${cityName} 真实天气...`);
    const response = await axios.get(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'LINE-Bot/1.0' }
    });
    
    const data = response.data;
    
    // 检查 API 是否成功
    if (data.success !== "true") {
      console.log('API 回传失败:', data);
      return null;
    }
    
    // 解析路径: data.records.Locations[0].Location
    const locations = data.records?.Locations;
    if (!locations || locations.length === 0) {
      console.log('找不到 Locations 资料');
      return null;
    }
    
    // 寻找目标城市
    let targetLocations = null;
    for (let loc of locations) {
      if (loc.LocationsName === cityName) {
        targetLocations = loc;
        break;
      }
    }
    
    if (!targetLocations) {
      console.log(`找不到 ${cityName} 的 Locations 资料`);
      return null;
    }
    
    // 取第一个行政区（例如松山区）的资料作为代表
    const firstLocation = targetLocations.Location?.[0];
    if (!firstLocation) {
      console.log('找不到 Location 资料');
      return null;
    }
    
    const weatherElements = firstLocation.WeatherElement;
    
    // 找温度（ElementName: "溫度"）
    const tempData = weatherElements.find(w => w.ElementName === "溫度");
    // 找湿度（ElementName: "相對濕度"）
    const humData = weatherElements.find(w => w.ElementName === "相對濕度");
    
    if (!tempData || !humData) {
      console.log('找不到温度或湿度资料');
      return null;
    }
    
    // 取第一笔时间点的资料（当前时间）
    const temp = tempData.Time?.[0]?.ElementValue?.[0]?.Temperature;
    const humidity = humData.Time?.[0]?.ElementValue?.[0]?.RelativeHumidity;
    
    if (temp && humidity) {
      console.log(`${cityName} 真实天气: ${temp}℃, ${humidity}%`);
      return { temp: parseFloat(temp), humidity: parseFloat(humidity) };
    }
    
    console.log('温度或湿度值为空');
    return null;
  } catch (e) {
    console.error(`获取 ${cityName} 天气失败:`, e.message);
    return null;
  }
}

// 取得天气（真实 API + 模拟备援）
async function getWeather(cityName) {
  if (USE_REAL_API && CWA_AUTH_KEY && CWA_AUTH_KEY !== '你的中央气象署授权码') {
    const realWeather = await getRealWeather(cityName);
    if (realWeather) {
      return realWeather;
    }
    console.log(`真实 API 失败，改用模拟数据: ${cityName}`);
  }
  return MOCK_WEATHER[cityName] || { temp: 28, humidity: 60 };
}

// 计算合并指数
async function getCombinedIndex(cityName) {
  const weather = await getWeather(cityName);
  const isRealData = USE_REAL_API && 
    CWA_AUTH_KEY && 
    CWA_AUTH_KEY !== '你的中央气象署授权码' && 
    weather !== MOCK_WEATHER[cityName];
  
  // 皮肤干燥指数
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
  
  // 湿度冲击指数
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
  
  const dataSource = isRealData ? "中央气象署即时资料" : "模拟数据（API 串接中）";
  
  // 城市名称显示（将臺转为台，更美观）
  const displayName = cityName.replace("臺", "台");
  
  return `🌤️ 【${displayName} 环境指数】

🌡️ 皮肤干燥指数：${drynessLevel} (${Math.round(drynessScore)}分)
   • 室外 ${weather.temp}℃ / 室内 ${INDOOR_TEMP}℃
   • 室外湿度 ${weather.humidity}% / 室内 ${INDOOR_HUM}%
   💡 ${drynessAdvice}

💧 湿度冲击指数：${shockLevel} (冲击差 ${Math.round(shock)}%)
   • 室外湿度 ${weather.humidity}% → 室内 ${INDOOR_HUM}%
   💡 ${shockAdvice}

📊 资料来源：${dataSource}`;
}

// 发送左右滑动的城市选单
async function sendCityMenu(replyToken) {
  const carousel = {
    type: 'flex',
    altText: '请选择城市查询环境指数',
    contents: {
      type: 'carousel',
      contents: CITIES.map(city => {
        const displayName = city.name.replace("臺", "台");
        return {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'md',
            contents: [
              { type: 'text', text: `🌡️💧 ${displayName}`, weight: 'bold', size: 'xl', align: 'center' },
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
                displayText: `查询 ${displayName}`
              }
            }]
          }
        };
      })
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
  res.send('✅ LINE Bot 已上线！\n\n输入城市代码（如 01）查询环境指数。');
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`真实 API 状态: ${USE_REAL_API && CWA_AUTH_KEY && CWA_AUTH_KEY !== '你的中央气象署授权码' ? '已启用' : '使用模拟数据'}`);
});
