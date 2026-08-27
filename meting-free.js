/**
 * Meting 聚合音源插件 for MusicFree（新版 Hono / metowolf-Meting-API 适配）
 *
 * 目标形态：以你「自建的 MetingAPI（Hono 版）」为唯一主音源，实现
 *   曲库全（网易云/QQ/酷狗/百度/酷我）+ 稳定 + 可控 + 可自动更新。
 *
 * 接口格式（metowolf/Meting-API，Hono）：
 *   GET /api?server=netease&type=search&id=周杰伦
 *   GET /api?server=netease&type=url&id=123456&auth=HMAC
 *   敏感接口(url/lrc/pic)需 auth = HMAC_SHA1(token, server+type+id)
 *
 * 容灾：主音源 = 你的 Vercel 实例(apiBase + token)；
 *       兜底 = api.injahow.cn（仅 url/lrc/playlist/album，无 auth、无搜索）。
 *
 * 安全：本插件只做「请求转发 + 格式转换」，不收集任何信息；
 *       曲库来自第三方 MetingAPI 实例，请合理合规使用。
 */

const axios = require('axios');
const CryptoJS = require('crypto-js');

// ===== 可配置项 =====
// 兜底底座：injahow 无搜索，但播放/歌词/歌单极度稳定（已真机验证）。
const PLAYBACK_FALLBACK = 'https://api.injahow.cn/meting/';

// 聚合的源：网易云优先，QQ / 酷狗补充覆盖。
const SOURCES = ['netease', 'tencent', 'kugou'];

const PER_PAGE = 20;

// 读取用户变量（自建地址 / 鉴权令牌）。兼容沙箱/本地测试环境。
function getUserVar(key) {
  try {
    if (typeof env !== 'undefined' && env && typeof env.getUserVariables === 'function') {
      return (env.getUserVariables()[key] || '').trim();
    }
  } catch (e) {
    /* ignore */
  }
  return '';
}

function getApiBase() {
  const v = getUserVar('apiBase');
  return v ? v.replace(/\/+$/, '') : ''; // 去掉尾部斜杠，/api 由插件拼接
}

function getToken() {
  return getUserVar('token');
}

// HMAC-SHA1 签名（与 metowolf/Meting-API 服务端算法一致）
// token = HMAC_SHA1(METING_TOKEN, server + type + id)
function signAuth(server, type, id, token) {
  const message = `${server}${type}${id}`;
  return CryptoJS.HmacSHA1(message, token || '').toString();
}

// 构建 Hono 版请求 URL（主音源）
function honoUrl(base, server, type, id, token) {
  const clean = (base || '').replace(/\/+$/, ''); // 去掉尾部斜杠，避免 //api
  let u = `${clean}/api?server=${server}&type=${type}&id=${encodeURIComponent(id)}`;
  if (token && (type === 'url' || type === 'lrc' || type === 'pic')) {
    u += '&auth=' + signAuth(server, type, id, token);
  }
  return u;
}

// 构建 injahow 兜底请求 URL（无 /api 前缀、无 auth）
function injahowUrl(base, server, type, id) {
  return `${base.replace(/\/+$/, '')}/?server=${server}&type=${type}&id=${encodeURIComponent(id)}`;
}

// 从返回项的 url 字段里抠出真实 id（新版响应无独立 id 字段）
function extractId(urlStr) {
  if (!urlStr) return '';
  const m = String(urlStr).match(/[?&]id=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// 解析搜索/列表响应（抽出便于单元测试）
// 新版字段：{ title, author, url, pic, lrc }
function _parseListHono(list, base, server) {
  const out = [];
  for (const it of list || []) {
    const id = extractId(it.url);
    if (!id) continue;
    out.push({
      id: server + '_' + id,
      title: it.title || '',
      artist: it.author || '',
      album: '',
      artwork: it.pic || '',
      duration: 0,
      _server: server,
      _id: id,
      _base: base,
    });
  }
  return out;
}

// 组装请求尝试序列：[flavor, base]
function buildAttempts(musicItem) {
  const attempts = [];
  if (musicItem && musicItem._base) attempts.push(['hono', musicItem._base]);
  const apiBase = getApiBase();
  if (apiBase) attempts.push(['hono', apiBase]);
  attempts.push(['injahow', PLAYBACK_FALLBACK]);
  return attempts;
}

function refererOf(urlStr, fallback) {
  try {
    return new URL(urlStr).origin + '/';
  } catch (e) {
    return fallback;
  }
}

async function search(query, page, type) {
  if (type !== 'music') return { isEnd: true, data: [] };
  const apiBase = getApiBase();
  if (!apiBase) {
    try {
      console.warn('[Meting] 未配置 apiBase，搜索不可用，请在插件设置填写你的自建 MetingAPI 地址');
    } catch (e) {}
    return { isEnd: true, data: [] };
  }
  const token = getToken();
  const results = [];
  const seen = new Set();

  for (const server of SOURCES) {
    try {
      const res = await axios.get(honoUrl(apiBase, server, 'search', query, token), {
        timeout: 9000,
      });
      const list = Array.isArray(res.data) ? res.data : [];
      for (const it of _parseListHono(list, apiBase, server)) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        results.push(it);
      }
    } catch (e) {
      /* 尝试下一个源 */
    }
    if (results.length >= PER_PAGE) break;
  }

  return { isEnd: results.length < PER_PAGE, data: results };
}

async function getMediaSource(musicItem, quality) {
  const server = musicItem._server || 'netease';
  const id = musicItem._id != null ? musicItem._id : musicItem.id;
  const token = musicItem._token != null ? musicItem._token : getToken();

  let lastErr;
  for (const [flavor, base] of buildAttempts(musicItem)) {
    try {
      const url =
        flavor === 'hono'
          ? honoUrl(base, server, 'url', id, token)
          : injahowUrl(base, server, 'url', id);
      const res = await axios.get(url, {
        maxRedirects: 0,
        validateStatus: (s) => s < 400,
        timeout: 9000,
      });
      // Hono / injahow 的 type=url 均 302 重定向到真实音频
      const finalUrl = (res.headers && res.headers.location) || url;
      if (!finalUrl) continue;
      return { url: finalUrl, headers: { Referer: refererOf(finalUrl, base) } };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error('无法获取播放链接：' + (lastErr && lastErr.message));
}

async function getLyric(musicItem) {
  const server = musicItem._server || 'netease';
  const id = musicItem._id != null ? musicItem._id : musicItem.id;
  const token = musicItem._token != null ? musicItem._token : getToken();

  for (const [flavor, base] of buildAttempts(musicItem)) {
    try {
      const url =
        flavor === 'hono'
          ? honoUrl(base, server, 'lrc', id, token)
          : injahowUrl(base, server, 'lrc', id);
      const res = await axios.get(url, { timeout: 9000 });
      const lrc = typeof res.data === 'string' ? res.data : res.data && res.data.lyric;
      if (lrc && lrc.trim()) return { rawLrc: lrc };
    } catch (e) {
      /* try next */
    }
  }
  return { rawLrc: '' };
}

async function _fetchList(type, sheetItem, server) {
  const apiBase = getApiBase();
  const token = getToken();
  const attempts = [];
  if (apiBase) attempts.push(['hono', apiBase]);
  attempts.push(['injahow', PLAYBACK_FALLBACK]);

  for (const [flavor, base] of attempts) {
    try {
      const url =
        flavor === 'hono'
          ? honoUrl(base, server, type, sheetItem.id, token)
          : injahowUrl(base, server, type, sheetItem.id);
      const res = await axios.get(url, { timeout: 9000 });
      const list = Array.isArray(res.data) ? res.data : [];
      if (list.length) return _parseListHono(list, apiBase || base, server);
    } catch (e) {
      /* try next */
    }
  }
  return null;
}

async function getMusicSheetInfo(sheetItem, page) {
  if (page > 1) return { isEnd: true, musicList: [] };
  const server = sheetItem._server || 'netease';
  const list = await _fetchList('playlist', sheetItem, server);
  if (!list) throw new Error('歌单获取失败');
  return { isEnd: true, musicList: list };
}

async function getAlbumInfo(albumItem, page) {
  if (page > 1) return { isEnd: true, musicList: [] };
  const server = albumItem._server || 'netease';
  const list = await _fetchList('album', albumItem, server);
  if (!list) throw new Error('专辑获取失败');
  return { isEnd: true, musicList: list };
}

async function importMusicSheet(urlLike) {
  const m =
    (urlLike || '').match(/id=(\d+)/) ||
    (urlLike || '').match(/playlist[/=](\d+)/);
  if (!m) throw new Error('无法识别的歌单链接，请使用含 id= 的歌单地址');
  const list = await _fetchList('playlist', { id: m[1] }, 'netease');
  if (!list) throw new Error('歌单导入失败');
  return list;
}

module.exports = {
  platform: 'Meting 自建源',
  version: '1.1.0',
  author: 'Buddy (WorkBuddy)',
  description:
    '适配 metowolf/Meting-API(Hono) 的多平台聚合音源（网易云/QQ/酷狗/百度/酷我）。主音源为你自建的 Vercel 实例，injahow 作播放/歌词兜底。请在插件设置填写 apiBase 与 token。',
  srcUrl: 'https://raw.githubusercontent.com/33117/musicfree-meting-plugin/main/meting-free.js',
  cacheControl: 'no-store',
  supportedSearchType: ['music'],
  userVariables: [
    {
      key: 'apiBase',
      name: '自建 MetingAPI 地址',
      hint: '必填。你的 Vercel 部署地址，如 https://xxx.vercel.app （不要带 /api，插件会自动拼接）。留空则搜索不可用。',
    },
    {
      key: 'token',
      name: 'Meting Token',
      hint: '必填（与 Vercel 环境变量 METING_TOKEN 完全一致）。仅 url/lrc/pic 接口用于 HMAC 鉴权。',
    },
  ],

  // 仅供测试的导出
  _parseListHono,
  _parseSearch: _parseListHono,
  honoUrl,
  injahowUrl,
  signAuth,
  extractId,

  search,
  getMediaSource,
  getLyric,
  getMusicSheetInfo,
  getAlbumInfo,
  importMusicSheet,
};
