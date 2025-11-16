// ==UserScript==
// @name         JMR LiquidBounce HackClient
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  https://github.com/jiangmuran/CrackTuxun.fun
// @author       jmr
// @match        *://tuxun.fun/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置区 ====================
    const BAIDU_MAP_AK = "你的AK"; // 替换为你的实际AK
    let currentZoom = 8;               // 默认缩放
    const minZoom = 1;
    const maxZoom = 19;
    // ===============================================

    let latestResponseData = null;
    let isCollapsed = false;
    let originalSize = { width: 400, height: 300 };
    let currentMapImage = null;
    let currentLat = null;
    let currentLng = null;
    let isLeftHidden = false;          // 左侧栏是否隐藏
    let isLeftDeleted = false;         // 左侧栏是否被删除
    let clickedLat = null;             // 点击的纬度
    let clickedLng = null;             // 点击的经度
    let currentCoordSource = null;     // 真实坐标来源（用于判断坐标系）
    let clickedCoordSource = null;     // 点击坐标来源

    // ==================== 设置管理 ====================
    const SETTINGS_KEY = 'jmr_hackclient_settings';
    const defaultSettings = {
        showDistanceInfo: true,        // 显示方向提示
        enableCustomAnswer: true       // 启用自定义回答（拦截guess请求）
    };

    // 加载设置
    function loadSettings() {
        try {
            const saved = localStorage.getItem(SETTINGS_KEY);
            if (saved) {
                return { ...defaultSettings, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.error('加载设置失败:', e);
        }
        return { ...defaultSettings };
    }

    // 保存设置
    function saveSettings(settings) {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) {
            console.error('保存设置失败:', e);
        }
    }

    let settings = loadSettings();

    // ---------- 工具函数 ----------
    function createElement(tag, styles = {}, text = '', parent = null) {
        const el = document.createElement(tag);
        // 处理特殊属性
        if (styles.type) {
            el.type = styles.type;
            delete styles.type;
        }
        if (styles.checked !== undefined) {
            el.checked = styles.checked;
            delete styles.checked;
        }
        // 应用样式
        Object.assign(el.style, styles);
        if (text) el.textContent = text;
        if (parent) parent.appendChild(el);
        return el;
    }

    function isTargetRequest(url) {
        try {
            const u = new URL(url, location.href);
            return u.pathname.includes('/mapProxy/') && u.searchParams.has('pano');
        } catch { return false; }
    }

    function isGeoPhotoRequest(url) {
        try {
            return url.includes('GeoPhotoService.GetMetadata') || 
                   (url.includes('/maps/api/js/') && url.includes('GetMetadata'));
        } catch { return false; }
    }

    function isPinRequest(url) {
        try {
            return url.includes('/api/v0/tuxun/game/pin') && 
                   url.includes('lat=') && url.includes('lng=');
        } catch { return false; }
    }

    function isGuessRequest(url) {
        try {
            return url.includes('/api/v0/tuxun/game/guess') && 
                   url.includes('lat=') && url.includes('lng=');
        } catch { return false; }
    }

    // 坐标转换：BD09转GCJ02
    function bd09ToGcj02(bdLat, bdLng) {
        const x = bdLng - 0.0065;
        const y = bdLat - 0.006;
        const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * Math.PI * 3000.0 / 180.0);
        const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * Math.PI * 3000.0 / 180.0);
        const gcjLng = z * Math.cos(theta);
        const gcjLat = z * Math.sin(theta);
        return { lat: gcjLat, lng: gcjLng };
    }

    // 坐标转换：GCJ02转WGS84
    function gcj02ToWgs84(gcjLat, gcjLng) {
        const a = 6378245.0;
        const ee = 0.00669342162296594323;
        let dLat = transformLat(gcjLng - 105.0, gcjLat - 35.0);
        let dLng = transformLng(gcjLng - 105.0, gcjLat - 35.0);
        const radLat = gcjLat / 180.0 * Math.PI;
        let magic = Math.sin(radLat);
        magic = 1 - ee * magic * magic;
        const sqrtMagic = Math.sqrt(magic);
        dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
        dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
        const wgsLat = gcjLat - dLat;
        const wgsLng = gcjLng - dLng;
        return { lat: wgsLat, lng: wgsLng };
    }

    function transformLat(lng, lat) {
        let ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
        ret += (20.0 * Math.sin(6.0 * lng * Math.PI) + 20.0 * Math.sin(2.0 * lng * Math.PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(lat * Math.PI) + 40.0 * Math.sin(lat / 3.0 * Math.PI)) * 2.0 / 3.0;
        ret += (160.0 * Math.sin(lat / 12.0 * Math.PI) + 320 * Math.sin(lat * Math.PI / 30.0)) * 2.0 / 3.0;
        return ret;
    }

    function transformLng(lng, lat) {
        let ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
        ret += (20.0 * Math.sin(6.0 * lng * Math.PI) + 20.0 * Math.sin(2.0 * lng * Math.PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(lng * Math.PI) + 40.0 * Math.sin(lng / 3.0 * Math.PI)) * 2.0 / 3.0;
        ret += (150.0 * Math.sin(lng / 12.0 * Math.PI) + 300.0 * Math.sin(lng / 30.0 * Math.PI)) * 2.0 / 3.0;
        return ret;
    }

    // 统一转换为WGS84坐标系进行计算
    function normalizeToWgs84(lat, lng, coordSystem) {
        if (coordSystem === 'BD09') {
            const gcj = bd09ToGcj02(lat, lng);
            return gcj02ToWgs84(gcj.lat, gcj.lng);
        }
        if (coordSystem === 'GCJ02') {
            return gcj02ToWgs84(lat, lng);
        }
        // WGS84或未知，直接返回
        return { lat, lng };
    }

    // 计算两点之间的距离（米）使用Haversine公式（改进版，更精确）
    function calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371000; // 地球半径（米）
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // 根据米数和方向计算偏移后的坐标
    function offsetCoordinate(lat, lng, distanceMeters, bearingDegrees) {
        const R = 6371000; // 地球半径（米）
        const lat1 = lat * Math.PI / 180;
        const lng1 = lng * Math.PI / 180;
        const bearing = bearingDegrees * Math.PI / 180;
        const d = distanceMeters / R;

        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) +
                               Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
        const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
                                      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

        return {
            lat: lat2 * 180 / Math.PI,
            lng: lng2 * 180 / Math.PI
        };
    }

    // 计算方向（方位角，0-360度）
    function calculateBearing(lat1, lng1, lat2, lng2) {
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const lat1Rad = lat1 * Math.PI / 180;
        const lat2Rad = lat2 * Math.PI / 180;
        const y = Math.sin(dLng) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
                  Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
        let bearing = Math.atan2(y, x) * 180 / Math.PI;
        return (bearing + 360) % 360;
    }

    // 将方位角转换为方向名称
    function bearingToDirection(bearing) {
        const directions = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
        const index = Math.round(bearing / 45) % 8;
        return directions[index];
    }

    // 更新距离信息显示
    function updateDistanceInfo(clickLat, clickLng) {
        if (currentLat == null || currentLng == null) {
            distanceInfo.style.display = 'none';
            return;
        }

        // 判断坐标系并统一转换
        // 真实坐标：如果有bd09Lat/bd09Lng则是BD09，否则可能是GCJ02或WGS84
        // 点击坐标：通常来自URL参数，可能是WGS84或GCJ02
        let finalCurrentLat = currentLat;
        let finalCurrentLng = currentLng;
        let finalClickLat = clickLat;
        let finalClickLng = clickLng;

        // 如果真实坐标是BD09，转换为WGS84
        if (currentCoordSource === 'BD09') {
            const gcj = bd09ToGcj02(currentLat, currentLng);
            const wgs = gcj02ToWgs84(gcj.lat, gcj.lng);
            finalCurrentLat = wgs.lat;
            finalCurrentLng = wgs.lng;
        } else if (currentCoordSource === 'GCJ02') {
            const wgs = gcj02ToWgs84(currentLat, currentLng);
            finalCurrentLat = wgs.lat;
            finalCurrentLng = wgs.lng;
        }

        // 如果点击坐标是GCJ02，转换为WGS84（通常点击坐标不会是BD09）
        if (clickedCoordSource === 'GCJ02') {
            const wgs = gcj02ToWgs84(clickLat, clickLng);
            finalClickLat = wgs.lat;
            finalClickLng = wgs.lng;
        }

        // 计算距离（使用统一坐标系）
        const distance = calculateDistance(finalCurrentLat, finalCurrentLng, finalClickLat, finalClickLng);
        // 计算从点击坐标到真实坐标的方向
        const bearing = calculateBearing(finalClickLat, finalClickLng, finalCurrentLat, finalCurrentLng);
        const direction = bearingToDirection(bearing);

        let distanceText = '';
        if (distance < 1000) {
            distanceText = `${Math.round(distance)}米`;
        } else {
            distanceText = `${(distance / 1000).toFixed(2)}公里`;
        }

        // 显示详细信息，包括原始坐标和转换后的坐标
        const coordInfo = `真实:(${currentLat.toFixed(6)},${currentLng.toFixed(6)}) 点击:(${clickLat.toFixed(6)},${clickLng.toFixed(6)})`;
        distanceInfo.textContent = `📍 距离: ${distanceText} | 方向: ${direction} (${Math.round(bearing)}°) | ${coordInfo}`;
        // 根据设置决定是否显示
        if (settings.showDistanceInfo) {
            distanceInfo.style.display = 'block';
        } else {
            distanceInfo.style.display = 'none';
        }
    }

    function extractCoords(data) {
        const d = data?.data;
        if (!d) return null;
        // 优先使用 lat/lng，而不是 bd09Lat/bd09Lng
        if (d.lat != null && d.lng != null) {
            // 根据数据来源判断，如果是panoInfo可能是GCJ02，如果是GeoPhoto可能是WGS84
            // 这里先假设是GCJ02（火星坐标系），如果偏差大可以改为WGS84
            currentCoordSource = 'GCJ02';
            return { lat: d.lat, lng: d.lng };
        }
        // 如果没有 lat/lng，才使用 bd09Lat/bd09Lng
        if (d.bd09Lat != null && d.bd09Lng != null) {
            currentCoordSource = 'BD09';
            return { lat: d.bd09Lat, lng: d.bd09Lng };
        }
        return null;
    }

    // 从GeoPhotoService响应中提取坐标和国家代码
    function extractGeoPhotoData(jsonpData) {
        try {
            // jsonpData是一个嵌套数组，需要递归查找
            function findCoords(arr) {
                if (!Array.isArray(arr)) return null;
                for (let i = 0; i < arr.length; i++) {
                    const item = arr[i];
                    if (Array.isArray(item) && item.length >= 4) {
                        // 查找形如 [null, null, lat, lng] 的数组
                        if (item[2] != null && item[3] != null && 
                            typeof item[2] === 'number' && typeof item[3] === 'number' &&
                            item[2] >= -90 && item[2] <= 90 && 
                            item[3] >= -180 && item[3] <= 180) {
                            return { lat: item[2], lng: item[3] };
                        }
                    }
                    if (Array.isArray(item)) {
                        const result = findCoords(item);
                        if (result) return result;
                    }
                }
                return null;
            }

            function findCountryCode(arr) {
                if (!Array.isArray(arr)) return null;
                for (let i = 0; i < arr.length; i++) {
                    const item = arr[i];
                    if (typeof item === 'string' && item.length === 2 && /^[A-Z]{2}$/.test(item)) {
                        return item;
                    }
                    if (Array.isArray(item)) {
                        const result = findCountryCode(item);
                        if (result) return result;
                    }
                }
                return null;
            }

            function findFirstUrl(arr) {
                if (!Array.isArray(arr)) return null;
                for (let i = 0; i < arr.length; i++) {
                    const item = arr[i];
                    if (typeof item === 'string' && item.startsWith('http')) {
                        return item;
                    }
                    if (Array.isArray(item)) {
                        const result = findFirstUrl(item);
                        if (result) return result;
                    }
                }
                return null;
            }

            const coords = findCoords(jsonpData);
            const country = findCountryCode(jsonpData);
            const firstUrl = findFirstUrl(jsonpData);

            // GeoPhoto坐标通常是WGS84（国际标准坐标系）
            if (coords) {
                currentCoordSource = 'WGS84';
            }

            return { coords, country, firstUrl };
        } catch (e) {
            console.error('提取GeoPhoto数据失败:', e);
            return null;
        }
    }
    alert("Crack by JMR.\n若未加载出来窗口请尝试多刷新几次");
    alert("本脚本仅供开发人员在独立、安全的测试环境中进行合法的安全研究与验证之用。作者对任何直接或间接后果（包括但不限于虚拟财产损失、经济损失或其他损害）不承担任何责任，亦明确反对任何形式的非公平竞技行为。本脚本已在完全隔离的开发环境中完成测试，严禁在任何官方网站、正式服务器或公共平台上使用，以免破坏游戏公平性。使用者因不当使用所引发的一切法律责任，均由使用者自行承担。根据相关法律法规，使用者须于下载本脚本后24小时内删除所有相关文件。警告：使用本脚本可能导致账号封禁、IP地址限制或其他平台处罚。作者对任何此类后果不承担责任，请勿在任何环境中部署或运行。本脚本基于MIT许可协议开源。任何二次修改、衍生开发或使用，均须明确标注原作者信息，并以相同许可协议开放源代码。严禁用于商业目的或进行私有化修改。")
    // ---------- UI 构造 ----------
    const floatWindow = createElement('div', {
        position: 'fixed', top: '20px', right: '20px',
        width: '800px', height: '600px',
        background: '#fff', border: '1px solid #ccc',
        borderRadius: '8px', boxShadow: '0 2px 15px rgba(0,0,0,0.2)',
        zIndex: '999999', overflow: 'hidden',
        fontFamily: 'monospace', transition: 'all 0.3s ease'
    });
    document.body.appendChild(floatWindow);

    // 标题栏（可拖拽）
    const titleBar = createElement('div', {
        padding: '10px 15px', background: '#2c3e50',
        color: 'white', fontWeight: 'bold',
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', cursor: 'move', userSelect: 'none',
        position: 'relative'
    }, '', floatWindow);

    const collapseIcon = createElement('span', { marginRight: '10px' }, '▼', titleBar);
    createElement('span', {}, 'JMR LiquidBounce HackClient 免费开源于https://github.com/jiangmuran/CrackTuxun.fun', titleBar);

    const buttonContainer = createElement('div', { display: 'flex', gap: '8px' }, '', titleBar);

    // 设置按钮
    const settingsBtn = createElement('button', {
        background: '#9b59b6', color: 'white', border: 'none',
        borderRadius: '4px', padding: '4px 10px', cursor: 'pointer',
        fontSize: '12px', transition: 'background 0.3s'
    }, '⚙️ 设置', buttonContainer);

    // 复制按钮
    const copyBtn = createElement('button', {
        background: '#2ecc71', color: 'white', border: 'none',
        borderRadius: '4px', padding: '4px 10px', cursor: 'pointer',
        fontSize: '12px', transition: 'background 0.3s'
    }, '复制', buttonContainer);

    // 隐藏/显示按钮（仅在左侧未删除时显示）
    const hideBtn = createElement('button', {
        background: '#95a5a6', color: 'white', border: 'none',
        borderRadius: '4px', padding: '4px 10px', cursor: 'pointer',
        fontSize: '12px'
    }, '隐藏左侧', buttonContainer);

    const showBtn = createElement('div', {
        position: 'fixed', top: '20px', right: '20px',
        padding: '5px 10px', background: '#3498db', color: 'white',
        borderRadius: '4px', cursor: 'pointer', zIndex: '999998',
        display: 'none', fontSize: '12px',
        boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
    }, 'API工具');
    document.body.appendChild(showBtn);

    // 调试信息
    const debugArea = createElement('div', {
        padding: '8px 15px', background: '#f8f9fa',
        borderBottom: '1px solid #eee', fontSize: '11px', color: '#666'
    }, '调试信息：脚本已启动，等待请求...');

    // 距离和方向显示区域
    const distanceInfo = createElement('div', {
        padding: '8px 15px', background: '#fff3cd',
        borderBottom: '1px solid #eee', fontSize: '11px', color: '#856404',
        display: 'none', fontWeight: 'bold'
    }, '');

    // 设置面板（遮罩层）
    const settingsOverlay = createElement('div', {
        position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
        background: 'rgba(0,0,0,0.5)', zIndex: '1000000',
        display: 'none', alignItems: 'center', justifyContent: 'center'
    });
    document.body.appendChild(settingsOverlay);

    // 设置面板内容
    const settingsPanel = createElement('div', {
        background: '#fff', borderRadius: '8px', padding: '20px',
        width: '400px', maxWidth: '90vw', maxHeight: '90vh',
        overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
    }, '', settingsOverlay);

    const settingsTitle = createElement('h3', {
        margin: '0 0 15px 0', fontSize: '16px', color: '#2c3e50',
        borderBottom: '2px solid #3498db', paddingBottom: '10px'
    }, '⚙️ 设置面板', settingsPanel);

    // 设置项容器
    const settingsList = createElement('div', {}, '', settingsPanel);

    // 创建设置项：启用方向提示
    const distanceSettingItem = createElement('div', {
        marginBottom: '15px', padding: '15px',
        background: '#f8f9fa', borderRadius: '4px',
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center'
    }, '', settingsList);

    const distanceSettingLabel = createElement('div', {
        display: 'flex', flexDirection: 'column', flex: '1'
    }, '', distanceSettingItem);

    createElement('span', {
        fontSize: '14px', fontWeight: 'bold', color: '#2c3e50',
        marginBottom: '5px'
    }, '启用方向提示', distanceSettingLabel);

    createElement('span', {
        fontSize: '12px', color: '#666'
    }, '显示点击坐标与真实坐标的距离和方向信息', distanceSettingLabel);

    // 创建开关容器
    const distanceToggleWrapper = createElement('label', {
        position: 'relative',
        display: 'inline-block',
        width: '44px',
        height: '24px',
        cursor: 'pointer',
        flexShrink: '0'
    }, '', distanceSettingItem);
    
    const distanceToggle = createElement('input', {
        type: 'checkbox',
        checked: settings.showDistanceInfo,
        opacity: '0',
        width: '0',
        height: '0',
        position: 'absolute',
        margin: '0',
        padding: '0'
    });
    distanceToggleWrapper.appendChild(distanceToggle);
    
    const distanceToggleSlider = createElement('span', {
        position: 'absolute',
        top: '0',
        left: '0',
        right: '0',
        bottom: '0',
        background: settings.showDistanceInfo ? '#27ae60' : '#95a5a6',
        borderRadius: '24px',
        transition: 'background 0.3s'
    }, '', distanceToggleWrapper);
    
    const distanceToggleKnob = createElement('span', {
        position: 'absolute',
        height: '18px',
        width: '18px',
        left: settings.showDistanceInfo ? '22px' : '3px',
        bottom: '3px',
        background: 'white',
        borderRadius: '50%',
        transition: 'left 0.3s',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
    }, '', distanceToggleWrapper);

    // 创建设置项：启用自定义回答
    const customAnswerSettingItem = createElement('div', {
        marginBottom: '15px', padding: '15px',
        background: '#f8f9fa', borderRadius: '4px',
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center'
    }, '', settingsList);

    const customAnswerSettingLabel = createElement('div', {
        display: 'flex', flexDirection: 'column', flex: '1'
    }, '', customAnswerSettingItem);

    createElement('span', {
        fontSize: '14px', fontWeight: 'bold', color: '#2c3e50',
        marginBottom: '5px'
    }, '启用自定义回答', customAnswerSettingLabel);

    createElement('span', {
        fontSize: '12px', color: '#666'
    }, '拦截guess请求并显示弹窗，允许选择提交的坐标', customAnswerSettingLabel);

    // 创建自定义回答开关容器
    const customAnswerToggleWrapper = createElement('label', {
        position: 'relative',
        display: 'inline-block',
        width: '44px',
        height: '24px',
        cursor: 'pointer',
        flexShrink: '0'
    }, '', customAnswerSettingItem);
    
    const customAnswerToggle = createElement('input', {
        type: 'checkbox',
        checked: settings.enableCustomAnswer,
        opacity: '0',
        width: '0',
        height: '0',
        position: 'absolute',
        margin: '0',
        padding: '0'
    });
    customAnswerToggleWrapper.appendChild(customAnswerToggle);
    
    const customAnswerToggleSlider = createElement('span', {
        position: 'absolute',
        top: '0',
        left: '0',
        right: '0',
        bottom: '0',
        background: settings.enableCustomAnswer ? '#27ae60' : '#95a5a6',
        borderRadius: '24px',
        transition: 'background 0.3s'
    }, '', customAnswerToggleWrapper);
    
    const customAnswerToggleKnob = createElement('span', {
        position: 'absolute',
        height: '18px',
        width: '18px',
        left: settings.enableCustomAnswer ? '22px' : '3px',
        bottom: '3px',
        background: 'white',
        borderRadius: '50%',
        transition: 'left 0.3s',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
    }, '', customAnswerToggleWrapper);
    
    // 关闭按钮
    const closeSettingsBtn = createElement('button', {
        width: '100%', padding: '10px', marginTop: '15px',
        background: '#3498db', color: 'white', border: 'none',
        borderRadius: '4px', cursor: 'pointer', fontSize: '14px',
        fontWeight: 'bold', transition: 'background 0.3s'
    }, '关闭', settingsPanel);

    // 设置开关事件（合并样式更新和功能更新）
    distanceToggle.addEventListener('change', (e) => {
        e.stopPropagation();
        console.log('方向提示开关改变:', distanceToggle.checked);
        // 更新样式
        distanceToggleSlider.style.background = distanceToggle.checked ? '#27ae60' : '#95a5a6';
        distanceToggleKnob.style.left = distanceToggle.checked ? '22px' : '3px';
        // 更新设置
        settings.showDistanceInfo = distanceToggle.checked;
        saveSettings(settings);
        console.log('设置已保存:', settings);
        // 立即应用设置
        if (!settings.showDistanceInfo) {
            distanceInfo.style.display = 'none';
        } else if (currentLat != null && clickedLat != null) {
            distanceInfo.style.display = 'block';
        }
    });
    
    // 自定义回答开关事件（合并样式更新和功能更新）
    customAnswerToggle.addEventListener('change', (e) => {
        e.stopPropagation();
        console.log('自定义回答开关改变:', customAnswerToggle.checked);
        // 更新样式
        customAnswerToggleSlider.style.background = customAnswerToggle.checked ? '#27ae60' : '#95a5a6';
        customAnswerToggleKnob.style.left = customAnswerToggle.checked ? '22px' : '3px';
        // 更新设置
        settings.enableCustomAnswer = customAnswerToggle.checked;
        saveSettings(settings);
        console.log('设置已保存:', settings);
    });

    // 设置面板显示/隐藏
    settingsBtn.onclick = (e) => {
        e.stopPropagation();
        settingsOverlay.style.display = 'flex';
    };

    closeSettingsBtn.onclick = () => {
        settingsOverlay.style.display = 'none';
    };

    settingsOverlay.onclick = (e) => {
        if (e.target === settingsOverlay) {
            settingsOverlay.style.display = 'none';
        }
    };

    // ==================== 提交答案拦截弹窗 ====================
    let pendingGuessRequest = null;  // 待处理的guess请求（fetch）
    let pendingGuessXhrInfo = null;  // 待处理的guess请求信息（XHR: {method, url, xhr}）
    let pendingGuessUrl = null;      // 待处理的guess URL

    // 提交答案弹窗（遮罩层）
    const guessOverlay = createElement('div', {
        position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
        background: 'rgba(0,0,0,0.5)', zIndex: '1000001',
        display: 'none', alignItems: 'center', justifyContent: 'center'
    });
    document.body.appendChild(guessOverlay);

    // 提交答案弹窗内容
    const guessPanel = createElement('div', {
        background: '#fff', borderRadius: '8px', padding: '20px',
        width: '500px', maxWidth: '90vw', maxHeight: '90vh',
        overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
    }, '', guessOverlay);

    const guessTitle = createElement('h3', {
        margin: '0 0 15px 0', fontSize: '16px', color: '#2c3e50',
        borderBottom: '2px solid #e74c3c', paddingBottom: '10px'
    }, 'JMR已成功拦截[提交坐标]请求，请选择提交的坐标', guessPanel);

    const guessInfo = createElement('div', {
        marginBottom: '15px', padding: '10px',
        background: '#f8f9fa', borderRadius: '4px',
        fontSize: '12px', color: '#666'
    }, '', guessPanel);

    // 选项容器
    const guessOptions = createElement('div', {
        marginBottom: '15px'
    }, '', guessPanel);

    // 选项1：提交当前答案
    const optionCurrent = createElement('div', {
        marginBottom: '10px', padding: '10px',
        background: '#ecf0f1', borderRadius: '4px',
        cursor: 'pointer', border: '2px solid #bdc3c7'
    }, '', guessOptions);
    optionCurrent.onclick = () => {
        if (optionCurrent.style.opacity === '0.5') return;  // 禁用状态
        document.querySelectorAll('.guess-option').forEach(el => {
            el.style.border = '2px solid #bdc3c7';
            el.style.background = '#ecf0f1';
        });
        optionCurrent.style.border = '2px solid #3498db';
        optionCurrent.style.background = '#ebf5fb';
        selectedOption = 'current';
        offsetInput.disabled = true;
        offsetInput.value = '0';
        offsetPreview.textContent = '';
    };
    optionCurrent.className = 'guess-option';
    createElement('div', {
        fontSize: '14px', fontWeight: 'bold', color: '#2c3e50',
        marginBottom: '5px'
    }, '✓ 提交当前答案（点击的坐标）', optionCurrent);
    const currentCoords = createElement('div', {
        fontSize: '12px', color: '#666'
    }, '', optionCurrent);

    // 选项2：提交标准答案
    const optionStandard = createElement('div', {
        marginBottom: '10px', padding: '10px',
        background: '#ecf0f1', borderRadius: '4px',
        cursor: 'pointer', border: '2px solid #bdc3c7'
    }, '', guessOptions);
    optionStandard.onclick = () => {
        if (optionStandard.style.opacity === '0.5') return;  // 禁用状态
        document.querySelectorAll('.guess-option').forEach(el => {
            el.style.border = '2px solid #bdc3c7';
            el.style.background = '#ecf0f1';
        });
        optionStandard.style.border = '2px solid #3498db';
        optionStandard.style.background = '#ebf5fb';
        selectedOption = 'standard';
        offsetInput.disabled = false;
    };
    optionStandard.className = 'guess-option';
    createElement('div', {
        fontSize: '14px', fontWeight: 'bold', color: '#2c3e50',
        marginBottom: '5px'
    }, '✓ 提交标准答案（真实坐标）', optionStandard);
    const standardCoords = createElement('div', {
        fontSize: '12px', color: '#666'
    }, '', optionStandard);

    // 偏移设置
    const offsetContainer = createElement('div', {
        marginTop: '15px', padding: '10px',
        background: '#fff3cd', borderRadius: '4px',
        border: '1px solid #ffc107'
    }, '', guessPanel);
    createElement('div', {
        fontSize: '13px', fontWeight: 'bold', color: '#856404',
        marginBottom: '8px'
    }, '📍 自定义偏移（可选）', offsetContainer);
    const offsetInputRow = createElement('div', {
        display: 'flex', gap: '10px', alignItems: 'center'
    }, '', offsetContainer);
    createElement('span', {
        fontSize: '12px', color: '#856404'
    }, '偏移距离（米）：', offsetInputRow);
    const offsetInput = createElement('input', {
        type: 'number', value: '0',
        style: {
            flex: '1', padding: '5px', border: '1px solid #ddd',
            borderRadius: '4px', fontSize: '12px'
        },
        disabled: true,
        placeholder: '输入米数，正数表示随机方向偏移'
    });
    offsetInputRow.appendChild(offsetInput);
    
    // 偏移输入事件（只添加一次）
    offsetInput.addEventListener('input', function() {
        updateOffsetPreview();
    });
    const offsetPreview = createElement('div', {
        fontSize: '11px', color: '#856404', marginTop: '5px',
        fontStyle: 'italic'
    }, '', offsetContainer);

    let selectedOption = 'current';  // 默认选择当前答案

    // 按钮容器
    const guessButtons = createElement('div', {
        display: 'flex', gap: '10px', marginTop: '15px'
    }, '', guessPanel);

    const submitBtn = createElement('button', {
        flex: '1', padding: '10px',
        background: '#27ae60', color: 'white', border: 'none',
        borderRadius: '4px', cursor: 'pointer', fontSize: '14px',
        fontWeight: 'bold', transition: 'background 0.3s'
    }, '提交', guessButtons);

    const cancelBtn = createElement('button', {
        flex: '1', padding: '10px',
        background: '#95a5a6', color: 'white', border: 'none',
        borderRadius: '4px', cursor: 'pointer', fontSize: '14px',
        fontWeight: 'bold', transition: 'background 0.3s'
    }, '取消', guessButtons);

    // 显示提交答案弹窗
    function showGuessDialog(url, originalLat, originalLng) {
        pendingGuessUrl = url;
        const urlObj = new URL(url, location.href);
        const gameId = urlObj.searchParams.get('gameId');

        // 更新信息显示
        guessInfo.textContent = `游戏ID: ${gameId}\n原始坐标: (${originalLat.toFixed(6)}, ${originalLng.toFixed(6)})`;

        // 更新当前答案坐标
        if (clickedLat != null && clickedLng != null) {
            currentCoords.textContent = `坐标: (${clickedLat.toFixed(6)}, ${clickedLng.toFixed(6)})`;
            optionCurrent.style.opacity = '1';
            optionCurrent.style.cursor = 'pointer';
        } else {
            currentCoords.textContent = '坐标: 未检测到点击坐标';
            optionCurrent.style.opacity = '0.5';
            optionCurrent.style.cursor = 'not-allowed';
        }

        // 更新标准答案坐标
        if (currentLat != null && currentLng != null) {
            standardCoords.textContent = `坐标: (${currentLat.toFixed(6)}, ${currentLng.toFixed(6)})`;
            optionStandard.style.opacity = '1';
            optionStandard.style.cursor = 'pointer';
        } else {
            standardCoords.textContent = '坐标: 未获取到真实坐标';
            optionStandard.style.opacity = '0.5';
            optionStandard.style.cursor = 'not-allowed';
        }

        // 重置选择
        selectedOption = 'current';
        document.querySelectorAll('.guess-option').forEach(el => {
            el.style.border = '2px solid #bdc3c7';
            el.style.background = '#ecf0f1';
        });
        optionCurrent.style.border = '2px solid #3498db';
        optionCurrent.style.background = '#ebf5fb';
        offsetInput.value = '0';
        offsetInput.disabled = true;
        offsetPreview.textContent = '';

        guessOverlay.style.display = 'flex';
    }

    // 更新偏移预览
    function updateOffsetPreview() {
        const offsetMeters = parseFloat(offsetInput.value) || 0;
        if (offsetMeters === 0) {
            offsetPreview.textContent = '';
            return;
        }

        let baseLat, baseLng;
        if (selectedOption === 'standard' && currentLat != null && currentLng != null) {
            baseLat = currentLat;
            baseLng = currentLng;
        } else if (clickedLat != null && clickedLng != null) {
            baseLat = clickedLat;
            baseLng = clickedLng;
        } else {
            offsetPreview.textContent = '无法计算偏移：缺少基准坐标';
            return;
        }

        // 随机方向偏移（0-360度）
        const randomBearing = Math.random() * 360;
        const offset = offsetCoordinate(baseLat, baseLng, offsetMeters, randomBearing);
        offsetPreview.textContent = `预览: (${offset.lat.toFixed(6)}, ${offset.lng.toFixed(6)}) - 随机方向偏移${offsetMeters}米`;
    }

    // 提交答案
    submitBtn.onclick = () => {
        console.log('提交按钮被点击');
        console.log('pendingGuessUrl:', pendingGuessUrl);
        console.log('pendingGuessRequest:', pendingGuessRequest);
        console.log('pendingGuessXhrInfo:', pendingGuessXhrInfo);
        
        if (!pendingGuessUrl) {
            console.error('没有待处理的URL');
            alert('错误：没有待处理的请求');
            return;
        }

        let finalLat, finalLng;
        const offsetMeters = parseFloat(offsetInput.value) || 0;

        if (selectedOption === 'standard') {
            if (currentLat == null || currentLng == null) {
                alert('错误：未获取到真实坐标');
                return;
            }
            finalLat = currentLat;
            finalLng = currentLng;
        } else {
            if (clickedLat == null || clickedLng == null) {
                alert('错误：未检测到点击坐标');
                return;
            }
            finalLat = clickedLat;
            finalLng = clickedLng;
        }

        // 应用偏移
        if (offsetMeters !== 0) {
            const randomBearing = Math.random() * 360;
            const offset = offsetCoordinate(finalLat, finalLng, offsetMeters, randomBearing);
            finalLat = offset.lat;
            finalLng = offset.lng;
        }

        // 修改URL并提交
        const urlObj = new URL(pendingGuessUrl, location.href);
        const gameId = urlObj.searchParams.get('gameId');
        urlObj.searchParams.set('lat', finalLat.toString());
        urlObj.searchParams.set('lng', finalLng.toString());
        
        console.log('准备提交的URL:', urlObj.href);
        console.log('最终坐标:', finalLat, finalLng);

        // 先发送pin请求，然后再发送guess请求
        function sendPinRequest() {
            return new Promise((resolve, reject) => {
                const pinUrl = `${location.origin}/api/v0/tuxun/game/pin?gameId=${gameId}&lat=${finalLat}&lng=${finalLng}`;
                console.log('先发送pin请求:', pinUrl);
                
                const pinXhr = new XMLHttpRequest();
                ourXhrs.add(pinXhr);
                pinXhr.open('GET', pinUrl);
                pinXhr.onload = () => {
                    console.log('Pin请求成功');
                    resolve();
                };
                pinXhr.onerror = () => {
                    console.error('Pin请求失败');
                    // 即使pin失败，也继续发送guess
                    resolve();
                };
                pinXhr.send();
            });
        }

        // 发送guess请求的函数
        function sendGuessRequest() {
            if (pendingGuessRequest) {
                console.log('使用fetch提交guess');
                // 如果是fetch请求
                fetch(urlObj.href, pendingGuessRequest.options || {})
                    .then((response) => {
                        console.log('Fetch请求成功:', response);
                        guessOverlay.style.display = 'none';
                        debugArea.textContent = `调试信息：已提交答案 (${finalLat.toFixed(6)}, ${finalLng.toFixed(6)})`;
                        return response;
                    })
                    .catch(err => {
                        console.error('提交答案失败:', err);
                        alert('提交答案失败: ' + err.message);
                    });
            } else if (pendingGuessXhrInfo) {
                console.log('使用XHR提交guess');
                // 如果是XHR请求，创建新的XHR请求发送
                const xhr = new XMLHttpRequest();
                // 标记这是我们自己创建的XHR，不应该被拦截
                ourXhrs.add(xhr);
                const method = pendingGuessXhrInfo.method || 'GET';
                
                try {
                    // 先打开连接
                    xhr.open(method, urlObj.href);
                    console.log('Guess XHR已打开，状态:', xhr.readyState);
                    
                    // 检查状态
                    if (xhr.readyState !== XMLHttpRequest.OPENED) {
                        console.error('XHR打开失败，状态:', xhr.readyState);
                        alert('提交答案失败：无法打开连接');
                        return;
                    }
                    
                    // 复制原始XHR的事件监听器
                    const originalXhr = pendingGuessXhrInfo.xhr;
                    
                    // 复制所有事件监听器
                    ['load', 'error', 'abort', 'timeout'].forEach(eventType => {
                        if (originalXhr[`on${eventType}`]) {
                            xhr[`on${eventType}`] = originalXhr[`on${eventType}`];
                        }
                    });
                    
                    // 添加我们的处理
                    const originalOnload = xhr.onload;
                    xhr.onload = function() {
                        console.log('Guess XHR请求成功');
                        guessOverlay.style.display = 'none';
                        debugArea.textContent = `调试信息：已提交答案 (${finalLat.toFixed(6)}, ${finalLng.toFixed(6)})`;
                        if (originalOnload) originalOnload.call(this);
                    };
                    
                    const originalOnerror = xhr.onerror;
                    xhr.onerror = function() {
                        console.error('Guess XHR请求失败');
                        alert('提交答案失败');
                        if (originalOnerror) originalOnerror.call(this);
                    };
                    
                    // 确保状态正确后再发送
                    if (xhr.readyState === XMLHttpRequest.OPENED) {
                        console.log('发送Guess XHR请求...');
                        xhr.send();
                        console.log('Guess XHR请求已发送');
                    } else {
                        console.error('XHR状态错误，无法发送:', xhr.readyState);
                        alert('提交答案失败：XHR状态错误');
                    }
                } catch (e) {
                    console.error('创建XHR请求失败:', e);
                    alert('提交答案失败: ' + e.message);
                }
            } else {
                console.log('使用备用方案提交guess（创建新XHR）');
                // 备用方案：创建新的XHR请求
                const xhr = new XMLHttpRequest();
                // 标记这是我们自己创建的XHR，不应该被拦截
                ourXhrs.add(xhr);
                xhr.open('GET', urlObj.href);
                console.log('备用Guess XHR已打开，状态:', xhr.readyState);
                xhr.onload = () => {
                    console.log('备用Guess XHR请求成功');
                    guessOverlay.style.display = 'none';
                    debugArea.textContent = `调试信息：已提交答案 (${finalLat.toFixed(6)}, ${finalLng.toFixed(6)})`;
                };
                xhr.onerror = () => {
                    console.error('备用Guess XHR请求失败');
                    alert('提交答案失败');
                };
                console.log('发送备用Guess XHR请求...');
                xhr.send();
                console.log('备用Guess XHR请求已发送');
            }
        }

        // 先发送pin请求，然后发送guess请求
        sendPinRequest().then(() => {
            console.log('Pin请求完成，开始发送guess请求');
            sendGuessRequest();
        });

        pendingGuessRequest = null;
        pendingGuessXhrInfo = null;
        pendingGuessUrl = null;
    };

    // 取消
    cancelBtn.onclick = () => {
        guessOverlay.style.display = 'none';
        pendingGuessRequest = null;
        pendingGuessXhrInfo = null;
        pendingGuessUrl = null;
    };

    guessOverlay.onclick = (e) => {
        if (e.target === guessOverlay) {
            guessOverlay.style.display = 'none';
            pendingGuessRequest = null;
            pendingGuessXhrInfo = null;
            pendingGuessUrl = null;
        }
    };

    // 内容容器
    const contentContainer = createElement('div', {
        transition: 'all 0.3s ease', overflow: 'hidden',
        height: 'calc(100% - 40px)'
    }, '', floatWindow);
    contentContainer.appendChild(debugArea);
    contentContainer.appendChild(distanceInfo);

    const contentLayout = createElement('div', { display: 'flex', height: '100%' }, '', contentContainer);

    // 左侧：API 响应
    const responseArea = createElement('div', {
        width: '50%', padding: '15px', overflowY: 'auto',
        fontSize: '12px', lineHeight: '1.5',
        background: '#fafafa', borderRight: '1px solid #eee',
        boxSizing: 'border-box', transition: 'width 0.3s ease',color: '#000000'
    }, '等待API响应...', contentLayout);

    // 右侧：地图
    const mapContainer = createElement('div', {
        width: '50%', height: '100%', background: '#f5f5f5',
        boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
        transition: 'width 0.3s ease'
    }, '', contentLayout);

    const mapHeader = createElement('div', {
        padding: '8px 15px', background: '#f0f0f0',
        borderBottom: '1px solid #eee', fontSize: '12px',
        color: '#333', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center'
    }, '', mapContainer);
    createElement('span', {}, 'DONK666', mapHeader);

    const zoomControls = createElement('div', { display: 'flex', gap: '5px' }, '', mapHeader);
    const zoomOutBtn = createElement('button', {
        background: '#fff', border: '1px solid #ddd',
        borderRadius: '3px', width: '22px', height: '22px',
        padding: '0', cursor: 'pointer', fontSize: '14px',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
    }, '-', zoomControls);
    const zoomLevel = createElement('span', { fontSize: '11px', minWidth: '20px', textAlign: 'center' }, currentZoom, zoomControls);
    const zoomInBtn = createElement('button', {
        background: '#fff', border: '1px solid #ddd',
        borderRadius: '3px', width: '22px', height: '22px',
        padding: '0', cursor: 'pointer', fontSize: '14px',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
    }, '+', zoomControls);

    const mapImageContainer = createElement('div', {
        flex: '1', display: 'flex', alignItems: 'center',
        justifyContent: 'center', overflow: 'hidden', position: 'relative'
    }, '等待坐标数据加载地图...', mapContainer);

    const resizeHandle = createElement('div', {
        position: 'absolute', right: '0', bottom: '0',
        width: '15px', height: '15px', background: '#ccc',
        cursor: 'se-resize', borderTopLeftRadius: '8px'
    }, '', floatWindow);

    // ---------- 交互逻辑 ----------
    // 1. 折叠/展开（保持原功能）
    titleBar.addEventListener('click', (e) => {
        // 防止点击按钮时触发折叠
        if (e.target.closest('button') || e.target.closest('.zoomControls')) return;

        isCollapsed = !isCollapsed;
        if (isCollapsed) {
            originalSize.width = floatWindow.offsetWidth;
            originalSize.height = floatWindow.offsetHeight;
            floatWindow.style.height = '40px';
            contentContainer.style.height = '0';
            contentContainer.style.overflow = 'hidden';
            collapseIcon.textContent = '▶';
            resizeHandle.style.display = 'none';
        } else {
            floatWindow.style.height = `${originalSize.height}px`;
            contentContainer.style.height = 'calc(100% - 40px)';
            contentContainer.style.overflow = 'visible';
            collapseIcon.textContent = '▼';
            resizeHandle.style.display = 'block';
        }
    });

    // 2. 拖拽浮窗（标题栏）
    let isDragging = false, startX, startY, startLeft, startTop;
    titleBar.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = floatWindow.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        floatWindow.style.left = `${startLeft + dx}px`;
        floatWindow.style.top = `${startTop + dy}px`;
        floatWindow.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            document.body.style.userSelect = '';
        }
    });

    // 3. 调整大小（右下角手柄）
    let isResizing = false;
    resizeHandle.addEventListener('mousedown', e => { isResizing = true; document.body.style.userSelect = 'none'; e.stopPropagation(); });
    document.addEventListener('mousemove', e => {
        if (!isResizing) return;
        const minW = 600, minH = 400;
        const rect = floatWindow.getBoundingClientRect();
        const newW = e.clientX - rect.left;
        const newH = e.clientY - rect.top;
        if (newW >= minW) floatWindow.style.width = `${newW}px`;
        if (newH >= minH) floatWindow.style.height = `${newH}px`;
    });
    document.addEventListener('mouseup', () => {
        if (isResizing) { isResizing = false; document.body.style.userSelect = ''; }
    });

    // 4. 隐藏/显示整个窗口
    hideBtn.onclick = e => { e.stopPropagation(); floatWindow.style.display = 'none'; showBtn.style.display = 'block'; };
    showBtn.onclick = () => { floatWindow.style.display = 'block'; showBtn.style.display = 'none'; };

    // 5. 左侧栏快捷操作
    function toggleLeftSidebar(hide) {
        if (isLeftDeleted) return;
        isLeftHidden = hide;
        responseArea.style.width = hide ? '0' : '50%';
        responseArea.style.padding = hide ? '0' : '15px';
        responseArea.style.overflow = hide ? 'hidden' : 'auto';
        mapContainer.style.width = hide ? '100%' : '50%';
        hideBtn.textContent = hide ? '显示左侧' : '隐藏左侧';
    }

    hideBtn.onclick = e => {
        e.stopPropagation();

        toggleLeftSidebar(!isLeftHidden);
    };
    toggleLeftSidebar(!isLeftHidden);

    // 6. 快捷键：Ctrl+H 隐藏/显示左侧，Ctrl+D 删除左侧
    document.addEventListener('keydown', e => {
        if (!e.ctrlKey) return;
        if (e.key === 'h' || e.key === 'H') {
            e.preventDefault();
            if (!isLeftDeleted) toggleLeftSidebar(!isLeftHidden);
        }
        if (e.key === 'd' || e.key === 'D') {
            e.preventDefault();
            if (!isLeftDeleted && !isLeftHidden) {
                if (confirm('确定要永久删除左侧 API 响应面板吗？')) {
                    isLeftDeleted = true;
                    responseArea.remove();
                    mapContainer.style.width = '100%';
                    hideBtn.style.display = 'none';
                }
            }
        }
        // 缩放快捷键
        if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            if (currentZoom < maxZoom) { currentZoom++; zoomLevel.textContent = currentZoom; if (currentLat && currentLng) updateMap(currentLat, currentLng); }
        }
        if (e.key === '-') {
            e.preventDefault();
            if (currentZoom > minZoom) { currentZoom--; zoomLevel.textContent = currentZoom; if (currentLat && currentLng) updateMap(currentLat, currentLng); }
        }
    });

    // 7. 复制按钮
    copyBtn.onclick = e => {
        e.stopPropagation();
        if (!latestResponseData) {
            copyBtn.textContent = '❌ 无数据';
            setTimeout(() => copyBtn.textContent = '复制', 1500);
            return;
        }
        navigator.clipboard.writeText(JSON.stringify(latestResponseData, null, 2))
            .then(() => {
                const orig = copyBtn.textContent;
                copyBtn.textContent = '✅ 已复制';
                copyBtn.style.background = '#27ae60';
                setTimeout(() => { copyBtn.textContent = orig; copyBtn.style.background = '#2ecc71'; }, 1500);
            })
            .catch(() => {
                copyBtn.textContent = '❌ 复制失败';
                copyBtn.style.background = '#e74c3c';
                setTimeout(() => { copyBtn.textContent = '复制'; copyBtn.style.background = '#2ecc71'; }, 1500);
            });
    };

    // 8. 缩放按钮
    zoomOutBtn.onclick = () => { if (currentZoom > minZoom) { currentZoom--; zoomLevel.textContent = currentZoom; if (currentLat && currentLng) updateMap(currentLat, currentLng); } };
    zoomInBtn.onclick  = () => { if (currentZoom < maxZoom) { currentZoom++; zoomLevel.textContent = currentZoom; if (currentLat && currentLng) updateMap(currentLat, currentLng); } };

    // 9. 滚轮缩放（在地图容器上）
    mapImageContainer.addEventListener('wheel', e => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        const newZoom = currentZoom + delta;
        if (newZoom >= minZoom && newZoom <= maxZoom) {
            currentZoom = newZoom;
            zoomLevel.textContent = currentZoom;
            if (currentLat && currentLng) updateMap(currentLat, currentLng);
        }
    }, { passive: false });

    // ---------- 地图更新 ----------
    function updateMap(lat, lng) {
        currentLat = lat; currentLng = lng;

        if (!BAIDU_MAP_AK || BAIDU_MAP_AK === "你的AK") {
            mapImageContainer.textContent = '请先填写百度地图AK';
            mapImageContainer.style.color = '#e74c3c';
            return;
        }

        const fLat = parseFloat(lat).toFixed(6);
        const fLng = parseFloat(lng).toFixed(6);

        if (currentMapImage) { mapImageContainer.removeChild(currentMapImage); currentMapImage = null; }
        mapImageContainer.textContent = '加载地图中...';
        mapImageContainer.style.color = '#666';

        const img = new Image();
        img.style.maxWidth = '100%';
        img.style.maxHeight = '100%';
        img.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';

        const url = `https://api.map.baidu.com/staticimage/v2?ak=${encodeURIComponent(BAIDU_MAP_AK)}` +
            `&center=${fLng},${fLat}&zoom=${currentZoom}&width=800&height=600` +
            `&markers=${fLng},${fLat}&markerStyles=l,A`;

        img.src = url;
        img.onload = () => { mapImageContainer.textContent = ''; mapImageContainer.appendChild(img); currentMapImage = img; };
        img.onerror = () => { mapImageContainer.textContent = '地图加载失败\n请检查AK有效性'; mapImageContainer.style.color = '#e74c3c'; };
    }

    // ---------- 内容更新 ----------
    function updateContent(data, url) {
        latestResponseData = data;

        const pre = document.createElement('pre');
        pre.style.margin = '0';
        pre.style.whiteSpace = 'pre-wrap';
        pre.textContent = JSON.stringify(data, null, 2);
        responseArea.innerHTML = '';
        responseArea.appendChild(pre);

        const apiName = url.includes('getQQPanoInfo') ? 'getQQPanoInfo' : 'getPanoInfo';
        debugArea.textContent = `调试信息：已捕获 ${apiName} → ${url.split('?')[0]}`;

        const coords = extractCoords(data);
        if (coords) updateMap(coords.lat, coords.lng);
    }

    // 更新GeoPhoto内容
    function updateGeoPhotoContent(data, url) {
        latestResponseData = data;

        const pre = document.createElement('pre');
        pre.style.margin = '0';
        pre.style.whiteSpace = 'pre-wrap';
        pre.textContent = JSON.stringify(data, null, 2);
        responseArea.innerHTML = '';
        responseArea.appendChild(pre);

        const extracted = extractGeoPhotoData(data);
        if (extracted) {
            let debugText = `调试信息：已捕获 GeoPhotoService.GetMetadata → ${url.split('?')[0]}`;
            if (extracted.country) {
                debugText += ` | 国家: ${extracted.country}`;
            }
            if (extracted.firstUrl) {
                debugText += ` | 第一个URL: ${extracted.firstUrl.substring(0, 50)}...`;
            }
            debugArea.textContent = debugText;

            if (extracted.coords) {
                updateMap(extracted.coords.lat, extracted.coords.lng);
            }
        } else {
            debugArea.textContent = `调试信息：已捕获 GeoPhotoService.GetMetadata → ${url.split('?')[0]} (解析中...)`;
        }
    }

    // 应用初始设置
    if (!settings.showDistanceInfo) {
        distanceInfo.style.display = 'none';
    }

    // ==================== 网络拦截 ====================
    const origFetch = window.fetch;
    window.fetch = async function (resource, options) {
        const url = typeof resource === 'string' ? resource : resource?.url || resource?.href || '';
        if (isTargetRequest(url)) {
            debugArea.textContent = `调试信息：检测到 fetch ${url.split('?')[0]}`;
            const resp = await origFetch(resource, options);
            const clone = resp.clone();
            try { const json = await clone.json(); updateContent(json, url); } catch { }
            return resp;
        }
        if (isGuessRequest(url)) {
            // 重新加载设置（确保使用最新值）
            const currentSettings = loadSettings();
            // 检查是否启用了自定义回答
            if (!currentSettings.enableCustomAnswer) {
                // 如果未启用，直接放行
                return origFetch(resource, options);
            }
            
            try {
                const u = new URL(url, location.href);
                const lat = parseFloat(u.searchParams.get('lat'));
                const lng = parseFloat(u.searchParams.get('lng'));
                if (!isNaN(lat) && !isNaN(lng)) {
                    console.log('拦截到fetch guess请求:', url);
                    // 拦截请求，显示弹窗
                    pendingGuessRequest = { resource, options };
                    pendingGuessXhrInfo = null;  // 确保XHR信息被清除
                    showGuessDialog(url, lat, lng);
                    // 返回一个永远不会resolve的Promise，阻止原始请求
                    return new Promise(() => {});
                }
            } catch (e) {
                console.error('拦截guess请求失败:', e);
            }
        }
        if (isPinRequest(url)) {
            try {
                const u = new URL(url, location.href);
                const lat = parseFloat(u.searchParams.get('lat'));
                const lng = parseFloat(u.searchParams.get('lng'));
                if (!isNaN(lat) && !isNaN(lng)) {
                    clickedLat = lat;
                    clickedLng = lng;
                    // 点击坐标通常来自地图点击，可能是WGS84或GCJ02
                    // 根据实际情况判断，这里先假设是WGS84（如果偏差大可以改为GCJ02）
                    clickedCoordSource = 'WGS84';
                    updateDistanceInfo(lat, lng);
                    debugArea.textContent = `调试信息：检测到点击坐标 (${lat.toFixed(6)}, ${lng.toFixed(6)}) [${clickedCoordSource}]`;
                }
            } catch (e) {
                console.error('解析点击坐标失败:', e);
            }
        }
        return origFetch(resource, options);
    };

    const origXhrOpen = XMLHttpRequest.prototype.open;
    const origXhrSend = XMLHttpRequest.prototype.send;
    
    // 存储被拦截的XHR对象
    const interceptedXhrs = new WeakSet();
    // 存储我们自己创建的XHR对象（不应该被拦截）
    const ourXhrs = new WeakSet();
    
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        const fullUrl = url ? new URL(url, location.href).href : '';
        const target = isTargetRequest(fullUrl);
        if (target) {
            debugArea.textContent = `调试信息：检测到 XHR ${fullUrl.split('?')[0]}`;
            this.addEventListener('load', function () {
                try { const data = JSON.parse(this.responseText); updateContent(data, fullUrl); }
                catch (e) { responseArea.textContent = `XHR解析失败：${e.message}`; }
            });
            this.addEventListener('error', () => { debugArea.textContent = '调试信息：XHR请求失败'; });
        }
        if (isGuessRequest(fullUrl)) {
            // 如果这是我们自己创建的XHR，不拦截
            if (ourXhrs.has(this)) {
                console.log('这是我们自己创建的XHR，不拦截');
                return origXhrOpen.apply(this, [method, url, ...rest]);
            }
            
            // 重新加载设置（确保使用最新值）
            const currentSettings = loadSettings();
            // 检查是否启用了自定义回答
            if (!currentSettings.enableCustomAnswer) {
                // 如果未启用，直接放行
                return origXhrOpen.apply(this, [method, url, ...rest]);
            }
            
            try {
                const u = new URL(fullUrl, location.href);
                const lat = parseFloat(u.searchParams.get('lat'));
                const lng = parseFloat(u.searchParams.get('lng'));
                if (!isNaN(lat) && !isNaN(lng)) {
                    console.log('拦截到XHR guess请求:', fullUrl);
                    // 标记这个XHR对象为被拦截的
                    interceptedXhrs.add(this);
                    // 拦截请求，保存XHR信息
                    pendingGuessXhrInfo = {
                        method: method,
                        url: fullUrl,
                        xhr: this
                    };
                    pendingGuessRequest = null;  // 确保fetch信息被清除
                    showGuessDialog(fullUrl, lat, lng);
                    // 仍然调用原始的open，但标记为已拦截
                    return origXhrOpen.apply(this, [method, url, ...rest]);
                }
            } catch (e) {
                console.error('拦截guess请求失败:', e);
            }
        }
        if (isPinRequest(fullUrl)) {
            try {
                const u = new URL(fullUrl, location.href);
                const lat = parseFloat(u.searchParams.get('lat'));
                const lng = parseFloat(u.searchParams.get('lng'));
                if (!isNaN(lat) && !isNaN(lng)) {
                    clickedLat = lat;
                    clickedLng = lng;
                    // 点击坐标通常来自地图点击，可能是WGS84或GCJ02
                    clickedCoordSource = 'WGS84';
                    updateDistanceInfo(lat, lng);
                    debugArea.textContent = `调试信息：检测到点击坐标 (${lat.toFixed(6)}, ${lng.toFixed(6)}) [${clickedCoordSource}]`;
                }
            } catch (e) {
                console.error('解析点击坐标失败:', e);
            }
        }
        return origXhrOpen.apply(this, [method, url, ...rest]);
    };
    
    // 拦截send方法，阻止被拦截的XHR发送
    XMLHttpRequest.prototype.send = function (...args) {
        // 如果这是我们自己创建的XHR，直接发送
        if (ourXhrs.has(this)) {
            console.log('这是我们自己创建的XHR，直接发送');
            return origXhrSend.apply(this, args);
        }
        
        // 如果这个XHR被标记为已拦截，阻止发送
        if (interceptedXhrs.has(this)) {
            console.log('拦截到已标记的XHR send，阻止发送');
            // 不发送原始请求，等待用户在弹窗中选择后发送
            return;
        }
        return origXhrSend.apply(this, args);
    };

    // ==================== JSONP拦截 (GeoPhotoService) ====================
    // 拦截script标签的创建和src设置
    const origCreateElement = document.createElement;
    document.createElement = function(tagName, options) {
        const element = origCreateElement.call(this, tagName, options);
        
        if (tagName.toLowerCase() === 'script') {
            // 拦截src属性的设置
            let scriptSrc = '';
            const origSetAttribute = element.setAttribute;
            element.setAttribute = function(name, value) {
                if (name === 'src' && isGeoPhotoRequest(value)) {
                    scriptSrc = value;
                    debugArea.textContent = `调试信息：检测到 GeoPhotoService script 请求`;
                    
                    // 使用fetch获取响应内容
                    fetch(value)
                        .then(resp => resp.text())
                        .then(text => {
                            try {
                                // 解析JSONP响应：提取回调函数名和数据
                                // 格式: /**/ callbackName && callbackName([...])
                                let jsonDataStr = '';
                                const match1 = text.match(/^\/\*\*\/\s*(\w+)\s*&&\s*\1\s*\((.*)\)\s*$/s);
                                if (match1) {
                                    jsonDataStr = match1[2];
                                } else {
                                    // 尝试不带注释的格式: callbackName && callbackName([...])
                                    const match2 = text.match(/^(\w+)\s*&&\s*\1\s*\((.*)\)\s*$/s);
                                    if (match2) {
                                        jsonDataStr = match2[2];
                                    } else {
                                        debugArea.textContent = `调试信息：GeoPhotoService 响应格式无法解析: ${text.substring(0, 100)}...`;
                                        return;
                                    }
                                }
                                
                                // 解析JSON数据
                                const jsonData = JSON.parse(jsonDataStr);
                                updateGeoPhotoContent(jsonData, scriptSrc);
                            } catch (e) {
                                console.error('解析GeoPhotoService响应失败:', e, text.substring(0, 200));
                                debugArea.textContent = `调试信息：GeoPhotoService 解析失败: ${e.message}`;
                            }
                        })
                        .catch(err => {
                            console.error('获取GeoPhotoService响应失败:', err);
                            debugArea.textContent = `调试信息：GeoPhotoService 请求失败`;
                        });
                }
                return origSetAttribute.call(this, name, value);
            };

            // 拦截src属性的直接赋值
            const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src') || 
                                  Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'src');
            if (srcDescriptor && srcDescriptor.set) {
                const origSrcSetter = srcDescriptor.set;
                Object.defineProperty(element, 'src', {
                    set: function(value) {
                        if (isGeoPhotoRequest(value)) {
                            scriptSrc = value;
                            debugArea.textContent = `调试信息：检测到 GeoPhotoService script 请求`;
                            
                            // 使用fetch获取响应内容
                            fetch(value)
                                .then(resp => resp.text())
                                .then(text => {
                                    try {
                                        // 解析JSONP响应
                                        // 格式: /**/ callbackName && callbackName([...])
                                        let jsonDataStr = '';
                                        const match1 = text.match(/^\/\*\*\/\s*(\w+)\s*&&\s*\1\s*\((.*)\)\s*$/s);
                                        if (match1) {
                                            jsonDataStr = match1[2];
                                        } else {
                                            // 尝试不带注释的格式
                                            const match2 = text.match(/^(\w+)\s*&&\s*\1\s*\((.*)\)\s*$/s);
                                            if (match2) {
                                                jsonDataStr = match2[2];
                                            } else {
                                                debugArea.textContent = `调试信息：GeoPhotoService 响应格式无法解析: ${text.substring(0, 100)}...`;
                                                return;
                                            }
                                        }
                                        
                                        // 解析JSON数据
                                        const jsonData = JSON.parse(jsonDataStr);
                                        updateGeoPhotoContent(jsonData, scriptSrc);
                                    } catch (e) {
                                        console.error('解析GeoPhotoService响应失败:', e, text.substring(0, 200));
                                        debugArea.textContent = `调试信息：GeoPhotoService 解析失败: ${e.message}`;
                                    }
                                })
                                .catch(err => {
                                    console.error('获取GeoPhotoService响应失败:', err);
                                    debugArea.textContent = `调试信息：GeoPhotoService 请求失败`;
                                });
                        }
                        origSrcSetter.call(this, value);
                    },
                    get: srcDescriptor.get
                });
            }
        }
        
        return element;
    };

})();
