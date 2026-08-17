
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const cron = require('node-cron');
const Jimp = require('jimp');
const path = require('path');
const app = express();
app.use(express.json());

// ==========================================
// ⚙️ ===== 設定區塊 =====
// ==========================================

const CHANNEL_ACCESS_TOKEN = 'KTrkQhxdh/NX6MzhtqDu2IA69XqdelCzNT3bYiXTX7ui5c58yplYfW6SsjXlUQtSkcLFdA8uI5pjbAZ75WX/xIcmlNcjUEztbyBvT0f8Z9zKcdsvlL2XHTEDXUR+5Js6c1tXG0DYFrrTjRgNTgJviQdB04t89/1O/w1cDnyilFU=';
const CWA_API_KEY = 'CWA-685A3A03-CD65-4BFF-B31B-84CF07793954';
const FB_ACCESS_TOKEN = 'EAGaD7FThBa0BSKOOXZAloexV9I3lZBOwtCjiSX7Hfa8sHPnBRyR6GHuJ3wSXWzpal3wZB1F9hqwLGqc4jRMZA50iVlfkcBudKYVKeZBJVZC05j4F2HVgcCvZC3ZBw75poFOxQwuj5tuuOKQiN4tUxLCVPFgr3fpi7UGIgrMeO71yAVZCwynBcvJkDKTV3SaazqmjvQ5ZAHCwZBgrCBO6Au9R0JSZBWOS';
const FB_PAGE_ID = '1260518434131656';
const BASE_URL = 'https://line-bot-v9q8.onrender.com';

// ==========================================
// ✅ 靜態檔案服務
// ==========================================
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use('/tmp', express.static('/tmp'));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

const SUBSCRIBERS_FILE = './subscribers.json';
const GROUPS_FILE = './groups.json';
const CACHE_FILE = './cached_forecast.json';

let subscribers = [];
let groups = [];
let cachedForecast = null;
let lastCacheTime = null;
let isPublishing = false;

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

function calculateSHPI(tempOut, humOut, label = '') {
  const e_s = calcSaturationVaporPressure(tempOut);
  const e_out = e_s * humOut / 100;
  const e_in = calcIndoorVaporPressure(tempOut, humOut);
  const di = calcDI(e_in);
  const delta_e = e_out - e_in;
  const light = getLightLevel(delta_e, di);
  
  console.log(`\n   📊 ===== SHPI V4 計算結果 ${label} =====`);
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
// ✅ 台灣時間工具函數
// ==========================================

function getTaiwanTime() {
  const now = new Date();
  return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

function getTaiwanDateString(offset = 0) {
  const taiwanTime = getTaiwanTime();
  const targetDate = new Date(taiwanTime);
  targetDate.setDate(targetDate.getDate() + offset);
  const year = targetDate.getUTCFullYear();
  const month = targetDate.getUTCMonth() + 1;
  const day = targetDate.getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getTaiwanHour() {
  return getTaiwanTime().getUTCHours();
}

function getTaiwanMinute() {
  return getTaiwanTime().getUTCMinutes();
}

function getDateString(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getMonth()+1}/${date.getDate()}`;
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

// ==========================================
// ✅ 中央氣象署 API - 取得完整預報資料
// ==========================================
async function fetchFullForecast(city) {
  console.log(`\n🔍 ===== ${city.displayName} 取得完整預報資料 ====`);
  
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
    
    console.log(`✅ 取得 ${city.displayName} 完整預報資料，溫度 ${tempElem.Time.length} 筆，濕度 ${humElem.Time.length} 筆`);
    
    return {
      tempTimes: tempElem.Time,
      humTimes: humElem.Time
    };
    
  } catch (error) {
    console.error(`❌ ${city.displayName} fetchFullForecast 錯誤: ${error.message}`);
    return null;
  }
}

// ==========================================
// ✅ 提取指定日期的全天數據 (07:00-19:00)
// ==========================================
function extractFullDayData(forecastData, targetDateStr) {
  if (!forecastData) return null;
  
  const { tempTimes, humTimes } = forecastData;
  const hourlyData = [];
  
  const usedHours = new Set();
  const timeSlots = [];
  
  timeSlots.push({ targetHour: 7, searchHours: [7] });
  
  for (let hour = 8; hour <= 18; hour++) {
    const candidates = [hour, hour - 1, hour + 1];
    const available = candidates.filter(h => !usedHours.has(h));
    timeSlots.push({ 
      targetHour: hour, 
      searchHours: available.length > 0 ? available : [hour]
    });
  }
  
  timeSlots.push({ targetHour: 19, searchHours: [19] });
  
  for (const slot of timeSlots) {
    let tempValue = null;
    let humValue = null;
    let actualDataTime = null;
    let foundHour = null;
    
    for (const searchHour of slot.searchHours) {
      if (usedHours.has(searchHour)) continue;
      
      const timeStr = `${targetDateStr}T${String(searchHour).padStart(2, '0')}:00:00`;
      
      let tempFound = null;
      let timeFound = null;
      for (const t of tempTimes) {
        const dataTime = t.DataTime;
        if (dataTime && dataTime.startsWith(timeStr)) {
          tempFound = t.ElementValue?.[0]?.Temperature;
          timeFound = dataTime;
          break;
        }
      }
      
      if (tempFound !== null && timeFound) {
        let humFound = null;
        for (const h of humTimes) {
          if (h.DataTime === timeFound) {
            humFound = h.ElementValue?.[0]?.RelativeHumidity;
            break;
          }
        }
        
        if (humFound !== null) {
          tempValue = tempFound;
          humValue = humFound;
          actualDataTime = timeFound;
          foundHour = searchHour;
          usedHours.add(searchHour);
          break;
        }
      }
    }
    
    if (tempValue !== null && humValue !== null) {
      hourlyData.push({
        temp: Math.round(parseFloat(tempValue)),
        humidity: Math.round(parseFloat(humValue)),
        dataTime: actualDataTime,
        hour: slot.targetHour,
        sourceHour: foundHour
      });
    } else {
      hourlyData.push({
        temp: null,
        humidity: null,
        dataTime: null,
        hour: slot.targetHour,
        sourceHour: null
      });
    }
  }
  
  const validCount = hourlyData.filter(d => d.temp !== null).length;
  console.log(`   📊 提取 ${targetDateStr} 全天數據: ${validCount}/13 筆有效`);
  
  return hourlyData;
}

// ==========================================
// ✅ 計算全天綜合指標
// ==========================================
function calculateDailySummary(hourlyData) {
  if (!hourlyData || hourlyData.length === 0) return null;
  
  const validData = hourlyData.filter(d => d.temp !== null && d.humidity !== null);
  
  if (validData.length < 10) {
    console.log(`   ⚠️ 有效數據僅 ${validData.length} 筆，低於門檻 10 筆`);
    return null;
  }
  
  const requiredHours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  const validHours = validData.map(d => d.hour);
  let coveredCount = 0;
  for (const h of requiredHours) {
    if (validHours.includes(h)) coveredCount++;
  }
  
  if (coveredCount < 10) {
    console.log(`   ⚠️ 僅覆蓋 ${coveredCount} 小時，低於門檻 10 小時`);
    return null;
  }
  
  console.log(`   ✅ 通過門檻：${validData.length} 筆數據，覆蓋 ${coveredCount} 小時`);
  
  const avgTemp = validData.reduce((sum, d) => sum + d.temp, 0) / validData.length;
  const avgHumidity = validData.reduce((sum, d) => sum + d.humidity, 0) / validData.length;
  
  return {
    temp: Math.round(avgTemp),
    humidity: Math.round(avgHumidity),
    dataCount: validData.length,
    coveredHours: coveredCount
  };
}

// ==========================================
// ✅ 取得城市全天綜合指標
// ==========================================
async function getDailySummary(city, dateOffset = 0) {
  console.log(`\n🔍 ===== ${city.displayName} 綜合指標 (${dateOffset >= 0 ? '+' : ''}${dateOffset}天) ====`);
  
  const targetDateStr = getTaiwanDateString(dateOffset);
  console.log(`📅 目標日期: ${targetDateStr}`);
  
  if (!city._forecastData) {
    city._forecastData = await fetchFullForecast(city);
    if (!city._forecastData) return null;
  }
  
  const hourlyData = extractFullDayData(city._forecastData, targetDateStr);
  if (!hourlyData || hourlyData.length === 0) return null;
  
  const summary = calculateDailySummary(hourlyData);
  if (!summary) return null;
  
  return {
    temp: summary.temp,
    humidity: summary.humidity,
    dataTime: `${targetDateStr} 07:00-19:00 Daily Avg.`,
    dataCount: summary.dataCount,
    coveredHours: summary.coveredHours,
    hourlyData: hourlyData
  };
}

// ==========================================
// ✅ 計算六都兩天資料（新版全天綜合）
// ==========================================
async function calculateAllCities(startOffset = 0) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🏙️ 開始計算六都連續2天 (從 +${startOffset} 天開始)`);
  console.log(`${'='.repeat(60)}`);
  
  const results = [];
  const deepseekData = [];
  
  for (const city of CITIES) {
    city._forecastData = null;
    
    const day0 = await getDailySummary(city, startOffset);
    const day1 = await getDailySummary(city, startOffset + 1);
    
    const shpi0 = day0 ? calculateSHPI(day0.temp, day0.humidity, `[${city.displayName} 第1天]`) : null;
    const shpi1 = day1 ? calculateSHPI(day1.temp, day1.humidity, `[${city.displayName} 第2天]`) : null;
    
    results.push({
      city: city.displayName,
      day0: shpi0,
      day1: shpi1,
      day0Raw: day0,
      day1Raw: day1
    });
    
    if (shpi0) {
      deepseekData.push({
        city: city.displayName,
        date: getTaiwanDateString(startOffset),
        light: shpi0.light.name,
        temp: shpi0.tempOut,
        humidity: shpi0.humOut,
        delta_e: shpi0.delta_e,
        di: shpi0.di,
        dataCount: day0?.dataCount || 0,
        coveredHours: day0?.coveredHours || 0
      });
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ 六都計算完成`);
  console.log(`${'='.repeat(60)}`);
  
  // ==========================================
  // ✅ 輸出給 DeepSeek 的資料格式
  // ==========================================
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🤖 ===== 提供給 DeepSeek 的六都資料 =====`);
  console.log(`${'='.repeat(60)}`);
  
  const today = getTaiwanDateString(startOffset);
  console.log(`\n📅 日期: ${today}`);
  console.log(`\n📊 六都皮膚壓力指數數據：\n`);
  
  for (const d of deepseekData) {
    console.log(`【${d.city}】`);
    console.log(`  燈號：${d.light}`);
    console.log(`  氣溫：${d.temp}℃`);
    console.log(`  濕度：${d.humidity}%`);
    console.log(`  Δe：${d.delta_e.toFixed(3)}`);
    console.log(`  DI：${d.di.toFixed(1)}`);
    console.log(`  數據筆數：${d.dataCount}/13 筆`);
    console.log('');
  }
  
  // ==========================================
  // ✅ 輸出可複製貼上的純文字格式
  // ==========================================
  console.log(`${'='.repeat(60)}`);
  console.log(`📋 ===== 可複製給 DeepSeek 的純文字格式 =====`);
  console.log(`${'='.repeat(60)}`);
  
  let deepseekPrompt = `📅 日期：${today}\n\n`;
  deepseekPrompt += `📊 六都皮膚壓力指數數據：\n\n`;
  for (const d of deepseekData) {
    deepseekPrompt += `${d.city}：${d.light}，氣溫${d.temp}℃，濕度${d.humidity}%，Δe=${d.delta_e.toFixed(3)}，DI=${d.di.toFixed(1)}\n`;
  }
  
  deepseekPrompt += `\n請根據「皮膚壓力指數燈號保健建議」規範，提供今日總結與建議。`;
  
  console.log(deepseekPrompt);
  console.log(`\n${'='.repeat(60)}\n`);
  
  return { results, deepseekData, deepseekPrompt };
}

// ==========================================
// ✅ 繪製彩色圓圈
// ==========================================
function drawColoredCircle(image, x, y, color, radius = 24) {
  return new Promise((resolve) => {
    try {
      const size = radius * 2;
      
      const colorMap = {
        '#FF0000': 0xFF0000FF,
        '#FF8C00': 0xFF8C00FF,
        '#FFD700': 0xFFD700FF,
        '#00CC00': 0x00CC00FF,
        '#CCCCCC': 0xCCCCCCFF
      };
      
      let fillColor = colorMap[color] || 0xCCCCCCFF;
      
      const circle = new Jimp(size, size, 0x00000000);
      
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
      
      image.composite(circle, x - radius, y - radius);
      resolve();
      
    } catch (error) {
      console.error('❌ drawColoredCircle 錯誤:', error);
      resolve();
    }
  });
}

// ==========================================
// ✅ 生成圖片
// ==========================================
async function generatePage1Image(day0Label, day1Label, citiesData, dataTimeStr, version = 'line') {
  try {
    console.log(`\n📊 開始生成圖片... (版本: ${version})`);
    
    const templateFile = version === 'fb' 
      ? 'template_page1_fb.png' 
      : 'template_page1.png';
    const templatePath = path.join(__dirname, 'public/images', templateFile);
    const image = await Jimp.read(templatePath);
    
    const fontLarge = await Jimp.loadFont(Jimp.FONT_SANS_64_BLACK);
    const fontSmall = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
    const fontDisclaimer = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
    
    let date1X, date1Y, date2X, date2Y;
    let light1X, light2X, lightYStart, lightYStep;
    let timeX, timeY;
    let disX, disY;
    
    if (version === 'fb') {
      date1X = 490; date1Y = 165;
      date2X = 790; date2Y = 165;
      light1X = 560; light2X = 865;
      lightYStart = 285; lightYStep = 100;
      timeX = 370; timeY = 1570;
      disX = 370; disY = 1530;
    } else {
      date1X = 505; date1Y = 170;
      date2X = 805; date2Y = 170;
      light1X = 560; light2X = 865;
      lightYStart = 300; lightYStep = 100;
      timeX = 380; timeY = 1560;
      disX = 380; disY = 1640;
    }
    
    image.print(fontLarge, date1X, date1Y, day0Label);
    image.print(fontLarge, date2X, date2Y, day1Label);
    
    const cityConfigs = [
      { name: '台北市', l1y: lightYStart, l2y: lightYStart },
      { name: '新北市', l1y: lightYStart + lightYStep, l2y: lightYStart + lightYStep },
      { name: '桃園市', l1y: lightYStart + lightYStep * 2, l2y: lightYStart + lightYStep * 2 },
      { name: '台中市', l1y: lightYStart + lightYStep * 3, l2y: lightYStart + lightYStep * 3 },
      { name: '台南市', l1y: lightYStart + lightYStep * 4, l2y: lightYStart + lightYStep * 4 },
      { name: '高雄市', l1y: lightYStart + lightYStep * 5, l2y: lightYStart + lightYStep * 5 }
    ];
    
    for (let i = 0; i < cityConfigs.length; i++) {
      const c = cityConfigs[i];
      const data = citiesData[i] || {};
      
      const color1 = data.day0 && data.day0.light ? data.day0.light.color : '#CCCCCC';
      const color2 = data.day1 && data.day1.light ? data.day1.light.color : '#CCCCCC';
      
      await drawColoredCircle(image, light1X, c.l1y, color1, 24);
      await drawColoredCircle(image, light2X, c.l2y, color2, 24);
    }
    
    const displayTime = dataTimeStr || '2026-07-25 07:00-19:00 Daily Avg.';
    image.print(fontSmall, timeX, timeY, displayTime);
    
    // const disclaimer = "📊 中央氣象署｜僅供生活保健參考，非醫療診斷依據";
    // image.print(fontDisclaimer, disX, disY, disclaimer);
    
    const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
    console.log(`✅ 圖片生成完成 (大小: ${Math.round(buffer.length / 1024)} KB)`);
    return buffer;
    
  } catch (error) {
    console.error('❌ 生成圖片失敗:', error.message);
    return null;
  }
}

// ==========================================
// ✅ 發布到 Facebook 限時動態
// ==========================================
async function publishToFacebookStory(imageUrl) {
  try {
    console.log(`📤 開始發布 Facebook 限時動態...`);
    console.log(`🖼️  圖片網址: ${imageUrl}`);
    
    const uploadRes = await axios.post(
      `https://graph.facebook.com/v21.0/${FB_PAGE_ID}/photos`,
      { url: imageUrl, published: false },
      { params: { access_token: FB_ACCESS_TOKEN }, timeout: 30000 }
    );
    
    const photoId = uploadRes.data.id;
    console.log(`✅ 圖片上傳成功，photo_id: ${photoId}`);
    
    const storyRes = await axios.post(
      `https://graph.facebook.com/v21.0/${FB_PAGE_ID}/photo_stories`,
      { photo_id: photoId, caption: '🌡️ 皮膚壓力指數 (全天綜合)' },
      { params: { access_token: FB_ACCESS_TOKEN }, timeout: 30000 }
    );
    
    console.log(`✅ Facebook 限時動態發布成功！`);
    return storyRes.data;
    
  } catch (error) {
    console.error('❌ Facebook 發布失敗:', error.response?.data?.error?.message || error.message);
    return null;
  }
}

// ==========================================
// ✅ 核心發布流程（06:30 執行）
// ==========================================
async function runDailyPublish() {
  if (isPublishing) {
    console.log('⚠️ 發布流程已在執行中，跳過');
    return;
  }
  
  isPublishing = true;
  
  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📅 開始每日發布流程 - ${getTaiwanTime().toLocaleString()}`);
    console.log(`${'='.repeat(60)}`);
    
    const startOffset = calculateStartOffset();
    console.log(`📌 從 +${startOffset} 天開始抓取`);
    
    const allData = await calculateAllCities(startOffset);
    
    const citiesData = [];
    let globalDataTime = null;
    
    for (let i = 0; i < CITIES.length; i++) {
      const city = CITIES[i];
      const data = allData.results[i] || {};
      citiesData.push({
        name: city.displayName,
        day0: data.day0,
        day1: data.day1
      });
      if (!globalDataTime && data.day0Raw?.dataTime) {
        globalDataTime = data.day0Raw.dataTime;
      }
    }
    
    if (!globalDataTime) {
      const now = new Date();
      globalDataTime = now.toISOString().replace('T', ' ').slice(0, 19) + ' Daily Avg.';
    }
    
    const taiwanNow = getTaiwanTime();
    const baseDate = new Date(taiwanNow);
    baseDate.setDate(baseDate.getDate() + startOffset);
    
    const d0 = new Date(baseDate);
    const d1 = new Date(baseDate);
    d1.setDate(d1.getDate() + 1);
    
    const day0Label = `${d0.getMonth()+1}/${d0.getDate()}`;
    const day1Label = `${d1.getMonth()+1}/${d1.getDate()}`;
    
    console.log(`\n📸 生成 LINE 版圖片...`);
    const imageBufferLine = await generatePage1Image(day0Label, day1Label, citiesData, globalDataTime, 'line');
    fs.writeFileSync(path.join('/tmp', 'current_page1.png'), imageBufferLine);
    console.log(`✅ LINE 版圖片已儲存`);
    
    console.log(`\n📸 生成 FB 版圖片...`);
    const imageBufferFb = await generatePage1Image(day0Label, day1Label, citiesData, globalDataTime, 'fb');
    fs.writeFileSync(path.join('/tmp', 'current_page1_fb.png'), imageBufferFb);
    console.log(`✅ FB 版圖片已儲存`);
    
    const page1 = {
      type: 'image',
      originalContentUrl: `${BASE_URL}/tmp/current_page1.png`,
      previewImageUrl: `${BASE_URL}/tmp/current_page1.png`
    };
    
    const page2 = {
      type: 'image',
      originalContentUrl: `${BASE_URL}/images/template_page2.png`,
      previewImageUrl: `${BASE_URL}/images/template_page2.png`
    };
    
    cachedForecast = { page1, page2 };
    lastCacheTime = new Date();
    
    const cacheData = {
      page1, page2,
      lastCacheTime: lastCacheTime.toISOString(),
      startOffset
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
    
    // ✅ 儲存 DeepSeek Prompt（僅存檔，不寄信）
    if (allData.deepseekPrompt) {
      fs.writeFileSync('./deepseek_prompt.txt', allData.deepseekPrompt);
      console.log(`✅ DeepSeek Prompt 已儲存到 deepseek_prompt.txt`);
    }
    
    const fbImageUrl = `${BASE_URL}/tmp/current_page1_fb.png?t=${Date.now()}`;
    await publishToFacebookStory(fbImageUrl);
    
    console.log(`\n📤 推播給 ${subscribers.length} 位個人訂閱者`);
    console.log(`📊 訊息佇列長度: ${messageQueue.length}`);
    
    if (cachedForecast && cachedForecast.page1) {
      for (const userId of subscribers) {
        await pushToUserQueued(userId, cachedForecast.page1);
      }
    }
    
    console.log(`\n✅ 每日發布流程完成！`);
    console.log(`${'='.repeat(60)}\n`);
    
  } catch (error) {
    console.error('❌ 每日發布流程失敗:', error);
  } finally {
    isPublishing = false;
  }
}

// ==========================================
// 錯誤訊息 Flex Message
// ==========================================
function getErrorFlexMessage() {
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
// ✅ 產生圖片訊息（統一使用快取）
// ==========================================
async function generatePage1ImageFlex(version = 'line') {
  try {
    const cache = await getCachedForecast();
    
    if (cache && cache.page1) {
      console.log(`📦 使用快取圖片 (版本: ${version})`);
      
      const filename = version === 'fb' ? 'current_page1_fb.png' : 'current_page1.png';
      return {
        type: 'image',
        originalContentUrl: `${BASE_URL}/tmp/${filename}`,
        previewImageUrl: `${BASE_URL}/tmp/${filename}`
      };
    }
    
    console.log(`⚠️ 快取不存在，立即執行發布流程`);
    await runDailyPublish();
    
    const filename = version === 'fb' ? 'current_page1_fb.png' : 'current_page1.png';
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
// 快取管理函數
// ==========================================
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
    console.log('⚠️ 快取不存在，執行發布流程');
    await runDailyPublish();
    return cachedForecast;
  }
  
  if (lastCacheTime && (Date.now() - lastCacheTime.getTime() > 24 * 60 * 60 * 1000)) {
    console.log('⚠️ 快取已超過 24 小時，執行發布流程');
    await runDailyPublish();
    return cachedForecast;
  }
  
  return cachedForecast;
}

// ==========================================
// ✅ 網站 API
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
  res.json({ 
    status: 'ok', 
    subscribers: subscribers.length, 
    indoorTemp: INDOOR_TEMP, 
    cacheTime: lastCacheTime?.toLocaleString()
  });
});

app.get('/health', (req, res) => {
  console.log(`💓 健康檢查 - ${new Date().toLocaleString()}`);
  res.status(200).send('OK');
});

app.get('/api/refresh-cache', async (req, res) => {
  console.log('🔄 手動觸發發布流程');
  await runDailyPublish();
  res.json({ 
    success: true, 
    message: '發布流程已執行', 
    cacheTime: lastCacheTime?.toLocaleString()
  });
});

app.get('/api/push-test', async (req, res) => {
  console.log('🔄 手動觸發推播測試');
  await runDailyPublish();
  res.json({ 
    success: true, 
    message: '推播測試已執行'
  });
});

// ==========================================
// ✅ 提供 deepseek_prompt.txt 的下載路由（方式一）
// ==========================================
app.get('/download-deepseek-prompt', (req, res) => {
  const filePath = path.join(__dirname, 'deepseek_prompt.txt');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'deepseek_prompt.txt', (err) => {
      if (err) {
        console.error('下載失敗:', err);
        res.status(500).send('無法下載檔案');
      }
    });
  } else {
    res.status(404).send('檔案尚未生成，請稍後再試');
  }
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
            `🌡️💧 皮膚壓力指數 Bot 已加入！

📊 使用方式：
• 輸入「全台」查詢六都 (LINE版)
• 輸入「全台1」查詢六都 (FB版)

💡 結果會「直接」在群組中回覆`);
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
          await replyTextMessage(replyToken, '⚠️ 系統忙碌中，請稍後再試。');
          continue;
        }
        
        if (isUserRateLimited(sourceId)) {
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
        
        // ✅ 全台 → LINE 版
        if (input === '全台' || input === 'ALL') {
          console.log(`📱 用戶請求全台 (LINE版)`);
          const imageMsg = await generatePage1ImageFlex('line');
          if (imageMsg) {
            await replyMessage(replyToken, imageMsg);
          } else {
            const errorMsg = getErrorFlexMessage();
            await replyMessage(replyToken, errorMsg);
          }
          continue;
        }
        
        // ✅ 全台1 → FB 版
        if (input === '全台1' || input === 'ALL1') {
          console.log(`📱 用戶請求全台1 (FB版)`);
          const imageMsg = await generatePage1ImageFlex('fb');
          if (imageMsg) {
            await replyMessage(replyToken, imageMsg);
          } else {
            const errorMsg = getErrorFlexMessage();
            await replyMessage(replyToken, errorMsg);
          }
          continue;
        }
        
        // ✅ 相容舊版指令
        if (input === '全台2' || input === 'ALL2' || input === '全台3' || input === 'ALL3' || 
            input === '全台4' || input === 'ALL4') {
          const version = (input === '全台2' || input === 'ALL2' || input === '全台4' || input === 'ALL4') ? 'fb' : 'line';
          console.log(`📱 用戶請求 ${input} (相容模式，版本: ${version})`);
          const imageMsg = await generatePage1ImageFlex(version);
          if (imageMsg) {
            await replyMessage(replyToken, imageMsg);
          } else {
            const errorMsg = getErrorFlexMessage();
            await replyMessage(replyToken, errorMsg);
          }
          continue;
        }
        
        if (sourceType === 'group') {
          await replyTextMessage(replyToken, 
            `📊 查詢六都皮膚壓力指數\n\n請輸入「全台」(LINE版) 或「全台1」(FB版)`);
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
// ⭐ 定時任務
// ==========================================

// 每日 06:30 執行發布流程
cron.schedule('30 6 * * *', () => {
  console.log(`\n⏰ [06:30] 觸發每日發布流程`);
  runDailyPublish();
}, {
  timezone: "Asia/Taipei"
});

console.log('📅 已設定定時任務：每天 06:30 (台灣時間) 執行發布流程');

// 定時 ping 防止 Render 休眠
const RENDER_URL = process.env.RENDER_URL || BASE_URL;
setInterval(() => {
  axios.get(`${RENDER_URL}/health`).catch(() => {});
  console.log(`💓 Ping 健康檢查 - ${new Date().toLocaleString()}`);
}, 10 * 60 * 1000);
console.log('💓 已設定定時 ping（每 10 分鐘）防止 Render 休眠');

// ==========================================
// 啟動伺服器
// ==========================================
(async () => {
  await loadFromGitHub();
  loadCacheFromFile();
  
  if (!cachedForecast) {
    console.log('🚀 啟動時無快取，立即執行發布流程');
    await runDailyPublish();
  } else if (lastCacheTime && (Date.now() - lastCacheTime.getTime() > 24 * 60 * 60 * 1000)) {
    console.log('⚠️ 快取已超過 24 小時，執行發布流程');
    await runDailyPublish();
  }
  
  const PORT = process.env.PORT || 10000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 ========================================`);
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🏠 室內基準：${INDOOR_TEMP}℃`);
    console.log(`📡 使用全天綜合指標 (07:00-19:00)`);
    console.log(`📌 取樣策略：07:00固定, 08-18前後抓避重複, 19:00固定`);
    console.log(`🔒 門檻：≥10筆數據 且 覆蓋≥10小時 (08:00-18:00)`);
    console.log(`⏰ 發布時間：每天 06:30 (台灣時間)`);
    console.log(`📱 LINE 指令：全台 → LINE版 | 全台1 → FB版`);
    console.log(`📦 快取狀態：${cachedForecast ? '已載入' : '無'}`);
    console.log(`📋 個人訂閱：${subscribers.length} 人`);
    console.log(`👥 群組數量：${groups.length} 個`);
    console.log(`📥 下載連結：/download-deepseek-prompt`);
    console.log(`========================================\n`);
  });
})();
