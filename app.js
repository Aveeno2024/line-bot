
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const cron = require('node-cron');
const Jimp = require('jimp');
const path = require('path');
const app = express();
app.use(express.json());

// ==========================================
// ✅ 靜態檔案服務
// ==========================================
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use('/tmp', express.static('/tmp'));

// ==========================================
// ⚠️ 請填入你的金鑰 ⚠️
// ==========================================
const CHANNEL_ACCESS_TOKEN = 'KTrkQhxdh/NX6MzhtqDu2IA69XqdelCzNT3bYiXTX7ui5c58yplYfW6SsjXlUQtSkcLFdA8uI5pjbAZ75WX/xIcmlNcjUEztbyBvT0f8Z9zKcdsvlL2XHTEDXUR+5Js6c1tXG0DYFrrTjRgNTgJviQdB04t89/1O/w1cDnyilFU=';
const CWA_API_KEY = 'CWA-B59372C7-9BD4-44F8-B759-D6ED723C6BC4';
// ==========================================

// ==========================================
// ✅ 第二張圖（燈號說明）- 使用 Render 靜態圖片
// ==========================================
const BASE_URL = 'https://line-bot-v9q8.onrender.com';

function generatePage2ImageFlex() {
  return {
    type: 'image',
    originalContentUrl: `${BASE_URL}/images/template_page2.png`,
    previewImageUrl: `${BASE_URL}/images/template_page2.png`
  };
}

// GitHub 設定 (可選)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

// 檔案路徑定義
const SUBSCRIBERS_FILE = './subscribers.json';
const GROUPS_FILE = './groups.json';
const CACHE_FILE = './cached_forecast.json';

// 全域變數
let subscribers = [];
let groups = [];
let cachedForecast = null;
let lastCacheTime = null;

// ==========================================
// ⭐ 限流機制
// ==========================================
const userLastQueryTime = {};
const rateLimit = {
  window: 60 * 1000,
  maxRequests: 60,
  requests: []
};

function isRateLimited() {
  const now = Date.now();
  rateLimit.requests = rateLimit.requests.filter(time => now - time < rateLimit.window);
  if (rateLimit.requests.length >= rateLimit.maxRequests) return true;
  rateLimit.requests.push(now);
  return false;
}

function isUserRateLimited(userId) {
  const now = Date.now();
  const lastTime = userLastQueryTime[userId] || 0;
  if (now - lastTime < 30000) return true;
  userLastQueryTime[userId] = now;
  return false;
}

// ==========================================
// ⭐ 訊息佇列
// ==========================================
class MessageQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.delay = 500;
  }
  add(message) {
    this.queue.push(message);
    if (!this.isProcessing) this.processQueue();
  }
  async processQueue() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }
    this.isProcessing = true;
    const { userId, page1, resolve, reject } = this.queue.shift();
    try {
      await pushToUser(userId, page1);
      resolve({ success: true });
    } catch (error) {
      reject(error);
    }
    setTimeout(() => this.processQueue(), this.delay);
  }
  get length() {
    return this.queue.length;
  }
}
const messageQueue = new MessageQueue();

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
    console.error(`❌ 推播失敗: ${userId}`, err.response?.data || err.message);
    return false;
  }
}

function pushToUserQueued(userId, page1) {
  return new Promise((resolve, reject) => {
    messageQueue.add({ userId, page1, resolve, reject });
  });
}

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
  if (!GITHUB_TOKEN || !GITHUB_REPO) return;
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
  if (!GITHUB_TOKEN || !GITHUB_REPO) return;
  try {
    const res = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/subscribers.json`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
    });
    const content = Buffer.from(res.data.content, 'base64').toString('utf8');
    subscribers = JSON.parse(content);
    console.log(`📋 從 GitHub 載入 ${subscribers.length} 位訂閱用戶`);
    fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2));
  } catch(e) {
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
const ES_26 = 3.36;

const CITIES = [
  { code: "1", name: "臺北市", displayName: "臺北市", apiName: "臺北市" },
  { code: "2", name: "新北市", displayName: "新北市", apiName: "新北市" },
  { code: "3", name: "桃園市", displayName: "桃園市", apiName: "桃園市" },
  { code: "4", name: "臺中市", displayName: "臺中市", apiName: "臺中市" },
  { code: "5", name: "臺南市", displayName: "臺南市", apiName: "臺南市" },
  { code: "6", name: "高雄市", displayName: "高雄市", apiName: "高雄市" }
];

// ==========================================
// SHPI V4 核心計算函數
// ==========================================
function calcSaturationVaporPressure(temp) {
  return 0.6112 * Math.exp((17.67 * temp) / (temp + 243.5));
}

function calcIndoorVaporPressure(tempOut, humOut) {
  let e_in = 1.70 + 0.06 * (tempOut - 28) + 0.004 * (humOut - 50);
  if (e_in < 1.45) e_in = 1.45;
  if (e_in > 2.20) e_in = 2.20;
  return e_in;
}

function calcDI(e_in) {
  const RH_in = 100 * e_in / ES_26;
  return 100 - RH_in;
}

function getLightLevel(delta_e, di) {
  if (delta_e >= 1.7 || di < 30 || di > 60) {
    return { level: 4, name: "紅燈", emoji: "🔴", color: "#FF0000" };
  }
  if ((delta_e >= 1.25 && delta_e < 1.7) || (di >= 30 && di <= 34) || (di >= 56 && di <= 60)) {
    return { level: 3, name: "橘燈", emoji: "🟠", color: "#FF8C00" };
  }
  if ((delta_e >= 0.9 && delta_e < 1.25) || (di >= 35 && di <= 39) || (di >= 51 && di <= 55)) {
    return { level: 2, name: "黃燈", emoji: "🟡", color: "#FFD700" };
  }
  return { level: 1, name: "綠燈", emoji: "🟢", color: "#00CC00" };
}

function calculateSHPI(tempOut, humOut) {
  const e_s = calcSaturationVaporPressure(tempOut);
  const e_out = e_s * humOut / 100;
  const e_in = calcIndoorVaporPressure(tempOut, humOut);
  const di = calcDI(e_in);
  const delta_e = e_out - e_in;
  const light = getLightLevel(delta_e, di);
  
  console.log(`\n   📊 ===== SHPI V4 計算結果 =====`);
  console.log(`   🌡️  氣溫: ${Math.round(tempOut)}℃`);
  console.log(`   💧  室外濕度: ${Math.round(humOut)}%`);
  console.log(`   📤  室外水蒸氣壓 (e_out): ${Math.round(e_out * 1000) / 1000} kPa`);
  console.log(`   📥  室內水蒸氣壓 (e_in): ${Math.round(e_in * 1000) / 1000} kPa`);
  console.log(`   🔥  室內乾燥指數 (DI): ${Math.round(di * 10) / 10}`);
  console.log(`   ⚡  絕對濕度壓力指數 (Δe): ${Math.round(delta_e * 1000) / 1000} kPa`);
  console.log(`   🚦  燈號: ${light.emoji} ${light.name}`);
  console.log(`   ${'='.repeat(40)}`);
  
  return {
    tempOut: Math.round(tempOut),
    humOut: Math.round(humOut),
    e_out: Math.round(e_out * 1000) / 1000,
    e_in: Math.round(e_in * 1000) / 1000,
    di: Math.round(di * 10) / 10,
    delta_e: Math.round(delta_e * 1000) / 1000,
    light: light
  };
}

// ==========================================
// 台灣時間工具函數
// ==========================================
function getTaiwanTime() {
  const now = new Date();
  return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

function getTaiwanDateString(offset = 0) {
  const taiwanTime = getTaiwanTime();
  const year = taiwanTime.getUTCFullYear();
  const month = taiwanTime.getUTCMonth() + 1;
  const day = taiwanTime.getUTCDate() + offset;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getTaiwanHour() {
  return getTaiwanTime().getUTCHours();
}

function getTaiwanMinute() {
  return getTaiwanTime().getUTCMinutes();
}

// ==========================================
// 中央氣象署 API - 修改版（自動找最接近時段）
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
    
    const targetDateStr = getTaiwanDateString(dateOffset);
    console.log(`📅 目標日期 (台灣時間): ${targetDateStr}`);
    
    // ✅ 收集該日期所有時段的資料
    let candidates = [];
    for (const t of tempElem.Time) {
      const dataTime = t.DataTime;
      if (dataTime) {
        const parts = dataTime.split('T');
        if (parts.length === 2) {
          const datePart = parts[0];
          if (datePart === targetDateStr) {
            const timePart = parseInt(parts[1]?.split(':')[0]);
            const tempValue = t.ElementValue?.[0]?.Temperature;
            candidates.push({
              dataTime: dataTime,
              time: timePart,
              temp: tempValue
            });
          }
        }
      }
    }
    
    if (candidates.length === 0) {
      console.log(`❌ 找不到 ${targetDateStr} 的任何數據`);
      return null;
    }
    
    // ✅ 找最接近目標時段的資料
    let best = null;
    let minDiff = Infinity;
    
    for (const c of candidates) {
      const diff = Math.abs(c.time - targetHour);
      if (diff < minDiff) {
        minDiff = diff;
        best = c;
      }
    }
    
    if (best) {
      // 找對應的濕度
      let humidity = null;
      for (const h of humElem.Time) {
        if (h.DataTime === best.dataTime) {
          humidity = h.ElementValue?.[0]?.RelativeHumidity;
          break;
        }
      }
      
      if (best.temp && humidity) {
        const formattedTime = best.dataTime.replace('T', ' ').replace(/\+08:00/g, '').trim();
        console.log(`✅ 找到數據: ${formattedTime} → 溫度=${best.temp}℃, 濕度=${humidity}% (目標時段 ${targetHour}:00，實際 ${best.time}:00)`);
        return {
          temp: Math.round(parseFloat(best.temp)),
          humidity: Math.round(parseFloat(humidity)),
          dataTime: formattedTime
        };
      }
    }
    
    console.log(`❌ 找不到 ${targetDateStr} 接近 ${targetHour}:00 的數據`);
    return null;
  } catch (error) {
    console.error(`❌ ${city.displayName} getForecastAtTime 錯誤: ${error.message}`);
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
        const taiwanTime = getTaiwanTime();
        const timeStr = `${taiwanTime.getUTCFullYear()}/${taiwanTime.getUTCMonth()+1}/${taiwanTime.getUTCDate()} ${String(taiwanTime.getUTCHours()).padStart(2,'0')}:${String(taiwanTime.getUTCMinutes()).padStart(2,'0')}`;
        return {
          temp, humidity,
          dataTime: timeStr + " (即時觀測)"
        };
      }
    }
    console.log(`❌ 找不到 ${city.name} 的即時觀測資料`);
    return null;
  } catch (error) {
    console.error(`❌ ${city.displayName} getCurrentWeather 錯誤: ${error.message}`);
    return null;
  }
}

// ==========================================
// getWeather - 修改版
// ==========================================
async function getWeather(city, dateOffset = 0, targetHour = 14) {
  try {
    const now = getTaiwanTime();
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();
    const currentTime = currentHour + currentMinute / 60;
    
    const useRealtime = (currentTime >= 14.0 && dateOffset === 0);
    
    let weather = null;
    
    if (useRealtime) {
      console.log(`⏰ 台灣時間 ${String(currentHour).padStart(2,'0')}:${String(currentMinute).padStart(2,'0')}，已過 14:00，使用即時觀測資料`);
      weather = await getCurrentWeather(city);
    } else {
      console.log(`⏰ 台灣時間 ${String(currentHour).padStart(2,'0')}:${String(currentMinute).padStart(2,'0')}，尚未過 14:00，使用預報 API`);
      weather = await getForecastAtTime(city, dateOffset, targetHour);
    }
    
    // ✅ 如果第一天預報失敗，嘗試 12:00 作為備援
    if (!weather && dateOffset === 0) {
      console.log(`⚠️ 第一天預報失敗，嘗試 12:00 作為備援`);
      weather = await getForecastAtTime(city, dateOffset, 12);
    }
    
    // ✅ 如果第二天預報失敗，嘗試其他時段
    if (!weather && dateOffset > 0) {
      console.log(`⚠️ 第二天預報失敗，嘗試其他時段`);
      const fallbackHours = [12, 18, 20, 8, 6];
      for (const hour of fallbackHours) {
        if (hour === targetHour) continue;
        console.log(`   🔄 嘗試 ${hour}:00 ...`);
        weather = await getForecastAtTime(city, dateOffset, hour);
        if (weather) {
          console.log(`   ✅ 成功從 ${hour}:00 取得資料`);
          break;
        }
      }
    }
    
    if (!weather && dateOffset === 0) {
      console.log(`⚠️ 即時觀測失敗，嘗試使用預報 API 作為備援`);
      weather = await getForecastAtTime(city, dateOffset, targetHour);
    }
    
    if (!weather) {
      console.log(`❌ ${city.displayName} 所有 API 都失敗，標記為暫無資料`);
      return null;
    }
    
    return weather;
    
  } catch (error) {
    console.error(`❌ ${city.displayName} getWeather 發生錯誤:`, error.message);
    return null;
  }
}

function calculateStartOffset() {
  const hours = getTaiwanHour();
  const minutes = getTaiwanMinute();
  const currentTime = hours + minutes / 60;
  
  if (currentTime >= 18.0) {
    console.log(`⏰ 台灣時間 ${hours}:${minutes}，已過 18:00，從 +1 天（明天）開始抓取預報`);
    return 1;
  } else {
    console.log(`⏰ 台灣時間 ${hours}:${minutes}，尚未過 18:00，從 +0 天（今天）開始抓取`);
    return 0;
  }
}

async function calculateCityTwoDays(city, startOffset = 0, targetHour = 14) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🏙️ 開始計算 ${city.displayName} 連續2天預報 (從 +${startOffset} 天開始)`);
  console.log(`${'='.repeat(60)}`);
  
  try {
    const weather0 = await getWeather(city, startOffset, targetHour);
    const weather1 = await getWeather(city, startOffset + 1, targetHour);
    
    console.log(`\n   🔍 ${city.displayName} weather0: ${weather0 ? '✅ 有資料' : '❌ 無資料'}`);
    if (weather0) {
      console.log(`      🌡️  溫度: ${weather0.temp}℃, 💧 濕度: ${weather0.humidity}%`);
      console.log(`      📅  資料時間: ${weather0.dataTime}`);
    }
    console.log(`   🔍 ${city.displayName} weather1: ${weather1 ? '✅ 有資料' : '❌ 無資料'}`);
    if (weather1) {
      console.log(`      🌡️  溫度: ${weather1.temp}℃, 💧 濕度: ${weather1.humidity}%`);
      console.log(`      📅  資料時間: ${weather1.dataTime}`);
    }
    
    const day0 = weather0 ? calculateSHPI(weather0.temp, weather0.humidity) : null;
    const day1 = weather1 ? calculateSHPI(weather1.temp, weather1.humidity) : null;
    
    console.log(`\n   ✅ ${city.displayName} 兩天計算完成:`);
    console.log(`      📅 第1天: ${day0 ? day0.light.emoji + ' ' + day0.light.name : '❓ 無資料'}`);
    console.log(`      📅 第2天: ${day1 ? day1.light.emoji + ' ' + day1.light.name : '❓ 無資料'}`);
    
    let dataTime = weather0?.dataTime || weather1?.dataTime || null;
    console.log(`${'='.repeat(60)}\n`);
    
    return {
      city: city.displayName,
      days: [day0, day1],
      dataTime: dataTime
    };
    
  } catch (error) {
    console.error(`\n❌❌❌ ${city.displayName} 計算過程中發生錯誤 ❌❌❌`);
    console.error(`   錯誤訊息: ${error.message}`);
    console.error(`   錯誤堆疊: ${error.stack || '無堆疊資訊'}`);
    console.log(`${'='.repeat(60)}\n`);
    
    return {
      city: city.displayName,
      days: [null, null],
      dataTime: null
    };
  }
}

function getDateString(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getMonth()+1}/${date.getDate()}`;
}

// ==========================================
// ✅ 燈號文字對照表
// ==========================================
function getLightText(emoji) {
  const map = {
    '🟢': '綠',
    '🟡': '黃',
    '🟠': '橘',
    '🔴': '紅',
    '❓': '?'
  };
  return map[emoji] || '?';
}

// ==========================================
// ✅ 繪製彩色圓圈（精簡穩定版）
// ==========================================
function drawColoredCircle(image, x, y, color, radius = 28) {
  return new Promise((resolve) => {
    try {
      const size = radius * 2;
      
      // ✅ 顏色對照表（使用 32 位元顏色值）
      const colorMap = {
        '#FF0000': 0xFF0000FF,   // 紅
        '#FF8C00': 0xFF8C00FF,   // 橘
        '#FFD700': 0xFFD700FF,   // 黃
        '#00CC00': 0x00CC00FF,   // 綠
        '#CCCCCC': 0xCCCCCCFF    // 灰
      };
      
      let fillColor = colorMap[color] || 0xCCCCCCFF;
      
      // 建立圓形圖片
      const circle = new Jimp(size, size, 0x00000000);
      
      // 畫圓
      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          const dx = px - radius;
          const dy = py - radius;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist <= radius) {
            circle.setPixelColor(fillColor, px, py);
          }
        }
      }
      
      // 合成到主圖片
      image.composite(circle, x - radius, y - radius);
      resolve();
      
    } catch (error) {
      console.error('❌ drawColoredCircle 錯誤:', error);
      resolve();
    }
  });
}
// ==========================================
// ✅ 使用 Jimp 生成第一頁圖片（更新座標版）
// ==========================================
async function generatePage1Image(day0Label, day1Label, citiesData, dataTimeStr) {
  try {
    console.log(`\n📊 開始生成圖片...`);
    console.log(`📅 日期: ${day0Label} | ${day1Label}`);
    console.log(`🕐 資料時間: ${dataTimeStr}`);
    
    // 載入模板
    const templatePath = path.join(__dirname, 'public/images/template_page1.png');
    const image = await Jimp.read(templatePath);
    
    // ✅ 使用 32px 字體（用於文字日期和時間）
    const font = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
    
    // ✅ 寫入日期（新座標）
    image.print(font, 510, 185, day0Label);
    image.print(font, 800, 185, day1Label);
    
    // ✅ 城市燈號位置（新座標）
    const cityConfigs = [
      { name: '台北市', l1x: 510, l1y: 275, l2x: 800, l2y: 275 },
      { name: '新北市', l1x: 510, l1y: 372, l2x: 800, l2y: 372 },
      { name: '桃園市', l1x: 510, l1y: 469, l2x: 800, l2y: 469 },
      { name: '台中市', l1x: 510, l1y: 566, l2x: 800, l2y: 566 },
      { name: '台南市', l1x: 510, l1y: 663, l2x: 800, l2y: 663 },
      { name: '高雄市', l1x: 510, l1y: 760, l2x: 800, l2y: 760 }
    ];
    
    // ✅ 逐一繪製燈號圓圈
    for (let i = 0; i < cityConfigs.length; i++) {
      const c = cityConfigs[i];
      const data = citiesData[i] || {};
      
      // 取得燈號顏色（如果沒有資料則顯示灰色）
      const color1 = data.day0 && data.day0.light ? data.day0.light.color : '#CCCCCC';
      const color2 = data.day1 && data.day1.light ? data.day1.light.color : '#CCCCCC';
      
      // 繪製圓圈（半徑 22px，配合新尺寸）
      await drawColoredCircle(image, c.l1x, c.l1y, color1, 22);
      await drawColoredCircle(image, c.l2x, c.l2y, color2, 22);
      
      // 取得燈號名稱（用於日誌）
      const name1 = data.day0 && data.day0.light ? data.day0.light.name : '無資料';
      const name2 = data.day1 && data.day1.light ? data.day1.light.name : '無資料';
      console.log(`🔍 ${c.name}: 燈號寫入 -> ${name1}(${color1}) | ${name2}(${color2})`);
    }
    
    // ✅ 寫入資料時間（新座標）
    const displayTime = dataTimeStr || '2026-07-25 14:00:00';
    image.print(font, 450, 870, displayTime);
    
    // 輸出為 PNG Buffer
    const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
    console.log(`✅ 圖片生成完成 (大小: ${Math.round(buffer.length / 1024)} KB)`);
    return buffer;
    
  } catch (error) {
    console.error('❌ 生成圖片失敗:', error.message);
    console.error('   錯誤堆疊:', error.stack);
    return null;
  }
}
// ==========================================
// ✅ 產生第一頁圖片訊息（修改版 - 日期用 startOffset 計算）
// ==========================================
async function generatePage1ImageFlex(startOffset = 0) {
  try {
    // 計算燈號數據
    const citiesData = [];
    let globalDataTime = null;
    
    for (const city of CITIES) {
      const twoDays = await calculateCityTwoDays(city, startOffset, 14);
      citiesData.push({
        day0: twoDays.days[0],
        day1: twoDays.days[1]
      });
      if (!globalDataTime && twoDays.dataTime) {
        globalDataTime = twoDays.dataTime;
      }
    }
    
    // ✅ 確保 globalDataTime 有值
    if (!globalDataTime) {
      const now = new Date();
      const dateStr = now.toISOString().replace('T', ' ').slice(0, 19);
      globalDataTime = dateStr;
      console.log(`⚠️ 使用備用時間: ${globalDataTime}`);
    } else {
      const cleanTime = globalDataTime.replace(/\+08:00/g, '').trim();
      const parts = cleanTime.split(' ');
      if (parts.length > 0) {
        const dateParts = parts[0].split('-');
        if (dateParts.length === 3) {
          const year = dateParts[0];
          const month = dateParts[1];
          const day = dateParts[2];
          const time = parts[1] || '14:00:00';
          globalDataTime = `${year}-${month}-${day} ${time}`;
        }
      }
    }
    
    // ✅ 直接從 startOffset 計算日期（不依賴 globalDataTime）
    const taiwanNow = getTaiwanTime();
    const baseDate = new Date(taiwanNow);
    baseDate.setDate(baseDate.getDate() + startOffset);
    
    const d0 = new Date(baseDate);
    const d1 = new Date(baseDate);
    d1.setDate(d1.getDate() + 1);
    
    const day0Label = `${d0.getMonth()+1}/${d0.getDate()}`;
    const day1Label = `${d1.getMonth()+1}/${d1.getDate()}`;
    
    console.log(`📅 圖片日期: ${day0Label} | ${day1Label} (offset=${startOffset})`);
    
    // 生成圖片
    const imageBuffer = await generatePage1Image(day0Label, day1Label, citiesData, globalDataTime);
    if (!imageBuffer) {
      return {
        type: 'image',
        originalContentUrl: `${BASE_URL}/images/template_page1.png`,
        previewImageUrl: `${BASE_URL}/images/template_page1.png`
      };
    }
    
    // ✅ 儲存到 /tmp 目錄
    const filename = `current_page1_${Date.now()}.png`;
    const outputPath = path.join('/tmp', filename);
    fs.writeFileSync(outputPath, imageBuffer);
    console.log(`✅ 圖片已儲存到 /tmp/${filename}`);
    
    return {
      type: 'image',
      originalContentUrl: `${BASE_URL}/tmp/${filename}`,
      previewImageUrl: `${BASE_URL}/tmp/${filename}`
    };
    
  } catch (error) {
    console.error('❌ 產生圖片訊息失敗:', error.message);
    return {
      type: 'image',
      originalContentUrl: `${BASE_URL}/images/template_page1.png`,
      previewImageUrl: `${BASE_URL}/images/template_page1.png`
    };
  }
}

// ==========================================
// ✅ 產生第二頁圖片訊息（固定圖片）
// ==========================================
function generatePage2ImageFlex() {
  return {
    type: 'image',
    originalContentUrl: `${BASE_URL}/images/template_page2.png`,
    previewImageUrl: `${BASE_URL}/images/template_page2.png`
  };
}

// ==========================================
// 錯誤訊息 Flex Message
// ==========================================
function getErrorFlexMessage() {
  const today = getDateString(0);
  const tomorrow = getDateString(1);
  
  return {
    type: 'flex',
    altText: '⚠️ 中央氣象署 API 暫時無法連線',
    contents: {
      type: 'bubble',
      size: 'giga',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '⚠️ 服務暫時無法使用', weight: 'bold', size: 'xl', color: '#ffffff', scaling: true }
        ],
        backgroundColor: '#FF6600',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: '中央氣象署 API 暫時無法連線', size: 'lg', weight: 'bold', color: '#FF0000', wrap: true, scaling: true },
          { type: 'text', text: '請稍後再試，或聯繫管理員。', size: 'md', color: '#666666', wrap: true, scaling: true },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '💡 您可以嘗試：', size: 'md', weight: 'bold', scaling: true },
          { type: 'text', text: '• 幾分鐘後重新查詢', size: 'sm', color: '#666666', scaling: true },
          { type: 'text', text: '• 加入 LINE 好友接收推播', size: 'sm', color: '#666666', scaling: true }
        ],
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'separator' },
          { type: 'text', text: '📊 中央氣象署', size: 'xs', color: '#999999', align: 'center', scaling: true }
        ],
        paddingAll: '12px'
      }
    }
  };
}

// ==========================================
// 回覆函數
// ==========================================
async function replyMessage(replyToken, message) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', { replyToken, messages: [message] }, {
      headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
    console.log('✅ 訊息回復成功');
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

// ==========================================
// 快取管理函數
// ==========================================
async function precomputeAndCache() {
  const startOffset = calculateStartOffset();
  
  console.log(`\n🔄 開始預計算快取 - ${getTaiwanTime().toLocaleString()}`);
  console.log(`📅 從 +${startOffset} 天開始抓取`);
  const startTime = Date.now();
  
  try {
    // 預先計算數據
    const citiesData = [];
    let globalDataTime = null;
    
    for (const city of CITIES) {
      const twoDays = await calculateCityTwoDays(city, startOffset, 14);
      citiesData.push({
        name: city.displayName,
        day0: twoDays.days[0],
        day1: twoDays.days[1]
      });
      if (!globalDataTime && twoDays.dataTime) {
        globalDataTime = twoDays.dataTime;
      }
    }
    
    // ✅ 直接從 startOffset 計算日期
    const taiwanNow = getTaiwanTime();
    const baseDate = new Date(taiwanNow);
    baseDate.setDate(baseDate.getDate() + startOffset);
    
    const d0 = new Date(baseDate);
    const d1 = new Date(baseDate);
    d1.setDate(d1.getDate() + 1);
    
    const day0Label = `${d0.getMonth()+1}/${d0.getDate()}`;
    const day1Label = `${d1.getMonth()+1}/${d1.getDate()}`;
    
    // 生成並儲存圖片
    const imageBuffer = await generatePage1Image(day0Label, day1Label, citiesData, globalDataTime || '');
    let page1 = null;
    if (imageBuffer) {
      const filename = `current_page1_${Date.now()}.png`;
      const outputPath = path.join('/tmp', filename);
      fs.writeFileSync(outputPath, imageBuffer);
      console.log(`✅ 快取圖片已儲存到 /tmp/${filename}`);
      
      page1 = {
        type: 'image',
        originalContentUrl: `${BASE_URL}/tmp/${filename}`,
        previewImageUrl: `${BASE_URL}/tmp/${filename}`
      };
    }
    
    if (!page1) {
      page1 = {
        type: 'image',
        originalContentUrl: `${BASE_URL}/images/template_page1.png`,
        previewImageUrl: `${BASE_URL}/images/template_page1.png`
      };
    }
    
    const page2 = generatePage2ImageFlex();
    
    cachedForecast = { page1, page2 };
    lastCacheTime = new Date();
    
    const cacheData = {
      page1: page1,
      page2: page2,
      lastCacheTime: lastCacheTime.toISOString(),
      startOffset: startOffset
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
// 每日發布任務
// ==========================================
async function dailyPublishTask() {
  console.log(`\n📅 ===== 每日發布任務 ${new Date().toLocaleString()} =====`);
  
  const cache = await getCachedForecast();
  
  if (cache && cache.page1) {
    console.log(`📤 推播給 ${subscribers.length} 位個人訂閱者`);
    console.log(`📊 訊息佇列長度: ${messageQueue.length}`);
    
    for (const userId of subscribers) {
      await pushToUserQueued(userId, cache.page1);
    }
  } else {
    const errorMsg = getErrorFlexMessage();
    for (const userId of subscribers) {
      await pushToUserQueued(userId, errorMsg);
    }
  }
  
  console.log(`✅ 每日發布任務完成\n`);
}

// ==========================================
// 網站 API
// ==========================================
app.get('/api/all-cities-2days', async (req, res) => {
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
// ⭐ LINE Webhook 端點
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
• 輸入「全台」查詢六都2天預報
• 輸入「燈號說明」查看完整說明

💡 查詢結果會「直接」在群組中回覆`);
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
            await replyMessage(replyToken, cache.page1);
          } else {
            const errorMsg = getErrorFlexMessage();
            await replyMessage(replyToken, errorMsg);
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
        
        if (isRateLimited()) {
          console.log(`⚠️ 全域限流觸發，拒絕請求`);
          await replyTextMessage(replyToken, '⚠️ 系統忙碌中，請稍後再試。');
          continue;
        }
        
        if (input === '燈號說明' || input === '說明') {
          const cache = await getCachedForecast();
          if (cache && cache.page2) {
            await replyMessage(replyToken, cache.page2);
          } else {
            const imageMsg = generatePage2ImageFlex();
            await replyMessage(replyToken, imageMsg);
          }
          continue;
        }
        
        if (isUserRateLimited(sourceId)) {
          console.log(`⚠️ 使用者限流觸發: ${sourceId}`);
          await replyTextMessage(replyToken, '⚠️ 請稍後再查詢，30秒內只能查詢一次');
          continue;
        }
        
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
        
        if (input === '全台' || input === 'ALL') {
          const cache = await getCachedForecast();
          
          if (cache && cache.page1) {
            await replyMessage(replyToken, cache.page1);
          } else {
            const startOffset = calculateStartOffset();
            const imageMsg = await generatePage1ImageFlex(startOffset);
            if (imageMsg) {
              await replyMessage(replyToken, imageMsg);
            } else {
              const errorMsg = getErrorFlexMessage();
              await replyMessage(replyToken, errorMsg);
            }
          }
          continue;
        }
        
        if (sourceType === 'group') {
          await replyTextMessage(replyToken, 
            `📊 查詢六都皮膚濕度壓力指數\n\n` +
            `請輸入「全台」，結果將直接顯示在群組中。\n\n` +
            `📖 輸入「燈號說明」查看完整介紹`);
          continue;
        }
        
        const cache = await getCachedForecast();
        if (cache && cache.page1) {
          await replyMessage(replyToken, cache.page1);
        } else {
          const errorMsg = getErrorFlexMessage();
          await replyMessage(replyToken, errorMsg);
        }
      }
    }
  } catch (err) {
    console.error('處理錯誤:', err);
  }
});

// ==========================================
// 每日推播檢查機制（每分鐘檢查）
// ==========================================
let lastPublishDate = null;

function checkAndPublish() {
  const taiwanTime = getTaiwanTime();
  const hours = taiwanTime.getUTCHours();
  const minutes = taiwanTime.getUTCMinutes();
  
  if (hours === 7 && minutes === 0) {
    const today = taiwanTime.toISOString().split('T')[0];
    if (lastPublishDate !== today) {
      console.log(`📅 觸發每日推播 - ${today} 台灣時間 ${hours}:${minutes}`);
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
// ⭐ 定時預計算任務（06:30）
// ==========================================
cron.schedule('30 6 * * *', () => {
  console.log(`\n⏰ [06:30] 預計算 - 抓取當天 14:00 預報，確保 7:00 推播使用最新資料`);
  precomputeAndCache();
}, {
  timezone: "Asia/Taipei"
});

console.log('📅 已設定定時預計算任務：每天 06:30 (台灣時間)');
console.log('📌 06:30 抓取當天 14:00 預報，確保 7:00 推播使用最新資料');

// ==========================================
// 啟動伺服器
// ==========================================
(async () => {
  await loadFromGitHub();
  loadCacheFromFile();
  
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
    console.log(`📡 預報 API：F-D0047-089 (自動找最接近時段)`);
    console.log(`⏰ 預計算時間：每天 06:30 (台灣時間)`);
    console.log(`📌 系統會根據台灣時間自動決定從 +0 或 +1 天開始抓取`);
    console.log(`🕐 每日推播：上午 7:00 (台灣時間) - 每分鐘檢查`);
    console.log(`📦 快取狀態：${cachedForecast ? '已載入' : '無'}`);
    console.log(`📋 個人訂閱：${subscribers.length} 人`);
    console.log(`👥 群組數量：${groups.length} 個`);
    console.log(`📊 訊息佇列延遲：${messageQueue.delay}ms`);
    console.log(`🛡️  限流：每分鐘 ${rateLimit.maxRequests} 次請求，每人 30 秒冷卻`);
    console.log(`========================================\n`);
  });
})();
