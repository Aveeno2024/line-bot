const express = require('express');
const axios = require('axios');
const fs = require('fs');
const cron = require('node-cron');
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
const GROUPS_FILE = './groups.json';
const CACHE_FILE = './cached_forecast.json';

// 全域變數
let subscribers = [];
let groups = [];
let cachedForecast = null;
let lastCacheTime = null;
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
const ES_26 = 3.36; // 26℃ 飽和水蒸氣壓 (kPa)

const CITIES = [
  { code: "1", name: "臺北市", displayName: "臺北市", apiName: "臺北市" },
  { code: "2", name: "新北市", displayName: "新北市", apiName: "新北市" },
  { code: "3", name: "桃園市", displayName: "桃園市", apiName: "桃園市" },
  { code: "4", name: "臺中市", displayName: "臺中市", apiName: "臺中市" },
  { code: "5", name: "臺南市", displayName: "臺南市", apiName: "臺南市" },
  { code: "6", name: "高雄市", displayName: "高雄市", apiName: "高雄市" }
];

// ==========================================
// SHPI V3 核心計算函數（與 VBA 版本一致）
// ==========================================

/**
 * Tetens 公式：計算飽和水蒸氣壓
 * e_s(T) = 0.6112 * exp(17.67 * T / (T + 243.5))
 */
function calcSaturationVaporPressure(temp) {
  return 0.6112 * Math.exp((17.67 * temp) / (temp + 243.5));
}

/**
 * 計算室內穩態水蒸氣壓 e_in
 * e_in = 1.70 + 0.06*(T_out - 28) + 0.004*(RH_out - 50)
 * 限制在 1.45 ~ 2.20 之間
 */
function calcIndoorVaporPressure(tempOut, humOut) {
  let e_in = 1.70 + 0.06 * (tempOut - 28) + 0.004 * (humOut - 50);
  if (e_in < 1.45) e_in = 1.45;
  if (e_in > 2.20) e_in = 2.20;
  return e_in;
}

/**
 * 計算乾燥指數 DI = 100 - RH_in
 * RH_in = 100 * e_in / 3.36
 */
function calcDI(e_in) {
  const RH_in = 100 * e_in / ES_26;
  return 100 - RH_in;
}

/**
 * 燈號判定（與 VBA 版本完全一致）
 * 🟢 綠燈：Δe < 0.8 且 DI < 44
 * 🟡 黃燈：0.8 ≤ Δe < 1.2 或 44 ≤ DI < 52
 * 🟠 橘燈：1.2 ≤ Δe < 1.6 或 52 ≤ DI < 58
 * 🔴 紅燈：Δe ≥ 1.6 或 DI ≥ 58
 */
function getLightLevel(delta_e, di) {
  // 🔴 紅燈：最高優先級
  if (delta_e >= 1.6 || di >= 58) {
    return { level: 4, name: "紅燈", emoji: "🔴", color: "#FF0000", bgColor: "#FF0000", textColor: "#FFFFFF" };
  }
  // 🟠 橘燈
  if ((delta_e >= 1.2 && delta_e < 1.6) || (di >= 52 && di < 58)) {
    return { level: 3, name: "橘燈", emoji: "🟠", color: "#FF8C00", bgColor: "#FF8C00", textColor: "#FFFFFF" };
  }
  // 🟡 黃燈
  if ((delta_e >= 0.8 && delta_e < 1.2) || (di >= 44 && di < 52)) {
    return { level: 2, name: "黃燈", emoji: "🟡", color: "#FFD700", bgColor: "#FFD700", textColor: "#333333" };
  }
  // 🟢 綠燈
  return { level: 1, name: "綠燈", emoji: "🟢", color: "#00CC00", bgColor: "#00CC00", textColor: "#FFFFFF" };
}

/**
 * 完整 SHPI V3 計算（單日）- 含詳細 LOG
 */
function calculateSHPI(tempOut, humOut) {
  // 步驟1：飽和水蒸氣壓
  const e_s = calcSaturationVaporPressure(tempOut);
  
  // 步驟2：室外實際水蒸氣壓
  const e_out = e_s * humOut / 100;
  
  // 步驟3：室內穩態水蒸氣壓
  const e_in = calcIndoorVaporPressure(tempOut, humOut);
  
  // 步驟4：乾燥指數 DI
  const di = calcDI(e_in);
  
  // 步驟5：絕對濕度壓力指數 Δe
  const delta_e = e_out - e_in;
  
  // 燈號判定
  const light = getLightLevel(delta_e, di);
  
  // ============================================================
  // ✅ 詳細 LOG 顯示
  // ============================================================
  console.log(`\n   📊 ===== SHPI V3 計算結果 =====`);
  console.log(`   🌡️  氣溫: ${Math.round(tempOut)}℃`);
  console.log(`   💧  室外濕度: ${Math.round(humOut)}%`);
  console.log(`   📐  飽和水蒸氣壓 (e_s): ${Math.round(e_s * 1000) / 1000} kPa`);
  console.log(`   📤  室外水蒸氣壓 (e_out): ${Math.round(e_out * 1000) / 1000} kPa`);
  console.log(`   📥  室內水蒸氣壓 (e_in): ${Math.round(e_in * 1000) / 1000} kPa`);
  console.log(`   📊  室內相對濕度 (RH_in): ${Math.round(100 * e_in / ES_26)}%`);
  console.log(`   🔥  室內乾燥指數 (DI): ${Math.round(di * 10) / 10}`);
  console.log(`   ⚡  絕對濕度壓力指數 (Δe): ${Math.round(delta_e * 1000) / 1000} kPa`);
  console.log(`   🚦  燈號: ${light.emoji} ${light.name}`);
  console.log(`   ${'='.repeat(40)}`);
  
  return {
    tempOut: Math.round(tempOut),
    humOut: Math.round(humOut),
    e_s: Math.round(e_s * 1000) / 1000,
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

/**
 * 取得台灣時間的 Date 物件
 */
function getTaiwanTime() {
  const now = new Date();
  return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

/**
 * 取得台灣時間日期字串 (YYYY-MM-DD)
 */
function getTaiwanDateString(offset = 0) {
  const taiwanTime = getTaiwanTime();
  const year = taiwanTime.getUTCFullYear();
  const month = taiwanTime.getUTCMonth() + 1;
  const day = taiwanTime.getUTCDate() + offset;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 取得台灣時間小時
 */
function getTaiwanHour() {
  return getTaiwanTime().getUTCHours();
}

/**
 * 取得台灣時間分鐘
 */
function getTaiwanMinute() {
  return getTaiwanTime().getUTCMinutes();
}

// ==========================================
// 中央氣象署 API - 獲取 14:00 的預報資料（含完整結構 LOG）
// ==========================================

async function getForecastAtTime(city, dateOffset = 0, targetHour = 14) {
  console.log(`\n🔍 ===== ${city.displayName} 第${dateOffset+1}天原始數據 ====`);
  console.log(`📡 請求: ${city.displayName} ${dateOffset}天後 ${targetHour}:00`);
  
  try {
    const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-089?Authorization=${CWA_API_KEY}&format=JSON&LocationName=${encodeURIComponent(city.apiName)}`;
    const response = await axios.get(url, { timeout: 15000 });
    const data = response.data;
    
    // ============================================================
    // ✅ 完整 API 回應結構檢查 LOG
    // ============================================================
    console.log(`\n   📦 ===== API 完整回應結構檢查 =====`);
    console.log(`   🔍 success: ${data.success}`);
    console.log(`   🔍 records 存在: ${!!data.records}`);
    
    if (data.records) {
      console.log(`   🔍 Locations 存在: ${!!data.records.Locations}`);
      if (data.records.Locations) {
        console.log(`   🔍 Locations 數量: ${data.records.Locations.length}`);
        for (let i = 0; i < data.records.Locations.length; i++) {
          const locSet = data.records.Locations[i];
          console.log(`   📍 Location[${i}]: ${locSet.LocationsName || '無名稱'}`);
          if (locSet.Location) {
            console.log(`      📍 包含 ${locSet.Location.length} 個城市`);
            for (const loc of locSet.Location) {
              if (loc.LocationName === city.apiName) {
                console.log(`      ✅ 找到目標城市: ${loc.LocationName}`);
                if (loc.WeatherElement) {
                  console.log(`      📊 WeatherElement 數量: ${loc.WeatherElement.length}`);
                  for (const elem of loc.WeatherElement) {
                    console.log(`         📊 ${elem.ElementName}: ${elem.Time ? elem.Time.length : 0} 筆資料`);
                    if (elem.Time && elem.Time.length > 0) {
                      const times = elem.Time.slice(0, 3).map(t => t.DataTime).join(', ');
                      console.log(`            🕐 時間範例: ${times}${elem.Time.length > 3 ? ' ...' : ''}`);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    console.log(`   ${'='.repeat(50)}`);
    
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
    
    // ============================================================
    // ✅ 使用台灣時間計算目標日期 (YYYY-MM-DD)
    // ============================================================
    const targetDateStr = getTaiwanDateString(dateOffset);
    console.log(`📅 目標日期 (台灣時間): ${targetDateStr}`);
    
    // ============================================================
    // ✅ 列出所有可用的時間點（供驗證）
    // ============================================================
    console.log(`\n   📋 ===== ${city.displayName} 所有可用時間點 (溫度) =====`);
    const allTimes = tempElem.Time.map(t => t.DataTime).join(', ');
    console.log(`   🕐 ${allTimes}`);
    console.log(`   ${'='.repeat(50)}`);
    
    // ============================================================
    // ✅ 同時比對日期和時間
    // ============================================================
    let tempValue = null, humValue = null;
    let actualDataTime = null;
    
    for (const t of tempElem.Time) {
      const dataTime = t.DataTime;
      if (dataTime) {
        const parts = dataTime.split('T');
        if (parts.length === 2) {
          const datePart = parts[0];
          const timePart = parts[1]?.split(':')[0];
          if (datePart === targetDateStr && parseInt(timePart) === targetHour) {
            tempValue = t.ElementValue?.[0]?.Temperature;
            actualDataTime = dataTime;
            console.log(`✅ 找到匹配: ${dataTime} → 溫度=${tempValue}℃`);
            break;
          }
        }
      }
    }
    
    if (actualDataTime) {
      for (const h of humElem.Time) {
        if (h.DataTime === actualDataTime) {
          humValue = h.ElementValue?.[0]?.RelativeHumidity;
          console.log(`✅ 找到匹配濕度: ${actualDataTime} → 濕度=${humValue}%`);
          break;
        }
      }
    }
    
    if (tempValue && humValue && actualDataTime) {
      const formattedTime = actualDataTime.replace('T', ' ').replace(/\+08:00/g, '').trim();
      console.log(`📊 原始數據: 溫度=${tempValue}℃, 濕度=${humValue}%`);
      console.log(`📅 API DataTime: ${formattedTime}`);
      console.log(`✅ API 連線成功`);
      return {
        temp: Math.round(parseFloat(tempValue)),
        humidity: Math.round(parseFloat(humValue)),
        dataTime: formattedTime
      };
    }
    
    console.log(`❌ 找不到 ${targetDateStr} ${targetHour}:00 的數據`);
    console.log(`   💡 提示: 請檢查上方「所有可用時間點」列表，確認該時段是否存在`);
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
    console.error(`❌ 即時API錯誤: ${error.message}`);
    return null;
  }
}

// ==========================================
// 獲取天氣資料（支援即時觀測備援 + 多時間點備援）
// ==========================================

async function getWeather(city, dateOffset = 0, targetHour = 14) {
  // 先嘗試從預報 API 抓取
  let weather = await getForecastAtTime(city, dateOffset, targetHour);
  
  // ✅ 如果預報 API 失敗，且 dateOffset === 0（今天），改用即時觀測
  if (!weather && dateOffset === 0) {
    console.log(`⚠️ 預報API失敗 (今天 14:00 已過或無資料)，嘗試使用即時觀測API`);
    weather = await getCurrentWeather(city);
  }
  
  // ============================================================
  // ✅ 如果 dateOffset > 0 且失敗，嘗試其他時間點
  // ============================================================
  if (!weather && dateOffset > 0) {
    const fallbackHours = [12, 18, 20, 8];
    console.log(`⚠️ ${city.displayName} dateOffset=${dateOffset} 的 ${targetHour}:00 無資料`);
    console.log(`   🔄 嘗試備用時間點: ${fallbackHours.join(', ')}`);
    
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
  
  if (!weather) {
    console.log(`❌ ${city.displayName} 所有 API 都失敗，標記為暫無資料`);
    return null;
  }
  
  return weather;
}

// ==========================================
// 計算起始偏移量（根據台灣時間）
// ==========================================

function calculateStartOffset() {
  const hours = getTaiwanHour();
  const minutes = getTaiwanMinute();
  
  if (hours >= 18) {
    console.log(`⏰ 台灣時間 ${hours}:${minutes}，已過 18:00，從 +1 天（明天）開始抓取預報`);
    return 1;
  } else {
    console.log(`⏰ 台灣時間 ${hours}:${minutes}，尚未過 18:00，從 +0 天（今天）開始抓取（必要時改用即時觀測）`);
    return 0;
  }
}

// ==========================================
// 計算城市 2 天預報（支援起始偏移 + 詳細狀態 LOG）
// ==========================================

async function calculateCityTwoDays(city, startOffset = 0, targetHour = 14) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🏙️ 開始計算 ${city.displayName} 連續2天預報 (從 +${startOffset} 天開始)`);
  console.log(`${'='.repeat(60)}`);
  
  const weather0 = await getWeather(city, startOffset, targetHour);
  const weather1 = await getWeather(city, startOffset + 1, targetHour);
  
  // ============================================================
  // ✅ 詳細 LOG：確認 weather0 和 weather1 的狀態
  // ============================================================
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
  
  // ============================================================
  // ✅ 計算完成的確認 LOG
  // ============================================================
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
}

function getDateString(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getMonth()+1}/${date.getDate()}`;
}

// ==========================================
// 燈號說明對照表（完全依照 DOCX 原文）
// ==========================================
const LIGHT_DESCRIPTIONS = {
  "綠燈": {
    title: "🟢 綠燈：動態平衡 (Low Impact)",
    desc: "環境濕度與角質層處於自然緩衝區，肌膚可維持恆定。",
    suggestions: [
      "一般保養建議： 避免過度保養（Over-treatment）。暫停使用厚重脂質，以免阻斷肌膚正常生理代謝信號。",
      "弱敏肌族群提醒： 環境濕度不構成皮膚壓力，若出現泛紅、乾癢，請優先排除天氣因素，檢視其他潛在刺激源。"
    ]
  },
  "黃燈": {
    title: "🟡 黃燈：慢性耗竭 (Moderate Impact)",
    desc: "室內外濕度變化加大，皮膚細胞頻繁調節導致過勞，下午或傍晚易產生緊繃或過度出油。",
    suggestions: [
      "一般保養建議： 避免使用清潔力過強的洗劑，以免加重皮脂膜及角質層的損耗。",
      "弱敏肌族群提醒： 暫停去角質動作，並避免使用酸類保養品，保留肌膚物理緩衝厚度。"
    ]
  },
  "橘燈": {
    title: "🟠 橘燈：高壓衝擊 (High Impact)",
    desc: "室內外溫差過大，皮脂膜變性鬆動。皮膚易顯乾粗、暗沉；進出室內外瞬間，臉部易產生微熱、刺感或局部泛紅。",
    suggestions: [
      "一般保養建議： 提防冷氣出風口的「強制風乾」效應，建議切換為修護型產品，輔助角質層鎖水。",
      "弱敏肌族群提醒： 嚴禁使用「純水噴霧」降溫，以免加劇「越噴越乾、越噴越紅」的惡性循環。"
    ]
  },
  "紅燈": {
    title: "🔴 紅燈：極端警報 (Dangerous Impact)",
    desc: "溫濕度變化突破防禦極限，極易引發乾癢、緊繃刺痛或局部脫屑。",
    suggestions: [
      "一般保養建議： 常規產品保濕力已不足以抵禦環境抽水，必須採用高能修護與封閉性保濕手段。",
      "弱敏肌族群提醒： 啟動「減法保養」！全面停用美白、高濃度維他命等功能性產品，避免任何可能引發刺激的成分。"
    ]
  }
};

// ==========================================
// 錯誤訊息 Flex Message
// ==========================================
function getErrorFlexMessage() {
  const today = getDateString(0);
  const tomorrow = getDateString(1);
  
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
          { type: "text", text: "⚠️ 服務暫時無法使用", weight: "bold", size: "xl", color: "#ffffff" },
          { type: "text", text: `預報日期 ${today} ~ ${tomorrow}`, size: "md", color: "#dddddd", margin: "xs" }
        ],
        backgroundColor: "#FF6600",
        paddingAll: "20px"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "中央氣象署 API 暫時無法連線", size: "lg", weight: "bold", color: "#FF0000", wrap: true },
          { type: "text", text: "請稍後再試，或聯繫管理員。", size: "md", color: "#666666", wrap: true },
          { type: "separator", margin: "md" },
          { type: "text", text: "💡 您可以嘗試：", size: "md", weight: "bold" },
          { type: "text", text: "• 幾分鐘後重新查詢", size: "sm", color: "#666666" },
          { type: "text", text: "• 加入 LINE 好友接收推播", size: "sm", color: "#666666" }
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
// 第一頁：Flex Message（6都預報表格 - 2天）
// ==========================================
async function generatePage1Flex(startOffset = 0) {
  const citiesData = [];
  let globalDataTime = null;
  const day0Lights = new Set();
  const allLightNames = ["綠燈", "黃燈", "橘燈", "紅燈"];
  
  for (const city of CITIES) {
    const twoDays = await calculateCityTwoDays(city, startOffset, 14);
    citiesData.push(twoDays);
    
    if (!globalDataTime && twoDays.dataTime) {
      globalDataTime = twoDays.dataTime;
    }
    
    // 收集第一天出現的燈號
    const day0 = twoDays.days[0];
    if (day0 && day0.light && allLightNames.includes(day0.light.name)) {
      day0Lights.add(day0.light.name);
    }
  }
  
  // ============================================================
  // ✅ 從 API 的 dataTime 提取日期（移除 +08:00）
  // ============================================================
  let day0Label = "日期1";
  let day1Label = "日期2";
  
  if (globalDataTime) {
    const cleanTime = globalDataTime.replace(/\+08:00/g, '').trim();
    const parts = cleanTime.split(' ');
    if (parts.length > 0) {
      const dateParts = parts[0].split('-');
      if (dateParts.length === 3) {
        const year = parseInt(dateParts[0]);
        const month = parseInt(dateParts[1]);
        const day = parseInt(dateParts[2]);
        day0Label = `${month}/${day}`;
        
        const d = new Date(year, month - 1, day);
        d.setDate(d.getDate() + 1);
        day1Label = `${d.getMonth()+1}/${d.getDate()}`;
        
        console.log(`✅ 從 API 日期提取: ${day0Label} ~ ${day1Label}`);
      }
    }
  } else {
    const taiwanTime = getTaiwanTime();
    const year = taiwanTime.getUTCFullYear();
    const month = taiwanTime.getUTCMonth() + 1;
    const day = taiwanTime.getUTCDate() + startOffset;
    day0Label = `${month}/${day}`;
    
    const d = new Date(year, month - 1, day);
    d.setDate(d.getDate() + 1);
    day1Label = `${d.getMonth()+1}/${d.getDate()}`;
    
    console.log(`⚠️ 使用備用日期: ${day0Label} ~ ${day1Label}`);
  }
  
  // ============================================================
  // ✅ 建立表格標題列
  // ============================================================
  const tableRows = [
    { type: "box", layout: "horizontal", contents: [
      { type: "text", text: "城市", weight: "bold", size: "lg", flex: 2 },
      { type: "text", text: day0Label, weight: "bold", size: "lg", flex: 1, align: "center" },
      { type: "text", text: day1Label, weight: "bold", size: "lg", flex: 1, align: "center" }
    ]},
    { type: "separator", margin: "sm" }
  ];
  
  let hasError = false;
  
  // ============================================================
  // ✅ 逐城市填入燈號
  // ============================================================
  for (const cityData of citiesData) {
    const day0 = cityData.days[0];
    const day1 = cityData.days[1];
    
    if (!day0 || !day1) {
      hasError = true;
    }
    
    const emoji0 = day0 ? day0.light.emoji : "❓";
    const emoji1 = day1 ? day1.light.emoji : "❓";
    const color0 = day0 ? day0.light.color : "#999999";
    const color1 = day1 ? day1.light.color : "#999999";
    
    tableRows.push({
      type: "box", layout: "horizontal", contents: [
        { type: "text", text: cityData.city, size: "lg", flex: 2 },
        { type: "text", text: emoji0, size: "xl", flex: 1, align: "center", color: color0 },
        { type: "text", text: emoji1, size: "xl", flex: 1, align: "center", color: color1 }
      ]
    });
  }
  
  // ============================================================
  // ✅ 資料時間（移除 +08:00）
  // ============================================================
  let dataTimeStr = globalDataTime || new Date().toLocaleString();
  dataTimeStr = dataTimeStr.replace(/\+08:00/g, '').trim();
  
  // ============================================================
  // ✅ 建立 Body 內容（只放表格，不放燈號說明）
  // ============================================================
  const bodyContents = [...tableRows];
  
  // ============================================================
  // ✅ Footer 內容
  // ============================================================
  const footerContents = [
    { type: "separator" },
    { type: "text", text: `🕐 資料時間：${dataTimeStr}`, size: "sm", color: "#999999", align: "center" },
    { type: "text", text: "🏠 室內基準溫度：冷氣房 26℃", size: "md", color: "#999999", align: "center" },
    { type: "text", text: "📊 數據來源：中央氣象署", size: "sm", color: "#999999", align: "center" },
    { type: "button", style: "primary", height: "sm", action: { type: "message", label: "📋 查看燈號說明及建議", text: "詳細說明" }, margin: "md", color: "#667eea" }
  ];
  
  if (hasError) {
    footerContents.splice(3, 0, { 
      type: "text", 
      text: "⚠️ 部分城市資料取得失敗，顯示「❓」表示暫無資料", 
      size: "sm", 
      color: "#FF6600", 
      align: "center",
      wrap: true
    });
  }
  
  // ============================================================
  // ✅ 回傳 Flex Message（包含 day0Lights 供第二頁使用）
  // ============================================================
  return {
    page1: {
      type: "flex",
      altText: `🌡️💧 皮膚濕度壓力指數 ${day0Label}~${day1Label}`,
      contents: {
        type: "bubble",
        size: "mega",
        header: {
          type: "box",
          layout: "vertical",
          contents: [
            { type: "text", text: "🌡️💧 皮膚濕度壓力指數", weight: "bold", size: "xl", color: "#ffffff" },
            { type: "text", text: `預報日期 ${day0Label} ~ ${day1Label} (下午2點數據)`, size: "md", color: "#dddddd", margin: "xs" }
          ],
          backgroundColor: "#667eea",
          paddingAll: "20px"
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: bodyContents,
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
    },
    day0Lights: day0Lights
  };
}

// ==========================================
// 第二頁：燈號說明與保健建議（以 DOCX 內容為準，保留查詢指令與訂閱管理）
// ==========================================
async function generatePage2Flex(day0Lights = new Set()) {
  // 只顯示第一天出現的燈號
  const validLights = Array.from(day0Lights).filter(name => ["綠燈", "黃燈", "橘燈", "紅燈"].includes(name));
  
  // 建立 body 內容
  const bodyContents = [];
  
  if (validLights.length === 0) {
    // 若無燈號資料，顯示提示
    bodyContents.push({
      type: "text",
      text: "📋 今日尚無燈號資料，請稍後再查詢。",
      size: "md",
      color: "#666666",
      wrap: true
    });
  } else {
    // 依序顯示每個燈號的說明
    for (const lightName of validLights) {
      const info = LIGHT_DESCRIPTIONS[lightName];
      if (info) {
        bodyContents.push({
          type: "text",
          text: info.title,
          weight: "bold",
          size: "md",
          color: {
            "綠燈": "#00CC00",
            "黃燈": "#FFD700",
            "橘燈": "#FF8C00",
            "紅燈": "#FF0000"
          }[lightName] || "#666666",
          margin: "sm"
        });
        bodyContents.push({
          type: "text",
          text: info.desc,
          size: "sm",
          color: "#666666",
          wrap: true
        });
        for (const suggestion of info.suggestions) {
          bodyContents.push({
            type: "text",
            text: suggestion,
            size: "sm",
            color: "#666666",
            wrap: true
          });
        }
        // 燈號之間加分隔線（最後一個不加）
        if (lightName !== validLights[validLights.length - 1]) {
          bodyContents.push({ type: "separator", margin: "md" });
        }
      }
    }
  }
  
  // ============================================================
  // ✅ 加入分隔線
  // ============================================================
  bodyContents.push({ type: "separator", margin: "md" });
  
  // ============================================================
  // ✅ 保留：查詢指令
  // ============================================================
  bodyContents.push({
    type: "text",
    text: "🔍 查詢指令",
    weight: "bold",
    size: "md"
  });
  bodyContents.push({
    type: "text",
    text: "• 輸入「全台」查看六都2天預報",
    size: "sm",
    color: "#666666",
    wrap: true
  });
  bodyContents.push({
    type: "text",
    text: "• 輸入「詳細說明」查看本頁面",
    size: "sm",
    color: "#666666",
    wrap: true
  });
  
  // ============================================================
  // ✅ 保留：訂閱管理
  // ============================================================
  bodyContents.push({ type: "separator", margin: "md" });
  bodyContents.push({
    type: "text",
    text: "🔔 訂閱管理",
    weight: "bold",
    size: "md"
  });
  bodyContents.push({
    type: "text",
    text: "• 輸入「加入訂閱」開啟每日提醒",
    size: "sm",
    color: "#666666",
    wrap: true
  });
  bodyContents.push({
    type: "text",
    text: "• 輸入「取消訂閱」關閉每日提醒",
    size: "sm",
    color: "#666666",
    wrap: true
  });
  
  return {
    type: "flex",
    altText: "📋 燈號說明與保健建議",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "📋 燈號說明與保健建議", weight: "bold", size: "xl", color: "#ffffff" }
        ],
        backgroundColor: "#667eea",
        paddingAll: "20px"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: bodyContents,
        paddingAll: "20px"
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "separator" },
          { type: "text", text: "📊 皮膚壓力指數 (SHPI) 燈號保健建議", size: "xs", color: "#999999", align: "center" },
          { type: "text", text: "📖 科學依據：Denda et al. (2002)", size: "xs", color: "#999999", align: "center" }
        ],
        paddingAll: "12px"
      }
    }
  };
}

// ==========================================
// 快取管理函數（動態 startOffset）
// ==========================================

async function precomputeAndCache() {
  // ✅ 根據台灣時間動態計算起始偏移量
  const startOffset = calculateStartOffset();
  
  console.log(`\n🔄 開始預計算快取 - ${getTaiwanTime().toLocaleString()}`);
  console.log(`📅 從 +${startOffset} 天開始抓取`);
  const startTime = Date.now();
  
  try {
    // ✅ 先產生第一頁，取得 day0Lights
    const page1Result = await generatePage1Flex(startOffset);
    const page1 = page1Result.page1;
    const day0Lights = page1Result.day0Lights || new Set();
    
    // ✅ 產生第二頁，傳入 day0Lights
    const page2 = await generatePage2Flex(day0Lights);
    
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
• 輸入「全台」查詢六都2天預報
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
          // ✅ 從快取中取得 day0Lights（或重新計算）
          const cache = await getCachedForecast();
          // 重新計算 day0Lights
          const startOffset = calculateStartOffset();
          const page1Result = await generatePage1Flex(startOffset);
          const day0Lights = page1Result.day0Lights || new Set();
          const page2 = await generatePage2Flex(day0Lights);
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
// ⭐ 定時預計算任務（僅 18:00 主要）
// ==========================================

// 18:00 預計算（主要 - 確保氣象署 17:00 發布的資料已完整釋出）
cron.schedule('0 18 * * *', () => {
  console.log(`\n⏰ [18:00] 主要預計算 - 使用 17:00 發布的最新資料`);
  precomputeAndCache();
}, {
  timezone: "Asia/Taipei"
});

console.log('📅 已設定定時預計算任務：每天 18:00 (台灣時間)');
console.log('📌 系統會根據台灣時間自動決定從 +0 或 +1 天開始抓取');

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
    console.log(`📡 預報 API：F-D0047-089 (取樣: 下午2點)`);
    console.log(`⏰ 預計算時間：每天 18:00 (台灣時間)`);
    console.log(`📌 系統會根據台灣時間自動決定從 +0 或 +1 天開始抓取`);
    console.log(`🕐 每日推播：上午 7:00 (台灣時間) - 每分鐘檢查`);
    console.log(`📦 快取狀態：${cachedForecast ? '已載入' : '無'}`);
    console.log(`📋 個人訂閱：${subscribers.length} 人`);
    console.log(`👥 群組數量：${groups.length} 個`);
    console.log(`========================================\n`);
  });
})();
