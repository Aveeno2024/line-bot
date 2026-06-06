const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// ==========================================
// ⚠️ 请填入你的密钥 ⚠️
// ==========================================
const CHANNEL_ACCESS_TOKEN = 'yn5Na00wbNupb51o4eVC+GSvXbjqO2oaZURDj3IVHbcVwndFdmXK33Upu1y68YXrkcLFdA8uI5pjbAZ75WX/xIcmlNcjUEztbyBvT0f8Z9wedwylmDkXq2E1X+CuQhpjl/bQDNmT08b0XChzXshqRAdB04t89/1O/w1cDnyilFU=';
const CWA_AUTH_KEY = 'CWA-B59372C7-9BD4-44F8-B759-D6ED723C6BC4';  // 去 https://opendata.cwa.gov.tw 注册取得
// ==========================================

// 城市列表
const CITIES = [
  { code: "01", name: "台北市" }, { code: "02", name: "新北市" },
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
  "台北市": "F-D0047-061", "新北市": "F-D0047-063", "基隆市": "F-D0047-001",
  "宜蘭縣": "F-D0047-003", "花蓮縣": "F-D0047-005", "臺東縣": "F-D0047-007",
  "屏東縣": "F-D0047-009", "高雄市": "F-D0047-067", "臺南市": "F-D0047-065",
  "雲林縣": "F-D0047-011", "嘉義縣": "F-D0047-013", "彰化縣": "F-D0047-015",
  "臺中市": "F-D0047-059", "南投縣": "F-D0047-017", "苗栗縣": "F-D0047-019",
  "桃園市": "F-D0047-055",
  "金門縣": "F-D0047-089",  // 需确认正确 ID
  "澎湖縣": "F-D0047-091"    // 需确认正确 ID
};

const INDOOR_TEMP = 25.0;
const INDOOR_HUM = 50.0;

app.post('/webhook', async (req, res) => {
  console.log('收到请求');
  
  try {
    const events = req.body.events;
    for (let event of events) {
      const replyToken = event.replyToken;
      
      if (event.type === 'message' && event.message.type === 'text') {
        const userInput = event.message.text.trim().toUpperCase();
        const city = CITIES.find(c => c.code === userInput);
        
        if (city) {
          const replyText = await getCombinedIndex(city.name);
          await reply(replyToken, replyText);
        } else {
          await sendCarouselMenu(replyToken);
        }
      }
      
      if (event.type === 'postback') {
        const data = event.postback.data;
        if (data && data.startsWith('city=')) {
          const cityCode = data.split('=')[1];
          const city = CITIES.find(c => c.code === cityCode);
          if (city) {
            const replyText = await getCombinedIndex(city.name);
            await reply(replyToken, replyText);
          }
        }
      }
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('错误:', err);
    res.status(200).send('OK');
  }
});

// 从中央气象署获取天气
async function getWeather(cityName) {
  const dataid = CITY_DATAID[cityName];
  if (!dataid) return null;
  
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${dataid}?Authorization=${CWA_AUTH_KEY}&format=JSON&limit=1`;
  
  try {
    const response = await axios.get(url);
    const data = response.data;
    const location = data.records?.locations[0]?.location[0];
    if (!location) return null;
    
    const weatherEle = location.weatherElement;
    const tempElem = weatherEle.find(w => w.elementName === "T");
    const humElem = weatherEle.find(w => w.elementName === "RH");
    
    const temp = tempElem?.time[0]?.elementValue[0]?.value;
    const humidity = humElem?.time[0]?.elementValue[0]?.value;
    
    if (temp && humidity) {
      return { temp: parseFloat(temp), humidity: parseFloat(humidity) };
    }
    return null;
  } catch (e) {
    console.error('气象 API 错误:', e.message);
    return null;
  }
}

// 计算指数
async function getCombinedIndex(cityName) {
  const weather = await getWeather(cityName);
  
  if (!weather) {
    return `❌ 无法获取 ${cityName} 的天气数据，请稍后再试。`;
  }
  
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
  
  return `🌤️ 【${cityName} 环境指数】

🌡️ 皮肤干燥指数：${drynessLevel} (${Math.round(drynessScore)}分)
   • 室外 ${weather.temp}℃ / 室内 ${INDOOR_TEMP}℃
   • 室外湿度 ${weather.humidity}% / 室内 ${INDOOR_HUM}%
   💡 ${drynessAdvice}

💧 湿度冲击指数：${shockLevel} (冲击差 ${Math.round(shock)}%)
   • 室外湿度 ${weather.humidity}% → 室内 ${INDOOR_HUM}%
   💡 ${shockAdvice}

📊 数据时间：即时查询
🌐 资料来源：中央气象署`;
}

// 发送左右滑动的城市选单
async function sendCarouselMenu(replyToken) {
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
            { type: 'text', text: `🌡️💧 ${city.name}`, weight: 'bold', size: 'xl', align: 'center' },
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
              displayText: `查询 ${city.name}`
            }
          }]
        }
      }))
    }
  };
  
  await reply(replyToken, [carousel]);
}

async function reply(replyToken, messages) {
  if (!Array.isArray(messages)) messages = [{ type: 'text', text: messages }];
  
  await axios.post('https://api.line.me/v2/bot/message/reply', {
    replyToken: replyToken,
    messages: messages
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`
    }
  });
}

app.get('/', (req, res) => res.send('✅ LINE Bot 已上线！'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
