/**
 * Meting 聚合音源插件 for MusicFree（新版 Hono / metowolf-Meting-API 适配）
 *
 * v1.3.0 更新：
 *   - 榜单（排行榜 tab）：网易云官方榜单 11 个（飙升/新歌/热歌/原创/说唱/
 *     古典/电音/摇滚/抖音/韩语/ACG），均为 injahow 真机验证（100~200 首）。
 *   - 推荐歌单（推荐歌单 tab）：以官方榜单作为推荐内容（MetingAPI 无个性化
 *     推荐 feed，官方榜单即最稳妥的推荐来源）。两者均走 playlist 接口，免鉴权。
 *   - 搜索「全曲库」：5 平台并发、合并去重（见 v1.2.0）。
 *   - 开箱即用：未填 apiBase 时搜索回退公共公益实例、播放/歌词回退 injahow。
 *   - 自动更新：基于 srcUrl 版本自检，发现新版时在搜索结果顶部给出提示。
 *
 * 接口格式（metowolf/Meting-API，Hono）：
 *   GET /api?server=netease&type=search&id=周杰伦
 *   GET /api?server=netease&type=url&id=123456&auth=HMAC
 *   敏感接口(url/lrc/pic)需 auth = HMAC_SHA1(token, server+type+id)
 *   search/song/album/artist/playlist 不需鉴权。
 *
 * 容灾：
 *   搜索   = 你的 apiBase（自建 Vercel）→ 失败回退 bilibili.uno（公共）
 *   播放/歌词 = 你的 apiBase（需 token 签名）→ 失败回退 injahow（无 auth）
 *
 * 安全：本插件只做「请求转发 + 格式转换」，不收集任何信息；
 *       曲库来自第三方 MetingAPI 实例，请合理合规使用。
 */

const axios = require('axios');
const CryptoJS = require('crypto-js');

// ===== 可配置项 =====
// 播放/歌词兜底底座：injahow 无搜索，但播放/歌词/歌单极度稳定（已真机验证）。
const PLAYBACK_FALLBACK = 'https://api.injahow.cn/meting/';

// 公共搜索兜底（公益 Hono 实例，搜索不需鉴权，开箱即用）。仅用于搜索。
const PUBLIC_SEARCH_API = 'https://www.bilibili.uno';

// 全平台：metowolf/Meting-API 支持的 5 个 server。
const SOURCES = ['netease', 'tencent', 'kugou', 'baidu', 'kuwo'];

const PER_PAGE = 20;

// ===== 榜单 & 推荐歌单数据 =====
// 仅网易云官方榜单已真机验证（MetingAPI 的 playlist 接口不接受 QQ/酷狗的
// topId——它们需要的是歌单 dissid，暂未纳入）。需要扩平台时往本数组加项即可。
// 字段：server=平台, id=歌单/榜单 id, title=显示名, group=榜单分组
const RANKINGS = [
  { server: 'netease', id: '19723756', title: '云音乐飙升榜', group: '网易云 · 热门' },
  { server: 'netease', id: '3779629',  title: '云音乐新歌榜', group: '网易云 · 热门' },
  { server: 'netease', id: '3778678',  title: '云音乐热歌榜', group: '网易云 · 热门' },
  { server: 'netease', id: '2884035',  title: '网易云原创榜', group: '网易云 · 热门' },
  { server: 'netease', id: '991319590', title: '网易云说唱榜', group: '网易云 · 流派' },
  { server: 'netease', id: '71384707',  title: '网易云古典榜', group: '网易云 · 流派' },
  { server: 'netease', id: '1978921795', title: '网易云电音榜', group: '网易云 · 流派' },
  { server: 'netease', id: '745956260', title: '网易云摇滚榜', group: '网易云 · 流派' },
  { server: 'netease', id: '10520166',  title: '抖音排行榜',   group: '网易云 · 流派' },
  { server: 'netease', id: '60198',     title: '云音乐韩语榜', group: '网易云 · 地区' },
  { server: 'netease', id: '180106',    title: '云音乐ACG榜',  group: '网易云 · 地区' },
];

// 插件自身版本 + 远程更新地址（自动更新用）。
const CURRENT_VERSION = '1.3.0';
const SRC_URL = 'https://raw.githubusercontent.com/33117/musicfree-meting-plugin/main/meting-free.js';

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

// 构建 Hono 版请求 URL（主音源 / 自建）
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
// 兼容两套字段名：metowolf Hono 用 { title, author }，injahow 兜底用 { name, artist }
// base 传 '' 表示来源是公共搜索实例（不能用于播放），播放时改走 apiBase/injahow。
function _parseListHono(list, base, server) {
  const out = [];
  for (const it of list || []) {
    const id = extractId(it.url);
    if (!id) continue;
    out.push({
      id: server + '_' + id,
      title: it.title != null ? it.title : (it.name || ''),
      artist: it.author != null ? it.author : (it.artist || ''),
      album: '',
      artwork: it.pic || it.cover || '',
      duration: 0,
      _server: server,
      _id: id,
      _base: base || '',
    });
  }
  return out;
}

// 播放/歌词的尝试序列：[flavor, base]
function buildAttempts() {
  const attempts = [];
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

// ===== 自动更新：版本自检 =====
function compareVersion(a, b) {
  const pa = String(a || '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

let _updateChecked = false;
let _updateInfo = null;

// 拉取 srcUrl，提取 version 比较。失败静默（不影响使用）。
async function checkUpdate() {
  if (_updateChecked) return _updateInfo;
  _updateChecked = true;
  try {
    const res = await axios.get(SRC_URL, { timeout: 8000, responseType: 'text' });
    const txt = typeof res.data === 'string' ? res.data : String(res.data || '');
    const m = txt.match(/CURRENT_VERSION\s*=\s*['"]([^'"]+)['"]/) ||
              txt.match(/version:\s*['"]([^'"]+)['"]/);
    if (m) {
      const latest = m[1];
      _updateInfo = { hasUpdate: compareVersion(latest, CURRENT_VERSION) > 0, latest };
      return _updateInfo;
    }
  } catch (e) {
    /* 网络不可达时忽略 */
  }
  _updateInfo = null;
  return _updateInfo;
}

// 更新提示项（伪装成歌曲，置顶显示）
function makeUpdateHint(latest) {
  return {
    id: '__UPDATE_HINT__',
    title: `🔔 插件已更新到 v${latest}，点「插件设置 → 更新插件」升级`,
    artist: '（这是更新提示，点击不会播放）',
    album: '',
    artwork: '',
    duration: 0,
    _isUpdateHint: true,
  };
}

// ===== 搜索（全曲库 + 并发 + 兜底）=====
async function search(query, page, type) {
  if (type !== 'music') return { isEnd: true, data: [] };

  // 有自建地址优先用自建（更稳更全）；否则用公共公益实例开箱即用。
  const apiBase = getApiBase() || PUBLIC_SEARCH_API;
  const token = getToken(); // 搜索不需 auth，传入无害

  // 并发搜索所有平台：单源失败不影响整体，总时长 ≤ 最慢源（≤8s），不超 10s 限制。
  const tasks = SOURCES.map((server) =>
    axios
      .get(honoUrl(apiBase, server, 'search', query, token), { timeout: 8000 })
      .then((res) => ({ server, list: Array.isArray(res.data) ? res.data : [] }))
      .catch(() => ({ server, list: [] }))
  );
  const settled = await Promise.all(tasks);

  const results = [];
  const seen = new Set();
  for (const { server, list } of settled) {
    for (const it of _parseListHono(list, '', server)) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      results.push(it);
    }
    if (results.length >= PER_PAGE * 3) break;
  }

  // 自动更新提示：在结果顶部插入（如有新版）
  if (page === 1) {
    try {
      const upd = await checkUpdate();
      if (upd && upd.hasUpdate) results.unshift(makeUpdateHint(upd.latest));
    } catch (e) {
      /* ignore */
    }
  }

  return { isEnd: results.length < PER_PAGE, data: results.slice(0, PER_PAGE) };
}

async function getMediaSource(musicItem, quality) {
  if (musicItem._isUpdateHint) {
    throw new Error('这是更新提示项，请到「插件设置 → 更新插件」升级。');
  }
  const server = musicItem._server || 'netease';
  const id = musicItem._id != null ? musicItem._id : musicItem.id;
  const token = musicItem._token != null ? musicItem._token : getToken();

  let lastErr;
  for (const [flavor, base] of buildAttempts()) {
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

  for (const [flavor, base] of buildAttempts()) {
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

// ===== 榜单（排行榜 tab）& 推荐歌单（推荐歌单 tab）=====

// 把 RANKINGS 转成 IMusicSheetItem（供推荐歌单/歌单列表复用）
function rankingToSheet(r) {
  return {
    id: r.id,
    title: r.title,
    platform: 'Meting 聚合源',
    _server: r.server,
  };
}

// 榜单列表（排行榜 tab）：按 group 分组返回
async function getTopLists() {
  const groups = {};
  for (const r of RANKINGS) {
    (groups[r.group] = groups[r.group] || []).push({
      id: r.id,
      title: r.title,
      _server: r.server,
    });
  }
  return Object.keys(groups).map((title) => ({ title, data: groups[title] }));
}

// 榜单详情（点某个榜单后）：playlist 接口免鉴权，不填 token 也能看
async function getTopListDetail(topListItem, page) {
  if (page > 1) return { isEnd: true, musicList: [] };
  const server = topListItem._server || 'netease';
  const list = await _fetchList('playlist', { id: topListItem.id }, server);
  if (!list) throw new Error('榜单获取失败');
  return { isEnd: true, musicList: list };
}

// 推荐歌单标签（推荐歌单 tab）
async function getRecommendSheetTags() {
  return {
    pinned: [{ id: 'all', title: '全部榜单' }],
    data: [
      {
        title: '网易云',
        data: [{ id: 'netease', title: '官方榜单' }],
      },
    ],
  };
}

// 按标签返回推荐歌单（以官方榜单作为推荐内容；MetingAPI 无个性化推荐 feed）
async function getRecommendSheetsByTag(tag, page) {
  return { isEnd: true, data: RANKINGS.map(rankingToSheet) };
}

module.exports = {
  platform: 'Meting 聚合源',
  version: CURRENT_VERSION,
  author: '33117',
  description:
    '适配 metowolf/Meting-API(Hono) 的多平台聚合音源（网易云/QQ/酷狗/百度/酷我）。内置网易云官方榜单 11 个 + 推荐歌单，免鉴权即可看榜；未填 apiBase 时自动用公共公益实例搜索 + injahow 兜底播放，开箱即用；填了自建 Vercel 地址后更快更全更稳。',
  srcUrl: SRC_URL,
  cacheControl: 'no-cache',
  supportedSearchType: ['music'],
  userVariables: [
    {
      key: 'apiBase',
      name: '自建 MetingAPI 地址（选填）',
      hint: '你的 Vercel 部署地址，如 https://xxx.vercel.app（不要带 /api）。不填也能搜（用公共公益实例），填了更快更全更稳。',
    },
    {
      key: 'token',
      name: 'Meting Token（选填）',
      hint: '仅当填了 apiBase 时才需要，且与 Vercel 的 METING_TOKEN 完全一致，用于 url/lrc/pic 的 HMAC 鉴权。',
    },
  ],
  hints: {
    search: [
      '搜索优先用你自建的 Vercel 实例（更快更全）。未填写时自动使用公共公益实例（可能较慢、部分平台不全），建议按 VERCEL_DEPLOY.md 自建。',
      '插件更新：插件设置 → 更新插件。发现新版时搜索结果顶部会出现提示。',
    ],
  },

  // 仅供测试的导出
  _parseListHono,
  honoUrl,
  injahowUrl,
  signAuth,
  extractId,
  compareVersion,
  checkUpdate,
  makeUpdateHint,
  PUBLIC_SEARCH_API,
  CURRENT_VERSION,
  SRC_URL,
  RANKINGS,
  rankingToSheet,
  getTopLists,
  getTopListDetail,
  getRecommendSheetTags,
  getRecommendSheetsByTag,

  search,
  getMediaSource,
  getLyric,
  getMusicSheetInfo,
  getAlbumInfo,
  importMusicSheet,
  getTopLists,
  getTopListDetail,
  getRecommendSheetTags,
  getRecommendSheetsByTag,
};
